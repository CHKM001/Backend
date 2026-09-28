import {
  updateRiskMetadata,
  RiskMetadataValidationError,
} from '../../../src/config/riskMetadataAdmin'
import db from '../../../src/db'

jest.mock('../../../src/db', () => ({
  __esModule: true,
  default: {
    $transaction: jest.fn(),
  },
}))
jest.mock('../../../src/config/protocolRiskMetadata', () => ({
  refreshMetadataCache: jest.fn().mockResolvedValue(undefined),
}))

const mockDb = db as any

beforeEach(() => {
  jest.clearAllMocks()
})

describe('updateRiskMetadata', () => {
  it('requires sourceUrl to set dataConfidence to VERIFIED', async () => {
    await expect(
      updateRiskMetadata('Blend', { dataConfidence: 'VERIFIED' }, 'admin-1')
    ).rejects.toThrow(RiskMetadataValidationError)
  })

  it('accepts VERIFIED with a sourceUrl and writes a history row', async () => {
    mockDb.$transaction.mockImplementation(async (fn: any) =>
      fn({
        protocolRiskMetadataEntry: {
          update: jest.fn().mockResolvedValue({
            id: 'entry-1',
            protocolName: 'Blend',
            dataConfidence: 'VERIFIED',
            auditStatus: 'THIRD_PARTY_AUDITED',
            sourceUrl: 'https://audits.example/blend',
          }),
        },
        protocolRiskMetadataHistory: { create: jest.fn() },
      })
    )

    const result = await updateRiskMetadata(
      'Blend',
      { dataConfidence: 'VERIFIED', sourceUrl: 'https://audits.example/blend' },
      'admin-1'
    )

    expect(result.dataConfidence).toBe('VERIFIED')
  })

  it('allows a non-VERIFIED update without a sourceUrl', async () => {
    mockDb.$transaction.mockImplementation(async (fn: any) =>
      fn({
        protocolRiskMetadataEntry: {
          update: jest.fn().mockResolvedValue({
            id: 'entry-1',
            protocolName: 'Luma',
            dataConfidence: 'SELF_REPORTED',
          }),
        },
        protocolRiskMetadataHistory: { create: jest.fn() },
      })
    )

    await expect(
      updateRiskMetadata('Luma', { dataConfidence: 'SELF_REPORTED' }, 'admin-1')
    ).resolves.toMatchObject({ dataConfidence: 'SELF_REPORTED' })
  })
})
