import type { ClockState } from './clock'

/**
 * A ready clock has an active side before its first move, but no time is
 * charging. Keep the cross-workspace reminder reserved for a running or
 * intentionally paused timed game.
 */
export function shouldShowLiveGameDock(input: {
  outsidePlay: boolean
  gameFinished: boolean
  clock: ClockState
}): boolean {
  return input.outsidePlay
    && !input.gameFinished
    && input.clock.control.initialMs !== null
    && (input.clock.turnStartedAtMs !== null || input.clock.pausedColor !== null)
}
