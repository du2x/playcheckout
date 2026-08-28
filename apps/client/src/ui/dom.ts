/** Minimal DOM builder for the overlay views — no framework (prd §11 plan). */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | boolean> = {},
  children: (HTMLElement | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  for (const [key, value] of Object.entries(attrs)) {
    if (value === false) continue
    if (key === 'class') node.className = String(value)
    else if (value !== true) node.setAttribute(key, String(value))
    else node.setAttribute(key, '')
  }
  for (const child of children) {
    node.append(child)
  }
  return node
}
