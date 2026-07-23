/**
 * The canonical identity for a reviewed chess main line.  Keep this tiny
 * module separate from review persistence so background PGN hydration can
 * build the same key without loading the full Review workspace.
 */
export const REVIEW_KEY_SCHEMA_VERSION = 1

export interface ReviewKeyMove {
  color: 'w' | 'b'
  from: string
  to: string
  promotion?: string
}

function stableHash(input: string): string {
  // FNV-1a 64 is tiny, deterministic and stable across browser/native builds.
  let hash = 0xcbf29ce484222325n
  const prime = 0x100000001b3n
  const mask = 0xffffffffffffffffn
  for (const byte of new TextEncoder().encode(input)) {
    hash ^= BigInt(byte)
    hash = (hash * prime) & mask
  }
  return hash.toString(16).padStart(16, '0')
}

export function createReviewKeyFromMoves(startFen: string, moves: readonly ReviewKeyMove[]): string {
  const line = moves
    .map((move) => `${move.color}:${move.from}${move.to}${move.promotion ?? ''}`)
    .join('|')
  return stableHash(`knightclub-review-v${REVIEW_KEY_SCHEMA_VERSION}\n${startFen}\n${line}`)
}
