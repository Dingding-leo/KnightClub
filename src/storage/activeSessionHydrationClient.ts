import type { ActiveSession } from './gameStore'
import {
  hydrateActiveSession,
  hydrateActiveSessionRaw,
  hydrateStoredGame,
  reviveHydratedActiveSession,
  reviveHydratedStoredGame,
  type HydratedActiveSession,
  type HydratedStoredGame,
} from './activeSessionHydration'
import type {
  ActiveSessionHydrationRequest,
  ActiveSessionHydrationResponse,
} from './activeSessionHydrationProtocol'

/** Long mirrors defer all JSON and chess replay until after Play's first paint. */
export const BACKGROUND_ACTIVE_SESSION_HYDRATION_THRESHOLD_CHARS = 2 * 1024

export interface ActiveSessionHydrationWorkerLike {
  onmessage: ((event: MessageEvent<ActiveSessionHydrationResponse>) => void) | null
  onerror: ((event: ErrorEvent) => void) | null
  postMessage(message: ActiveSessionHydrationRequest): void
  terminate(): void
}

export type ActiveSessionHydrationWorkerFactory = () => ActiveSessionHydrationWorkerLike

type PendingRequest = {
  id: number
  request: ActiveSessionHydrationRequest
  resolve: (value: HydrationValue) => void
  reject: (reason: Error) => void
}

type ActiveSessionHydrationInput =
  | { type: 'hydrate-active-session-raw'; raw: string | null }
  | { type: 'hydrate-active-session'; session: ActiveSession | null }
  | { type: 'hydrate-stored-game'; pgn: string }

type HydrationValue = HydratedActiveSession | HydratedStoredGame | null

function abortError(message: string): Error {
  return new DOMException(message, 'AbortError')
}

function canUseWorker(): boolean {
  return typeof Worker === 'function'
}

function defaultWorkerFactory(): ActiveSessionHydrationWorkerLike {
  return new Worker(new URL('./activeSessionHydration.worker.ts', import.meta.url), {
    type: 'module',
    name: 'knightclub-active-session',
  })
}

/**
 * This client starts no Worker in its constructor. Both its Worker and its
 * restricted-runtime fallback are latest-wins and intentionally begin only
 * after React has had a chance to paint either Play's recovery or saved-game
 * opening shell.
 */
export class ActiveSessionHydrationClient {
  private readonly createWorker: ActiveSessionHydrationWorkerFactory
  private useWorker: boolean
  private worker: ActiveSessionHydrationWorkerLike | null = null
  private pending: PendingRequest | null = null
  private fallbackTimer: ReturnType<typeof setTimeout> | null = null
  private nextId = 1
  private disposed = false

  constructor(
    createWorker: ActiveSessionHydrationWorkerFactory = defaultWorkerFactory,
    useWorker = canUseWorker(),
  ) {
    this.createWorker = createWorker
    this.useWorker = useWorker
  }

  hydrateRaw(raw: string | null): Promise<HydratedActiveSession | null> {
    return this.request({ type: 'hydrate-active-session-raw', raw }) as Promise<HydratedActiveSession | null>
  }

  hydrate(session: ActiveSession | null): Promise<HydratedActiveSession | null> {
    return this.request({ type: 'hydrate-active-session', session }) as Promise<HydratedActiveSession | null>
  }

  /** Replays one explicitly selected Library PGN without synthetic session metadata. */
  hydrateStoredGame(pgn: string): Promise<HydratedStoredGame> {
    return this.request({ type: 'hydrate-stored-game', pgn }) as Promise<HydratedStoredGame>
  }

  cancel(message = 'Saved game restoration cancelled.'): void {
    const pending = this.pending
    const hasActiveRequest = pending !== null || this.fallbackTimer !== null
    this.pending = null
    if (this.fallbackTimer !== null) {
      clearTimeout(this.fallbackTimer)
      this.fallbackTimer = null
    }
    if (hasActiveRequest) this.releaseWorker()
    pending?.reject(abortError(message))
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.cancel('Saved game restoration client disposed.')
    this.releaseWorker()
  }

  private request(input: ActiveSessionHydrationInput): Promise<HydrationValue> {
    if (this.disposed) return Promise.reject(new Error('Saved game restoration client is disposed.'))
    this.cancel(input.type === 'hydrate-stored-game'
      ? 'Superseded by a newer saved game opening request.'
      : 'Superseded by a newer saved game restoration request.')
    const request = { ...input, id: this.nextId++ } as ActiveSessionHydrationRequest
    return new Promise((resolve, reject) => {
      this.pending = { id: request.id, request, resolve, reject }
      this.ensureWorker()
      const worker = this.worker
      if (!worker) {
        this.scheduleFallback(request)
        return
      }
      try {
        worker.postMessage(request)
      } catch {
        this.releaseWorker(worker)
        this.useWorker = false
        this.scheduleFallback(request)
      }
    })
  }

  private ensureWorker(): void {
    if (!this.useWorker || this.worker || this.disposed) return
    try {
      const worker = this.createWorker()
      worker.onmessage = (event) => this.handleMessage(worker, event.data)
      worker.onerror = () => this.handleWorkerError(worker)
      this.worker = worker
    } catch {
      this.useWorker = false
    }
  }

  private scheduleFallback(request: ActiveSessionHydrationRequest): void {
    if (this.fallbackTimer !== null) clearTimeout(this.fallbackTimer)
    this.fallbackTimer = setTimeout(() => {
      this.fallbackTimer = null
      if (!this.pending || this.pending.id !== request.id) return
      try {
        if (request.type === 'hydrate-stored-game') {
          // A selected long Library record promised a cancellable background
          // open. A blocked Worker must not silently replay it on the UI
          // thread and make the Cancel action unreachable.
          if (shouldHydrateStoredGameInBackground(request.pgn)) {
            this.finishError(
              request.id,
              new Error('This saved game needs a local background Worker to open safely.'),
            )
            return
          }
          this.finishSuccess(request.id, reviveHydratedStoredGame(hydrateStoredGame(request.pgn)))
        } else {
          const hydrated = request.type === 'hydrate-active-session-raw'
            ? hydrateActiveSessionRaw(request.raw)
            : hydrateActiveSession(request.session)
          this.finishSuccess(request.id, reviveHydratedActiveSession(hydrated))
        }
      } catch (error) {
        this.finishError(
          request.id,
          error instanceof Error ? error : new Error('Could not restore your saved game.'),
        )
      }
    }, 0)
  }

  private handleWorkerError(worker: ActiveSessionHydrationWorkerLike): void {
    if (this.worker !== worker) return
    this.releaseWorker(worker)
    this.useWorker = false
    const pending = this.pending
    if (pending) this.scheduleFallback(pending.request)
  }

  private handleMessage(
    worker: ActiveSessionHydrationWorkerLike,
    response: ActiveSessionHydrationResponse,
  ): void {
    const pending = this.pending
    if (!pending || pending.id !== response.id) return
    if (response.type === 'error') {
      this.finishError(response.id, new Error(response.message), worker)
      return
    }
    try {
      if (response.type === 'stored-game-result'
        && pending.request.type === 'hydrate-stored-game') {
        this.finishSuccess(response.id, reviveHydratedStoredGame(response.hydrated), worker)
        return
      }
      if (response.type === 'active-session-result'
        && pending.request.type !== 'hydrate-stored-game') {
        this.finishSuccess(response.id, reviveHydratedActiveSession(response.hydrated), worker)
        return
      }
      this.finishError(response.id, new Error('Saved game Worker returned an unexpected result.'), worker)
    } catch (error) {
      this.finishError(
        response.id,
        error instanceof Error ? error : new Error('Saved game Worker returned an invalid result.'),
        worker,
      )
    }
  }

  private finishSuccess(
    id: number,
    value: HydrationValue,
    worker?: ActiveSessionHydrationWorkerLike,
  ): void {
    const pending = this.pending
    if (!pending || pending.id !== id) return
    this.pending = null
    if (worker) this.releaseWorker(worker)
    pending.resolve(value)
  }

  private finishError(
    id: number,
    error: Error,
    worker?: ActiveSessionHydrationWorkerLike,
  ): void {
    const pending = this.pending
    if (!pending || pending.id !== id) return
    this.pending = null
    if (worker) this.releaseWorker(worker)
    pending.reject(error)
  }

  private releaseWorker(worker = this.worker): void {
    if (!worker) return
    if (this.worker === worker) this.worker = null
    worker.terminate()
  }
}

/** A raw-size check only; it must not parse an active PGN during render. */
export function shouldHydrateActiveSessionInBackground(raw: string | null): boolean {
  return raw !== null && raw.length > BACKGROUND_ACTIVE_SESSION_HYDRATION_THRESHOLD_CHARS
}

/**
 * Library records are already selected before this check. Use character count
 * only: encoding a large PGN here would recreate the main-thread work this
 * background opener exists to avoid.
 */
export function shouldHydrateStoredGameInBackground(pgn: string): boolean {
  return pgn.length > BACKGROUND_ACTIVE_SESSION_HYDRATION_THRESHOLD_CHARS
}
