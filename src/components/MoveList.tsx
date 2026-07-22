import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, type MouseEvent, type RefObject } from 'react'

interface MoveListProps {
  moves: readonly string[]
  /** The currently displayed position, counted after a SAN move. */
  activePly: number
  /** Keep the newest notation in view only while the player follows live. */
  followingLatest: boolean
  onSelectPly: (ply: number) => void
}

interface MoveRowData {
  number: number
  white: string
  black?: string
  whitePly: number
  blackPly: number
}

interface MoveRowProps extends MoveRowData {
  whiteCurrent: boolean
  blackCurrent: boolean
  isLatest: boolean
  latestRowRef: RefObject<HTMLDivElement | null>
}

/**
 * Each notation row changes only when one of its own SAN values, current
 * state or latest-row state changes. This keeps a long game from rebuilding
 * all historical buttons as a new move arrives or a player previews a ply.
 */
const MoveRow = memo(function MoveRow({
  number,
  white,
  black,
  whitePly,
  blackPly,
  whiteCurrent,
  blackCurrent,
  isLatest,
  latestRowRef,
}: MoveRowProps) {
  return (
    <div
      className={`move-row ${isLatest ? 'move-row--latest' : ''}`}
      ref={isLatest ? latestRowRef : undefined}
    >
      <span>{number}.</span>
      <button
        className={whiteCurrent ? 'move-button--current' : undefined}
        type="button"
        data-ply={whitePly}
        aria-current={whiteCurrent ? 'step' : undefined}
        aria-pressed={whiteCurrent}
        aria-label={`View position after ${number}. ${white}`}
      >
        {white}
      </button>
      {black ? (
        <button
          className={blackCurrent ? 'move-button--current' : undefined}
          type="button"
          data-ply={blackPly}
          aria-current={blackCurrent ? 'step' : undefined}
          aria-pressed={blackCurrent}
          aria-label={`View position after ${number}... ${black}`}
        >
          {black}
        </button>
      ) : <span aria-hidden="true" />}
    </div>
  )
})

export const MoveList = memo(function MoveList({ moves, activePly, followingLatest, onSelectPly }: MoveListProps) {
  const latestRow = useRef<HTMLDivElement>(null)
  const onSelectPlyRef = useRef(onSelectPly)
  // Keep the delegated handler stable without pointing at a callback from an
  // abandoned concurrent render. Layout effects run before the committed
  // notation can receive a player click; SSR keeps the initial callback.
  useLayoutEffect(() => {
    onSelectPlyRef.current = onSelectPly
  }, [onSelectPly])

  const rows = useMemo(() => {
    const next: MoveRowData[] = []
    for (let index = 0; index < moves.length; index += 2) {
      next.push({
        number: index / 2 + 1,
        white: moves[index],
        black: moves[index + 1],
        whitePly: index + 1,
        blackPly: index + 2,
      })
    }
    return next
  }, [moves])

  const selectPlyFromNotation = useCallback((event: MouseEvent<HTMLDivElement>) => {
    if (!(event.target instanceof Element)) return
    const button = event.target.closest<HTMLButtonElement>('button[data-ply]')
    if (!button || !event.currentTarget.contains(button)) return
    const ply = Number(button.dataset.ply)
    if (!Number.isInteger(ply) || ply < 1) return
    onSelectPlyRef.current(ply)
  }, [])

  useEffect(() => {
    if (!followingLatest) return
    latestRow.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [followingLatest, moves.length])

  if (moves.length === 0) {
    return <div className="empty-state">Moves will appear here.</div>
  }

  return (
    <div className="move-list" aria-label="Move history" aria-live="polite" aria-atomic="false" onClick={selectPlyFromNotation}>
      {rows.map((row, index) => (
        <MoveRow
          key={row.number}
          {...row}
          whiteCurrent={activePly === row.whitePly}
          blackCurrent={activePly === row.blackPly}
          isLatest={index === rows.length - 1}
          latestRowRef={latestRow}
        />
      ))}
    </div>
  )
})
