import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const env = process.env;
const num = (v, d) => (v === undefined || v === "" ? d : Number(v));

export const config = {
  port: num(env.PORT, 3077),
  // Public base URL used to build video links returned to n8n (e.g. https://reels.example.com)
  publicBaseUrl: (env.PUBLIC_BASE_URL || `http://localhost:${num(env.PORT, 3077)}`).replace(/\/$/, ""),
  // If set, every API call (except /health and /files) must send `X-API-Key: <value>`
  apiKey: env.API_KEY || "",
  dataDir: path.resolve(ROOT, env.DATA_DIR || "data"),
  // Long-lived project files: AI image library (library/images) and published videos (library/videos)
  libraryDir: path.resolve(ROOT, env.LIBRARY_DIR || "library"),
  concurrency: num(env.RENDER_CONCURRENCY, 1),
  // Finished jobs and their files are deleted after this many hours (0 = keep forever)
  retentionHours: num(env.RETENTION_HOURS, 72),
  maxAssetBytes: num(env.MAX_ASSET_MB, 25) * 1024 * 1024,
  assetTimeoutMs: num(env.ASSET_TIMEOUT_MS, 30000),
  renderTimeoutMs: num(env.RENDER_TIMEOUT_MS, 30 * 60 * 1000),
  hyperframesBin: env.HYPERFRAMES_BIN || path.join(ROOT, "node_modules", ".bin", "hyperframes"),
  ffmpegBin: env.FFMPEG_BIN || "ffmpeg",
  ffprobeBin: env.FFPROBE_BIN || "ffprobe",
  openrouter: {
    apiKey: env.OPENROUTER_API_KEY || "",
    baseUrl: (env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1").replace(/\/$/, ""),
    imageModel: env.OPENROUTER_IMAGE_MODEL || "openai/gpt-image-1-mini",
    imageQuality: env.OPENROUTER_IMAGE_QUALITY || "medium",
    ttsModel: env.OPENROUTER_TTS_MODEL || "elevenlabs/eleven-multilingual-v2",
    ttsVoice: env.OPENROUTER_TTS_VOICE || "george",
  },
  images: {
    provider: env.IMAGE_PROVIDER || "openrouter",
    openaiApiKey: env.OPENAI_API_KEY || "",
    openaiModel: env.OPENAI_IMAGE_MODEL || "gpt-image-1-mini",
    openaiQuality: env.OPENAI_IMAGE_QUALITY || "medium", // low | medium | high
    concurrency: num(env.IMAGE_CONCURRENCY, 3),
  },
  tts: {
    defaultProvider: env.TTS_PROVIDER || "piper",
    piperBin: env.PIPER_BIN || path.join(ROOT, ".venv-piper", "bin", "piper"),
    piperModelsDir: path.resolve(ROOT, env.PIPER_MODELS_DIR || "models/piper"),
    piperDefaultVoice: env.PIPER_VOICE || "en_US-lessac-medium",
    elevenLabsApiKey: env.ELEVENLABS_API_KEY || "",
    elevenLabsDefaultVoice: env.ELEVENLABS_VOICE_ID || "",
    elevenLabsModel: env.ELEVENLABS_MODEL || "eleven_multilingual_v2",
  },
};
