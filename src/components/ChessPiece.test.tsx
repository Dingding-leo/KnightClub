import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ChessPiece } from './ChessPiece'

describe('ChessPiece', () => {
  it('normalizes the compact pawn and queen art without changing the square SVG frame', () => {
    const pawn = renderToStaticMarkup(<ChessPiece color="w" type="p" />)
    const queen = renderToStaticMarkup(<ChessPiece color="b" type="q" />)

    for (const markup of [pawn, queen]) {
      expect(markup).toContain('aria-hidden="true"')
      expect(markup).toContain('focusable="false"')
      expect(markup).toContain('preserveAspectRatio="xMidYMid meet"')
      expect(markup).toContain('viewBox="0 0 100 100"')
    }

    expect(pawn).toContain('transform="translate(50 50) scale(1.12 1.05) translate(-50 -50)"')
    expect(queen).toContain('transform="translate(50 50) scale(1.07 1) translate(-50 -50)"')
  })
})
