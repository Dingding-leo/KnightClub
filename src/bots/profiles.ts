import { Chess, type Color } from 'chess.js'
import { STANDARD_START_FEN, type BotLevel, type MoveInput } from '../domain/chess'
import { uciForMove, type EngineCandidate } from '../engine/playCandidates'

export const BOT_PROFILE_IDS = ['mira-vale', 'rowan-pike', 'nia-cross'] as const

export type BotProfileId = typeof BOT_PROFILE_IDS[number]
export type BotProfileTone = 'mira' | 'rowan' | 'nia'
export type BotStylePreference = 'forcing' | 'classical' | 'pressure'

export interface OpeningCue {
  /** Exact SAN main-line history required before this local move is offered. */
  history: readonly string[]
  /** The move is still validated by chess.js against the current FEN before use. */
  move: MoveInput
}

export interface BotProfile {
  id: BotProfileId
  name: string
  initials: string
  tone: BotProfileTone
  /** Stockfish's strength target for the built-in preset, not a calibrated player rating. */
  targetElo: number
  engineLevel: BotLevel
  openingCueLabel: string
  /** Two lines come from one existing bounded UCI search, never a second `go`. */
  candidateCount: 2
  candidatePolicy: {
    preference: BotStylePreference
    label: string
    /** Never sacrifice more than this exact same-position engine score. */
    maxCpLoss: number
  }
  intro: string
  openingCues: readonly OpeningCue[]
  openingReactions: readonly string[]
  postGame: {
    win: string
    loss: string
    draw: string
  }
}

const move = (from: MoveInput['from'], to: MoveInput['to']): MoveInput => ({ from, to })

/**
 * These are original KnightClub opponents. Exact opening cues keep the engine
 * idle, while later profile choices can only select a close, legal alternative
 * from the same fixed-budget two-line Stockfish search.
 */
export const BOT_PROFILES: readonly BotProfile[] = [
  {
    id: 'mira-vale',
    name: 'Mira Vale',
    initials: 'MV',
    tone: 'mira',
    targetElo: 1320,
    engineLevel: 'easy',
    openingCueLabel: 'Opening cue · open centre',
    candidateCount: 2,
    candidatePolicy: { preference: 'forcing', label: 'forcing', maxCpLoss: 65 },
    intro: 'Starts with an open centre and can favor a close forcing line after it.',
    openingCues: [
      { history: [], move: move('e2', 'e4') },
      { history: ['e4'], move: move('e7', 'e5') },
      { history: ['e4', 'e5'], move: move('g1', 'f3') },
      { history: ['e4', 'e5', 'Nf3'], move: move('b8', 'c6') },
    ],
    openingReactions: [
      'The centre is open — time to develop.',
      'A clear file makes the next decision simpler.',
    ],
    postGame: {
      win: 'A tidy finish. The saved game is ready for review.',
      loss: 'Well played. Your finished game is ready for a local review.',
      draw: 'A balanced game. The full line is saved if you want to review it.',
    },
  },
  {
    id: 'rowan-pike',
    name: 'Rowan Pike',
    initials: 'RP',
    tone: 'rowan',
    targetElo: 1700,
    engineLevel: 'balanced',
    openingCueLabel: 'Opening cue · claim the centre',
    candidateCount: 2,
    candidatePolicy: { preference: 'classical', label: 'classical', maxCpLoss: 32 },
    intro: 'Claims central space and can favor a close classical line after it.',
    openingCues: [
      { history: [], move: move('d2', 'd4') },
      // Rowan is the default opponent. Cover the two most common open-game
      // replies locally so a new player does not need to boot the WASM engine
      // just to receive a conventional first response.
      { history: ['e4'], move: move('e7', 'e5') },
      { history: ['e4', 'e5', 'Nf3'], move: move('b8', 'c6') },
      { history: ['d4'], move: move('d7', 'd5') },
      { history: ['d4', 'd5'], move: move('c2', 'c4') },
      { history: ['d4', 'd5', 'c4'], move: move('e7', 'e6') },
    ],
    openingReactions: [
      'The centre is defined. Let’s see where the tension goes.',
      'Space first; the position can speak from here.',
    ],
    postGame: {
      win: 'That was a composed conversion. The game is saved for review.',
      loss: 'Nice work. The complete position trail is saved locally.',
      draw: 'Neither side broke through. Review is ready whenever you are.',
    },
  },
  {
    id: 'nia-cross',
    name: 'Nia Cross',
    initials: 'NC',
    tone: 'nia',
    targetElo: 2200,
    engineLevel: 'strong',
    openingCueLabel: 'Opening cue · flank pressure',
    candidateCount: 2,
    candidatePolicy: { preference: 'pressure', label: 'pressure', maxCpLoss: 18 },
    intro: 'Builds flank pressure and can prefer a close active line after it.',
    openingCues: [
      { history: [], move: move('c2', 'c4') },
      { history: ['c4'], move: move('e7', 'e5') },
      { history: ['c4', 'e5'], move: move('b1', 'c3') },
      { history: ['c4', 'e5', 'Nc3'], move: move('g8', 'f6') },
    ],
    openingReactions: [
      'The flank is active — the centre still needs an answer.',
      'A little pressure now keeps choices open later.',
    ],
    postGame: {
      win: 'A sharp finish. Your complete game is saved for review.',
      loss: 'Strong play. The game is stored locally for a closer look.',
      draw: 'A resilient defence. The line is saved if you want to revisit it.',
    },
  },
]

export const DEFAULT_BOT_PROFILE_ID: BotProfileId = 'rowan-pike'

const profileById = new Map(BOT_PROFILES.map((profile) => [profile.id, profile]))

function historiesMatch(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((move, index) => move === right[index])
}

function phraseIndex(seed: string, size: number): number {
  let hash = 2166136261
  for (const character of seed) {
    hash ^= character.charCodeAt(0)
    hash = Math.imul(hash, 16777619)
  }
  return Math.abs(hash >>> 0) % size
}

export function isBotProfileId(value: unknown): value is BotProfileId {
  return typeof value === 'string' && profileById.has(value as BotProfileId)
}

export function botProfileForId(id: BotProfileId): BotProfile {
  return profileById.get(id) ?? profileById.get(DEFAULT_BOT_PROFILE_ID)!
}

/** Makes existing saved games readable by mapping their legacy strength to a named local opponent. */
export function profileForLegacyLevel(level: BotLevel | undefined): BotProfile {
  return BOT_PROFILES.find((profile) => profile.engineLevel === level)
    ?? botProfileForId(DEFAULT_BOT_PROFILE_ID)
}

/**
 * Returns a legal authored opening move only for an exact standard-start route.
 * It never mutates the displayed game and it never guesses in a custom FEN.
 * Play supplies its already-cached SAN history so a long game never rebuilds
 * that history once per authored cue on the bot-turn hot path.
 */
export function selectProfileOpeningMove(
  game: Chess,
  startFen: string,
  botColor: Color,
  profile: BotProfile,
  history: readonly string[] = game.history(),
): MoveInput | null {
  if (startFen !== STANDARD_START_FEN || game.turn() !== botColor) return null
  const cue = profile.openingCues.find((candidate) => historiesMatch(history, candidate.history))
  if (!cue) return null

  try {
    const trial = new Chess(game.fen())
    const legal = trial.move(cue.move)
    return legal
      ? { from: legal.from, to: legal.to, promotion: legal.promotion }
      : null
  } catch {
    return null
  }
}

export interface ProfileCandidateSelection {
  move: MoveInput
  /** True only when a profile safely chose the second line over Stockfish's move. */
  usedStyle: boolean
}

interface MoveTraits {
  move: MoveInput
  forcing: number
  classical: number
  pressure: number
}

const CENTRAL_SQUARES = new Set(['c4', 'd4', 'e4', 'f4', 'c5', 'd5', 'e5', 'f5'])

/**
 * Reads a move on a throwaway board. Candidate telemetry is never trusted to
 * mutate the visible game, which also makes malformed or stale PVs harmless.
 */
function moveTraits(game: Chess, move: MoveInput): MoveTraits | null {
  try {
    const trial = new Chess(game.fen())
    const played = trial.move(move)
    if (!played) return null
    const capture = Boolean(played.captured)
    const check = trial.isCheck()
    const castle = played.isKingsideCastle() || played.isQueensideCastle()
    const centralPawn = played.piece === 'p' && CENTRAL_SQUARES.has(played.to)
    const developedMinor = (played.piece === 'n' || played.piece === 'b')
      && played.from[1] === (played.color === 'w' ? '1' : '8')
      && played.to[1] !== (played.color === 'w' ? '1' : '8')
    const activePiece = played.piece !== 'p' && CENTRAL_SQUARES.has(played.to)
    return {
      move: { from: played.from, to: played.to, promotion: played.promotion },
      forcing: (check ? 8 : 0) + (capture ? 5 : 0) + (played.promotion ? 3 : 0),
      classical: (centralPawn ? 8 : 0) + (developedMinor ? 5 : 0) + (castle ? 4 : 0),
      pressure: (check ? 6 : 0) + (capture ? 3 : 0) + (activePiece ? 4 : 0) + (centralPawn ? 2 : 0),
    }
  } catch {
    return null
  }
}

function styleScore(traits: MoveTraits, preference: BotStylePreference): number {
  return traits[preference]
}

function exactCentipawn(candidate: EngineCandidate | undefined): candidate is EngineCandidate {
  return Boolean(candidate
    && candidate.score.kind === 'cp'
    && candidate.score.bound === null)
}

/**
 * Selects only a close second principal variation. Stockfish's `bestmove`
 * remains authoritative whenever its limited-strength choice differs from PV1,
 * the score is bounded/mating, the alternative is illegal, or it does not
 * actually express this opponent's declared preference.
 */
export function selectProfileCandidateMove(
  game: Chess,
  profile: BotProfile,
  bestMove: MoveInput,
  candidates: readonly EngineCandidate[],
): ProfileCandidateSelection {
  const baseline = candidates.find((candidate) => candidate.multiPv === 1)
  const alternative = candidates.find((candidate) => candidate.multiPv === 2)
  if (!exactCentipawn(baseline) || !exactCentipawn(alternative)) {
    return { move: bestMove, usedStyle: false }
  }
  if (uciForMove(baseline.move) !== uciForMove(bestMove)) {
    return { move: bestMove, usedStyle: false }
  }

  const scoreLoss = baseline.score.value - alternative.score.value
  if (scoreLoss < 0 || scoreLoss > profile.candidatePolicy.maxCpLoss) {
    return { move: bestMove, usedStyle: false }
  }

  const baseTraits = moveTraits(game, bestMove)
  const alternativeTraits = moveTraits(game, alternative.move)
  if (!baseTraits || !alternativeTraits
    || styleScore(alternativeTraits, profile.candidatePolicy.preference)
      <= styleScore(baseTraits, profile.candidatePolicy.preference)) {
    return { move: bestMove, usedStyle: false }
  }

  return { move: alternativeTraits.move, usedStyle: true }
}

/** The phrase is deterministic so an unchanged local game never gains random UI state. */
export function botOpeningReaction(profile: BotProfile, game: Chess): string {
  return profile.openingReactions[phraseIndex(`${profile.id}:${game.fen()}`, profile.openingReactions.length)]!
}

export function botStyleReaction(profile: BotProfile): string {
  return `${profile.name} chose a close ${profile.candidatePolicy.label} line.`
}

export function botPostGameMessage(profile: BotProfile, result: string, botColor: Color): string {
  if (result === '1/2-1/2') return profile.postGame.draw
  const botWon = (botColor === 'w' && result === '1-0') || (botColor === 'b' && result === '0-1')
  return botWon ? profile.postGame.win : profile.postGame.loss
}
