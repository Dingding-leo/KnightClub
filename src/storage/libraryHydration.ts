import {
  parseBrowserLibraryRaw,
  toStoredGameSummary,
  type StoredGame,
  type StoredGameSummary,
} from './gameStore'

/**
 * Pure, fail-closed library hydration used by both the dedicated Worker and
 * its deliberately yielded fallback. Storage reads stay outside this boundary
 * so the Library tab can paint before it opts into parsing saved PGNs.
 */
export function hydrateLibrarySummaries(raw: string | null): StoredGameSummary[] {
  return parseBrowserLibraryRaw(raw).map(toStoredGameSummary)
}

/** Preserves the old full parser solely for one-time browser-to-SQLite import. */
export function hydrateLibraryFull(raw: string | null): StoredGame[] {
  return parseBrowserLibraryRaw(raw)
}

/** Loads exactly one full record only after an explicit Open/Review action. */
export function loadLibraryGame(raw: string | null, gameId: string): StoredGame | null {
  return parseBrowserLibraryRaw(raw).find((game) => game.id === gameId) ?? null
}
