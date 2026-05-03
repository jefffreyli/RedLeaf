const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const GTTS_MAX_CHUNK = 180;
const GTTS_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

type Piece = { text: string; charStart: number; charEnd: number };

/**
 * Splits text into pieces of <= GTTS_MAX_CHUNK characters, breaking on
 * sentence-ending punctuation (CJK or ASCII), keeping char offsets into
 * the original text intact for highlight syncing.
 */
function chunkTextWithOffsets(text: string): Piece[] {
  if (text.length === 0) return [];

  // Find break points: char offsets where it's safe to split.
  // 0 (start), text.length (end), and right after sentence terminators / newlines.
  const breaks: number[] = [0];
  for (let i = 0; i < text.length; i++) {
    if (/[。！？!?\n]/.test(text[i]!)) breaks.push(i + 1);
  }
  if (breaks[breaks.length - 1] !== text.length) breaks.push(text.length);

  const out: Piece[] = [];
  let chunkStart = breaks[0]!;

  for (let i = 1; i < breaks.length; i++) {
    const candidateEnd = breaks[i]!;
    if (candidateEnd - chunkStart <= GTTS_MAX_CHUNK) {
      // Keep extending the current chunk
      continue;
    }

    // Adding the next sentence overflows. Commit chunk up to previous break.
    const prevBreak = breaks[i - 1]!;
    if (prevBreak > chunkStart) {
      out.push({ text: text.slice(chunkStart, prevBreak), charStart: chunkStart, charEnd: prevBreak });
      chunkStart = prevBreak;
    }

    // If the next single sentence is itself longer than MAX, hard-split it.
    if (candidateEnd - chunkStart > GTTS_MAX_CHUNK) {
      for (let j = chunkStart; j < candidateEnd; j += GTTS_MAX_CHUNK) {
        const pieceEnd = Math.min(j + GTTS_MAX_CHUNK, candidateEnd);
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

async function fetchGoogleTtsChunk(chunk: string): Promise<Uint8Array> {
  const url = new URL("https://translate.google.com/translate_tts");
  url.searchParams.set("ie", "UTF-8");
  url.searchParams.set("tl", "zh-CN");
  url.searchParams.set("client", "tw-ob");
  url.searchParams.set("q", chunk);

  const res = await fetch(url, {
    headers: {
      "user-agent": GTTS_USER_AGENT,
      accept: "audio/mpeg, audio/*;q=0.9, */*;q=0.5",
      "accept-language": "en-US,en;q=0.9,zh-CN;q=0.8",
      referer: "https://translate.google.com/",
    },
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Google TTS error ${res.status}: ${errText.slice(0, 200)}`);
  }

  const buf = await res.arrayBuffer();
  return new Uint8Array(buf);
}

export type TtsChunk = {
  charStart: number;
  charEnd: number;
  byteLen: number;
};

export async function googleTranslateTts(
  text: string,
): Promise<{ audioBase64: string; chunks: TtsChunk[] }> {
  const pieces = chunkTextWithOffsets(text);
  if (pieces.length === 0) throw new Error("Empty text");

  const buffers: Uint8Array[] = [];
  const chunks: TtsChunk[] = [];
  for (const p of pieces) {
    const buf = await fetchGoogleTtsChunk(p.text);
    buffers.push(buf);
    chunks.push({ charStart: p.charStart, charEnd: p.charEnd, byteLen: buf.length });
  }

  const totalLen = buffers.reduce((acc, b) => acc + b.length, 0);
  const merged = new Uint8Array(totalLen);
  let off = 0;
  for (const b of buffers) {
    merged.set(b, off);
    off += b.length;
  }

  const audioBase64 = Buffer.from(merged).toString("base64");
  return { audioBase64, chunks };
}

export async function openAiLookup(text: string, context?: string) {
  if (!OPENAI_API_KEY) throw new Error("Missing OPENAI_API_KEY");

  const sys = `You are a Chinese language tutor. Given a Chinese character or short word/phrase, return strict JSON with these fields:
{
  "pinyin": "pinyin with proper tone marks (ā á ǎ à ē é ě è ī í ǐ ì ō ó ǒ ò ū ú ǔ ù ǖ ǘ ǚ ǜ); separate syllables with spaces; no numbers",
  "pos": "part of speech in English (e.g. noun, verb, adjective, particle, measure word, pronoun, conjunction)",
  "translation": "concise English translation (1-6 words)",
  "example_zh": "ONE simple, natural Chinese sentence (~6-12 chars) using the input",
  "example_en": "natural English translation of example_zh"
}
Use simplified Chinese. If the input has multiple common meanings, pick the most common one. Never include markdown or commentary, only JSON.`;

  const user = context
    ? `Word: ${text}\nContext sentence: ${context}`
    : `Word: ${text}`;

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${OPENAI_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: sys },
        { role: "user", content: user },
      ],
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`OpenAI error ${res.status}: ${errText}`);
  }

  const data = (await res.json()) as {
    choices: { message: { content: string } }[];
  };

  const content = data.choices?.[0]?.message?.content ?? "{}";
  return JSON.parse(content) as {
    pinyin: string;
    pos: string;
    translation: string;
    example_zh: string;
    example_en: string;
  };
}

export type SubtitleItem = {
  charStart: number;
  charEnd: number;
  zh: string;
  pinyin: string;
  en: string;
};

/**
 * Splits text into one piece per sentence, preserving character offsets into
 * the original text. Used for subtitle generation so each subtitle card covers
 * exactly one sentence rather than a whole paragraph.
 */
function chunkBySentence(text: string): Piece[] {
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

  // Trailing text without a terminator
  if (segStart < text.length) {
    const seg = text.slice(segStart).replace(/[\n\r]/g, "").trim();
    if (seg.length > 0) {
      out.push({ text: seg, charStart: segStart, charEnd: text.length });
    }
  }

  return out;
}

export async function openAiSubtitles(text: string): Promise<SubtitleItem[]> {
  if (!OPENAI_API_KEY) throw new Error("Missing OPENAI_API_KEY");

  const pieces = chunkBySentence(text);
  if (pieces.length === 0) return [];

  const segmentsJson = JSON.stringify(pieces.map((p, i) => ({ id: i + 1, text: p.text })));

  const sys = `You are a Chinese reading assistant. Given a JSON array of numbered Chinese text segments, return pinyin with proper tone marks and a concise English translation for each segment.

Return strict JSON with a single key "items" — one object per input segment, in the same order:
{
  "items": [
    { "id": 1, "pinyin": "...", "en": "..." },
    ...
  ]
}

Rules:
- id: same integer as the input segment
- pinyin: full reading of the segment with proper tone marks (ā á ǎ à ē é ě è ī í ǐ ì ō ó ǒ ò ū ú ǔ ù ǖ ǘ ǚ ǜ), syllables space-separated, no numbers
- en: natural English translation of the segment, 1–12 words
- Never skip a segment. Never include markdown or commentary, only JSON.`;

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${OPENAI_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature: 0.1,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: sys },
        { role: "user", content: `Segments:\n${segmentsJson}` },
      ],
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`OpenAI error ${res.status}: ${errText}`);
  }

  const data = (await res.json()) as {
    choices: { message: { content: string } }[];
  };
  const content = data.choices?.[0]?.message?.content ?? "{}";
  const parsed = JSON.parse(content) as {
    items?: { id: number; pinyin: string; en: string }[];
  };

  const gptItems = Array.isArray(parsed.items) ? parsed.items : [];

  return pieces.map((piece, i) => {
    const gpt = gptItems.find(g => g.id === i + 1);
    return {
      charStart: piece.charStart,
      charEnd: piece.charEnd,
      zh: piece.text,
      pinyin: gpt?.pinyin ?? "",
      en: gpt?.en ?? "",
    };
  });
}

export type VocabEntry = {
  zh: string;
  pinyin: string;
  pos: string;
  translation: string;
};

export async function openAiVocabBank(text: string): Promise<VocabEntry[]> {
  if (!OPENAI_API_KEY) throw new Error("Missing OPENAI_API_KEY");

  const sys = `You are an expert Chinese language teacher for a heritage speaker with intermediate-to-advanced fluency. Analyze the given Chinese text and extract the vocabulary items a learner should focus on.

Choose the number of entries based on the text itself, NOT a fixed count:
- A short sentence may yield only 2-4 entries
- A paragraph may yield 6-12
- A long passage may yield 15-25
- Skip the limit entirely if the text is rich; do not pad with trivial words (你, 我, 的, 是, 在 etc.) just to hit a target number
- Each entry must add learning value; do not include duplicates or simple function words a beginner already knows
- The generated bank should NOT be too simple: include any characters, words, or phrases from the text that are likely above ACTFL/OPI Intermediate-Mid Chinese level.
- If a multi-character word is advanced because of one difficult character, prefer the full word/phrase as it appears in context; include a single character only when it is independently meaningful or useful to learn.

Prioritize, in order:
1. Any characters/words/phrases likely NOT known by an OPI Intermediate-Mid Chinese learner
2. Recurring characters/words that carry meaning in this text
3. Key content words: nouns, verbs, adjectives
4. Common Chinese phrases, collocations, idioms, and literary/formal expressions actually present in the text
5. Items likely unfamiliar or interesting to intermediate-to-advanced learners

Return strict JSON with a single key "items" whose value is an array of entries, in the order they first appear in the text:
{
  "items": [
    { "zh": "...", "pinyin": "...", "pos": "...", "translation": "..." }
  ]
}

Field rules:
- zh: Chinese character(s) exactly as they appear in the text
- pinyin: with proper tone marks (ā á ǎ à ē é ě è ī í ǐ ì ō ó ǒ ò ū ú ǔ ù ǖ ǘ ǚ ǜ), syllables space-separated, no numbers
- pos: short part-of-speech tag in English (noun, verb, adjective, adverb, particle, conjunction, measure word, pronoun, idiom, phrase)
- translation: concise English meaning, 1-5 words

Never include markdown or commentary, only JSON.`;

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${OPENAI_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature: 0.3,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: sys },
        { role: "user", content: `Text:\n${text}` },
      ],
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`OpenAI error ${res.status}: ${errText}`);
  }

  const data = (await res.json()) as {
    choices: { message: { content: string } }[];
  };

  const content = data.choices?.[0]?.message?.content ?? "{}";
  const parsed = JSON.parse(content) as { items?: VocabEntry[] };
  const items = Array.isArray(parsed.items) ? parsed.items : [];
  return items.filter(
    e => e && typeof e.zh === "string" && typeof e.pinyin === "string" && typeof e.translation === "string",
  );
}
