import { useAudioSettings } from "@/lib/audio/audioSettings";
import { playClick, playSlice, playBomb, playCombo, playHighScore } from "@/lib/audio/sfx";

export function AudioSettingsPanel({ onClose }: { onClose?: () => void }) {
  const [s, set] = useAudioSettings();

  const pct = (n: number) => Math.round(n * 100);

  return (
    <div className="w-[320px] rounded-2xl border border-white/15 bg-black/80 p-4 text-sm text-white shadow-2xl backdrop-blur">
      <div className="mb-3 flex items-center justify-between">
        <div className="text-base font-bold">🔊 Audio Settings</div>
        {onClose && (
          <button
            onClick={() => { playClick(); onClose(); }}
            className="rounded px-2 text-white/60 hover:bg-white/10 hover:text-white"
            aria-label="Close"
          >
            ✕
          </button>
        )}
      </div>

      {/* Mute all */}
      <label className="flex items-center justify-between gap-2 rounded-lg bg-white/5 px-3 py-2">
        <span className="font-semibold">🔇 Mute all</span>
        <input
          type="checkbox"
          checked={s.muteAll}
          onChange={(e) => { playClick(); set({ muteAll: e.target.checked }); }}
        />
      </label>

      {/* Master */}
      <div className="mt-3">
        <div className="mb-1 flex items-center justify-between text-xs text-white/70">
          <span>Master volume</span>
          <span className="tabular-nums">{pct(s.masterVolume)}%</span>
        </div>
        <input
          type="range" min={0} max={100} step={1}
          value={pct(s.masterVolume)}
          onChange={(e) => set({ masterVolume: Number(e.target.value) / 100 })}
          disabled={s.muteAll}
          className="w-full accent-fuchsia-400 disabled:opacity-40"
        />
      </div>

      {/* Music */}
      <div className="mt-3 rounded-xl border border-white/10 bg-white/5 p-3">
        <label className="flex items-center justify-between pb-2">
          <span className="font-semibold">🎵 Music</span>
          <input
            type="checkbox"
            checked={s.musicOn}
            onChange={(e) => { playClick(); set({ musicOn: e.target.checked }); }}
          />
        </label>
        <div className="mb-1 flex items-center justify-between text-xs text-white/70">
          <span>Music volume</span>
          <span className="tabular-nums">{pct(s.musicVolume)}%</span>
        </div>
        <input
          type="range" min={0} max={100} step={1}
          value={pct(s.musicVolume)}
          onChange={(e) => set({ musicVolume: Number(e.target.value) / 100 })}
          disabled={s.muteAll || !s.musicOn}
          className="w-full accent-sky-400 disabled:opacity-40"
        />
      </div>

      {/* Effects */}
      <div className="mt-3 rounded-xl border border-white/10 bg-white/5 p-3">
        <label className="flex items-center justify-between pb-2">
          <span className="font-semibold">💥 Sound effects</span>
          <input
            type="checkbox"
            checked={s.effectsOn}
            onChange={(e) => { playClick(); set({ effectsOn: e.target.checked }); }}
          />
        </label>
        <div className="mb-1 flex items-center justify-between text-xs text-white/70">
          <span>Effects volume</span>
          <span className="tabular-nums">{pct(s.effectsVolume)}%</span>
        </div>
        <input
          type="range" min={0} max={100} step={1}
          value={pct(s.effectsVolume)}
          onChange={(e) => set({ effectsVolume: Number(e.target.value) / 100 })}
          disabled={s.muteAll || !s.effectsOn}
          className="w-full accent-emerald-400 disabled:opacity-40"
        />
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button
            onClick={() => playSlice(3)}
            className="rounded-lg bg-gradient-to-r from-emerald-500 to-lime-500 px-2 py-1.5 text-xs font-bold text-black hover:scale-[1.02]"
          >🍉 Slice</button>
          <button
            onClick={() => playBomb()}
            className="rounded-lg bg-gradient-to-r from-rose-500 to-orange-500 px-2 py-1.5 text-xs font-bold text-white hover:scale-[1.02]"
          >💣 Bomb</button>
          <button
            onClick={() => playCombo(4)}
            className="rounded-lg bg-gradient-to-r from-pink-500 to-fuchsia-500 px-2 py-1.5 text-xs font-bold text-white hover:scale-[1.02]"
          >✨ Combo</button>
          <button
            onClick={() => playHighScore()}
            className="rounded-lg bg-gradient-to-r from-amber-400 to-yellow-300 px-2 py-1.5 text-xs font-bold text-black hover:scale-[1.02]"
          >🏆 Jingle</button>
        </div>
      </div>
    </div>
  );
}
