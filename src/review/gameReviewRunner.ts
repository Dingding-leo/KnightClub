import { Chess } from 'chess.js'
import type { AnalysisTimeline } from '../analysis/analysisModel'
import type { AnalysisResponse, AnalysisSettings } from '../analysis/stockfishAnalysisClient'
import { MAX_REVIEW_PLIES } from './reviewPersistence'
import { classifyReviewedMove, summarizeGameReview, type GameReviewSummary, type ReviewedMove } from './reviewModel'

export type AnalyzePosition = (fen: string, settings: AnalysisSettings) => Promise<AnalysisResponse>

export interface ReviewProgress {
  completedPly: number
  totalPly: number
  stage: 'before' | 'after'
}

export interface GameReview {
  createdAt: string
  engineName: string
  enginePath: string
  settings: AnalysisSettings
  totalElapsedMs: number
  moves: ReviewedMove[]
  summary: GameReviewSummary
}

function abortError(): Error {
  return new DOMException('Game review was cancelled.', 'AbortError')
}

function assertActive(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError()
}

export async function runGameReview(
  timeline: AnalysisTimeline,
  analyze: AnalyzePosition,
  settings: AnalysisSettings,
  onProgress?: (progress: ReviewProgress) => void,
  signal?: AbortSignal,
): Promise<GameReview> {
  if (!timeline.moves.length) throw new Error('Load a PGN with at least one move before starting a full review.')
  // A completed report is intentionally bounded by the persistence contract.
  // Guard here as well as in the UI so a future caller cannot start thousands
  // of sequential local Stockfish searches only to fail on save.
  if (timeline.moves.length > MAX_REVIEW_PLIES) {
    throw new Error(`Full-game reviews support up to ${MAX_REVIEW_PLIES.toLocaleString()} plies.`)
  }
  const beforeSettings = { ...settings, multiPv: Math.max(2, settings.multiPv) }
  const afterSettings = { ...settings, multiPv: 1 }
  const reviewed: ReviewedMove[] = []
  let engineName = ''
  let enginePath = ''
  let totalElapsedMs = 0

  onProgress?.({ completedPly: 0, totalPly: timeline.moves.length, stage: 'before' })
  assertActive(signal)
  // The position after one ply is the position before the next one. Retain
  // that richer MultiPV result for intermediate positions so a full review
  // does not make an extra UCI search just to obtain the prior move's after
  // evaluation. The final non-terminal after-position still needs only PV1.
  let before = await analyze(timeline.positions[0].fen, beforeSettings)
  assertActive(signal)
  totalElapsedMs += before.elapsedMs

  for (const [index, move] of timeline.moves.entries()) {
    assertActive(signal)
    const preFen = timeline.positions[index].fen
    const postFen = timeline.positions[index + 1].fen
    onProgress?.({ completedPly: index, totalPly: timeline.moves.length, stage: 'after' })
    const terminal = new Chess(postFen).isGameOver()
    const hasNextMove = index < timeline.moves.length - 1
    const after = terminal ? null : await analyze(postFen, hasNextMove ? beforeSettings : afterSettings)
    assertActive(signal)

    engineName ||= before.engineName
    enginePath ||= before.enginePath
    totalElapsedMs += after?.elapsedMs ?? 0
    reviewed.push(classifyReviewedMove({
      ...move,
      preFen,
      postFen,
      beforeLines: before.lines,
      afterLine: after?.lines[0] ?? null,
    }))
    onProgress?.({ completedPly: index + 1, totalPly: timeline.moves.length, stage: 'before' })

    if (index < timeline.moves.length - 1) {
      if (!after) throw new Error('Review timeline contains a move after a terminal position.')
      before = after
    }
  }

  return {
    createdAt: new Date().toISOString(),
    engineName,
    enginePath,
    settings: beforeSettings,
    totalElapsedMs,
    moves: reviewed,
    summary: summarizeGameReview(reviewed),
  }
}
