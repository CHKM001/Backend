/**
 * Admin CRUD for ProtocolRiskMetadataEntry (#529). sourceUrl is required for
 * any upgrade to dataConfidence: VERIFIED — a claim is only checkable if it
 * points somewhere. Every update writes an append-only
 * ProtocolRiskMetadataHistory row so a disputed status change is auditable.
 */
import { DataConfidence, AuditStatus } from '@prisma/client'
import db from '../db'
import { refreshMetadataCache } from './protocolRiskMetadata'

export class RiskMetadataValidationError extends Error {}

export interface UpdateRiskMetadataInput {
  auditStatus?: AuditStatus
  auditReference?: string
  sourceUrl?: string
  dataConfidence?: DataConfidence
  nextReviewDueAt?: Date
}

export async function updateRiskMetadata(
  protocolName: string,
  input: UpdateRiskMetadataInput,
  adminName: string
): Promise<{ protocolName: string; dataConfidence: DataConfidence }> {
  if (input.dataConfidence === 'VERIFIED' && !input.sourceUrl) {
    throw new RiskMetadataValidationError(
      'sourceUrl is required to set dataConfidence to VERIFIED'
    )
  }

  const result = await db.$transaction(async (tx) => {
    const updated = await tx.protocolRiskMetadataEntry.update({
      where: { protocolName },
      data: {
        ...input,
        reviewedAt: new Date(),
        reviewedBy: adminName,
      },
    })
    await tx.protocolRiskMetadataHistory.create({
      data: {
        entryId: updated.id,
        auditStatus: updated.auditStatus,
        dataConfidence: updated.dataConfidence,
        sourceUrl: updated.sourceUrl,
        changedBy: adminName,
      },
    })
    return updated
  })

  await refreshMetadataCache()

  return result
}
