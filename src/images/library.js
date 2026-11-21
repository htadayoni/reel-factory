import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { config } from "../config.js";
import { downloadAsset } from "../lib/assets.js";
import openai from "./openai.js";
import openrouter from "./openrouter.js";

/**
 * Image library: generated (or imported) images stored under library/images/<style>/<key>.<ext>,
 * indexed in library/images/index.json. A key is language-neutral ("alarm-clock"), so every
 * language and every video reuses the same picture; an image is only generated on a miss.
 */

const providers = { openrouter, openai };

/** Visual styles. A style turns a subject into a prompt; the same key can exist once per style. */
export const styles = {
  "object-white": {
    label: "Single object, studio product photo, transparent background",
    transparent: true,
    prompt: (subject) =>
      `A single ${subject}, realistic studio product photograph, centered, the whole object visible with some margin, ` +
      `soft natural lighting, subtle contact shadow, isolated on a transparent background. ` +
      `No text, no letters, no logos, no watermark, no people, no hands.`,
  },
};

/**
 * A style is a built-in id ("object-white") or a custom one sent with the request, so each service brings its own look:
 *   { id: "paper-cut", prompt: "… {subject} …", transparent?: false, label?: "…" }
 * `{subject}` is replaced by what the image should show. The id is namespaced with a short hash of the prompt, so two
 * services (or two versions of one look) never share pictures: change the prompt and the images are generated anew.
 */
export function resolveStyle(style = "object-white") {
  if (typeof style === "string") {
    const st = styles[style];
    if (!st) throw new Error(`Unknown image style "${style}". Built-in: ${Object.keys(styles).join(", ")}; or send { id, prompt } with the request`);
    return { id: style, ...st };
  }
  const { id: raw, prompt, transparent = false, label } = style;
  if (!/^[a-z0-9-]{1,40}$/.test(raw || "")) throw new Error("A custom image style needs an id of lowercase letters, digits and dashes (max 40)");
  if (typeof prompt !== "string" || !prompt.includes("{subject}")) throw new Error(`Image style "${raw}": prompt must contain {subject}`);
  const hash = crypto.createHash("sha1").update(`${prompt}\n${transparent}`).digest("hex").slice(0, 6);
  return { id: `${raw}-${hash}`, label: label || raw, transparent, prompt: (subject) => prompt.replaceAll("{subject}", subject) };
}

const DIR = () => path.join(config.libraryDir, "images");
const INDEX = () => path.join(DIR(), "index.json");
let index = null;
const inflight = new Map();

export function slugKey(s) {
  return String(s)
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

async function loadIndex() {
  if (index) return index;
  try {
    index = JSON.parse(await fs.readFile(INDEX(), "utf8"));
  } catch {
    index = { images: {} };
  }
  return index;
}

let saving = Promise.resolve();
function saveIndex() {
  saving = saving.then(async () => {
    await fs.mkdir(DIR(), { recursive: true });
    const tmp = `${INDEX()}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(index, null, 2));
    await fs.rename(tmp, INDEX());
  });
  return saving;
}

const id = (style, key) => `${style}/${key}`;

/** Public view of an entry (file path relative to library/images). */
function view(entry) {
  return entry && { ...entry, url: `${config.publicBaseUrl}/library/images/${entry.file}` };
}

export async function listImages() {
  const idx = await loadIndex();
  return Object.values(idx.images).map(view).sort((a, b) => a.id.localeCompare(b.id));
}

export async function getImage(key, style = "object-white") {
  const idx = await loadIndex();
  const entry = idx.images[id(resolveStyle(style).id, slugKey(key))];
  if (entry && fsSync.existsSync(path.join(DIR(), entry.file))) return view(entry);
  return null;
}

export function imagePath(entry) {
  return path.join(DIR(), entry.file);
}

/**
 * Return the library image for `key`, generating it when missing (or when force is true).
 * `subject` is what the AI draws (defaults to the key with dashes as spaces); `prompt` overrides the whole prompt.
 * `url` imports an existing image under that key instead of generating one.
 */
export async function ensureImage({ key, style: styleIn = "object-white", subject, prompt, url, force = false }) {
  const st = resolveStyle(styleIn);
  const style = st.id;
  const k = slugKey(key);
  if (!k) throw new Error("Image key is empty");
  const entryId = id(style, k);
  if (!force && !url) {
    const existing = await getImage(k, styleIn);
    if (existing) return { ...existing, reused: true };
  }
  if (inflight.has(entryId)) return inflight.get(entryId);

  const work = (async () => {
    const dir = path.join(DIR(), style);
    await fs.mkdir(dir, { recursive: true });
    let entry;
    if (url) {
      const name = await downloadAsset(url, dir, { kind: k });
      const file = `${k}${path.extname(name)}`;
      await fs.rename(path.join(dir, name), path.join(dir, file));
      entry = { id: entryId, key: k, style, file: `${style}/${file}`, source: "import", sourceUrl: url };
    } else {
      const providerName = config.images.provider;
      const provider = providers[providerName];
      if (!provider) throw new Error(`Unknown image provider "${providerName}"`);
      const finalPrompt = prompt || st.prompt(subject || k.replace(/-/g, " "));
      const tmp = path.join(dir, `.${k}.${process.pid}.tmp`);
      const out = (await provider.generate({ prompt: finalPrompt, transparent: st.transparent, outFile: tmp })) || {};
      const file = `${k}${out.ext || provider.ext}`;
      await fs.rename(tmp, path.join(dir, file));
      entry = { id: entryId, key: k, style, file: `${style}/${file}`, source: providerName, model: provider.describe(), prompt: finalPrompt };
      if (out.cost !== undefined) entry.cost = out.cost;
    }
    entry.createdAt = new Date().toISOString();
    const idx = await loadIndex();
    const prev = idx.images[entryId];
    if (prev && prev.file !== entry.file) await fs.rm(path.join(DIR(), prev.file), { force: true });
    idx.images[entryId] = entry;
    await saveIndex();
    return { ...view(entry), reused: false };
  })();
  inflight.set(entryId, work);
  try {
    return await work;
  } finally {
    inflight.delete(entryId);
  }
}

export async function deleteImage(key, style = "object-white") {
  const idx = await loadIndex();
  const entryId = id(resolveStyle(style).id, slugKey(key));
  const entry = idx.images[entryId];
  if (!entry) return false;
  await fs.rm(path.join(DIR(), entry.file), { force: true });
  delete idx.images[entryId];
  await saveIndex();
  return true;
}

export function listStyles() {
  return Object.fromEntries(Object.entries(styles).map(([k, v]) => [k, v.label]));
}
