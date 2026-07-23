import { describe, expect, it, vi } from 'vitest'
import type { ActiveSession } from './gameStore'
import {
  ActiveSessionPersistence,
  createBrowserIdleTaskPort,
  type DeferredTaskPort,
} from './activeSessionPersistence'

function session(pgn: string): ActiveSession {
  return {
    pgn,
    startFen: 'start',
    mode: 'bot',
    botLevel: 'balanced',
    orientation: 'white',
  }
}

function controlledDeferredPort() {
  const tasks: Array<() => void> = []
  const cancel = vi.fn()
  const port: DeferredTaskPort = {
    schedule(task) {
      tasks.push(task)
      return cancel
    },
  }
  return { port, tasks, cancel }
}

describe('active session persistence', () => {
  it('writes only the latest snapshot when several moves arrive before idle time', () => {
    const persist = vi.fn()
    const { port, tasks } = controlledDeferredPort()
    const writer = new ActiveSessionPersistence(persist, port)

    writer.schedule(session('after white'))
    writer.schedule(session('after black'))
    expect(tasks).toHaveLength(1)
    expect(persist).not.toHaveBeenCalled()

    tasks[0]!()
    expect(persist).toHaveBeenCalledTimes(1)
    expect(persist).toHaveBeenCalledWith(session('after black'))
  })

  it('flushes the newest session once and makes the prior idle callback harmless', () => {
    const persist = vi.fn()
    const { port, tasks, cancel } = controlledDeferredPort()
    const writer = new ActiveSessionPersistence(persist, port)

    writer.schedule(session('first'))
    writer.schedule(session('latest'))
    writer.flush()

    expect(cancel).toHaveBeenCalledTimes(1)
    expect(persist).toHaveBeenCalledExactlyOnceWith(session('latest'))
    tasks[0]!()
    expect(persist).toHaveBeenCalledTimes(1)
  })

  it('discards an obsolete snapshot before a restart or explicit clear', () => {
    const persist = vi.fn()
    const { port, tasks, cancel } = controlledDeferredPort()
    const writer = new ActiveSessionPersistence(persist, port)

    writer.schedule(session('unfinished game'))
    writer.discard()
    writer.schedule(session('replacement game'))
    tasks[0]!()

    expect(cancel).toHaveBeenCalledTimes(1)
    expect(persist).not.toHaveBeenCalled()
    tasks[1]!()
    expect(persist).toHaveBeenCalledExactlyOnceWith(session('replacement game'))
  })

  it('waits for a debounce and browser idle slot before persisting', () => {
    const timers: Array<() => void> = []
    const idleTasks: Array<() => void> = []
    const runtime = {
      setTimeout(callback: () => void) {
        timers.push(callback)
        return timers.length
      },
      clearTimeout: vi.fn(),
      requestIdleCallback(callback: () => void) {
        idleTasks.push(callback)
        return idleTasks.length
      },
      cancelIdleCallback: vi.fn(),
    }
    const task = vi.fn()
    const port = createBrowserIdleTaskPort(runtime, 250)

    port.schedule(task)
    expect(task).not.toHaveBeenCalled()
    timers[0]!()
    expect(task).not.toHaveBeenCalled()
    expect(idleTasks).toHaveLength(1)
    idleTasks[0]!()
    expect(task).toHaveBeenCalledExactlyOnceWith()
  })
})
