import type { PersistedReview } from './reviewPersistence'

interface BackgroundReviewSave {
  save: (review: PersistedReview) => Promise<void>
  record: PersistedReview
  isCurrent: () => boolean
  onSaved: (review: PersistedReview) => void
  onFailed: (error: unknown) => void
}

/**
 * Keep storage latency off the critical path to the finished review. The
 * caller deliberately does not await this task, while the current-run check
 * prevents a late completion from changing a newer workspace.
 */
export async function saveCompletedReviewInBackground({
  save,
  record,
  isCurrent,
  onSaved,
  onFailed,
}: BackgroundReviewSave): Promise<void> {
  try {
    await save(record)
  } catch (error) {
    if (isCurrent()) {
      // This task is intentionally detached from the review flow. A consumer
      // callback must not turn a completed save into an unhandled promise.
      try {
        onFailed(error)
      } catch {
        // The completed review remains visible even if an optional UI callback fails.
      }
    }
    return
  }
  if (isCurrent()) {
    try {
      onSaved(record)
    } catch {
      // The write already succeeded; keep this detached notification harmless.
    }
  }
}
