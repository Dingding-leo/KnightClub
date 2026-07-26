import { describe, expect, it } from 'vitest'
import {
  BOARD_THEMES,
  DEFAULT_BOARD_THEME_ID,
  getBoardTheme,
  isBoardThemeId,
} from './boardThemes'

describe('board themes', () => {
  it('keeps the established default palette first and unchanged', () => {
    expect(BOARD_THEMES[0]).toEqual({ id: 'sage', label: 'Sage', light: '#e8e2cf', dark: '#718b69' })
    expect(DEFAULT_BOARD_THEME_ID).toBe('sage')
  })

  it('exposes unique ids and well-formed colours', () => {
    const ids = BOARD_THEMES.map((theme) => theme.id)
    expect(new Set(ids).size).toBe(BOARD_THEMES.length)
    for (const theme of BOARD_THEMES) {
      expect(theme.light).toMatch(/^#[0-9a-f]{6}$/)
      expect(theme.dark).toMatch(/^#[0-9a-f]{6}$/)
      expect(theme.label.length).toBeGreaterThan(0)
    }
  })

  it('accepts only known theme ids', () => {
    expect(isBoardThemeId('walnut')).toBe(true)
    expect(isBoardThemeId('sage')).toBe(true)
    expect(isBoardThemeId('emerald')).toBe(false)
    expect(isBoardThemeId(undefined)).toBe(false)
    expect(isBoardThemeId(3)).toBe(false)
  })

  it('resolves a theme for every id', () => {
    for (const theme of BOARD_THEMES) {
      expect(getBoardTheme(theme.id)).toBe(theme)
    }
  })
})
