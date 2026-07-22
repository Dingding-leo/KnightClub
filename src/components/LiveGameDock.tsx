import { ArrowLeft } from 'lucide-react'
import { formatClock } from '../domain/clock'
import { useClockSnapshot } from './clockRuntimeContext'

interface LiveGameDockProps {
  visible: boolean
  onReturnToGame: () => void
}

function colorLabel(color: 'w' | 'b'): 'White' | 'Black' {
  return color === 'w' ? 'White' : 'Black'
}

export function LiveGameDock({ visible, onReturnToGame }: LiveGameDockProps) {
  const snapshot = useClockSnapshot()
  if (!visible || snapshot.whiteMs === null || snapshot.blackMs === null) return null

  const paused = snapshot.pausedColor !== null
  const activeColor = snapshot.activeColor ?? snapshot.pausedColor
  const turnLabel = activeColor
    ? paused
      ? `Paused · ${colorLabel(activeColor)} to move`
      : `${colorLabel(activeColor)} to move`
    : 'Clock paused'

  return (
    <section className="live-game-dock" aria-label="Live game">
      <div className="live-game-dock__summary">
        <span><i aria-hidden="true" />Live game</span>
        <strong>{turnLabel}</strong>
      </div>
      <div className="live-game-dock__clocks" aria-label="Live game clocks">
        <span className={activeColor === 'w' ? 'is-active' : ''}>
          <small>White</small>
          <output aria-live="off" aria-label={`White time ${formatClock(snapshot.whiteMs)}`}>{formatClock(snapshot.whiteMs)}</output>
        </span>
        <span className={activeColor === 'b' ? 'is-active' : ''}>
          <small>Black</small>
          <output aria-live="off" aria-label={`Black time ${formatClock(snapshot.blackMs)}`}>{formatClock(snapshot.blackMs)}</output>
        </span>
      </div>
      <button type="button" onClick={onReturnToGame} aria-label="Return to live game"><ArrowLeft size={16} />Return to game</button>
    </section>
  )
}
