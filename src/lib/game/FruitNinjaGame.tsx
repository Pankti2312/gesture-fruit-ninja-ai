import { useEffect, useRef, useState } from "react";
import { useHandTracking } from "./useHandTracking";
import { useBackgroundMusic } from "@/lib/audio/useBackgroundMusic";
import { useAudioSettings } from "@/lib/audio/audioSettings";
import {
  playSlice,
  playBomb,
  playCombo,
  playHighScore,
  playGameOver,
  playClick,
  playBack,
  playLifeLost,
} from "@/lib/audio/sfx";
import { AudioSettingsPanel } from "@/components/AudioSettingsPanel";

type GameMode = "classic" | "endless";

interface Fruit {
  id: number;
  kind: "apple" | "orange" | "watermelon" | "banana" | "mango" | "bomb";
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  angle: number;
  spin: number;
  sliced: boolean;
  sliceTime?: number;
  sliceDir?: { x: number; y: number };
  counted?: boolean;
}

interface TrailPoint { x: number; y: number; t: number }
interface Particle { x: number; y: number; vx: number; vy: number; life: number; max: number; color: string; r: number }
interface ScorePopup { x: number; y: number; vy: number; life: number; max: number; text: string; color: string; size: number }

const FRUIT_DEFS = {
  apple:      { color: "#dc2626", inner: "#fef3c7", points: 1, r: 40 },
  mango:      { color: "#f59e0b", inner: "#fde68a", points: 2, r: 42 },
  watermelon: { color: "#16a34a", inner: "#f43f5e", points: 2, r: 50 },
  banana:     { color: "#facc15", inner: "#fef9c3", points: 1, r: 46 },
  orange:     { color: "#fb923c", inner: "#fed7aa", points: 1, r: 40 },
  bomb:       { color: "#1f2937", inner: "#ef4444", points: -5, r: 36 },
} as const;

const HS_KEY = "gfn:highscore";

// ============== Back-compat SFX wrappers (delegate to central sfx module) ==============
export function playSliceSfx(comboCount: number, _volume = 1) {
  void _volume;
  playSlice(comboCount);
}
export function playBombSfx(_volume = 1) {
  void _volume;
  playBomb();
}

export function FruitNinjaGame({ mode, initialMusic = false }: { mode: GameMode; initialMusic?: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const previewRef = useRef<HTMLCanvasElement | null>(null);
  const tracking = useHandTracking(true);

  const [audio] = useAudioSettings();
  const [showSettings, setShowSettings] = useState(false);
  const [showPreview, setShowPreview] = useState(true);
  const [running, setRunning] = useState(true);
  const musicEnabled = !!initialMusic && audio.musicOn && !audio.muteAll && running;
  useBackgroundMusic("play", musicEnabled);
  const [score, setScore] = useState(0);
  const [lives, setLives] = useState(3);
  const [fps, setFps] = useState(0);
  const [sliced, setSliced] = useState(0);
  const [spawned, setSpawned] = useState(0);
  const [gameOver, setGameOver] = useState(false);
  const [highScore, setHighScore] = useState(0);
  const [combo, setCombo] = useState(0);
  const [bestCombo, setBestCombo] = useState(0);
  const [scoreBump, setScoreBump] = useState(0); // bumps each time score increases, drives CSS animation

  // Derived flags for SFX gating
  const soundOn = audio.effectsOn && !audio.muteAll;

  // Mutable refs the game loop reads (avoid stale closures + re-renders).
  const stateRef = useRef({ score: 0, lives: 3, sliced: 0, spawned: 0, running: true, soundOn: true, sfxVolume: 0.9 });
  useEffect(() => { stateRef.current.score = score; }, [score]);
  useEffect(() => { stateRef.current.lives = lives; }, [lives]);
  useEffect(() => { stateRef.current.sliced = sliced; }, [sliced]);
  useEffect(() => { stateRef.current.spawned = spawned; }, [spawned]);
  useEffect(() => { stateRef.current.running = running && !gameOver; }, [running, gameOver]);
  useEffect(() => { stateRef.current.soundOn = soundOn; }, [soundOn]);

  // Combo refs read by the loop
  const comboRef = useRef({ count: 0, lastSliceAt: 0 });
  const popupsRef = useRef<ScorePopup[]>([]);
  const COMBO_WINDOW = 900; // ms between slices to keep combo

  // Tracking refs (loop polls these without re-rendering on every frame).
  const tipRef = useRef<{ x: number; y: number } | null>(null);
  const landmarksRef = useRef<{ x: number; y: number }[] | null>(null);
  useEffect(() => { tipRef.current = tracking.tip; }, [tracking.tip]);
  useEffect(() => { landmarksRef.current = tracking.landmarks; }, [tracking.landmarks]);

  // Mouse fallback.
  const mouseRef = useRef<{ x: number; y: number } | null>(null);

  // Persisted high score.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(HS_KEY);
      if (raw) setHighScore(Number(raw) || 0);
    } catch { /* noop */ }
  }, []);

  useEffect(() => {
    if (gameOver) {
      let beat = false;
      setHighScore((prev) => {
        const next = Math.max(prev, score);
        beat = score > prev && score > 0;
        try { localStorage.setItem(HS_KEY, String(next)); } catch { /* noop */ }
        return next;
      });
      // Play game-over melody, then victory jingle if a new high score was set.
      playGameOver();
      if (beat) {
        window.setTimeout(() => playHighScore(), 700);
      }
    }
  }, [gameOver, score]);

  // Main game loop.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;

    let width = 0, height = 0;
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const fruits: Fruit[] = [];
    const trail: TrailPoint[] = [];
    const particles: Particle[] = [];
    let lastTime = performance.now();
    let lastSpawn = 0;
    let shake = 0;
    let nextId = 1;
    let fpsAccum = 0, fpsFrames = 0, fpsTimer = 0;
    let raf = 0;
    let elapsed = 0;

    const spawnFruit = () => {
      // Spawn from comfortable lanes (avoid hard edges so fruits stay reachable).
      const startX = width * (0.2 + Math.random() * 0.6);
      const targetX = width * (0.25 + Math.random() * 0.5);
      // Difficulty ramp for endless mode.
      const speedMul = mode === "endless" ? 1 + Math.min(elapsed / 120000, 0.35) : 1;
      // Aim for a peak between 18%–32% from the top of the play area, so
      // fruits always rise into the player's natural hand zone.
      const g = 1400;
      const targetPeakY = height * (0.18 + Math.random() * 0.14);
      const riseDistance = Math.max(120, height - targetPeakY);
      const vy = -Math.sqrt(2 * g * riseDistance) * speedMul;
      // Time to reach peak — used to set horizontal drift so fruits land in a reachable arc.
      const tToPeak = Math.abs(vy) / g;
      const vx = ((targetX - startX) / Math.max(0.4, tToPeak * 2)) * speedMul;
      const bombChance = mode === "endless" ? 0.08 + Math.min(elapsed / 120000, 0.1) : 0.1;
      const isBomb = Math.random() < bombChance;
      const kinds: Fruit["kind"][] = ["apple", "orange", "watermelon", "banana", "mango"];
      const kind: Fruit["kind"] = isBomb ? "bomb" : kinds[Math.floor(Math.random() * kinds.length)];
      const def = FRUIT_DEFS[kind];
      fruits.push({
        id: nextId++,
        kind,
        x: startX,
        y: height + def.r,
        vx,
        vy,
        r: def.r,
        angle: Math.random() * Math.PI * 2,
        spin: (Math.random() - 0.5) * 4,
        sliced: false,
      });
      setSpawned((s) => s + 1);
    };

    const playTone = (freq: number, duration = 0.08, type: OscillatorType = "triangle", gain = 0.08) => {
      if (!stateRef.current.soundOn) return;
      try {
        const AC: typeof AudioContext =
          window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        const ac = new AC();
        const osc = ac.createOscillator();
        const g = ac.createGain();
        osc.type = type;
        osc.frequency.value = freq;
        g.gain.value = gain;
        osc.connect(g).connect(ac.destination);
        osc.start();
        g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + duration);
        osc.stop(ac.currentTime + duration);
        setTimeout(() => ac.close(), duration * 1000 + 100);
      } catch { /* noop */ }
    };

    // SFX wrappers — gate on the live soundOn/volume from stateRef.
    const sliceSfx = (comboCount: number) => {
      if (!stateRef.current.soundOn) return;
      playSliceSfx(comboCount, stateRef.current.sfxVolume);
    };
    const bombSfx = () => {
      if (!stateRef.current.soundOn) return;
      playBombSfx(stateRef.current.sfxVolume);
    };

    const burstParticles = (x: number, y: number, color: string, count = 18) => {
      for (let i = 0; i < count; i++) {
        const a = Math.random() * Math.PI * 2;
        const sp = 80 + Math.random() * 280;
        particles.push({
          x, y,
          vx: Math.cos(a) * sp,
          vy: Math.sin(a) * sp - 120,
          life: 0, max: 0.6 + Math.random() * 0.4,
          color,
          r: 2 + Math.random() * 4,
        });
      }
    };

    const handleSlice = (fruit: Fruit, dir: { x: number; y: number }) => {
      fruit.sliced = true;
      fruit.sliceTime = 0;
      fruit.sliceDir = dir;
      const def = FRUIT_DEFS[fruit.kind];
      if (fruit.kind === "bomb") {
        burstParticles(fruit.x, fruit.y, "#f97316", 40);
        burstParticles(fruit.x, fruit.y, "#facc15", 20);
        shake = 24;
        setScore((s) => Math.max(0, s + def.points));
        setLives((l) => Math.max(0, l - 1));
        if (stateRef.current.soundOn) playLifeLost();
        bombSfx();
        // Bomb breaks combo
        comboRef.current.count = 0;
        setCombo(0);
        popupsRef.current.push({
          x: fruit.x, y: fruit.y - 10, vy: -40, life: 0, max: 1.0,
          text: "💥 BOOM!", color: "#f87171", size: 28,
        });
      } else {
        burstParticles(fruit.x, fruit.y, def.inner, 22);
        const now = performance.now();
        const c = comboRef.current;
        if (now - c.lastSliceAt < COMBO_WINDOW) c.count += 1;
        else c.count = 1;
        c.lastSliceAt = now;
        const comboCount = c.count;
        // Bonus: +1 per chain step beyond the first
        const bonus = Math.max(0, comboCount - 1);
        const earned = def.points + bonus;
        setScore((s) => s + earned);
        setSliced((n) => n + 1);
        setScoreBump((b) => b + 1);
        setCombo(comboCount);
        setBestCombo((b) => Math.max(b, comboCount));
        // Soft slice swoosh + chime, pitch ramps up with the combo
        sliceSfx(comboCount);
        // Floating points popup
        popupsRef.current.push({
          x: fruit.x, y: fruit.y - 10, vy: -70, life: 0, max: 0.9,
          text: `+${earned}`,
          color: comboCount >= 3 ? "#fde047" : "#ffffff",
          size: 22 + Math.min(comboCount, 6) * 2,
        });
        if (comboCount >= 2) {
          popupsRef.current.push({
            x: fruit.x, y: fruit.y - 40, vy: -55, life: 0, max: 1.1,
            text: `${comboCount}× COMBO!`,
            color: "#f472b6",
            size: 20 + Math.min(comboCount, 6) * 2,
          });
          // Ascending chime for combo chains
          if (stateRef.current.soundOn) playCombo(comboCount);
        }
      }
    };

    const tryHitFruits = (px: number, py: number, prev: { x: number; y: number }) => {
      // Build a short slice buffer: check the last few trail segments, not just
      // the latest one. This tolerates minor MediaPipe jitter and frame drops,
      // so a clean swipe still registers even if a sample lands slightly off.
      const segs: { ax: number; ay: number; bx: number; by: number }[] = [];
      const lookback = Math.min(4, trail.length - 1);
      for (let i = trail.length - 1; i > trail.length - 1 - lookback; i--) {
        const a = trail[i - 1], b = trail[i];
        segs.push({ ax: a.x, ay: a.y, bx: b.x, by: b.y });
      }
      // Also include the synthetic current segment (prev -> current pointer).
      segs.push({ ax: prev.x, ay: prev.y, bx: px, by: py });

      // Total motion across the buffered window — much more forgiving than
      // requiring a single fast frame.
      let totalLen = 0;
      for (const s of segs) totalLen += Math.hypot(s.bx - s.ax, s.by - s.ay);
      if (totalLen < 3) return; // tiny deadzone to ignore pure hover noise

      for (const f of fruits) {
        if (f.sliced) continue;
        // Expanded hitbox: 1.35× fruit radius accommodates tracking drift.
        const hitR = f.r * 1.35;
        for (const s of segs) {
          const dx = s.bx - s.ax, dy = s.by - s.ay;
          const len2 = dx * dx + dy * dy;
          let cx: number, cy: number;
          if (len2 < 0.001) {
            cx = s.ax; cy = s.ay;
          } else {
            const t = Math.max(0, Math.min(1, ((f.x - s.ax) * dx + (f.y - s.ay) * dy) / len2));
            cx = s.ax + dx * t; cy = s.ay + dy * t;
          }
          const dist = Math.hypot(f.x - cx, f.y - cy);
          if (dist < hitR) {
            const len = Math.hypot(dx, dy) || 1;
            handleSlice(f, { x: dx / len, y: dy / len });
            break;
          }
        }
      }
    };

    const drawApple = (r: number) => {
      // body
      const grad = ctx.createRadialGradient(-r * 0.3, -r * 0.3, r * 0.2, 0, 0, r);
      grad.addColorStop(0, "#fca5a5");
      grad.addColorStop(0.5, "#ef4444");
      grad.addColorStop(1, "#7f1d1d");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.ellipse(0, 2, r * 0.95, r, 0, 0, Math.PI * 2);
      ctx.fill();
      // dimple
      ctx.fillStyle = "rgba(0,0,0,0.18)";
      ctx.beginPath();
      ctx.ellipse(0, -r * 0.9, r * 0.18, r * 0.08, 0, 0, Math.PI * 2);
      ctx.fill();
      // stem
      ctx.strokeStyle = "#7c2d12";
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(0, -r * 0.9);
      ctx.quadraticCurveTo(r * 0.1, -r * 1.15, r * 0.25, -r * 1.2);
      ctx.stroke();
      // leaf
      ctx.fillStyle = "#16a34a";
      ctx.beginPath();
      ctx.ellipse(r * 0.35, -r * 1.1, r * 0.22, r * 0.1, -0.6, 0, Math.PI * 2);
      ctx.fill();
      // highlight
      ctx.fillStyle = "rgba(255,255,255,0.35)";
      ctx.beginPath();
      ctx.ellipse(-r * 0.35, -r * 0.35, r * 0.22, r * 0.32, -0.4, 0, Math.PI * 2);
      ctx.fill();
    };

    const drawOrange = (r: number) => {
      const grad = ctx.createRadialGradient(-r * 0.3, -r * 0.3, r * 0.2, 0, 0, r);
      grad.addColorStop(0, "#fed7aa");
      grad.addColorStop(0.6, "#fb923c");
      grad.addColorStop(1, "#9a3412");
      ctx.fillStyle = grad;
      ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
      // texture dots
      ctx.fillStyle = "rgba(124, 45, 18, 0.35)";
      for (let i = 0; i < 14; i++) {
        const a = (i / 14) * Math.PI * 2;
        const rr = r * (0.45 + Math.random() * 0.4);
        ctx.beginPath();
        ctx.arc(Math.cos(a) * rr, Math.sin(a) * rr, 1.2, 0, Math.PI * 2);
        ctx.fill();
      }
      // leaf
      ctx.fillStyle = "#15803d";
      ctx.beginPath();
      ctx.ellipse(r * 0.15, -r * 1.0, r * 0.28, r * 0.12, -0.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.3)";
      ctx.beginPath();
      ctx.ellipse(-r * 0.35, -r * 0.35, r * 0.22, r * 0.32, -0.4, 0, Math.PI * 2);
      ctx.fill();
    };

    const drawMango = (r: number) => {
      const grad = ctx.createLinearGradient(-r, -r, r, r);
      grad.addColorStop(0, "#fde68a");
      grad.addColorStop(0.5, "#f59e0b");
      grad.addColorStop(1, "#b45309");
      ctx.fillStyle = grad;
      ctx.beginPath();
      // egg-shaped, tilted
      ctx.ellipse(0, 0, r * 0.78, r * 1.05, -0.35, 0, Math.PI * 2);
      ctx.fill();
      // blush
      ctx.fillStyle = "rgba(220, 38, 38, 0.35)";
      ctx.beginPath();
      ctx.ellipse(-r * 0.25, -r * 0.45, r * 0.35, r * 0.25, -0.35, 0, Math.PI * 2);
      ctx.fill();
      // stem
      ctx.strokeStyle = "#65a30d";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(r * 0.25, -r * 0.85);
      ctx.lineTo(r * 0.4, -r * 1.05);
      ctx.stroke();
      ctx.fillStyle = "rgba(255,255,255,0.35)";
      ctx.beginPath();
      ctx.ellipse(-r * 0.3, -r * 0.3, r * 0.18, r * 0.28, -0.35, 0, Math.PI * 2);
      ctx.fill();
    };

    const drawWatermelon = (r: number) => {
      // rind
      ctx.fillStyle = "#14532d";
      ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
      // light rind stripes
      ctx.strokeStyle = "#22c55e";
      ctx.lineWidth = 4;
      for (let i = -2; i <= 2; i++) {
        ctx.beginPath();
        ctx.arc(0, 0, r - 2, Math.PI * 0.5 + i * 0.2 - 0.1, Math.PI * 0.5 + i * 0.2 + 0.1);
        ctx.stroke();
      }
      // flesh
      ctx.fillStyle = "#f9fafb";
      ctx.beginPath(); ctx.arc(0, 0, r * 0.82, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#ef4444";
      ctx.beginPath(); ctx.arc(0, 0, r * 0.72, 0, Math.PI * 2); ctx.fill();
      // seeds
      ctx.fillStyle = "#1f2937";
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        const rr = r * 0.45;
        ctx.beginPath();
        ctx.ellipse(Math.cos(a) * rr, Math.sin(a) * rr, 2.5, 4, a, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = "rgba(255,255,255,0.25)";
      ctx.beginPath();
      ctx.ellipse(-r * 0.3, -r * 0.3, r * 0.2, r * 0.3, -0.4, 0, Math.PI * 2);
      ctx.fill();
    };

    const drawBanana = (r: number) => {
      // crescent
      ctx.save();
      ctx.rotate(-0.4);
      const grad = ctx.createLinearGradient(0, -r, 0, r);
      grad.addColorStop(0, "#fef08a");
      grad.addColorStop(0.6, "#facc15");
      grad.addColorStop(1, "#a16207");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(-r * 1.0, r * 0.2);
      ctx.quadraticCurveTo(-r * 0.3, -r * 1.3, r * 1.1, -r * 0.2);
      ctx.quadraticCurveTo(r * 0.9, r * 0.1, r * 0.95, r * 0.3);
      ctx.quadraticCurveTo(-r * 0.2, -r * 0.6, -r * 0.9, r * 0.45);
      ctx.closePath();
      ctx.fill();
      // dark tips
      ctx.fillStyle = "#422006";
      ctx.beginPath(); ctx.arc(-r * 0.98, r * 0.3, 3, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(r * 1.05, -r * 0.2, 3, 0, Math.PI * 2); ctx.fill();
      // highlight ridge
      ctx.strokeStyle = "rgba(255,255,255,0.4)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-r * 0.8, r * 0.05);
      ctx.quadraticCurveTo(-r * 0.2, -r * 0.85, r * 0.9, -r * 0.2);
      ctx.stroke();
      ctx.restore();
    };

    const drawBomb = (r: number) => {
      // body
      const grad = ctx.createRadialGradient(-r * 0.3, -r * 0.3, r * 0.2, 0, 0, r);
      grad.addColorStop(0, "#4b5563");
      grad.addColorStop(1, "#0f172a");
      ctx.fillStyle = grad;
      ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
      // highlight
      ctx.fillStyle = "rgba(255,255,255,0.25)";
      ctx.beginPath();
      ctx.arc(-r * 0.35, -r * 0.35, r * 0.22, 0, Math.PI * 2);
      ctx.fill();
      // fuse cap
      ctx.fillStyle = "#374151";
      ctx.fillRect(-r * 0.18, -r * 1.1, r * 0.36, r * 0.2);
      // fuse
      ctx.strokeStyle = "#a16207";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(0, -r * 1.1);
      ctx.quadraticCurveTo(r * 0.6, -r * 1.5, r * 0.85, -r * 1.15);
      ctx.stroke();
      // spark
      ctx.fillStyle = "#fbbf24";
      ctx.beginPath(); ctx.arc(r * 0.85, -r * 1.15, 4, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#fff7ed";
      ctx.beginPath(); ctx.arc(r * 0.85, -r * 1.15, 1.8, 0, Math.PI * 2); ctx.fill();
    };

    const drawFruitShape = (kind: Fruit["kind"], r: number) => {
      switch (kind) {
        case "apple": return drawApple(r);
        case "orange": return drawOrange(r);
        case "mango": return drawMango(r);
        case "watermelon": return drawWatermelon(r);
        case "banana": return drawBanana(r);
        case "bomb": return drawBomb(r);
      }
    };

    const drawFruit = (f: Fruit) => {
      const def = FRUIT_DEFS[f.kind];
      ctx.save();
      ctx.translate(f.x, f.y);
      ctx.rotate(f.angle);

      // outer glow
      const glow = ctx.createRadialGradient(0, 0, f.r * 0.4, 0, 0, f.r * 1.5);
      glow.addColorStop(0, def.color + "55");
      glow.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = glow;
      ctx.beginPath(); ctx.arc(0, 0, f.r * 1.5, 0, Math.PI * 2); ctx.fill();

      if (f.sliced) {
        const t = f.sliceTime ?? 0;
        const offset = 8 + t * 80;
        const dir = f.sliceDir ?? { x: 1, y: 0 };
        const nx = -dir.y, ny = dir.x;
        // Top half
        ctx.save();
        ctx.translate(nx * offset, ny * offset);
        ctx.beginPath();
        ctx.rect(-f.r * 1.6, -f.r * 1.6, f.r * 3.2, f.r * 1.6);
        ctx.clip();
        drawFruitShape(f.kind, f.r);
        // exposed flesh
        ctx.fillStyle = def.inner;
        ctx.fillRect(-f.r * 1.2, -2, f.r * 2.4, 4);
        ctx.restore();
        // Bottom half
        ctx.save();
        ctx.translate(-nx * offset, -ny * offset);
        ctx.beginPath();
        ctx.rect(-f.r * 1.6, 0, f.r * 3.2, f.r * 1.6);
        ctx.clip();
        drawFruitShape(f.kind, f.r);
        ctx.fillStyle = def.inner;
        ctx.fillRect(-f.r * 1.2, -2, f.r * 2.4, 4);
        ctx.restore();
      } else {
        drawFruitShape(f.kind, f.r);
      }
      ctx.restore();
    };

    const step = (now: number) => {
      const dt = Math.min(0.04, (now - lastTime) / 1000);
      lastTime = now;
      elapsed += dt * 1000;
      fpsAccum += dt; fpsFrames++; fpsTimer += dt;
      if (fpsTimer >= 0.5) {
        setFps(Math.round(fpsFrames / fpsAccum));
        fpsAccum = 0; fpsFrames = 0; fpsTimer = 0;
      }

      // Resolve pointer position (fingertip or mouse fallback).
      let pointer: { x: number; y: number } | null = null;
      const tip = tipRef.current;
      if (tip) pointer = { x: tip.x * width, y: tip.y * height };
      else if (mouseRef.current) pointer = mouseRef.current;

      if (pointer && stateRef.current.running) {
        trail.push({ x: pointer.x, y: pointer.y, t: now });
        if (trail.length >= 2) {
          const prev = trail[trail.length - 2];
          tryHitFruits(pointer.x, pointer.y, prev);
        }
      }
      // Expire trail
      while (trail.length && now - trail[0].t > 180) trail.shift();

      // Spawn cadence — slower, and never more than 3 active fruits at once
      const spawnInterval = mode === "endless"
        ? Math.max(1200, 1900 - elapsed / 60)
        : 1700;
      const activeFruits = fruits.reduce((n, f) => n + (f.sliced ? 0 : 1), 0);
      const MAX_ACTIVE = 3;
      if (
        stateRef.current.running &&
        now - lastSpawn > spawnInterval &&
        activeFruits < MAX_ACTIVE
      ) {
        lastSpawn = now;
        // 70% one fruit, 30% two — but never exceed MAX_ACTIVE on screen
        const desired = Math.random() < 0.3 ? 2 : 1;
        const count = Math.min(desired, MAX_ACTIVE - activeFruits);
        for (let i = 0; i < count; i++) spawnFruit();
      }

      // Physics
      const g = 1400;
      for (const f of fruits) {
        f.vy += g * dt;
        f.x += f.vx * dt;
        f.y += f.vy * dt;
        f.angle += f.spin * dt;
        if (f.sliced) f.sliceTime = (f.sliceTime ?? 0) + dt;
      }

      // Missed fruits (off bottom)
      for (const f of fruits) {
        if (!f.counted && f.y - f.r > height + 10) {
          f.counted = true;
          if (!f.sliced && f.kind !== "bomb" && stateRef.current.running) {
            if (mode === "classic") {
              setLives((l) => Math.max(0, l - 1));
              if (stateRef.current.soundOn) playLifeLost();
            }
          }
        }
      }
      // Remove off-screen
      for (let i = fruits.length - 1; i >= 0; i--) {
        const f = fruits[i];
        if (f.y - f.r > height + 60 || (f.sliced && (f.sliceTime ?? 0) > 1.2)) {
          fruits.splice(i, 1);
        }
      }

      // Particles
      for (const p of particles) {
        p.life += dt;
        p.vy += g * 0.6 * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
      }
      for (let i = particles.length - 1; i >= 0; i--) {
        if (particles[i].life >= particles[i].max) particles.splice(i, 1);
      }

      // Score popups
      const popups = popupsRef.current;
      for (const p of popups) {
        p.life += dt;
        p.y += p.vy * dt;
        p.vy += 30 * dt; // slight decel
      }
      for (let i = popups.length - 1; i >= 0; i--) {
        if (popups[i].life >= popups[i].max) popups.splice(i, 1);
      }

      // Combo timeout
      if (comboRef.current.count > 0 && performance.now() - comboRef.current.lastSliceAt > COMBO_WINDOW) {
        comboRef.current.count = 0;
        setCombo(0);
      }

      // Shake
      const sx = shake ? (Math.random() - 0.5) * shake : 0;
      const sy = shake ? (Math.random() - 0.5) * shake : 0;
      shake = Math.max(0, shake - dt * 60);

      // Game over check
      if (mode === "classic" && stateRef.current.lives <= 0 && stateRef.current.running) {
        setGameOver(true);
      }

      // --- Render ---
      ctx.save();
      ctx.translate(sx, sy);

      // ===== Kid-friendly sunny sky background =====
      const sky = ctx.createLinearGradient(0, 0, 0, height);
      sky.addColorStop(0, "#7dd3fc");   // bright sky blue
      sky.addColorStop(0.55, "#fde68a"); // warm horizon
      sky.addColorStop(1, "#86efac");    // grassy green
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, width, height);

      // Sun with soft halo (top-right)
      const sunX = width * 0.85, sunY = height * 0.18, sunR = 60;
      const halo = ctx.createRadialGradient(sunX, sunY, sunR * 0.5, sunX, sunY, sunR * 3);
      halo.addColorStop(0, "rgba(253, 224, 71, 0.55)");
      halo.addColorStop(1, "rgba(253, 224, 71, 0)");
      ctx.fillStyle = halo;
      ctx.beginPath(); ctx.arc(sunX, sunY, sunR * 3, 0, Math.PI * 2); ctx.fill();
      const sunGrad = ctx.createRadialGradient(sunX - 10, sunY - 10, 10, sunX, sunY, sunR);
      sunGrad.addColorStop(0, "#fffbeb");
      sunGrad.addColorStop(1, "#fbbf24");
      ctx.fillStyle = sunGrad;
      ctx.beginPath(); ctx.arc(sunX, sunY, sunR, 0, Math.PI * 2); ctx.fill();

      // Drifting fluffy clouds
      const drawCloud = (cx: number, cy: number, scale: number, alpha: number) => {
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.fillStyle = "#ffffff";
        for (const [ox, oy, r] of [[-30, 0, 26], [0, -10, 32], [28, 0, 26], [-10, 10, 22], [16, 10, 22]] as const) {
          ctx.beginPath();
          ctx.arc(cx + ox * scale, cy + oy * scale, r * scale, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      };
      const cloudT = now / 1000;
      for (let i = 0; i < 5; i++) {
        const baseX = ((cloudT * (10 + i * 4) + i * 220) % (width + 200)) - 100;
        const baseY = 70 + i * 55 + Math.sin(cloudT * 0.4 + i) * 8;
        if (baseY < height * 0.55) drawCloud(baseX, baseY, 0.7 + (i % 3) * 0.15, 0.85);
      }

      // Rolling grass hills at the bottom
      ctx.fillStyle = "#4ade80";
      ctx.beginPath();
      ctx.moveTo(0, height);
      ctx.lineTo(0, height * 0.82);
      for (let x = 0; x <= width; x += 40) {
        const y = height * 0.82 + Math.sin(x * 0.012) * 18;
        ctx.lineTo(x, y);
      }
      ctx.lineTo(width, height);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "#22c55e";
      ctx.beginPath();
      ctx.moveTo(0, height);
      ctx.lineTo(0, height * 0.9);
      for (let x = 0; x <= width; x += 40) {
        const y = height * 0.9 + Math.sin(x * 0.015 + 1) * 14;
        ctx.lineTo(x, y);
      }
      ctx.lineTo(width, height);
      ctx.closePath();
      ctx.fill();

      // Confetti sparkles for playful energy
      for (let i = 0; i < 14; i++) {
        const t = now / 1000 + i * 0.9;
        const fx = ((Math.sin(t * 0.6 + i * 1.3) * 0.5 + 0.5) * width);
        const fy = ((t * 30 + i * 80) % height);
        const colors = ["#f472b6", "#60a5fa", "#fbbf24", "#a78bfa", "#34d399"];
        ctx.fillStyle = colors[i % colors.length];
        ctx.globalAlpha = 0.55;
        ctx.beginPath();
        ctx.arc(fx, fy, 3, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      // Fruits
      for (const f of fruits) drawFruit(f);

      // Particles
      for (const p of particles) {
        const a = 1 - p.life / p.max;
        ctx.fillStyle = p.color;
        ctx.globalAlpha = Math.max(0, a);
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 1;

      // Score popups
      for (const p of popups) {
        const a = 1 - p.life / p.max;
        ctx.save();
        ctx.globalAlpha = Math.max(0, a);
        ctx.font = `900 ${p.size}px system-ui, -apple-system, sans-serif`;
        ctx.textAlign = "center";
        ctx.lineWidth = 4;
        ctx.strokeStyle = "rgba(0,0,0,0.55)";
        ctx.strokeText(p.text, p.x, p.y);
        ctx.fillStyle = p.color;
        ctx.fillText(p.text, p.x, p.y);
        ctx.restore();
      }

      // Trail (glowing sword)
      if (trail.length >= 2) {
        for (let pass = 0; pass < 2; pass++) {
          ctx.lineCap = "round";
          ctx.lineJoin = "round";
          ctx.strokeStyle = pass === 0 ? "rgba(244, 114, 182, 0.45)" : "rgba(255, 255, 255, 0.95)";
          ctx.lineWidth = pass === 0 ? 22 : 6;
          ctx.beginPath();
          for (let i = 0; i < trail.length; i++) {
            const p = trail[i];
            if (i === 0) ctx.moveTo(p.x, p.y);
            else ctx.lineTo(p.x, p.y);
          }
          ctx.stroke();
        }
        const last = trail[trail.length - 1];
        ctx.fillStyle = "white";
        ctx.beginPath(); ctx.arc(last.x, last.y, 8, 0, Math.PI * 2); ctx.fill();
      }

      ctx.restore();

      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);

    const onMove = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      mouseRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };
    const onLeave = () => { mouseRef.current = null; };
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerleave", onLeave);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerleave", onLeave);
    };
  }, [mode]);

  // Webcam preview drawing (separate canvas).
  useEffect(() => {
    if (!showPreview) return;
    const c = previewRef.current;
    const video = tracking.videoRef.current;
    if (!c) return;
    const ctx = c.getContext("2d")!;
    let raf = 0;
    const draw = () => {
      const w = c.width, h = c.height;
      ctx.save();
      ctx.clearRect(0, 0, w, h);
      if (video && video.readyState >= 2) {
        ctx.save();
        ctx.translate(w, 0);
        ctx.scale(-1, 1);
        ctx.drawImage(video, 0, 0, w, h);
        ctx.restore();
      } else {
        ctx.fillStyle = "#1f1530";
        ctx.fillRect(0, 0, w, h);
      }
      const lm = landmarksRef.current;
      if (lm) {
        const pairs = [[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],[9,13],[13,14],[14,15],[15,16],[13,17],[17,18],[18,19],[19,20],[0,17]];
        ctx.strokeStyle = "rgba(244,114,182,0.9)";
        ctx.lineWidth = 2;
        for (const [a, b] of pairs) {
          ctx.beginPath();
          ctx.moveTo(lm[a].x * w, lm[a].y * h);
          ctx.lineTo(lm[b].x * w, lm[b].y * h);
          ctx.stroke();
        }
        ctx.fillStyle = "white";
        for (const p of lm) {
          ctx.beginPath();
          ctx.arc(p.x * w, p.y * h, 2.5, 0, Math.PI * 2);
          ctx.fill();
        }
        // Highlight index fingertip
        ctx.fillStyle = "#facc15";
        ctx.beginPath();
        ctx.arc(lm[8].x * w, lm[8].y * h, 5, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [showPreview, tracking.videoRef]);

  const restart = () => {
    setScore(0);
    setLives(3);
    setSliced(0);
    setSpawned(0);
    setGameOver(false);
    setRunning(true);
    setCombo(0);
    setBestCombo(0);
    comboRef.current = { count: 0, lastSliceAt: 0 };
    popupsRef.current = [];
  };

  const accuracy = spawned > 0 ? Math.round((sliced / spawned) * 100) : 0;

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-black text-white">
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
      {/* Hidden video element used by MediaPipe */}
      <video ref={tracking.videoRef} className="absolute h-0 w-0 opacity-0" playsInline muted />

      {/* HUD */}
      <div className="pointer-events-none absolute left-0 top-0 z-10 flex w-full items-start justify-between p-5">
        <div className="pointer-events-auto flex items-center gap-3">
          <a href="/" onClick={() => playBack()} className="rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-sm font-medium backdrop-blur hover:bg-black/60">← Menu</a>
          {/* Big juicy score card */}
          <div
            key={scoreBump}
            className="relative overflow-hidden rounded-2xl border-2 border-amber-300/40 bg-gradient-to-b from-amber-500/30 to-red-700/40 px-5 py-2 shadow-[0_6px_0_rgba(0,0,0,0.35),0_0_30px_-5px_rgba(251,191,36,0.6)] backdrop-blur"
            style={{ animation: "scorePop 280ms cubic-bezier(.2,.8,.2,1)" }}
          >
            <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-amber-100/90">Score</div>
            <div
              className="bg-gradient-to-b from-yellow-100 to-orange-300 bg-clip-text text-3xl font-black leading-none text-transparent tabular-nums"
              style={{ WebkitTextStroke: "1px rgba(0,0,0,0.25)" }}
            >
              {score.toLocaleString()}
            </div>
          </div>
          <div className="rounded-2xl border border-white/15 bg-black/40 px-4 py-2 backdrop-blur">
            <div className="text-[10px] uppercase tracking-widest text-white/50">🏆 High</div>
            <div className="text-xl font-bold leading-none tabular-nums">{Math.max(highScore, score).toLocaleString()}</div>
          </div>
          {combo >= 2 && (
            <div
              key={`c-${combo}`}
              className="rounded-2xl border-2 border-pink-300/60 bg-gradient-to-b from-pink-500/40 to-fuchsia-700/50 px-4 py-2 shadow-[0_0_30px_-5px_rgba(244,114,182,0.8)] backdrop-blur"
              style={{ animation: "scorePop 240ms cubic-bezier(.2,.8,.2,1)" }}
            >
              <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-pink-100">Combo</div>
              <div className="text-2xl font-black leading-none text-white">{combo}×</div>
            </div>
          )}
          {mode === "classic" && (
            <div className="rounded-lg border border-white/15 bg-black/40 px-4 py-2 backdrop-blur">
              <div className="text-[10px] uppercase tracking-widest text-white/50">Lives</div>
              <div className="text-2xl font-bold leading-none">
                {"❤".repeat(lives) + "♡".repeat(Math.max(0, 3 - lives))}
              </div>
            </div>
          )}
          <div className="rounded-lg border border-white/15 bg-black/40 px-3 py-2 text-xs text-white/60 backdrop-blur">
            FPS {fps}
          </div>
        </div>
        <style>{`
          @keyframes scorePop {
            0% { transform: scale(0.85); }
            60% { transform: scale(1.12); }
            100% { transform: scale(1); }
          }
        `}</style>

        {/* Webcam preview */}
        {showPreview && (
          <div className="pointer-events-auto overflow-hidden rounded-2xl border border-white/20 bg-black/40 shadow-[0_0_40px_-10px_rgba(244,114,182,0.6)] backdrop-blur">
            <canvas ref={previewRef} width={240} height={180} className="block h-[180px] w-[240px]" />
            <div className="flex items-center justify-between gap-2 border-t border-white/10 bg-black/40 px-3 py-1.5 text-[11px]">
              <span className="flex items-center gap-1.5">
                <span className={`inline-block h-2 w-2 rounded-full ${
                  tracking.status === "ready" && tracking.tip ? "bg-emerald-400" :
                  tracking.status === "ready" ? "bg-amber-400" :
                  tracking.status === "loading" ? "bg-sky-400 animate-pulse" :
                  "bg-rose-400"
                }`} />
                {tracking.status === "ready" && tracking.tip ? "Tracking" :
                 tracking.status === "ready" ? "Show hand" :
                 tracking.status === "loading" ? "Loading…" :
                 tracking.status === "no-camera" ? "No camera (mouse OK)" :
                 tracking.status === "error" ? "Camera error" : "Off"}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Demo controls (bottom-left) */}
      <div className="absolute bottom-5 left-5 z-10 flex flex-wrap items-center gap-2 rounded-2xl border border-white/15 bg-black/50 px-3 py-2 backdrop-blur">
        <button onClick={() => { playClick(); setRunning((v) => !v); }} className="rounded-lg bg-white/10 px-3 py-1.5 text-sm hover:bg-white/20">
          {running ? "Pause" : "Resume"}
        </button>
        <button onClick={() => { playClick(); restart(); }} className="rounded-lg bg-white/10 px-3 py-1.5 text-sm hover:bg-white/20">Restart</button>
        <label className="flex items-center gap-2 px-2 text-sm text-white/80">
          <input type="checkbox" checked={showPreview} onChange={(e) => setShowPreview(e.target.checked)} /> Preview
        </label>
        <label className="flex items-center gap-2 px-2 text-sm text-white/80">
          <input type="checkbox" checked={tracking.enabled} onChange={(e) => tracking.setEnabled(e.target.checked)} /> Webcam
        </label>
        <button
          onClick={() => { playClick(); setShowSettings((v) => !v); }}
          className="rounded-lg bg-white/10 px-3 py-1.5 text-sm hover:bg-white/20"
          aria-expanded={showSettings}
        >
          ⚙ Audio
        </button>
      </div>

      {/* Audio settings panel */}
      {showSettings && (
        <div className="absolute bottom-24 left-5 z-20">
          <AudioSettingsPanel onClose={() => setShowSettings(false)} />
        </div>
      )}

      {/* Camera permission overlay */}
      {tracking.status === "loading" && (
        <div className="pointer-events-none absolute inset-x-0 bottom-24 z-10 mx-auto w-fit rounded-full border border-white/15 bg-black/60 px-4 py-2 text-sm text-white/80 backdrop-blur">
          Loading hand tracking model…
        </div>
      )}
      {tracking.status === "no-camera" && (
        <div className="pointer-events-none absolute inset-x-0 bottom-24 z-10 mx-auto w-fit rounded-full border border-amber-300/30 bg-amber-500/10 px-4 py-2 text-sm text-amber-100 backdrop-blur">
          Camera unavailable — using mouse as your blade. Move the cursor across fruit to slice.
        </div>
      )}

      {/* Game Over */}
      {gameOver && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/70 backdrop-blur">
          <div className="w-[min(420px,92vw)] rounded-3xl border border-white/15 bg-gradient-to-b from-white/10 to-white/5 p-8 text-center shadow-2xl">
            <h2 className="bg-gradient-to-r from-fuchsia-300 to-amber-200 bg-clip-text text-4xl font-black text-transparent">Game Over</h2>
            <dl className="mt-6 grid grid-cols-2 gap-4 text-left">
              <div><dt className="text-xs uppercase tracking-widest text-white/50">Final Score</dt><dd className="text-2xl font-bold">{score}</dd></div>
              <div><dt className="text-xs uppercase tracking-widest text-white/50">High Score</dt><dd className="text-2xl font-bold">{Math.max(highScore, score)}</dd></div>
              <div><dt className="text-xs uppercase tracking-widest text-white/50">Fruits Sliced</dt><dd className="text-2xl font-bold">{sliced}</dd></div>
              <div><dt className="text-xs uppercase tracking-widest text-white/50">Accuracy</dt><dd className="text-2xl font-bold">{accuracy}%</dd></div>
              <div><dt className="text-xs uppercase tracking-widest text-white/50">Best Combo</dt><dd className="text-2xl font-bold">{bestCombo}×</dd></div>
            </dl>
            <div className="mt-7 flex justify-center gap-2">
              <button onClick={() => { playClick(); restart(); }} className="rounded-xl bg-gradient-to-r from-fuchsia-500 to-amber-400 px-5 py-2.5 font-semibold text-black hover:scale-[1.02]">Play again</button>
              <a href="/" onClick={() => playBack()} className="rounded-xl border border-white/20 bg-white/5 px-5 py-2.5 font-semibold hover:bg-white/10">Menu</a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}