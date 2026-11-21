import fs from "node:fs/promises";
import { config } from "../config.js";
import { openrouterFetch } from "../lib/openrouter.js";
import { run } from "../lib/exec.js";

/**
 * ElevenLabs voices through OpenRouter (POST /audio/speech).
 * voice: a premade voice name ("george", "rachel", ...) or any ElevenLabs voice-library ID
 *        (your own cloned voices need your ElevenLabs key added to OpenRouter as BYOK).
 * options: { model, stability, similarity_boost, style, use_speaker_boost, seed, language_code }
 * speed != 1 is only supported by eleven-multilingual-v2 and the flash models.
 */
const SETTINGS = ["stability", "similarity_boost", "style", "use_speaker_boost"];
const PASSTHROUGH = ["seed", "language_code", "apply_text_normalization"];

const modelOf = (options) => options.model || config.openrouter.ttsModel;

export default {
  ext: ".mp3",
  // Part of the TTS cache key, so changing the default model re-generates speech
  cacheTag: ({ options = {} }) => modelOf(options),
  async synthesize({ text, voice, speed, options, outFile }) {
    const model = modelOf(options);
    const voiceSettings = Object.fromEntries(SETTINGS.filter((k) => options[k] !== undefined).map((k) => [k, options[k]]));
    if (speed && speed !== 1) {
      if (!/multilingual-v2|flash/.test(model)) {
        throw new Error(`Voice speed is not supported by ${model}; use elevenlabs/eleven-multilingual-v2 or a flash model, or speed 1`);
      }
      voiceSettings.speed = Math.min(1.2, Math.max(0.7, speed));
    }
    const elevenlabs = Object.fromEntries(PASSTHROUGH.filter((k) => options[k] !== undefined).map((k) => [k, options[k]]));
    if (Object.keys(voiceSettings).length) elevenlabs.voice_settings = voiceSettings;

    // Gemini TTS answers only with raw PCM (16-bit, mono, 24 kHz); it is turned into mp3 here.
    const pcm = /^google\//.test(model);
    const res = await openrouterFetch("/audio/speech", {
      method: "POST",
      timeoutMs: 120000,
      body: {
        model,
        input: text,
        voice: voice || config.openrouter.ttsVoice,
        response_format: pcm ? "pcm" : "mp3",
        ...(Object.keys(elevenlabs).length ? { provider: { options: { elevenlabs } } } : {}),
      },
    });
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 100) throw new Error("OpenRouter speech returned no audio");
    if (!pcm) return fs.writeFile(outFile, buf);
    const rate = Number((res.headers.get("content-type") || "").match(/rate=(\d+)/)?.[1]) || 24000;
    const raw = `${outFile}.pcm`;
    await fs.writeFile(raw, buf);
    try {
      await run("ffmpeg", ["-v", "error", "-y", "-f", "s16le", "-ar", String(rate), "-ac", "1", "-i", raw, "-b:a", "160k", outFile]);
    } finally {
      await fs.rm(raw, { force: true });
    }
  },
};
