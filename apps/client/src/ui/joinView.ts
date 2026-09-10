import { el } from './dom'

/**
 * Join screen (LIGHT-01..04): room code (letters only, max 4, uppercased as
 * typed) + display name (1–16 chars). Rejections render into #join-error.
 * `initialCode` is the sanitized ?room= deep-link prefill; when set the code
 * field comes filled and focus lands on the name input.
 */

const STYLE_ID = 'join-view-styles'

const STYLE = `
#join-view {
  display: flex;
  align-items: center;
  justify-content: center;
  background: radial-gradient(ellipse at 50% 30%, rgba(20, 28, 40, 0.88) 0%, rgba(10, 14, 19, 0.94) 70%);
}
#join-form {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 300px;
  padding: 24px 28px;
  background: rgba(13, 18, 24, 0.92);
  border: 1px solid #2a3542;
  border-top: 3px solid #e6c56a;
  border-radius: 10px;
  box-shadow: 0 18px 60px rgba(0, 0, 0, 0.65);
  font-family: ui-monospace, monospace;
  color: #dfe8f2;
}
#join-form h1 {
  margin: 0 0 10px;
  font-size: 26px;
  letter-spacing: 8px;
  text-transform: uppercase;
  text-align: center;
  color: #ffd98a;
  text-shadow: 0 0 18px rgba(230, 197, 106, 0.5);
}
#join-form label {
  font-size: 10px;
  letter-spacing: 3px;
  text-transform: uppercase;
  color: #8899aa;
}
#join-form input {
  padding: 6px 10px;
  font: 14px ui-monospace, monospace;
  letter-spacing: 2px;
  color: #dfe8f2;
  background: #0a0f14;
  border: 1px solid #3d4a58;
  border-radius: 4px;
  outline: none;
}
#join-form input:focus { border-color: #e6c56a; }
#join-spectator-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
  color: #9fb0c0;
}
#join-form button {
  margin-top: 6px;
  padding: 8px 12px;
  font: bold 12px ui-monospace, monospace;
  letter-spacing: 3px;
  text-transform: uppercase;
  color: #14100a;
  background: linear-gradient(180deg, #ffd98a, #c8a24a);
  border: 1px solid #e6c56a;
  border-radius: 4px;
  cursor: pointer;
}
#join-form button:hover { filter: brightness(1.1); }
#join-form button:disabled { filter: grayscale(0.7); cursor: default; }
#create-button { background: #1a2530 !important; color: #9fb0c0 !important; border-color: #3d4a58 !important; }
#join-error { margin: 4px 0 0; font-size: 11px; color: #ff9a8a; text-align: center; }
`

export interface JoinCallbacks {
  onSubmit: (code: string, name: string, spectator: boolean) => void
  onCreate: (name: string) => void
}

export function renderJoin(
  root: HTMLElement,
  error: string | null,
  joining: boolean,
  initialCode: string,
  cb: JoinCallbacks,
): void {
  let style = document.getElementById(STYLE_ID) as HTMLStyleElement | null
  if (style === null) {
    style = document.createElement('style')
    style.id = STYLE_ID
    document.head.appendChild(style)
  }
  style.textContent = STYLE

  const codeInput = el('input', { id: 'join-code', maxlength: '4', autocomplete: 'off' })
  // LIGHT-04: letters only, uppercased before join — enforce at the input.
  codeInput.addEventListener('input', () => {
    const filtered = codeInput.value
      .replace(/[^a-zA-Z]/g, '')
      .toUpperCase()
      .slice(0, 4)
    if (codeInput.value !== filtered) codeInput.value = filtered
  })
  codeInput.setAttribute('placeholder', 'CODE')
  // ?room=CODE deep link (joinView share row): prefill the code so a guest
  // only types a name — and put the caret where the typing starts.
  if (initialCode !== '') {
    codeInput.value = initialCode
  }

  const nameInput = el('input', { id: 'join-name', maxlength: '16', autocomplete: 'off' })
  nameInput.setAttribute('placeholder', 'your name')

  // Dev spectator (FR-20 from t=0, server refuses it in production): no seat,
  // no role — the whole building as stacked lanes.
  const spectatorInput = el('input', { id: 'join-spectator', type: 'checkbox' })

  const submit = el('button', { id: 'join-submit', disabled: joining }, ['Join'])
  const errorLine = el('p', { id: 'join-error' })
  if (error !== null) {
    errorLine.textContent = error
  } else {
    errorLine.setAttribute('hidden', '')
  }

  const form = el('form', { id: 'join-form' }, [
    el('h1', {}, ['turnover']),
    el('label', { for: 'join-code' }, ['Room code']),
    codeInput,
    el('label', { for: 'join-name' }, ['Your name']),
    nameInput,
    el('span', { id: 'join-spectator-row' }, [
      spectatorInput,
      el('label', { for: 'join-spectator' }, ['watch (spectator)']),
    ]),
    submit,
    errorLine,
  ])
  const create = el('button', { id: 'create-button', type: 'button', disabled: joining }, [
    'Create room',
  ])
  create.addEventListener('click', () => {
    if (create.hasAttribute('disabled')) return
    const name = nameInput.value.trim()
    if (name.length < 1) {
      errorLine.textContent = 'enter a name'
      errorLine.removeAttribute('hidden')
      return
    }
    cb.onCreate(name)
  })
  form.append(create)
  form.addEventListener('submit', (event) => {
    event.preventDefault()
    if (submit.hasAttribute('disabled')) return
    const name = nameInput.value.trim()
    if (name.length < 1) {
      errorLine.textContent = 'enter a name'
      errorLine.removeAttribute('hidden')
      return
    }
    cb.onSubmit(codeInput.value, name, spectatorInput.checked)
  })

  root.append(el('div', { id: 'join-view' }, [form]))
  // focus() is a no-op on a detached node — the ?room= caret lands on the
  // name input only once the view is mounted (LIGHT-01 fold: the guest's
  // first keystroke is their name).
  if (initialCode !== '') nameInput.focus()
}
