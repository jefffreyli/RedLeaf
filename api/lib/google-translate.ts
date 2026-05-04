// Google Translate's web endpoint returns both the English translation
// (dt=t) and pinyin romanization (dt=rm) in a single sub-second request,
// which is dramatically faster than asking GPT to do the same.
//
// Response format: result[0] is an array of items.
//   • Translation items:    [en_chunk, zh_chunk, null, null, type, ...]
//   • Romanization item:    [null, null, null, pinyin_string]
// We accumulate the english from index 0 and the pinyin from index 3.

const USER_AGENT =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

export type TranslateResult = { translation: string; pinyin: string };

export async function googleTranslate(
    text: string,
    signal?: AbortSignal,
): Promise<TranslateResult> {
    const url = new URL("https://translate.googleapis.com/translate_a/single");
    url.searchParams.set("client", "gtx");
    url.searchParams.set("sl", "zh-CN");
    url.searchParams.set("tl", "en");
    url.searchParams.append("dt", "t");
    url.searchParams.append("dt", "rm");
    url.searchParams.set("q", text);

    const res = await fetch(url, {
        headers: {
            "user-agent": USER_AGENT,
            accept: "application/json, text/plain, */*",
            "accept-language": "en-US,en;q=0.9",
        },
        signal,
    });

    if (!res.ok) {
        throw new Error(`Google Translate error ${res.status}`);
    }

    const data = (await res.json()) as unknown[];
    const items = (Array.isArray(data) && Array.isArray(data[0]) ? data[0] : []) as unknown[][];

    let translation = "";
    let pinyin = "";
    for (const item of items) {
        if (!Array.isArray(item)) continue;
        const en = item[0];
        const rom = item[3];
        if (typeof en === "string" && en) {
            translation += en;
        } else if (typeof rom === "string" && rom) {
            // Multiple romanization chunks for long input — concat them
            pinyin += (pinyin ? " " : "") + rom;
        }
    }

    return { translation: translation.trim(), pinyin: pinyin.trim() };
}

/**
 * Run async tasks with a bounded concurrency. A worker pool pulls the next
 * index until the queue is exhausted; failures are swallowed (returns null).
 */
export async function mapWithConcurrency<T, R>(
    items: T[],
    concurrency: number,
    fn: (item: T, index: number) => Promise<R>,
): Promise<(R | null)[]> {
    const results: (R | null)[] = new Array(items.length).fill(null);
    let next = 0;
    const workerCount = Math.min(concurrency, items.length);
    const workers = Array.from({ length: workerCount }, async () => {
        while (true) {
            const idx = next++;
            if (idx >= items.length) return;
            try {
                results[idx] = await fn(items[idx]!, idx);
            } catch (err) {
                console.error(`task ${idx} failed:`, err);
                results[idx] = null;
            }
        }
    });
    await Promise.all(workers);
    return results;
}
