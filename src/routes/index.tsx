import { createFileRoute } from "@tanstack/react-router";
import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useBackgroundMusic } from "@/lib/audio/useBackgroundMusic";
import { useAudioSettings } from "@/lib/audio/audioSettings";
import { playClick, playHover } from "@/lib/audio/sfx";
import { AudioSettingsPanel } from "@/components/AudioSettingsPanel";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Gesture Fruit Ninja — Slice fruit with your hand" },
      { name: "description", content: "A browser-based Fruit Ninja. Use your mouse to slice flying fruit in real time." },
      { property: "og:title", content: "Gesture Fruit Ninja" },
      { property: "og:description", content: "Slice fruit in the browser." },
    ],
  }),
  component: Index,
});

const FRUIT_LETTERS: Array<{ ch: string; color: string }> = [
  { ch: "F", color: "#8b2fb0" },
  { ch: "R", color: "#e8332a" },
  { ch: "U", color: "#f08a1a" },
  { ch: "I", color: "#3fb43f" },
  { ch: "T", color: "#f5c518" },
];

function Index() {
  const [hoverMode, setHoverMode] = useState<"classic" | "endless" | null>(null);
  const [unlocked, setUnlocked] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [settings] = useAudioSettings();
  const startedRef = useRef(false);

  // Music plays when user has interacted AND music is enabled in settings.
  const musicEnabled = unlocked && settings.musicOn && !settings.muteAll;
  useBackgroundMusic("home", musicEnabled);

  useEffect(() => {
    const start = () => {
      if (startedRef.current) return;
      startedRef.current = true;
      setUnlocked(true);
    };
    window.addEventListener("pointerdown", start, { once: true });
    window.addEventListener("keydown", start, { once: true });
    return () => {
      window.removeEventListener("pointerdown", start);
      window.removeEventListener("keydown", start);
    };
  }, []);

  return (
    <div
      className="relative h-screen w-screen overflow-hidden text-white"
      style={{
        background:
          "radial-gradient(ellipse at 50% 30%, #8a4a23 0%, #5a2d12 45%, #2a1206 100%)",
      }}
    >
      <div
        className="pointer-events-none absolute inset-0 opacity-70 mix-blend-overlay"
        style={{
          backgroundImage:
            "repeating-linear-gradient(0deg, rgba(0,0,0,0.22) 0 3px, transparent 3px 160px), repeating-linear-gradient(90deg, rgba(255,255,255,0.05) 0 1px, transparent 1px 6px)",
        }}
      />
      <div
        className="pointer-events-none absolute inset-0 opacity-60"
        style={{
          backgroundImage:
            "linear-gradient(0deg, transparent 49.7%, rgba(0,0,0,0.55) 49.85%, rgba(0,0,0,0.55) 50.15%, transparent 50.3%)",
          backgroundSize: "100% 33%",
        }}
      />

      <div className="pointer-events-none absolute inset-0">
        <div className="absolute left-1/2 top-[18%] h-[420px] w-[680px] -translate-x-1/2 rounded-full bg-red-600/45 blur-3xl" />
        <div className="absolute left-[28%] top-[14%] h-56 w-56 rounded-full bg-lime-500/40 blur-3xl" />
        <div className="absolute right-[22%] top-[12%] h-56 w-56 rounded-full bg-yellow-400/40 blur-3xl" />
        <div className="absolute left-[12%] top-[24%] h-40 w-40 rounded-full bg-orange-500/35 blur-2xl" />
      </div>

      {[
        { e: "🍉", top: "62%", left: "6%", size: "text-7xl", delay: "0s" },
        { e: "🍍", top: "70%", left: "20%", size: "text-7xl", delay: "0.8s" },
        { e: "🥝", top: "78%", left: "36%", size: "text-6xl", delay: "0.3s" },
        { e: "🍓", top: "74%", left: "52%", size: "text-5xl", delay: "1.1s" },
        { e: "🍌", top: "68%", left: "68%", size: "text-7xl", delay: "0.5s" },
        { e: "🍊", top: "75%", left: "82%", size: "text-6xl", delay: "1.4s" },
        { e: "🍎", top: "18%", left: "4%", size: "text-5xl", delay: "0.6s" },
        { e: "🥭", top: "22%", left: "90%", size: "text-5xl", delay: "1.2s" },
      ].map((f, i) => (
        <span
          key={i}
          className={`pointer-events-none absolute ${f.size} drop-shadow-[0_10px_24px_rgba(0,0,0,0.7)]`}
          style={{
            top: f.top,
            left: f.left,
            animation: `floaty 5.5s ease-in-out ${f.delay} infinite`,
          }}
        >
          {f.e}
        </span>
      ))}

      <style>{`
        @keyframes floaty {
          0%, 100% { transform: translateY(0) rotate(-6deg); }
          50% { transform: translateY(-26px) rotate(8deg); }
        }
        @keyframes slashIn {
          0% { transform: translateX(-120%) rotate(-12deg); opacity: 0; }
          60% { opacity: 1; }
          100% { transform: translateX(0) rotate(-12deg); opacity: 1; }
        }
        @keyframes letterPop {
          0% { transform: translateY(-30px) scale(0.6) rotate(-15deg); opacity: 0; }
          70% { transform: translateY(6px) scale(1.1) rotate(4deg); opacity: 1; }
          100% { transform: translateY(0) scale(1) rotate(-3deg); opacity: 1; }
        }
        @keyframes wobble {
          0%, 100% { transform: rotate(-3deg) scale(1); }
          50% { transform: rotate(3deg) scale(1.04); }
        }
        @keyframes ninjaShine {
          0%, 100% { filter: drop-shadow(0 0 10px rgba(255,255,255,0.4)); }
          50% { filter: drop-shadow(0 0 28px rgba(255,255,255,0.95)); }
        }
      `}</style>

      {/* Top-right audio settings */}
      <div className="absolute right-5 top-5 z-30">
        <button
          onClick={() => { playClick(); setShowSettings((v) => !v); }}
          onMouseEnter={() => playHover()}
          className="rounded-full border border-white/20 bg-black/40 px-4 py-2 text-sm font-semibold backdrop-blur hover:bg-black/60"
          aria-expanded={showSettings}
        >
          ⚙ Audio
        </button>
        {showSettings && (
          <div className="mt-2">
            <AudioSettingsPanel onClose={() => setShowSettings(false)} />
          </div>
        )}
      </div>

      <main className="relative z-10 mx-auto flex h-full max-w-6xl flex-col items-center justify-center px-6 text-center">
        <div className="relative">
          <div className="flex items-end justify-center gap-1 sm:gap-2">
            {FRUIT_LETTERS.map((l, i) => (
              <span
                key={i}
                className="font-black uppercase leading-none text-6xl sm:text-8xl"
                style={{
                  color: l.color,
                  WebkitTextStroke: "3px rgba(0,0,0,0.55)",
                  textShadow: "0 4px 0 rgba(0,0,0,0.45), 0 10px 20px rgba(0,0,0,0.55), inset 0 2px 0 rgba(255,255,255,0.5)",
                  animation: `letterPop 0.7s cubic-bezier(.2,.9,.3,1.4) ${i * 0.08}s both, wobble 3.4s ease-in-out ${1 + i * 0.1}s infinite`,
                  display: "inline-block",
                }}
              >
                {l.ch}
              </span>
            ))}
          </div>
          <div
            className="mt-2 text-3xl font-black uppercase tracking-[0.15em] sm:text-5xl"
            style={{
              background: "linear-gradient(180deg, #ffffff 0%, #cdd6e4 55%, #6b7689 100%)",
              WebkitBackgroundClip: "text",
              backgroundClip: "text",
              color: "transparent",
              WebkitTextStroke: "2px rgba(0,0,0,0.45)",
              textShadow: "0 3px 0 rgba(0,0,0,0.35)",
              animation: "ninjaShine 2.4s ease-in-out infinite",
            }}
          >
            Ninja
          </div>
          <p className="mt-2 text-[11px] font-bold uppercase tracking-[0.45em] text-amber-100/80 sm:text-sm">
            ✦ Gesture Edition ✦
          </p>

          <div
            className="pointer-events-none absolute left-[-10%] right-[-10%] top-[42%] h-[3px] -translate-y-1/2 rounded-full bg-gradient-to-r from-transparent via-white to-transparent shadow-[0_0_30px_8px_rgba(255,255,255,0.7)]"
            style={{ animation: "slashIn 1.2s cubic-bezier(.2,.8,.2,1) both" }}
          />
        </div>

        <div className="mt-7 w-full max-w-2xl">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Link
              to="/play"
              search={{ mode: "classic", music: 1 }}
              onClick={() => playClick()}
              onMouseEnter={() => { setHoverMode("classic"); playHover(); }}
              onMouseLeave={() => setHoverMode(null)}
              className={`group relative overflow-hidden rounded-3xl border-2 border-amber-200/40 bg-gradient-to-br from-orange-400 via-red-500 to-rose-600 p-5 text-left shadow-[0_10px_0_#7f1d1d,0_18px_40px_-8px_rgba(220,38,38,0.6)] transition active:translate-y-1 active:shadow-[0_4px_0_#7f1d1d] ${hoverMode === "classic" ? "scale-[1.03]" : ""}`}
            >
              <div className="flex items-center justify-between">
                <span className="text-4xl drop-shadow">🍉</span>
                <span className="rounded-full bg-white/20 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-white">3 Lives</span>
              </div>
              <h3 className="mt-3 text-xl font-black uppercase tracking-wide text-white">Classic</h3>
              <p className="mt-1 text-xs text-amber-50/90">Slice fruit, dodge bombs. Lose 3 hearts &amp; the round ends.</p>
              <div className="mt-3 inline-flex items-center gap-2 rounded-full bg-white/25 px-4 py-1.5 text-xs font-extrabold uppercase text-white">
                ▶ Play Now
              </div>
              <span className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-white/15" />
            </Link>

            <Link
              to="/play"
              search={{ mode: "endless", music: 1 }}
              onClick={() => playClick()}
              onMouseEnter={() => { setHoverMode("endless"); playHover(); }}
              onMouseLeave={() => setHoverMode(null)}
              className={`group relative overflow-hidden rounded-3xl border-2 border-sky-200/40 bg-gradient-to-br from-sky-400 via-indigo-500 to-purple-600 p-5 text-left shadow-[0_10px_0_#3730a3,0_18px_40px_-8px_rgba(99,102,241,0.6)] transition active:translate-y-1 active:shadow-[0_4px_0_#3730a3] ${hoverMode === "endless" ? "scale-[1.03]" : ""}`}
            >
              <div className="flex items-center justify-between">
                <span className="text-4xl drop-shadow">♾️</span>
                <span className="rounded-full bg-white/20 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-white">Chill</span>
              </div>
              <h3 className="mt-3 text-xl font-black uppercase tracking-wide text-white">Endless</h3>
              <p className="mt-1 text-xs text-sky-50/90">No life limit. Just keep slicing &amp; chase your best combo.</p>
              <div className="mt-3 inline-flex items-center gap-2 rounded-full bg-white/25 px-4 py-1.5 text-xs font-extrabold uppercase text-white">
                ▶ Play Now
              </div>
              <span className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-white/15" />
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
