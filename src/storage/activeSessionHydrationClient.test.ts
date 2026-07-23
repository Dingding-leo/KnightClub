import { describe, expect, it } from 'vitest'
import { MAX_STORED_GAME_PGN_CHARS, type ActiveSession } from './gameStore'
import {
  hydrateActiveSession,
  hydrateStoredGame,
  reviveHydratedActiveSession,
  reviveHydratedStoredGame,
} from './activeSessionHydration'
import {
  ActiveSessionHydrationClient,
  shouldHydrateStoredGameInBackground,
  type ActiveSessionHydrationWorkerLike,
} from './activeSessionHydrationClient'
import type {
  ActiveSessionHydrationRequest,
  ActiveSessionHydrationResponse,
  HydratedActiveSessionWire,
  HydratedStoredGameWire,
} from './activeSessionHydrationProtocol'

const session: ActiveSession = {
  pgn: '1. Nf3 Nf6 2. Ng1 Ng8 3. Nf3 Nf6 4. Ng1 Ng8 *',
  startFen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
  mode: 'bot',
  botLevel: 'balanced',
  orientation: 'white',
}

function wire(value: ActiveSession = session): HydratedActiveSessionWire {
  const hydrated = hydrateActiveSession(value)
  if (!hydrated) throw new Error('Expected a valid active-session snapshot.')
  return hydrated
}

const storedGamePgn = [
  '[Event "Library opening"]',
  '[SetUp "1"]',
  '[FEN "8/8/8/8/8/8/4K3/7k w - - 0 1"]',
  '',
  '1. Kf2 Kh2 {A saved note} *',
].join('\n')

function storedWire(pgn = storedGamePgn): HydratedStoredGameWire {
  return hydrateStoredGame(pgn)
}

class FakeActiveSessionWorker implements ActiveSessionHydrationWorkerLike {
  onmessage: ((event: MessageEvent<ActiveSessionHydrationResponse>) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  readonly messages: ActiveSessionHydrationRequest[] = []
  terminated = false

  postMessage(message: ActiveSessionHydrationRequest): void {
    this.messages.push(message)
  }

  terminate(): void {
    this.terminated = true
  }

  reply(response: ActiveSessionHydrationResponse): void {
    this.onmessage?.({ data: response } as MessageEvent<ActiveSessionHydrationResponse>)
  }

  failToStart(): void {
    this.onerror?.({ message: 'Worker module blocked.' } as ErrorEvent)
  }
}

describe('ActiveSessionHydrationClient', () => {
  it('does not start a Worker until a saved game explicitly needs restoration', () => {
    let starts = 0
    const client = new ActiveSessionHydrationClient(() => {
      starts += 1
      return new FakeActiveSessionWorker()
    }, true)

    expect(starts).toBe(0)
    client.dispose()
  })

  it('revives a one-shot Worker snapshot with undo and repetition history intact', async () => {
    const worker = new FakeActiveSessionWorker()
    const client = new ActiveSessionHydrationClient(() => worker, true)
    const pending = client.hydrate(session)
    const request = worker.messages[0]
    if (!request) throw new Error('Expected an active-session request.')

    worker.reply({
      type: 'active-session-result',
      id: request.id,
      // Worker postMessage removes the Chess prototype. This mirrors the
      // browser boundary rather than merely returning the source object.
      hydrated: structuredClone(wire()),
    })

    const restored = await pending
    expect(restored?.game.fen()).toBe(wire().finalFen)
    expect(restored?.verboseHistory).toHaveLength(8)
    expect(restored?.game.isThreefoldRepetition()).toBe(true)
    expect(restored?.game.undo()?.san).toBe('Ng8')
    expect(worker.terminated).toBe(true)
    client.dispose()
  })

  it('terminates stale restoration so only the latest snapshot can resolve', async () => {
    const workers: FakeActiveSessionWorker[] = []
    const client = new ActiveSessionHydrationClient(() => {
      const worker = new FakeActiveSessionWorker()
      workers.push(worker)
      return worker
    }, true)
    const first = client.hydrate(session)
    const firstOutcome = first.catch((error: unknown) => error)
    const second = client.hydrate({ ...session, pgn: '1. e4 e5 *' })

    await expect(firstOutcome).resolves.toMatchObject({
      name: 'AbortError',
      message: 'Superseded by a newer saved game restoration request.',
    })
    expect(workers[0]?.terminated).toBe(true)
    const request = workers[1]?.messages[0]
    if (!request) throw new Error('Expected replacement active-session request.')
    workerReply(workers[1], request.id, wire({ ...session, pgn: '1. e4 e5 *' }))

    await expect(second).resolves.toMatchObject({ verboseHistory: [{ san: 'e4' }, { san: 'e5' }] })
    client.dispose()
  })

  it('uses a yielded local parser only when Workers are unavailable', async () => {
    const client = new ActiveSessionHydrationClient(() => {
      throw new Error('Workers unavailable')
    }, false)
    let settled = false
    const pending = client.hydrateRaw(JSON.stringify(session)).then((value) => {
      settled = true
      return value
    })

    expect(settled).toBe(false)
    expect((await pending)?.verboseHistory[0]?.san).toBe('Nf3')
    client.dispose()
  })

  it('uses that same yielded parser after a Worker module is blocked', async () => {
    const worker = new FakeActiveSessionWorker()
    const client = new ActiveSessionHydrationClient(() => worker, true)
    const pending = client.hydrate(session)

    worker.failToStart()

    expect((await pending)?.verboseHistory[0]?.san).toBe('Nf3')
    expect(worker.terminated).toBe(true)
    client.dispose()
  })

  it('fails closed when a Worker snapshot does not verify', async () => {
    const worker = new FakeActiveSessionWorker()
    const client = new ActiveSessionHydrationClient(() => worker, true)
    const outcome = client.hydrate(session).catch((error: unknown) => error)
    const request = worker.messages[0]
    if (!request) throw new Error('Expected active-session request.')

    worker.reply({
      type: 'active-session-result',
      id: request.id,
      hydrated: { ...structuredClone(wire()), finalFen: 'not-a-fen' },
    })

    const error = await outcome
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toContain('snapshot did not verify')
    expect(worker.terminated).toBe(true)
    client.dispose()
  })

  it('opens a selected Library PGN in the worker with headers, comments and undo history intact', async () => {
    const worker = new FakeActiveSessionWorker()
    const client = new ActiveSessionHydrationClient(() => worker, true)
    const pending = client.hydrateStoredGame(storedGamePgn)
    const request = worker.messages[0]
    if (!request || request.type !== 'hydrate-stored-game') {
      throw new Error('Expected a selected saved-game request.')
    }

    worker.reply({
      type: 'stored-game-result',
      id: request.id,
      hydrated: structuredClone(storedWire()),
    })

    const restored = await pending
    expect(restored.startFen).toBe('8/8/8/8/8/8/4K3/7k w - - 0 1')
    expect(restored.verboseHistory.map((move) => move.san)).toEqual(['Kf2', 'Kh2'])
    expect(restored.game.getHeaders()).toMatchObject({ Event: 'Library opening' })
    expect(restored.game.getComments()).toEqual([expect.objectContaining({ comment: 'A saved note' })])
    expect(restored.game.undo()?.san).toBe('Kh2')
    expect(restored.canonicalReviewKey).toMatch(/^[0-9a-f]{16}$/)
    expect(worker.terminated).toBe(true)
    client.dispose()
  })

  it('cancels a selected Library game before a late worker result can resolve', async () => {
    const worker = new FakeActiveSessionWorker()
    const client = new ActiveSessionHydrationClient(() => worker, true)
    const pending = client.hydrateStoredGame(storedGamePgn)
    const outcome = pending.catch((error: unknown) => error)
    const request = worker.messages[0]
    if (!request || request.type !== 'hydrate-stored-game') {
      throw new Error('Expected a selected saved-game request.')
    }

    client.cancel('Player cancelled opening.')
    worker.reply({ type: 'stored-game-result', id: request.id, hydrated: structuredClone(storedWire()) })

    await expect(outcome).resolves.toMatchObject({ name: 'AbortError', message: 'Player cancelled opening.' })
    expect(worker.terminated).toBe(true)
    client.dispose()
  })

  it('uses the same yielded fallback for a selected Library game and keeps its size decision allocation-free', async () => {
    const client = new ActiveSessionHydrationClient(() => {
      throw new Error('Workers unavailable')
    }, false)
    let settled = false
    const pending = client.hydrateStoredGame(storedGamePgn).then((value) => {
      settled = true
      return value
    })

    expect(settled).toBe(false)
    await expect(pending).resolves.toMatchObject({ startFen: '8/8/8/8/8/8/4K3/7k w - - 0 1' })
    expect(shouldHydrateStoredGameInBackground('x'.repeat(2 * 1024))).toBe(false)
    expect(shouldHydrateStoredGameInBackground('x'.repeat(2 * 1024 + 1))).toBe(true)
    client.dispose()
  })

  it('fails a long selected Library game safely when no cancellable Worker is available', async () => {
    const client = new ActiveSessionHydrationClient(() => {
      throw new Error('Workers unavailable')
    }, false)

    const outcome = client.hydrateStoredGame('x'.repeat(2 * 1024 + 1)).catch((error: unknown) => error)

    await expect(outcome).resolves.toMatchObject({
      message: 'This saved game needs a local background Worker to open safely.',
    })
    client.dispose()
  })
})

describe('active-session hydration snapshot boundary', () => {
  it('preserves complete chess state through a Worker-style structured clone', () => {
    const restored = reviveHydratedActiveSession(structuredClone(wire()))

    expect(restored?.verboseHistory.map((move) => move.san)).toEqual([
      'Nf3', 'Nf6', 'Ng1', 'Ng8', 'Nf3', 'Nf6', 'Ng1', 'Ng8',
    ])
    expect(restored?.game.isThreefoldRepetition()).toBe(true)
    expect(restored?.game.undo()?.san).toBe('Ng8')
  })

  it('keeps PGN headers and comments through the structured clone', () => {
    const annotated: ActiveSession = {
      ...session,
      pgn: '[Event "Local recovery"]\n[Site "KnightClub"]\n\n1. e4 {A saved note} e5 *',
    }
    const restored = reviveHydratedActiveSession(structuredClone(wire(annotated)))

    expect(restored?.game.getHeaders()).toMatchObject({ Event: 'Local recovery', Site: 'KnightClub' })
    expect(restored?.game.getComments()).toEqual([
      expect.objectContaining({ comment: 'A saved note' }),
    ])
  })

  it('accepts a valid legacy Library comment whose UTF-8 bytes exceed one MiB', () => {
    // Browser Library records historically have a character limit. A Chinese
    // annotation can therefore be valid storage while requiring more than
    // the old one-MiB byte guard used by the selected-game Worker.
    const pgn = `1. e4 {${'你'.repeat(350_000)}} e5 *`

    expect(pgn.length).toBeLessThanOrEqual(MAX_STORED_GAME_PGN_CHARS)
    expect(new TextEncoder().encode(pgn).byteLength).toBeGreaterThan(1_048_576)
    expect(reviveHydratedStoredGame(hydrateStoredGame(pgn)).verboseHistory.map((move) => move.san)).toEqual(['e4', 'e5'])
  })

  it('rejects an invalid selected-game review identity without replaying it on the UI thread', () => {
    expect(() => reviveHydratedStoredGame({
      ...structuredClone(storedWire()),
      canonicalReviewKey: 'not-a-review-key',
    })).toThrow('invalid response')
  })
})

function workerReply(
  worker: FakeActiveSessionWorker | undefined,
  id: number,
  hydrated: HydratedActiveSessionWire,
): void {
  if (!worker) throw new Error('Expected replacement Worker.')
  worker.reply({ type: 'active-session-result', id, hydrated: structuredClone(hydrated) })
}
