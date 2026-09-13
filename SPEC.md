# Max — Personal AI Agent Hub
**Full Spec v1**

## Vision
A JARVIS-style always-on hub ("Max") running in the cloud, with specialized agents underneath handling distinct tasks — like an Avengers roster, each agent with its own identity/icon on the dashboard. Accessible via a web dashboard (mobile-responsive) and Telegram (primary mobile interface). Agents run 24/7 on a server, independent of whether Mendez's devices are open.

## Architecture

**Hub (shared body)**
- Web dashboard — one card per agent (status, last action, logs, on/off toggle), central activity feed at top
- Each agent has its own identity/icon on its dashboard card
- Shared plumbing: auth, notification delivery (Telegram bot), scheduling, logging/database, wallet connection (for mint/WL agents)
- Mobile access: responsive dashboard + Telegram (native mobile notifications) — dedicated mobile app deferred to later phase
- Desktop floating avatar — deferred polish layer, built once agents are proven

**Max (brain layer)**
- Claude API called by agents whenever judgment/reasoning is needed (e.g. "does this job posting match Mendez's criteria," "summarize today's alpha into one alert," "does this contract look legit")
- Shared reasoning layer across all agents — agents differ in data collection, not filtering logic

**Agents (hands/eyes)**
- Each agent = a scheduled script/service that collects data, calls Max for reasoning, then acts (alert, post, log)
- Independent — no agent depends on another to function

## Agent Roster & Build Order

**Phase 0 — Foundation**
1. Dashboard skeleton (empty agent cards, activity feed, login)
2. Telegram notification pipe (shared alert channel for all agents)

**Phase 1 — Priority agents (watch → filter → alert shape)**
3. **Job scout** — watches Discord job groups/job boards; two-tier: private feed (Mendez's specific criteria: web3, remote, his stack) + public feed (broader filter, auto-posts to his Telegram channel as growth content)
4. **Alpha/airdrop scout** — watches for new protocol drops, testnet tasks, eligibility checkers
5. **Apartment scout** — watches Lagos listing groups/sites, filters by ~₦1M budget + mainland criteria
6. **X content agent** — drafts build-in-public posts from commits/progress for consistent posting cadence
7. **Email watcher** — scans inbox against criteria (client mail, urgent/invoice/contract keywords, important domains), filters noise, sends Telegram digest of what matters

**Phase 2 — Personal ops agents**
8. **Telegram manager** — scheduled posts, auto-welcome new members, cross-posts TikTok/YouTube content, tracks growth toward 1k subs (now boosted by job scout's public feed as core content)
9. **YC application assistant** — tracks deadlines, flags incomplete sections
10. **Client invoice/follow-up agent** — tracks payment due dates, drafts follow-ups on late payments
11. **Inbox/DM triage agent** — flags which messages across Discord/Telegram/X/client channels need replies vs. noise

**Phase 3 — Bigger builds**
12. **MST bot** — trading bot for Mendez's own strategy (liquidity sweep, displacement, BOS, order block) on EURUSD. Blocked on: finalizing precise/codeable strategy rules, and readiness for a live account. Phased build: spec → backtest → paper trade → supervised live → automation. Needs its own guardrails (position sizing limits, kill switch, alert-only mode) separate from scouting agents since it executes with real capital.
13. **NFT whitelist hunter** — tracks WL tasks (follows/RTs/Discord verification) across projects, flags deadlines, verifies contracts to avoid phishing/fake mint sites
14. **YouTube manager** — for the manhwa recap channel: script generation from source panels → TTS voiceover → automated pan/zoom/text-overlay animation → auto-captions → human review pass → publish

**Phase 4 — Nice-to-haves (as time allows)**
15. Novel writing companion — word count tracking, continuity notes (characters, plot threads)
16. Learning tracker — progress on clipping/motion graphics/video editing/Roblox dev skills
17. Deal/discount scout — watches for deals on dev/trading/editing tools
18. Competitor/market watcher — tracks similar web3 projects for positioning insight
19. Daily briefing agent — morning summary pulling from all agents (jobs, alpha, MST setups, channel growth, calendar) — natural "front door" into the dashboard

**Phase 5 — Polish**
20. Desktop floating avatar / global-hotkey summon UI

## Key Notes
- Build agents with config-driven design (not hardcoded to Mendez's accounts) in case any are later spun into standalone products — but the hub itself is personal-use, not the SaaS (SaaS is a separate future track, not yet scoped)
- MST bot is higher-risk than scouting agents — needs isolated guardrails, no shared execution logic with alert-only agents
- Fake mint sites are the top scam vector for the WL hunter — must verify actual contract, not just a matching name
