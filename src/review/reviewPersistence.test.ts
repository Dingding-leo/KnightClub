import { describe, expect, it, vi } from 'vitest'
import { Chess } from 'chess.js'
import { createPgnTimeline } from '../analysis/analysisModel'
import type { GameReview } from './gameReviewRunner'
import {
  assertPersistedReview,
  createPersistedReview,
  createPersistedReviewFromCanonicalTimeline,
  createReviewKey,
  createReviewKeyFromMoves,
  loadBrowserReview,
  saveBrowserReview,
} from './reviewPersistence'

class MemoryStorage {
  private values = new Map<string, string>()

  getItem(key: string): string | null { return this.values.get(key) ?? null }
  setItem(key: string, value: string): void { this.values.set(key, value) }
  removeItem(key: string): void { this.values.delete(key) }
}

function report(): GameReview {
  return {
    createdAt: '2026-07-22T00:00:00.000Z',
    engineName: 'Fakefish',
    enginePath: '/fake',
    settings: { moveTimeMs: 100, depth: 12, nodes: null, multiPv: 2, threads: 1, hashMb: 16 },
    totalElapsedMs: 20,
    moves: [{
      ply: 1, moveNumber: 1, color: 'w', san: 'e4', from: 'e2', to: 'e4', classification: 'best', accuracy: 100,
      centipawnLoss: 0, expectedLoss: 0, bestMoveUci: 'e2e4', bestMoveSan: 'e4', isBestMove: true,
      phase: 'opening', bestScore: { kind: 'cp', value: 20, bound: null }, playedScore: { kind: 'cp', value: 20, bound: null },
      bestLineSan: ['e4', 'e5'], depth: 16, confidence: 'normal', feedback: 'e4 matches the first choice.',
    }],
    summary: {
      accuracy: 100, whiteAccuracy: 100, blackAccuracy: null, averageCentipawnLoss: 0, bestMoveRate: 100,
      classifications: { brilliant: 0, great: 0, best: 1, excellent: 0, good: 0, book: 0, inaccuracy: 0, mistake: 0, miss: 0, blunder: 0, forced: 0 },
      phaseAccuracy: { opening: 100, middlegame: null, endgame: null }, turningPoints: [],
    },
  }
}

function browserReviewKey(index: number): string {
  return index.toString(16).padStart(16, '0')
}

describe('persisted review identity and browser storage', () => {
  it('uses the same stable key for equivalent PGNs and a distinct key for a changed main line', () => {
    const first = createPgnTimeline('[Event "A"]\n\n1. e4 e5 2. Nf3 Nc6 *')
    const same = createPgnTimeline('[Event "Renamed"]\n[Site "Offline"]\n\n1. e4 e5 2. Nf3 Nc6 *')
    const changed = createPgnTimeline('1. e4 c5 2. Nf3 *')
    expect(createReviewKey(first)).toBe(createReviewKey(same))
    expect(createReviewKey(first)).not.toBe(createReviewKey(changed))
  })

  it('creates the same canonical key directly from minimal move facts, including promotion', () => {
    const timeline = createPgnTimeline('[SetUp "1"]\n[FEN "7k/P7/8/8/8/8/8/7K w - - 0 1"]\n\n1. a8=Q+ *')
    const minimalMoves = timeline.moves.map(({ color, from, to, promotion }) => ({ color, from, to, promotion }))

    expect(createReviewKeyFromMoves(timeline.startFen, minimalMoves)).toBe(createReviewKey(timeline))
    expect(createReviewKeyFromMoves(timeline.startFen, minimalMoves)).not.toBe(
      createReviewKeyFromMoves(timeline.startFen, minimalMoves.map((move) => ({ ...move, promotion: undefined }))),
    )
  })

  it('accepts the verbose chess.js history used when a finished game enters the library', () => {
    const startFen = '7k/P7/8/8/8/8/8/7K w - - 0 1'
    const game = new Chess(startFen)
    game.move({ from: 'a7', to: 'a8', promotion: 'q' })
    const timeline = createPgnTimeline(game.pgn())

    expect(createReviewKeyFromMoves(startFen, game.history({ verbose: true }))).toBe(createReviewKey(timeline))
  })

  it('round-trips a versioned report through bounded browser storage and ignores malformed data', () => {
    const storage = new MemoryStorage()
    const timeline = createPgnTimeline('1. e4')
    const record = createPersistedReview(timeline, report())
    saveBrowserReview(record, storage)
    expect(loadBrowserReview(record.reviewKey, storage)).toEqual(record)

    const exposed = loadBrowserReview(record.reviewKey, storage)!
    exposed.report.moves[0]!.feedback = 'A caller mutation must not alter the cached review.'
    expect(loadBrowserReview(record.reviewKey, storage)).toEqual(record)

    storage.setItem('knightclub.review-reports.v1', JSON.stringify([{ reviewKey: record.reviewKey }]))
    expect(loadBrowserReview(record.reviewKey, storage)).toBeNull()
  })

  it('saves an immutable completed-review snapshot without replaying its PGN twice', () => {
    const storage = new MemoryStorage()
    const sourceReport = report()
    const timeline = createPgnTimeline('1. e4')
    const move = vi.spyOn(Chess.prototype, 'move')
    try {
      const record = createPersistedReview(timeline, sourceReport)
      const replayCountAfterCreation = move.mock.calls.length

      expect(replayCountAfterCreation).toBeGreaterThan(0)
      expect(Object.isFrozen(record)).toBe(true)
      expect(Object.isFrozen(record.report)).toBe(true)
      expect(Object.isFrozen(record.report.moves)).toBe(true)
      expect(Object.isFrozen(record.report.moves[0]!)).toBe(true)

      sourceReport.moves[0]!.feedback = 'The saved snapshot must stay detached from live review state.'
      expect(record.report.moves[0]!.feedback).not.toBe(sourceReport.moves[0]!.feedback)

      saveBrowserReview(record, storage)
      expect(move.mock.calls.length).toBe(replayCountAfterCreation)
    } finally {
      move.mockRestore()
    }
  })

  it('keeps Worker-only canonical timeline validation strict for a tampered completed report', () => {
    const timeline = createPgnTimeline('1. e4')
    const tampered = report()
    tampered.moves[0]!.to = 'd4'

    expect(() => createPersistedReviewFromCanonicalTimeline(timeline, tampered)).toThrow(
      'Saved review does not match its source game.',
    )
  })

  it('keeps full report structure and byte bounds when reusing a canonical Worker timeline', () => {
    const timeline = createPgnTimeline('1. e4')
    const malformed = report()
    malformed.moves[0]!.feedback = 'x'.repeat(4_097)

    expect(() => createPersistedReviewFromCanonicalTimeline(
      timeline,
      malformed,
      '2026-07-23T00:00:00.000Z',
    )).toThrow('Saved review is invalid or too large.')
  })

  it('rejects a tampered cloned review before writing browser storage', () => {
    const storage = new MemoryStorage()
    const record = createPersistedReview(createPgnTimeline('1. e4'), report())
    const tampered = JSON.parse(JSON.stringify(record)) as typeof record
    tampered.report.moves[0]!.to = 'd4'

    expect(() => saveBrowserReview(tampered, storage)).toThrow('Saved review')
    expect(storage.getItem('knightclub.review-reports.v1')).toBeNull()
  })

  it('falls through a corrupt newer duplicate and removes every duplicate on save', () => {
    const storage = new MemoryStorage()
    const valid = createPersistedReview(createPgnTimeline('1. e4'), report(), '2026-07-22T00:00:00.000Z')
    const corruptNewer = JSON.parse(JSON.stringify(valid)) as typeof valid
    corruptNewer.reviewedAt = '2026-07-23T00:00:00.000Z'
    corruptNewer.report.moves[0]!.to = 'd4'
    storage.setItem('knightclub.review-reports.v1', JSON.stringify([corruptNewer, valid]))

    // The newer envelope has the right shape but fails the source-line replay.
    // A valid older duplicate remains available instead of being shadowed.
    expect(loadBrowserReview(valid.reviewKey, storage)).toEqual(valid)

    saveBrowserReview(valid, storage)
    const persisted = JSON.parse(storage.getItem('knightclub.review-reports.v1') ?? '[]') as Array<typeof valid>
    expect(persisted.filter((item) => item.reviewKey === valid.reviewKey)).toEqual([valid])
  })

  it('keeps a 500-review browser mirror off the historical PGN replay path', () => {
    const storage = new MemoryStorage()
    const incoming = createPersistedReview(createPgnTimeline('1. e4'), report())
    const historical = Array.from({ length: 499 }, (_, index) => ({
      ...incoming,
      // These are syntactically valid legacy envelopes with intentionally
      // mismatched identities.  They must never be exposed without a direct,
      // fail-closed target validation, and must not all be replayed on save.
      reviewKey: browserReviewKey(index),
    }))
    storage.setItem('knightclub.review-reports.v1', JSON.stringify(historical))

    const move = vi.spyOn(Chess.prototype, 'move')
    try {
      saveBrowserReview(incoming, storage)
      expect(loadBrowserReview(incoming.reviewKey, storage)).toEqual(incoming)
      expect(JSON.parse(storage.getItem('knightclub.review-reports.v1') ?? '[]')).toHaveLength(500)
      // One new write and its requested read replay only that source line.
      // Replaying all 499 retained reports would be hundreds of calls here.
      expect(move.mock.calls.length).toBeLessThan(20)
    } finally {
      move.mockRestore()
    }
  })

  it('rejects incomplete, mismatched, or coach-unsafe report moves', () => {
    const record = createPersistedReview(createPgnTimeline('1. e4'), report())

    const incomplete = JSON.parse(JSON.stringify(record)) as Record<string, unknown>
    const incompleteReport = incomplete.report as { moves: unknown[] }
    incompleteReport.moves = []
    expect(() => assertPersistedReview(incomplete)).toThrow('Saved review')

    const mismatched = JSON.parse(JSON.stringify(record)) as Record<string, unknown>
    const mismatchedReport = mismatched.report as { moves: Array<Record<string, unknown>> }
    mismatchedReport.moves[0].to = 'd4'
    expect(() => assertPersistedReview(mismatched)).toThrow('Saved review')

    const missingScore = JSON.parse(JSON.stringify(record)) as Record<string, unknown>
    const missingScoreReport = missingScore.report as { moves: Array<Record<string, unknown>> }
    delete missingScoreReport.moves[0].bestScore
    expect(() => assertPersistedReview(missingScore)).toThrow('Saved review')
  })
})
