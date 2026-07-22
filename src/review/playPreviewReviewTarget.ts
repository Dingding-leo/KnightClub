import type { AnalysisTimeline } from '../analysis/analysisModel'

export interface PlayPreviewReviewTarget {
  sourcePly: number
  expectedFen: string
}

/**
 * A Play preview is an ephemeral pointer into the active game, not a durable
 * Review target. Accept it only when the Review timeline still contains the
 * same historical position; a changed game naturally falls back to its final
 * position instead of showing the wrong board.
 */
export function resolvePlayPreviewReviewPly(
  timeline: Pick<AnalysisTimeline, 'moves' | 'positions'>,
  target: PlayPreviewReviewTarget | null | undefined,
): number | null {
  if (!target
    || !Number.isInteger(target.sourcePly)
    || target.sourcePly < 1
    || target.sourcePly > timeline.moves.length) return null

  return timeline.positions[target.sourcePly]?.fen === target.expectedFen
    ? target.sourcePly
    : null
}
