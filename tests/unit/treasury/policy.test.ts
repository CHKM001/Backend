import {
  validatePolicyInput,
  TreasuryPolicyValidationError,
} from '../../../src/treasury/policy'

describe('validatePolicyInput', () => {
  const base = {
    fromTier: 'HOT' as const,
    toTier: 'WARM' as const,
    maxHotBalance: '10000',
    sweepIntervalMinutes: 60,
    minSweepAmount: '10',
    requiresApprovalAbove: '5000',
  }

  it('accepts a sane policy', () => {
    expect(() => validatePolicyInput(base)).not.toThrow()
  })

  it('rejects sweepIntervalMinutes <= 0', () => {
    expect(() =>
      validatePolicyInput({ ...base, sweepIntervalMinutes: 0 })
    ).toThrow(TreasuryPolicyValidationError)
  })

  it('rejects minSweepAmount >= maxHotBalance', () => {
    expect(() =>
      validatePolicyInput({ ...base, minSweepAmount: '10000' })
    ).toThrow(TreasuryPolicyValidationError)
  })

  it('rejects fromTier === toTier', () => {
    expect(() => validatePolicyInput({ ...base, toTier: 'HOT' })).toThrow(
      TreasuryPolicyValidationError
    )
  })

  it('rejects requiresApprovalAbove greater than maxHotBalance', () => {
    expect(() =>
      validatePolicyInput({ ...base, requiresApprovalAbove: '99999' })
    ).toThrow(TreasuryPolicyValidationError)
  })
})
