import fs from "node:fs/promises";
import { config } from "../config.js";
import { openrouterFetch } from "../lib/openrouter.js";

/**
 * Image generation through OpenRouter's Images API (POST /images). Default model openai/gpt-image-1-mini
 * (supports transparent backgrounds). Only parameters the chosen model supports are sent, so any
 * image model from GET /images/models works by changing OPENROUTER_IMAGE_MODEL.
 */

let modelParams = null; // { [modelId]: supported_parameters }
async function supportedParams(model) {
  if (!modelParams) {
    const res = await openrouterFetch("/images/models", { auth: false, timeoutMs: 20000 });
    const body = await res.json();
    modelParams = Object.fromEntries((body.data || body).map((m) => [m.id, m.supported_parameters || {}]));
  }
  if (!modelParams[model]) throw new Error(`OpenRouter has no image model "${model}" (see GET /api/v1/images/models)`);
  return modelParams[model];
}

const allows = (spec, value) => !spec || !spec.values || spec.values.includes(value);
const EXT = { "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp", "image/svg+xml": ".svg" };

export default {
  ext: ".png",
  describe: () => `${config.openrouter.imageModel} via OpenRouter (${config.openrouter.imageQuality})`,
  async generate({ prompt, transparent = true, outFile }) {
    const model = config.openrouter.imageModel;
    const params = await supportedParams(model);
    const body = { model, prompt, n: 1 };
    if (params.aspect_ratio && allows(params.aspect_ratio, "1:1")) body.aspect_ratio = "1:1";
    if (params.quality && allows(params.quality, config.openrouter.imageQuality)) body.quality = config.openrouter.imageQuality;
    if (params.background) {
      if (transparent && allows(params.background, "transparent")) body.background = "transparent";
      else if (allows(params.background, "opaque")) body.background = "opaque";
    }
    if (params.output_format && allows(params.output_format, "png")) body.output_format = "png";

    const res = await openrouterFetch("/images", { method: "POST", body });
    const json = await res.json();
    const img = json.data?.[0];
    if (!img?.b64_json) throw new Error("OpenRouter image generation returned no image");
    await fs.writeFile(outFile, Buffer.from(img.b64_json, "base64"));
    return { ext: EXT[img.media_type] || ".png", cost: json.usage?.cost };
  },
};
