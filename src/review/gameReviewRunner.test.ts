import { describe, expect, it, vi } from 'vitest'
import { createPgnTimeline } from '../analysis/analysisModel'
import type { AnalysisResponse, AnalysisSettings } from '../analysis/stockfishAnalysisClient'
import { runGameReview } from './gameReviewRunner'

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
})
