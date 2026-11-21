import fs from "node:fs/promises";
import path from "node:path";
import { config } from "./config.js";
import { renderRequestSchema, formatZodError } from "./schemas.js";
import { getTemplate } from "./templates/registry.js";
import { downloadAsset } from "./lib/assets.js";
import { mixTrack } from "./lib/audio.js";
import { run } from "./lib/exec.js";
import { speak } from "./tts/index.js";
import { listSfx, sfxPath } from "./lib/sfx.js";
import { ensureImage, imagePath } from "./images/library.js";

export class ValidationError extends Error {}

function sfxFile(name) {
  const file = sfxPath(name);
  if (!file) throw new ValidationError(`Unknown sound effect "${name}". Available: ${listSfx().join(", ")}`);
  return file;
}

/** Validate a render request (envelope + template-specific data). Throws ValidationError. */
export function validateRequest(body) {
  const env = renderRequestSchema.safeParse(body);
  if (!env.success) throw new ValidationError(formatZodError(env.error));
  const req = env.data;
  const template = getTemplate(req.template);
  if (!template) throw new ValidationError(`Unknown template "${req.template}"`);
  const layoutId = req.layout || template.defaultLayout;
  if (!template.layouts[layoutId]) {
    throw new ValidationError(`Unknown layout "${layoutId}" for ${template.id}. Available: ${Object.keys(template.layouts).join(", ")}`);
  }
  const data = template.schema.safeParse(req.data);
  if (!data.success) throw new ValidationError(formatZodError(data.error, "data."));
  return { ...req, layout: layoutId, data: data.data, templateDef: template };
}

/** Run `fn` over items with at most `limit` in flight. */
async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

/**
 * Render one validated request into `outDir` (video.mp4 + thumbnail.jpg).
 * `workDir` holds the generated HyperFrames project (kept for debugging when keepWork is true).
 */
export async function renderJob(req, { workDir, outDir, onStage = () => {}, keepWork = false }) {
  const template = req.templateDef;
  const layout = template.layouts[req.layout];
  const project = path.join(workDir, "project");
  const assetsDir = path.join(project, "assets");
  await fs.rm(project, { recursive: true, force: true });
  await fs.mkdir(assetsDir, { recursive: true });
  await fs.mkdir(outDir, { recursive: true });

  const ctx = { brand: req.brand, layout, layoutId: req.layout };
  const needs = template.collect(req.data, ctx);

  // Assets are either URLs (downloaded) or { library: {key, subject?, prompt?, style?} } (image library,
  // generated with AI on a miss). Library images are resolved first so generation can run in parallel.
  onStage("images");
  const cache = new Map();
  const assetEntries = Object.entries(needs.assets || {});
  const libraryEntries = assetEntries.filter(([, v]) => typeof v === "object" && v?.library);
  const imagesUsed = { reused: [], generated: [] };
  const libraryNames = await pool(libraryEntries, config.images.concurrency, async ([key, v]) => {
    const img = await ensureImage(v.library);
    (img.reused ? imagesUsed.reused : imagesUsed.generated).push(img.key);
    const name = `${key}-${path.basename(img.file)}`;
    await fs.copyFile(imagePath(img), path.join(assetsDir, name));
    return name;
  });

  onStage("downloading");
  const urlEntries = assetEntries.filter(([, v]) => typeof v === "string");
  const urlNames = await pool(urlEntries, 6, ([key, url]) => downloadAsset(url, assetsDir, { kind: key, cache }));
  const assets = Object.fromEntries([
    ...libraryEntries.map(([key], i) => [key, `assets/${libraryNames[i]}`]),
    ...urlEntries.map(([key], i) => [key, `assets/${urlNames[i]}`]),
  ]);

  onStage("voice");
  const speechEntries = Object.entries(needs.speech || {});
  const voiced = await pool(speechEntries, 2, ([, text]) => speak(text, req.voice));
  const speech = Object.fromEntries(speechEntries.map(([key], i) => [key, voiced[i]]));

  onStage("composing");
  const built = template.build({ data: req.data, layout, layoutId: req.layout, brand: req.brand, assets, speech });
  for (const f of built.files || []) {
    const dest = path.join(project, f.to);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.copyFile(f.from, dest);
  }
  await fs.writeFile(path.join(project, "index.html"), built.html);

  const events = (built.audio || []).map((ev) => {
    if (ev.speech) {
      if (!speech[ev.speech]) throw new Error(`Template referenced unknown speech line "${ev.speech}"`);
      return { file: speech[ev.speech].file, at: ev.at, volume: ev.volume };
    }
    return { file: sfxFile(ev.sfx), at: ev.at, volume: ev.volume };
  });
  let music = null;
  if (req.music) {
    const name = await downloadAsset(req.music.url, assetsDir, { kind: "music", cache });
    music = { file: path.join(assetsDir, name), volume: req.music.volume };
  }
  await mixTrack({ events, music, duration: built.duration, outFile: path.join(assetsDir, "soundtrack.wav") });

  onStage("rendering");
  const videoFile = path.join(outDir, "video.mp4");
  const started = Date.now();
  await run(
    config.hyperframesBin,
    ["render", project, "--output", videoFile, "--fps", String(req.output.fps), "--quality", req.output.quality, "--quiet"],
    { cwd: project, timeoutMs: config.renderTimeoutMs, env: { HYPERFRAMES_NO_TELEMETRY: "1", DO_NOT_TRACK: "1" } },
  );
  const renderSeconds = (Date.now() - started) / 1000;

  onStage("thumbnail");
  const thumbFile = path.join(outDir, "thumbnail.jpg");
  await run(config.ffmpegBin, [
    "-y", "-v", "error", "-ss", String(built.thumbnailAt ?? 1), "-i", videoFile, "-frames:v", "1", "-q:v", "3", thumbFile,
  ]);

  let published;
  if (req.output.name) {
    const base = req.output.name.trim().replace(/\s+/g, "-");
    const rel = path.posix.join("videos", req.output.folder || "", base);
    const dest = path.join(config.libraryDir, rel);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.copyFile(videoFile, `${dest}.mp4`);
    await fs.copyFile(thumbFile, `${dest}.jpg`);
    published = { video: `${rel}.mp4`, thumbnail: `${rel}.jpg` };
  }

  if (!keepWork) await fs.rm(project, { recursive: true, force: true });
  return {
    duration: built.duration,
    renderSeconds,
    images: imagesUsed,
    published,
    files: { video: "video.mp4", thumbnail: "thumbnail.jpg" },
  };
}
