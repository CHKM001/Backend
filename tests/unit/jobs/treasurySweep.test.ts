import {
  evaluateTreasuryBalances,
  executeSweep,
  executeEmergencySweep,
  validateHysteresis,
} from '../../../src/jobs/treasurySweep'
import db from '../../../src/db'
import { getAccount } from '../../../src/stellar/client'
import { enqueueOutboxOp } from '../../../src/outbox/service'

jest.mock('../../../src/db', () => ({
  __esModule: true,
  default: {
    treasuryAccount: { findMany: jest.fn() },
    treasurySweepPolicy: { findFirst: jest.fn() },
    treasurySweep: { create: jest.fn(), update: jest.fn() },
    multisigEnvelope: { create: jest.fn() },
    adminAuditLog: { create: jest.fn() },
  },
}))
jest.mock('../../../src/stellar/client', () => ({
  getAccount: jest.fn(),
}))
jest.mock('../../../src/outbox/service', () => ({
  enqueueOutboxOp: jest.fn(),
}))
jest.mock('../../../src/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}))

const mockDb = db as any
const mockGetAccount = getAccount as jest.Mock
const mockEnqueue = enqueueOutboxOp as jest.Mock

beforeEach(() => {
  jest.clearAllMocks()
})

describe('validateHysteresis', () => {
  it('accepts targetHigh at least 1.5x targetLow', () => {
    expect(validateHysteresis(1000, 1500)).toBe(true)
  })

  it('rejects targetHigh under the hysteresis factor', () => {
    expect(validateHysteresis(1000, 1200)).toBe(false)
  })
})

describe('evaluateTreasuryBalances', () => {
  it('plans a sweep when hot balance exceeds policy maxHotBalance by more than minSweepAmount', async () => {
    mockDb.treasurySweepPolicy.findFirst.mockImplementation(
      ({ where }: any) => {
        if (where.fromTier === 'HOT' && where.toTier === 'WARM') {
          return Promise.resolve({
            fromTier: 'HOT',
            toTier: 'WARM',
            maxHotBalance: '5000',
            minSweepAmount: '10',
            requiresApprovalAbove: null,
            isActive: true,
          })
        }
        return Promise.resolve(null)
      }
    )
    mockDb.treasuryAccount.findMany.mockImplementation(({ where }: any) => {
      if (where.tier === 'HOT') {
        return Promise.resolve([{ id: 'hot-1', publicKey: 'GHOT' }])
      }
      return Promise.resolve([])
    })
    mockGetAccount.mockResolvedValue({
      balances: [{ asset_type: 'native', balance: '8000' }],
    })

    const plans = await evaluateTreasuryBalances()

    expect(plans).toHaveLength(1)
    expect(plans[0]).toMatchObject({
      fromTier: 'HOT',
      toTier: 'WARM',
      reason: 'hot_over_high_band',
    })
  })

  it('produces no plan when no active policy exists for a tier pair', async () => {
    mockDb.treasurySweepPolicy.findFirst.mockResolvedValue(null)
    mockDb.treasuryAccount.findMany.mockResolvedValue([
      { id: 'hot-1', publicKey: 'GHOT' },
    ])

    const plans = await evaluateTreasuryBalances()

    expect(plans).toEqual([])
  })
})

describe('executeSweep', () => {
  it('enqueues a TREASURY_SWEEP outbox op when no approval threshold applies', async () => {
    mockDb.treasurySweepPolicy.findFirst.mockResolvedValue({
      fromTier: 'HOT',
      toTier: 'WARM',
      requiresApprovalAbove: null,
    })
    mockDb.treasurySweep.create.mockResolvedValue({ id: 'sweep-1' })
    mockDb.treasurySweep.update.mockResolvedValue({})
    mockEnqueue.mockResolvedValue({ id: 'op-1' })

    await executeSweep({
      fromTier: 'HOT',
      toTier: 'WARM',
      asset: 'XLM',
      amount: '1000',
      reason: 'hot_over_high_band',
    })

    expect(mockEnqueue).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        kind: 'TREASURY_SWEEP',
        payload: expect.objectContaining({ method: 'treasury_sweep' }),
      })
    )
    expect(mockDb.treasurySweep.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'sweep-1' },
        data: expect.objectContaining({ status: 'SUBMITTED' }),
      })
    )
  })

  it('opens a MultisigEnvelope instead of enqueueing when amount exceeds requiresApprovalAbove', async () => {
    mockDb.treasurySweepPolicy.findFirst.mockResolvedValue({
      fromTier: 'HOT',
      toTier: 'WARM',
      requiresApprovalAbove: '500',
    })
    mockDb.treasurySweep.create.mockResolvedValue({ id: 'sweep-2' })
    mockDb.multisigEnvelope.create.mockResolvedValue({ id: 'env-1' })

    await executeSweep({
      fromTier: 'HOT',
      toTier: 'WARM',
      asset: 'XLM',
      amount: '1000',
      reason: 'hot_over_high_band',
    })

    expect(mockDb.multisigEnvelope.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          sweepId: 'sweep-2',
          status: 'PENDING',
        }),
      })
    )
    expect(mockEnqueue).not.toHaveBeenCalled()
  })
})

describe('executeEmergencySweep', () => {
  it('enqueues without checking any policy requiresApprovalAbove', async () => {
    mockDb.treasurySweep.create.mockResolvedValue({ id: 'sweep-3' })
    mockDb.treasurySweep.update.mockResolvedValue({})
    mockEnqueue.mockResolvedValue({ id: 'op-2' })

    await executeEmergencySweep(
      'HOT',
      'COLD',
      'XLM',
      '1000000',
      'admin-1',
      'circuit_breaker_trip'
    )

    expect(mockDb.treasurySweepPolicy.findFirst).not.toHaveBeenCalled()
    expect(mockEnqueue).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ kind: 'TREASURY_SWEEP', priority: 'CRITICAL' })
    )
  })

  it('writes a distinct AdminAuditLog row', async () => {
    mockDb.treasurySweep.create.mockResolvedValue({ id: 'sweep-4' })
    mockDb.treasurySweep.update.mockResolvedValue({})
    mockEnqueue.mockResolvedValue({ id: 'op-3' })

    await executeEmergencySweep(
      'WARM',
      'COLD',
      'XLM',
      '500',
      'admin-1',
      'manual_admin_action'
    )

    expect(mockDb.adminAuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'treasury.emergency_sweep' }),
      })
    )
  })
})
