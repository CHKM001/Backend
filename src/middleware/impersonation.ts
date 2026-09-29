import type { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import crypto from 'node:crypto'
import db from '../db'
import { logger } from '../utils/logger'

const IMPERSONATION_TTL_MINUTES = 30
const IMPERSONATION_SECRET = process.env.IMPERSONATION_SECRET || 'impersonation-secret'

export interface ImpersonationContext {
  adminId: string
  adminName: string
  targetUserId: string
  sessionId: string
  createdAt: Date
  expiresAt: Date
}

/**
 * Generate an impersonation token for a target user.
 */
export function generateImpersonationToken(
  adminId: string,
  adminName: string,
  targetUserId: string
): string {
  const sessionId = crypto.randomUUID()
  const createdAt = new Date()
  const expiresAt = new Date(createdAt.getTime() + IMPERSONATION_TTL_MINUTES * 60 * 1000)

  const payload: ImpersonationContext = {
    adminId,
    adminName,
    targetUserId,
    sessionId,
    createdAt,
    expiresAt,
  }

  return jwt.sign(payload, IMPERSONATION_SECRET, {
    expiresIn: `${IMPERSONATION_TTL_MINUTES}m`,
  })
}

/**
 * Verify and decode an impersonation token.
 */
export function verifyImpersonationToken(
  token: string
): ImpersonationContext | null {
  try {
    const decoded = jwt.verify(token, IMPERSONATION_SECRET) as ImpersonationContext

    if (new Date() > new Date(decoded.expiresAt)) {
      return null
    }

    return decoded
  } catch (error) {
    logger.warn('[Impersonation] Failed to verify impersonation token', {
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}

/**
 * Middleware to check if the current request is an impersonation session
 * and reject write operations.
 */
export function requireNotImpersonation(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const authHeader = req.headers.authorization
  if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7).trim()
    const impersonationContext = verifyImpersonationToken(token)

    if (impersonationContext) {
      res.status(403).json({
        success: false,
        error: 'Write operations are not allowed during impersonation sessions',
      })
      return
    }
  }

  next()
}

/**
 * Middleware to extract impersonation context from request.
 */
export function extractImpersonationContext(
  req: Request
): ImpersonationContext | null {
  const authHeader = req.headers.authorization
  if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7).trim()
    return verifyImpersonationToken(token)
  }
  return null
}
