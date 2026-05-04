import { useEffect, useRef, useState } from "react";

export type SubtitleItem = {
    charStart: number;
    charEnd: number;
    zh: string;
    pinyin: string;
    en: string;
};

type Props = {
    subtitles: SubtitleItem[] | null;
    activeOffset: number | null;
    visible: boolean;
    loading?: boolean;
};

function findSubtitle(
    subtitles: SubtitleItem[],
    offset: number,
): SubtitleItem | null {
    return (
        subtitles.find((s) => offset >= s.charStart && offset < s.charEnd) ??
        null
    );
}

export function SubtitleBar({
    subtitles,
    activeOffset,
    visible,
    loading = false,
}: Props) {
    const [displayed, setDisplayed] = useState<SubtitleItem | null>(null);
    const hideTimerRef = useRef<number | null>(null);

    useEffect(() => {
        if (hideTimerRef.current !== null) {
            window.clearTimeout(hideTimerRef.current);
            hideTimerRef.current = null;
        }

        // When paused (!visible), keep whatever is currently displayed.
        if (!visible) return;

        if (!subtitles || subtitles.length === 0) return;

        const found =
            activeOffset !== null
                ? findSubtitle(subtitles, activeOffset)
                : null;
        setDisplayed(found ?? subtitles[0] ?? null);
    }, [visible, subtitles, activeOffset]);

    // Clean up timer on unmount
    useEffect(() => {
        return () => {
            if (hideTimerRef.current !== null)
                window.clearTimeout(hideTimerRef.current);
        };
    }, []);

    // When subtitles array changes (text changed → null), clear immediately
    const prevSubsRef = useRef<SubtitleItem[] | null>(subtitles);
    useEffect(() => {
        if (prevSubsRef.current !== null && subtitles === null) {
            setDisplayed(null);
        }
        prevSubsRef.current = subtitles;
    }, [subtitles]);

    if (!displayed && !(visible && loading)) return null;

    return (
        <div
            className="shrink-0 border-t border-border/40 bg-background/80 backdrop-blur-sm"
            aria-live="polite"
            aria-atomic="true"
        >
            {displayed ? (
                <div
                    key={displayed.charStart}
                    className="flex flex-col items-center justify-center gap-0.5 px-6 py-2 text-center animate-[fadeUp_0.2s_ease-out_both]"
                >
                    <span className="pinyin text-[11px] text-[var(--red-ink)]/80 leading-tight tracking-wide">
                        {displayed.pinyin}
                    </span>
                    <span className="text-[10px] sm:text-[11px] text-muted-foreground leading-tight max-w-lg mx-auto">
                        {displayed.en}
                    </span>
                </div>
            ) : (
                <div className="flex items-center justify-center px-6 py-3 text-[11px] text-muted-foreground">
                    Loading translations…
                </div>
            )}
        </div>
    );
}
