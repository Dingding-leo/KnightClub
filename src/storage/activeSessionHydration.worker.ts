/// <reference lib="webworker" />

import {
  hydrateActiveSession,
  hydrateActiveSessionRaw,
  hydrateStoredGame,
} from './activeSessionHydration'
import type {
  ActiveSessionHydrationRequest,
  ActiveSessionHydrationResponse,
} from './activeSessionHydrationProtocol'

const workerScope = self as DedicatedWorkerGlobalScope

workerScope.onmessage = (event: MessageEvent<ActiveSessionHydrationRequest>) => {
  const request = event.data
  try {
    const response: ActiveSessionHydrationResponse = request.type === 'hydrate-stored-game'
      ? {
          type: 'stored-game-result',
          id: request.id,
          hydrated: hydrateStoredGame(request.pgn),
        }
      : {
          type: 'active-session-result',
          id: request.id,
          hydrated: request.type === 'hydrate-active-session-raw'
            ? hydrateActiveSessionRaw(request.raw)
            : hydrateActiveSession(request.session),
        }
    workerScope.postMessage(response)
  } catch (error) {
    const response: ActiveSessionHydrationResponse = {
      type: 'error',
      id: request.id,
      message: error instanceof Error ? error.message : 'Could not restore your saved game.',
    }
    workerScope.postMessage(response)
  }
}

export {}
