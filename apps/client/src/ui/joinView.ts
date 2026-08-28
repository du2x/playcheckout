import { el } from './dom'

/**
 * Join screen (LIGHT-01..04): room code (letters only, max 4, uppercased as
 * typed) + display name (1–16 chars). Rejections render into #join-error.
 */
export interface JoinCallbacks {
  onSubmit: (code: string, name: string) => void
  onCreate: (name: string) => void
}

export function renderJoin(
  root: HTMLElement,
  error: string | null,
  joining: boolean,
  cb: JoinCallbacks,
): void {
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

  const nameInput = el('input', { id: 'join-name', maxlength: '16', autocomplete: 'off' })
  nameInput.setAttribute('placeholder', 'your name')

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
    cb.onSubmit(codeInput.value, name)
  })

  root.append(el('div', { id: 'join-view' }, [form]))
}
