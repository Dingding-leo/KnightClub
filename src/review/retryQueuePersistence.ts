import type { RetryItem } from './retry'

interface RetryStore {
  load: (retryKey: string) => Promise<RetryItem | null>
  save: (item: RetryItem) => Promise<void>
}

interface SaveRetryItemsSeriallyOptions {
  items: RetryItem[]
  retryStore: RetryStore
  onRetriesSaved?: (items: RetryItem[]) => void
  onOpenRetryQueue?: (retryKey: string) => void
}

export interface RetrySaveResult {
  saved: RetryItem[]
  error: unknown | null
}

/**
 * Keeps the review-to-Train handoff FIFO: every item is checked and saved in
 * order, completed items are published immediately, and Train opens only
 * after the entire batch has reached durable storage.
 */
export async function saveRetryItemsSerially({
  items,
  retryStore,
  onRetriesSaved,
  onOpenRetryQueue,
}: SaveRetryItemsSeriallyOptions): Promise<RetrySaveResult> {
  const saved: RetryItem[] = []
  try {
    for (const item of items) {
      const existing = await retryStore.load(item.retryKey)
      const retained = existing ?? item
      if (!existing) {
        await retryStore.save(item)
      }
      saved.push(retained)
      // Preserve each completed write in the visible queue. A later item can
      // fail independently without making an earlier saved practice moment
      // disappear from Train until a reload.
      onRetriesSaved?.([retained])
    }
    if (saved.length) onOpenRetryQueue?.(saved[0]!.retryKey)
    return { saved, error: null }
  } catch (error) {
    return { saved, error }
  }
}
