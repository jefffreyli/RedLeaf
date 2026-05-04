import { Loader2, Sparkles, X } from "lucide-react";
import { cn } from "@/lib/utils";

export type VocabEntry = {
    zh: string;
    pinyin: string;
    pos: string;
    translation: string;
};

type Props = {
  text: string;
  entries: VocabEntry[] | null;
  loading: boolean;
  error: string | null;
  onGenerate: () => void;
  onRemoveEntry: (zh: string) => void;
  onSelectEntry?: (entry: VocabEntry) => void;
  /** When true, the bank is read-only (Generate disabled, rows non-clickable). */
  frozen?: boolean;
};

type VocabBankPanelProps = Props & {
    className?: string;
};

const POS_ABBREV: Record<string, string> = {
    noun: "n.",
    verb: "v.",
    adjective: "adj.",
    adverb: "adv.",
    particle: "part.",
    conjunction: "conj.",
    "measure word": "mw.",
    pronoun: "pron.",
    idiom: "idiom",
    phrase: "phr.",
    preposition: "prep.",
    interjection: "interj.",
    numeral: "num.",
    determiner: "det.",
};

function abbreviatePos(pos: string): string {
    const key = pos.trim().toLowerCase();
    return POS_ABBREV[key] ?? key;
}

export function VocabBankPanel({
  text,
  entries,
  loading,
  error,
  onGenerate,
  onRemoveEntry,
  onSelectEntry,
  frozen = false,
  className,
}: VocabBankPanelProps) {
  const hasContent = text.trim().length > 0;
  const hasEntries = entries !== null && entries.length > 0;
  const interactive = !frozen;

    return (
        <div
            className={cn(
                "flex-1 min-h-0 flex flex-col rounded-2xl overflow-hidden",
                "bg-[#C2413A] text-[#FFF8E7] shadow-[0_4px_24px_rgba(0,0,0,0.16)]",
                className,
            )}
            style={{
                border: "1px solid rgba(212, 175, 55, 0.35)",
            }}
        >
            {/* Decorative top flap line */}
            <div
                aria-hidden
                className="h-[2px] w-full"
                style={{
                    background:
                        "linear-gradient(90deg, transparent 0%, #D4AF37 20%, #F0CB58 50%, #D4AF37 80%, transparent 100%)",
                }}
            />

            {/* Header */}
            <header
                className="px-4 pt-3 pb-3 flex items-center justify-between"
                style={{
                    background: "rgba(122, 18, 18, 0.28)",
                    borderBottom: "1px solid rgba(212, 175, 55, 0.35)",
                }}
            >
                <div className="flex items-center gap-2 min-w-0">
                    <span className="font-cjk-serif text-xl text-[#FFF8E7] leading-none">
                        福
                    </span>
                    <div className="flex flex-col leading-tight min-w-0">
                        <span className="text-[11px] uppercase tracking-[0.2em] text-[#D4AF37]">
                            Vocab Bank
                        </span>
                        <span className="text-[10px] text-[#E8C9A0]/80 truncate">
                            生词本
                        </span>
                    </div>
                </div>
                <button
                    type="button"
                    onClick={onGenerate}
                    disabled={loading || !hasContent || frozen}
                    className={cn(
                        "inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium",
                        "border border-[#D4AF37] text-[#D4AF37] bg-transparent",
                        "hover:bg-[#D4AF37] hover:text-[#8A1F1B]",
                        "disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-[#D4AF37]",
                    )}
                    title={
                        frozen
                            ? "Switch back to Chinese mode to edit vocab"
                            : hasContent
                            ? "Generate vocab from text"
                            : "Paste some text first"
                    }
                >
                    <Sparkles className="h-3 w-3" />
                    {hasEntries ? "Refresh" : "Generate"}
                </button>
            </header>

            {/* Body */}
            <div className="flex-1 min-h-0 overflow-y-auto thin-scroll">
                {error && !loading && (
                    <div className="m-3 rounded-md border border-[#D4AF37]/40 bg-black/20 px-3 py-2 text-[11px] text-[#FFE9B0]">
                        {error}
                    </div>
                )}

                {!hasEntries && !loading && !error && (
                    <div className="h-full flex flex-col items-center justify-center px-6 py-10 text-center gap-3 text-[#E8C9A0]/85">
                        <p className="text-[11px] leading-relaxed max-w-[180px]">
                            {hasContent
                                ? "Press Generate to build a vocabulary bank from this text. Click any character on the right card to add it manually."
                                : "Paste Chinese text in the notepad, then come back and press Generate."}
                        </p>
                    </div>
                )}

                {loading && (
                    <div className="h-full flex flex-col items-center justify-center gap-2 text-[#E8C9A0]/85">
                        <Loader2 className="h-5 w-5 animate-spin text-[#D4AF37]" />
                        <span className="text-[11px]">
                            Picking key vocabulary…
                        </span>
                    </div>
                )}

                {hasEntries && (
                    <ul className="divide-y divide-[rgba(255,248,231,0.08)]">
                        {entries!.map((entry, i) => {
                            const clickable = !!onSelectEntry && !frozen;
                            const Tag = clickable ? "button" : "div";
                            return (
                                <li
                                    key={`${entry.zh}-${i}`}
                                    className={cn(
                                        "group relative",
                                        i % 2 === 1 && "bg-white/[0.025]",
                                    )}
                                >
                                    <Tag
                                        type={clickable ? "button" : undefined}
                                        onClick={
                                            clickable
                                                ? () => onSelectEntry!(entry)
                                                : undefined
                                        }
                                        className={cn(
                                            "block w-full text-left px-4 py-2.5",
                                            clickable &&
                                                "cursor-pointer hover:bg-white/[0.05] focus:outline-none focus:bg-white/[0.05] transition-colors",
                                        )}
                                    >
                                        <div className="flex items-baseline gap-2 pr-6">
                                            <span className="font-cjk-serif text-lg text-[#FFF8E7] leading-tight break-words">
                                                {entry.zh}
                                            </span>
                                            <span className="pinyin text-[11px] italic text-[#D4AF37] leading-tight truncate">
                                                {entry.pinyin}
                                            </span>
                                        </div>
                                        <div className="mt-1 flex items-center gap-2 flex-wrap">
                                            <span
                                                className="inline-flex items-center text-[9px] uppercase tracking-wider px-1.5 py-[1px] rounded-sm"
                                                style={{
                                                    color: "#F0CB58",
                                                    border: "1px solid rgba(212,175,55,0.45)",
                                                    background:
                                                        "rgba(122,18,18,0.28)",
                                                }}
                                            >
                                                {abbreviatePos(entry.pos || "")}
                                            </span>
                                            <span className="text-[11px] text-[#E8C9A0] leading-snug flex-1 min-w-0 break-words">
                                                {entry.translation}
                                            </span>
                                        </div>
                                    </Tag>

                                    {!frozen && (
                                        <button
                                            type="button"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                onRemoveEntry(entry.zh);
                                            }}
                                            aria-label={`Remove ${entry.zh}`}
                                            className={cn(
                                                "absolute top-2 right-2 inline-flex items-center justify-center h-5 w-5 rounded-full",
                                                "text-[#FFF8E7]/40 hover:text-[#FFF8E7] hover:bg-black/30",
                                                "opacity-0 group-hover:opacity-100",
                                            )}
                                        >
                                            <X className="h-3 w-3" />
                                        </button>
                                    )}
                                </li>
                            );
                        })}
                    </ul>
                )}
            </div>

            {hasEntries && (
                <div
                    className="px-4 py-2 text-[10px] text-[#E8C9A0]/70 text-center"
                    style={{ borderTop: "1px solid rgba(212, 175, 55, 0.2)" }}
                >
                    {entries!.length} {entries!.length === 1 ? "word" : "words"}
                </div>
            )}
        </div>
    );
}

export function VocabBank(props: Props) {
    return (
        <aside className="hidden lg:flex lg:flex-col w-72 shrink-0 min-h-0 overflow-hidden p-4 bg-background">
            <VocabBankPanel {...props} />
        </aside>
    );
}

// Re-export so consumers don't need a second import. Both `VocabBank` and
// `VocabBankPanel` accept the optional `onSelectEntry` callback.
export type { Props as VocabBankProps };
