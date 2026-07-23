/// <reference lib="webworker" />

import { createPgnTimeline } from './analysisModel'
import { importAnalysisFile } from './fileImport'
import type { TimelineWorkerRequest, TimelineWorkerResponse } from './timelineWorkerProtocol'

const workerScope = self as DedicatedWorkerGlobalScope

workerScope.onmessage = (event: MessageEvent<TimelineWorkerRequest>) => {
  const request = event.data
  try {
    let response: TimelineWorkerResponse
    if (request.type === 'parse-pgn') {
      response = {
        type: 'timeline-result',
        id: request.id,
        timeline: createPgnTimeline(request.pgn),
      }
    } else {
      response = {
        type: 'file-result',
        id: request.id,
        result: importAnalysisFile(request.input),
      }
    }
    workerScope.postMessage(response)
  } catch (error) {
    const response: TimelineWorkerResponse = {
      type: 'error',
      id: request.id,
      message: error instanceof Error ? error.message : 'Could not prepare this game locally.',
    }
    workerScope.postMessage(response)
  }
}

export {}
