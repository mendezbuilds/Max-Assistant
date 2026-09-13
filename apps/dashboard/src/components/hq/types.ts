export interface AgentData {
  key: string;
  name: string;
  icon: string;
  description: string;
  phase: number;
  enabled: boolean;
  status: string;
  lastActionAt: string | null;
  lastActionSummary: string | null;
}

export interface StatsData {
  agentsActive: number;
  agentsTotal: number;
  sourcesWatched: number;
  matchesToday: number;
  apiCreditRemaining: number | null;
  coreOnline: boolean;
  bootedAt: string | null;
  recentFailures: Array<{
    id: number;
    agentKey: string;
    level: string;
    message: string;
    createdAt: string;
  }>;
}
