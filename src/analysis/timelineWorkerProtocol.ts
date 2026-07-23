import type { AnalysisFileImportInput, AnalysisFileImportResult } from './fileImport'
import type { AnalysisTimeline } from './analysisModel'

export interface TimelineWorkerPgnRequest {
  type: 'parse-pgn'
  id: number
  pgn: string
}

export interface TimelineWorkerFileRequest {
  type: 'parse-file'
  id: number
  input: AnalysisFileImportInput
}

export type TimelineWorkerRequest = TimelineWorkerPgnRequest | TimelineWorkerFileRequest

export interface TimelineWorkerTimelineResult {
  type: 'timeline-result'
  id: number
  timeline: AnalysisTimeline
}

export interface TimelineWorkerFileResult {
  type: 'file-result'
  id: number
  result: AnalysisFileImportResult
}

export interface TimelineWorkerError {
  type: 'error'
  id: number
  message: string
}

export type TimelineWorkerResponse = TimelineWorkerTimelineResult | TimelineWorkerFileResult | TimelineWorkerError
