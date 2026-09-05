/**
 * Shareable ?room=CODE deep links (join prefill + lobby share row). The room
 * code grammar lives here and in joinView's input filter — one shape: letters
 * only, uppercased, max 4 (LIGHT-04).
 */

/** LIGHT-04 as a pure filter: strip non-letters, uppercase, cap at 4. */
export function sanitizeRoomCode(raw: string): string {
  return raw
    .replace(/[^a-zA-Z]/g, '')
    .toUpperCase()
    .slice(0, 4)
}

/** The `?room=` code from a query string, sanitized ('' when absent/junk). */
export function roomCodeFromSearch(search: string): string {
  return sanitizeRoomCode(new URLSearchParams(search).get('room') ?? '')
}

/** The full shareable URL a lobby player copies for guests. */
export function roomShareUrl(roomCode: string, loc: { origin: string; pathname: string }): string {
  return `${loc.origin}${loc.pathname}?room=${roomCode}`
}
