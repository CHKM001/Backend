/**
 * Staleness check for ProtocolRiskMetadataEntry (#529). Flags entries past
 * their review-due date; optionally auto-downgrades dataConfidence toward
 * UNVERIFIED when config.protocolRisk.staleAutoDowngrade is set (default
 * off — flag-only, never silently alters a reviewed status).
 */
import db from '../db'
import { logger } from '../utils/logger'
import { config } from '../config/env'

export async function flagStaleEntries(
  now: Date = new Date()
): Promise<string[]> {
  const stale = await db.protocolRiskMetadataEntry.findMany({
    where: { nextReviewDueAt: { lt: now } },
    select: { protocolName: true, id: true },
  })

  if (stale.length === 0) return []

  logger.warn('[RiskMetadataStaleness] Entries past review-due date', {
    protocols: stale.map((s) => s.protocolName),
  })

  if (config.protocolRisk.staleAutoDowngrade) {
    await db.protocolRiskMetadataEntry.updateMany({
      where: { id: { in: stale.map((s) => s.id) } },
      data: { dataConfidence: 'UNVERIFIED' },
    })
  }

  return stale.map((s) => s.protocolName)
}
