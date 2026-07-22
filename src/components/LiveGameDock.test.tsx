import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createClock, createCustomTimeControl, pauseClock } from '../domain/clock'
import { shouldShowLiveGameDock } from '../domain/liveGameDock'
import { ClockRuntime } from './ClockRuntime'
import { LiveGameDock } from './LiveGameDock'

function renderDock(visible: boolean, clock = createClock(createCustomTimeControl(5, 0, 0), 'w', Date.now())) {
  return renderToStaticMarkup(
    <ClockRuntime state={clock} gameFinished={false} onTick={vi.fn()} onFlag={vi.fn()}>
      <LiveGameDock visible={visible} onReturnToGame={vi.fn()} />
    </ClockRuntime>,
  )
}

afterEach(() => vi.restoreAllMocks())

describe('LiveGameDock', () => {
  it('keeps an off-board timed game visible without making its clocks chatty', () => {
    vi.spyOn(Date, 'now').mockReturnValue(300_000)
    const markup = renderDock(true, createClock(createCustomTimeControl(5, 0, 0), 'w', 300_000))

    expect(markup).toContain('aria-label="Live game"')
    expect(markup).toContain('White to move')
    expect(markup).toContain('aria-label="White time 5:00"')
    expect(markup).toContain('aria-label="Black time 5:00"')
    expect(markup).toContain('aria-live="off"')
    expect(markup).toContain('aria-label="Return to live game"')
  })

  it('describes a paused clock and hides cleanly when no dock is needed', () => {
    const control = createCustomTimeControl(5, 0, 0)
    const paused = pauseClock(createClock(control, 'b', 0), 1_000)

    expect(renderDock(true, paused)).toContain('Paused · Black to move')
    expect(renderDock(false)).toBe('')
  })

  it('appears only after a timed game has started or been intentionally paused', () => {
    const control = createCustomTimeControl(5, 0, 0)
    const ready = { ...createClock(control, 'w', 0), turnStartedAtMs: null }
    const running = createClock(control, 'w', 0)
    const paused = pauseClock(running, 1_000)

    expect(shouldShowLiveGameDock({ outsidePlay: true, gameFinished: false, clock: ready })).toBe(false)
    expect(shouldShowLiveGameDock({ outsidePlay: true, gameFinished: false, clock: running })).toBe(true)
    expect(shouldShowLiveGameDock({ outsidePlay: true, gameFinished: false, clock: paused })).toBe(true)
    expect(shouldShowLiveGameDock({ outsidePlay: false, gameFinished: false, clock: running })).toBe(false)
    expect(shouldShowLiveGameDock({ outsidePlay: true, gameFinished: true, clock: running })).toBe(false)
  })
})
