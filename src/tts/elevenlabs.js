import fs from "node:fs/promises";
import { config } from "../config.js";

/**
 * ElevenLabs TTS. Needs ELEVENLABS_API_KEY. `voice` is an ElevenLabs voice ID.
 * options: { model, stability, similarity_boost, style, use_speaker_boost, timestamps }
 *
 * By default the request goes to the `with-timestamps` endpoint, which also returns when each character is
 * spoken. That is handed back as `alignment` ({ chars, starts, ends }, seconds) so templates can switch captions
 * exactly on the words. `timestamps: false` uses the plain endpoint (no alignment).
 */
export default {
  ext: ".mp3",
  // Part of the TTS cache key: clips cached before alignment existed are generated again
  cacheTag: ({ options = {} }) => (options.timestamps === false ? "plain" : "ts1"),
  async synthesize({ text, voice, speed, options, outFile }) {
    const apiKey = config.tts.elevenLabsApiKey;
    if (!apiKey) throw new Error("ElevenLabs is not configured: set ELEVENLABS_API_KEY");
    const voiceId = voice || config.tts.elevenLabsDefaultVoice;
    if (!voiceId) throw new Error("ElevenLabs needs a voice ID (voice.voice in the request or ELEVENLABS_VOICE_ID)");

    const { model, timestamps = true, ...voiceSettings } = options;
    const res = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}${timestamps ? "/with-timestamps" : ""}?output_format=mp3_44100_128`,
      {
        method: "POST",
        headers: { "xi-api-key": apiKey, "content-type": "application/json", accept: timestamps ? "application/json" : "audio/mpeg" },
        body: JSON.stringify({
          text,
          model_id: model || config.tts.elevenLabsModel,
          voice_settings: { speed: speed || 1, ...voiceSettings },
        }),
      },
    );
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`ElevenLabs TTS failed: HTTP ${res.status} ${detail.slice(0, 300)}`);
    }
    if (!timestamps) {
      await fs.writeFile(outFile, Buffer.from(await res.arrayBuffer()));
      return {};
    }
    const body = await res.json();
    if (!body.audio_base64) throw new Error("ElevenLabs returned no audio");
    await fs.writeFile(outFile, Buffer.from(body.audio_base64, "base64"));
    const a = body.alignment;
    return a ? { alignment: { chars: a.characters, starts: a.character_start_times_seconds, ends: a.character_end_times_seconds } } : {};
  },
};
