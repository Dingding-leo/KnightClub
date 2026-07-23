import type { ActiveSession } from './gameStore'

/**
 * The browser's synchronous storage API is useful as a last-resort recovery
 * mirror, but serialising a long PGN and clock history on every ply can make a
 * move feel sticky. Hold the latest snapshot until the browser has been idle;
 * callers can still flush it synchronously for terminal states and page exits.
 */
export interface DeferredTaskPort {
  schedule(task: () => void): () => void
}

interface BrowserIdleRuntime {
  setTimeout(callback: () => void, delay?: number): number
  clearTimeout(handle: number): void
  requestIdleCallback?: (callback: () => void, options?: { timeout?: number }) => number
  cancelIdleCallback?: (handle: number) => void
}

export const ACTIVE_SESSION_SAVE_DELAY_MS = 250
const ACTIVE_SESSION_IDLE_TIMEOUT_MS = 1_000

/**
 * Defer briefly, then use an idle slot when available. The timeout keeps a
 * quiet game durable even on a page that never reports an idle period.
 */
export function createBrowserIdleTaskPort(
  runtime: BrowserIdleRuntime = globalThis as unknown as BrowserIdleRuntime,
  delayMs = ACTIVE_SESSION_SAVE_DELAY_MS,
): DeferredTaskPort {
  return {
    schedule(task) {
      let cancelled = false
      let timer: number | null = runtime.setTimeout(() => {
        timer = null
        if (cancelled) return
        if (!runtime.requestIdleCallback) {
          task()
          return
        }
        idle = runtime.requestIdleCallback(() => {
          idle = null
          if (!cancelled) task()
        }, { timeout: ACTIVE_SESSION_IDLE_TIMEOUT_MS })
      }, delayMs)
      let idle: number | null = null

      return () => {
        cancelled = true
        if (timer !== null) runtime.clearTimeout(timer)
        if (idle !== null) runtime.cancelIdleCallback?.(idle)
        timer = null
        idle = null
      }
    },
  }
}

/** Latest-wins active-session writer with explicit durability boundaries. */
export class ActiveSessionPersistence {
  private pending: ActiveSession | null = null
  private cancelScheduled: (() => void) | null = null
  private generation = 0
  private readonly persist: (session: ActiveSession) => void
  private readonly deferred: DeferredTaskPort

  constructor(
    persist: (session: ActiveSession) => void,
    deferred: DeferredTaskPort = createBrowserIdleTaskPort(),
  ) {
    this.persist = persist
    this.deferred = deferred
  }

  schedule(session: ActiveSession): void {
    this.pending = session
    if (this.cancelScheduled) return
    const generation = this.generation
    this.cancelScheduled = this.deferred.schedule(() => {
      // A browser can deliver a callback that was cancelled just as it became
      // runnable. Never let that old slot consume a newer post-restart game.
      if (generation !== this.generation) return
      this.cancelScheduled = null
      this.commitPending()
    })
  }

  /** Writes the latest pending snapshot now, for pagehide and terminal games. */
  flush(): void {
    this.generation += 1
    this.cancelScheduled?.()
    this.cancelScheduled = null
    this.commitPending()
  }

  /** Drops an old snapshot before a restart or explicit clear can replace it. */
  discard(): void {
    this.generation += 1
    this.cancelScheduled?.()
    this.cancelScheduled = null
    this.pending = null
  }

  private commitPending(): void {
    const session = this.pending
    this.pending = null
    if (session) this.persist(session)
  }
}
