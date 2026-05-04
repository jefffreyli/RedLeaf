import { LOOKUP_SYSTEM_PROMPT, VOCAB_SYSTEM_PROMPT } from "./_prompts.js";
import { chunkTextWithOffsets, chunkBySentence } from "./lib/chunking.js";
import { fetchGoogleTtsChunk } from "./lib/google-tts.js";
import {
    fetchSubtitleBatch,
    SUBTITLE_BATCH_SIZE,
    type SubtitleBatchInput,
    type SubtitleBatchOutput,
} from "./lib/openai.js";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// ─── TTS ─────────────────────────────────────────────────────────────────────

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
        chunks.push({
            charStart: p.charStart,
            charEnd: p.charEnd,
            byteLen: buf.length,
        });
    }

    const totalLen = buffers.reduce((acc, b) => acc + b.length, 0);
    const merged = new Uint8Array(totalLen);
    let off = 0;
    for (const b of buffers) {
        merged.set(b, off);
        off += b.length;
    }

    return { audioBase64: Buffer.from(merged).toString("base64"), chunks };
}

// ─── Lookup ──────────────────────────────────────────────────────────────────

export async function openAiLookup(text: string, context?: string) {
    if (!OPENAI_API_KEY) throw new Error("Missing OPENAI_API_KEY");

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
                { role: "system", content: LOOKUP_SYSTEM_PROMPT },
                { role: "user", content: user },
            ],
        }),
    });

    if (!res.ok)
        throw new Error(`OpenAI error ${res.status}: ${await res.text()}`);

    const data = (await res.json()) as {
        choices: { message: { content: string } }[];
    };
    return JSON.parse(data.choices?.[0]?.message?.content ?? "{}") as {
        pinyin: string;
        pos: string;
        translation: string;
        example_zh: string;
        example_en: string;
    };
}

// ─── Subtitles ───────────────────────────────────────────────────────────────

export type SubtitleItem = {
    charStart: number;
    charEnd: number;
    zh: string;
    pinyin: string;
    en: string;
};

export async function openAiSubtitles(text: string): Promise<SubtitleItem[]> {
    if (!OPENAI_API_KEY) throw new Error("Missing OPENAI_API_KEY");

    const pieces = chunkBySentence(text);
    if (pieces.length === 0) return [];

    const numbered: SubtitleBatchInput[] = pieces.map((p, i) => ({
        id: i + 1,
        text: p.text,
    }));

    const batches: SubtitleBatchInput[][] = [];
    for (let i = 0; i < numbered.length; i += SUBTITLE_BATCH_SIZE) {
        batches.push(numbered.slice(i, i + SUBTITLE_BATCH_SIZE));
    }

    const settled = await Promise.allSettled(
        batches.map((batch) => fetchSubtitleBatch(batch, OPENAI_API_KEY!)),
    );
    const allItems: SubtitleBatchOutput[] = [];
    for (const result of settled) {
        if (result.status === "fulfilled") allItems.push(...result.value);
        else console.error("subtitle batch failed:", result.reason);
    }

    const byId = new Map<number, SubtitleBatchOutput>();
    for (const item of allItems) byId.set(item.id, item);

    return pieces.map((piece, i) => {
        const gpt = byId.get(i + 1);
        return {
            charStart: piece.charStart,
            charEnd: piece.charEnd,
            zh: piece.text,
            pinyin: gpt?.pinyin ?? "",
            en: gpt?.en ?? "",
        };
    });
}

// ─── Vocab bank ───────────────────────────────────────────────────────────────

export type VocabEntry = {
    zh: string;
    pinyin: string;
    pos: string;
    translation: string;
};

export async function openAiVocabBank(text: string): Promise<VocabEntry[]> {
    if (!OPENAI_API_KEY) throw new Error("Missing OPENAI_API_KEY");

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
                { role: "system", content: VOCAB_SYSTEM_PROMPT },
                { role: "user", content: `Text:\n${text}` },
            ],
        }),
    });

    if (!res.ok)
        throw new Error(`OpenAI error ${res.status}: ${await res.text()}`);

    const data = (await res.json()) as {
        choices: { message: { content: string } }[];
    };
    const parsed = JSON.parse(data.choices?.[0]?.message?.content ?? "{}") as {
        items?: VocabEntry[];
    };
    const items = Array.isArray(parsed.items) ? parsed.items : [];
    return items.filter(
        (e) =>
            e &&
            typeof e.zh === "string" &&
            typeof e.pinyin === "string" &&
            typeof e.translation === "string",
    );
}
