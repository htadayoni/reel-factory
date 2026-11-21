import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { config } from "../config.js";

const EXT_BY_TYPE = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/jpg": ".jpg",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "image/svg+xml": ".svg",
  "image/avif": ".avif",
  "audio/mpeg": ".mp3",
  "audio/mp3": ".mp3",
  "audio/wav": ".wav",
  "audio/x-wav": ".wav",
  "audio/ogg": ".ogg",
  "audio/aac": ".aac",
  "audio/mp4": ".m4a",
  "video/mp4": ".mp4",
};

/**
 * Download a remote asset (http/https or data: URI) into `dir`.
 * Returns the file name relative to `dir`. Same URL in one job is downloaded once.
 */
export async function downloadAsset(url, dir, { kind = "asset", cache } = {}) {
  if (cache?.has(url)) return cache.get(url);
  const promise = doDownload(url, dir, kind);
  cache?.set(url, promise);
  return promise;
}

async function doDownload(url, dir, kind) {
  await fs.mkdir(dir, { recursive: true });
  const id = crypto.createHash("sha1").update(url).digest("hex").slice(0, 12);

  if (url.startsWith("data:")) {
    const m = url.match(/^data:([^;,]+)(;base64)?,(.*)$/s);
    if (!m) throw new Error(`Invalid data URI for ${kind}`);
    const buf = m[2] ? Buffer.from(m[3], "base64") : Buffer.from(decodeURIComponent(m[3]));
    if (buf.length > config.maxAssetBytes) throw new Error(`${kind} is larger than the size limit`);
    const name = `${kind}-${id}${EXT_BY_TYPE[m[1]] || ""}`;
    await fs.writeFile(path.join(dir, name), buf);
    return name;
  }

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid URL for ${kind}: ${url}`);
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error(`Unsupported URL protocol for ${kind}: ${parsed.protocol}`);
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), config.assetTimeoutMs);
  let res;
  try {
    res = await fetch(url, { signal: ctrl.signal, redirect: "follow", headers: { "user-agent": "reel-factory/0.1" } });
  } catch (err) {
    throw new Error(`Could not download ${kind} ${url}: ${err.name === "AbortError" ? "timeout" : err.message}`);
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new Error(`Could not download ${kind} ${url}: HTTP ${res.status}`);

  const len = Number(res.headers.get("content-length") || 0);
  if (len > config.maxAssetBytes) throw new Error(`${kind} ${url} is larger than the size limit`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > config.maxAssetBytes) throw new Error(`${kind} ${url} is larger than the size limit`);

  const type = (res.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  const urlExt = path.extname(parsed.pathname).toLowerCase();
  const ext = EXT_BY_TYPE[type] || (urlExt.length <= 5 ? urlExt : "") || "";
  const name = `${kind}-${id}${ext}`;
  await fs.writeFile(path.join(dir, name), buf);
  return name;
}
