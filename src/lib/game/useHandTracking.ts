import { useEffect, useRef, useState } from "react";
import {
  FilesetResolver,
  HandLandmarker,
  type HandLandmarkerResult,
} from "@mediapipe/tasks-vision";

export type TipPoint = { x: number; y: number } | null;

export interface HandTrackingState {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  /** Normalized [0..1] coordinates of the index fingertip (mirrored), or null. */
  tip: TipPoint;
  /** Full 21 landmarks for the most prominent hand (already mirrored on x). */
  landmarks: { x: number; y: number }[] | null;
  status: "idle" | "loading" | "ready" | "no-camera" | "error";
  errorMessage: string | null;
  enabled: boolean;
  setEnabled: (v: boolean) => void;
}

/**
 * Loads MediaPipe Hands, requests the webcam, and exposes the mirrored
 * index-fingertip position in normalized [0..1] coords. Falls back gracefully
 * if the camera is unavailable.
 */
export function useHandTracking(enabledInitial = true): HandTrackingState {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const landmarkerRef = useRef<HandLandmarker | null>(null);
  const rafRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [enabled, setEnabled] = useState(enabledInitial);
  const [status, setStatus] = useState<HandTrackingState["status"]>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [tip, setTip] = useState<TipPoint>(null);
  const [landmarks, setLandmarks] = useState<{ x: number; y: number }[] | null>(null);

  // Smoothing state: ring buffer for position history and velocity-based prediction.
  const HISTORY_SIZE = 6;
  const historyRef = useRef<{ x: number; y: number; t: number }[]>([]);
  const smoothRef = useRef<{ x: number; y: number } | null>(null);
  const lastVelRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  useEffect(() => {
    if (!enabled) {
      cleanup();
      setStatus("idle");
      setTip(null);
      setLandmarks(null);
      return;
    }

    let cancelled = false;
    setStatus("loading");
    setErrorMessage(null);

    (async () => {
      try {
        const vision = await FilesetResolver.forVisionTasks(
          "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm",
        );
        const landmarker = await HandLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath:
              "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
            delegate: "GPU",
          },
          runningMode: "VIDEO",
          numHands: 1,
          minHandDetectionConfidence: 0.65,
          minHandPresenceConfidence: 0.65,
          minTrackingConfidence: 0.65,
        });
        if (cancelled) {
          landmarker.close();
          return;
        }
        landmarkerRef.current = landmarker;

        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 640, height: 480, facingMode: "user" },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;

        const video = videoRef.current;
        if (!video) throw new Error("Video element missing");
        video.srcObject = stream;
        video.muted = true;
        video.playsInline = true;
        await video.play();

        setStatus("ready");
        loop();
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        const isPermission =
          /denied|permission|notallowed|notfound|not found|notreadable/i.test(message);
        setStatus(isPermission ? "no-camera" : "error");
        setErrorMessage(message);
      }
    })();

    function loop() {
      const video = videoRef.current;
      const landmarker = landmarkerRef.current;
      if (!video || !landmarker) return;
      if (video.readyState >= 2) {
        const ts = performance.now();
        let result: HandLandmarkerResult | null = null;
        try {
          result = landmarker.detectForVideo(video, ts);
        } catch {
          // ignore intermittent decode errors
        }
        if (result && result.landmarks && result.landmarks.length > 0) {
          const hand = result.landmarks[0];
          // 8 = index fingertip
          const raw = hand[8];
          // Mirror x because we display the webcam mirrored.
          const mirroredHand = hand.map((p) => ({ x: 1 - p.x, y: p.y }));
          setLandmarks(mirroredHand);

          const mirrored = { x: 1 - raw.x, y: raw.y };
          const now = performance.now();

          // ---- History-based smoothing with prediction ----
          const hist = historyRef.current;
          hist.push({ x: mirrored.x, y: mirrored.y, t: now });
          while (hist.length > HISTORY_SIZE) hist.shift();

          // Estimate velocity from last few frames (ms-normalized).
          let vx = 0, vy = 0;
          if (hist.length >= 3) {
            const a = hist[0];
            const b = hist[hist.length - 1];
            const dt = Math.max(1, b.t - a.t);
            vx = (b.x - a.x) / dt;
            vy = (b.y - a.y) / dt;
          }
          // Smooth velocity to avoid spikes.
          const velAlpha = 0.4;
          lastVelRef.current.x = lastVelRef.current.x * (1 - velAlpha) + vx * velAlpha;
          lastVelRef.current.y = lastVelRef.current.y * (1 - velAlpha) + vy * velAlpha;

          // Predict ~25ms ahead (roughly 1.5 frames at 60fps).
          const PREDICT_MS = 25;
          const predicted = {
            x: mirrored.x + lastVelRef.current.x * PREDICT_MS,
            y: mirrored.y + lastVelRef.current.y * PREDICT_MS,
          };

          // Clamp to [0,1] after prediction.
          predicted.x = Math.max(0, Math.min(1, predicted.x));
          predicted.y = Math.max(0, Math.min(1, predicted.y));

          const prev = smoothRef.current;
          // Base smoothing: lower alpha = more stable.
          const baseAlpha = 0.30;
          // Speed-responsive alpha: faster movement → more raw input.
          const speed = Math.hypot(lastVelRef.current.x, lastVelRef.current.y);
          const dynamicAlpha = Math.min(0.75, baseAlpha + speed * 800);

          let next: { x: number; y: number };
          if (prev) {
            const dx = predicted.x - prev.x;
            const dy = predicted.y - prev.y;
            // Deadzone: ignore sub-pixel jitter (in normalized coords).
            const deadzone = 0.0025;
            const nx = Math.abs(dx) < deadzone ? prev.x : prev.x * (1 - dynamicAlpha) + predicted.x * dynamicAlpha;
            const ny = Math.abs(dy) < deadzone ? prev.y : prev.y * (1 - dynamicAlpha) + predicted.y * dynamicAlpha;
            next = { x: nx, y: ny };
          } else {
            next = predicted;
          }
          smoothRef.current = next;
          setTip(next);
        } else {
          historyRef.current = [];
          lastVelRef.current = { x: 0, y: 0 };
          smoothRef.current = null;
          setTip(null);
          setLandmarks(null);
        }
      }
      rafRef.current = requestAnimationFrame(loop);
    }

    function cleanup() {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
      if (landmarkerRef.current) {
        try { landmarkerRef.current.close(); } catch { /* noop */ }
        landmarkerRef.current = null;
      }
      historyRef.current = [];
      lastVelRef.current = { x: 0, y: 0 };
      smoothRef.current = null;
    }

    return () => {
      cancelled = true;
      cleanup();
    };
  }, [enabled]);

  return { videoRef, tip, landmarks, status, errorMessage, enabled, setEnabled };
}