import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";
import { run } from "../lib/exec.js";

/** Local, free TTS. Voices are .onnx files in PIPER_MODELS_DIR (install with scripts/setup-piper.sh). */
export default {
  ext: ".wav",
  async synthesize({ text, voice, speed, options, outFile }) {
    const name = voice || config.tts.piperDefaultVoice;
    const model = path.join(config.tts.piperModelsDir, `${name}.onnx`);
    try {
      await fs.access(model);
    } catch {
      throw new Error(`Piper voice "${name}" is not installed (expected ${model}). Run: bash scripts/setup-piper.sh ${name}`);
    }
    const args = ["-m", model, "-f", outFile, "--length-scale", String(1 / (speed || 1))];
    if (options.speaker !== undefined) args.push("-s", String(options.speaker));
    await run(config.tts.piperBin, args, { input: text, timeoutMs: 120000 });
  },
};
