import {
  createFenTimeline,
  createPgnTimeline,
  type AnalysisTimeline,
} from '../analysis/analysisModel'
import { STANDARD_START_FEN } from '../domain/chess'
import {
  resolvePlayPreviewReviewPly,
  type PlayPreviewReviewTarget,
} from './playPreviewReviewTarget'

export interface RequestedReviewTarget {
  reviewKey: string
  sourcePly: number
}

export type ReviewTimelineParser = (pgn: string) => AnalysisTimeline

export interface InitialReviewWorkspaceState {
  timeline: AnalysisTimeline
  ply: number
}

function safeTimeline(pgn: string): AnalysisTimeline {
  try {
    return createPgnTimeline(pgn)
  } catch {
    return createFenTimeline(STANDARD_START_FEN)
  }
}

/**
 * Parse the incoming game once when Review mounts, then derive its initial
 * cursor from that exact immutable timeline. Keeping this as a pure helper
 * prevents a long PGN from being replayed independently for timeline and ply.
 */
export function createInitialWorkspaceState(
  currentPgn: string,
  requestedReviewTarget: RequestedReviewTarget | null | undefined,
  requestedPlayPreviewTarget: PlayPreviewReviewTarget | null | undefined,
  parseTimeline: ReviewTimelineParser = safeTimeline,
): InitialReviewWorkspaceState {
  const timeline = parseTimeline(currentPgn)
  if (!requestedReviewTarget) {
    const previewPly = resolvePlayPreviewReviewPly(timeline, requestedPlayPreviewTarget)
    if (previewPly !== null) return { timeline, ply: previewPly }
  }
  return { timeline, ply: timeline.positions.length - 1 }
}

/**
 * A newly mounted Review already owns the normalized current PGN timeline.
 * Reuse it for the live-continuation check until the game text actually
 * changes; imported positions and genuinely newer games still parse normally.
 */
export function liveTimelineFor(
  currentPgn: string,
  timeline: AnalysisTimeline,
  parseTimeline: ReviewTimelineParser = safeTimeline,
): AnalysisTimeline {
  if (timeline.source === 'pgn' && timeline.sourcePgn === currentPgn.trim()) return timeline
  return parseTimeline(currentPgn)
}
