import { describe, expect, it, vi } from 'vitest'
import { Chess } from 'chess.js'
import { createPgnTimeline } from '../analysis/analysisModel'
import type { GameReview } from './gameReviewRunner'
import {
  createPersistedReview,
  MAX_REVIEW_PLIES,
  preparedPersistedReviewMetadata,
  saveBrowserPreparedReview,
  type PersistedReview,
} from './reviewPersistence'
import {
  ReviewPersistenceClient,
  ReviewPersistenceQueue,
  type ReviewPersistenceWorkerLike,
} from './reviewPersistenceClient'
import type {
  ReviewPersistenceRequest,
  ReviewPersistenceResponse,
} from './reviewPersistenceProtocol'

class MemoryStorage {
  private values = new Map<string, string>()

  getItem(key: string): string | null { return this.values.get(key) ?? null }
  setItem(key: string, value: string): void { this.values.set(key, value) }
  removeItem(key: string): void { this.values.delete(key) }
}

class FakeReviewPersistenceWorker implements ReviewPersistenceWorkerLike {
  onmessage: ((event: MessageEvent<ReviewPersistenceResponse>) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  readonly messages: ReviewPersistenceRequest[] = []
  terminated = false

  postMessage(message: ReviewPersistenceRequest): void {
    this.messages.push(message)
  }

  terminate(): void {
    this.terminated = true
  }

  reply(response: ReviewPersistenceResponse): void {
    this.onmessage?.({ data: response } as MessageEvent<ReviewPersistenceResponse>)
  }

  failToStart(): void {
    this.onerror?.({ message: 'Worker module blocked.' } as ErrorEvent)
  }
}

function repeatedKnightPgn(plies: number): string {
  const game = new Chess()
  const cycle = ['Nf3', 'Nf6', 'Ng1', 'Ng8']
  for (let index = 0; index < plies; index += 1) game.move(cycle[index % cycle.length]!)
  return game.pgn()
}

function reportFor(timeline: ReturnType<typeof createPgnTimeline>): GameReview {
  return {
    createdAt: '2026-07-23T00:00:00.000Z',
    engineName: 'Fakefish',
    enginePath: '/fake',
    settings: { moveTimeMs: 100, depth: 12, nodes: null, multiPv: 1, threads: 1, hashMb: 16 },
    totalElapsedMs: 1,
    moves: timeline.moves.map((move) => ({
      ...move,
      classification: 'best' as const,
      accuracy: 100,
      centipawnLoss: 0,
      expectedLoss: 0,
      bestMoveUci: `${move.from}${move.to}${move.promotion ?? ''}`,
      bestMoveSan: move.san,
      isBestMove: true,
      phase: 'opening' as const,
      bestScore: { kind: 'cp' as const, value: 0, bound: null },
      playedScore: { kind: 'cp' as const, value: 0, bound: null },
      bestLineSan: [move.san],
      depth: 12,
      confidence: 'normal' as const,
      feedback: 'Fixture.',
    })),
    summary: {
      accuracy: 100,
      whiteAccuracy: 100,
      blackAccuracy: 100,
      averageCentipawnLoss: 0,
      bestMoveRate: 100,
      classifications: {
        brilliant: 0, great: 0, best: timeline.moves.length, excellent: 0,
        good: 0, book: 0, inaccuracy: 0, mistake: 0, miss: 0, blunder: 0, forced: 0,
      },
      phaseAccuracy: { opening: 100, middlegame: null, endgame: null },
      turningPoints: [],
    },
  }
}

function reviewFixture(plies = 4): PersistedReview {
  const timeline = createPgnTimeline(repeatedKnightPgn(plies))
  return createPersistedReview(timeline, reportFor(timeline), '2026-07-23T00:00:00.000Z')
}

let longFixture: PersistedReview | null = null

function fullLengthFixture(): PersistedReview {
  if (longFixture) return longFixture
  longFixture = reviewFixture(MAX_REVIEW_PLIES)
  return longFixture
}

function inputFor(record: PersistedReview) {
  const expected = {
    reviewKey: record.reviewKey,
    sourcePgn: record.sourcePgn,
    startFen: record.startFen,
    moveCount: record.moveCount,
    reviewedAt: record.reviewedAt,
  }
  return { sourcePgn: record.sourcePgn, expected, report: structuredClone(record.report) }
}

describe('ReviewPersistenceClient', () => {
  it('does not start a Worker until a completed report is ready to save', () => {
    let starts = 0
    const client = new ReviewPersistenceClient(() => {
      starts += 1
      return new FakeReviewPersistenceWorker()
    }, true)

    expect(starts).toBe(0)
    client.dispose()
  })

  it('accepts a matching Worker snapshot as an opaque prepared save', async () => {
    const record = reviewFixture()
    const worker = new FakeReviewPersistenceWorker()
    const client = new ReviewPersistenceClient(() => worker, true)
    const pending = client.prepare(inputFor(record))
    const request = worker.messages[0]
    if (!request) throw new Error('Expected a persistence request.')

    worker.reply({ type: 'review-persistence-result', id: request.id, record: structuredClone(record) })

    const prepared = await pending
    expect(preparedPersistedReviewMetadata(prepared)).toEqual({ reviewKey: record.reviewKey })
    expect(worker.terminated).toBe(true)
    client.dispose()
  })

  it('keeps a full 1,024-ply completed save off the UI-thread chess replay path', async () => {
    const record = fullLengthFixture()
    const worker = new FakeReviewPersistenceWorker()
    const client = new ReviewPersistenceClient(() => worker, true)
    const storage = new MemoryStorage()
    const move = vi.spyOn(Chess.prototype, 'move')
    const loadPgn = vi.spyOn(Chess.prototype, 'loadPgn')
    try {
      const pending = client.prepare(inputFor(record))
      const request = worker.messages[0]
      if (!request) throw new Error('Expected a persistence request.')
      worker.reply({ type: 'review-persistence-result', id: request.id, record: structuredClone(record) })

      const prepared = await pending
      saveBrowserPreparedReview(prepared, storage)

      expect(loadPgn).not.toHaveBeenCalled()
      expect(move).not.toHaveBeenCalled()
      expect(JSON.parse(storage.getItem('knightclub.review-reports.v1') ?? '[]')).toHaveLength(1)
    } finally {
      loadPgn.mockRestore()
      move.mockRestore()
      client.dispose()
    }
  })

  it('fails closed when Worker output does not match the exact completed source', async () => {
    const record = reviewFixture()
    const worker = new FakeReviewPersistenceWorker()
    const client = new ReviewPersistenceClient(() => worker, true)
    const pending = client.prepare(inputFor(record))
    const request = worker.messages[0]
    if (!request) throw new Error('Expected a persistence request.')
    const mismatch = structuredClone(record)
    mismatch.reviewedAt = '2026-07-24T00:00:00.000Z'

    worker.reply({ type: 'review-persistence-result', id: request.id, record: mismatch })

    await expect(pending).rejects.toThrow('mismatched result')
    expect(worker.terminated).toBe(true)
    client.dispose()
  })

  it('fails visibly instead of falling back to UI-thread review creation when Workers are unavailable', async () => {
    const record = fullLengthFixture()
    const client = new ReviewPersistenceClient(() => {
      throw new Error('Workers unavailable')
    }, false)
    const move = vi.spyOn(Chess.prototype, 'move')
    const loadPgn = vi.spyOn(Chess.prototype, 'loadPgn')
    try {
      await expect(client.prepare(inputFor(record))).rejects.toThrow(
        'This completed review needs a local background Worker to save safely.',
      )
      expect(loadPgn).not.toHaveBeenCalled()
      expect(move).not.toHaveBeenCalled()
    } finally {
      loadPgn.mockRestore()
      move.mockRestore()
      client.dispose()
    }
  })

  it('releases a failed constructed Worker without preparing on the UI thread', async () => {
    const worker = new FakeReviewPersistenceWorker()
    const client = new ReviewPersistenceClient(() => worker, true)
    const pending = client.prepare(inputFor(reviewFixture()))

    worker.failToStart()

    await expect(pending).rejects.toThrow('This completed review needs a local background Worker to save safely.')
    expect(worker.terminated).toBe(true)
    client.dispose()
  })
})

describe('ReviewPersistenceQueue', () => {
  it('serializes detached long-review preparation rather than running Worker replays together', async () => {
    const record = reviewFixture()
    const workers: FakeReviewPersistenceWorker[] = []
    const client = new ReviewPersistenceClient(() => {
      const worker = new FakeReviewPersistenceWorker()
      workers.push(worker)
      return worker
    }, true)
    const queue = new ReviewPersistenceQueue(client)
    const first = queue.prepare(inputFor(record))
    const second = queue.prepare(inputFor(record))
    await Promise.resolve()
    await Promise.resolve()
    const firstRequest = workers[0]?.messages[0]
    if (!firstRequest) throw new Error('Expected the first persistence request.')

    expect(workers).toHaveLength(1)
    workers[0]?.reply({ type: 'review-persistence-result', id: firstRequest.id, record: structuredClone(record) })
    await first
    await Promise.resolve()
    await Promise.resolve()

    const secondRequest = workers[1]?.messages[0]
    if (!secondRequest) throw new Error('Expected the queued persistence request.')
    workers[1]?.reply({ type: 'review-persistence-result', id: secondRequest.id, record: structuredClone(record) })
    await expect(second).resolves.toBeDefined()
    queue.dispose()
  })
})
