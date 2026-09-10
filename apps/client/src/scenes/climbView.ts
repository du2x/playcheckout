import type Phaser from 'phaser'
import { sfx } from '../audio/sfx'
import {
  CLIMB,
  climbBobY,
  climbLandingFloors,
  climbWalkFraction,
  glowFlicker,
  lurchKickY,
  stairPoint,
  stunFx,
} from './climbPresenter'
import type { StairsVisitReadout } from './stairsVisit'

/**
 * ClimbView (night-juice, shadow-play): the fullscreen stairwell interior as
 * a view module — one interface, one method per frame. It owns the
 * `stairCanvas` container and everything inside it (backdrop, wall pool, the
 * scrolled stair band, the shadow climber + its wall-shade echo, light
 * shafts, dust, the brass wall-sign clock, the scuffle/blackout FX stack)
 * plus the stair audio watcher that keys on the same readout. It derives
 * nothing: facts come from the visit module (`stairsVisit.ts`) as a
 * `StairsVisitReadout`, and the world scene keeps only the floor-view breath
 * members (chip + puff sprite) and the ambush message case.
 *
 * Contract: every member lives inside the `stairCanvas` container — the ART
 * harness counts only top-level children, so nothing here pollutes it.
 * Presentation-only timing lives in the `CLIMB` table (climbPresenter.ts);
 * nothing here alters sim timing. Leak rules: this renders the recipient's
 * OWN transit only — the interior publishes nothing (FR-34), and the ambush
 * FX are abstract (no attacker silhouette, no identity hint).
 */
export class ClimbView {
  private readonly scene: Phaser.Scene
  private canvas: Phaser.GameObjects.Container | null = null
  private band: Phaser.GameObjects.Container | null = null
  private climber: Phaser.GameObjects.Sprite | null = null
  private shade: Phaser.GameObjects.Sprite | null = null
  private glows: { glow: Phaser.GameObjects.Ellipse; seed: number }[] = []
  private glyphLow: Phaser.GameObjects.Text | null = null
  private glyphHigh: Phaser.GameObjects.Text | null = null
  private clock: Phaser.GameObjects.Text | null = null
  private route: Phaser.GameObjects.Text | null = null
  private phaseLabel: Phaser.GameObjects.Text | null = null
  private arrow: Phaser.GameObjects.Text | null = null
  private fx: {
    flashWhite: Phaser.GameObjects.Rectangle
    flashRed: Phaser.GameObjects.Rectangle
    sweep: Phaser.GameObjects.Rectangle
    blackout: Phaser.GameObjects.Rectangle
    vignette: Phaser.GameObjects.Rectangle
  } | null = null
  /** The walk fraction frozen at the ambush (a stun never advances the walk). */
  private lastTransitWalk = 0
  /** Previous phase — the audio transition watcher's memory. */
  private lastPhase: 'transit' | 'breath' | 'stunned' | null = null

  constructor(scene: Phaser.Scene) {
    this.scene = scene
    this.build()
  }

  /** The climb canvas is a top-level harness child (by name `stairCanvas`). */
  get visible(): boolean {
    return this.canvas?.visible ?? false
  }

  /**
   * Apply one frame of the visit readout: the canvas shows transit/stun and
   * steps aside for the breath (the floor view + chip render instead). The
   * audio watcher runs on both branches — phases change while hidden too
   * (breath exhale, visit end).
   */
  sync(readout: StairsVisitReadout | null, nowMs: number): void {
    if (this.canvas === null || this.band === null) return
    if (readout === null || readout.phase === 'breath') {
      this.canvas.setVisible(false)
      this.destroyClimber()
    } else {
      this.canvas.setVisible(true)
      this.syncClimb(readout, nowMs)
    }
    this.watchCues(readout)
  }

  /**
   * The stairwell run (band-local, ascending to the right), staged for the
   * shadow play at proportional scale — a tread is ~¼ the walker's height:
   * `flights` continuous flights of treads whose only lit note is the warm
   * nose edge the stairwell light catches, one continuous handrail riding
   * the slope, a stringer spine beneath, floor-landing plates with the
   * per-visit glyphs at the walked stride's two ends, and the flicker-driven
   * light wells (halo + core, no lamp props — AD-052). The walker traverses
   * the middle flight; the flights below and above are scenery, so the well
   * never shows its ends. Down-transits reuse the same geometry mirrored by
   * the scroll sign — the walker traverses it the other way.
   */
  private build(): void {
    const scene = this.scene
    const container = scene.add.container(480, 288)
    container.setScrollFactor(0)
    container.setDepth(100)
    container.setVisible(false)
    container.setName('stairCanvas')
    // Near-black violet backdrop: the shadow stage reads only where light
    // falls (AD-020 night/tension band, pushed darker for the play).
    container.add(scene.add.rectangle(0, 0, 960, 576, 0x0b0916))
    container.add(scene.add.rectangle(0, 120, 960, 336, 0x0e0b1c))
    // The backlit wall pool: the light the walker's shadow plays against —
    // two soft ellipses, fixed to the frame while the stairs scroll past.
    container.add(scene.add.ellipse(-60, 10, 820, 600, 0x241d40, 0.55))
    container.add(scene.add.ellipse(-60, 40, 560, 400, 0x332a52, 0.55))
    // The wall-shade echo: the walker's cast shadow, stretched up the lit
    // wall behind the stair band (the treads occlude its lower body). The
    // per-frame sync rides it with the walker's bob.
    if (scene.textures.exists('staff-shadow')) {
      const shade = scene.add.sprite(-86, 104, 'staff-shadow')
      shade.setOrigin(0.5, 1)
      shade.setScale(1.08, 1.42)
      shade.setAlpha(0.2)
      shade.setName('climbShade')
      container.add(shade)
      this.shade = shade
    }
    // The scrolled stair band — the multi-flight run built once; the
    // per-visit direction only flips the climber and the scroll sign.
    const band = scene.add.container(0, 0)
    band.setName('climbBand')
    container.add(band)
    this.band = band
    this.buildBand(band)
    // Falling light shafts over everything but the HUD: the walker crosses
    // them as the band scrolls (fixed frame, moving stairs = parallax life).
    const shaft = (x: number, w: number, color: number, alpha: number): void => {
      const beam = scene.add.rectangle(x, -60, w, 960, color, alpha)
      beam.setRotation(0.38)
      container.add(beam)
    }
    shaft(-320, 96, 0x9db4d6, 0.05)
    shaft(-130, 46, 0x9db4d6, 0.07)
    shaft(40, 140, 0xcfd8e8, 0.045)
    shaft(250, 60, 0xd9b26a, 0.035)
    // Drifting dust in the shafts: a tiny soft mote texture + a sparse slow
    // emitter, container-owned like every other member here.
    if (!scene.textures.exists('climb-mote')) {
      const g = scene.add.graphics()
      g.fillStyle(0xffffff, 1)
      g.fillCircle(2, 2, 2)
      g.generateTexture('climb-mote', 4, 4)
      g.destroy()
    }
    const motes = scene.add.particles(0, 0, 'climb-mote', {
      x: { min: -460, max: 460 },
      y: { min: -270, max: 270 },
      lifespan: 7000,
      speedY: { min: -10, max: -4 },
      speedX: { min: -5, max: 5 },
      scale: { min: 0.4, max: 0.9 },
      alpha: { start: 0.35, end: 0 },
      frequency: 650,
      quantity: 1,
      blendMode: 'ADD',
    })
    motes.setName('climbMotes')
    container.add(motes)
    // Brass wall sign: the integrated clock (the climb owns the countdown).
    const sign = scene.add.rectangle(-150, -232, 236, 62, 0x0a0e14)
    sign.setStrokeStyle(2, 0xd9a441)
    container.add(sign)
    const clock = scene.add.text(-150, -232, '', {
      fontSize: '38px',
      color: '#ffd98a',
      fontFamily: 'monospace',
    })
    clock.setOrigin(0.5)
    clock.setName('stairClock')
    container.add(clock)
    this.clock = clock
    const arrow = scene.add.text(-42, -232, '', {
      fontSize: '26px',
      color: '#e6c56a',
      fontFamily: 'monospace',
    })
    arrow.setOrigin(0.5)
    arrow.setName('stairArrow')
    container.add(arrow)
    this.arrow = arrow
    const dirLabel = scene.add.text(212, -232, '', {
      fontSize: '11px',
      color: '#e6c56a',
      fontFamily: 'monospace',
    })
    dirLabel.setOrigin(1, 0.5)
    dirLabel.setName('stairDir')
    container.add(dirLabel)
    const route = scene.add.text(-150, -192, '', {
      fontSize: '13px',
      color: '#9fb0c0',
      fontFamily: 'monospace',
    })
    route.setOrigin(0.5)
    route.setName('stairRoute')
    container.add(route)
    this.route = route
    const phase = scene.add.text(-150, -172, '', {
      fontSize: '11px',
      color: '#e6c56a',
      fontFamily: 'monospace',
    })
    phase.setOrigin(0.5)
    phase.setName('stairPhase')
    container.add(phase)
    this.phaseLabel = phase
    const title = scene.add.text(-258, -232, 'STAIRWELL', {
      fontSize: '9px',
      color: '#66788a',
      fontFamily: 'monospace',
    })
    title.setOrigin(0, 0.5)
    container.add(title)
    // Scuffle/blackout FX stack, topmost: white impact flash, red shock
    // frame, the abstract dark bar (no attacker silhouette — identity never
    // leaks), the blackout, and the heartbeat vignette.
    const flashWhite = scene.add.rectangle(0, 0, 960, 576, 0xf2ede2, 0)
    const flashRed = scene.add.rectangle(0, 0, 960, 576, 0xa03028, 0)
    const sweep = scene.add.rectangle(0, 0, 150, 760, 0x0a0812, 0.9)
    sweep.setRotation(-0.32)
    const blackout = scene.add.rectangle(0, 0, 960, 576, 0x050308, 0)
    const vignette = scene.add.rectangle(0, 0, 960, 576, 0x000000, 0)
    vignette.setStrokeStyle(16, 0xb3402f)
    for (const fx of [flashWhite, flashRed, sweep, blackout, vignette]) {
      fx.setVisible(false)
      container.add(fx)
    }
    this.fx = { flashWhite, flashRed, sweep, blackout, vignette }
    this.canvas = container
  }

  private buildBand(band: Phaser.GameObjects.Container): void {
    const scene = this.scene
    const stepH = CLIMB.stridePx / CLIMB.treads
    const strideRun = CLIMB.treadRun * CLIMB.treads
    const first = -Math.floor(CLIMB.flights / 2)
    const last = first + CLIMB.flights
    const slope = Math.atan2(-CLIMB.stridePx, strideRun)
    // The treads: slab + lit nose + thin riser + one baluster each, from two
    // flights below the walked stride to two above.
    for (let f = first; f < last; f++) {
      for (let i = 0; i < CLIMB.treads; i++) {
        const { x, y } = stairPoint(f + i / CLIMB.treads)
        const slab = scene.add.rectangle(x, y + 4, CLIMB.treadRun, 8, 0x241d38)
        band.add(slab)
        const nose = scene.add.rectangle(x, y + 1.5, CLIMB.treadRun, 2.5, 0x7a6438, 0.9)
        band.add(nose)
        const riser = scene.add.rectangle(x - CLIMB.treadRun / 2, y + stepH / 2, 4, stepH, 0x161128)
        band.add(riser)
        const baluster = scene.add.rectangle(x, y - 17, 3, 34, 0x2c2742)
        band.add(baluster)
      }
    }
    // One continuous handrail (waist height) + the stringer spine under the
    // noses: two rotated beams sharing the flight slope, spanning the run.
    const mid = stairPoint((first + last) / 2)
    const runLen = Math.hypot(strideRun * CLIMB.flights, CLIMB.stridePx * CLIMB.flights)
    const rail = scene.add.rectangle(mid.x, mid.y - 36, runLen + 8, 5, 0x2c2742)
    rail.setRotation(slope)
    band.add(rail)
    const stringer = scene.add.rectangle(mid.x, mid.y + 14, runLen, 14, 0x1a1528)
    stringer.setRotation(slope)
    band.add(stringer)
    // Floor-landing plates at the walked stride's two ends — each extends
    // back over the flight below it (a landing slab one riser above those
    // treads), with a newel post, a brass cap, and the per-visit glyph.
    const plate = (w: number, side: -1 | 1): void => {
      const { x, y } = stairPoint(w)
      const cx = x + (side * CLIMB.landingPx) / 2
      const slab = scene.add.rectangle(cx, y + 3, CLIMB.landingPx, 5.5, 0x241d38)
      band.add(slab)
      const nose = scene.add.rectangle(cx, y + 1, CLIMB.landingPx, 2, 0x7a6438, 0.9)
      band.add(nose)
      const postX = x + side * CLIMB.landingPx
      const post = scene.add.rectangle(postX, y - 11, 3, 22, 0x2c2742)
      band.add(post)
      const cap = scene.add.rectangle(postX, y - 24, 7, 7, 0x6a5428, 0.9)
      band.add(cap)
    }
    plate(0, -1)
    plate(1, 1)
    const glyphLow = scene.add.text(stairPoint(0).x - 70, stairPoint(0).y - 42, '', {
      fontSize: '30px',
      color: '#584d78',
      fontFamily: 'monospace',
      fontStyle: 'bold',
    })
    glyphLow.setOrigin(0.5)
    glyphLow.setName('stairGlyphLow')
    band.add(glyphLow)
    this.glyphLow = glyphLow
    const glyphHigh = scene.add.text(stairPoint(1).x + 70, stairPoint(1).y - 42, '', {
      fontSize: '30px',
      color: '#584d78',
      fontFamily: 'monospace',
      fontStyle: 'bold',
    })
    glyphHigh.setOrigin(0.5)
    glyphHigh.setName('stairGlyphHigh')
    band.add(glyphHigh)
    this.glyphHigh = glyphHigh
    // Light wells riding the band (both floor landings + one flight above):
    // a static warm halo and a core the per-frame flicker drives. Fixtures
    // stay out — the light hangs in the air (AD-052).
    for (const [wellIdx, w] of [0, 1, 2].entries()) {
      const { x, y } = stairPoint(w)
      const halo = scene.add.ellipse(x, y - 116, 150, 180, 0xd9b26a, 0.07)
      band.add(halo)
      const core = scene.add.ellipse(x, y - 112, 64, 84, 0xf0dcb0, 0.15)
      band.add(core)
      this.glows.push({ glow: core, seed: 1.3 + wellIdx * 3.1 })
    }
  }

  /** The per-frame transit/stun picture: band scroll, climber bob, wall-sign
   *  readouts, light flicker, FX stack. */
  private syncClimb(readout: StairsVisitReadout, nowMs: number): void {
    // Down-transits traverse the same ascending geometry the other way (walk
    // fraction mirrored) — the visit readout carries the building-order truth.
    const dir = readout.direction
    const label = (f: string) => (f === 'lobby' ? 'L' : f === 'mezzanine' ? 'M' : f.slice(-1))
    // The landing plates are positional (low = walk w=0): on a down-transit
    // the walker departs HIGH, so `to` is the low plate, `from` the high one.
    const landings = climbLandingFloors(readout.from, readout.to, dir)
    if (this.glyphLow !== null) this.glyphLow.setText(label(landings.low))
    if (this.glyphHigh !== null) this.glyphHigh.setText(label(landings.high))
    const stunned = readout.phase === 'stunned'
    // Band scroll: the walker sits at the fixed screen point (-60, 120); the
    // band slides so the stair surface stays under the feet (the lurch adds
    // its decaying kick right after a stun resumes the transit). A stun
    // freezes the walk at the ambush point — never a jump to the landing.
    let walk = this.lastTransitWalk
    if (readout.phase === 'transit') {
      walk = climbWalkFraction(readout.remainingMs)
      this.lastTransitWalk = walk
    }
    const shown = dir === 'up' ? walk : 1 - walk
    const point = stairPoint(shown)
    const lurchY = lurchKickY(readout.lurchElapsedMs ?? -1)
    // Derived, never hardcoded: the band sits so the stair surface under the
    // walker lands exactly at the fixed screen point (-60, 120).
    this.band?.setPosition(-60 - point.x, 120 - point.y + lurchY)
    // The climber: the own body as the shadow-play silhouette, bobbing with
    // the treads, playing the mirrored walk cycle while moving; it freezes
    // (frame 0) for the stun. The wall-shade echo rides a damped bob so the
    // cast shadow lags the walker ever so slightly.
    const climber = this.ensureClimber()
    if (climber !== null) {
      climber.setPosition(-60, 120 - climbBobY(shown))
      climber.flipX = dir === 'down'
      if (readout.phase === 'transit') {
        if (!climber.anims.isPlaying) climber.play('staff-shadow-walk')
      } else if (climber.anims.isPlaying) {
        climber.anims.stop()
        climber.setFrame(0)
      }
    }
    if (this.shade !== null) {
      this.shade.setPosition(-86, 122 - climbBobY(shown) * 0.55)
      this.shade.flipX = dir === 'down'
      this.shade.setVisible(climber !== null)
    }
    // Light-well flicker (night-juice): every core wobbles on its own seed.
    for (const { glow, seed } of this.glows) glow.setAlpha(0.15 * glowFlicker(nowMs, seed))
    // The wall sign readouts — the climb owns the countdown.
    if (this.clock !== null) {
      this.clock.setText(`${Math.ceil(readout.remainingMs / 1000)}s`)
      this.clock.setColor(stunned ? '#ff9a8a' : '#ffd98a')
    }
    if (this.route !== null) {
      this.route.setText(`${label(readout.from)} → ${label(readout.to)}`)
    }
    if (this.phaseLabel !== null) {
      const labels: Record<string, string> = {
        transit: 'moving',
        breath: 'catching breath',
        stunned: 'stunned',
      }
      this.phaseLabel.setText(labels[readout.phase] ?? readout.phase)
      this.phaseLabel.setColor(stunned ? '#ff7a6a' : '#e6c56a')
    }
    if (this.arrow !== null) {
      this.arrow.setText(dir === 'up' ? '▲' : '▼')
      this.arrow.setColor(stunned ? '#ff7a6a' : '#e6c56a')
    }
    const dirLabel = this.canvas?.getByName('stairDir') as Phaser.GameObjects.Text | null
    if (dirLabel !== null) dirLabel.setText(dir === 'up' ? '▲ up' : '▼ down')
    // The scuffle/blackout sequence (victim only, abstract — no silhouette).
    this.syncFx(readout, nowMs)
  }

  /** The container-owned shadow climber sprite, created on first need, never
   *  top-level (the ART staff-walk harness counts must not see it). */
  private ensureClimber(): Phaser.GameObjects.Sprite | null {
    if (this.canvas === null) return null
    if (this.climber === null) {
      if (!this.scene.textures.exists('staff-shadow')) return null
      const sprite = this.scene.add.sprite(-60, 120, 'staff-shadow')
      sprite.setOrigin(0.5, 1)
      sprite.setName('climbClimber')
      this.canvas.add(sprite)
      this.climber = sprite
    }
    return this.climber
  }

  private destroyClimber(): void {
    this.climber?.destroy()
    this.climber = null
  }

  /** Drive the scuffle/blackout FX stack from the stun clock (victim only). */
  private syncFx(readout: StairsVisitReadout, nowMs: number): void {
    if (this.fx === null) return
    const { flashWhite, flashRed, sweep, blackout, vignette } = this.fx
    if (readout.phase !== 'stunned') {
      for (const fx of [flashWhite, flashRed, sweep, blackout, vignette]) fx.setVisible(false)
      return
    }
    const fx = stunFx(readout.elapsedStunMs ?? 0, nowMs)
    flashWhite.setVisible(fx.flashAlpha > 0).setAlpha(fx.flashAlpha)
    flashRed.setVisible(fx.redAlpha > 0).setAlpha(fx.redAlpha)
    const sweeping = fx.sweepX !== null
    sweep.setVisible(sweeping)
    if (fx.sweepX !== null) sweep.setX(fx.sweepX * 700)
    blackout.setVisible(fx.blackoutAlpha > 0).setAlpha(fx.blackoutAlpha)
    vignette.setVisible(fx.vignetteAlpha > 0).setAlpha(fx.vignetteAlpha)
  }

  /**
   * Stair audio cues (night-juice): a transition watcher over the own stairs
   * readout — footsteps during transit, an exhale at the breath, the sting +
   * heartbeat when the ambush lands, and the lurch (+ step resume) when the
   * interrupted transit continues. Loops are idempotent, so this is safe to
   * call every frame.
   */
  private watchCues(readout: StairsVisitReadout | null): void {
    const phase = readout?.phase ?? null
    if (phase === this.lastPhase) return
    const prev = this.lastPhase
    this.lastPhase = phase
    if (phase === 'transit') {
      if (prev === 'stunned') {
        // The stun ended: kill the heartbeat — the resume lurch's t0 came
        // with the visit's stun-resumed transition.
        sfx.heartbeatStop()
      }
      sfx.footstepStart()
    } else if (phase === 'breath') {
      sfx.footstepStop()
      sfx.breathExhale()
    } else if (phase === 'stunned') {
      sfx.footstepStop()
      sfx.ambushSting()
      sfx.heartbeatStart(CLIMB.heartbeatMs)
    } else {
      sfx.stopAll()
    }
  }
}
