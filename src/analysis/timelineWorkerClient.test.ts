import { describe, expect, it } from 'vitest'
import type { TimelineWorkerRequest, TimelineWorkerResponse } from './timelineWorkerProtocol'
import {
  TimelineWorkerClient,
  type TimelineWorkerLike,
} from './timelineWorkerClient'

class FakeTimelineWorker implements TimelineWorkerLike {
  onmessage: ((event: MessageEvent<TimelineWorkerResponse>) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  messages: TimelineWorkerRequest[] = []
  terminated = false

  postMessage(message: TimelineWorkerRequest) {
    this.messages.push(message)
  }

  terminate() {
    this.terminated = true
  }

  reply(response: TimelineWorkerResponse) {
    this.onmessage?.({ data: response } as MessageEvent<TimelineWorkerResponse>)
  }
}

describe('TimelineWorkerClient', () => {
  it('applies a matching PGN timeline from its dedicated Worker', async () => {
    const worker = new FakeTimelineWorker()
    const client = new TimelineWorkerClient(() => worker, true)
    const pending = client.parsePgn('1. e4 *')
    const request = worker.messages[0]

    worker.reply({
      type: 'timeline-result',
      id: request.id,
      timeline: {
        source: 'pgn',
        startFen: 'start-fen',
        sourcePgn: '1. e4 *',
        positions: [{ ply: 0, fen: 'start-fen', turn: 'w', lastMove: null }],
        moves: [],
      },
    })

    await expect(pending).resolves.toMatchObject({ source: 'pgn', sourcePgn: '1. e4 *' })
    expect(worker.terminated).toBe(false)
    client.dispose()
    expect(worker.terminated).toBe(true)
  })

  it('terminates a stale replay so the latest import wins immediately', async () => {
    const workers: FakeTimelineWorker[] = []
    const client = new TimelineWorkerClient(() => {
      const worker = new FakeTimelineWorker()
      workers.push(worker)
      return worker
    }, true)

    const first = client.parsePgn('1. e4 *')
    const second = client.parsePgn('1. d4 *')

    await expect(first).rejects.toMatchObject({ name: 'AbortError' })
    expect(workers[0]?.terminated).toBe(true)
    const request = workers[1]?.messages[0]
    if (!request) throw new Error('Expected the replacement parse request.')
    workers[1]?.reply({
      type: 'timeline-result',
      id: request.id,
      timeline: {
        source: 'pgn',
        startFen: 'start-fen',
        sourcePgn: '1. d4 *',
        positions: [{ ply: 0, fen: 'start-fen', turn: 'w', lastMove: null }],
        moves: [],
      },
    })

    await expect(second).resolves.toMatchObject({ sourcePgn: '1. d4 *' })
    client.dispose()
  })

  it('keeps invalid file notation as a typed Worker result', async () => {
    const worker = new FakeTimelineWorker()
    const client = new TimelineWorkerClient(() => worker, true)
    const pending = client.importFile({ filename: 'broken.pgn', text: 'not a game', size: 10 })
    const request = worker.messages[0]

    worker.reply({
      type: 'file-result',
      id: request.id,
      result: {
        ok: false,
        filename: 'broken.pgn',
        format: 'pgn',
        code: 'invalid-notation',
        error: 'Invalid PGN.',
      },
    })

    await expect(pending).resolves.toMatchObject({ ok: false, code: 'invalid-notation' })
    client.dispose()
  })

  it('falls back to the yielding local parser when a constructed Worker fails at runtime', async () => {
    const worker = new FakeTimelineWorker()
    const client = new TimelineWorkerClient(() => worker, true)
    const pending = client.parsePgn('1. e4 e5 *')

    worker.onerror?.({ message: 'module worker blocked' } as ErrorEvent)

    await expect(pending).resolves.toMatchObject({
      source: 'pgn',
      sourcePgn: '1. e4 e5 *',
      moves: [{ san: 'e4' }, { san: 'e5' }],
    })
    expect(worker.terminated).toBe(true)
    client.dispose()
  })
})
