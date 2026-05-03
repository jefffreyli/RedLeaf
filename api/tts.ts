import type { VercelRequest, VercelResponse } from "@vercel/node";
import { googleTranslateTts } from "./_routes";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }
  try {
    const body = req.body as { text?: string };
    if (!body?.text || typeof body.text !== "string") {
      return res.status(400).json({ error: "Missing 'text' string" });
    }
    const result = await googleTranslateTts(body.text);
    return res.status(200).json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("/api/tts error:", message);
    return res.status(500).json({ error: message });
  }
}
