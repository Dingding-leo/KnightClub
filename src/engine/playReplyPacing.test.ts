import { describe, expect, it } from 'vitest'
import {
  PLAY_REPLY_DISPLAY_FLOOR_MS,
  remainingPlayReplyPacingMs,
} from './playReplyPacing'

describe('Play reply presentation pacing', () => {
  it('keeps a short, ordered confirmation for every low-compute level', () => {
    expect(PLAY_REPLY_DISPLAY_FLOOR_MS).toEqual({
      easy: 140,
      balanced: 180,
      strong: 220,
    })
  })

  it('waits only for the part of that short floor the reply did not already consume', () => {
    expect(remainingPlayReplyPacingMs('balanced', 0)).toBe(180)
    expect(remainingPlayReplyPacingMs('balanced', 75)).toBe(105)
    expect(remainingPlayReplyPacingMs('balanced', 180)).toBe(0)
    expect(remainingPlayReplyPacingMs('balanced', 500)).toBe(0)
  })

  it('does not turn an invalid elapsed clock into a negative or instant delay', () => {
    expect(remainingPlayReplyPacingMs('easy', -1)).toBe(140)
    expect(remainingPlayReplyPacingMs('strong', Number.NaN)).toBe(220)
  })
})
