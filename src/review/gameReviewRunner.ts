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

/**
 * A contiguous, in-memory snapshot of a still-running full-game review.
 *
 * `nextBefore` deliberately remains outside `GameReview`: it is the raw
 * MultiPV result needed to resume at the next ply without repeating an engine
 * request. Callers must keep this only for the current UI session; completed
 * reports remain the sole persistable review format.
 */
export interface ReviewCheckpoint {
  completedPly: number
  totalPly: number
  report: GameReview
  nextBefore: AnalysisResponse
}

export interface ResumableReviewOptions {
  onProgress?: (progress: ReviewProgress) => void
  /** Called after a fully-classified, non-final move is ready to inspect. */
  onCheckpoint?: (checkpoint: ReviewCheckpoint) => void
  signal?: AbortSignal
  /** A same-session checkpoint created by this runner. */
  resumeFrom?: ReviewCheckpoint | null
}

function abortError(): Error {
  return new DOMException('Game review was cancelled.', 'AbortError')
}

function assertActive(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError()
}

function sameSettings(left: AnalysisSettings, right: AnalysisSettings): boolean {
  return left.moveTimeMs === right.moveTimeMs
    && left.depth === right.depth
    && left.nodes === right.nodes
    && left.multiPv === right.multiPv
    && left.threads === right.threads
    && left.hashMb === right.hashMb
}

function checkpointMatchesTimeline(
  checkpoint: ReviewCheckpoint,
  timeline: AnalysisTimeline,
  settings: AnalysisSettings,
): boolean {
  const completedPly = checkpoint.completedPly
  if (completedPly < 1 || completedPly >= timeline.moves.length) return false
  if (checkpoint.totalPly !== timeline.moves.length) return false
  if (checkpoint.report.moves.length !== completedPly) return false
  if (!sameSettings(checkpoint.report.settings, settings)) return false
  if (checkpoint.nextBefore.engineName !== checkpoint.report.engineName
    || checkpoint.nextBefore.enginePath !== checkpoint.report.enginePath) return false
  if (checkpoint.nextBefore.fen !== timeline.positions[completedPly]?.fen) return false
  return checkpoint.report.moves.every((reviewed, index) => {
    const source = timeline.moves[index]
    return Boolean(source)
      && reviewed.ply === source.ply
      && reviewed.moveNumber === source.moveNumber
      && reviewed.color === source.color
      && reviewed.san === source.san
      && reviewed.from === source.from
      && reviewed.to === source.to
  })
}

function reportFrom(
  createdAt: string,
  engineName: string,
  enginePath: string,
  settings: AnalysisSettings,
  totalElapsedMs: number,
  moves: readonly ReviewedMove[],
): GameReview {
  return {
    createdAt,
    engineName,
    enginePath,
    settings,
    totalElapsedMs,
    moves: [...moves],
    summary: summarizeGameReview([...moves]),
  }
}

export async function runGameReview(
  timeline: AnalysisTimeline,
  analyze: AnalyzePosition,
  settings: AnalysisSettings,
  onProgress?: (progress: ReviewProgress) => void,
  signal?: AbortSignal,
): Promise<GameReview> {
  return runResumableGameReview(timeline, analyze, settings, { onProgress, signal })
}

/**
 * Runs a full review while exposing contiguous in-memory checkpoints. A
 * resumed pass reuses the already-computed post-move MultiPV result as the
 * next move's baseline, so pausing never spends another Stockfish search on a
 * position the player has already paid to analyse.
 */
export async function runResumableGameReview(
  timeline: AnalysisTimeline,
  analyze: AnalyzePosition,
  settings: AnalysisSettings,
  options: ResumableReviewOptions = {},
): Promise<GameReview> {
  const { onCheckpoint, onProgress, resumeFrom, signal } = options
  if (!timeline.moves.length) throw new Error('Load a PGN with at least one move before starting a full review.')
  // A completed report is intentionally bounded by the persistence contract.
  // Guard here as well as in the UI so a future caller cannot start thousands
  // of sequential local Stockfish searches only to fail on save.
  if (timeline.moves.length > MAX_REVIEW_PLIES) {
    throw new Error(`Full-game reviews support up to ${MAX_REVIEW_PLIES.toLocaleString()} plies.`)
  }
  const beforeSettings = { ...settings, multiPv: Math.max(2, settings.multiPv) }
  const afterSettings = { ...settings, multiPv: 1 }
  if (resumeFrom && !checkpointMatchesTimeline(resumeFrom, timeline, beforeSettings)) {
    throw new Error('This partial review no longer matches the current game or engine settings.')
  }
  const reviewed: ReviewedMove[] = resumeFrom ? [...resumeFrom.report.moves] : []
  const createdAt = resumeFrom?.report.createdAt ?? new Date().toISOString()
  let engineName = resumeFrom?.report.engineName ?? ''
  let enginePath = resumeFrom?.report.enginePath ?? ''
  let totalElapsedMs = resumeFrom?.report.totalElapsedMs ?? 0

  onProgress?.({ completedPly: reviewed.length, totalPly: timeline.moves.length, stage: 'before' })
  assertActive(signal)
  // The position after one ply is the position before the next one. Retain
  // that richer MultiPV result for intermediate positions so a full review
  // does not make an extra UCI search just to obtain the prior move's after
  // evaluation. The final non-terminal after-position still needs only PV1.
  let before: AnalysisResponse
  if (resumeFrom) {
    before = resumeFrom.nextBefore
  } else {
    before = await analyze(timeline.positions[0].fen, beforeSettings)
    assertActive(signal)
    totalElapsedMs += before.elapsedMs
  }

  for (let index = reviewed.length; index < timeline.moves.length; index += 1) {
    const move = timeline.moves[index]!
    assertActive(signal)
    const preFen = timeline.positions[index].fen
    const postFen = timeline.positions[index + 1].fen
    onProgress?.({ completedPly: index, totalPly: timeline.moves.length, stage: 'after' })
    const terminal = new Chess(postFen).isGameOver()
    const hasNextMove = index < timeline.moves.length - 1
    const after = terminal ? null : await analyze(postFen, hasNextMove ? beforeSettings : afterSettings)
    assertActive(signal)

    // A checkpoint is intentionally session-only, but it must still never
    // splice results from two differently configured engine runtimes into one
    // report. We can verify this as soon as a resumed request settles.
    if (resumeFrom && after
      && (after.engineName !== resumeFrom.report.engineName || after.enginePath !== resumeFrom.report.enginePath)) {
      throw new Error('The local engine changed while this review was paused. Discard the partial review and start again.')
    }

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
      onCheckpoint?.({
        completedPly: reviewed.length,
        totalPly: timeline.moves.length,
        report: reportFrom(createdAt, engineName, enginePath, beforeSettings, totalElapsedMs, reviewed),
        nextBefore: after,
      })
      before = after
    }
  }

  return reportFrom(createdAt, engineName, enginePath, beforeSettings, totalElapsedMs, reviewed)
}
