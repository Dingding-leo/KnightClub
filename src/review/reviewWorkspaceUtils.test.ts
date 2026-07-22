import { describe, expect, it } from 'vitest'
import { fullReviewActionFor } from './reviewWorkspaceUtils'

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
})
