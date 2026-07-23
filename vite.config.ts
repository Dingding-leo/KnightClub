import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import type { GenerateSWOptions, RuntimeCaching } from 'workbox-build'

const base = process.env.KNIGHTCLUB_BASE ?? '/'

export const STOCKFISH_RUNTIME_CACHE_NAME = 'knightclub-stockfish-runtime'

/**
 * Stockfish is a 7 MB optional capability. Keep it out of the app-shell
 * precache so the board becomes usable promptly, then retain it locally after
 * its first Play or Review request for offline use.
 */
export const stockfishRuntimeCacheRoute: RuntimeCaching = {
  urlPattern: /\/stockfish\/stockfish-18-lite-single\.(?:js|wasm)$/,
  handler: 'CacheFirst',
  options: {
    cacheName: STOCKFISH_RUNTIME_CACHE_NAME,
    cacheableResponse: { statuses: [0, 200] },
    expiration: {
      maxEntries: 2,
      maxAgeSeconds: 30 * 24 * 60 * 60,
    },
  },
}

export const knightclubWorkbox: Partial<GenerateSWOptions> = {
  // Do not turn an optional engine into a mandatory first-visit download.
  // Other static assets still precache as the offline app shell.
  globPatterns: ['**/*.{js,css,html,svg,ico,png,woff2,wav,txt}'],
  globIgnores: ['**/stockfish/stockfish-18-lite-single.js'],
  runtimeCaching: [stockfishRuntimeCacheRoute],
}

export default defineConfig({
  base,
  clearScreen: false,
  build: {
    // Sites discovers static assets through dist/server/wrangler.json. Keep the
    // browser bundle in the matching Cloudflare assets directory.
    outDir: 'dist/client',
  },
  server: {
    host: process.env.TAURI_DEV_HOST ?? '127.0.0.1',
    strictPort: true,
    watch: {
      ignored: ['**/src-tauri/**'],
    },
  },
  plugins: [
    react(),
    VitePWA({
      injectRegister: null,
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'KnightClub — Local Chess Studio',
        short_name: 'KnightClub',
        description: 'Offline-first chess play, review, training, library and insights.',
        theme_color: '#090d13',
        background_color: '#090d13',
        display: 'standalone',
        start_url: base,
        scope: base,
        icons: [
          {
            src: 'favicon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any maskable',
          },
        ],
      },
      workbox: knightclubWorkbox,
    }),
  ],
  test: {
    globals: true,
    environment: 'node',
  },
})
