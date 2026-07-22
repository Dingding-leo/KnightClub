import type { MoveInput } from '../domain/chess'

export interface EngineCandidateScore {
  kind: 'cp' | 'mate'
  value: number
  bound: 'lower' | 'upper' | null
}

/**
 * A safely-normalized alternative from the same bounded play search.  It is
 * deliberately smaller than the full analysis-line payload: Play only needs
 * a legal first move and an exact score before a bot profile may consider it.
 */
export interface EngineCandidate {
  multiPv: number
  move: MoveInput
  depth: number
  score: EngineCandidateScore
}

type CandidateWireLine = {
  multiPv?: unknown
  depth?: unknown
  score?: unknown
  pv?: unknown
}

const UCI_MOVE = /^[a-h][1-8][a-h][1-8][qrbn]?$/

export function parseUciMove(value: unknown): MoveInput | null {
  if (typeof value !== 'string' || !UCI_MOVE.test(value)) return null
  return {
    from: value.slice(0, 2) as MoveInput['from'],
    to: value.slice(2, 4) as MoveInput['to'],
    promotion: value.length === 5 ? value[4] as MoveInput['promotion'] : undefined,
  }
}

export function uciForMove(move: MoveInput): string {
  return `${move.from}${move.to}${move.promotion ?? ''}`
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isInteger(value: unknown, minimum: number, maximum: number): value is number {
  return Number.isInteger(value) && Number(value) >= minimum && Number(value) <= maximum
}

function parseCandidateLine(value: unknown): EngineCandidate | null {
  if (!isObject(value)) return null
  const line = value as CandidateWireLine
  if (!isInteger(line.multiPv, 1, 2) || !isInteger(line.depth, 0, 255) || !isObject(line.score)) return null
  if (!Array.isArray(line.pv) || line.pv.length < 1 || line.pv.length > 128) return null
  const move = parseUciMove(line.pv[0])
  if (!move) return null

  const score = line.score
  if ((score.kind !== 'cp' && score.kind !== 'mate')
    || !isInteger(score.value, -1_000_000, 1_000_000)
    || (score.bound !== null && score.bound !== 'lower' && score.bound !== 'upper')) return null

  return {
    multiPv: line.multiPv,
    move,
    depth: line.depth,
    score: { kind: score.kind, value: score.value, bound: score.bound },
  }
}

/**
 * Candidate telemetry is advisory. A malformed line must never make an
 * otherwise legal Stockfish best move unavailable, so this drops bad and
 * duplicate rows rather than throwing.
 */
export function normalizePlayCandidates(value: unknown): EngineCandidate[] {
  if (!Array.isArray(value)) return []
  const byMultiPv = new Map<number, EngineCandidate>()
  for (const raw of value) {
    const candidate = parseCandidateLine(raw)
    if (candidate && !byMultiPv.has(candidate.multiPv)) byMultiPv.set(candidate.multiPv, candidate)
  }
  return [...byMultiPv.values()].sort((left, right) => left.multiPv - right.multiPv)
}
