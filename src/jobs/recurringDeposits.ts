import db from '../db'
import { logger, logBackgroundJob } from '../utils/logger'
import {
  generateCorrelationId,
  runWithCorrelationIdAsync,
} from '../utils/correlation'
import { config } from '../config/env'
import { recordBackgroundJob } from '../utils/metrics'
import { recordJobSuccess, recordJobFailure } from '../utils/job-metrics'
import { scheduleResilientJob } from './resilientScheduler'
import { executeDeposit } from '../controllers/transaction-controller'
import { publishUserEvent } from '../events/publisher'
import { EVENT_TYPE_TOPIC } from '../events/types'
import { addCadence } from '../utils/cadence'
import type { RecurringDepositPlan } from '@prisma/client'

export { addCadence } from '../utils/cadence'

/** How long an `executing` claim may sit before a restarted process may resume it. */
export const RECURRING_DEPOSIT_EXECUTING_LEASE_MS = 10 * 60 * 1000

/**
 * A plan left in `executing` after a crash is stale once the lease expires.
 * A missing lastRunAt is treated as stale so the row cannot stick forever.
 */
export function isExecutingClaimStale(
  plan: { lastRunStatus: string | null; lastRunAt: Date | null },
  now: Date = new Date(),
  leaseMs = RECURRING_DEPOSIT_EXECUTING_LEASE_MS
): boolean {
  if (plan.lastRunStatus !== 'executing') return false
  if (!plan.lastRunAt) return true
  return now.getTime() - new Date(plan.lastRunAt).getTime() >= leaseMs
}

/**
 * Attempt to atomically claim a due plan for execution.
 * Uses a conditional update so two overlapping job ticks cannot both
 * claim the same occurrence.
 *
 * Returns the claimed plan row if successful, null if already claimed.
 */
async function claimDuePlan(
  planId: string
): Promise<RecurringDepositPlan | null> {
  const now = new Date()

  // Find the plan first to get the current nextRunAt for comparison
  const plan = await db.recurringDepositPlan.findUnique({
    where: { id: planId },
  })

  const staleExecuting = !!plan && isExecutingClaimStale(plan, now)

  if (
    !plan ||
    plan.status !== 'ACTIVE' ||
    plan.nextRunAt > now ||
    (plan.lastRunStatus === 'executing' && !staleExecuting)
  ) {
    return null
  }

  // Atomic claim: only succeed if the plan is still in the same state.
  // A stale `executing` row may be reclaimed; a fresh one may not.
  const updated = await db.recurringDepositPlan.updateMany({
    where: {
      id: planId,
      status: 'ACTIVE',
      nextRunAt: plan.nextRunAt,
      ...(staleExecuting
        ? { lastRunStatus: 'executing' }
        : { NOT: { lastRunStatus: 'executing' } }),
    },
    data: {
      lastRunAt: now,
      lastRunStatus: 'executing',
    },
  })

  if (updated.count === 0) {
    return null
  }

  // Re-fetch the updated row
  return db.recurringDepositPlan.findUnique({ where: { id: planId } })
}

type ResumeDecision = 'completed' | 'in_flight' | 'retry'

/**
 * After a crash, finish an interrupted occurrence from the deposit that was
 * already persisted, or signal that it is safe to submit again.
 * PENDING rows belong to the outbox dispatcher — submitting another deposit
 * would double-charge.
 */
async function resumeInterruptedPlan(
  plan: RecurringDepositPlan
): Promise<ResumeDecision> {
  const since = plan.lastRunAt ?? new Date(0)
  const existing = await db.transaction.findFirst({
    where: {
      userId: plan.userId,
      type: 'DEPOSIT',
      memo: `recurring-deposit:${plan.id}`,
      createdAt: { gte: since },
    },
    orderBy: { createdAt: 'desc' },
  })

  if (!existing) return 'retry'

  if (existing.status === 'CONFIRMED') {
    await db.recurringDepositPlan.update({
      where: { id: plan.id },
      data: {
        lastRunStatus: 'executed',
        nextRunAt: addCadence(plan.cadence, new Date()),
      },
    })
    logger.info(
      '[RecurringDeposit] Resumed interrupted plan from confirmed transaction',
      { planId: plan.id, transactionId: existing.id }
    )
    return 'completed'
  }

  if (existing.status === 'PENDING') {
    logger.warn(
      '[RecurringDeposit] Interrupted plan still has a pending deposit; waiting for the outbox',
      { planId: plan.id, transactionId: existing.id }
    )
    return 'in_flight'
  }

  return 'retry'
}

/**
 * Execute a single recurring deposit plan.
 */
async function executePlan(plan: RecurringDepositPlan): Promise<void> {
  const wallet = await db.custodialWallet.findUnique({
    where: { userId: plan.userId },
    select: { publicKey: true },
  })

  if (!wallet) {
    logger.error('[RecurringDeposit] No wallet found for user', {
      planId: plan.id,
      userId: plan.userId,
    })
    await failPlan(plan, 'no_wallet')
    return
  }

  try {
    const result = await executeDeposit({
      userId: plan.userId,
      walletAddress: wallet.publicKey,
      amount: Number(plan.amount),
      assetSymbol: plan.assetSymbol,
      memo: `recurring-deposit:${plan.id}`,
    })

    if (result.status === 'CONFIRMED') {
      const nextRunAt = addCadence(plan.cadence, new Date())
      await db.recurringDepositPlan.update({
        where: { id: plan.id },
        data: {
          lastRunStatus: 'executed',
          nextRunAt,
        },
      })

      logger.info('[RecurringDeposit] Plan executed successfully', {
        planId: plan.id,
        userId: plan.userId,
        txHash: result.transaction!.txHash,
      })

      publishUserEvent(
        plan.userId,
        EVENT_TYPE_TOPIC['recurring_deposit.executed'],
        'recurring_deposit.executed',
        {
          planId: plan.id,
          userId: plan.userId,
          amount: Number(plan.amount),
          assetSymbol: plan.assetSymbol,
          cadence: plan.cadence,
          txHash: result.transaction!.txHash,
        }
      ).catch(() => {})
    } else if (result.status === 'PENDING_APPROVAL') {
      // Gated by an ApprovalPolicy (#314): skip this occurrence rather than
      // executing or failing it. `nextRunAt` is deliberately left untouched
      // so the plan is picked up again next sweep — guardOperation's dedupe
      // check (same policy/user/amount, still-PENDING) lands on the same
      // open request instead of piling up duplicates, so this is a no-op
      // poll until an approver decides, not a retry storm.
      await db.recurringDepositPlan.update({
        where: { id: plan.id },
        data: { lastRunStatus: 'pending_approval' },
      })

      logger.info('[RecurringDeposit] Plan occurrence pending approval', {
        planId: plan.id,
        userId: plan.userId,
        approvalRequestId: result.approvalRequestId,
      })
    } else {
      await failPlan(plan, 'transaction_failed')
    }
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'unknown_error'

    // Detect insufficient-funds specifically if the error message indicates it
    const isInsufficientFunds =
      reason.toLowerCase().includes('insufficient') ||
      reason.toLowerCase().includes('balance')

    await failPlan(plan, isInsufficientFunds ? 'insufficient_funds' : reason)
  }
}

/**
 * Mark a plan as failed and dispatch notifications.
 * The plan stays ACTIVE so the next occurrence will be attempted.
 */
async function failPlan(
  plan: RecurringDepositPlan,
  reason: string
): Promise<void> {
  await db.recurringDepositPlan.update({
    where: { id: plan.id },
    data: { lastRunStatus: reason },
  })

  logger.warn('[RecurringDeposit] Plan execution failed', {
    planId: plan.id,
    userId: plan.userId,
    reason,
  })

  publishUserEvent(
    plan.userId,
    EVENT_TYPE_TOPIC['recurring_deposit.failed'],
    'recurring_deposit.failed',
    {
      planId: plan.id,
      userId: plan.userId,
      amount: Number(plan.amount),
      assetSymbol: plan.assetSymbol,
      cadence: plan.cadence,
      reason,
    }
  ).catch(() => {})
}

/**
 * Process all recurring deposit plans that are due.
 */
export async function processRecurringDeposits(): Promise<void> {
  const correlationId = generateCorrelationId()
  return runWithCorrelationIdAsync(correlationId, async () => {
    const startTime = Date.now()
    const jobName = 'recurring_deposits'

    try {
      const now = new Date()
      const duePlans = await db.recurringDepositPlan.findMany({
        where: {
          status: 'ACTIVE',
          nextRunAt: { lte: now },
        },
        orderBy: { nextRunAt: 'asc' },
      })

      if (duePlans.length === 0) {
        const durationMs = Date.now() - startTime
        recordJobSuccess(jobName, durationMs)
        return
      }

      logBackgroundJob(
        jobName,
        'success',
        (Date.now() - startTime) / 1000,
        correlationId,
        {
          dueCount: duePlans.length,
        }
      )

      // Process each plan; failures are caught individually
      for (const plan of duePlans) {
        if (plan.lastRunStatus === 'executing') {
          if (!isExecutingClaimStale(plan, now)) continue
          const decision = await resumeInterruptedPlan(plan)
          if (decision !== 'retry') continue
        }

        const claimed = await claimDuePlan(plan.id)
        if (!claimed) continue

        try {
          await executePlan(claimed)
        } catch (err) {
          logger.error('[RecurringDeposit] Unexpected error executing plan', {
            planId: plan.id,
            error: err instanceof Error ? err.message : String(err),
          })
        }
      }

      const durationMs = Date.now() - startTime
      recordBackgroundJob(jobName, 'success', durationMs / 1000)
      recordJobSuccess(jobName, durationMs)
    } catch (error) {
      const durationMs = Date.now() - startTime
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error'

      logBackgroundJob(jobName, 'failed', durationMs / 1000, correlationId, {
        error: errorMessage,
      })

      recordBackgroundJob(jobName, 'failed', durationMs / 1000)
      recordJobFailure(jobName, durationMs, error)
    }
  })
}

/**
 * Schedule the recurring deposit job to run once at startup, then
 * on a fixed interval (default: 5 minutes).
 *
 * @returns A NodeJS.Timeout handle (call clearInterval to stop it).
 */
export function scheduleRecurringDeposits(): NodeJS.Timeout {
  const handle = scheduleResilientJob({
    jobName: 'recurring_deposits',
    task: processRecurringDeposits,
    intervalMs: config.recurringDeposits.intervalMs,
  })

  logger.info(
    `[RecurringDeposit] Scheduler started (interval: ${config.recurringDeposits.intervalMs}ms)`
  )
  return handle
}
