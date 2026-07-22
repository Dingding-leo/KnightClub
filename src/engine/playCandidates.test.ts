import { describe, expect, it } from 'vitest'
import { normalizePlayCandidates, parseUciMove, uciForMove } from './playCandidates'

describe('play candidate normalization', () => {
  it('keeps only unique, safe first and second principal variations', () => {
    expect(normalizePlayCandidates([
      {
        multiPv: 2,
        depth: 14,
        score: { kind: 'cp', value: 12, bound: null },
        pv: ['d2d4', 'd7d5'],
      },
      {
        multiPv: 1,
        depth: 15,
        score: { kind: 'cp', value: 28, bound: null },
        pv: ['g1f3'],
      },
      {
        multiPv: 2,
        depth: 99,
        score: { kind: 'cp', value: 999, bound: null },
        pv: ['e2e4'],
      },
      {
        multiPv: 3,
        depth: 15,
        score: { kind: 'cp', value: 1, bound: null },
        pv: ['e2e4'],
      },
      {
        multiPv: 1,
        depth: 15,
        score: { kind: 'cp', value: 1, bound: null },
        pv: ['e2e9'],
      },
    ])).toEqual([
      {
        multiPv: 1,
        depth: 15,
        score: { kind: 'cp', value: 28, bound: null },
        move: { from: 'g1', to: 'f3', promotion: undefined },
      },
      {
        multiPv: 2,
        depth: 14,
        score: { kind: 'cp', value: 12, bound: null },
        move: { from: 'd2', to: 'd4', promotion: undefined },
      },
    ])
  })

  it('parses and serializes legal promotion moves without accepting unsafe UCI', () => {
    const promotion = parseUciMove('e7e8q')
    expect(promotion).toEqual({ from: 'e7', to: 'e8', promotion: 'q' })
    expect(promotion && uciForMove(promotion)).toBe('e7e8q')
    expect(parseUciMove('quit')).toBeNull()
  })
})
