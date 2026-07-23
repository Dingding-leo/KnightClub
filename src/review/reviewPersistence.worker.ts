/// <reference lib="webworker" />

import { createPgnTimeline } from '../analysis/analysisModel'
import {
  createPersistedReviewFromCanonicalTimeline,
  isReviewKey,
} from './reviewPersistence'
import type {
  ReviewPersistenceRequest,
  ReviewPersistenceResponse,
} from './reviewPersistenceProtocol'

const workerScope = self as DedicatedWorkerGlobalScope

function prepareReviewSave(request: ReviewPersistenceRequest) {
  const { expected } = request
  if (!isReviewKey(expected.reviewKey)) throw new Error('Review key is invalid.')
  if (typeof request.sourcePgn !== 'string' || typeof expected.sourcePgn !== 'string'
    || request.sourcePgn !== expected.sourcePgn
    || typeof expected.startFen !== 'string'
    || typeof expected.reviewedAt !== 'string'
    || !Number.isInteger(expected.moveCount)) {
    throw new Error('Review persistence request is invalid.')
  }

  // This parser is the canonical source proof for the detached completed
  // report. It runs entirely in the local Worker, never in React's thread.
  const timeline = createPgnTimeline(request.sourcePgn)
  if (timeline.startFen !== expected.startFen
    || timeline.moves.length !== expected.moveCount) {
    throw new Error('Review persistence source no longer matches its completed report.')
  }

  const record = createPersistedReviewFromCanonicalTimeline(
    timeline,
    request.report,
    expected.reviewedAt,
  )
  if (record.reviewKey !== expected.reviewKey) {
    throw new Error('Review persistence source has an unexpected identity.')
  }
  return record
}

workerScope.onmessage = (event: MessageEvent<ReviewPersistenceRequest>) => {
  const request = event.data
  try {
    const response: ReviewPersistenceResponse = {
      type: 'review-persistence-result',
      id: request.id,
      record: prepareReviewSave(request),
    }
    workerScope.postMessage(response)
  } catch (error) {
    const response: ReviewPersistenceResponse = {
      type: 'error',
      id: request.id,
      message: error instanceof Error ? error.message : 'Completed review could not be prepared for saving.',
    }
    workerScope.postMessage(response)
  }
}

export {}
