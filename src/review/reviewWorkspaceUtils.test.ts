import { describe, expect, it } from 'vitest'
import { fullReviewActionFor } from './reviewWorkspaceUtils'
import { MAX_REVIEW_PLIES } from './reviewPersistence'

describe('full review action', () => {
  it('waits for a local saved-review lookup instead of spending a duplicate engine pass', () => {
    expect(fullReviewActionFor({ engineBusy: false, reviewHydrating: true, hasReview: false }))
      .toEqual({ disabled: true, label: 'Review full game' })
  })

  it('keeps an explicit rerun available after a report is ready', () => {
    expect(fullReviewActionFor({ engineBusy: false, reviewHydrating: false, hasReview: true }))
      .toEqual({ disabled: false, label: 'Review again' })
    expect(fullReviewActionFor({ engineBusy: true, reviewHydrating: false, hasReview: true }))
      .toEqual({ disabled: true, label: 'Review again' })
  })

  it('keeps single-position browsing available while preventing an unbounded full review', () => {
    expect(fullReviewActionFor({
      engineBusy: false,
      reviewHydrating: false,
      hasReview: false,
      moveCount: MAX_REVIEW_PLIES,
    })).toEqual({ disabled: false, label: 'Review full game' })
    expect(fullReviewActionFor({
      engineBusy: false,
      reviewHydrating: false,
      hasReview: false,
      moveCount: MAX_REVIEW_PLIES + 1,
    })).toEqual({ disabled: true, label: 'Review full game' })
  })
})
