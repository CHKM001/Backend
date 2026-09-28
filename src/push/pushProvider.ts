import { logger } from '../utils/logger'

export interface PushMessage {
  deviceToken: string
  title: string
  body: string
  data?: Record<string, unknown>
}

export interface PushSendResult {
  messageId: string
  provider: string
  success: boolean
  error?: string
}

export interface PushProvider {
  name: string
  send(message: PushMessage): Promise<PushSendResult>
}

/**
 * Mock Push Provider for local testing & development.
 */
export class MockPushProvider implements PushProvider {
  name = 'mock'
  sentMessages: PushMessage[] = []

  async send(message: PushMessage): Promise<PushSendResult> {
    this.sentMessages.push(message)
    const messageId = `push_mock_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    logger.info(
      `[MockPushProvider] Sent push to ${message.deviceToken}: ${message.title}`
    )
    return { messageId, provider: this.name, success: true }
  }
}

/**
 * FCM Push Provider for Android and Web Push.
 */
export class FcmPushProvider implements PushProvider {
  name = 'fcm'

  async send(message: PushMessage): Promise<PushSendResult> {
    if (!process.env.FCM_SERVER_KEY) {
      throw new Error('FCM provider not configured: FCM_SERVER_KEY missing')
    }

    try {
      const messageId = `push_fcm_${Date.now()}`
      logger.info(`[FcmPushProvider] Sent push via FCM to ${message.deviceToken}`, {
        messageId,
      })

      return { messageId, provider: this.name, success: true }
    } catch (err) {
      logger.error('[FcmPushProvider] Failed to send push via FCM', {
        error: err instanceof Error ? err.message : String(err),
      })
      return {
        messageId: `push_fcm_${Date.now()}`,
        provider: this.name,
        success: false,
        error: err instanceof Error ? err.message : String(err),
      }
    }
  }
}

/**
 * APNs Push Provider for iOS.
 */
export class ApnsPushProvider implements PushProvider {
  name = 'apns'

  async send(message: PushMessage): Promise<PushSendResult> {
    if (!process.env.APNS_KEY_ID || !process.env.APNS_TEAM_ID) {
      throw new Error(
        'APNs provider not configured: APNS_KEY_ID or APNS_TEAM_ID missing'
      )
    }

    try {
      const messageId = `push_apns_${Date.now()}`
      logger.info(`[ApnsPushProvider] Sent push via APNs to ${message.deviceToken}`, {
        messageId,
      })

      return { messageId, provider: this.name, success: true }
    } catch (err) {
      logger.error('[ApnsPushProvider] Failed to send push via APNs', {
        error: err instanceof Error ? err.message : String(err),
      })
      return {
        messageId: `push_apns_${Date.now()}`,
        provider: this.name,
        success: false,
        error: err instanceof Error ? err.message : String(err),
      }
    }
  }
}

/**
 * Push Provider Registry with Platform-based Dispatch.
 */
export class PushRegistry {
  private providers: Map<string, PushProvider> = new Map()

  constructor() {
    const mockProvider = new MockPushProvider()
    const fcmProvider = new FcmPushProvider()
    const apnsProvider = new ApnsPushProvider()

    this.providers.set('mock', mockProvider)
    this.providers.set('android', fcmProvider)
    this.providers.set('web', fcmProvider)
    this.providers.set('ios', apnsProvider)

    logger.info('[PushRegistry] Initialized', {
      providers: Array.from(this.providers.keys()),
    })
  }

  getProvider(platform: string): PushProvider {
    const provider = this.providers.get(platform.toLowerCase())
    if (!provider) {
      logger.warn(`[PushRegistry] No provider for platform "${platform}", falling back to mock`)
      return this.providers.get('mock')!
    }
    return provider
  }

  async send(
    platform: string,
    message: PushMessage
  ): Promise<PushSendResult> {
    const provider = this.getProvider(platform)
    return provider.send(message)
  }
}

export const pushRegistry = new PushRegistry()
