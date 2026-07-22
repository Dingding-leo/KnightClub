import type { AnalysisTimeline } from '../analysis/analysisModel'

type ComparableTimeline = Pick<AnalysisTimeline, 'source' | 'startFen' | 'positions' | 'moves'>

export interface LiveGameContinuation {
  /** Number of moves that arrived after the Review snapshot. */
  addedPly: number
  /** The most recent move in the live game, for an explicit update prompt. */
  latestMove: AnalysisTimeline['moves'][number]
}

/**
 * Identifies a live game that has safely extended the Review snapshot.
 *
 * FENs are compared for every existing ply rather than matching notation, so
 * Review only offers an update when both timelines share the exact position
 * history. Imported FEN positions are intentionally excluded: they have no
 * move history that can safely be treated as a live-game prefix.
 */
export function liveGameContinuation(
  reviewTimeline: ComparableTimeline,
  currentTimeline: ComparableTimeline,
): LiveGameContinuation | null {
  if (reviewTimeline.source !== 'pgn' || currentTimeline.source !== 'pgn') return null
  if (reviewTimeline.startFen !== currentTimeline.startFen) return null
  if (reviewTimeline.positions.length !== reviewTimeline.moves.length + 1
    || currentTimeline.positions.length !== currentTimeline.moves.length + 1) return null

  const reviewedPly = reviewTimeline.moves.length
  if (currentTimeline.moves.length <= reviewedPly) return null

  for (let ply = 0; ply <= reviewedPly; ply += 1) {
    if (reviewTimeline.positions[ply]?.fen !== currentTimeline.positions[ply]?.fen) return null
  }

  const latestMove = currentTimeline.moves.at(-1)
  if (!latestMove) return null

  return {
    addedPly: currentTimeline.moves.length - reviewedPly,
    latestMove,
  }
}
