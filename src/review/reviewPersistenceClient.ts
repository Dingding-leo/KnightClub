import {
  preparePersistedReviewFromWorker,
  type PreparedPersistedReview,
} from './reviewPersistence'
import type {
  ReviewPersistencePreparationInput,
  ReviewPersistenceRequest,
  ReviewPersistenceResponse,
} from './reviewPersistenceProtocol'

export interface ReviewPersistenceWorkerLike {
  onmessage: ((event: MessageEvent<ReviewPersistenceResponse>) => void) | null
  onerror: ((event: ErrorEvent) => void) | null
  postMessage(message: ReviewPersistenceRequest): void
  terminate(): void
}

export type ReviewPersistenceWorkerFactory = () => ReviewPersistenceWorkerLike

interface PendingRequest {
  id: number
  request: ReviewPersistenceRequest
  resolve: (value: PreparedPersistedReview) => void
  reject: (reason: Error) => void
}

function abortError(message: string): Error {
  return new DOMException(message, 'AbortError')
}

function canUseWorker(): boolean {
  return typeof Worker === 'function'
}

function defaultWorkerFactory(): ReviewPersistenceWorkerLike {
  return new Worker(new URL('./reviewPersistence.worker.ts', import.meta.url), {
    type: 'module',
    name: 'knightclub-review-persistence',
  })
}

/**
 * A short-lived Worker prepares the immutable completed report after the
 * scorecards paint. No main-thread fallback is allowed: strict PGN proof for
 * a 1,024-ply report belongs off the interaction thread.
 */
export class ReviewPersistenceClient {
  private readonly createWorker: ReviewPersistenceWorkerFactory
  private useWorker: boolean
  private worker: ReviewPersistenceWorkerLike | null = null
  private pending: PendingRequest | null = null
  private nextId = 1
  private disposed = false

  constructor(
    createWorker: ReviewPersistenceWorkerFactory = defaultWorkerFactory,
    useWorker = canUseWorker(),
  ) {
    this.createWorker = createWorker
    this.useWorker = useWorker
  }

  prepare(input: ReviewPersistencePreparationInput): Promise<PreparedPersistedReview> {
    if (this.disposed) return Promise.reject(new Error('Review persistence client is disposed.'))
    if (this.pending) {
      return Promise.reject(new Error('Review persistence client received concurrent work.'))
    }
    const request: ReviewPersistenceRequest = { ...input, type: 'prepare-review-save', id: this.nextId++ }
    return new Promise((resolve, reject) => {
      this.pending = { id: request.id, request, resolve, reject }
      this.ensureWorker()
      const worker = this.worker
      if (!worker) {
        this.finishError(request.id, this.backgroundWorkerError())
        return
      }
      try {
        worker.postMessage(request)
      } catch {
        this.releaseWorker(worker)
        this.useWorker = false
        this.finishError(request.id, this.backgroundWorkerError())
      }
    })
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    const pending = this.pending
    this.pending = null
    pending?.reject(abortError('Review persistence client disposed.'))
    this.releaseWorker()
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

  private handleWorkerError(worker: ReviewPersistenceWorkerLike): void {
    if (this.worker !== worker) return
    this.releaseWorker(worker)
    this.useWorker = false
    const pending = this.pending
    if (pending) this.finishError(pending.id, this.backgroundWorkerError())
  }

  private handleMessage(
    worker: ReviewPersistenceWorkerLike,
    response: ReviewPersistenceResponse,
  ): void {
    const pending = this.pending
    if (!pending || pending.id !== response.id) return
    if (response.type === 'error') {
      this.finishError(response.id, new Error(response.message), worker)
      return
    }
    if (response.type !== 'review-persistence-result') {
      this.finishError(pending.id, new Error('Review persistence Worker returned an unexpected result.'), worker)
      return
    }
    try {
      const prepared = preparePersistedReviewFromWorker(response.record, pending.request.expected)
      this.finishSuccess(response.id, prepared, worker)
    } catch (error) {
      this.finishError(
        response.id,
        error instanceof Error ? error : new Error('Review persistence Worker returned an invalid result.'),
        worker,
      )
    }
  }

  private finishSuccess(
    id: number,
    value: PreparedPersistedReview,
    worker?: ReviewPersistenceWorkerLike,
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
    worker?: ReviewPersistenceWorkerLike,
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

  private backgroundWorkerError(): Error {
    return new Error('This completed review needs a local background Worker to save safely.')
  }
}

/**
 * Completed reports are persisted at low priority. Serialising these Worker
 * jobs prevents a fast workspace change from stacking several long PGN replays
 * alongside an active bot or fresh Review engine task.
 */
export class ReviewPersistenceQueue {
  private readonly client: ReviewPersistenceClient
  private tail: Promise<void> = Promise.resolve()
  private disposed = false

  constructor(client = new ReviewPersistenceClient()) {
    this.client = client
  }

  prepare(input: ReviewPersistencePreparationInput): Promise<PreparedPersistedReview> {
    const result = this.tail.catch(() => undefined).then(() => {
      if (this.disposed) throw new Error('Review persistence queue is disposed.')
      return this.client.prepare(input)
    })
    this.tail = result.then(() => undefined, () => undefined)
    return result
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.client.dispose()
  }
}
