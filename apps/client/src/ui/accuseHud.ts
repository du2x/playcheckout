import { ACCUSE_TOAST_MS, type AccuseSession, pruneToasts } from '../accuseSession'
import { el } from './dom'

/**
 * Accusation HUD (cycle 2.8, FR-18): the name-only firing toast stack and the
 * self-fired banner. DOM like every non-contract visual; the grand container
 * rides in both the lobby and round views (firing is possible only mid-round,
 * but the round view rebuilds its HUD on entry — same ride-along as the
 * in-car screen). The menu lives with the hold-E wiring (T6).
 */

/** The toast stack + confirm menu + fired banner root, appended by both HUD views. */
export function buildAccuseHud(): HTMLElement {
  return el('div', { id: 'accuse-hud' }, [
    el('div', { id: 'accuse-toasts' }, []),
    el('div', { id: 'accuse-menu', hidden: '' }, [
      el('span', { id: 'accuse-menu-text' }, []),
      el('button', { id: 'accuse-confirm' }, ['accuse']),
      el('button', { id: 'accuse-cancel' }, ['cancel']),
    ]),
    el('div', { id: 'fired-banner', hidden: '' }, ['you were fired — watch quietly']),
  ])
}

export interface AccuseHudHandlers {
  onConfirm: () => void
  onCancel: () => void
}

/**
 * Mirror the session into the DOM: one toast per firing ("X was fired" — the
 * payload is name-only, so no reason, role, or validity can be rendered), the
 * confirm menu while open, and the banner exactly while self-fired.
 */
export function syncAccuseHud(
  session: AccuseSession,
  nameOf: (id: string) => string,
  handlers: AccuseHudHandlers,
): void {
  const pruned = pruneToasts(session, Date.now())
  const toasts = document.querySelector('#accuse-toasts')
  if (toasts !== null) {
    toasts.replaceChildren(
      ...pruned.toasts.map((t, i) => {
        const node = el('div', { class: 'accuse-toast' }, [`${nameOf(t.playerId)} was fired`])
        node.dataset.toastFor = t.playerId
        // The most recent toast is the loudest; older ones fade via opacity.
        ;(node as HTMLElement).style.opacity = String(1 - 0.3 * (pruned.toasts.length - 1 - i))
        return node
      }),
    )
  }
  const menu = document.querySelector('#accuse-menu')
  if (menu instanceof HTMLElement) {
    if (session.menu === null) {
      menu.setAttribute('hidden', '')
    } else {
      menu.removeAttribute('hidden')
      const text = menu.querySelector('#accuse-menu-text')
      if (text !== null) text.textContent = `accuse ${session.menu.targetName}?`
      const confirm = menu.querySelector('#accuse-confirm')
      const cancel = menu.querySelector('#accuse-cancel')
      if (confirm instanceof HTMLButtonElement) confirm.onclick = handlers.onConfirm
      if (cancel instanceof HTMLButtonElement) cancel.onclick = handlers.onCancel
    }
  }
  const banner = document.querySelector('#fired-banner')
  if (banner instanceof HTMLElement) {
    if (pruned.selfFired) banner.removeAttribute('hidden')
    else banner.setAttribute('hidden', '')
  }
}

/** Convenience for callers: the toast visibility window in ms. */
export const ACCUSE_TOAST_VISIBLE_MS: number = ACCUSE_TOAST_MS
