import db from '../db'
import { logger } from '../utils/logger'
import {
  generateImpersonationToken,
  verifyImpersonationToken,
  type ImpersonationContext,
} from '../middleware/impersonation'
import { publishUserEvent } from '../events/publisher'
import { EVENT_TYPE_TOPIC } from '../events/types'

export async function startImpersonation(
  adminId: string,
  adminName: string,
  targetUserId: string
): Promise<{ success: boolean; token?: string; error?: string }> {
  try {
    const targetUser = await db.user.findUnique({
      where: { id: targetUserId },
    })

    if (!targetUser) {
      return { success: false, error: 'Target user not found' }
    }

    const token = generateImpersonationToken(adminId, adminName, targetUserId)

    logger.info(`[AdminImpersonation] Admin ${adminName} (${adminId}) started impersonating user ${targetUserId}`)

    await publishUserEvent(
      targetUserId,
      EVENT_TYPE_TOPIC['account.security'],
      'account.impersonation_started',
      {
        adminId,
        adminName,
        startedAt: new Date().toISOString(),
      }
    )

    return { success: true, token }
  } catch (error) {
    logger.error('[AdminImpersonation] Failed to start impersonation', {
      adminId,
      targetUserId,
      error: error instanceof Error ? error.message : String(error),
    })
    return { success: false, error: 'Failed to start impersonation' }
  }
}

export async function endImpersonation(
  sessionId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    logger.info(`[AdminImpersonation] Impersonation session ${sessionId} ended`)

    return { success: true }
  } catch (error) {
    logger.error('[AdminImpersonation] Failed to end impersonation', {
      sessionId,
      error: error instanceof Error ? error.message : String(error),
    })
    return { success: false, error: 'Failed to end impersonation' }
  }
}
