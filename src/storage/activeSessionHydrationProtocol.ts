import type { ActiveSession } from './gameStore'

export interface ActiveSessionRawHydrationRequest {
  type: 'hydrate-active-session-raw'
  id: number
  raw: string | null
}

export interface ActiveSessionHydrationRequestFromSession {
  type: 'hydrate-active-session'
  id: number
  session: ActiveSession | null
}

/**
 * A Library game has a different persistence envelope from an active session.
 * Keep its PGN-only replay explicit so a legitimate saved game never has to
 * masquerade as browser-recovery state just to use the same one-shot worker.
 */
export interface StoredGameHydrationRequest {
  type: 'hydrate-stored-game'
  id: number
  pgn: string
}

export type ActiveSessionHydrationRequest = ActiveSessionRawHydrationRequest
  | ActiveSessionHydrationRequestFromSession
  | StoredGameHydrationRequest

/**
 * `gameState` is an intentionally prototype-free structured-clone snapshot
 * of chess.js's own state. The UI reattaches and verifies its prototype before
 * it can be used; it is never persisted as application data.
 */
export interface HydratedActiveSessionWire {
  snapshotVersion: 1
  session: ActiveSession
  finalFen: string
  historyLength: number
  gameState: unknown
  verboseHistory: unknown
}

/** Prototype-free chess snapshot for an explicitly opened Library record. */
export interface HydratedStoredGameWire {
  snapshotVersion: 1
  startFen: string
  finalFen: string
  historyLength: number
  gameState: unknown
  verboseHistory: unknown
  canonicalReviewKey: string
}

export interface ActiveSessionHydrationResult {
  type: 'active-session-result'
  id: number
  hydrated: HydratedActiveSessionWire | null
}

export interface StoredGameHydrationResult {
  type: 'stored-game-result'
  id: number
  hydrated: HydratedStoredGameWire
}

export interface ActiveSessionHydrationError {
  type: 'error'
  id: number
  message: string
}

export type ActiveSessionHydrationResponse = ActiveSessionHydrationResult
  | StoredGameHydrationResult
  | ActiveSessionHydrationError
