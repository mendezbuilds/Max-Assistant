"use client";

import { useCallback, useRef, useState } from "react";
import type { MaxCoreState } from "./MaxCore";

// Amplitude (RMS of the time-domain signal, 0-1 scale) above which the mic
// is considered "someone is talking" — picked empirically as a middle
// ground: low enough to catch normal speaking volume, high enough that
// room noise/fan hum doesn't constantly trip it.
const SPEECH_RMS_THRESHOLD = 0.025;
// How long the signal has to stay below threshold before a spoken segment
// is considered finished and gets sent off for transcription — long enough
// to survive normal mid-sentence pauses, short enough that a call doesn't
// feel laggy waiting to respond.
const SILENCE_HOLD_MS = 900;
// A blip shorter than this (a click, a cough) never reaches the recorder
// as real content — discarded rather than sent to Gemini.
const MIN_SPEECH_MS = 300;
// Hard ceiling on one continuous segment, independent of VAD — stops a
// single very long, rambling turn (or a stuck detector) from recording
// forever.
const MAX_SEGMENT_MS = 15_000;
// Genuine back-to-back breakdowns (not just MAX giving an apologetic
// reply — that's a normal, handled turn) before the call ends itself
// rather than looping silently.
const MAX_CONSECUTIVE_FAILURES = 3;

function pickMimeType(): string {
  for (const type of ["audio/webm", "audio/mp4", "audio/ogg"]) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(type)) return type;
  }
  return "";
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/**
 * Drives MAX "call mode": continuous mic listening with voice-activity
 * detection (no push-to-talk button per turn), auto-transcription of each
 * detected speech segment, and routing the transcript into the exact same
 * /api/max/command pipeline the typed command bar already uses — this hook
 * only changes how text gets INTO that pipeline, same as the earlier
 * push-to-talk mic did, just continuously instead of one tap at a time.
 */
export function useCallMode({
  onZoom,
  onReply,
}: {
  onZoom: (agentKey: string) => void;
  onReply: (reply: { text: string; error: boolean } | null) => void;
}) {
  const [active, setActive] = useState(false);
  const [phase, setPhase] = useState<MaxCoreState>("idle");
  const [error, setError] = useState<string | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const rafRef = useRef<number | null>(null);
  // Mirrors `active` state for use inside the rAF loop / async callbacks,
  // which close over stale state otherwise.
  const activeRef = useRef(false);
  // True while MAX is thinking or speaking — VAD must not start capturing
  // a new segment during this window, both so MAX's own voice output can
  // never be picked back up as input, and so Mendez's next sentence isn't
  // captured as if it were part of the turn that's still being answered.
  const pausedRef = useRef(false);
  const recordingRef = useRef(false);
  const speechStartRef = useRef(0);
  const lastLoudRef = useRef(0);
  const failCountRef = useRef(0);
  const mimeTypeRef = useRef("");
  const audioElRef = useRef<HTMLAudioElement | null>(null);

  const cleanupStream = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    if (recorderRef.current) {
      // Detach handlers before stopping — otherwise a stop fired here would
      // still run onstop's async transcribe/command flow after the call has
      // already ended.
      recorderRef.current.onstop = null;
      recorderRef.current.ondataavailable = null;
      if (recorderRef.current.state === "recording") recorderRef.current.stop();
      recorderRef.current = null;
    }
    recordingRef.current = false;
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
    analyserRef.current = null;
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (audioElRef.current) {
      audioElRef.current.pause();
      audioElRef.current = null;
    }
  }, []);

  const endCall = useCallback(() => {
    activeRef.current = false;
    cleanupStream();
    setActive(false);
    setPhase("idle");
    onReply(null);
  }, [cleanupStream, onReply]);

  const stopRecordingSegment = useCallback(() => {
    if (recorderRef.current && recorderRef.current.state === "recording") {
      recorderRef.current.stop();
    }
  }, []);

  const startRecordingSegment = useCallback(() => {
    const stream = streamRef.current;
    if (!stream) return;
    const mimeType = mimeTypeRef.current;
    const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    recorderRef.current = recorder;
    chunksRef.current = [];
    recordingRef.current = true;
    speechStartRef.current = Date.now();

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };

    recorder.onstop = async () => {
      recordingRef.current = false;
      const blob = new Blob(chunksRef.current, { type: recorder.mimeType || mimeType || "audio/webm" });
      if (!activeRef.current) return;

      // Too short to be real speech (e.g. a click/pop briefly crossing
      // threshold) — discard silently and keep listening, no turn taken.
      if (Date.now() - speechStartRef.current < MIN_SPEECH_MS) {
        return;
      }

      pausedRef.current = true;
      setPhase("thinking");

      const finishTurn = (nextPhase: MaxCoreState) => {
        if (!activeRef.current) return;
        pausedRef.current = false;
        setPhase(nextPhase);
      };

      try {
        const audioBase64 = await blobToBase64(blob);
        const transcribeRes = await fetch("/api/max/transcribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ audioBase64, mimeType: recorder.mimeType || mimeType || "audio/webm" }),
        });
        const transcribeBody: { text: string | null; error: boolean; message?: string } = await transcribeRes.json();
        if (!activeRef.current) return;

        if (transcribeBody.error || !transcribeBody.text) {
          failCountRef.current += 1;
          onReply({ text: transcribeBody.message ?? "Sorry, I didn't catch that.", error: true });
          if (failCountRef.current >= MAX_CONSECUTIVE_FAILURES) {
            endCall();
            return;
          }
          finishTurn("listening");
          return;
        }

        const commandRes = await fetch("/api/max/command", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: transcribeBody.text }),
        });
        const commandBody: {
          spokenText: string;
          targetAgentKey: string | null;
          audioDataUrl: string | null;
          error: boolean;
        } = await commandRes.json();
        if (!activeRef.current) return;

        // A full round trip completed — even if MAX's own reply is an
        // apologetic error message, that's a normal handled turn, not a
        // call-ending breakdown, so the streak resets.
        failCountRef.current = 0;
        onReply({ text: commandBody.spokenText, error: commandBody.error });

        if (commandBody.targetAgentKey) {
          const targetKey = commandBody.targetAgentKey;
          window.setTimeout(() => {
            if (activeRef.current) onZoom(targetKey);
          }, 900);
        }

        setPhase("speaking");
        if (commandBody.audioDataUrl) {
          const audioEl = new Audio(commandBody.audioDataUrl);
          audioElRef.current = audioEl;
          audioEl.addEventListener("ended", () => finishTurn("listening"));
          audioEl.addEventListener("error", () => finishTurn("listening"));
          audioEl.play().catch(() => finishTurn("listening"));
        } else {
          // No audio (TTS failed/quota exhausted) — text reply is already
          // shown via onReply above; same graceful-degradation behavior as
          // the typed command bar. Give it a readable beat before
          // listening resumes instead of snapping back instantly.
          window.setTimeout(() => finishTurn("listening"), 1500);
        }
      } catch {
        failCountRef.current += 1;
        onReply({ text: "MAX couldn't respond — try again.", error: true });
        if (failCountRef.current >= MAX_CONSECUTIVE_FAILURES) {
          endCall();
          return;
        }
        finishTurn("listening");
      }
    };

    recorder.start();
  }, [endCall, onReply, onZoom]);

  const vadLoop = useCallback(() => {
    if (!activeRef.current || !analyserRef.current) return;

    if (pausedRef.current) {
      rafRef.current = requestAnimationFrame(vadLoop);
      return;
    }

    const analyser = analyserRef.current;
    const data = new Uint8Array(analyser.fftSize);
    analyser.getByteTimeDomainData(data);
    let sumSquares = 0;
    for (let i = 0; i < data.length; i++) {
      const v = (data[i] - 128) / 128;
      sumSquares += v * v;
    }
    const rms = Math.sqrt(sumSquares / data.length);
    const now = Date.now();
    const loud = rms > SPEECH_RMS_THRESHOLD;
    if (loud) lastLoudRef.current = now;

    if (!recordingRef.current) {
      if (loud) startRecordingSegment();
    } else {
      const silentFor = now - lastLoudRef.current;
      const recordedFor = now - speechStartRef.current;
      if (silentFor > SILENCE_HOLD_MS || recordedFor > MAX_SEGMENT_MS) {
        stopRecordingSegment();
      }
    }

    rafRef.current = requestAnimationFrame(vadLoop);
  }, [startRecordingSegment, stopRecordingSegment]);

  const startCall = useCallback(async () => {
    setError(null);
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setError("Microphone access denied — allow it in your browser to start a call.");
      return;
    }

    streamRef.current = stream;
    mimeTypeRef.current = pickMimeType();

    const audioCtx = new AudioContext();
    const source = audioCtx.createMediaStreamSource(stream);
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 2048;
    source.connect(analyser);
    audioCtxRef.current = audioCtx;
    analyserRef.current = analyser;

    failCountRef.current = 0;
    pausedRef.current = false;
    lastLoudRef.current = Date.now();
    activeRef.current = true;
    setActive(true);
    setPhase("listening");

    rafRef.current = requestAnimationFrame(vadLoop);
  }, [vadLoop]);

  return { active, phase, error, startCall, endCall };
}
