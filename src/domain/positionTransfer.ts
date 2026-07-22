import type { Chess } from 'chess.js'

/**
 * Keeps FEN transfer aligned with the board the player is actually viewing.
 * In a historical preview that board is intentionally different from the
 * authoritative live game.
 */
export function positionTransferFor(game: Chess, previewing: boolean) {
  return {
    fen: game.fen(),
    contextLabel: previewing ? 'Share displayed position' : 'Share current position',
    actionsLabel: previewing ? 'Displayed FEN actions' : 'Current FEN actions',
    copyLabel: previewing ? 'Copy displayed FEN' : 'Copy current FEN',
    copySuccess: previewing ? 'Displayed FEN copied.' : 'Current FEN copied.',
    downloadSuccess: previewing ? 'Displayed FEN download started.' : 'FEN download started.',
  }
}
