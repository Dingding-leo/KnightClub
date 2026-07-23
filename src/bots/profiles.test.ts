import { Chess } from 'chess.js'
import { describe, expect, it, vi } from 'vitest'
import { STANDARD_START_FEN } from '../domain/chess'
import {
  BOT_PROFILES,
  DEFAULT_BOT_PROFILE_ID,
  botPostGameMessage,
  botProfileForId,
  isBotProfileId,
  profileForLegacyLevel,
  selectProfileCandidateMove,
  selectProfileOpeningMove,
} from './profiles'
import type { EngineCandidate } from '../engine/playCandidates'

function candidate(
  multiPv: number,
  from: EngineCandidate['move']['from'],
  to: EngineCandidate['move']['to'],
  value: number,
  overrides: Partial<EngineCandidate['score']> = {},
): EngineCandidate {
  return {
    multiPv,
    move: { from, to },
    depth: 14,
    score: { kind: 'cp', value, bound: null, ...overrides },
  }
}

describe('local bot profiles', () => {
  it('keeps only the declared original profile identifiers and maps legacy strengths', () => {
    expect(isBotProfileId(DEFAULT_BOT_PROFILE_ID)).toBe(true)
    expect(isBotProfileId('not-a-bot')).toBe(false)
    expect(profileForLegacyLevel('easy').id).toBe('mira-vale')
    expect(profileForLegacyLevel('balanced').id).toBe('rowan-pike')
    expect(profileForLegacyLevel('strong').id).toBe('nia-cross')
  })

  it('returns each authored cue only when chess.js confirms the exact standard-start route', () => {
    for (const profile of BOT_PROFILES) {
      for (const cue of profile.openingCues) {
        const game = new Chess()
        for (const san of cue.history) game.move(san)

        expect(selectProfileOpeningMove(game, STANDARD_START_FEN, game.turn(), profile)).toEqual(cue.move)
      }
    }
  })

  it('gives the default opponent a local e4 response before an engine is needed', () => {
    const rowan = botProfileForId(DEFAULT_BOT_PROFILE_ID)
    const game = new Chess()

    game.move('e4')
    expect(selectProfileOpeningMove(game, STANDARD_START_FEN, 'b', rowan, game.history()))
      .toEqual({ from: 'e7', to: 'e5' })

    game.move('e5')
    game.move('Nf3')
    expect(selectProfileOpeningMove(game, STANDARD_START_FEN, 'b', rowan, game.history()))
      .toEqual({ from: 'b8', to: 'c6' })
  })

  it('never guesses a cue for the wrong route, wrong side or a custom position', () => {
    const mira = botProfileForId('mira-vale')
    const wrongRoute = new Chess()
    wrongRoute.move('d4')

    expect(selectProfileOpeningMove(wrongRoute, STANDARD_START_FEN, 'b', mira)).toBeNull()
    expect(selectProfileOpeningMove(new Chess(), STANDARD_START_FEN, 'b', mira)).toBeNull()

    const customFen = '8/8/8/8/8/8/4K3/7k w - - 0 1'
    expect(selectProfileOpeningMove(new Chess(customFen), customFen, 'w', mira)).toBeNull()
  })

  it('uses the supplied move snapshot instead of rebuilding a missed opening route', () => {
    const mira = botProfileForId('mira-vale')
    const game = new Chess()
    game.move('d4')
    const history = game.history()
    const historySpy = vi.spyOn(game, 'history')

    expect(selectProfileOpeningMove(game, STANDARD_START_FEN, game.turn(), mira, history)).toBeNull()
    expect(historySpy).not.toHaveBeenCalled()
  })

  it('uses result-aware post-game copy from the bot perspective', () => {
    const profile = botProfileForId('rowan-pike')
    expect(botPostGameMessage(profile, '1-0', 'w')).toBe(profile.postGame.win)
    expect(botPostGameMessage(profile, '0-1', 'w')).toBe(profile.postGame.loss)
    expect(botPostGameMessage(profile, '1/2-1/2', 'b')).toBe(profile.postGame.draw)
  })

  it('can choose a close legal profile line without mutating the displayed game', () => {
    const game = new Chess()
    game.move('e4')
    game.move('d5')
    const before = game.fen()
    const selection = selectProfileCandidateMove(
      game,
      botProfileForId('mira-vale'),
      { from: 'g1', to: 'f3' },
      [candidate(1, 'g1', 'f3', 40), candidate(2, 'e4', 'd5', 16)],
    )

    expect(selection).toEqual({ move: { from: 'e4', to: 'd5', promotion: undefined }, usedStyle: true })
    expect(game.fen()).toBe(before)
  })

  it('uses each declared profile preference only when the second line expresses it', () => {
    const opening = new Chess()
    expect(selectProfileCandidateMove(
      opening,
      botProfileForId('rowan-pike'),
      { from: 'g1', to: 'f3' },
      [candidate(1, 'g1', 'f3', 28), candidate(2, 'd2', 'd4', 12)],
    )).toMatchObject({ move: { from: 'd2', to: 'd4' }, usedStyle: true })

    const tension = new Chess()
    tension.move('e4')
    tension.move('d5')
    expect(selectProfileCandidateMove(
      tension,
      botProfileForId('nia-cross'),
      { from: 'g1', to: 'f3' },
      [candidate(1, 'g1', 'f3', 30), candidate(2, 'e4', 'd5', 14)],
    )).toMatchObject({ move: { from: 'e4', to: 'd5' }, usedStyle: true })
  })

  it('keeps Stockfish’s best move whenever a profile candidate is unsafe or not close enough', () => {
    const game = new Chess()
    game.move('e4')
    game.move('d5')
    const best = { from: 'g1' as const, to: 'f3' as const }
    const profile = botProfileForId('nia-cross')

    expect(selectProfileCandidateMove(
      game,
      profile,
      best,
      [candidate(1, 'g1', 'f3', 40), candidate(2, 'e4', 'd5', 10)],
    )).toEqual({ move: best, usedStyle: false })

    expect(selectProfileCandidateMove(
      game,
      profile,
      best,
      [candidate(1, 'g1', 'f3', 40), candidate(2, 'e4', 'd5', 35, { bound: 'upper' })],
    )).toEqual({ move: best, usedStyle: false })

    expect(selectProfileCandidateMove(
      game,
      profile,
      best,
      [candidate(1, 'g1', 'f3', 40), candidate(2, 'e4', 'd5', 35, { kind: 'mate' })],
    )).toEqual({ move: best, usedStyle: false })

    expect(selectProfileCandidateMove(
      game,
      profile,
      best,
      [candidate(1, 'd2', 'd4', 40), candidate(2, 'e4', 'd5', 35)],
    )).toEqual({ move: best, usedStyle: false })

    expect(selectProfileCandidateMove(
      game,
      profile,
      best,
      [candidate(1, 'g1', 'f3', 40), candidate(2, 'a1', 'a8', 35)],
    )).toEqual({ move: best, usedStyle: false })
  })
})
