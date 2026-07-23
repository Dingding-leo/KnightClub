import { Chess, type Move } from 'chess.js'
import { STANDARD_START_FEN } from '../domain/chess'
import { createReviewKeyFromMoves } from '../review/reviewKey'
import { isClockState } from '../domain/clock'
import {
  normalizeActiveSession,
  normalizeHydratedActiveSession,
  parseActiveSessionRaw,
  MAX_STORED_GAME_PGN_CHARS,
  type ActiveSession,
} from './gameStore'
import type {
  HydratedActiveSessionWire,
  HydratedStoredGameWire,
} from './activeSessionHydrationProtocol'

const MAX_ACTIVE_SESSION_HISTORY_LENGTH = 100_000
// Desktop records are byte-bounded by their database envelope; browser
// records historically used a character boundary. Keep worker replay bounded
// even for an old browser mirror with multi-byte PGN comments.
// Browser Library validation is character-bounded for legacy compatibility.
// UTF-8 can use four bytes per accepted character (for example comments in
// Chinese or emoji), so retain that complete accepted envelope in the Worker.
const MAX_STORED_GAME_PGN_BYTES = MAX_STORED_GAME_PGN_CHARS * 4
const MAX_STORED_GAME_HISTORY_LENGTH = 100_000
const REVIEW_KEY_PATTERN = /^[0-9a-f]{16}$/

export interface HydratedActiveSession {
  session: ActiveSession
  game: Chess
  verboseHistory: readonly Move[]
}

/** A verified chess snapshot for an explicitly opened Library record. */
export interface HydratedStoredGame {
  game: Chess
  startFen: string
  verboseHistory: readonly Move[]
  canonicalReviewKey: string
}

function hydrateSession(session: ActiveSession | null): HydratedActiveSessionWire | null {
  const normalized = normalizeActiveSession(session)
  if (!normalized) return null

  // Clock snapshots can be as long as a retained game. Filter them beside the
  // PGN replay so Play does not walk a large persisted array during adoption.
  const hydratedSession: ActiveSession = {
    ...normalized,
    clockHistory: Array.isArray(normalized.clockHistory)
      ? normalized.clockHistory.filter(isClockState)
      : [],
  }

  const game = new Chess(hydratedSession.startFen)
  if (hydratedSession.pgn.trim()) game.loadPgn(hydratedSession.pgn)
  const verboseHistory = game.history({ verbose: true })
  return {
    snapshotVersion: 1,
    session: hydratedSession,
    finalFen: game.fen(),
    historyLength: verboseHistory.length,
    // postMessage (or structuredClone in the yielded fallback) deliberately
    // turns this into plain own-property data. The client revives it below.
    gameState: game,
    verboseHistory,
  }
}

/** Worker/fallback parser for the browser's unparsed active-session mirror. */
export function hydrateActiveSessionRaw(raw: string | null): HydratedActiveSessionWire | null {
  return hydrateSession(parseActiveSessionRaw(raw))
}

/** Worker/fallback parser for the authoritative desktop SQLite payload. */
export function hydrateActiveSession(session: ActiveSession | null): HydratedActiveSessionWire | null {
  return hydrateSession(session)
}

/**
 * Worker/fallback parser for a selected Library PGN. It deliberately accepts
 * only the PGN rather than a synthetic ActiveSession: saved-library records
 * have their own persistence boundary and can carry different metadata.
 */
export function hydrateStoredGame(pgn: string): HydratedStoredGameWire {
  if (typeof pgn !== 'string'
    || new TextEncoder().encode(pgn).byteLength > MAX_STORED_GAME_PGN_BYTES) {
    throw new Error('Saved PGN is invalid or too large.')
  }

  const game = new Chess()
  if (pgn.trim()) game.loadPgn(pgn)
  const verboseHistory = game.history({ verbose: true })
  const startFen = game.getHeaders().FEN ?? STANDARD_START_FEN
  return {
    snapshotVersion: 1,
    startFen,
    finalFen: game.fen(),
    historyLength: verboseHistory.length,
    gameState: game,
    verboseHistory,
    canonicalReviewKey: createReviewKeyFromMoves(startFen, verboseHistory),
  }
}

function isSquare(value: unknown): boolean {
  return typeof value === 'string' && /^[a-h][1-8]$/.test(value)
}

function isVerboseHistory(value: unknown, expectedLength: number): value is Move[] {
  if (!Array.isArray(value) || value.length !== expectedLength) return false
  return value.every((move) => {
    if (!move || typeof move !== 'object') return false
    const candidate = move as Partial<Move>
    return typeof candidate.san === 'string'
      && typeof candidate.before === 'string'
      && typeof candidate.after === 'string'
      && (candidate.color === 'w' || candidate.color === 'b')
      && isSquare(candidate.from)
      && isSquare(candidate.to)
      && typeof candidate.piece === 'string'
      && typeof candidate.flags === 'string'
  })
}

function reviveGameState(value: unknown): Chess {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Active-session Worker returned an invalid chess snapshot.')
  }
  return Object.assign(Object.create(Chess.prototype), value) as Chess
}

/**
 * Verifies a Worker snapshot through chess.js's public FEN API and its stored
 * undo-stack depth, then exposes the already-computed verbose history so Play
 * does not ask chess.js to rebuild it on the interaction thread.
 */
export function reviveHydratedActiveSession(value: unknown): HydratedActiveSession | null {
  if (value === null) return null
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Active-session Worker returned an invalid response.')
  }
  const hydrated = value as Partial<HydratedActiveSessionWire>
  const session = normalizeHydratedActiveSession(hydrated.session)
  if (!session
    || hydrated.snapshotVersion !== 1
    || typeof hydrated.finalFen !== 'string'
    || !Number.isInteger(hydrated.historyLength)
    || Number(hydrated.historyLength) < 0
    || Number(hydrated.historyLength) > MAX_ACTIVE_SESSION_HISTORY_LENGTH
    || !isVerboseHistory(hydrated.verboseHistory, Number(hydrated.historyLength))) {
    throw new Error('Active-session Worker returned an invalid response.')
  }

  const game = reviveGameState(hydrated.gameState)
  const privateHistory = (game as unknown as { _history?: unknown })._history
  try {
    if (!Array.isArray(privateHistory)
      || privateHistory.length !== hydrated.historyLength
      || game.fen() !== hydrated.finalFen) {
      throw new Error('Active-session Worker snapshot did not verify.')
    }
  } catch (error) {
    throw error instanceof Error
      ? error
      : new Error('Active-session Worker snapshot did not verify.')
  }

  return { session, game, verboseHistory: hydrated.verboseHistory }
}

/**
 * Reattaches a structured-cloned selected-game snapshot only after proving
 * its FEN, undo depth and precomputed move history still agree. The canonical
 * review key is made in the worker so opening a long legacy game never spends
 * an extra linear BigInt hash pass on the interaction thread.
 */
export function reviveHydratedStoredGame(value: unknown): HydratedStoredGame {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Saved-game Worker returned an invalid response.')
  }
  const hydrated = value as Partial<HydratedStoredGameWire>
  if (hydrated.snapshotVersion !== 1
    || typeof hydrated.startFen !== 'string'
    || hydrated.startFen.length === 0
    || hydrated.startFen.length > 1_024
    || typeof hydrated.finalFen !== 'string'
    || !Number.isInteger(hydrated.historyLength)
    || Number(hydrated.historyLength) < 0
    || Number(hydrated.historyLength) > MAX_STORED_GAME_HISTORY_LENGTH
    || !isVerboseHistory(hydrated.verboseHistory, Number(hydrated.historyLength))
    || typeof hydrated.canonicalReviewKey !== 'string'
    || !REVIEW_KEY_PATTERN.test(hydrated.canonicalReviewKey)) {
    throw new Error('Saved-game Worker returned an invalid response.')
  }

  try {
    // The original PGN may start from an authored FEN. Validate that small
    // header independently without replaying a potentially long main line.
    new Chess(hydrated.startFen)
  } catch {
    throw new Error('Saved-game Worker returned an invalid response.')
  }

  const game = reviveGameState(hydrated.gameState)
  const privateHistory = (game as unknown as { _history?: unknown })._history
  try {
    if (!Array.isArray(privateHistory)
      || privateHistory.length !== hydrated.historyLength
      || game.fen() !== hydrated.finalFen) {
      throw new Error('Saved-game Worker snapshot did not verify.')
    }
  } catch (error) {
    throw error instanceof Error
      ? error
      : new Error('Saved-game Worker snapshot did not verify.')
  }

  return {
    game,
    startFen: hydrated.startFen,
    verboseHistory: hydrated.verboseHistory,
    canonicalReviewKey: hydrated.canonicalReviewKey,
  }
}
