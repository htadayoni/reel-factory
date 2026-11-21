import fs from "node:fs/promises";
import { config } from "../config.js";

/** OpenAI image generation (gpt-image-1-mini). Needs OPENAI_API_KEY. Writes a PNG to outFile. */
export default {
  ext: ".png",
  describe: () => `${config.images.openaiModel} (${config.images.openaiQuality})`,
  async generate({ prompt, transparent = true, outFile }) {
    const apiKey = config.images.openaiApiKey;
    if (!apiKey) throw new Error("Image generation is not configured: set OPENAI_API_KEY");
    const res = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: config.images.openaiModel,
        prompt,
        size: "1024x1024",
        quality: config.images.openaiQuality,
        background: transparent ? "transparent" : "opaque",
        output_format: "png",
        n: 1,
      }),
      signal: AbortSignal.timeout(180000),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`OpenAI image generation failed: HTTP ${res.status} ${body.error?.message || ""}`.trim());
    const b64 = body.data?.[0]?.b64_json;
    if (!b64) throw new Error("OpenAI image generation returned no image");
    await fs.writeFile(outFile, Buffer.from(b64, "base64"));
  },
};
