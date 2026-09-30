/**
 * The full agent roster from SPEC.md, as data — not hardcoded logic.
 *
 * This is the single source of truth for "what agents exist": the DB seed
 * script turns each entry into an Agent row, and the dashboard renders one
 * card per entry (joined with live status from the DB). Adding a new agent
 * later means adding a row here + re-seeding, not editing the dashboard or
 * the DB schema.
 *
 * `key` must be a stable slug — it's the join key between this config, the
 * Agent DB row, and whatever cron job / worker eventually implements the
 * agent. Never rename an existing key; add a new one instead.
 */
export interface AgentDefinition {
  key: string;
  name: string;
  /** Emoji shown as the agent's identity/icon on its dashboard card. */
  icon: string;
  description: string;
  /** Build phase from SPEC.md (0-5). Phase 0 agents are the hub itself. */
  phase: 0 | 1 | 2 | 3 | 4 | 5;
}

export const AGENT_REGISTRY: AgentDefinition[] = [
  // Phase 1 — priority agents
  {
    key: "job-scout",
    name: "Job Scout",
    icon: "🧭",
    description:
      "Watches Discord job groups/job boards. Private feed matches your criteria (web3, remote, your stack); public feed auto-posts broader matches to your Telegram channel as growth content.",
    phase: 1,
  },
  {
    key: "alpha-scout",
    name: "Alpha Scout",
    icon: "📡",
    description:
      "Watches for new protocol drops, testnet tasks, and airdrop eligibility checkers.",
    phase: 1,
  },
  {
    key: "apartment-scout",
    name: "Apartment Scout",
    icon: "🏠",
    description:
      "Watches Lagos listing groups/sites, filters by budget and mainland criteria.",
    phase: 1,
  },
  {
    key: "x-content",
    name: "X Content Agent",
    icon: "✍️",
    description:
      "Drafts build-in-public posts from commits/progress for a consistent posting cadence.",
    phase: 1,
  },
  {
    key: "email-watcher",
    name: "Email Watcher",
    icon: "📬",
    description:
      "Scans inbox against criteria (client mail, urgent/invoice/contract keywords, important domains) and sends a Telegram digest of what matters.",
    phase: 1,
  },
  {
    key: "degen-hunter",
    name: "Degen Hunter",
    icon: "🔥",
    description:
      "Real-time crypto token discovery and monitoring — meme coins, newly launched tokens, low-cap tokens, trending tokens, emerging narratives, unusual market activity. Discovers tokens, analyzes data, assigns risk levels, sends actionable Telegram alerts with two-step PIN-confirmed execution via dedicated burner wallet.",
    phase: 1,
  },


  // Phase 2 — personal ops agents
  {
    key: "telegram-manager",
    name: "Telegram Manager",
    icon: "📣",
    description:
      "Scheduled posts, auto-welcome for new members, cross-posts TikTok/YouTube content, tracks growth toward 1k subs.",
    phase: 2,
  },
  {
    key: "yc-assistant",
    name: "YC Application Assistant",
    icon: "🗂️",
    description: "Tracks deadlines and flags incomplete application sections.",
    phase: 2,
  },
  {
    key: "invoice-followup",
    name: "Invoice/Follow-up Agent",
    icon: "🧾",
    description:
      "Tracks client payment due dates and drafts follow-ups on late payments.",
    phase: 2,
  },
  {
    key: "inbox-triage",
    name: "Inbox/DM Triage",
    icon: "🗃️",
    description:
      "Flags which messages across Discord/Telegram/X/client channels need replies vs. noise.",
    phase: 2,
  },

  // Phase 3 — bigger builds
  {
    key: "mst-bot",
    name: "MST Bot",
    icon: "📈",
    description:
      "EURUSD trading bot for your own strategy (liquidity sweep, displacement, BOS, order block). Isolated guardrails: position sizing limits, kill switch, alert-only mode. Phased: spec → backtest → paper trade → supervised live → automation.",
    phase: 3,
  },
  {
    key: "wl-hunter",
    name: "NFT Whitelist Hunter",
    icon: "🎟️",
    description:
      "Tracks WL tasks across projects, flags deadlines, and verifies actual contracts to avoid phishing/fake mint sites.",
    phase: 3,
  },
  {
    key: "youtube-manager",
    name: "YouTube Manager",
    icon: "🎬",
    description:
      "Manhwa recap pipeline: script generation from source panels → TTS voiceover → pan/zoom/text-overlay animation → auto-captions → human review → publish.",
    phase: 3,
  },

  // Phase 4 — nice-to-haves
  {
    key: "novel-companion",
    name: "Novel Writing Companion",
    icon: "📖",
    description:
      "Word count tracking and continuity notes (characters, plot threads).",
    phase: 4,
  },
  {
    key: "learning-tracker",
    name: "Learning Tracker",
    icon: "🎯",
    description:
      "Tracks progress on clipping/motion graphics/video editing/Roblox dev skills.",
    phase: 4,
  },
  {
    key: "deal-scout",
    name: "Deal/Discount Scout",
    icon: "🏷️",
    description: "Watches for deals on dev/trading/editing tools.",
    phase: 4,
  },
  {
    key: "market-watcher",
    name: "Competitor/Market Watcher",
    icon: "🔭",
    description:
      "Tracks similar web3 projects for positioning insight.",
    phase: 4,
  },
  {
    key: "daily-briefing",
    name: "Daily Briefing",
    icon: "☀️",
    description:
      "Morning summary pulling from all agents (jobs, alpha, MST setups, channel growth, calendar).",
    phase: 4,
  },
];

export function getAgentDefinition(key: string): AgentDefinition | undefined {
  return AGENT_REGISTRY.find((a) => a.key === key);
}