import { BOARD_THEMES, type BoardThemeId } from '../domain/boardThemes'

interface BoardThemePickerProps {
  value: BoardThemeId
  onSelect: (id: BoardThemeId) => void
}

/**
 * A compact, keyboard-accessible board-palette choice. Colour previews are
 * painted inline from the theme table so the picker always matches what the
 * board will actually apply.
 */
export function BoardThemePicker({ value, onSelect }: BoardThemePickerProps) {
  return (
    <div className="board-theme-picker">
      <span className="board-theme-picker__heading" id="board-theme-heading">Board theme</span>
      <div className="board-theme-picker__options" role="group" aria-labelledby="board-theme-heading">
        {BOARD_THEMES.map((theme) => {
          const active = theme.id === value
          return (
            <button
              key={theme.id}
              type="button"
              className={`board-theme-option${active ? ' is-active' : ''}`}
              aria-pressed={active}
              aria-label={`${theme.label} board theme`}
              title={`${theme.label} board theme`}
              onClick={() => onSelect(theme.id)}
            >
              <span className="board-theme-option__swatch" aria-hidden="true">
                <i style={{ background: theme.light }} />
                <i style={{ background: theme.dark }} />
                <i style={{ background: theme.dark }} />
                <i style={{ background: theme.light }} />
              </span>
              <small>{theme.label}</small>
            </button>
          )
        })}
      </div>
    </div>
  )
}
