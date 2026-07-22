import type { Square } from 'chess.js'
import type { CoachGuidance } from './coach'
import type { ReviewedMove } from './reviewModel'

export function evidenceSquaresForGuidance(guidance: CoachGuidance | null): Set<Square> {
  return new Set(guidance?.evidence.flatMap((item) => item.squares) ?? [])
}

/**
 * Coach evidence may be calculated from a deferred cursor value so board and
 * notation navigation can paint first. Never display the previous position's
 * evidence while that deferred calculation catches up, including after a
 * restored report replaces a same-ply move record.
 */
export function visibleCoachGuidance(
  selectedMove: ReviewedMove | null,
  guidanceMove: ReviewedMove | null,
  guidance: CoachGuidance | null,
): CoachGuidance | null {
  return selectedMove !== null && selectedMove === guidanceMove ? guidance : null
}

export interface FullReviewAction {
  disabled: boolean
  label: 'Review full game' | 'Review again'
}

/**
 * A saved-review lookup is deliberately allowed to settle before a player
 * spends another full local engine pass. Once a report is visible, rerunning
 * remains an explicit option rather than an ambiguous duplicate action.
 */
export function fullReviewActionFor(input: {
  engineBusy: boolean
  reviewHydrating: boolean
  hasReview: boolean
}): FullReviewAction {
  return {
    disabled: input.engineBusy || input.reviewHydrating,
    label: input.hasReview ? 'Review again' : 'Review full game',
  }
}

export type ReviewNavigationAction = 'first' | 'previous' | 'next' | 'last'

export function reviewNavigationForKey(input: {
  key: string
  editable?: boolean
  metaKey?: boolean
  ctrlKey?: boolean
  altKey?: boolean
  shiftKey?: boolean
}): ReviewNavigationAction | null {
  if (input.editable || input.metaKey || input.ctrlKey || input.altKey || input.shiftKey) return null
  if (input.key === 'ArrowLeft') return 'previous'
  if (input.key === 'ArrowRight') return 'next'
  if (input.key === 'Home') return 'first'
  if (input.key === 'End') return 'last'
  return null
}

export function reviewPlyAfter(action: ReviewNavigationAction, currentPly: number, maxPly: number): number {
  if (action === 'first') return 0
  if (action === 'last') return maxPly
  if (action === 'previous') return Math.max(0, currentPly - 1)
  return Math.min(maxPly, currentPly + 1)
}
