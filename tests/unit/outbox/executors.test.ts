/**
 * Executor coverage for the treasury sweep payload (#528). The outbox is the
 * single choke point for on-chain money movement (see structural.test.ts) —
 * this pins that a treasury_sweep payload actually resolves a signer and
 * submits, rather than silently falling through the switch.
 */
import { resolveSignerPublicKey } from '../../../src/outbox/executors'

jest.mock('../../../src/db', () => ({
  __esModule: true,
  default: {
    treasuryAccount: { findFirst: jest.fn() },
    reserveSponsorship: { create: jest.fn(), updateMany: jest.fn() },
  },
}))

import db from '../../../src/db'

describe('resolveSignerPublicKey — treasury_sweep', () => {
  it('resolves to the fromTier account public key', async () => {
    ;(db.treasuryAccount.findFirst as jest.Mock).mockResolvedValue({
      publicKey: 'GHOTACCOUNT',
    })

    const key = await resolveSignerPublicKey(
      {
        method: 'treasury_sweep',
        fromTier: 'HOT',
        toTier: 'WARM',
        asset: 'XLM',
        amount: 100,
        sweepId: 'sweep-1',
      } as any,
      'SYSTEM'
    )

    expect(key).toBe('GHOTACCOUNT')
    expect(db.treasuryAccount.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tier: 'HOT', isActive: true } })
const mockDepositForUser = jest.fn() as jest.Mock
const mockWithdrawForUser = jest.fn() as jest.Mock
const mockTriggerRebalance = jest.fn() as jest.Mock
const mockPayReferralReward = jest.fn() as jest.Mock

jest.mock('../../../src/stellar/contract', () => ({
  depositForUser: (...args: any[]) => mockDepositForUser(...args),
  withdrawForUser: (...args: any[]) => mockWithdrawForUser(...args),
  triggerRebalance: (...args: any[]) => mockTriggerRebalance(...args),
  payReferralReward: (...args: any[]) => mockPayReferralReward(...args),
}))

jest.mock('../../../src/stellar/wallet', () => ({
  getWalletByUserId: jest.fn(),
}))

jest.mock('../../../src/stellar/client', () => ({
  getAgentKeypair: () => ({ publicKey: () => 'GAGENT' }),
}))

import { executeOutboxPayload } from '../../../src/outbox/executors'

const onSubmitted = jest.fn().mockResolvedValue(undefined)

beforeEach(() => {
  jest.clearAllMocks()
})

describe('executeOutboxPayload', () => {
  it('forwards the persistence callback to deposit submission', async () => {
    mockDepositForUser.mockResolvedValue({
      hash: 'deposit-hash',
      status: 'success',
    })

    await executeOutboxPayload(
      {
        method: 'deposit',
        userId: 'user-1',
        userAddress: 'GUSER',
        amount: 10,
        assetSymbol: 'USDC',
        transactionId: 'transaction-1',
      },
      2,
      onSubmitted
    )

    expect(mockDepositForUser).toHaveBeenCalledWith(
      'user-1',
      'GUSER',
      10,
      'USDC',
      2,
      onSubmitted
    )
  })

  it('forwards the persistence callback to withdrawal submission', async () => {
    mockWithdrawForUser.mockResolvedValue({
      hash: 'withdraw-hash',
      status: 'success',
    })

    await executeOutboxPayload(
      {
        method: 'withdraw',
        userId: 'user-1',
        userAddress: 'GUSER',
        amount: 10,
        assetSymbol: 'USDC',
        transactionId: 'transaction-1',
      },
      1,
      onSubmitted
    )

    expect(mockWithdrawForUser).toHaveBeenCalledWith(
      'user-1',
      'GUSER',
      10,
      'USDC',
      1,
      onSubmitted
    )
  })

  it('forwards the persistence callback to rebalance submission', async () => {
    mockTriggerRebalance.mockResolvedValue({
      hash: 'rebalance-hash',
      status: 'success',
    })

    await executeOutboxPayload(
      {
        method: 'rebalance',
        toProtocol: 'Blend',
        expectedApyBasisPoints: 500,
        transactionId: 'transaction-1',
      },
      1,
      onSubmitted
    )

    expect(mockTriggerRebalance).toHaveBeenCalledWith(
      'Blend',
      500,
      1,
      onSubmitted
    )
  })

  it('forwards the persistence callback to referral reward submission', async () => {
    mockPayReferralReward.mockResolvedValue({
      hash: 'reward-hash',
      status: 'success',
    })

    await executeOutboxPayload(
      {
        method: 'referral_reward',
        transactionId: 'transaction-1',
        recipientAddress: 'GUSER',
        amount: 10,
        assetSymbol: 'USDC',
        conversionId: 'conversion-1',
        leg: 'owner',
      },
      1,
      onSubmitted
    )

    expect(mockPayReferralReward).toHaveBeenCalledWith(
      'GUSER',
      10,
      'USDC',
      1,
      onSubmitted
    )
  })
})
