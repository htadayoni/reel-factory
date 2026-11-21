import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";
import { run } from "./exec.js";

/**
 * Mix timed audio events (voice lines, sound effects) and an optional looping music bed
 * into one 44.1 kHz stereo WAV that is exactly `duration` seconds long.
 *
 * events: [{ file, at, volume? }]   music: { file, volume? } | null
 */
export async function mixTrack({ events, music, duration, outFile }) {
  const inputs = [];
  const filters = [];
  const labels = [];

  events.forEach((ev, i) => {
    inputs.push("-i", ev.file);
    const ms = Math.max(0, Math.round(ev.at * 1000));
    filters.push(
      `[${i}:a]aformat=sample_rates=44100:channel_layouts=stereo,volume=${ev.volume ?? 1},adelay=${ms}|${ms}[e${i}]`,
    );
    labels.push(`[e${i}]`);
  });

  if (music) {
    const idx = events.length;
    inputs.push("-stream_loop", "-1", "-i", music.file);
    filters.push(
      `[${idx}:a]aformat=sample_rates=44100:channel_layouts=stereo,volume=${music.volume ?? 0.15},` +
        `atrim=0:${duration.toFixed(3)},afade=t=out:st=${Math.max(0, duration - 1.5).toFixed(3)}:d=1.5[m]`,
    );
    labels.push("[m]");
  }

  // Silent base guarantees the output covers the full duration even with no events.
  filters.push(`anullsrc=r=44100:cl=stereo,atrim=0:${duration.toFixed(3)}[base]`);
  labels.push("[base]");
  filters.push(
    `${labels.join("")}amix=inputs=${labels.length}:normalize=0:dropout_transition=0,` +
      `alimiter=limit=0.95,atrim=0:${duration.toFixed(3)}[out]`,
  );

  // Inline filter graph: works on ffmpeg 6 (Ubuntu 24.04) through 9, unlike -filter_complex_script.
  await run(config.ffmpegBin, [
    "-y", "-v", "error", ...inputs,
    "-filter_complex", filters.join(";"),
    "-map", "[out]", "-c:a", "pcm_s16le", outFile,
  ]);
  return outFile;
}

export async function copyInto(src, dir, name = path.basename(src)) {
  await fs.mkdir(dir, { recursive: true });
  const dest = path.join(dir, name);
  await fs.copyFile(src, dest);
  return name;
}
