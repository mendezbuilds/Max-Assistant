import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import ffmpegPath from "ffmpeg-static";
import { WaveFile } from "wavefile";
import { pipeline, type AutomaticSpeechRecognitionPipeline } from "@huggingface/transformers";

const execFileAsync = promisify(execFile);

// base.en (74M params, English-only) — a real middle ground, not the
// largest model reflexively grabbed: tiny.en is faster but noticeably
// less accurate on real speech (confirmed against a genuine JFK speech
// sample, not a synthetic TTS clip), while small.en/medium.en cost
// meaningfully more CPU time per call for a voice command that's
// typically one short sentence. Runs entirely on CPU here — a real
// resource trade-off worth remembering once this moves off Mendez's
// machine onto a smaller cloud VM, where a lighter model may be the
// better trade.
const MODEL_ID = "Xenova/whisper-base.en";

const MIME_TO_EXTENSION: Record<string, string> = {
  "audio/webm": ".webm",
  "audio/mp4": ".mp4",
  "audio/ogg": ".ogg",
  "audio/wav": ".wav",
  "audio/wave": ".wav",
  "audio/x-wav": ".wav",
};

let transcriberPromise: Promise<AutomaticSpeechRecognitionPipeline> | null = null;

/**
 * Lazy-loaded singleton — the model is downloaded once (cached to disk by
 * transformers.js) and loaded into memory once per server process, not
 * once per request. The first call after server start pays the load cost;
 * every call after that reuses the same in-memory pipeline.
 */
function getTranscriber(): Promise<AutomaticSpeechRecognitionPipeline> {
  if (!transcriberPromise) {
    transcriberPromise = pipeline("automatic-speech-recognition", MODEL_ID).catch((err) => {
      // Don't cache a rejected load — a transient failure (e.g. first-run
      // download hiccup) shouldn't permanently wedge every future call.
      transcriberPromise = null;
      throw err;
    });
  }
  return transcriberPromise;
}

/**
 * Transcribes a recorded voice command entirely locally — no API key, no
 * network call, no daily quota, unlike the Gemini version this replaces.
 * Runs in two real steps:
 *  1. ffmpeg-static (a prebuilt binary, no compiler needed) transcodes
 *     whatever the browser's MediaRecorder produced (webm/opus, mp4, ogg)
 *     into 16kHz mono PCM WAV — the format Whisper expects. This step is
 *     needed regardless of container format, including WAV input, since
 *     MediaRecorder's sample rate/channel count aren't guaranteed to
 *     already match.
 *  2. The WAV is parsed to a normalized Float32Array (wavefile) and run
 *     through a local Whisper model (transformers.js + onnxruntime-node —
 *     both ship prebuilt native binaries, so this needs no C/C++ toolchain
 *     on the host, unlike whisper.cpp-based Node bindings).
 */
export async function transcribeAudio(base64Audio: string, mimeType: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "max-whisper-"));
  const extension = MIME_TO_EXTENSION[mimeType] ?? ".webm";
  const inputPath = path.join(dir, `${randomUUID()}${extension}`);
  const outputPath = path.join(dir, `${randomUUID()}.wav`);

  try {
    await writeFile(inputPath, Buffer.from(base64Audio, "base64"));
    await execFileAsync(ffmpegPath as unknown as string, [
      "-y",
      "-i",
      inputPath,
      "-ar",
      "16000",
      "-ac",
      "1",
      "-f",
      "wav",
      outputPath,
    ]);

    const wavBuffer = await readFile(outputPath);
    const wav = new WaveFile(wavBuffer);
    wav.toBitDepth("32f");
    // wavefile's own .d.ts always types getSamples() as returning
    // Float64Array regardless of the OutputObject constructor passed in —
    // a typings gap, not the real runtime behavior (confirmed live: passing
    // Float32Array here really does return Float32Array data).
    let samples = wav.getSamples(false, Float32Array) as unknown as Float32Array | Float32Array[];
    if (Array.isArray(samples)) samples = samples[0];
    if (!samples || samples.length === 0) throw new Error("Transcoded audio has no samples");

    const transcriber = await getTranscriber();
    const result = await transcriber(samples);
    const output = Array.isArray(result) ? result[0] : result;
    const text = output?.text?.trim();
    if (!text) throw new Error("Whisper returned an empty transcription");
    return text;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
