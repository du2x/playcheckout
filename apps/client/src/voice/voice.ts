import type { VoiceSession, VoiceSessionAction } from './voiceSession'
import { initialVoiceSession, reduceVoice, shouldOffer } from './voiceSession'

/**
 * Voice party engine (per game session): the one side-effectful voice module.
 * A full mesh of RTCPeerConnections over the room's signaling relay — audio
 * never touches the server (message-only protocol untouched). Negotiation is
 * glare-free by the pure `shouldOffer` rule; every pure transition routes
 * through voiceSession.ts so the chip and the effects derive from one state.
 *
 * Remote audio plays through plain <audio> elements (sticky activation from
 * the mic click unlocks playback) — deliberately NOT the WebAudio music/sfx
 * engine, so the party is immune to the mixer's mute states by construction.
 */

export interface VoiceWire {
  hello(): void
  bye(): void
  signal(to: string, kind: 'offer' | 'answer' | 'ice', data: string): void
}

/** v1 keeps it simple: public STUN only — no TURN, symmetric-NAT players
 *  may fail to connect (accepted v1 trade-off). */
const ICE_SERVERS: RTCIceServer[] = [{ urls: ['stun:stun.l.google.com:19302'] }]

interface PeerBundle {
  pc: RTCPeerConnection
  audio: HTMLAudioElement | null
  /** ICE candidates that arrived before the remote description did. */
  pendingIce: RTCIceCandidateInit[]
}

class VoiceParty {
  session: VoiceSession = initialVoiceSession()
  private wire: VoiceWire | null = null
  private ownId = ''
  private local: MediaStream | null = null
  private peers = new Map<string, PeerBundle>()
  private listeners = new Set<() => void>()

  /** Chip subscription; the unsubscribe prunes disconnected buttons itself. */
  onChange(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  /** Live peer connections — the chip's connected count. */
  get connectedCount(): number {
    let count = 0
    for (const bundle of this.peers.values()) {
      if (bundle.pc.connectionState === 'connected') count += 1
    }
    return count
  }

  attach(ownId: string, wire: VoiceWire): void {
    this.detach()
    this.ownId = ownId
    this.wire = wire
    this.session = initialVoiceSession()
    this.notify()
  }

  detach(): void {
    this.wire = null
    this.stopCapture()
    for (const peerId of [...this.peers.keys()]) this.teardown(peerId)
    this.session = initialVoiceSession()
    this.notify()
  }

  /** Mic button (VOICE-01): capture + join, or leave + capture-stop. */
  async toggle(): Promise<void> {
    if (this.session.micOn) {
      this.apply({ type: 'voice-mic', on: false })
      return
    }
    try {
      this.local = await navigator.mediaDevices.getUserMedia({ audio: true })
      this.apply({ type: 'voice-mic', on: true })
    } catch {
      this.apply({ type: 'voice-mic', on: true, denied: true })
      return
    }
    this.wire?.hello()
  }

  /** Post-reconnect re-join: mic stayed on, membership died with the drop. */
  resync(): void {
    if (!this.session.micOn) return
    this.wire?.hello()
  }

  apply(action: VoiceSessionAction): void {
    const before = this.session
    const next = reduceVoice(before, action, this.ownId)
    if (next === before) return
    this.session = next
    // Any mic-off transition (toggle, self-fired) leaves the party and drops
    // the capture + every peer — one home for the teardown effects.
    if (before.micOn && !next.micOn) {
      this.stopCapture()
      this.wire?.bye()
      for (const peerId of [...this.peers.keys()]) this.teardown(peerId)
    }
    this.syncPeers()
    this.notify()
  }

  /** One signaling message from a fellow member (VOICE-03 relay). */
  onSignal(from: string, kind: 'offer' | 'answer' | 'ice', data: string): void {
    if (from === this.ownId || this.wire === null) return
    if (!this.session.members.includes(from) || this.session.fired.includes(from)) return
    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(data) as Record<string, unknown>
    } catch {
      return
    }
    const bundle = this.ensurePeer(from)
    if (kind === 'offer') {
      void this.acceptOffer(from, bundle, parsed as unknown as RTCSessionDescriptionInit)
      return
    }
    if (kind === 'answer') {
      if (bundle.pc.signalingState !== 'have-local-offer') return
      void bundle.pc
        .setRemoteDescription(parsed as unknown as RTCSessionDescriptionInit)
        .then(() => this.flushIce(bundle))
        .catch(() => this.teardown(from))
      return
    }
    // ICE candidate: buffer until the remote description exists (the WS is
    // ordered, but the answer path sets it asynchronously).
    if (bundle.pc.remoteDescription === null) bundle.pendingIce.push(parsed as RTCIceCandidateInit)
    else void bundle.pc.addIceCandidate(parsed as RTCIceCandidateInit).catch(() => {})
  }

  private async acceptOffer(
    from: string,
    bundle: PeerBundle,
    offer: RTCSessionDescriptionInit,
  ): Promise<void> {
    try {
      await bundle.pc.setRemoteDescription(offer)
      this.flushIce(bundle)
      const answer = await bundle.pc.createAnswer()
      await bundle.pc.setLocalDescription(answer)
      this.wire?.signal(from, 'answer', JSON.stringify(bundle.pc.localDescription))
    } catch {
      this.teardown(from)
      this.syncPeers()
    }
  }

  private flushIce(bundle: PeerBundle): void {
    for (const candidate of bundle.pendingIce) {
      void bundle.pc.addIceCandidate(candidate).catch(() => {})
    }
    bundle.pendingIce.length = 0
  }

  private syncPeers(): void {
    if (this.wire === null) return
    // No capture, no mesh: a pc built before the mic exists carries no media
    // section, its offer freezes ICE at 'new', and it never picks the track
    // up later. Peers are (re)built the moment capture turns on — one path.
    if (this.local === null) return
    for (const peerId of [...this.peers.keys()]) {
      if (!this.session.members.includes(peerId)) this.teardown(peerId)
    }
    for (const peerId of this.session.members) {
      if (this.session.fired.includes(peerId)) continue
      if (this.peers.has(peerId)) continue
      if (!shouldOffer(this.ownId, peerId)) continue
      void this.offerTo(peerId)
    }
  }

  private async offerTo(peerId: string): Promise<void> {
    const bundle = this.ensurePeer(peerId)
    if (bundle.pc.connectionState === 'connected' || bundle.pc.signalingState !== 'stable') return
    try {
      const offer = await bundle.pc.createOffer()
      await bundle.pc.setLocalDescription(offer)
      this.wire?.signal(peerId, 'offer', JSON.stringify(bundle.pc.localDescription))
    } catch {
      this.teardown(peerId)
    }
  }

  private ensurePeer(peerId: string): PeerBundle {
    const existing = this.peers.get(peerId)
    if (existing !== undefined) return existing
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS })
    const bundle: PeerBundle = { pc, audio: null, pendingIce: [] }
    this.peers.set(peerId, bundle)
    const stream = this.local
    if (stream !== null) {
      for (const track of stream.getAudioTracks()) pc.addTrack(track, stream)
    }
    pc.onicecandidate = (event) => {
      if (event.candidate !== null) {
        this.wire?.signal(peerId, 'ice', JSON.stringify(event.candidate.toJSON()))
      }
    }
    pc.ontrack = (event) => {
      const stream = event.streams[0]
      if (stream === undefined) return
      const audio = document.createElement('audio')
      audio.autoplay = true
      audio.srcObject = stream
      audio.style.display = 'none'
      document.body.appendChild(audio)
      bundle.audio = audio
      void audio.play().catch(() => {})
      this.notify()
    }
    pc.onconnectionstatechange = () => {
      this.notify()
      if (pc.connectionState === 'failed') {
        this.teardown(peerId)
        this.syncPeers()
      }
    }
    this.notify()
    return bundle
  }

  private teardown(peerId: string): void {
    const bundle = this.peers.get(peerId)
    if (bundle === undefined) return
    this.peers.delete(peerId)
    bundle.pc.onicecandidate = null
    bundle.pc.ontrack = null
    bundle.pc.onconnectionstatechange = null
    try {
      bundle.pc.close()
    } catch {}
    bundle.audio?.remove()
    this.notify()
  }

  private stopCapture(): void {
    for (const track of this.local?.getTracks() ?? []) track.stop()
    this.local = null
  }

  private notify(): void {
    for (const fn of [...this.listeners]) fn()
  }
}

/** App-scoped singleton (the sfx/music engine pattern): App feeds it wire
 *  actions and lifecycle; the chip and tests read its session. */
export const voice = new VoiceParty()
