import { EdgeTTS } from "node-edge-tts";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

// "Jenny" is one of Microsoft's own voices specifically tuned for
// assistant/customer-service scenarios — warm, clear, professional, not
// theatrical, which matches the brief without needing a style-instruction
// prefix (unlike Gemini TTS, Edge-TTS just reads exactly the text it's
// given — prepending "Say calmly: ..." would get read aloud verbatim, not
// interpreted as a direction).
const TTS_VOICE = "en-US-JennyNeural";
const TTS_OUTPUT_FORMAT = "audio-24khz-48kbitrate-mono-mp3";

/**
 * MAX's spoken reply, via Edge-TTS — the same real Azure neural voice
 * engine behind Microsoft Edge's own "Read Aloud" feature, reached through
 * an unofficial free wrapper: no API key, no official daily quota (unlike
 * the Gemini TTS model this replaces, which hit its free-tier 10-requests
 * /day ceiling in normal use). Text generation and transcription both stay
 * on Gemini — only this one step moved.
 *
 * The library's own API only writes to a file (no in-memory buffer
 * option), so this writes to a per-call temp file, reads it back, and
 * cleans up. Edge-TTS returns MP3 (vs. Gemini's raw headerless PCM, which
 * needed manual WAV-wrapping) — a browser <audio> element plays it
 * directly, so the returned data: URL shape is unchanged and nothing
 * downstream (playback, the talking-pulse animation tied to play/ended)
 * needs to change.
 */
export async function generateMaxSpeech(text: string): Promise<string> {
  const tts = new EdgeTTS({ voice: TTS_VOICE, outputFormat: TTS_OUTPUT_FORMAT });
  const dir = await mkdtemp(path.join(tmpdir(), "max-tts-"));
  const filePath = path.join(dir, `${randomUUID()}.mp3`);
  try {
    await tts.ttsPromise(text, filePath);
    const mp3 = await readFile(filePath);
    if (mp3.length === 0) throw new Error("Edge-TTS returned no audio data");
    return `data:audio/mpeg;base64,${mp3.toString("base64")}`;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
