/**
 * Keep the personal-training picker responsive when a player has accumulated
 * hundreds of review moments. The caller keeps the canonical queue order;
 * this helper only limits how many buttons need to mount at once.
 */
export const RETRY_QUEUE_PAGE_SIZE = 24

export interface ProgressiveRetryQueue<T> {
  items: readonly T[]
  shownCount: number
  totalCount: number
  remainingCount: number
}

interface RetryQueueIdentity {
  retryKey: string
}

function boundedRevealCount(revealCount: number, totalCount: number): number {
  const requested = Number.isFinite(revealCount) ? Math.trunc(revealCount) : 0
  return Math.max(0, Math.min(totalCount, requested))
}

/**
 * Returns the first progressively revealed queue items, while reserving a
 * visible slot for the active/requested item even when it sits much later in
 * the sorted queue. The returned collection still follows the original queue
 * order, so pinning a Review deep link never changes scheduling order.
 */
export function progressiveRetryQueue<T extends RetryQueueIdentity>(
  queue: readonly T[],
  revealCount: number,
  pinnedKeys: Iterable<string | null | undefined> = [],
): ProgressiveRetryQueue<T> {
  const totalCount = queue.length
  const pinned = new Set<string>()
  for (const key of pinnedKeys) {
    if (typeof key === 'string' && key) pinned.add(key)
  }

  const pinnedItems = queue.filter((item) => pinned.has(item.retryKey))
  const targetCount = Math.max(
    boundedRevealCount(revealCount, totalCount),
    pinnedItems.length,
  )
  const selected = new Set(pinnedItems.map((item) => item.retryKey))

  for (const item of queue) {
    if (selected.size >= targetCount) break
    selected.add(item.retryKey)
  }

  const items = queue.filter((item) => selected.has(item.retryKey))
  return {
    items,
    shownCount: items.length,
    totalCount,
    remainingCount: totalCount - items.length,
  }
}

export function revealMoreRetryQueueItems(revealCount: number, totalCount: number): number {
  const boundedTotal = Math.max(0, Math.trunc(totalCount))
  return Math.min(
    boundedTotal,
    boundedRevealCount(revealCount, boundedTotal) + RETRY_QUEUE_PAGE_SIZE,
  )
}
