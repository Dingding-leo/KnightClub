import type { ReviewProgress } from './gameReviewRunner'

/**
 * Full Review publishes two visual progress updates for most plies. Keep the
 * bar continuous, but give assistive technology useful five-percent milestones
 * instead of a queue of thousands of stale polite announcements.
 */
export function reviewProgressAnnouncement(progress: ReviewProgress): string {
  const total = Math.max(1, progress.totalPly)
  if (progress.completedPly <= 0) return 'Full-game review started.'
  if (progress.completedPly >= total) return 'Full-game review complete.'
  const rawPercent = Math.max(0, Math.min(100, 100 * progress.completedPly / total))
  const milestone = Math.floor(rawPercent / 5) * 5
  if (milestone === 0) return 'Full-game review started.'
  return `Full-game review ${milestone}% complete.`
}
