import { SUBTITLES_SYSTEM_PROMPT } from "../_prompts.js";

export type SubtitleBatchInput = { id: number; text: string };
export type SubtitleBatchOutput = { id: number; pinyin: string; en: string };

// Long passages can't fit all sentence translations in a single GPT response
// (JSON gets truncated → parse fails → no subtitles arrive).
// Use this batch size to split requests and run them in parallel.
export const SUBTITLE_BATCH_SIZE = 10;

export async function fetchSubtitleBatch(
  batch: SubtitleBatchInput[],
  apiKey: string,
): Promise<SubtitleBatchOutput[]> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature: 0.1,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SUBTITLES_SYSTEM_PROMPT },
        { role: "user", content: `Segments:\n${JSON.stringify(batch)}` },
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
  let parsed: { items?: SubtitleBatchOutput[] };
  try {
    parsed = JSON.parse(content) as { items?: SubtitleBatchOutput[] };
  } catch {
    return [];
  }
  return Array.isArray(parsed.items) ? parsed.items : [];
}
