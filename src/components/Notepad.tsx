import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type React from "react";
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
    /** Optional max characters allowed in the textarea. */
    maxLength?: number;
};

export function Notepad({
    content,
    onContentChange,
    onHoverChar,
    onSelectChar,
    onAudioChar,
    maxLength,
}: Props) {
    const [isPlaying, setIsPlaying] = useState(false);
    // true once the user has ever clicked play for the current content;
    // keeps the span view visible even while paused.
    const [audioStarted, setAudioStarted] = useState(false);
    const [activeAlignIdx, setActiveAlignIdx] = useState<number | null>(null);
    const [hoveredOffset, setHoveredOffset] = useState<number | null>(null);
    const readPaneRef = useRef<HTMLDivElement | null>(null);
    const textareaRef = useRef<HTMLTextAreaElement | null>(null);
    const lastAudioCharRef = useRef<string | null>(null);
    // true while a pointer (mouse or touch) that started inside the textarea is still held down
    const pointerInTextareaRef = useRef(false);
    const pointerTimerRef = useRef<number | null>(null);
    const selTimerRef = useRef<number | null>(null);
    const seekRef = useRef<((charOffset: number) => void) | null>(null);

    // Subtitle state
    const [subtitles, setSubtitles] = useState<SubtitleItem[] | null>(null);
    const [subtitlesLoading, setSubtitlesLoading] = useState(false);
    const subtitleLoadedForRef = useRef<string | null>(null);
    const subtitleAbortRef = useRef<AbortController | null>(null);

    const tokens = useMemo(() => tokenize(content), [content]);

    // Reset audio + subtitle state when content changes
    useEffect(() => {
        setAudioStarted(false);
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
            .then((r) => r.json())
            .then((data: { items: SubtitleItem[] }) => {
                if (Array.isArray(data.items)) setSubtitles(data.items);
                setSubtitlesLoading(false);
            })
            .catch((err) => {
                if ((err as Error).name !== "AbortError") {
                    console.error("subtitle fetch failed:", err);
                }
                setSubtitlesLoading(false);
            });

        return () => {
            ctrl.abort();
        };
    }, [isPlaying, content]);

    // Clear hover state when leaving the span view entirely
    useEffect(() => {
        if (!audioStarted) {
            setHoveredOffset(null);
            onHoverChar(null);
        }
    }, [audioStarted, onHoverChar]);

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
        const el = readPaneRef.current.querySelector<HTMLElement>(
            `[data-offset="${activeAlignIdx}"]`,
        );
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
            const span = (e.target as HTMLElement).closest<HTMLElement>(
                ".read-char",
            );
            if (!span) {
                if (hoveredOffset !== null) {
                    setHoveredOffset(null);
                    onHoverChar(null);
                }
                return;
            }
            const offsetAttr = span.getAttribute("data-offset");
            const offset = offsetAttr === null ? null : Number(offsetAttr);
            if (
                offset === null ||
                Number.isNaN(offset) ||
                offset === hoveredOffset
            )
                return;
            setHoveredOffset(offset);
            onHoverChar(
                span.textContent ?? "",
                getContextAround(content, offset),
            );
        },
        [hoveredOffset, content, onHoverChar],
    );

    const handleSpanMouseLeave = useCallback(() => {
        if (hoveredOffset !== null) {
            setHoveredOffset(null);
            onHoverChar(null);
        }
    }, [hoveredOffset, onHoverChar]);

    // Selection in span view → pin to card. Reads window.getSelection() and
    // resolves character offsets via the [data-offset] attribute on each .read-char span.
    // Falls back to clicking a single character (unpins on whitespace/punctuation).
    const handleSpanPointerUp = useCallback(() => {
        // Wait a tick so the browser commits the final selection range
        window.setTimeout(() => {
            const sel = window.getSelection();
            if (!sel || sel.rangeCount === 0) return;
            const range = sel.getRangeAt(0);
            const text = sel.toString();

            // No selection → treat as click: pin the single char under the click target
            if (!text || range.collapsed) {
                const node = range.startContainer;
                const el =
                    node.nodeType === Node.TEXT_NODE
                        ? node.parentElement
                        : (node as HTMLElement);
                const span = el?.closest<HTMLElement>(".read-char");
                if (!span) {
                    onSelectChar(null);
                    return;
                }
                const offsetAttr = span.getAttribute("data-offset");
                const offset = offsetAttr === null ? null : Number(offsetAttr);
                if (offset === null || Number.isNaN(offset)) return;
                onSelectChar(
                    span.textContent ?? "",
                    getContextAround(content, offset),
                );
                return;
            }

            if (!CJK_RE.test(text)) {
                onSelectChar(null);
                return;
            }

            // Find the start offset by walking up to the first .read-char span at/after the start
            const startEl =
                range.startContainer.nodeType === Node.TEXT_NODE
                    ? range.startContainer.parentElement
                    : (range.startContainer as HTMLElement);
            const startSpan = startEl?.closest<HTMLElement>(".read-char");
            const startOffsetAttr = startSpan?.getAttribute("data-offset");
            const startOffset = startOffsetAttr ? Number(startOffsetAttr) : 0;

            onSelectChar(text, getContextAround(content, startOffset));
        }, 30);
    }, [content, onSelectChar]);

    // Double-click on a span → seek audio to that character's position in the timeline
    const handleSpanDoubleClick = useCallback(
        (e: React.MouseEvent<HTMLDivElement>) => {
            const span = (e.target as HTMLElement).closest<HTMLElement>(".read-char");
            if (!span) return;
            const offsetAttr = span.getAttribute("data-offset");
            const charOffset = offsetAttr === null ? null : Number(offsetAttr);
            if (charOffset === null || Number.isNaN(charOffset)) return;
            seekRef.current?.(charOffset);
        },
        [],
    );

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
            if (pointerTimerRef.current !== null)
                clearTimeout(pointerTimerRef.current);
            pointerTimerRef.current = window.setTimeout(
                handleTextareaInteract,
                50,
            );
        };
        document.addEventListener("pointerup", onPointerUp);
        return () => {
            document.removeEventListener("pointerup", onPointerUp);
            if (pointerTimerRef.current !== null)
                clearTimeout(pointerTimerRef.current);
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
        document.addEventListener("selectionchange", onSelectionChange);
        return () => {
            document.removeEventListener("selectionchange", onSelectionChange);
            if (selTimerRef.current !== null) clearTimeout(selTimerRef.current);
        };
    }, [content, onSelectChar]);

    // Called immediately when user clicks play/pause (before audio actually starts)
    const handlePlayIntent = useCallback(
        (intendToPlay: boolean) => {
            setIsPlaying(intendToPlay);
            if (intendToPlay) {
                setAudioStarted(true);
                capture("audio_play", { char_count: content.trim().length });
            }
            // Do NOT clear activeAlignIdx on pause — the highlight should stay so
            // the reader can see their position and double-click to seek from there.
        },
        [content],
    );

    const hasContent = content.trim().length > 0;

    return (
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
            <div className="flex-1 min-h-0 overflow-hidden">
                {audioStarted ? (
                    <div
                        ref={readPaneRef}
                        onMouseMove={handleSpanMouseMove}
                        onMouseLeave={handleSpanMouseLeave}
                        onPointerUp={handleSpanPointerUp}
                        onDoubleClick={handleSpanDoubleClick}
                        className="w-full h-full overflow-y-auto thin-scroll p-4 sm:p-8 font-cjk text-xl sm:text-2xl leading-loose whitespace-pre-wrap text-foreground cursor-text select-text"
                    >
                        {tokens.map((t, i) => {
                            if (!t.isCJK) {
                                return (
                                    <span
                                        key={`p${i}`}
                                        className="text-foreground/90"
                                    >
                                        {t.text}
                                    </span>
                                );
                            }
                            const isActive =
                                activeAlignIdx !== null &&
                                t.offset === activeAlignIdx;
                            return (
                                <span
                                    key={`c${i}`}
                                    data-offset={t.offset}
                                    className={cn(
                                        "read-char",
                                        isActive && "is-active",
                                    )}
                                >
                                    {t.text}
                                </span>
                            );
                        })}
                        {!hasContent && (
                            <span className="text-muted-foreground text-base">
                                Nothing to read yet — paste some text above.
                            </span>
                        )}
                    </div>
                ) : (
                    <div className="relative h-full">
                        <textarea
                            ref={textareaRef}
                            value={content}
                            onChange={(e) => onContentChange(e.target.value)}
                            onPointerDown={() => {
                                pointerInTextareaRef.current = true;
                            }}
                            onKeyUp={handleTextareaInteract}
                            maxLength={maxLength}
                            placeholder={"把中文字粘贴到这里…"}
                            spellCheck={false}
                            className={cn(
                                "w-full h-full block resize-none p-4 sm:p-8 bg-transparent outline-none border-0",
                                "font-cjk text-xl sm:text-2xl leading-loose text-foreground placeholder:text-muted-foreground/50",
                                "thin-scroll",
                            )}
                        />
                        {maxLength !== undefined &&
                            content.length > maxLength * 0.8 && (
                                <div
                                    className={cn(
                                        "absolute bottom-2 right-3 text-[10px] tabular-nums px-1.5 py-0.5 rounded bg-background/80 backdrop-blur-sm pointer-events-none",
                                        content.length >= maxLength
                                            ? "text-[var(--red-ink)] font-medium"
                                            : "text-muted-foreground",
                                    )}
                                >
                                    {content.length} / {maxLength}
                                </div>
                            )}
                    </div>
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
                seekRef={seekRef}
                onPlayStateChange={(playing) => {
                    if (!playing) {
                        setIsPlaying(false);
                    }
                }}
            />
        </div>
    );
}
