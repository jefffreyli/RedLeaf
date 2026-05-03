import { useEffect, useRef, useState } from "react";
import { Check, Loader2, Plus, Volume2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { VocabEntry } from "./VocabBank";

export type LookupData = {
  pinyin: string;
  pos: string;
  translation: string;
  example_zh: string;
  example_en: string;
};

type Props = {
  character: string | null;
  loading: boolean;
  data: LookupData | null;
  error: string | null;
  onAddToVocab: (entry: VocabEntry) => void;
  vocabZhSet: Set<string>;
};

export function CharacterCard({ character, loading, data, error, onAddToVocab, vocabZhSet }: Props) {
  const [playing, setPlaying] = useState<"char" | "example" | null>(null);
  const [addedFlash, setAddedFlash] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const flashTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      if (flashTimerRef.current !== null) window.clearTimeout(flashTimerRef.current);
    };
  }, []);

  // Reset the flash whenever the displayed character changes
  useEffect(() => {
    setAddedFlash(false);
    if (flashTimerRef.current !== null) {
      window.clearTimeout(flashTimerRef.current);
      flashTimerRef.current = null;
    }
  }, [character]);

  const handleAdd = () => {
    if (!character || !data) return;
    if (vocabZhSet.has(character)) return;
    onAddToVocab({
      zh: character,
      pinyin: data.pinyin,
      pos: data.pos,
      translation: data.translation,
    });
    setAddedFlash(true);
    if (flashTimerRef.current !== null) window.clearTimeout(flashTimerRef.current);
    flashTimerRef.current = window.setTimeout(() => {
      setAddedFlash(false);
      flashTimerRef.current = null;
    }, 1500);
  };

  const alreadyInBank = character ? vocabZhSet.has(character) : false;

  const playSnippet = async (text: string, kind: "char" | "example") => {
    try {
      setPlaying(kind);
      const res = await fetch("/api/tts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) throw new Error(await res.text());
      const json = (await res.json()) as { audioBase64: string };
      const blob = base64ToBlob(json.audioBase64, "audio/mpeg");
      const url = URL.createObjectURL(blob);
      if (audioRef.current) audioRef.current.pause();
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onended = () => {
        setPlaying(null);
        URL.revokeObjectURL(url);
      };
      await audio.play();
    } catch (err) {
      console.error("snippet TTS failed", err);
      setPlaying(null);
    }
  };

  if (!character) {
    return (
      <aside className="h-full p-5 text-xs text-muted-foreground flex flex-col">
        <div className="border border-dashed border-border rounded-lg p-5 flex-1 flex flex-col items-center justify-center text-center gap-2.5">
          <div className="text-2xl font-cjk text-[var(--red-ink)]/60">字</div>
          <p className="leading-relaxed max-w-[200px] text-xs">
            Click any Chinese character to see its pinyin, meaning, and an example sentence.
          </p>
        </div>
      </aside>
    );
  }

  return (
    <aside
      className="h-full grid grid-rows-[auto_minmax(0,1fr)] overflow-hidden card-slide-in"
      key={character}
    >
      <header className="px-5 pt-4 pb-3 border-b border-border">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="font-cjk-serif text-3xl leading-tight text-foreground break-words">{character}</div>
            {loading ? (
              <div className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" /> Looking up…
              </div>
            ) : data ? (
              <div className="mt-1.5 pinyin text-sm text-[var(--red-ink)] font-medium leading-snug">
                {data.pinyin}
              </div>
            ) : null}
          </div>
          <button
            type="button"
            onClick={() => character && playSnippet(character, "char")}
            disabled={playing === "char"}
            aria-label="Play character"
            className={cn(
              "shrink-0 inline-flex items-center justify-center h-7 w-7 rounded-full border border-border text-[var(--red-ink)] transition-colors",
              "hover:bg-[var(--red-wash)] disabled:opacity-50",
            )}
          >
            {playing === "char" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Volume2 className="h-3 w-3" />}
          </button>
        </div>
      </header>

      <div className="overflow-y-auto thin-scroll px-5 py-4 space-y-4">
        {error && !loading && (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 px-2.5 py-1.5 text-[11px] text-destructive">
            {error}
          </div>
        )}

        {data && (
          <>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="inline-flex items-center rounded-full border border-[var(--red-soft)] bg-[var(--red-wash)] px-2 py-0.5 text-[10px] font-medium text-[var(--red-ink)]">
                {data.pos}
              </span>
            </div>

            <section>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Translation</div>
              <div className="text-xs text-foreground leading-snug">{data.translation}</div>
            </section>

            <section className="border-t border-border pt-3">
              <div className="flex items-center justify-between mb-1.5">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Example</div>
                <button
                  type="button"
                  onClick={() => playSnippet(data.example_zh, "example")}
                  disabled={playing === "example"}
                  aria-label="Play example"
                  className="inline-flex items-center gap-1 text-[11px] text-[var(--red-ink)] hover:underline disabled:opacity-50"
                >
                  {playing === "example" ? (
                    <Loader2 className="h-2.5 w-2.5 animate-spin" />
                  ) : (
                    <Volume2 className="h-2.5 w-2.5" />
                  )}
                  Listen
                </button>
              </div>
              <div className="font-cjk text-sm text-foreground leading-relaxed">{data.example_zh}</div>
              <div className="text-[11px] text-muted-foreground mt-1 leading-relaxed">{data.example_en}</div>
            </section>

            <section className="pt-1">
              <button
                type="button"
                onClick={handleAdd}
                disabled={alreadyInBank || addedFlash}
                className={cn(
                  "w-full inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md",
                  "text-[11px] font-medium tracking-wide",
                  "border border-dashed border-[var(--red-soft)] text-[var(--red-ink)] bg-transparent",
                  "hover:bg-[var(--red-wash)]",
                  "disabled:opacity-70 disabled:cursor-not-allowed disabled:hover:bg-transparent",
                  addedFlash && "border-solid bg-[var(--red-wash)]",
                )}
              >
                {addedFlash ? (
                  <>
                    <Check className="h-3 w-3" /> Added to vocab
                  </>
                ) : alreadyInBank ? (
                  <>
                    <Check className="h-3 w-3" /> Already in vocab
                  </>
                ) : (
                  <>
                    <Plus className="h-3 w-3" /> Add to vocab
                  </>
                )}
              </button>
            </section>
          </>
        )}
      </div>
    </aside>
  );
}

function base64ToBlob(base64: string, mime: string): Blob {
  const bin = atob(base64);
  const len = bin.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}
