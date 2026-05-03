import { Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";

export type Tab = {
  id: string;
  title: string;
  content: string;
};

type Props = {
  tabs: Tab[];
  activeTabId: string;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onClose: (id: string) => void;
};

export function TabBar({ tabs, activeTabId, onSelect, onCreate, onClose }: Props) {
  return (
    <div className="flex items-stretch border-b border-border bg-background/80 backdrop-blur-sm">
      <div
        className="flex-1 flex items-stretch overflow-x-auto thin-scroll"
        role="tablist"
        aria-label="Notepad tabs"
      >
        {tabs.map(tab => {
          const active = tab.id === activeTabId;
          return (
            <div
              key={tab.id}
              role="tab"
              aria-selected={active}
              onClick={() => onSelect(tab.id)}
              className={cn(
                "group relative flex items-center gap-2 px-4 py-2.5 text-sm cursor-pointer select-none border-r border-border min-w-[120px] max-w-[220px]",
                active
                  ? "bg-background text-foreground"
                  : "bg-transparent text-muted-foreground hover:text-foreground hover:bg-secondary/50",
              )}
            >
              {active && (
                <span
                  aria-hidden
                  className="absolute left-0 right-0 bottom-0 h-[2px] bg-[var(--red-ink)]"
                />
              )}
              <span className="truncate flex-1">{tab.title}</span>
              {tabs.length > 1 && (
                <button
                  type="button"
                  aria-label={`Close ${tab.title}`}
                  onClick={e => {
                    e.stopPropagation();
                    onClose(tab.id);
                  }}
                  className="opacity-0 group-hover:opacity-100 hover:bg-border rounded p-0.5 transition-opacity"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          );
        })}
        <button
          type="button"
          aria-label="New tab"
          title="New tab"
          onClick={onCreate}
          className="flex items-center justify-center px-3 py-2.5 text-muted-foreground hover:text-[var(--red-ink)] hover:bg-secondary/50 transition-colors"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
