import { useCallback, useEffect, useRef, useState } from "react";
import type React from "react";
import { Loader2, Pause, Play, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";

type Chunk = { charStart: number; charEnd: number; byteLen: number };
/** Chunk after we've assigned time bounds based on byte ratios. */
type TimedChunk = Chunk & { tStart: number; tEnd: number };

type Props = {
  text: string;
  onActiveOffset: (offset: number | null) => void;
  onPlayStateChange?: (playing: boolean) => void;
  /** Called immediately when the user clicks play/pause, before audio starts. */
  onPlayIntent?: (intendToPlay: boolean) => void;
  /**
   * When false, the player loads TTS audio in the background but holds
   * off calling audio.play() until this becomes true.
   */
  canPlay?: boolean;
  /**
   * Ref populated by AudioPlayer with a function that seeks to the given
   * character offset in the audio timeline. Callers (e.g. Notepad) can use
   * this for double-click-to-seek without lifting all audio state up.
   */
  seekRef?: React.MutableRefObject<((charOffset: number) => void) | null>;
};

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;
const MOBILE_SPEEDS = [0.75, 1, 1.25] as const;

// Google Translate TTS pads each MP3 chunk with leading/trailing silence.
// These constants are shared between the forward (time→offset) and inverse
// (offset→time) mapping so both directions stay in sync.
const CHUNK_LEAD_SILENCE = 0.04;
const CHUNK_TAIL_SILENCE = 0.18;

export function AudioPlayer({ text, onActiveOffset, onPlayStateChange, onPlayIntent, canPlay = true, seekRef }: Props) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastEmittedRef = useRef<number | null>(null);
  const loadedForTextRef = useRef<string | null>(null);
  const textLenRef = useRef<number>(text.length);
  const chunksRef = useRef<Chunk[] | null>(null);
  const timedChunksRef = useRef<TimedChunk[] | null>(null);

  // wantsPlay: user clicked play but we're waiting for canPlay (subtitles not ready yet)
  const [wantsPlay, setWantsPlay] = useState(false);
  const wantsPlayRef = useRef(false);
  const canPlayRef = useRef(canPlay);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<number>(1);
  const speedRef = useRef(1);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);

  useEffect(() => {
    textLenRef.current = text.length;
  }, [text]);

  // Keep canPlayRef current so async callbacks read the latest value
  useEffect(() => {
    canPlayRef.current = canPlay;
  }, [canPlay]);

  /** Compute per-chunk time bounds using byte ratios (Google TTS is CBR MP3). */
  const computeTimedChunks = useCallback((dur: number) => {
    const chunks = chunksRef.current;
    if (!chunks || chunks.length === 0 || !dur || !Number.isFinite(dur)) {
      timedChunksRef.current = null;
      return;
    }
    const totalBytes = chunks.reduce((acc, c) => acc + c.byteLen, 0);
    if (totalBytes === 0) {
      timedChunksRef.current = null;
      return;
    }
    const out: TimedChunk[] = [];
    let cumBytes = 0;
    for (const c of chunks) {
      const tStart = (cumBytes / totalBytes) * dur;
      cumBytes += c.byteLen;
      const tEnd = (cumBytes / totalBytes) * dur;
      out.push({ ...c, tStart, tEnd });
    }
    timedChunksRef.current = out;
  }, []);

  // Keep speedRef current for use in the canPlay auto-start effect
  useEffect(() => {
    speedRef.current = speed;
  }, [speed]);

  // When canPlay transitions to true and the user already clicked play, auto-start
  useEffect(() => {
    if (!canPlay || !wantsPlay) return;
    const audio = audioRef.current;
    if (!audio || (!audio.paused && !audio.ended)) return;
    wantsPlayRef.current = false;
    setWantsPlay(false);
    audio.playbackRate = speedRef.current;
    audio.play().then(() => {
      if (rafRef.current === null) rafRef.current = requestAnimationFrame(tick);
    }).catch(() => {});
  // tick is stable (useCallback with stable deps); canPlay + wantsPlay are the real triggers
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canPlay, wantsPlay]);

  const reset = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = "";
    }
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
    audioRef.current = null;
    loadedForTextRef.current = null;
    lastEmittedRef.current = null;
    chunksRef.current = null;
    timedChunksRef.current = null;
    wantsPlayRef.current = false;
    setWantsPlay(false);
    setPlaying(false);
    onPlayStateChange?.(false);
    setDuration(0);
    setCurrentTime(0);
    onActiveOffset(null);
  }, [onActiveOffset, onPlayStateChange]);

  useEffect(() => {
    reset();
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  useEffect(() => {
    return () => reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const offsetForTime = (t: number, dur: number): number | null => {
    const len = textLenRef.current;
    if (!len || !dur) return null;

    const timed = timedChunksRef.current;
    if (timed && timed.length > 0) {
      let lo = 0;
      let hi = timed.length - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (timed[mid]!.tEnd <= t) lo = mid + 1;
        else hi = mid;
      }
      const chunk = timed[lo]!;
      const charLen = chunk.charEnd - chunk.charStart;

      const fullSpan = chunk.tEnd - chunk.tStart;
      const lead = Math.min(CHUNK_LEAD_SILENCE, fullSpan * 0.1);
      const tail = Math.min(CHUNK_TAIL_SILENCE, fullSpan * 0.25);
      const effStart = chunk.tStart + lead;
      const effEnd = Math.max(effStart + 0.05, chunk.tEnd - tail);
      const effSpan = Math.max(1e-3, effEnd - effStart);

      const tInSpeech = t - effStart;
      let progress: number;
      if (tInSpeech <= 0) progress = 0;
      else if (tInSpeech >= effSpan) progress = 1;
      else progress = tInSpeech / effSpan;

      // Bias the highlight forward by ~half a character so it sits mid-pronunciation
      // rather than at the very start of each character's window.
      const raw = progress * charLen + 0.4;
      const idx = chunk.charStart + Math.min(charLen - 1, Math.max(0, Math.floor(raw)));
      return Math.min(len - 1, Math.max(0, idx));
    }

    // Fallback: whole-text linear interpolation
    const progress = Math.min(1, Math.max(0, t / dur));
    const idx = Math.floor(progress * len);
    return Math.min(len - 1, idx);
  };

  /** Inverse of offsetForTime: maps a character offset back to a playback time. */
  const timeForOffset = (charOffset: number, dur: number): number | null => {
    const timed = timedChunksRef.current;
    if (!timed || !timed.length || !dur) return null;

    const chunk =
      timed.find(c => charOffset >= c.charStart && charOffset < c.charEnd) ??
      timed[timed.length - 1]!;

    const charLen = chunk.charEnd - chunk.charStart;
    const progress =
      charLen > 0
        ? Math.max(0, Math.min(1, (charOffset - chunk.charStart) / charLen))
        : 0;

    const fullSpan = chunk.tEnd - chunk.tStart;
    const lead = Math.min(CHUNK_LEAD_SILENCE, fullSpan * 0.1);
    const tail = Math.min(CHUNK_TAIL_SILENCE, fullSpan * 0.25);
    const effStart = chunk.tStart + lead;
    const effEnd = Math.max(effStart + 0.05, chunk.tEnd - tail);
    const effSpan = Math.max(1e-3, effEnd - effStart);

    return effStart + progress * effSpan;
  };

  const seekToChar = useCallback(
    (charOffset: number) => {
      const audio = audioRef.current;
      if (!audio) return;
      const dur = audio.duration || duration;
      if (!dur) return;

      const t = timeForOffset(charOffset, dur);
      if (t === null) return;

      audio.currentTime = t;
      setCurrentTime(t);

      const offset = offsetForTime(t, dur);
      if (offset !== null && offset !== lastEmittedRef.current) {
        lastEmittedRef.current = offset;
        onActiveOffset(offset);
      }

      // Resume playback if paused so the seek feels immediate
      if (audio.paused && !audio.ended) {
        audio.play().then(() => {
          if (rafRef.current === null) rafRef.current = requestAnimationFrame(tick);
        }).catch(() => {});
      }
    },
    // tick and offsetForTime/timeForOffset are stable within this render;
    // duration + onActiveOffset are the real reactive deps
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [duration, onActiveOffset],
  );

  // Expose seekToChar via ref so Notepad can call it on double-click
  useEffect(() => {
    if (seekRef) seekRef.current = seekToChar;
    return () => { if (seekRef) seekRef.current = null; };
  }, [seekRef, seekToChar]);

  const tick = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const t = audio.currentTime;
    const dur = audio.duration || 0;
    setCurrentTime(t);
    const offset = offsetForTime(t, dur);
    if (offset !== lastEmittedRef.current) {
      lastEmittedRef.current = offset;
      onActiveOffset(offset);
    }
    if (!audio.paused && !audio.ended) {
      rafRef.current = requestAnimationFrame(tick);
    } else {
      rafRef.current = null;
    }
  }, [onActiveOffset]);

  const ensureLoaded = useCallback(async (): Promise<HTMLAudioElement | null> => {
    if (audioRef.current && loadedForTextRef.current === text) return audioRef.current;

    const trimmed = text.trim();
    if (trimmed.length === 0) {
      setError("Nothing to read");
      return null;
    }

    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/tts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) {
        const errText = await res.text();
        throw new Error(errText || `TTS failed (${res.status})`);
      }
      const json = (await res.json()) as { audioBase64: string; chunks?: Chunk[] };
      chunksRef.current = json.chunks ?? null;
      timedChunksRef.current = null;

      const blob = base64ToBlob(json.audioBase64, "audio/mpeg");
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.playbackRate = speed;

      audio.addEventListener("loadedmetadata", () => {
        const dur = audio.duration || 0;
        setDuration(dur);
        computeTimedChunks(dur);
      });
      audio.addEventListener("durationchange", () => {
        if (Number.isFinite(audio.duration)) {
          setDuration(audio.duration);
          computeTimedChunks(audio.duration);
        }
      });
      audio.addEventListener("ended", () => {
        setPlaying(false);
        onPlayStateChange?.(false);
        if (rafRef.current !== null) {
          cancelAnimationFrame(rafRef.current);
          rafRef.current = null;
        }
      });
      audio.addEventListener("pause", () => {
        setPlaying(false);
        onPlayStateChange?.(false);
      });
      audio.addEventListener("play", () => {
        setPlaying(true);
        onPlayStateChange?.(true);
      });

      audioRef.current = audio;
      urlRef.current = url;
      loadedForTextRef.current = text;
      return audio;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      return null;
    } finally {
      setLoading(false);
    }
  }, [text, speed, onPlayStateChange, computeTimedChunks]);

  const handlePlayPause = useCallback(async () => {
    const audio = audioRef.current;
    if (audio && !audio.paused && !audio.ended) {
      // Pause
      wantsPlayRef.current = false;
      setWantsPlay(false);
      onPlayIntent?.(false);
      audio.pause();
      return;
    }

    // User intends to play — signal immediately so Notepad can start subtitle fetch
    onPlayIntent?.(true);

    const loaded = audio ?? (await ensureLoaded());
    if (!loaded) return;

    if (!canPlayRef.current) {
      // Subtitles not ready yet — park here until canPlay flips
      wantsPlayRef.current = true;
      setWantsPlay(true);
      return;
    }

    wantsPlayRef.current = false;
    setWantsPlay(false);
    if (loaded.ended) loaded.currentTime = 0;
    loaded.playbackRate = speed;
    await loaded.play();
    if (rafRef.current === null) rafRef.current = requestAnimationFrame(tick);
  }, [ensureLoaded, onPlayIntent, speed, tick]);

  const handleRestart = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = 0;
    setCurrentTime(0);
    onActiveOffset(null);
    lastEmittedRef.current = null;
  }, [onActiveOffset]);

  const handleSpeedChange = useCallback((next: number) => {
    setSpeed(next);
    if (audioRef.current) audioRef.current.playbackRate = next;
  }, []);

  const handleSeek = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const audio = audioRef.current;
      if (!audio || !duration) return;
      const next = (Number(e.target.value) / 1000) * duration;
      audio.currentTime = next;
      setCurrentTime(next);
      const offset = offsetForTime(next, duration);
      if (offset !== lastEmittedRef.current) {
        lastEmittedRef.current = offset;
        onActiveOffset(offset);
      }
    },
    [duration, onActiveOffset],
  );

  const progress = duration > 0 ? Math.min(1, currentTime / duration) : 0;
  const hasAudio = audioRef.current !== null;

  return (
    <div className="border-t border-border bg-background/95 backdrop-blur-sm">
      {/* ── Desktop layout: single row ── */}
      <div className="hidden sm:flex px-6 py-3 items-center gap-4">
        <button
          type="button"
          onClick={handlePlayPause}
          disabled={loading || text.trim().length === 0}
          aria-label={playing ? "Pause" : "Play"}
          className={cn(
            "inline-flex items-center justify-center h-10 w-10 rounded-full shrink-0",
            "bg-[var(--red-ink)] text-white shadow-sm",
            "hover:brightness-110 active:brightness-95 transition-all",
            "disabled:opacity-50 disabled:cursor-not-allowed",
          )}
        >
          {loading || wantsPlay ? <Loader2 className="h-4 w-4 animate-spin" /> : playing ? <Pause className="h-4 w-4" fill="currentColor" /> : <Play className="h-4 w-4 ml-0.5" fill="currentColor" />}
        </button>

        <button
          type="button"
          onClick={handleRestart}
          disabled={!hasAudio}
          aria-label="Restart"
          title="Restart"
          className="inline-flex items-center justify-center h-9 w-9 rounded-full shrink-0 text-muted-foreground hover:text-[var(--red-ink)] hover:bg-[var(--red-wash)] transition-colors disabled:opacity-40"
        >
          <RotateCcw className="h-4 w-4" />
        </button>

        <div className="flex items-center gap-3 flex-1 min-w-0">
          <span className="text-xs tabular-nums text-muted-foreground w-10 text-right">{formatTime(currentTime)}</span>
          <input
            type="range" min={0} max={1000}
            value={Math.round(progress * 1000)}
            onChange={handleSeek}
            disabled={!hasAudio || duration === 0}
            aria-label="Seek"
            className="flex-1 accent-[var(--red-ink)] cursor-pointer disabled:cursor-not-allowed"
          />
          <span className="text-xs tabular-nums text-muted-foreground w-10">{formatTime(duration)}</span>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <span className="text-xs text-muted-foreground">Speed</span>
          <div className="flex items-center rounded-full border border-border bg-background overflow-hidden">
            {SPEEDS.map(s => (
              <button
                key={s}
                type="button"
                onClick={() => handleSpeedChange(s)}
                className={cn(
                  "px-2 py-1 text-xs tabular-nums transition-colors",
                  speed === s ? "bg-[var(--red-ink)] text-white" : "text-muted-foreground hover:text-foreground hover:bg-secondary/50",
                )}
              >
                {s}×
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Mobile layout: single row — play | slider | speeds ── */}
      <div className="flex sm:hidden items-center gap-2 px-3 py-2">
        {/* Play button */}
        <button
          type="button"
          onClick={handlePlayPause}
          disabled={loading || text.trim().length === 0}
          aria-label={playing ? "Pause" : "Play"}
          className={cn(
            "shrink-0 inline-flex items-center justify-center h-9 w-9 rounded-full",
            "bg-[var(--red-ink)] text-white shadow-sm",
            "hover:brightness-110 active:brightness-95 transition-all",
            "disabled:opacity-50 disabled:cursor-not-allowed",
          )}
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : playing ? <Pause className="h-3.5 w-3.5" fill="currentColor" /> : <Play className="h-3.5 w-3.5 ml-0.5" fill="currentColor" />}
        </button>

        {/* Seek slider with timestamps */}
        <div className="flex items-center gap-1.5 flex-1 min-w-0">
          <span className="text-[10px] tabular-nums text-muted-foreground shrink-0">{formatTime(currentTime)}</span>
          <input
            type="range" min={0} max={1000}
            value={Math.round(progress * 1000)}
            onChange={handleSeek}
            disabled={!hasAudio || duration === 0}
            aria-label="Seek"
            className="flex-1 min-w-0 accent-[var(--red-ink)] cursor-pointer disabled:cursor-not-allowed"
          />
          <span className="text-[10px] tabular-nums text-muted-foreground shrink-0">{formatTime(duration)}</span>
        </div>

        {/* Speed squares */}
        <div className="shrink-0 flex items-center">
          {MOBILE_SPEEDS.map(s => (
            <button
              key={s}
              type="button"
              onClick={() => handleSpeedChange(s)}
              aria-label={`${s}x speed`}
              className={cn(
                "h-6 w-7 inline-flex items-center justify-center text-[10px] tabular-nums transition-colors",
                "border border-border -ml-px first:ml-0 first:rounded-l-sm last:rounded-r-sm",
                speed === s
                  ? "relative z-10 bg-[var(--red-ink)] text-white border-[var(--red-ink)]"
                  : "bg-background text-muted-foreground hover:text-foreground hover:bg-secondary/50",
              )}
            >
              {s}
            </button>
          ))}
        </div>
      </div>
      {error && (
        <div className="px-6 pb-2 -mt-1 text-xs text-destructive">
          {error}
        </div>
      )}
    </div>
  );
}

function formatTime(s: number): string {
  if (!Number.isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

function base64ToBlob(base64: string, mime: string): Blob {
  const bin = atob(base64);
  const len = bin.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}
