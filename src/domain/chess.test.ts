import { describe, expect, it } from 'vitest'
import { Chess } from 'chess.js'
import { cloneGame, evaluateMaterial, gameResult, gameStatus } from './chess'

describe('chess domain', () => {
  it('clones move history and current position', () => {
    const game = new Chess()
    game.move('e4')
    game.move('c5')
    const clone = cloneGame(game)
    expect(clone.fen()).toBe(game.fen())
    expect(clone.history()).toEqual(['e4', 'c5'])
  })

  it('can reuse a verbose history snapshot without changing the clone', () => {
    const game = new Chess()
    for (const move of ['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'a6']) {
      game.move(move)
    }

    const fallback = cloneGame(game)
    const fromSnapshot = cloneGame(game, undefined, game.history({ verbose: true }))

    expect(fromSnapshot.fen()).toBe(fallback.fen())
    expect(fromSnapshot.history()).toEqual(fallback.history())
    expect(fromSnapshot.pgn()).toBe(fallback.pgn())
  })

  it('evaluates captured material from white perspective', () => {
    const game = new Chess()
    game.move('e4')
    game.move('d5')
    game.move('exd5')
    expect(evaluateMaterial(game, 'w')).toBe(100)
  })

  it('reports checkmate result and status', () => {
    const game = new Chess()
    game.move('f3')
    game.move('e5')
    game.move('g4')
    game.move('Qh4#')
    expect(gameResult(game)).toBe('0-1')
    expect(gameStatus(game)).toContain('Checkmate')
  })
})
