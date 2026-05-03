import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BookOpen, HelpCircle, Languages } from "lucide-react";
import { capture } from "./lib/analytics";
import { TabBar, type Tab } from "./components/TabBar";
import { Notepad } from "./components/Notepad";
import { CharacterCard, type LookupData } from "./components/CharacterCard";
import { VocabBank, VocabBankPanel, type VocabEntry } from "./components/VocabBank";
import { OnboardingModal } from "./components/OnboardingModal";
import "./index.css";

const STORAGE_KEY = "chinese-reader/tabs/v1";
const ACTIVE_KEY = "chinese-reader/active/v1";
const ONBOARDED_KEY = "chinese-reader/onboarded/v1";
const HOVER_DEBOUNCE_MS = 220;

function titleFromContent(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "Untitled";
  const match = trimmed.match(/^[^\n。！？!?]{1,10}/);
  return match?.[0]?.trim() || "Untitled";
}


const SAMPLE_TEXT = `欢迎使用红页！

把任何中文文字粘贴到这里。
点击汉字可以查看拼音、词性、英文翻译，以及一个简单的例句。
点击底部的播放按钮收听整段朗读，并跟随高亮一起阅读。`;

function makeId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function loadTabs(): { tabs: Tab[]; activeTabId: string } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const activeId = localStorage.getItem(ACTIVE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Tab[];
      if (Array.isArray(parsed) && parsed.length > 0) {
        const id = activeId && parsed.some(t => t.id === activeId) ? activeId : parsed[0]!.id;
        return { tabs: parsed, activeTabId: id };
      }
    }
  } catch {
    // ignore
  }
  const id = makeId();
  return { tabs: [{ id, title: "Welcome", content: SAMPLE_TEXT }], activeTabId: id };
}

export function App() {
  const initial = useMemo(loadTabs, []);
  const [tabs, setTabs] = useState<Tab[]>(initial.tabs);
  const [activeTabId, setActiveTabId] = useState<string>(initial.activeTabId);

  const [hoveredChar, setHoveredChar] = useState<string | null>(null);
  const [pinnedChar, setPinnedChar] = useState<string | null>(null);
  const [audioChar, setAudioChar] = useState<string | null>(null);

  const [lookupData, setLookupData] = useState<LookupData | null>(null);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);

  const lookupCacheRef = useRef<Map<string, LookupData>>(new Map());
  const debounceRef = useRef<number | null>(null);
  const inflightRef = useRef<AbortController | null>(null);

  // Vocabulary bank state — per tab
  const [vocabByTab, setVocabByTab] = useState<Record<string, VocabEntry[]>>({});
  const [vocabLoading, setVocabLoading] = useState(false);
  const [vocabError, setVocabError] = useState<string | null>(null);
  const [vocabModalOpen, setVocabModalOpen] = useState(false);
  const [characterModalOpen, setCharacterModalOpen] = useState(false);
  const [onboardingOpen, setOnboardingOpen] = useState(
    () => !localStorage.getItem(ONBOARDED_KEY),
  );
  const vocabInflightRef = useRef<AbortController | null>(null);

  const dismissOnboarding = useCallback(() => {
    try { localStorage.setItem(ONBOARDED_KEY, "1"); } catch { /* quota */ }
    setOnboardingOpen(false);
  }, []);

  const activeTab = tabs.find(t => t.id === activeTabId) ?? tabs[0]!;

  const vocabEntries = vocabByTab[activeTabId] ?? null;
  const vocabZhSet = useMemo(
    () => new Set((vocabEntries ?? []).map(e => e.zh)),
    [vocabEntries],
  );
  const vocabCount = vocabEntries?.length ?? 0;

  // Hover takes priority over pinned selection
  const displayChar = hoveredChar ?? pinnedChar;

  // Track text content — fires 3 s after the user stops typing/pasting
  const textTrackTimerRef = useRef<number | null>(null);
  useEffect(() => {
    const text = activeTab.content.trim();
    if (!text) return;
    if (textTrackTimerRef.current !== null) clearTimeout(textTrackTimerRef.current);
    textTrackTimerRef.current = window.setTimeout(() => {
      capture("text_inputted", { text, char_count: text.length });
    }, 3000);
    return () => {
      if (textTrackTimerRef.current !== null) clearTimeout(textTrackTimerRef.current);
    };
  }, [activeTab.content]);

  // Persist tabs
  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(tabs)); } catch { /* quota */ }
  }, [tabs]);
  useEffect(() => {
    try { localStorage.setItem(ACTIVE_KEY, activeTabId); } catch { /* quota */ }
  }, [activeTabId]);

  // Tab management
  const createTab = useCallback(() => {
    const id = makeId();
    setTabs(prev => {
      const n = prev.filter(t => /^Untitled( \d+)?$/.test(t.title)).length + 1;
      return [...prev, { id, title: n === 1 ? "Untitled" : `Untitled ${n}`, content: "" }];
    });
    setActiveTabId(id);
    capture("tab_created");
  }, []);

  const closeTab = useCallback((id: string) => {
    setTabs(prev => {
      if (prev.length <= 1) return prev;
      const idx = prev.findIndex(t => t.id === id);
      const next = prev.filter(t => t.id !== id);
      setActiveTabId(cur => {
        if (cur !== id) return cur;
        return (next[Math.max(0, idx - 1)] ?? next[0]!).id;
      });
      return next;
    });
  }, []);

  const updateContent = useCallback(
    (next: string) => {
      setTabs(prev => prev.map(t =>
        t.id === activeTabId ? { ...t, content: next, title: titleFromContent(next) } : t,
      ));
    },
    [activeTabId],
  );

  // Core fetch logic
  const fetchLookup = useCallback(
    async (char: string, context: string | undefined, signal: AbortSignal) => {
      const res = await fetch("/api/lookup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: char, context }),
        signal,
      });
      if (!res.ok) throw new Error((await res.text()) || `Lookup failed (${res.status})`);
      return (await res.json()) as LookupData;
    },
    [],
  );

  const triggerLookup = useCallback(
    (char: string, context: string | undefined, debounce: boolean) => {
      if (debounceRef.current !== null) {
        window.clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
      if (inflightRef.current) {
        inflightRef.current.abort();
        inflightRef.current = null;
      }

      const cached = lookupCacheRef.current.get(char);
      if (cached) {
        setLookupData(cached);
        setLookupLoading(false);
        setLookupError(null);
        return;
      }

      setLookupData(null);
      setLookupLoading(true);
      setLookupError(null);

      const run = async () => {
        const ctrl = new AbortController();
        inflightRef.current = ctrl;
        try {
          const data = await fetchLookup(char, context, ctrl.signal);
          lookupCacheRef.current.set(char, data);
          setLookupData(data);
          setLookupLoading(false);
        } catch (err) {
          if ((err as Error).name === "AbortError") return;
          setLookupError(err instanceof Error ? err.message : String(err));
          setLookupLoading(false);
        } finally {
          if (inflightRef.current === ctrl) inflightRef.current = null;
        }
      };

      if (debounce) {
        debounceRef.current = window.setTimeout(run, HOVER_DEBOUNCE_MS);
      } else {
        void run();
      }
    },
    [fetchLookup],
  );

  // When the displayed char changes, update the card data
  useEffect(() => {
    if (!displayChar) {
      setLookupData(null);
      setLookupLoading(false);
      setLookupError(null);
      return;
    }
    const cached = lookupCacheRef.current.get(displayChar);
    if (cached) {
      setLookupData(cached);
      setLookupLoading(false);
      setLookupError(null);
    }
    // Actual fetching is triggered by handlers below; this just syncs from cache on source change
  }, [displayChar]);

  // Hover (temporary, span view)
  const handleHoverChar = useCallback(
    (char: string | null, context?: string) => {
      setHoveredChar(char);
      if (char === null) return;
      capture("character_lookup", { char, source: "hover" });
      triggerLookup(char, context, true);
    },
    [triggerLookup],
  );

  // Text selection → pin to card; on small screens auto-opens the modal
  const handleSelectChar = useCallback(
    (char: string | null, context?: string) => {
      if (char !== null) capture("character_lookup", { char, source: "highlight", char_length: char.length });
      setPinnedChar(char);
      if (char === null) {
        setCharacterModalOpen(false);
        if (!hoveredChar) {
          setLookupData(null);
          setLookupLoading(false);
          setLookupError(null);
        }
        return;
      }
      setCharacterModalOpen(true);
      triggerLookup(char, context, false);
    },
    [triggerLookup, hoveredChar],
  );

  // Audio char (tracked for Notepad highlight only — card is unaffected during playback)
  const handleAudioChar = useCallback((char: string | null) => {
    setAudioChar(char);
  }, []);

  // Vocabulary bank handlers
  const handleGenerateVocab = useCallback(async () => {
    const text = activeTab.content.trim();
    if (!text) return;
    capture("vocab_generated", { char_count: text.length });

    if (vocabInflightRef.current) {
      vocabInflightRef.current.abort();
      vocabInflightRef.current = null;
    }
    const ctrl = new AbortController();
    vocabInflightRef.current = ctrl;
    const tabId = activeTabId;

    setVocabLoading(true);
    setVocabError(null);
    try {
      const res = await fetch("/api/vocab", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text }),
        signal: ctrl.signal,
      });
      if (!res.ok) throw new Error((await res.text()) || `Vocab failed (${res.status})`);
      const json = (await res.json()) as { items: VocabEntry[] };
      const items = Array.isArray(json.items) ? json.items : [];
      setVocabByTab(prev => ({ ...prev, [tabId]: items }));
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      setVocabError(err instanceof Error ? err.message : String(err));
    } finally {
      if (vocabInflightRef.current === ctrl) {
        vocabInflightRef.current = null;
        setVocabLoading(false);
      }
    }
  }, [activeTab.content, activeTabId]);

  const handleAddToVocab = useCallback((entry: VocabEntry) => {
    const tabId = activeTabId;
    setVocabByTab(prev => {
      const existing = prev[tabId] ?? [];
      if (existing.some(e => e.zh === entry.zh)) return prev;
      capture("vocab_added", { char: entry.zh });
      return { ...prev, [tabId]: [...existing, entry] };
    });
  }, [activeTabId]);

  const handleRemoveVocab = useCallback((zh: string) => {
    const tabId = activeTabId;
    setVocabByTab(prev => {
      const existing = prev[tabId];
      if (!existing) return prev;
      const next = existing.filter(e => e.zh !== zh);
      return { ...prev, [tabId]: next };
    });
  }, [activeTabId]);

  // Reset when switching tabs
  useEffect(() => {
    setHoveredChar(null);
    setPinnedChar(null);
    setAudioChar(null);
    setCharacterModalOpen(false);
    setLookupData(null);
    setLookupLoading(false);
    setLookupError(null);
    setVocabError(null);
    setVocabLoading(false);
    if (debounceRef.current !== null) window.clearTimeout(debounceRef.current);
    if (inflightRef.current) inflightRef.current.abort();
    if (vocabInflightRef.current) {
      vocabInflightRef.current.abort();
      vocabInflightRef.current = null;
    }
  }, [activeTabId]);

  useEffect(() => {
    if (!vocabModalOpen && !characterModalOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setVocabModalOpen(false);
        setCharacterModalOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [vocabModalOpen, characterModalOpen]);

  return (
    <div className="flex flex-col h-screen w-screen bg-background text-foreground">
      <header className="flex items-center justify-between gap-3 px-4 sm:px-6 py-3 border-b border-border bg-background">
        <div className="flex items-center gap-3">
          <span className="font-cjk-serif text-2xl text-[var(--red-ink)] leading-none">红页</span>
          <div className="flex items-baseline gap-2">
            <span className="text-sm font-semibold tracking-tight">RedLeaf</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {pinnedChar && (
            <button
              type="button"
              onClick={() => setCharacterModalOpen(true)}
              className="md:hidden inline-flex items-center gap-1.5 rounded-full border border-[var(--red-soft)] bg-background px-3 py-1.5 text-xs font-medium text-[var(--red-ink)] hover:bg-[var(--red-wash)]"
              aria-haspopup="dialog"
              aria-expanded={characterModalOpen}
            >
              <Languages className="h-3.5 w-3.5" />
              Word
            </button>
          )}
          <button
            type="button"
            onClick={() => setVocabModalOpen(true)}
            className="lg:hidden inline-flex items-center gap-1.5 rounded-full border border-[var(--red-soft)] bg-[var(--red-wash)] px-3 py-1.5 text-xs font-medium text-[var(--red-ink)] hover:bg-[var(--red-soft)]/25"
            aria-haspopup="dialog"
            aria-expanded={vocabModalOpen}
          >
            <BookOpen className="h-3.5 w-3.5" />
            Vocab
            {vocabCount > 0 && (
              <span className="ml-0.5 rounded-full bg-[var(--red-ink)] px-1.5 py-0.5 text-[10px] leading-none text-white">
                {vocabCount}
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={() => setOnboardingOpen(true)}
            aria-label="Help"
            title="Help"
            className="inline-flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground hover:text-[var(--red-ink)] hover:bg-[var(--red-wash)] transition-colors"
          >
            <HelpCircle className="h-4 w-4" />
          </button>
        </div>
      </header>

      <TabBar
        tabs={tabs}
        activeTabId={activeTab.id}
        onSelect={setActiveTabId}
        onCreate={createTab}
        onClose={closeTab}
      />

      <main className="flex-1 min-h-0 flex overflow-hidden">
        <VocabBank
          text={activeTab.content}
          entries={vocabEntries}
          loading={vocabLoading}
          error={vocabError}
          onGenerate={handleGenerateVocab}
          onRemoveEntry={handleRemoveVocab}
        />
        <div className="flex-1 min-w-0 min-h-0 border-x border-border overflow-hidden flex flex-col">
          <Notepad
            key={activeTab.id}
            content={activeTab.content}
            onContentChange={updateContent}
            onHoverChar={handleHoverChar}
            onSelectChar={handleSelectChar}
            onAudioChar={handleAudioChar}
          />
        </div>
        <aside className="hidden md:block w-80 shrink-0 min-h-0 overflow-hidden bg-background">
          <CharacterCard
            character={displayChar}
            loading={lookupLoading}
            data={lookupData}
            error={lookupError}
            onAddToVocab={handleAddToVocab}
            vocabZhSet={vocabZhSet}
          />
        </aside>
      </main>

      {/* Vocab bank modal — mobile/tablet */}
      {vocabModalOpen && (
        <div
          className="fixed inset-0 z-50 lg:hidden bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Vocabulary bank"
          onPointerDown={event => {
            if (event.target === event.currentTarget) {
              event.preventDefault();
              setVocabModalOpen(false);
            }
          }}
        >
          <div className="w-full max-w-md" style={{ height: "min(85dvh, 680px)" }}>
            <VocabBankPanel
              text={activeTab.content}
              entries={vocabEntries}
              loading={vocabLoading}
              error={vocabError}
              onGenerate={handleGenerateVocab}
              onRemoveEntry={handleRemoveVocab}
              className="h-full flex-none"
            />
          </div>
        </div>
      )}

      {/* Footer */}
      <footer className="fixed bottom-2 right-3 z-40 pointer-events-none">
        <a
          href="https://x.com/jefffreyli"
          target="_blank"
          rel="noopener noreferrer"
          className="p-4 pointer-events-auto text-[12px] text-muted-foreground/50 hover:text-muted-foreground transition-colors"
        >
          Created by JL
        </a>
      </footer>

      {/* Character card modal — mobile (auto-opens on text selection) */}
      {characterModalOpen && (
        <div
          className="fixed inset-0 z-50 md:hidden bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Character details"
          onPointerDown={event => {
            if (event.target === event.currentTarget) {
              event.preventDefault();
              setCharacterModalOpen(false);
            }
          }}
        >
          <div
            className="w-full max-w-md rounded-2xl overflow-hidden bg-background shadow-2xl"
            style={{ height: "min(85dvh, 680px)" }}
          >
            <CharacterCard
              character={displayChar}
              loading={lookupLoading}
              data={lookupData}
              error={lookupError}
              onAddToVocab={handleAddToVocab}
              vocabZhSet={vocabZhSet}
            />
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
