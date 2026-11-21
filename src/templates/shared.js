import fs from "node:fs";
import path from "node:path";
import { ROOT } from "../config.js";

/** Helpers every template can use when generating composition HTML. */

export function esc(s = "") {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export const r3 = (n) => Math.round(n * 1000) / 1000;

const FONTS_DIR = path.join(ROOT, "node_modules", "@fontsource");

/**
 * Bundled @fontsource fonts. Returns { files, css } — files are copied into the job's assets/fonts,
 * css holds the matching @font-face rules (HyperFrames needs local font files, no network at render).
 */
export function fontFaces(family, pkg, weights = [400, 700], subsets = ["latin", "latin-ext"]) {
  const files = [];
  const rules = [];
  for (const w of weights) {
    for (const s of subsets) {
      const name = `${pkg}-${s}-${w}-normal.woff2`;
      const from = path.join(FONTS_DIR, pkg, "files", name);
      if (!fs.existsSync(from)) continue;
      files.push({ from, to: `assets/fonts/${name}` });
      rules.push(
        `@font-face{font-family:"${family}";font-style:normal;font-weight:${w};font-display:block;src:url("assets/fonts/${name}") format("woff2");}`,
      );
    }
  }
  return { files, css: rules.join("\n") };
}

export function flagFile(code) {
  const from = path.join(ROOT, "node_modules", "flag-icons", "flags", "4x3", `${String(code).toLowerCase()}.svg`);
  if (!fs.existsSync(from)) throw new Error(`Unknown flag code "${code}" (use an ISO 3166 code like "us", "gb", "de")`);
  return { from, to: "assets/flag.svg" };
}

export const gsapFile = {
  from: path.join(ROOT, "node_modules", "gsap", "dist", "gsap.min.js"),
  to: "assets/gsap.min.js",
};

/** Website text with the second wordmark part highlighted, e.g. fluent<b>hub</b>.app */
export function brandedWebsite(brand) {
  const site = brand.website || brand.name;
  const part = brand.wordmark?.[1];
  if (!part) return esc(site);
  const i = site.toLowerCase().indexOf(part.toLowerCase());
  if (i < 0) return esc(site);
  return (
    esc(site.slice(0, i)) +
    `<span style="color:${brand.accentColor}">${esc(site.slice(i, i + part.length))}</span>` +
    esc(site.slice(i + part.length))
  );
}

/** Two-tone wordmark: parts alternate primary / accent colors (primary can be overridden for dark layouts). */
export function wordmarkHtml(brand, primary = brand.primaryColor) {
  const parts = brand.wordmark?.length ? brand.wordmark : [brand.name];
  return parts
    .map((p, i) => `<span style="color:${i % 2 ? brand.accentColor : primary}">${esc(p)}</span>`)
    .join("");
}

/** Logo <img>, or a colored circle with the brand initial when no logo was given. */
export function logoHtml(brand, assets, size) {
  if (assets.logo) {
    return `<img class="brand-logo" src="${esc(assets.logo)}" style="width:${size}px;height:${size}px;border-radius:50%;object-fit:cover" alt="">`;
  }
  return `<div class="brand-logo" style="width:${size}px;height:${size}px;border-radius:50%;background:${brand.accentColor};color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:${Math.round(size * 0.58)}px;line-height:1">${esc(brand.name.slice(0, 1).toUpperCase())}</div>`;
}

/** Wrap text in per-character spans for typewriter reveals. */
export function charSpans(text, cls = "ch") {
  return [...text].map((c) => `<span class="${cls}">${esc(c)}</span>`).join("");
}
