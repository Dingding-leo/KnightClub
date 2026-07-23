import { describe, expect, it } from 'vitest'
import {
  knightclubWorkbox,
  STOCKFISH_RUNTIME_CACHE_NAME,
  stockfishRuntimeCacheRoute,
} from './vite.config.ts'

describe('KnightClub PWA engine caching', () => {
  it('keeps Stockfish outside the first-visit precache', () => {
    expect(knightclubWorkbox.globPatterns).not.toContain('**/*.{js,css,html,svg,ico,png,woff2,wav,wasm,txt}')
    expect(knightclubWorkbox.globPatterns).not.toContain(expect.stringContaining('wasm'))
    expect(knightclubWorkbox.globIgnores).toContain('**/stockfish/stockfish-18-lite-single.js')
  })

  it('cache-first caches only the optional Stockfish worker and WASM after use', () => {
    const route = stockfishRuntimeCacheRoute.urlPattern
    expect(route).toBeInstanceOf(RegExp)
    expect((route as RegExp).test('https://example.com/KnightLab/stockfish/stockfish-18-lite-single.js')).toBe(true)
    expect((route as RegExp).test('https://example.com/KnightLab/stockfish/stockfish-18-lite-single.wasm')).toBe(true)
    expect((route as RegExp).test('https://example.com/KnightLab/assets/index.js')).toBe(false)
    expect(stockfishRuntimeCacheRoute.handler).toBe('CacheFirst')
    expect(stockfishRuntimeCacheRoute.options?.cacheName).toBe(STOCKFISH_RUNTIME_CACHE_NAME)
  })
})
