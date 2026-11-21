import { config } from "../config.js";

/** Shared OpenRouter HTTP helper (one key for image generation, ElevenLabs voices, and later LLMs). */
export async function openrouterFetch(pathname, { method = "GET", body, timeoutMs = 180000, auth = true } = {}) {
  const { apiKey, baseUrl } = config.openrouter;
  if (auth && !apiKey) throw new Error("OpenRouter is not configured: set OPENROUTER_API_KEY");
  const res = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: {
      ...(auth ? { authorization: `Bearer ${apiKey}` } : {}),
      ...(body ? { "content-type": "application/json" } : {}),
      "x-title": "reel-factory",
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let msg = text;
    try {
      msg = JSON.parse(text).error?.message || text;
    } catch {}
    throw new Error(`OpenRouter ${pathname} failed: HTTP ${res.status} ${String(msg).slice(0, 300)}`.trim());
  }
  return res;
}
