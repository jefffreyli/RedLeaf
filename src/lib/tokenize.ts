export type Token = {
  text: string;
  isCJK: boolean;
  /** Index used by the read-pane for hover/highlight tracking. -1 for non-renderable filler. */
  idx: number;
  /** Source character offset in the original text (start). */
  offset: number;
};

const CJK_RE = /\p{Script=Han}/u;

/**
 * Splits text into a flat array of tokens. Every CJK character is its own token
 * (so we can hover and highlight individual characters); other text is grouped
 * into runs of latin / digits / punctuation / whitespace.
 */
export function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  let idx = 0;
  let buf = "";
  let bufStart = 0;

  const flush = (atOffset: number) => {
    if (buf.length === 0) return;
    tokens.push({ text: buf, isCJK: false, idx: -1, offset: bufStart });
    buf = "";
    bufStart = atOffset;
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (CJK_RE.test(ch)) {
      flush(i);
      tokens.push({ text: ch, isCJK: true, idx: idx++, offset: i });
      bufStart = i + 1;
    } else {
      if (buf.length === 0) bufStart = i;
      buf += ch;
    }
  }
  flush(text.length);

  return tokens;
}

/** Get a small surrounding window of plain text for context lookups. */
export function getContextAround(text: string, offset: number, windowChars = 24): string {
  const start = Math.max(0, offset - windowChars);
  const end = Math.min(text.length, offset + windowChars);
  return text.slice(start, end);
}
