import { z } from "zod";
import { listSfx, sfxPath } from "./lib/sfx.js";

const url = z.string().refine((v) => /^(https?:\/\/|data:)/.test(v), "must be an http(s) URL or data: URI");
const color = z.string().regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/, "must be a hex color like #22c55e");

/** Name of a sound effect in assets/sfx (null = no sound). */
const sfx = z
  .string()
  .nullable()
  .refine((n) => n === null || sfxPath(n) !== null, { error: () => `unknown sound effect; available: ${listSfx().join(", ")}` });

/** Brand identity shared by every template (watermark, CTA, colors). */
export const brandSchema = z
  .object({
    name: z.string().default("ReelFactory"),
    website: z.string().optional(), // e.g. "fluenthub.app" – shown in the watermark pill
    logo: url.optional(), // square logo; falls back to a colored circle with the initial
    primaryColor: color.default("#1f3b4d"),
    accentColor: color.default("#43a41a"),
    // Two-tone wordmark, e.g. ["Fluent", "Hub"] -> first part primary, second accent
    wordmark: z.array(z.string()).max(3).optional(),
  })
  .prefault({});

export const voiceSchema = z
  .object({
    provider: z.string().optional(), // "piper" | "elevenlabs"
    voice: z.string().optional(), // piper model name or ElevenLabs voice ID
    speed: z.number().min(0.5).max(2).default(1),
    // Playback tempo applied to the finished clip with ffmpeg (pitch is kept). For models without a native
    // speed setting, e.g. Eleven v4. Cached on top of the untouched clip, so changing it costs no new speech.
    tempo: z.number().min(0.8).max(1.5).default(1),
    options: z.record(z.string(), z.any()).prefault({}),
  })
  .prefault({});

/** The envelope every POST /render request uses; `data` is validated by the template. */
export const renderRequestSchema = z.object({
  template: z.string(),
  layout: z.string().optional(),
  brand: brandSchema,
  voice: voiceSchema,
  music: z.object({ url, volume: z.number().min(0).max(1).default(0.12) }).optional(),
  output: z
    .object({
      fps: z.union([z.literal(24), z.literal(30), z.literal(60)]).default(30),
      quality: z.enum(["draft", "standard", "high"]).default("standard"),
      // Published name: also store the video permanently as library/videos/<folder>/<name>.mp4
      name: z.string().max(120).regex(/^[\w.\- ]+$/, "letters, digits, spaces, dot, dash, underscore only").optional(),
      folder: z.string().max(60).regex(/^[\w\-]+$/, "letters, digits, dash, underscore only").optional(),
    })
    .prefault({}),
  data: z.record(z.string(), z.any()),
  callbackUrl: z.string().url().optional(),
  meta: z.any().optional(), // passed back untouched in job status and callback
});

export function formatZodError(err, prefix = "") {
  return err.issues.map((i) => `${prefix}${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
}

export { z, url, color, sfx };
