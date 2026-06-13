import { useEffect, useRef } from "react";
import {
  effectiveMusicVolume,
  getAudioSettings,
  subscribeAudioSettings,
} from "./audioSettings";
import menuMusic from "@/assets/audio/mixkit-owies-ukulele-1072.mp3";

type Variant = "home" | "play";

// [midi, beats]
const MELODIES: Record<Variant, Array<[number, number]>> = {
  // Soft, cheerful ukulele-style nursery loop in C major.
  home: [
    [72, 0.5], [76, 0.5], [79, 0.5], [76, 0.5],
    [77, 0.5], [74, 0.5], [72, 1.0],
    [74, 0.5], [76, 0.5], [77, 0.5], [79, 0.5],
    [76, 0.5], [72, 0.5], [74, 1.0],
    [72, 0.5], [76, 0.5], [79, 0.5], [81, 0.5],
    [79, 0.5], [76, 0.5], [72, 1.0],
    [69, 0.5], [72, 0.5], [76, 0.5], [74, 0.5],
    [72, 0.5], [69, 0.5], [67, 1.0],
  ],
  // Light arcade — playful & energetic but not intense.
  play: [
    [67, 0.5], [72, 0.5], [76, 0.5], [79, 0.5],
    [77, 0.5], [72, 0.5], [76, 0.5], [74, 0.5],
    [69, 0.5], [72, 0.5], [76, 0.5], [81, 0.5],
    [79, 0.5], [76, 0.5], [72, 0.5], [74, 0.5],
  ],
};

const BPM: Record<Variant, number> = { home: 96, play: 124 };

function midiToFreq(m: number) {
  return 440 * Math.pow(2, (m - 69) / 12);
}

export function useBackgroundMusic(variant: Variant, enabled: boolean) {
  const ctxRef = useRef<AudioContext | null>(null);
  const gainRef = useRef<GainNode | null>(null);
  const stopRef = useRef<(() => void) | null>(null);
  const unsubRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!enabled) {
      stopRef.current?.();
      stopRef.current = null;
      return;
    }

    let cancelled = false;
    const start = async () => {
      try {
        if (variant === "play") {
          const audio = new Audio(gameplayMusicAsset.url);
          audio.loop = true;
          audio.preload = "auto";
          audio.volume = 0;
          const fadeTo = (target: number, duration = 500) => {
            const from = audio.volume;
            const startedAt = performance.now();
            const tick = () => {
              const progress = Math.min(1, (performance.now() - startedAt) / duration);
              audio.volume = Math.max(0, Math.min(1, from + (target - from) * progress));
              if (progress < 1 && !cancelled) requestAnimationFrame(tick);
            };
            requestAnimationFrame(tick);
          };
          const beginPlayback = () => {
            audio.play().then(() => fadeTo(effectiveMusicVolume(), 800)).catch(() => {});
          };
          beginPlayback();
          const retryPlayback = () => beginPlayback();
          window.addEventListener("pointerdown", retryPlayback, { once: true });
          window.addEventListener("keydown", retryPlayback, { once: true });
          unsubRef.current?.();
          unsubRef.current = subscribeAudioSettings(() => fadeTo(effectiveMusicVolume(), 400));
          stopRef.current = () => {
            window.removeEventListener("pointerdown", retryPlayback);
            window.removeEventListener("keydown", retryPlayback);
            unsubRef.current?.();
            unsubRef.current = null;
            fadeTo(0, 400);
            window.setTimeout(() => audio.pause(), 450);
          };
          return;
        }

        if (!ctxRef.current) {
          const Ctx =
            window.AudioContext ||
            (window as unknown as { webkitAudioContext: typeof AudioContext })
              .webkitAudioContext;
          ctxRef.current = new Ctx();
        }
        const ac = ctxRef.current!;
        if (ac.state === "suspended") await ac.resume();
        if (cancelled) return;

        const master = ac.createGain();
        master.gain.value = 0;
        master.connect(ac.destination);
        const target = effectiveMusicVolume();
        master.gain.linearRampToValueAtTime(target, ac.currentTime + 0.8);
        gainRef.current = master;

        // Live-update master gain when settings change (smooth fade).
        unsubRef.current?.();
        unsubRef.current = subscribeAudioSettings(() => {
          if (!ctxRef.current || !gainRef.current) return;
          const v = effectiveMusicVolume();
          try {
            gainRef.current.gain.cancelScheduledValues(
              ctxRef.current.currentTime,
            );
            gainRef.current.gain.linearRampToValueAtTime(
              v,
              ctxRef.current.currentTime + 0.4,
            );
          } catch { /* noop */ }
        });

        const melody = MELODIES[variant];
        const beat = 60 / BPM[variant];
        const totalBeats = melody.reduce((s, [, b]) => s + b, 0);
        const loopLen = totalBeats * beat;

        let nextLoopAt = ac.currentTime + 0.1;
        const scheduled: OscillatorNode[] = [];

        const scheduleLoop = (startAt: number) => {
          let t = startAt;
          for (const [midi, beats] of melody) {
            const dur = beats * beat;

            if (variant === "home") {
              // Soft ukulele/xylophone pluck — gentle attack, mellow decay.
              const noteDur = Math.min(dur * 0.95, 0.7);

              // Ukulele-ish triangle pluck
              const uk = ac.createOscillator();
              const ug = ac.createGain();
              uk.type = "triangle";
              uk.frequency.value = midiToFreq(midi);
              ug.gain.setValueAtTime(0, t);
              ug.gain.linearRampToValueAtTime(0.45, t + 0.015);
              ug.gain.exponentialRampToValueAtTime(0.001, t + noteDur);
              uk.connect(ug).connect(master);
              uk.start(t);
              uk.stop(t + noteDur + 0.02);
              scheduled.push(uk);

              // Soft sine "piano" body
              const pi = ac.createOscillator();
              const pg = ac.createGain();
              pi.type = "sine";
              pi.frequency.value = midiToFreq(midi - 12);
              pg.gain.setValueAtTime(0, t);
              pg.gain.linearRampToValueAtTime(0.22, t + 0.02);
              pg.gain.exponentialRampToValueAtTime(0.001, t + noteDur * 0.9);
              pi.connect(pg).connect(master);
              pi.start(t);
              pi.stop(t + noteDur + 0.02);
              scheduled.push(pi);

              // Xylophone sparkle layer (octave up, very short)
              const xy = ac.createOscillator();
              const xg = ac.createGain();
              xy.type = "sine";
              xy.frequency.value = midiToFreq(midi + 12);
              xg.gain.setValueAtTime(0, t);
              xg.gain.linearRampToValueAtTime(0.1, t + 0.005);
              xg.gain.exponentialRampToValueAtTime(0.0008, t + 0.18);
              xy.connect(xg).connect(master);
              xy.start(t);
              xy.stop(t + 0.2);
              scheduled.push(xy);
            } else {
              // Play variant — energetic layered tone.
              const lead = ac.createOscillator();
              const lg = ac.createGain();
              lead.type = "triangle";
              lead.frequency.value = midiToFreq(midi);
              lg.gain.setValueAtTime(0, t);
              lg.gain.linearRampToValueAtTime(0.7, t + 0.015);
              lg.gain.exponentialRampToValueAtTime(0.001, t + dur * 0.95);
              lead.connect(lg).connect(master);
              lead.start(t);
              lead.stop(t + dur);
              scheduled.push(lead);

              const spark = ac.createOscillator();
              const sg = ac.createGain();
              spark.type = "square";
              spark.frequency.value = midiToFreq(midi + 12);
              sg.gain.setValueAtTime(0, t);
              sg.gain.linearRampToValueAtTime(0.08, t + 0.01);
              sg.gain.exponentialRampToValueAtTime(0.0008, t + dur * 0.7);
              spark.connect(sg).connect(master);
              spark.start(t);
              spark.stop(t + dur);
              scheduled.push(spark);

              const bass = ac.createOscillator();
              const bg = ac.createGain();
              bass.type = "sine";
              bass.frequency.value = midiToFreq(midi - 24);
              bg.gain.setValueAtTime(0, t);
              bg.gain.linearRampToValueAtTime(0.5, t + 0.01);
              bg.gain.exponentialRampToValueAtTime(0.001, t + dur * 0.6);
              bass.connect(bg).connect(master);
              bass.start(t);
              bass.stop(t + dur);
              scheduled.push(bass);
            }

            t += dur;
          }
        };

        scheduleLoop(nextLoopAt);
        const interval = window.setInterval(() => {
          if (!ctxRef.current) return;
          const now = ctxRef.current.currentTime;
          if (now + loopLen / 2 >= nextLoopAt + loopLen - 0.05) {
            nextLoopAt = nextLoopAt + loopLen;
            scheduleLoop(nextLoopAt);
          }
        }, 500);

        stopRef.current = () => {
          window.clearInterval(interval);
          unsubRef.current?.();
          unsubRef.current = null;
          try {
            if (gainRef.current && ctxRef.current) {
              gainRef.current.gain.cancelScheduledValues(
                ctxRef.current.currentTime,
              );
              gainRef.current.gain.linearRampToValueAtTime(
                0,
                ctxRef.current.currentTime + 0.5,
              );
            }
          } catch { /* noop */ }
          window.setTimeout(() => {
            scheduled.forEach((o) => {
              try { o.stop(); } catch { /* noop */ }
            });
          }, 600);
        };
      } catch (e) {
        console.warn("[audio] Background music unavailable.", e);
      }
    };

    // Respect global music-off setting at start time too.
    if (effectiveMusicVolume() > 0 || getAudioSettings().musicOn) {
      start();
    }
    return () => {
      cancelled = true;
      stopRef.current?.();
      stopRef.current = null;
    };
  }, [enabled, variant]);

  useEffect(() => {
    return () => {
      try { ctxRef.current?.close(); } catch { /* noop */ }
      ctxRef.current = null;
    };
  }, []);
}
