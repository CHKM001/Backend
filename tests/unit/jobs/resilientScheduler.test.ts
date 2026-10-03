jest.mock('../../../src/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}))

jest.mock('../../../src/utils/job-metrics', () => ({
  recordJobCompletion: jest.fn(),
  recordJobRetry: jest.fn(),
}))

import {
  runJobWithRetry,
  scheduleResilientJob,
} from '../../../src/jobs/resilientScheduler'
import {
  recordJobCompletion,
  recordJobRetry,
} from '../../../src/utils/job-metrics'

const completion = recordJobCompletion as jest.Mock
const retry = recordJobRetry as jest.Mock

describe('runJobWithRetry', () => {
  const sleep = jest.fn().mockResolvedValue(undefined)

  beforeEach(() => {
    sleep.mockClear()
    completion.mockClear()
    retry.mockClear()
  })

  it('records success without a retry when the task resolves', async () => {
    const task = jest.fn().mockResolvedValue(undefined)

    await expect(
      runJobWithRetry('session_cleanup', task, { sleep })
    ).resolves.toBe('success')

    expect(task).toHaveBeenCalledTimes(1)
    expect(sleep).not.toHaveBeenCalled()
    expect(retry).not.toHaveBeenCalled()
    expect(completion).toHaveBeenCalledWith('session_cleanup', 'success')
  })

  it('resumes a failed task with full-jitter backoff until it succeeds', async () => {
    const task = jest
      .fn()
      .mockRejectedValueOnce(new Error('db down'))
      .mockRejectedValueOnce(new Error('db down'))
      .mockResolvedValueOnce(undefined)

    await expect(
      runJobWithRetry('retention_all_jobs', task, {
        sleep,
        random: () => 1,
        maxAttempts: 3,
        baseDelayMs: 1000,
        maxDelayMs: 30_000,
      })
    ).resolves.toBe('success')

    expect(task).toHaveBeenCalledTimes(3)
    expect(retry).toHaveBeenCalledTimes(2)
    expect(sleep).toHaveBeenNthCalledWith(1, 1000)
    expect(sleep).toHaveBeenNthCalledWith(2, 2000)
    expect(completion).toHaveBeenCalledTimes(1)
    expect(completion).toHaveBeenCalledWith('retention_all_jobs', 'success')
  })

  it('records a failed completion after retries are exhausted', async () => {
    const task = jest.fn().mockRejectedValue(new Error('still down'))
    const onExhausted = jest.fn()

    await expect(
      runJobWithRetry('portfolio_risk', task, {
        sleep,
        random: () => 0,
        maxAttempts: 3,
        onExhausted,
      })
    ).resolves.toBe('failed')

    expect(task).toHaveBeenCalledTimes(3)
    expect(retry).toHaveBeenCalledTimes(2)
    expect(sleep).toHaveBeenCalledTimes(2)
    expect(completion).toHaveBeenCalledWith('portfolio_risk', 'failed')
    expect(onExhausted).toHaveBeenCalledWith(expect.any(Error), 3)
  })

  it('keeps a failed exhaustion hook from rejecting the run', async () => {
    const task = jest.fn().mockRejectedValue(new Error('down'))

    await expect(
      runJobWithRetry('fiat_reconciliation', task, {
        sleep,
        maxAttempts: 1,
        onExhausted: () => {
          throw new Error('pager down')
        },
      })
    ).resolves.toBe('failed')
  })
})

describe('scheduleResilientJob', () => {
  afterEach(() => {
    jest.useRealTimers()
  })

  it('resumes a tick that arrived while a run was still in flight', async () => {
    jest.useFakeTimers()
    let release: () => void = () => undefined
    let calls = 0
    const task = () => {
      calls += 1
      if (calls === 1) {
        return new Promise<void>((resolve) => {
          release = resolve
        })
      }
      return Promise.resolve()
    }

    const handle = scheduleResilientJob({
      jobName: 'overlap-job',
      task,
      intervalMs: 1000,
      sleep: async () => undefined,
    })

    await Promise.resolve()
    expect(calls).toBe(1)

    jest.advanceTimersByTime(1000)
    await Promise.resolve()
    expect(calls).toBe(1)

    release()
    for (let i = 0; i < 10; i++) await Promise.resolve()

    expect(calls).toBe(2)
    clearInterval(handle)
  })

  it('does not tight-loop after retries are exhausted', async () => {
    jest.useFakeTimers()
    let rejectRun: (error: Error) => void = () => undefined
    let calls = 0
    const task = () => {
      calls += 1
      return new Promise<void>((_resolve, reject) => {
        rejectRun = reject
      })
    }

    const handle = scheduleResilientJob({
      jobName: 'exhausted-job',
      task,
      intervalMs: 1000,
      maxAttempts: 1,
      sleep: async () => undefined,
    })

    await Promise.resolve()
    expect(calls).toBe(1)

    jest.advanceTimersByTime(1000)
    await Promise.resolve()
    rejectRun(new Error('nope'))
    for (let i = 0; i < 10; i++) await Promise.resolve()

    expect(calls).toBe(1)
    clearInterval(handle)
  })
})
