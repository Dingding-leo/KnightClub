import type { GameReview } from './gameReviewRunner'
import type {
  PersistedReview,
  PersistedReviewPreparationExpectation,
} from './reviewPersistence'

export interface ReviewPersistencePreparationInput {
  sourcePgn: string
  expected: PersistedReviewPreparationExpectation
  report: GameReview
}

export interface PrepareReviewPersistenceRequest extends ReviewPersistencePreparationInput {
  type: 'prepare-review-save'
  id: number
}

export interface ReviewPersistenceResult {
  type: 'review-persistence-result'
  id: number
  record: PersistedReview
}

export interface ReviewPersistenceError {
  type: 'error'
  id: number
  message: string
}

export type ReviewPersistenceRequest = PrepareReviewPersistenceRequest
export type ReviewPersistenceResponse = ReviewPersistenceResult | ReviewPersistenceError
