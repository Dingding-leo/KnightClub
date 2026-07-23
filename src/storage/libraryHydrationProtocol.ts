import type { StoredGame, StoredGameSummary } from './gameStore'

export interface LibrarySummaryHydrationRequest {
  type: 'hydrate-library-summaries'
  id: number
  raw: string | null
}

/** One-time desktop migration only; normal Library UI must never use this. */
export interface LibraryFullHydrationRequest {
  type: 'hydrate-library-full'
  id: number
  raw: string | null
}

export interface LibraryGameLoadRequest {
  type: 'load-library-game'
  id: number
  raw: string | null
  gameId: string
}

export type LibraryHydrationRequest = LibrarySummaryHydrationRequest | LibraryFullHydrationRequest | LibraryGameLoadRequest

export interface LibrarySummaryHydrationResult {
  type: 'library-summaries-result'
  id: number
  games: StoredGameSummary[]
}

export interface LibraryGameLoadResult {
  type: 'library-game-result'
  id: number
  game: StoredGame | null
}

export interface LibraryFullHydrationResult {
  type: 'library-games-result'
  id: number
  games: StoredGame[]
}

export interface LibraryHydrationError {
  type: 'error'
  id: number
  message: string
}

export type LibraryHydrationResponse = LibrarySummaryHydrationResult | LibraryFullHydrationResult | LibraryGameLoadResult | LibraryHydrationError
