// Synthesized sound-effects library. Reads live effects volume from
// audioSettings. All functions are crash-safe — if Web Audio is unavailable,
// they no-op and log a warning.

import { effectiveEffectsVolume, getAudioSettings } from "./audioSettings";
import sliceAsset from "@/assets/audio/mixkit-fast-whoosh-transition-1490.wav.asset.json";
import lifeLostAsset from "@/assets/audio/mixkit-cartoon-toy-whistle-616.wav.asset.json";

let sharedCtx: AudioContext | null = null;
let warned = false;

function ctx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (sharedCtx) return sharedCtx;
  try {
    const AC: typeof AudioContext =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    sharedCtx = new AC();
    return sharedCtx;
  } catch (e) {
    if (!warned) {
      console.warn("[audio] Web Audio unavailable — sound effects disabled.", e);
      warned = true;
    }
    return null;
  }
}

function gain(level: number): { ac: AudioContext; out: GainNode } | null {
  const v = effectiveEffectsVolume() * level;
  if (v <= 0) return null;
  const ac = ctx();
  if (!ac) return null;
  if (ac.state === "suspended") ac.resume().catch(() => {});
  const out = ac.createGain();
  out.gain.value = v;
  out.connect(ac.destination);
  return { ac, out };
}

function rand(min: number, max: number) { return min + Math.random() * (max - min); }

function playSample(url: string, level = 1): boolean {
  if (typeof window === "undefined") return false;
  const volume = Math.min(1, effectiveEffectsVolume() * level);
  if (volume <= 0) return false;
  try {
    const audio = new Audio(url);
    audio.volume = volume;
    audio.play().catch(() => {});
    return true;
  } catch {
    return false;
  }
}

export function playLifeLost() {
  playSample(lifeLostAsset.url, 0.9);
}

// --- Slice: whoosh + juicy splash + pitched chime, with pitch variation ---
export function playSlice(comboCount = 1) {
  if (playSample(sliceAsset.url, 0.8)) return;
  const g = gain(1);
  if (!g) return;
  const { ac, out } = g;
  const now = ac.currentTime;
  const pitchShift = rand(0.88, 1.12);

  // Whoosh (filtered noise)
  const noiseDur = 0.14;
  const buf = ac.createBuffer(1, Math.ceil(ac.sampleRate * noiseDur), ac.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) {
    const t = i / data.length;
    data[i] = (Math.random() * 2 - 1) * (1 - t);
  }
  const n = ac.createBufferSource();
  n.buffer = buf;
  const bp = ac.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.setValueAtTime(1800 * pitchShift, now);
  bp.frequency.exponentialRampToValueAtTime(600 * pitchShift, now + noiseDur);
  bp.Q.value = 1.2;
  const ng = ac.createGain();
  ng.gain.value = 0.32;
  n.connect(bp).connect(ng).connect(out);
  n.start(now);
  n.stop(now + noiseDur);

  // Juicy "splash" — short low blip
  const splash = ac.createOscillator();
  const sg = ac.createGain();
  splash.type = "sine";
  splash.frequency.setValueAtTime(220 * pitchShift, now);
  splash.frequency.exponentialRampToValueAtTime(110 * pitchShift, now + 0.12);
  sg.gain.setValueAtTime(0, now);
  sg.gain.linearRampToValueAtTime(0.18, now + 0.01);
  sg.gain.exponentialRampToValueAtTime(0.0008, now + 0.14);
  splash.connect(sg).connect(out);
  splash.start(now);
  splash.stop(now + 0.16);

  // Chime — pitch climbs with combo
  const base = 520 + Math.min(comboCount, 10) * 60;
  const osc = ac.createOscillator();
  const og = ac.createGain();
  osc.type = "triangle";
  osc.frequency.setValueAtTime(base * 0.9 * pitchShift, now);
  osc.frequency.exponentialRampToValueAtTime(base * 1.6 * pitchShift, now + 0.08);
  og.gain.setValueAtTime(0, now);
  og.gain.linearRampToValueAtTime(0.16, now + 0.015);
  og.gain.exponentialRampToValueAtTime(0.0008, now + 0.18);
  osc.connect(og).connect(out);
  osc.start(now);
  osc.stop(now + 0.2);
}

// --- Bomb: cartoon explosion ---
export function playBomb() {
  const g = gain(1.1);
  if (!g) return;
  const { ac, out } = g;
  const now = ac.currentTime;

  // Low boom
  const osc = ac.createOscillator();
  const og = ac.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(220, now);
  osc.frequency.exponentialRampToValueAtTime(45, now + 0.4);
  og.gain.setValueAtTime(0, now);
  og.gain.linearRampToValueAtTime(0.55, now + 0.02);
  og.gain.exponentialRampToValueAtTime(0.0008, now + 0.6);
  osc.connect(og).connect(out);
  osc.start(now);
  osc.stop(now + 0.62);

  // Noise burst (cartoon "pop")
  const dur = 0.45;
  const buf = ac.createBuffer(1, Math.ceil(ac.sampleRate * dur), ac.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) {
    const t = i / data.length;
    data[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, 1.6);
  }
  const n = ac.createBufferSource();
  n.buffer = buf;
  const lp = ac.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.setValueAtTime(2200, now);
  lp.frequency.exponentialRampToValueAtTime(380, now + dur);
  const ng = ac.createGain();
  ng.gain.setValueAtTime(0.45, now);
  ng.gain.exponentialRampToValueAtTime(0.001, now + dur);
  n.connect(lp).connect(ng).connect(out);
  n.start(now);
  n.stop(now + dur);

  // Cartoon "boing" tail
  const tail = ac.createOscillator();
  const tg = ac.createGain();
  tail.type = "square";
  tail.frequency.setValueAtTime(330, now + 0.1);
  tail.frequency.exponentialRampToValueAtTime(110, now + 0.45);
  tg.gain.setValueAtTime(0, now + 0.1);
  tg.gain.linearRampToValueAtTime(0.12, now + 0.12);
  tg.gain.exponentialRampToValueAtTime(0.0008, now + 0.5);
  tail.connect(tg).connect(out);
  tail.start(now + 0.1);
  tail.stop(now + 0.55);
}

// --- UI click / hover ---
export function playClick() {
  const g = gain(0.7);
  if (!g) return;
  const { ac, out } = g;
  const now = ac.currentTime;
  const o = ac.createOscillator();
  const og = ac.createGain();
  o.type = "triangle";
  o.frequency.setValueAtTime(880, now);
  o.frequency.exponentialRampToValueAtTime(660, now + 0.08);
  og.gain.setValueAtTime(0, now);
  og.gain.linearRampToValueAtTime(0.18, now + 0.005);
  og.gain.exponentialRampToValueAtTime(0.0008, now + 0.1);
  o.connect(og).connect(out);
  o.start(now);
  o.stop(now + 0.12);
}

export function playHover() {
  const g = gain(0.4);
  if (!g) return;
  const { ac, out } = g;
  const now = ac.currentTime;
  const o = ac.createOscillator();
  const og = ac.createGain();
  o.type = "sine";
  o.frequency.value = 1200;
  og.gain.setValueAtTime(0, now);
  og.gain.linearRampToValueAtTime(0.08, now + 0.005);
  og.gain.exponentialRampToValueAtTime(0.0008, now + 0.06);
  o.connect(og).connect(out);
  o.start(now);
  o.stop(now + 0.08);
}

export function playBack() {
  const g = gain(0.7);
  if (!g) return;
  const { ac, out } = g;
  const now = ac.currentTime;
  const o = ac.createOscillator();
  const og = ac.createGain();
  o.type = "triangle";
  o.frequency.setValueAtTime(540, now);
  o.frequency.exponentialRampToValueAtTime(360, now + 0.1);
  og.gain.setValueAtTime(0, now);
  og.gain.linearRampToValueAtTime(0.2, now + 0.005);
  og.gain.exponentialRampToValueAtTime(0.0008, now + 0.14);
  o.connect(og).connect(out);
  o.start(now);
  o.stop(now + 0.16);
}

// --- Combo chime (escalating) ---
export function playCombo(level: number) {
  const g = gain(0.9);
  if (!g) return;
  const { ac, out } = g;
  const now = ac.currentTime;
  // C major arpeggio extending with combo level
  const notes = [60, 64, 67, 72, 76, 79, 84];
  const n = notes[Math.min(level - 1, notes.length - 1)];
  const f = 440 * Math.pow(2, (n - 69) / 12);
  const o = ac.createOscillator();
  const og = ac.createGain();
  o.type = "triangle";
  o.frequency.value = f;
  og.gain.setValueAtTime(0, now);
  og.gain.linearRampToValueAtTime(0.22, now + 0.01);
  og.gain.exponentialRampToValueAtTime(0.0008, now + 0.25);
  o.connect(og).connect(out);
  o.start(now);
  o.stop(now + 0.28);
}

// --- High score jingle ---
export function playHighScore() {
  const g = gain(1);
  if (!g) return;
  const { ac, out } = g;
  const now = ac.currentTime;
  // Cheerful ascending jingle
  const notes: Array<[number, number]> = [
    [72, 0.0], [76, 0.12], [79, 0.24], [84, 0.36], [79, 0.5], [84, 0.62],
  ];
  for (const [m, t] of notes) {
    const f = 440 * Math.pow(2, (m - 69) / 12);
    const o = ac.createOscillator();
    const og = ac.createGain();
    o.type = "triangle";
    o.frequency.value = f;
    const start = now + t;
    og.gain.setValueAtTime(0, start);
    og.gain.linearRampToValueAtTime(0.25, start + 0.02);
    og.gain.exponentialRampToValueAtTime(0.0008, start + 0.28);
    o.connect(og).connect(out);
    o.start(start);
    o.stop(start + 0.3);

    // Sparkle layer
    const s = ac.createOscillator();
    const sg = ac.createGain();
    s.type = "sine";
    s.frequency.value = f * 2;
    sg.gain.setValueAtTime(0, start);
    sg.gain.linearRampToValueAtTime(0.08, start + 0.02);
    sg.gain.exponentialRampToValueAtTime(0.0006, start + 0.22);
    s.connect(sg).connect(out);
    s.start(start);
    s.stop(start + 0.24);
  }
}

// --- Game over: gentle, friendly descending melody ---
export function playGameOver() {
  const g = gain(0.9);
  if (!g) return;
  const { ac, out } = g;
  const now = ac.currentTime;
  const notes: Array<[number, number, number]> = [
    [72, 0.0, 0.25],
    [69, 0.25, 0.25],
    [65, 0.5, 0.25],
    [60, 0.75, 0.55],
  ];
  for (const [m, t, dur] of notes) {
    const f = 440 * Math.pow(2, (m - 69) / 12);
    const o = ac.createOscillator();
    const og = ac.createGain();
    o.type = "triangle";
    o.frequency.value = f;
    const start = now + t;
    og.gain.setValueAtTime(0, start);
    og.gain.linearRampToValueAtTime(0.22, start + 0.03);
    og.gain.exponentialRampToValueAtTime(0.0008, start + dur);
    o.connect(og).connect(out);
    o.start(start);
    o.stop(start + dur + 0.05);
  }
}

// Back-compat for existing imports.
export function playSliceSfx(comboCount: number, _volume = 1) {
  void _volume;
  if (!getAudioSettings().effectsOn) return;
  playSlice(comboCount);
}
export function playBombSfx(_volume = 1) {
  void _volume;
  if (!getAudioSettings().effectsOn) return;
  playBomb();
}
