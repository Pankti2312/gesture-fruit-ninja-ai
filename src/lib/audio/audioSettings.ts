// Centralized, persisted audio settings for the whole app.
// Hooks/components subscribe; SFX & music read live values.

export interface AudioSettings {
  masterVolume: number;   // 0..1
  musicVolume: number;    // 0..1
  effectsVolume: number;  // 0..1
  muteAll: boolean;
  musicOn: boolean;
  effectsOn: boolean;
}

const KEY = "gfn:audio:v1";

const DEFAULTS: AudioSettings = {
  masterVolume: 1.0,
  musicVolume: 0.25,
  effectsVolume: 0.7,
  muteAll: false,
  musicOn: true,
  effectsOn: true,
};

function clamp01(n: number) { return Math.max(0, Math.min(1, n)); }

function load(): AudioSettings {
  if (typeof window === "undefined") return { ...DEFAULTS };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw);
    return {
      masterVolume: clamp01(Number(parsed.masterVolume ?? DEFAULTS.masterVolume)),
      musicVolume: clamp01(Number(parsed.musicVolume ?? DEFAULTS.musicVolume)),
      effectsVolume: clamp01(Number(parsed.effectsVolume ?? DEFAULTS.effectsVolume)),
      muteAll: Boolean(parsed.muteAll ?? DEFAULTS.muteAll),
      musicOn: Boolean(parsed.musicOn ?? DEFAULTS.musicOn),
      effectsOn: Boolean(parsed.effectsOn ?? DEFAULTS.effectsOn),
    };
  } catch {
    return { ...DEFAULTS };
  }
}

let current: AudioSettings = load();
const listeners = new Set<(s: AudioSettings) => void>();

function persist() {
  try { localStorage.setItem(KEY, JSON.stringify(current)); } catch { /* noop */ }
}

export function getAudioSettings(): AudioSettings {
  return current;
}

export function setAudioSettings(patch: Partial<AudioSettings>) {
  current = {
    ...current,
    ...patch,
    masterVolume: patch.masterVolume !== undefined ? clamp01(patch.masterVolume) : current.masterVolume,
    musicVolume: patch.musicVolume !== undefined ? clamp01(patch.musicVolume) : current.musicVolume,
    effectsVolume: patch.effectsVolume !== undefined ? clamp01(patch.effectsVolume) : current.effectsVolume,
  };
  persist();
  for (const l of listeners) l(current);
}

export function subscribeAudioSettings(fn: (s: AudioSettings) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function effectiveMusicVolume(s: AudioSettings = current): number {
  if (s.muteAll || !s.musicOn) return 0;
  return s.masterVolume * s.musicVolume;
}

export function effectiveEffectsVolume(s: AudioSettings = current): number {
  if (s.muteAll || !s.effectsOn) return 0;
  return s.masterVolume * s.effectsVolume;
}

// React hook
import { useEffect, useState } from "react";
export function useAudioSettings(): [AudioSettings, (p: Partial<AudioSettings>) => void] {
  const [s, setS] = useState<AudioSettings>(current);
  useEffect(() => subscribeAudioSettings(setS), []);
  return [s, setAudioSettings];
}
