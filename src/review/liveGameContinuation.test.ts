import { describe, expect, it } from 'vitest'
import { createFenTimeline, createPgnTimeline } from '../analysis/analysisModel'
import { STANDARD_START_FEN } from '../domain/chess'
import { liveGameContinuation } from './liveGameContinuation'

describe('liveGameContinuation', () => {
  it('recognises a strict live extension and identifies its newest move', () => {
    const review = createPgnTimeline('1. e4 e5 2. Nf3')
    const live = createPgnTimeline('1. e4 e5 2. Nf3 Nc6')

    expect(liveGameContinuation(review, live)).toEqual({
      addedPly: 1,
      latestMove: live.moves[3],
    })
  })

  it('rejects equal, shortened, divergent and non-PGN timelines', () => {
    const review = createPgnTimeline('1. e4 e5 2. Nf3')
    const live = createPgnTimeline('1. e4 e5 2. Nf3 Nc6')
    const divergent = createPgnTimeline('1. e4 c5 2. Nf3 Nc6')

    expect(liveGameContinuation(review, review)).toBeNull()
    expect(liveGameContinuation(live, review)).toBeNull()
    expect(liveGameContinuation(review, divergent)).toBeNull()
    expect(liveGameContinuation(createFenTimeline(STANDARD_START_FEN), live)).toBeNull()
    expect(liveGameContinuation(review, { ...live, startFen: 'different-start-position' })).toBeNull()
  })
})
