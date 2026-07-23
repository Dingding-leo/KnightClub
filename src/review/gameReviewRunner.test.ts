import { describe, expect, it, vi } from 'vitest'
import { createPgnTimeline, type AnalysisTimeline } from '../analysis/analysisModel'
import type { AnalysisResponse, AnalysisSettings } from '../analysis/stockfishAnalysisClient'
import { createPersistedReview, MAX_REVIEW_PLIES } from './reviewPersistence'
import { runGameReview, runResumableGameReview, type ReviewCheckpoint } from './gameReviewRunner'

const settings: AnalysisSettings = { moveTimeMs: 100, depth: 12, nodes: null, multiPv: 2, threads: 1, hashMb: 16 }

function response(fen: string, move: string, score = 0): AnalysisResponse {
  return {
    requestId: 1,
    fen,
    engineName: 'Fakefish',
    enginePath: '/fake',
    elapsedMs: 10,
    bestMove: move,
    lines: [{
      multiPv: 1, depth: 12, seldepth: null,
      score: { kind: 'cp', value: score, bound: null }, wdl: null,
      nodes: 10, nps: 1000, hashfull: 0, tbHits: 0, timeMs: 10, pv: [move],
    }],
  }
}

describe('full-game review runner', () => {
  it('rejects an over-limit game before starting any Stockfish work', async () => {
    const timeline = {
      moves: Array.from({ length: MAX_REVIEW_PLIES + 1 }, (_, index) => ({ ply: index + 1 })),
      positions: [],
    } as unknown as AnalysisTimeline
    const analyze = vi.fn()

    await expect(runGameReview(timeline, analyze, settings)).rejects.toThrow(`Full-game reviews support up to ${MAX_REVIEW_PLIES.toLocaleString()} plies.`)
    expect(analyze).not.toHaveBeenCalled()
  })

  it('reuses each after-position as the next ply before analysis and reports monotonic progress', async () => {
    const timeline = createPgnTimeline('1. e4 e5')
    const moves = ['e2e4', 'e7e5', 'g1f3']
    const analyze = vi.fn(async (fen: string, _requestedSettings: AnalysisSettings) => response(fen, moves.shift()!))
    const progress: Array<{ completedPly: number, stage: string }> = []
    const result = await runGameReview(timeline, analyze, { ...settings, multiPv: 1 }, (value) => {
      progress.push({ completedPly: value.completedPly, stage: value.stage })
    })
    expect(analyze).toHaveBeenCalledTimes(3)
    expect(analyze.mock.calls.map(([fen]) => fen)).toEqual(timeline.positions.map((position) => position.fen))
    expect(analyze.mock.calls.map(([, requestedSettings]) => requestedSettings)).toEqual([
      { ...settings, multiPv: 2 },
      { ...settings, multiPv: 2 },
      { ...settings, multiPv: 1 },
    ])
    expect(progress).toEqual([
      { completedPly: 0, stage: 'before' },
      { completedPly: 0, stage: 'after' },
      { completedPly: 1, stage: 'before' },
      { completedPly: 1, stage: 'after' },
      { completedPly: 2, stage: 'before' },
    ])
    expect(result.moves).toHaveLength(2)
    expect(result.engineName).toBe('Fakefish')
    expect(result.settings).toEqual({ ...settings, multiPv: 2 })
    expect(result.totalElapsedMs).toBe(30)
  })

  it('uses the reused next-position PV from the mover perspective', async () => {
    const timeline = createPgnTimeline('1. a3')
    const analyze = vi.fn(async (fen: string) => {
      const isStart = fen === timeline.positions[0].fen
      return response(fen, isStart ? 'e2e4' : 'e7e5', isStart ? 100 : -80)
    })
    const result = await runGameReview(timeline, analyze, settings)
    expect(result.moves[0]).toMatchObject({
      bestScore: { kind: 'cp', value: 100 },
      playedScore: { kind: 'cp', value: 80 },
      isBestMove: false,
    })
    expect(result.moves[0].expectedLoss).toBeGreaterThan(0)
  })

  it('stops before the next engine request when aborted', async () => {
    const timeline = createPgnTimeline('1. e4 e5 2. Nf3')
    const controller = new AbortController()
    const analyze = vi.fn(async (fen: string) => {
      controller.abort()
      return response(fen, 'e2e4')
    })
    await expect(runGameReview(timeline, analyze, settings, undefined, controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(analyze).toHaveBeenCalledTimes(1)
  })

  it('does not report the next ply as ready when its reused analysis is cancelled', async () => {
    const timeline = createPgnTimeline('1. e4 e5')
    const controller = new AbortController()
    const progress: Array<{ completedPly: number, stage: string }> = []
    const analyze = vi.fn(async (fen: string) => {
      if (analyze.mock.calls.length === 2) controller.abort()
      return response(fen, 'e2e4')
    })
    await expect(runGameReview(timeline, analyze, settings, (value) => {
      progress.push({ completedPly: value.completedPly, stage: value.stage })
    }, controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(analyze).toHaveBeenCalledTimes(2)
    expect(progress).toEqual([
      { completedPly: 0, stage: 'before' },
      { completedPly: 0, stage: 'after' },
    ])
  })

  it('uses the rules-layer result instead of asking Stockfish to analyse checkmate', async () => {
    const timeline = createPgnTimeline('1. f3 e5 2. g4 Qh4# 0-1')
    const replies = ['f2f3', 'e7e5', 'g2g4', 'd8h4']
    const analyze = vi.fn(async (fen: string) => response(fen, replies.shift()!))
    const result = await runGameReview(timeline, analyze, settings)
    expect(analyze).toHaveBeenCalledTimes(4)
    expect(analyze.mock.calls.map(([fen]) => fen)).toEqual(timeline.positions.slice(0, -1).map((position) => position.fen))
    expect(result.moves[3]).toMatchObject({ san: 'Qh4#', isBestMove: true, accuracy: 100 })
  })

  it('keeps a contiguous in-memory checkpoint and resumes without repeating its next baseline', async () => {
    const timeline = createPgnTimeline('1. e4 e5 2. Nf3')
    const controller = new AbortController()
    const checkpoints: ReviewCheckpoint[] = []
    const firstMoves = ['e2e4', 'e7e5']
    const firstAnalyze = vi.fn(async (fen: string) => response(fen, firstMoves.shift()!))

    await expect(runResumableGameReview(timeline, firstAnalyze, settings, {
      signal: controller.signal,
      onCheckpoint: (checkpoint) => {
        checkpoints.push(checkpoint)
        controller.abort()
      },
    })).rejects.toMatchObject({ name: 'AbortError' })

    expect(firstAnalyze).toHaveBeenCalledTimes(2)
    expect(checkpoints).toHaveLength(1)
    const [checkpoint] = checkpoints
    if (!checkpoint) throw new Error('Expected an in-memory review checkpoint.')
    expect(checkpoint).toMatchObject({ completedPly: 1, totalPly: 3 })
    expect(checkpoint.report.moves).toHaveLength(1)
    expect(checkpoint.nextBefore.fen).toBe(timeline.positions[1]!.fen)
    expect(() => createPersistedReview(timeline, checkpoint.report)).toThrow('Saved review does not match its source game.')

    const resumedMoves = ['g1f3', 'b8c6']
    const resumedAnalyze = vi.fn(async (fen: string) => response(fen, resumedMoves.shift()!))
    const result = await runResumableGameReview(timeline, resumedAnalyze, settings, { resumeFrom: checkpoint })

    expect(resumedAnalyze.mock.calls.map(([fen]) => fen)).toEqual([
      timeline.positions[2]!.fen,
      timeline.positions[3]!.fen,
    ])
    expect(result.moves).toHaveLength(3)
    expect(result.totalElapsedMs).toBe(40)
  })

  it('does not publish a second checkpoint when the next move is cancelled mid-search', async () => {
    const timeline = createPgnTimeline('1. e4 e5 2. Nf3')
    const controller = new AbortController()
    const checkpoints: ReviewCheckpoint[] = []
    const replies = ['e2e4', 'e7e5', 'g1f3']
    const analyze = vi.fn(async (fen: string) => {
      if (analyze.mock.calls.length === 3) controller.abort()
      return response(fen, replies.shift()!)
    })

    await expect(runResumableGameReview(timeline, analyze, settings, {
      signal: controller.signal,
      onCheckpoint: (checkpoint) => checkpoints.push(checkpoint),
    })).rejects.toMatchObject({ name: 'AbortError' })

    expect(analyze).toHaveBeenCalledTimes(3)
    expect(checkpoints.map((checkpoint) => checkpoint.completedPly)).toEqual([1])
  })

  it('rejects a stale checkpoint before it starts another engine request', async () => {
    const timeline = createPgnTimeline('1. e4 e5 2. Nf3')
    const controller = new AbortController()
    const checkpoints: ReviewCheckpoint[] = []
    const replies = ['e2e4', 'e7e5']
    const initialAnalyze = vi.fn(async (fen: string) => response(fen, replies.shift()!))

    await expect(runResumableGameReview(timeline, initialAnalyze, settings, {
      signal: controller.signal,
      onCheckpoint: (value) => {
        checkpoints.push(value)
        controller.abort()
      },
    })).rejects.toMatchObject({ name: 'AbortError' })

    const checkpoint = checkpoints[0]
    if (!checkpoint) throw new Error('Expected an in-memory review checkpoint.')
    const stale = {
      ...checkpoint,
      nextBefore: { ...checkpoint.nextBefore, fen: timeline.positions[0]!.fen },
    }
    const analyze = vi.fn()
    await expect(runResumableGameReview(timeline, analyze, settings, { resumeFrom: stale }))
      .rejects.toThrow('partial review no longer matches')
    expect(analyze).not.toHaveBeenCalled()
  })

  it('refuses to mix a resumed checkpoint with a different engine runtime', async () => {
    const timeline = createPgnTimeline('1. e4 e5 2. Nf3')
    const controller = new AbortController()
    const checkpoints: ReviewCheckpoint[] = []
    const replies = ['e2e4', 'e7e5']

    await expect(runResumableGameReview(
      timeline,
      async (fen: string) => response(fen, replies.shift()!),
      settings,
      {
        signal: controller.signal,
        onCheckpoint: (checkpoint) => {
          checkpoints.push(checkpoint)
          controller.abort()
        },
      },
    )).rejects.toMatchObject({ name: 'AbortError' })

    const checkpoint = checkpoints[0]
    if (!checkpoint) throw new Error('Expected an in-memory review checkpoint.')
    const changedEngine = vi.fn(async (fen: string) => ({
      ...response(fen, 'g1f3'),
      engineName: 'Differentfish',
    }))

    await expect(runResumableGameReview(timeline, changedEngine, settings, { resumeFrom: checkpoint }))
      .rejects.toThrow('local engine changed')
    expect(changedEngine).toHaveBeenCalledTimes(1)
  })

  it('does not offer a resumable checkpoint when a terminal final move completes', async () => {
    const timeline = createPgnTimeline('1. f3 e5 2. g4 Qh4# 0-1')
    const replies = ['f2f3', 'e7e5', 'g2g4', 'd8h4']
    const checkpoints = vi.fn()

    await runResumableGameReview(
      timeline,
      async (fen: string) => response(fen, replies.shift()!),
      settings,
      { onCheckpoint: checkpoints },
    )

    // The first three moves can be resumed, while the terminal fourth move
    // completes the report and therefore never leaves a dangling checkpoint.
    expect(checkpoints).toHaveBeenCalledTimes(3)
    expect(checkpoints.mock.calls.at(-1)?.[0]).toMatchObject({ completedPly: 3, totalPly: 4 })
  })
})
