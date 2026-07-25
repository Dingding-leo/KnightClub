import { describe, expect, it } from 'vitest'
import { GameSoundPlayer, soundPattern, soundRecipe } from './gameSounds'

describe('original synthesized game sounds', () => {
  it('uses distinct, short and safe patterns for each event', () => {
    const events = ['move', 'capture', 'check', 'game-end'] as const
    const patterns = events.map(soundPattern)
    expect(new Set(patterns.map((pattern) => JSON.stringify(pattern))).size).toBe(events.length)
    for (const pattern of patterns) {
      expect(pattern.length).toBeGreaterThan(0)
      expect(pattern.every((tone) => tone.frequency >= 100 && tone.frequency <= 1_500)).toBe(true)
      expect(pattern.reduce((sum, tone) => sum + tone.durationMs, 0)).toBeLessThanOrEqual(500)
    }
  })

  it('layers a short board transient under every cue instead of using pure beeps', () => {
    const events = ['move', 'capture', 'check', 'game-end'] as const
    for (const event of events) {
      const recipe = soundRecipe(event)
      expect(recipe.noise.length).toBeGreaterThan(0)
      expect(recipe.noise.every((burst) => (
        burst.frequency >= 300
        && burst.frequency <= 2_500
        && burst.gain > 0
        && burst.gain <= 0.25
        && burst.durationMs <= 80
      ))).toBe(true)
      expect(recipe.tones.some((tone) => tone.endFrequency !== undefined)).toBe(true)
    }
  })

  it('remains optional when the browser cannot provide Web Audio', () => {
    const player = new GameSoundPlayer()
    expect(() => player.play('move')).not.toThrow()
    player.dispose()
  })
})
