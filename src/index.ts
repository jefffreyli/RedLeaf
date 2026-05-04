import { serve } from "bun";
import index from "./index.html";
import {
    googleTranslateTts,
    openAiLookup,
    openAiVocabBank,
    openAiSubtitles,
} from "../api/_routes";

type TtsRequest = { text: string };
type LookupRequest = { text: string; context?: string };
type VocabRequest = { text: string };
type SubtitlesRequest = { text: string };

const server = serve({
    routes: {
        "/*": index,

        "/api/tts": {
            async POST(req) {
                try {
                    const body = (await req.json()) as TtsRequest;
                    if (!body?.text || typeof body.text !== "string") {
                        return Response.json(
                            { error: "Missing 'text' string" },
                            { status: 400 },
                        );
                    }
                    const result = await googleTranslateTts(body.text);
                    return Response.json(result);
                } catch (err) {
                    const message =
                        err instanceof Error ? err.message : String(err);
                    console.error("/api/tts error:", message);
                    return Response.json({ error: message }, { status: 500 });
                }
            },
        },

        "/api/lookup": {
            async POST(req) {
                try {
                    const body = (await req.json()) as LookupRequest;
                    if (!body?.text || typeof body.text !== "string") {
                        return Response.json(
                            { error: "Missing 'text' string" },
                            { status: 400 },
                        );
                    }
                    const result = await openAiLookup(body.text, body.context);
                    return Response.json(result);
                } catch (err) {
                    const message =
                        err instanceof Error ? err.message : String(err);
                    console.error("/api/lookup error:", message);
                    return Response.json({ error: message }, { status: 500 });
                }
            },
        },

        "/api/vocab": {
            async POST(req) {
                try {
                    const body = (await req.json()) as VocabRequest;
                    if (!body?.text || typeof body.text !== "string") {
                        return Response.json(
                            { error: "Missing 'text' string" },
                            { status: 400 },
                        );
                    }
                    const items = await openAiVocabBank(body.text);
                    return Response.json({ items });
                } catch (err) {
                    const message =
                        err instanceof Error ? err.message : String(err);
                    console.error("/api/vocab error:", message);
                    return Response.json({ error: message }, { status: 500 });
                }
            },
        },

        "/api/subtitles": {
            async POST(req) {
                try {
                    const body = (await req.json()) as SubtitlesRequest;
                    if (!body?.text || typeof body.text !== "string") {
                        return Response.json(
                            { error: "Missing 'text' string" },
                            { status: 400 },
                        );
                    }
                    const items = await openAiSubtitles(body.text);
                    return Response.json({ items });
                } catch (err) {
                    const message =
                        err instanceof Error ? err.message : String(err);
                    console.error("/api/subtitles error:", message);
                    return Response.json({ error: message }, { status: 500 });
                }
            },
        },
    },

    development: process.env.NODE_ENV !== "production" && {
        hmr: true,
        console: true,
    },
});

console.log(`Server running at ${server.url}`);
