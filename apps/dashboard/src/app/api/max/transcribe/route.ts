import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@max/db";
import { transcribeAudio } from "@/lib/whisper";

/**
 * Transcribes a recorded voice command. Separate from /api/max/command —
 * this only turns audio into text; the transcribed text then goes through
 * the exact same submit path a typed command would (client re-POSTs it to
 * /api/max/command itself, after Mendez confirms it), not a parallel
 * pipeline.
 */
export async function POST(req: NextRequest) {
  const { audioBase64, mimeType } = (await req.json().catch(() => ({}))) as {
    audioBase64?: string;
    mimeType?: string;
  };

  if (!audioBase64 || !mimeType) {
    return NextResponse.json({ text: null, error: true, message: "No audio received." });
  }

  try {
    const text = await transcribeAudio(audioBase64, mimeType);
    return NextResponse.json({ text, error: false });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Same pattern as every other MAX-pipeline failure in this app.
    await prisma.activityLog
      .create({ data: { agentKey: "system", level: "error", message: `MAX voice transcription failed: ${message}` } })
      .catch(() => {});
    return NextResponse.json({ text: null, error: true, message: "Couldn't transcribe that — try again or type it." });
  }
}
