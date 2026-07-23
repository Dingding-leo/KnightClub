/// <reference lib="webworker" />

import { hydrateLibraryFull, hydrateLibrarySummaries, loadLibraryGame } from './libraryHydration'
import type {
  LibraryHydrationRequest,
  LibraryHydrationResponse,
} from './libraryHydrationProtocol'

const workerScope = self as DedicatedWorkerGlobalScope

workerScope.onmessage = (event: MessageEvent<LibraryHydrationRequest>) => {
  const request = event.data
  try {
    const response: LibraryHydrationResponse = request.type === 'hydrate-library-summaries'
      ? {
          type: 'library-summaries-result',
          id: request.id,
          games: hydrateLibrarySummaries(request.raw),
        }
      : request.type === 'hydrate-library-full'
        ? {
            type: 'library-games-result',
            id: request.id,
            games: hydrateLibraryFull(request.raw),
          }
      : {
          type: 'library-game-result',
          id: request.id,
          game: loadLibraryGame(request.raw, request.gameId),
        }
    workerScope.postMessage(response)
  } catch (error) {
    const response: LibraryHydrationResponse = {
      type: 'error',
      id: request.id,
      message: error instanceof Error ? error.message : 'Could not prepare your saved games.',
    }
    workerScope.postMessage(response)
  }
}

export {}
