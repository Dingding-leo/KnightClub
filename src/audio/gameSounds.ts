export type GameSoundEvent = 'move' | 'capture' | 'check' | 'game-end'

export interface Tone {
  frequency: number
  durationMs: number
  gain: number
  wave: OscillatorType
  delayMs?: number
  endFrequency?: number
}

export interface NoiseBurst {
  frequency: number
  q: number
  durationMs: number
  gain: number
  delayMs?: number
}

export interface SoundRecipe {
  tones: readonly Tone[]
  noise: readonly NoiseBurst[]
}

// These sounds are intentionally synthesized from a small noisy transient
// and a low resonant body. It makes the feedback feel closer to a weighted
// piece landing on a board than a notification beep, while staying offline.
const recipes: Record<GameSoundEvent, SoundRecipe> = {
  move: {
    noise: [{ frequency: 1_180, q: 1.1, durationMs: 28, gain: 0.12 }],
    tones: [
      { frequency: 184, endFrequency: 112, durationMs: 66, gain: 0.19, wave: 'sine' },
      { frequency: 520, endFrequency: 350, durationMs: 34, gain: 0.035, wave: 'triangle', delayMs: 4 },
    ],
  },
  capture: {
    noise: [
      { frequency: 1_760, q: 1.5, durationMs: 28, gain: 0.17 },
      { frequency: 760, q: 1.15, durationMs: 36, gain: 0.09, delayMs: 26 },
    ],
    tones: [
      { frequency: 150, endFrequency: 76, durationMs: 104, gain: 0.23, wave: 'triangle' },
      { frequency: 260, endFrequency: 138, durationMs: 78, gain: 0.055, wave: 'sine', delayMs: 9 },
    ],
  },
  check: {
    noise: [{ frequency: 1_960, q: 1.7, durationMs: 24, gain: 0.12 }],
    tones: [
      { frequency: 224, endFrequency: 148, durationMs: 88, gain: 0.18, wave: 'triangle' },
      { frequency: 710, endFrequency: 628, durationMs: 106, gain: 0.05, wave: 'sine', delayMs: 23 },
    ],
  },
  'game-end': {
    noise: [
      { frequency: 1_320, q: 1.1, durationMs: 32, gain: 0.11 },
      { frequency: 980, q: 1, durationMs: 30, gain: 0.075, delayMs: 118 },
      { frequency: 820, q: 0.9, durationMs: 42, gain: 0.065, delayMs: 230 },
    ],
    tones: [
      { frequency: 196, endFrequency: 132, durationMs: 118, gain: 0.17, wave: 'sine' },
      { frequency: 294, endFrequency: 224, durationMs: 126, gain: 0.1, wave: 'sine', delayMs: 112 },
      { frequency: 392, endFrequency: 320, durationMs: 190, gain: 0.09, wave: 'sine', delayMs: 222 },
    ],
  },
}

export function soundPattern(event: GameSoundEvent): readonly Tone[] {
  return recipes[event].tones
}

export function soundRecipe(event: GameSoundEvent): SoundRecipe {
  return recipes[event]
}

export class GameSoundPlayer {
  private context: AudioContext | null = null
  private master: GainNode | null = null
  private compressor: DynamicsCompressorNode | null = null
  private noiseBuffer: AudioBuffer | null = null
  private resumeInFlight: Promise<boolean> | null = null
  private plays = 0

  private ensureGraph(): AudioContext | null {
    if (typeof AudioContext === 'undefined') return null
    try {
      this.context ??= new AudioContext()
      const context = this.context
      if (context.state === 'closed') return null
      if (!this.master || !this.compressor) {
        const master = context.createGain()
        const compressor = context.createDynamicsCompressor()
        master.gain.value = 0.42
        compressor.threshold.value = -18
        compressor.knee.value = 14
        compressor.ratio.value = 7
        compressor.attack.value = 0.003
        compressor.release.value = 0.16
        master.connect(compressor).connect(context.destination)
        this.master = master
        this.compressor = compressor
      }
      return context
    } catch {
      return null
    }
  }

  private getNoiseBuffer(context: AudioContext): AudioBuffer {
    if (this.noiseBuffer) return this.noiseBuffer
    const length = Math.max(1, Math.floor(context.sampleRate * 0.12))
    const buffer = context.createBuffer(1, length, context.sampleRate)
    const samples = buffer.getChannelData(0)
    let seed = 0x4f1bbcdc
    for (let index = 0; index < length; index += 1) {
      seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0
      const random = (seed / 0xffff_ffff) * 2 - 1
      const falloff = 1 - index / length
      samples[index] = random * falloff * falloff
    }
    this.noiseBuffer = buffer
    return buffer
  }

  private scheduleTone(context: AudioContext, tone: Tone, at: number, pitchOffset: number): void {
    const master = this.master
    if (!master) return
    const oscillator = context.createOscillator()
    const gain = context.createGain()
    const duration = tone.durationMs / 1_000
    const start = at + (tone.delayMs ?? 0) / 1_000
    const frequency = tone.frequency * pitchOffset
    const endFrequency = Math.max(42, (tone.endFrequency ?? tone.frequency * 0.82) * pitchOffset)
    oscillator.type = tone.wave
    oscillator.frequency.setValueAtTime(frequency, start)
    oscillator.frequency.exponentialRampToValueAtTime(endFrequency, start + duration)
    gain.gain.setValueAtTime(0.0001, start)
    gain.gain.exponentialRampToValueAtTime(tone.gain, start + Math.min(0.008, duration * 0.3))
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration)
    oscillator.connect(gain).connect(master)
    oscillator.start(start)
    oscillator.stop(start + duration + 0.015)
  }

  private scheduleNoise(context: AudioContext, burst: NoiseBurst, at: number): void {
    const master = this.master
    if (!master) return
    const source = context.createBufferSource()
    const filter = context.createBiquadFilter()
    const gain = context.createGain()
    const duration = burst.durationMs / 1_000
    const start = at + (burst.delayMs ?? 0) / 1_000
    source.buffer = this.getNoiseBuffer(context)
    filter.type = 'bandpass'
    filter.frequency.value = burst.frequency
    filter.Q.value = burst.q
    gain.gain.setValueAtTime(0.0001, start)
    gain.gain.exponentialRampToValueAtTime(burst.gain, start + Math.min(0.004, duration * 0.25))
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration)
    source.connect(filter).connect(gain).connect(master)
    source.start(start)
    source.stop(start + duration + 0.012)
  }

  private schedule(event: GameSoundEvent): void {
    const context = this.context
    if (!context || context.state !== 'running') return
    const recipe = soundRecipe(event)
    const pitchOffset = [0.985, 1, 1.018][this.plays % 3]
    this.plays += 1
    const at = context.currentTime + 0.006
    for (const burst of recipe.noise) this.scheduleNoise(context, burst, at)
    for (const tone of recipe.tones) this.scheduleTone(context, tone, at, pitchOffset)
  }

  async unlock(): Promise<boolean> {
    const context = this.ensureGraph()
    if (!context || context.state === 'closed') return false
    if (context.state === 'running') return true
    if (!this.resumeInFlight) {
      try {
        this.resumeInFlight = context.resume()
          .then(() => context.state === 'running')
          .catch(() => false)
          .finally(() => { this.resumeInFlight = null })
      } catch {
        return false
      }
    }
    return this.resumeInFlight
  }

  prime(): void {
    void this.unlock()
  }

  play(event: GameSoundEvent): void {
    const context = this.ensureGraph()
    if (!context) return
    if (context.state === 'running') {
      this.schedule(event)
      return
    }
    void this.unlock().then((unlocked) => {
      if (unlocked && this.context === context) this.schedule(event)
    })
  }

  dispose(): void {
    const context = this.context
    this.context = null
    this.master = null
    this.compressor = null
    this.noiseBuffer = null
    this.resumeInFlight = null
    if (context) void context.close().catch(() => undefined)
  }
}
