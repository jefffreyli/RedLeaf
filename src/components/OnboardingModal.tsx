import { useEffect } from "react";
import { X, BookOpen, Play, MousePointer, LayoutTemplate, Volume2, Languages, Plus } from "lucide-react";

type Props = {
  open: boolean;
  onClose: () => void;
};

type FeatureRowProps = {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
};

function FeatureRow({ icon, title, children }: FeatureRowProps) {
  return (
    <div className="flex gap-3">
      <div className="mt-0.5 shrink-0 flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--red-wash)] text-[var(--red-ink)]">
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-xs font-semibold text-foreground mb-0.5">{title}</p>
        <p className="text-xs text-muted-foreground leading-relaxed">{children}</p>
      </div>
    </div>
  );
}

export function OnboardingModal({ open, onClose }: Props) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label="Help &amp; Features"
      onMouseDown={event => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="relative w-full max-w-md rounded-2xl bg-background border border-border shadow-2xl flex flex-col max-h-[90dvh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-border shrink-0">
          <div className="flex items-center gap-3">
            <span className="font-cjk-serif text-2xl text-[var(--red-ink)] leading-none">红页</span>
            <div>
              <p className="text-sm font-semibold tracking-tight">RedLeaf</p>
              <p className="text-[11px] text-muted-foreground">Chinese Reading Assistant</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="inline-flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="overflow-y-auto thin-scroll px-6 py-4 flex flex-col gap-4">
          <p className="text-xs text-muted-foreground leading-relaxed">
            RedLeaf is an AI-powered Chinese reading companion. Paste any text to look up characters, build a vocabulary bank, and listen to read-aloud with live highlighting and subtitles.
          </p>

         
        </div>

        {/* Footer */}
        <div className="px-6 pb-5 pt-3 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="w-full rounded-lg bg-[var(--red-ink)] text-white text-sm font-medium py-2.5 hover:brightness-110 active:brightness-95 transition-all"
          >
            开始阅读 · Start Reading
          </button>
        </div>
      </div>
    </div>
  );
}
