"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { TitleBar } from "./TitleBar";
import { StatsRow } from "./StatsRow";
import { AlertBanner } from "./AlertBanner";
import { QuickChips } from "./QuickChips";
import { OrbitView } from "./OrbitView";
import { AgentDetailScreen } from "./AgentDetailScreen";
import { SidePanel } from "./SidePanel";
import { CommandBar } from "./CommandBar";
import { BottomStatusStrip } from "./BottomStatusStrip";
import { getAgentVisual } from "@/lib/hq-config";
import type { AgentData, StatsData } from "./types";

const POLL_MS = 15_000;

interface ZoomTransition {
  key: string;
  /** Relative to the content area (contentRef below), not the viewport — keeps the effect contained to "replacing the orbit view" instead of a page-wide overlay that ignores the title bar/command bar. */
  rect: { left: number; top: number; width: number; height: number };
  containerWidth: number;
  containerHeight: number;
}

function speak(text: string, onStart: () => void, onEnd: () => void) {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) {
    onEnd();
    return;
  }
  window.speechSynthesis.cancel();
  const utter = new SpeechSynthesisUtterance(text);
  utter.onstart = onStart;
  utter.onend = onEnd;
  utter.onerror = onEnd;
  window.speechSynthesis.speak(utter);
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
  const [panelMode, setPanelMode] = useState<"schedule" | "activity" | null>(null);
  const [panelClosing, setPanelClosing] = useState(false);
  const [zoomTransition, setZoomTransition] = useState<ZoomTransition | null>(null);
  const [zoomedAgentKey, setZoomedAgentKey] = useState<string | null>(null);
  const [speaking, setSpeaking] = useState(false);

  const nodeRefs = useRef<Record<string, HTMLDivElement | null>>({});
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

  const registerNodeRef = useCallback((key: string, el: HTMLDivElement | null) => {
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

  const handleMaxCommand = useCallback(
    (text: string) => {
      fetch("/api/max/command", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      })
        .then((r) => r.json())
        .then((body: { spokenText: string; targetAgentKey: string | null }) => {
          speak(
            body.spokenText,
            () => setSpeaking(true),
            () => setSpeaking(false)
          );
          if (body.targetAgentKey) {
            window.setTimeout(() => beginZoom(body.targetAgentKey!), 900);
          }
        })
        .catch(() => {});
    },
    [beginZoom]
  );

  const handleAgentMessage = useCallback((text: string) => {
    chatHandlerRef.current?.(text);
  }, []);

  const openPanel = useCallback((mode: "schedule" | "activity") => {
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
    <div className="relative flex min-h-screen flex-col overflow-x-hidden bg-[#05070c] text-slate-200">
      <TitleBar bootedAt={stats?.bootedAt ?? null} online={stats?.coreOnline ?? false} />
      <StatsRow stats={stats} />
      <AlertBanner stats={stats} />
      {!zoomedAgentKey && <QuickChips onOpen={openPanel} />}

      <div ref={contentRef} className="relative flex flex-1 items-center justify-center overflow-hidden py-4">
        {zoomedAgentKey ? (
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
            speaking={speaking}
            onNodeClick={beginZoom}
            onMaxClick={() => handleMaxCommand("")}
            registerNodeRef={registerNodeRef}
          />
        )}

        {zoomTransition && (
          <ZoomOverlay
            rect={zoomTransition.rect}
            containerWidth={zoomTransition.containerWidth}
            containerHeight={zoomTransition.containerHeight}
            color={getAgentVisual(zoomTransition.key).color}
          />
        )}
      </div>

      <BottomStatusStrip stats={stats} />

      <CommandBar
        mode={zoomedAgentKey ? "agent" : "max"}
        onMaxCommand={handleMaxCommand}
        onAgentMessage={handleAgentMessage}
        onNavigateBack={handleBackToOrbit}
      />

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
 */
function ZoomOverlay({
  rect,
  containerWidth,
  containerHeight,
  color,
}: {
  rect: { left: number; top: number; width: number; height: number };
  containerWidth: number;
  containerHeight: number;
  color: string;
}) {
  const [grown, setGrown] = useState(false);

  useEffect(() => {
    const raf = requestAnimationFrame(() => setGrown(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  const targetSize = Math.min(containerWidth, containerHeight) * 0.45;

  const style = grown
    ? {
        left: containerWidth / 2 - targetSize / 2,
        top: containerHeight / 2 - targetSize / 2,
        width: targetSize,
        height: targetSize,
        opacity: 0,
      }
    : {
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
        opacity: 1,
      };

  return (
    <div
      className="pointer-events-none absolute z-50 rounded-full transition-all duration-500 ease-in-out"
      style={{ ...style, background: `radial-gradient(circle, ${color}cc 0%, ${color}22 70%, transparent 100%)` }}
    />
  );
}
