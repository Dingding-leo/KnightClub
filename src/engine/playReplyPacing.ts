import type { BotLevel } from '../domain/chess'

/**
 * A light visual confirmation for a local reply. These are presentation-only:
 * Stockfish has already stopped before this wait begins, and exact local
 * opening/forced moves need enough time to be perceived without feeling held.
 */
export const PLAY_REPLY_DISPLAY_FLOOR_MS: Readonly<Record<BotLevel, number>> = {
  easy: 140,
  balanced: 180,
  strong: 220,
}

/** Return only the remaining visual delay after a real/local reply resolves. */
export function remainingPlayReplyPacingMs(level: BotLevel, elapsedMs: number): number {
  const elapsed = Number.isNaN(elapsedMs) || elapsedMs < 0 ? 0 : elapsedMs
  return Math.max(0, PLAY_REPLY_DISPLAY_FLOOR_MS[level] - elapsed)
}
