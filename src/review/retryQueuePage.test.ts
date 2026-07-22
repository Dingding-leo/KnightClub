import { describe, expect, it } from 'vitest'
import {
  progressiveRetryQueue,
  RETRY_QUEUE_PAGE_SIZE,
  revealMoreRetryQueueItems,
} from './retryQueuePage'

describe('progressive retry queue', () => {
  it('keeps sorted queue order while reserving a first-page slot for a requested item', () => {
    const queue = Array.from({ length: 30 }, (_, index) => ({ retryKey: `retry-${index + 1}` }))

    const page = progressiveRetryQueue(queue, RETRY_QUEUE_PAGE_SIZE, ['retry-30'])

    expect(page.items.map((item) => item.retryKey)).toEqual([
      ...queue.slice(0, 23).map((item) => item.retryKey),
      'retry-30',
    ])
    expect(page.shownCount).toBe(RETRY_QUEUE_PAGE_SIZE)
    expect(page.totalCount).toBe(30)
    expect(page.remainingCount).toBe(6)
  })

  it('reveals another 24 canonical slots without dropping an active selection', () => {
    const queue = Array.from({ length: 60 }, (_, index) => ({ retryKey: `retry-${index + 1}` }))
    const firstPage = progressiveRetryQueue(queue, RETRY_QUEUE_PAGE_SIZE, ['retry-60'])
    const nextRevealCount = revealMoreRetryQueueItems(RETRY_QUEUE_PAGE_SIZE, queue.length)
    const nextPage = progressiveRetryQueue(queue, nextRevealCount, ['retry-60'])

    expect(nextRevealCount).toBe(48)
    expect(firstPage.items).toHaveLength(24)
    expect(nextPage.items).toHaveLength(48)
    expect(nextPage.items.map((item) => item.retryKey)).toEqual([
      ...queue.slice(0, 47).map((item) => item.retryKey),
      'retry-60',
    ])
    expect(nextPage.remainingCount).toBe(12)
  })
})
