import { clockRemainingMs, type ViewState } from '../state'
import { el } from './dom'

/**
 * Round HUD (LIGHT-09..12): countdown clock from the round:started receipt
 * (client-side per AD-003) and the player's OWN role card from their private
 * role:dealt payload. No other player's role exists in any payload — nothing
 * to render even by accident.
 */
export function renderRoundHud(root: HTMLElement, state: ViewState): () => void {
  const clock = el('div', { id: 'clock' })
  const roleCard = el('div', { id: 'role-card' }, [state.role ?? ''])
  const errorLine = el('p', { id: 'hud-error' })
  if (state.error !== null) errorLine.textContent = state.error
  else errorLine.setAttribute('hidden', '')

  function tick() {
    const remainingMs = clockRemainingMs(state, Date.now())
    const totalSeconds = Math.ceil(remainingMs / 1000)
    const minutes = Math.floor(totalSeconds / 60)
    const seconds = totalSeconds % 60
    clock.textContent = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
  }

  const interval = setInterval(tick, 250)
  tick()

  root.append(
    el('div', { id: 'round-hud' }, [
      clock,
      el('div', { id: 'role-label' }, ['your role']),
      roleCard,
      errorLine,
      // Position-only elevator panels: car floors, never occupants (privacy rule).
      el('div', { id: 'elevator-panel' }, [
        'elevators  W: ',
        el('span', { id: 'panel-west' }, ['lobby']),
        ' · E: ',
        el('span', { id: 'panel-east' }, ['lobby']),
      ]),
    ]),
  )

  return () => clearInterval(interval)
}
