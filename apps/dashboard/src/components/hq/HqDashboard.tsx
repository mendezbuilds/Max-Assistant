"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { TitleBar } from "./TitleBar";
import { StatsRow } from "./StatsRow";
import { AlertBanner } from "./AlertBanner";
import { QuickChips } from "./QuickChips";
import { OrbitView } from "./OrbitView";
import { Starfield } from "./Starfield";
import { AgentDetailScreen } from "./AgentDetailScreen";
import { SidePanel } from "./SidePanel";
import { CommandBar } from "./CommandBar";
import { CallBar } from "./CallBar";
import { BottomStatusStrip } from "./BottomStatusStrip";
import { DegenDashboard } from "../degen-hunter/DegenDashboard";
import { Toaster } from "./Toaster";
import { useCallMode } from "./useCallMode";
import { getAgentVisual } from "@/lib/hq-config";
import type { AgentVisual } from "@/lib/hq-config";
import type { AgentData, StatsData } from "./types";

const POLL_MS = 15_000;

interface ZoomTransition {
  key: string;
  /** Relative to the content area (contentRef below), not the viewport — keeps the effect contained to "replacing the orbit view" instead of a page-wide overlay that ignores the title bar/command bar. */
  rect: { left: number; top: number; width: number; height: number };
  containerWidth: number;
  containerHeight: number;
}

/**
 * Plays a real Gemini TTS clip via an actual <audio> element, with the
 * talking-pulse animation tied to its genuine `play`/`ended`/`error`
 * events — not a fixed timer guessing at speech duration, and not the
 * browser's own SpeechSynthesis (which this replaces): that read the text
 * client-side with no connection to what MAX actually said or how long the
 * *real* generated speech runs for.
 */
function playMaxVoice(audioDataUrl: string | null, onStart: () => void, onEnd: () => void) {
  if (!audioDataUrl) {
    onEnd();
    return;
  }
  const audio = new Audio(audioDataUrl);
  audio.addEventListener("play", onStart);
  audio.addEventListener("ended", onEnd);
  audio.addEventListener("error", onEnd);
  audio.play().catch(onEnd);
}

export function HqDashboard({
  initialAgents,
  initialStats,
}: {
  initialAgents: AgentData[];
  initialStats: StatsData;
}) {
  const [agents, setAgents] = useState(initialAgents);
  const [stats, setStats] = useState<StatsData | null>(initialStats);
  const [panelMode, setPanelMode] = useState<"schedule" | "activity" | "alerts" | null>(null);
  const [panelClosing, setPanelClosing] = useState(false);
  const [zoomTransition, setZoomTransition] = useState<ZoomTransition | null>(null);
  const [zoomedAgentKey, setZoomedAgentKey] = useState<string | null>(null);
  const [speaking, setSpeaking] = useState(false);
  const [maxReply, setMaxReply] = useState<{ text: string; error: boolean } | null>(null);

  const nodeRefs = useRef<Record<string, HTMLElement | null>>({});
  const chatHandlerRef = useRef<((text: string) => Promise<void>) | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  // Poll for fresh data without a full page reload — router.refresh() would
  // remount the orbit and restart every CSS animation from scratch.
  useEffect(() => {
    const interval = setInterval(() => {
      fetch("/api/agents").then((r) => r.json()).then(setAgents).catch(() => {});
      fetch("/api/stats").then((r) => r.json()).then(setStats).catch(() => {});
    }, POLL_MS);
    return () => clearInterval(interval);
  }, []);

  const registerNodeRef = useCallback((key: string, el: HTMLElement | null) => {
    nodeRefs.current[key] = el;
  }, []);

  const beginZoom = useCallback((agentKey: string) => {
    const containerRect = contentRef.current?.getBoundingClientRect();
    const nodeRect = nodeRefs.current[agentKey]?.getBoundingClientRect();
    const cw = containerRect?.width ?? window.innerWidth;
    const ch = containerRect?.height ?? window.innerHeight;

    const rect =
      nodeRect && containerRect
        ? {
            left: nodeRect.left - containerRect.left,
            top: nodeRect.top - containerRect.top,
            width: nodeRect.width,
            height: nodeRect.height,
          }
        : { left: cw / 2, top: ch / 2, width: 1, height: 1 };

    setZoomTransition({ key: agentKey, rect, containerWidth: cw, containerHeight: ch });
    window.setTimeout(() => {
      setZoomedAgentKey(agentKey);
      setZoomTransition(null);
    }, 500);
  }, []);

  const handleBackToOrbit = useCallback(() => {
    setZoomedAgentKey(null);
  }, []);

  // Call mode's transcribed turns flow into the exact same /api/max/command
  // pipeline as typed commands (see useCallMode.ts) — beginZoom/setMaxReply
  // are shared with the typed-command path below rather than duplicated.
  const { active: callActive, phase: callPhase, error: callError, startCall, endCall } = useCallMode({
    onZoom: beginZoom,
    onReply: setMaxReply,
  });

  const handleMaxCommand = useCallback(
    (text: string) => {
      setMaxReply(null);
      fetch("/api/max/command", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      })
        .then((r) => r.json())
        .then((body: { spokenText: string; targetAgentKey: string | null; audioDataUrl: string | null; error: boolean }) => {
          setMaxReply({ text: body.spokenText, error: body.error });
          playMaxVoice(
            body.audioDataUrl,
            () => setSpeaking(true),
            () => setSpeaking(false)
          );
          if (body.targetAgentKey) {
            window.setTimeout(() => beginZoom(body.targetAgentKey!), 900);
          }
        })
        // A network-level failure (fetch itself never completing) is a real
        // error state too, not just a Gemini-side one the route already
        // handles — it needs the same visible "MAX couldn't respond"
        // treatment instead of just silently going nowhere.
        .catch(() => {
          setMaxReply({ text: "MAX couldn't respond — try again.", error: true });
        });
    },
    [beginZoom]
  );

  const handleAgentMessage = useCallback((text: string) => {
    chatHandlerRef.current?.(text);
  }, []);

  const openPanel = useCallback((mode: "schedule" | "activity" | "alerts") => {
    setPanelClosing(false);
    setPanelMode(mode);
  }, []);

  const closePanel = useCallback(() => {
    setPanelClosing(true);
    window.setTimeout(() => {
      setPanelMode(null);
      setPanelClosing(false);
    }, 300);
  }, []);

  return (
    // h-screen + overflow-hidden (not min-h-screen) — min-h-screen lets the
    // page grow taller than the viewport when its content wants more room
    // than that, which is exactly what forced page-level scrolling once
    // the orbit got bigger. Capping the root at exactly one viewport tall
    // makes the flex-1 orbit area below get a *fixed* height budget, which
    // OrbitView now actually measures and fits within (see its own
    // ResizeObserver), instead of only ever sizing itself from width.
    <div className="starfield-bg relative flex h-screen flex-col overflow-hidden text-slate-200">
      {/* Full-page background, behind everything — previously scoped to just the orbit's own box, which read as a visibly boxed rectangle instead of a page background. */}
      <Starfield />
      <Toaster onZoomAgent={beginZoom} />
      <TitleBar bootedAt={stats?.bootedAt ?? null} online={stats?.coreOnline ?? false} />
      <StatsRow stats={stats} />
      <AlertBanner stats={stats} />
      {!zoomedAgentKey && <QuickChips onOpen={openPanel} />}

      <div ref={contentRef} className="relative flex flex-1 items-center justify-center overflow-hidden py-1">
        {zoomedAgentKey === "degen-hunter" ? (
          <DegenDashboard onBack={handleBackToOrbit} />
        ) : zoomedAgentKey ? (
          <AgentDetailScreen
            agentKey={zoomedAgentKey}
            onBack={handleBackToOrbit}
            registerChatHandler={(handler) => {
              chatHandlerRef.current = handler;
            }}
          />
        ) : (
          <OrbitView
            agents={agents}
            maxState={callActive ? callPhase : speaking ? "speaking" : "idle"}
            onNodeClick={beginZoom}
            // A call is already active — tapping MAX's core mid-call
            // shouldn't also fire the typed-style empty-text ping.
            onMaxClick={callActive ? () => {} : () => handleMaxCommand("")}
            registerNodeRef={registerNodeRef}
          />
        )}

        {zoomTransition && (
          <ZoomOverlay
            rect={zoomTransition.rect}
            containerWidth={zoomTransition.containerWidth}
            containerHeight={zoomTransition.containerHeight}
            visual={getAgentVisual(zoomTransition.key)}
          />
        )}
      </div>

      <BottomStatusStrip stats={stats} />

      {/*
        MAX's text reply wasn't shown anywhere before this stage — only
        spoken via voice, which meant an error state (or any reply, on a
        machine with no audio) was genuinely invisible. Positioned just
        above the command bar, matching its own width/alignment.
      */}
      {maxReply && !zoomedAgentKey && (
        <div className="fixed bottom-16 left-0 right-0 z-30 px-4">
          <div
            className={`mx-auto max-w-3xl rounded-lg border px-3 py-2 font-mono text-sm backdrop-blur-sm ${
              maxReply.error
                ? "border-red-900/60 bg-red-950/40 text-red-400"
                : "border-jarvis-border/70 bg-slate-950/40 text-jarvis-cyan"
            }`}
          >
            {maxReply.text}
          </div>
        </div>
      )}

      {callActive ? (
        <CallBar phase={callPhase} onEndCall={endCall} />
      ) : (
        <CommandBar
          mode={zoomedAgentKey ? "agent" : "max"}
          onMaxCommand={handleMaxCommand}
          onAgentMessage={handleAgentMessage}
          onNavigateBack={handleBackToOrbit}
          onStartCall={startCall}
          callError={callError}
        />
      )}

      {panelMode && <SidePanel mode={panelMode} closing={panelClosing} onClose={closePanel} />}
    </div>
  );
}

/**
 * The clicked node's captured position/size, transitioned via CSS to a
 * large centered circle — a practical approximation of "grows and travels
 * toward center", since the real node is a continuously-orbiting target a
 * literal FLIP animation can't cleanly track. Positioned absolutely within
 * the content area (not viewport-fixed) so it stays scoped to "replacing
 * the orbit view" rather than a page-wide overlay that would ignore the
 * title bar/command bar's screen space.
 *
 * Rendered as a solid, fully opaque orb (the same look as the real node,
 * just bigger) rather than a translucent radial-gradient blob — no
 * transparency anywhere, at any point in the transition, including the
 * handoff to the terminal screen: it simply unmounts (the terminal screen
 * mounts underneath) rather than fading out.
 */
function ZoomOverlay({
  rect,
  containerWidth,
  containerHeight,
  visual,
}: {
  rect: { left: number; top: number; width: number; height: number };
  containerWidth: number;
  containerHeight: number;
  visual: AgentVisual;
}) {
  const [grown, setGrown] = useState(false);
  const Icon = visual.icon;

  useEffect(() => {
    const raf = requestAnimationFrame(() => setGrown(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  const targetSize = Math.min(containerWidth, containerHeight) * 0.5;

  const style = grown
    ? {
        left: containerWidth / 2 - targetSize / 2,
        top: containerHeight / 2 - targetSize / 2,
        width: targetSize,
        height: targetSize,
      }
    : {
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
      };

  return (
    <div
      className="pointer-events-none absolute z-50 flex items-center justify-center rounded-full"
      style={{
        ...style,
        transition: "left 0.5s ease-out, top 0.5s ease-out, width 0.5s ease-out, height 0.5s ease-out",
        // Solid opaque base color (the last, plain-color layer) with
        // white/black shading layered on top and faded to *transparent*
        // rather than to a low-alpha version of the node color —
        // transparent here reveals the opaque base underneath it, not
        // whatever is behind the orb, so it reads as solid all the way to
        // its edge. Same technique as AgentNode's own sphere fill.
        background: `radial-gradient(circle at 32% 28%, rgba(255,255,255,0.55) 0%, rgba(255,255,255,0) 45%), radial-gradient(circle at 68% 78%, rgba(0,0,0,0.4) 0%, rgba(0,0,0,0) 60%), ${visual.color}`,
        boxShadow: `0 0 50px 10px ${visual.color}55, inset 0 2px 4px rgba(255,255,255,0.35), inset 0 -3px 6px rgba(0,0,0,0.35)`,
      }}
    >
      <Icon
        size={Math.round(targetSize * 0.32)}
        stroke={1.5}
        className="text-white transition-transform duration-500 ease-out"
        style={{ transform: grown ? "scale(1)" : "scale(0.42)" }}
      />
    </div>
  );
}
