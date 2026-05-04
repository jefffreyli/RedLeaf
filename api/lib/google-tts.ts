const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

export async function fetchGoogleTtsChunk(chunk: string): Promise<Uint8Array> {
  const url = new URL("https://translate.google.com/translate_tts");
  url.searchParams.set("ie", "UTF-8");
  url.searchParams.set("tl", "zh-CN");
  url.searchParams.set("client", "tw-ob");
  url.searchParams.set("q", chunk);

  const res = await fetch(url, {
    headers: {
      "user-agent": USER_AGENT,
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
