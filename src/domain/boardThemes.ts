/**
 * Original KnightClub board palettes. Squares are painted through the
 * `--board-light`/`--board-dark` CSS custom properties, so a theme is purely
 * a colour preference: it never affects rules, coordinates, move feedback or
 * piece artwork, and the piece set's outlined art stays readable on every set.
 */
export type BoardThemeId = 'sage' | 'walnut' | 'glacier' | 'midnight'

export interface BoardTheme {
  id: BoardThemeId
  label: string
  /** Light-square fill, also used for dark-square coordinate text. */
  light: string
  /** Dark-square fill, also used for light-square coordinate text. */
  dark: string
}

/** `sage` is the established default palette and must stay first. */
export const BOARD_THEMES: readonly BoardTheme[] = [
  { id: 'sage', label: 'Sage', light: '#e8e2cf', dark: '#718b69' },
  { id: 'walnut', label: 'Walnut', light: '#e9d3b0', dark: '#9a6b45' },
  { id: 'glacier', label: 'Glacier', light: '#e2e7ea', dark: '#7794b4' },
  { id: 'midnight', label: 'Midnight', light: '#a3abc4', dark: '#4a5372' },
] as const

export const DEFAULT_BOARD_THEME_ID: BoardThemeId = 'sage'

export function isBoardThemeId(value: unknown): value is BoardThemeId {
  return BOARD_THEMES.some((theme) => theme.id === value)
}

export function getBoardTheme(id: BoardThemeId): BoardTheme {
  return BOARD_THEMES.find((theme) => theme.id === id) ?? BOARD_THEMES[0]
}
