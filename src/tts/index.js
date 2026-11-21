import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { config } from "../config.js";
import { probeDuration, run } from "../lib/exec.js";
import piper from "./piper.js";
import elevenlabs from "./elevenlabs.js";
import openrouter from "./openrouter.js";

/**
 * TTS providers share one interface:
 *   synthesize({ text, voice, speed, options, outFile }) -> writes an audio file at outFile; may return
 *     { alignment: { chars, starts, ends } } (when each character is spoken, seconds), cached next to the clip
 *   ext: file extension the provider writes
 *   cacheTag(voiceCfg)?: extra cache-key text (e.g. the model) so config changes re-generate speech
 * Add a provider by creating src/tts/<name>.js and registering it here.
 */
const providers = { piper, openrouter, elevenlabs };

export function listProviders() {
  return Object.keys(providers);
}

/**
 * Synthesize one line of speech, cached on disk by (provider, voice, speed, options, text).
 * @returns {Promise<{ file: string, duration: number, alignment: ({chars, starts, ends}|null) }>} absolute file path + seconds
 *   (+ per-character timing when the provider gives it, already adjusted for `tempo`)
 */
export async function speak(text, voiceCfg = {}) {
  const providerName = voiceCfg.provider || config.tts.defaultProvider;
  const provider = providers[providerName];
  if (!provider) throw new Error(`Unknown TTS provider "${providerName}". Available: ${listProviders().join(", ")}`);

  const keyMaterial = JSON.stringify([
    providerName, voiceCfg.voice || "", voiceCfg.speed || 1, voiceCfg.options || {}, text, provider.cacheTag?.(voiceCfg) ?? "",
  ]);
  const key = crypto.createHash("sha256").update(keyMaterial).digest("hex").slice(0, 24);
  const cacheDir = path.join(config.dataDir, "tts-cache", providerName);
  await fs.mkdir(cacheDir, { recursive: true });
  const outFile = path.join(cacheDir, `${key}${provider.ext}`);

  const alignFile = `${outFile}.align.json`;
  try {
    await fs.access(outFile);
  } catch {
    const tmp = `${outFile}.${process.pid}.tmp${provider.ext}`;
    const out = (await provider.synthesize({ text, voice: voiceCfg.voice, speed: voiceCfg.speed || 1, options: voiceCfg.options || {}, outFile: tmp })) || {};
    if (out.alignment) await fs.writeFile(alignFile, JSON.stringify(out.alignment));
    await fs.rename(tmp, outFile);
  }
  let alignment = null;
  try {
    alignment = JSON.parse(await fs.readFile(alignFile, "utf8"));
  } catch {}
  const tempo = voiceCfg.tempo || 1;
  if (tempo === 1) return { file: outFile, duration: await probeDuration(outFile), alignment };
  // the clip plays `tempo` times faster, so every time in the alignment shrinks by the same factor
  if (alignment) alignment = { ...alignment, starts: alignment.starts.map((s) => s / tempo), ends: alignment.ends.map((s) => s / tempo) };

  // Faster or slower copy of the cached clip (pitch-preserving), cached next to it
  const fast = outFile.replace(/(\.[a-z0-9]+)$/, `.x${tempo}$1`);
  try {
    await fs.access(fast);
  } catch {
    const tmp = `${fast}.${process.pid}.tmp${provider.ext}`;
    await run(config.ffmpegBin, ["-y", "-v", "error", "-i", outFile, "-filter:a", `atempo=${tempo}`, tmp]);
    await fs.rename(tmp, fast);
  }
  return { file: fast, duration: await probeDuration(fast), alignment };
}
