import { flagStaleEntries } from '../../../src/jobs/riskMetadataStaleness'
import db from '../../../src/db'

jest.mock('../../../src/db', () => ({
  __esModule: true,
  default: {
    protocolRiskMetadataEntry: {
      findMany: jest.fn(),
      updateMany: jest.fn(),
    },
  },
}))
jest.mock('../../../src/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}))
jest.mock('../../../src/config/env', () => ({
  config: { protocolRisk: { staleAutoDowngrade: false } },
}))

const mockDb = db as any

beforeEach(() => {
  jest.clearAllMocks()
})

describe('flagStaleEntries', () => {
  it('returns protocol names past nextReviewDueAt', async () => {
    mockDb.protocolRiskMetadataEntry.findMany.mockResolvedValue([
      {
        id: 'e1',
        protocolName: 'Blend',
        nextReviewDueAt: new Date('2020-01-01'),
      },
    ])

    const stale = await flagStaleEntries(new Date('2026-01-01'))

    expect(stale).toEqual(['Blend'])
    expect(mockDb.protocolRiskMetadataEntry.updateMany).not.toHaveBeenCalled()
  })

  it('returns an empty array when nothing is stale', async () => {
    mockDb.protocolRiskMetadataEntry.findMany.mockResolvedValue([])

    const stale = await flagStaleEntries(new Date('2026-01-01'))

    expect(stale).toEqual([])
  })
})
