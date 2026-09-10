/**
 * Voice party session (per game session): the pure derivation of the local
 * player's party state — mic on/off, who else is in the party, who is fired.
 * No DOM, no WebRTC, no network — the engine (voice.ts) reduces through this
 * and drives the side effects; the chip renders from the session.
 *
 * Membership is public knowledge (roster ids + audible joins); the fired set
 * mirrors the name-only player:fired broadcasts so every honest client stops
 * talking/listening to a fired peer — the wire's dead-don't-talk enforcement.
 */

export interface VoiceSession {
  /** Mic capture is live and the party has been joined. */
  readonly micOn: boolean
  /** Other voice members — sorted, excludes self (VOICE-01 state rows). */
  readonly members: readonly string[]
  /** Fired sessions: their signaling is ignored and their peers torn down. */
  readonly fired: readonly string[]
  /** The last mic-enable was denied (permission or no device) — chip state. */
  readonly denied: boolean
}

export type VoiceSessionAction =
  | { type: 'voice-mic'; on: boolean; denied?: boolean }
  | { type: 'voice-state'; playerIds: readonly string[] }
  | { type: 'voice-joined'; playerId: string }
  | { type: 'voice-left'; playerId: string }
  | { type: 'player-left'; playerId: string }
  | { type: 'player-fired'; playerId: string }
  | { type: 'voice-reset' }

export function initialVoiceSession(): VoiceSession {
  return { micOn: false, members: [], fired: [], denied: false }
}

/**
 * Deterministic mesh negotiation (VOICE-02): between two members exactly one
 * creates the offer — the lexicographically smaller session id — so both
 * sides derive the same initiator and offers never collide (glare-free).
 */
export function shouldOffer(ownId: string, peerId: string): boolean {
  return ownId < peerId
}

const sorted = (ids: readonly string[]): readonly string[] => [...ids].sort()

export function reduceVoice(
  state: VoiceSession,
  action: VoiceSessionAction,
  ownId: string,
): VoiceSession {
  switch (action.type) {
    case 'voice-mic': {
      if (action.denied === true) {
        // Permission/device denial: the mic never turns on — the chip shows
        // the denial until the next attempt retries the capture.
        return { ...state, micOn: false, denied: action.on }
      }
      if (action.on === state.micOn) return state
      if (!action.on) return { micOn: false, members: [], fired: state.fired, denied: false }
      return { ...state, micOn: true, denied: false }
    }
    case 'voice-state':
      // The server's member list is authoritative; the recipient is excluded
      // by the room, but filter ownId anyway (defensive, VOICE-01). Fired
      // sessions never re-enter the party here either.
      return {
        ...state,
        members: sorted(action.playerIds.filter((id) => id !== ownId && !state.fired.includes(id))),
      }
    case 'voice-joined': {
      if (action.playerId === ownId || state.fired.includes(action.playerId)) return state
      if (state.members.includes(action.playerId)) return state
      return { ...state, members: sorted([...state.members, action.playerId]) }
    }
    case 'voice-left':
    case 'player-left': {
      if (!state.members.includes(action.playerId)) return state
      return { ...state, members: state.members.filter((id) => id !== action.playerId) }
    }
    case 'player-fired': {
      if (state.fired.includes(action.playerId) && !state.members.includes(action.playerId))
        return state
      const fired = state.fired.includes(action.playerId)
        ? state.fired
        : [...state.fired, action.playerId]
      const members = state.members.filter((id) => id !== action.playerId)
      if (action.playerId === ownId) {
        // Self-fired: the mic dies with the seat — the party hears them no more.
        return { micOn: false, members: [], fired, denied: false }
      }
      return { ...state, members, fired }
    }
    case 'voice-reset':
      return initialVoiceSession()
  }
}
