export type Piece = { text: string; charStart: number; charEnd: number };

const MAX_CHUNK = 180;

/**
 * Splits text into pieces of <= MAX_CHUNK characters, breaking on
 * sentence-ending punctuation (CJK or ASCII), keeping char offsets into
 * the original text intact for highlight syncing.
 */
export function chunkTextWithOffsets(text: string): Piece[] {
  if (text.length === 0) return [];

  const breaks: number[] = [0];
  for (let i = 0; i < text.length; i++) {
    if (/[。！？!?\n]/.test(text[i]!)) breaks.push(i + 1);
  }
  if (breaks[breaks.length - 1] !== text.length) breaks.push(text.length);

  const out: Piece[] = [];
  let chunkStart = breaks[0]!;

  for (let i = 1; i < breaks.length; i++) {
    const candidateEnd = breaks[i]!;
    if (candidateEnd - chunkStart <= MAX_CHUNK) continue;

    const prevBreak = breaks[i - 1]!;
    if (prevBreak > chunkStart) {
      out.push({ text: text.slice(chunkStart, prevBreak), charStart: chunkStart, charEnd: prevBreak });
      chunkStart = prevBreak;
    }

    if (candidateEnd - chunkStart > MAX_CHUNK) {
      for (let j = chunkStart; j < candidateEnd; j += MAX_CHUNK) {
        const pieceEnd = Math.min(j + MAX_CHUNK, candidateEnd);
        out.push({ text: text.slice(j, pieceEnd), charStart: j, charEnd: pieceEnd });
      }
      chunkStart = candidateEnd;
    }
  }

  if (chunkStart < text.length) {
    out.push({ text: text.slice(chunkStart), charStart: chunkStart, charEnd: text.length });
  }

  return out;
}

/**
 * Splits text into one piece per sentence, preserving character offsets.
 * Used for subtitle generation so each subtitle card covers one sentence.
 */
export function chunkBySentence(text: string): Piece[] {
  if (text.length === 0) return [];
  const out: Piece[] = [];
  let segStart = 0;

  for (let i = 0; i < text.length; i++) {
    if (/[。！？!?\n]/.test(text[i]!)) {
      const segEnd = i + 1;
      const seg = text.slice(segStart, segEnd).replace(/[\n\r]/g, "").trim();
      if (seg.length > 0) {
        out.push({ text: seg, charStart: segStart, charEnd: segEnd });
      }
      segStart = segEnd;
    }
  }

  if (segStart < text.length) {
    const seg = text.slice(segStart).replace(/[\n\r]/g, "").trim();
    if (seg.length > 0) {
      out.push({ text: seg, charStart: segStart, charEnd: text.length });
    }
  }

  return out;
}
