import fs from "node:fs";
import path from "node:path";
import { ROOT } from "../config.js";

export const SFX_DIR = path.join(ROOT, "assets", "sfx");
const AUDIO = /\.(wav|mp3|ogg|m4a)$/i;
const stem = (f) => f.replace(/\.[^.]+$/, "");

/** Sound effects in assets/sfx, by name without extension (e.g. "tick", "whoosh-short"). */
export function listSfx() {
  return fs.readdirSync(SFX_DIR).filter((f) => AUDIO.test(f)).map(stem).sort();
}

/** Absolute path of a sound effect, or null when it does not exist. */
export function sfxPath(name) {
  const file = fs.readdirSync(SFX_DIR).find((f) => AUDIO.test(f) && stem(f) === name);
  return file ? path.join(SFX_DIR, file) : null;
}
