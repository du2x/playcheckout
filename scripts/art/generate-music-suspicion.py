#!/usr/bin/env python3
"""Generate the Turnover gameplay music loop (user-directed, 2026-09-09).

The lobby keeps the mellow night-shift loop (AD-057); rounds get their own
tension cue: "Turnover Suspicion", 116 BPM vs the lobby's 92, D minor with a
Gm→A dominant lift into the seam, driving staccato bass ostinato, offbeat
e-piano stabs, a sparse clock-tick glockenspiel motif, low string drones, and
an insistent backbeat with an end-of-loop fill. Same channel/program layout
as the night-shift file so the engine's GM-ish voice tables and per-channel
pans apply unchanged (ch0 bass 32, ch1 e-piano 4, ch2 glockenspiel 9,
ch3 strings 48, ch10 drums). 32-beat loop, all notes end at or before the
seam so the loop point stays click-free.

Output:
  apps/client/public/audio/turnover-suspicion.mid

Run from repo root: python3 scripts/art/generate-music-suspicion.py
"""

from __future__ import annotations

import struct
from pathlib import Path

OUT_PATH = Path("apps/client/public/audio/turnover-suspicion.mid")

DIVISION = 480
BPM = 116
US_PER_QUARTER = round(60_000_000 / BPM)
LOOP_BEATS = 32
LOOP_TICKS = LOOP_BEATS * DIVISION

TRACK_NAME = "Turnover Suspicion"

# Channel layout — mirrors turnover-night-shift.mid so music.ts voices/pans hold.
CH_BASS = 0
CH_KEYS = 1
CH_BELL = 2
CH_STRINGS = 3
CH_DRUMS = 9
PROGRAMS = {CH_BASS: 32, CH_KEYS: 4, CH_BELL: 9, CH_STRINGS: 48}

# Per-bar chord roots (8 bars): Dm Dm Bb C Dm Dm Gm A.
BASS_ROOTS = [38, 38, 34, 36, 38, 38, 31, 33]  # D2 D2 Bb1 C2 D2 D2 G1 A1
KEY_CHORDS = [
    (62, 65, 69),  # Dm: D4 F4 A4
    (62, 65, 69),
    (58, 62, 65),  # Bb: Bb3 D4 F4
    (60, 64, 67),  # C: C4 E4 G4
    (62, 65, 69),
    (62, 65, 69),
    (55, 58, 62),  # Gm: G3 Bb3 D4
    (57, 61, 64),  # A: A3 C#4 E4 (dominant lift into the loop)
]
STRING_DYADS = [(38, 45), (38, 45), (34, 41), (36, 43), (38, 45), (38, 45), (31, 38), (33, 40)]

# Bass ostinato: eighth-slot (0..7) → interval from the bar root, None = rest.
BASS_SLOTS = [0, 0, 12, 0, 0, 7, 12, 0]


def ticks(beats: float) -> int:
    return round(beats * DIVISION)


def varlen(value: int) -> bytes:
    out = bytearray([value & 0x7F])
    value >>= 7
    while value:
        out.insert(0, 0x80 | (value & 0x7F))
        value >>= 7
    return bytes(out)


def note_on(ch: int, midi: int, velocity: int) -> bytes:
    return bytes([0x90 | ch, midi, velocity])


def note_off(ch: int, midi: int) -> bytes:
    return bytes([0x80 | ch, midi, 0])


def build_track(events: list[tuple[int, bytes]], name: str) -> bytes:
    """Delta-encodes (tick, bytes) events and wraps them in an MTrk chunk."""
    events = sorted(events, key=lambda e: e[0])
    body = bytearray()
    body += varlen(0) + b"\xff\x03" + varlen(len(name)) + name.encode("ascii")
    last = 0
    for tick, payload in events:
        body += varlen(tick - last) + payload
        last = tick
    body += varlen(0) + b"\xff\x2f\x00"
    return b"MTrk" + struct.pack(">I", len(body)) + bytes(body)


def bass_track() -> list[tuple[int, bytes]]:
    events: list[tuple[int, bytes]] = []
    for bar, root in enumerate(BASS_ROOTS):
        for slot, interval in enumerate(BASS_SLOTS):
            beat = bar * 4 + slot * 0.5
            # Accents on the downbeat and the push off 2.5; late-bar lift.
            velocity = 84 if slot in (0, 5) else (72 if slot == 7 else 64)
            midi = root + interval
            start = ticks(beat)
            end = ticks(beat + 0.42)  # staccato: release before the next eighth
            events.append((start, note_on(CH_BASS, midi, velocity)))
            events.append((end, note_off(CH_BASS, midi)))
    return events


def keys_track() -> list[tuple[int, bytes]]:
    events: list[tuple[int, bytes]] = []
    for bar, chord in enumerate(KEY_CHORDS):
        for half, beat in enumerate((0.5, 1.5, 2.5, 3.5)):
            velocity = 62 if half in (0, 2) else 56
            start = ticks(bar * 4 + beat)
            events.append((start, note_on(CH_KEYS, chord[0], velocity)))
            events.append((start, note_on(CH_KEYS, chord[1], velocity)))
            events.append((start, note_on(CH_KEYS, chord[2], velocity)))
            end = ticks(bar * 4 + beat + 0.25)  # stab
            for midi in chord:
                events.append((end, note_off(CH_KEYS, midi)))
    return events


def bell_track() -> list[tuple[int, bytes]]:
    """Sparse clock-tick motif: D5 F5 E5 C#5 answers over the Dm bars."""
    motif: list[tuple[float, int, int, float]] = [
        # (beat, midi, velocity, duration in beats)
        (0.0, 74, 72, 0.35),   # D5
        (2.5, 77, 60, 0.3),    # F5
        (4.0, 76, 66, 0.35),   # E5
        (7.0, 73, 58, 0.3),    # C#5 — rubs against Dm, uneasy
        (8.0, 74, 70, 0.35),   # D5
        (11.5, 82, 56, 0.3),   # Bb5 over the Bb bar
        (12.0, 79, 62, 0.3),   # G5 over C
        (15.0, 76, 56, 0.3),   # E5
        (16.0, 74, 68, 0.35),
        (19.5, 77, 58, 0.3),
        (24.0, 74, 64, 0.35),  # Gm bar: back to the tonic pitch, colder
        (27.0, 81, 58, 0.3),   # A5 over the dominant
        (31.0, 76, 52, 0.5),   # E5 leads the ear into the loop restart
    ]
    events: list[tuple[int, bytes]] = []
    for beat, midi, velocity, dur in motif:
        events.append((ticks(beat), note_on(CH_BELL, midi, velocity)))
        events.append((ticks(beat + dur), note_off(CH_BELL, midi)))
    return events


def strings_track() -> list[tuple[int, bytes]]:
    """Two-bar low drones; the final dyad ends exactly at the loop seam."""
    events: list[tuple[int, bytes]] = []
    for bar in range(0, 8, 2):
        low, high = STRING_DYADS[bar]
        start = ticks(bar * 4)
        end = ticks((bar + 2) * 4)
        events.append((start, note_on(CH_STRINGS, low, 66)))
        events.append((start, note_on(CH_STRINGS, high, 58)))
        events.append((end, note_off(CH_STRINGS, low)))
        events.append((end, note_off(CH_STRINGS, high)))
    return events


def drums_track() -> list[tuple[int, bytes]]:
    events: list[tuple[int, bytes]] = []
    for bar in range(8):
        base = bar * 4
        hits: list[tuple[float, int, int, float]] = []
        # Kick: downbeat plus two syncopated pushes.
        for beat, vel in ((0.0, 88), (1.5, 74), (2.5, 80)):
            hits.append((beat, 36, vel, 0.25))
        # Backbeat snare.
        hits.append((1.0, 38, 76, 0.25))
        hits.append((3.0, 38, 72, 0.25))
        # Closed hats on every eighth, accents on the beat.
        for slot in range(8):
            hits.append((slot * 0.5, 42, 50 if slot % 2 == 0 else 34, 0.2))
        # Open hat breath at the half-way and loop seams; tom fill in bar 8.
        if bar in (3, 7):
            hits.append((3.5, 46, 58, 0.4))
        if bar == 7:
            hits.append((3.0, 41, 70, 0.2))
            hits.append((3.25, 41, 74, 0.2))
            hits.append((3.5, 43, 78, 0.2))
        for beat, midi, velocity, dur in hits:
            start = ticks(base + beat)
            # GM convention: drums never send note-offs (the parser allows it).
            events.append((start, note_on(CH_DRUMS, midi, velocity)))
    return events


def write_smf() -> None:
    tracks = [
        build_track([(0, b"\xff\x51\x03" + struct.pack(">I", US_PER_QUARTER)[1:])], TRACK_NAME),
        build_track([(0, bytes([0xC0 | CH_BASS, PROGRAMS[CH_BASS]]))] + bass_track(), "Bass"),
        build_track([(0, bytes([0xC0 | CH_KEYS, PROGRAMS[CH_KEYS]]))] + keys_track(), "Keys"),
        build_track([(0, bytes([0xC0 | CH_BELL, PROGRAMS[CH_BELL]]))] + bell_track(), "Bell"),
        build_track([(0, bytes([0xC0 | CH_STRINGS, PROGRAMS[CH_STRINGS]]))] + strings_track(), "Strings"),
        build_track(drums_track(), "Drums"),
    ]
    header = b"MThd" + struct.pack(">IHHH", 6, 1, len(tracks), DIVISION)
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_bytes(header + b"".join(tracks))

    seconds = LOOP_BEATS * 60 / BPM
    print(f"wrote {OUT_PATH} ({OUT_PATH.stat().st_size} bytes)")
    print(f"loop: {LOOP_BEATS} beats at {BPM} bpm = {seconds:.3f} s")


if __name__ == "__main__":
    write_smf()
