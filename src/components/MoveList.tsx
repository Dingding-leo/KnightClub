import { memo, useEffect, useRef } from 'react'

interface MoveListProps {
  moves: readonly string[]
  /** The currently displayed position, counted after a SAN move. */
  activePly: number
  /** Keep the newest notation in view only while the player follows live. */
  followingLatest: boolean
  onSelectPly: (ply: number) => void
}

export const MoveList = memo(function MoveList({ moves, activePly, followingLatest, onSelectPly }: MoveListProps) {
  const latestRow = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!followingLatest) return
    latestRow.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [followingLatest, moves.length])

  if (moves.length === 0) {
    return <div className="empty-state">Moves will appear here.</div>
  }

  const rows: Array<{ number: number; white: string; black?: string; whitePly: number; blackPly: number }> = []
  for (let index = 0; index < moves.length; index += 2) {
    rows.push({
      number: index / 2 + 1,
      white: moves[index],
      black: moves[index + 1],
      whitePly: index + 1,
      blackPly: index + 2,
    })
  }

  return (
    <div className="move-list" aria-label="Move history" aria-live="polite" aria-atomic="false">
      {rows.map((row, index) => (
        <div
          className={`move-row ${index === rows.length - 1 ? 'move-row--latest' : ''}`}
          key={row.number}
          ref={index === rows.length - 1 ? latestRow : undefined}
        >
          <span>{row.number}.</span>
          <button
            className={activePly === row.whitePly ? 'move-button--current' : undefined}
            type="button"
            onClick={() => onSelectPly(row.whitePly)}
            aria-current={activePly === row.whitePly ? 'step' : undefined}
            aria-pressed={activePly === row.whitePly}
            aria-label={`View position after ${row.number}. ${row.white}`}
          >
            {row.white}
          </button>
          {row.black ? (
            <button
              className={activePly === row.blackPly ? 'move-button--current' : undefined}
              type="button"
              onClick={() => onSelectPly(row.blackPly)}
              aria-current={activePly === row.blackPly ? 'step' : undefined}
              aria-pressed={activePly === row.blackPly}
              aria-label={`View position after ${row.number}... ${row.black}`}
            >
              {row.black}
            </button>
          ) : <span aria-hidden="true" />}
        </div>
      ))}
    </div>
  )
})
