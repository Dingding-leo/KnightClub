import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

const base = process.env.KNIGHTLAB_BASE ?? '/'

export default defineConfig({
  base,
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'KnightLab — Local Chess Studio',
        short_name: 'KnightLab',
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
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,ico,png,woff2,wav}'],
      },
    }),
  ],
  test: {
    globals: true,
    environment: 'node',
  },
})
