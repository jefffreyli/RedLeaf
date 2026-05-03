import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { tokenize, getContextAround } from "@/lib/tokenize";
import { AudioPlayer } from "./AudioPlayer";
import { SubtitleBar, type SubtitleItem } from "./SubtitleBar";
import { capture } from "@/lib/analytics";

const CJK_RE = /\p{Script=Han}/u;

type Props = {
  content: string;
  onContentChange: (next: string) => void;
  /** Called when mouse hovers a span (not pinned). Pass null to clear. */
  onHoverChar: (char: string | null, context?: string) => void;
  /** Called when the user highlights text in the textarea. Pass null to unpin. */
  onSelectChar: (char: string | null, context?: string) => void;
  /** Called with the currently highlighted char during audio playback (from cache only). */
  onAudioChar: (char: string | null) => void;
};

export function Notepad({ content, onContentChange, onHoverChar, onSelectChar, onAudioChar }: Props) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [activeAlignIdx, setActiveAlignIdx] = useState<number | null>(null);
  const [hoveredOffset, setHoveredOffset] = useState<number | null>(null);
  const readPaneRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const lastAudioCharRef = useRef<string | null>(null);
  // true while a pointer (mouse or touch) that started inside the textarea is still held down
  const pointerInTextareaRef = useRef(false);
  const pointerTimerRef = useRef<number | null>(null);
  const selTimerRef = useRef<number | null>(null);

  // Subtitle state
  const [subtitles, setSubtitles] = useState<SubtitleItem[] | null>(null);
  const [subtitlesLoading, setSubtitlesLoading] = useState(false);
  const subtitleLoadedForRef = useRef<string | null>(null);
  const subtitleAbortRef = useRef<AbortController | null>(null);

  const tokens = useMemo(() => tokenize(content), [content]);

  // Reset subtitles when content changes
  useEffect(() => {
    setSubtitles(null);
    setSubtitlesLoading(false);
    subtitleLoadedForRef.current = null;
    if (subtitleAbortRef.current) {
      subtitleAbortRef.current.abort();
      subtitleAbortRef.current = null;
    }
  }, [content]);

  // Fetch subtitles once when playback starts (lazy, one fetch per unique text)
  useEffect(() => {
    if (!isPlaying) return;
    if (!content.trim()) return;
    if (subtitleLoadedForRef.current === content) return;

    subtitleLoadedForRef.current = content;
    const ctrl = new AbortController();
    subtitleAbortRef.current = ctrl;
    setSubtitlesLoading(true);

    fetch("/api/subtitles", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: content }),
      signal: ctrl.signal,
    })
      .then(r => r.json())
      .then((data: { items: SubtitleItem[] }) => {
        if (Array.isArray(data.items)) setSubtitles(data.items);
        setSubtitlesLoading(false);
      })
      .catch(err => {
        if ((err as Error).name !== "AbortError") {
          console.error("subtitle fetch failed:", err);
        }
        setSubtitlesLoading(false);
      });

    return () => {
      ctrl.abort();
    };
  }, [isPlaying, content]);

  // Clear hover state when switching away from span view
  useEffect(() => {
    if (!isPlaying) {
      setHoveredOffset(null);
      onHoverChar(null);
    }
  }, [isPlaying, onHoverChar]);

  // Map alignment index → source character → notify parent
  useEffect(() => {
    if (activeAlignIdx === null) {
      if (lastAudioCharRef.current !== null) {
        lastAudioCharRef.current = null;
        onAudioChar(null);
      }
      return;
    }
    const char = content[activeAlignIdx] ?? null;
    if (char && CJK_RE.test(char) && char !== lastAudioCharRef.current) {
      lastAudioCharRef.current = char;
      onAudioChar(char);
    }
  }, [activeAlignIdx, content, onAudioChar]);

  // E-reader scroll: keep active span in view
  useEffect(() => {
    if (activeAlignIdx === null || !readPaneRef.current) return;
    const el = readPaneRef.current.querySelector<HTMLElement>(`[data-offset="${activeAlignIdx}"]`);
    if (!el) return;
    const pane = readPaneRef.current;
    const elRect = el.getBoundingClientRect();
    const paneRect = pane.getBoundingClientRect();
    const top = elRect.top - paneRect.top;
    const bottom = elRect.bottom - paneRect.top;
    if (top < paneRect.height * 0.2 || bottom > paneRect.height * 0.8) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [activeAlignIdx]);

  // Hover in span view
  const handleSpanMouseMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const span = (e.target as HTMLElement).closest<HTMLElement>(".read-char");
      if (!span) {
        if (hoveredOffset !== null) {
          setHoveredOffset(null);
          onHoverChar(null);
        }
        return;
      }
      const offsetAttr = span.getAttribute("data-offset");
      const offset = offsetAttr === null ? null : Number(offsetAttr);
      if (offset === null || Number.isNaN(offset) || offset === hoveredOffset) return;
      setHoveredOffset(offset);
      onHoverChar(span.textContent ?? "", getContextAround(content, offset));
    },
    [hoveredOffset, content, onHoverChar],
  );

  const handleSpanMouseLeave = useCallback(() => {
    if (hoveredOffset !== null) {
      setHoveredOffset(null);
      onHoverChar(null);
    }
  }, [hoveredOffset, onHoverChar]);

  // Text highlight in textarea → pin to card (single cursor position with no selection → unpin)
  const handleTextareaInteract = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    const { selectionStart: start, selectionEnd: end } = ta;
    if (start === end) {
      onSelectChar(null);
      return;
    }
    const selected = ta.value.slice(start, end);
    if (selected.length > 0 && CJK_RE.test(selected)) {
      onSelectChar(selected, getContextAround(content, start));
    } else {
      onSelectChar(null);
    }
  }, [content, onSelectChar]);

  // Catch pointer (mouse + touch) releases anywhere on the document.
  // This is the primary pin trigger — it fires whether the user releases
  // inside or outside the textarea, covering the common case of dragging
  // a selection toward the card panel and releasing there.
  useEffect(() => {
    const onPointerUp = () => {
      if (!pointerInTextareaRef.current) return;
      pointerInTextareaRef.current = false;
      // Small delay so the browser has committed the final selection range
      // (needed for touch where the selection lags behind the pointer event).
      if (pointerTimerRef.current !== null) clearTimeout(pointerTimerRef.current);
      pointerTimerRef.current = window.setTimeout(handleTextareaInteract, 50);
    };
    document.addEventListener('pointerup', onPointerUp);
    return () => {
      document.removeEventListener('pointerup', onPointerUp);
      if (pointerTimerRef.current !== null) clearTimeout(pointerTimerRef.current);
    };
  }, [handleTextareaInteract]);

  // Backup for mobile handle-dragging: after the initial touchend, the user
  // may still be adjusting selection handles. selectionchange fires as handles
  // move; we wait for them to stop (50 ms) then pin the final range.
  // Only pins on an actual range — never unpins — so it doesn't interfere
  // with modal/tap flows where focus has moved away from the textarea.
  useEffect(() => {
    const onSelectionChange = () => {
      const ta = textareaRef.current;
      if (!ta || document.activeElement !== ta) return;
      if (selTimerRef.current !== null) clearTimeout(selTimerRef.current);
      selTimerRef.current = window.setTimeout(() => {
        const { selectionStart: s, selectionEnd: e } = ta;
        if (s === null || e === null || s === e) return;
        const selected = ta.value.slice(s, e);
        if (selected.length > 0 && CJK_RE.test(selected)) {
          onSelectChar(selected, getContextAround(content, s));
        }
      }, 50);
    };
    document.addEventListener('selectionchange', onSelectionChange);
    return () => {
      document.removeEventListener('selectionchange', onSelectionChange);
      if (selTimerRef.current !== null) clearTimeout(selTimerRef.current);
    };
  }, [content, onSelectChar]);

  // Called immediately when user clicks play/pause (before audio actually starts)
  const handlePlayIntent = useCallback((intendToPlay: boolean) => {
    setIsPlaying(intendToPlay);
    if (intendToPlay) {
      capture("audio_play", { char_count: content.trim().length });
    } else {
      setActiveAlignIdx(null);
    }
  }, [content]);

  const hasContent = content.trim().length > 0;

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden">

      <div className="flex-1 min-h-0 overflow-hidden">
        {isPlaying ? (
          <div
            ref={readPaneRef}
            onMouseMove={handleSpanMouseMove}
            onMouseLeave={handleSpanMouseLeave}
            className="w-full h-full overflow-y-auto thin-scroll p-4 sm:p-8 font-cjk text-xl sm:text-2xl leading-loose whitespace-pre-wrap text-foreground cursor-default"
          >
            {tokens.map((t, i) => {
              if (!t.isCJK) {
                return (
                  <span key={`p${i}`} className="text-foreground/90">
                    {t.text}
                  </span>
                );
              }
              const isActive = activeAlignIdx !== null && t.offset === activeAlignIdx;
              return (
                <span
                  key={`c${i}`}
                  data-offset={t.offset}
                  className={cn("read-char", isActive && "is-active")}
                >
                  {t.text}
                </span>
              );
            })}
            {!hasContent && (
              <span className="text-muted-foreground text-base">Nothing to read yet — paste some text above.</span>
            )}
          </div>
        ) : (
          <textarea
            ref={textareaRef}
            value={content}
            onChange={e => onContentChange(e.target.value)}
            onPointerDown={() => { pointerInTextareaRef.current = true; }}
            onKeyUp={handleTextareaInteract}
            placeholder={"把中文字粘贴到这里…"}
            spellCheck={false}
            className={cn(
              "w-full h-full block resize-none p-4 sm:p-8 bg-transparent outline-none border-0",
              "font-cjk text-xl sm:text-2xl leading-loose text-foreground placeholder:text-muted-foreground/50",
              "thin-scroll",
            )}
          />
        )}
      </div>

      <SubtitleBar
        subtitles={subtitles}
        activeOffset={activeAlignIdx}
        visible={isPlaying}
        loading={subtitlesLoading}
      />

      <AudioPlayer
        text={content}
        onActiveOffset={setActiveAlignIdx}
        onPlayIntent={handlePlayIntent}
        canPlay={!subtitlesLoading}
        onPlayStateChange={playing => {
          if (!playing) {
            setIsPlaying(false);
            setActiveAlignIdx(null);
          }
        }}
      />
    </div>
  );
}
