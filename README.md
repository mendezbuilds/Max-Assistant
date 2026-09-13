# Max — Personal AI Agent Hub

See [SPEC.md](./SPEC.md) for the full vision, architecture, and agent roster/build order. This repo implements **Phase 0** (dashboard skeleton + shared Telegram notification pipe) and two Phase 1 agents, **Job Scout** and **Alpha Scout**.

## Layout

```
packages/
  db/       Prisma schema + client, shared by every app (SQLite file lives in ./data)
  shared/   Config-driven agent registry (packages/shared/src/agents.config.ts) + small env helpers
apps/
  core/     Long-running service: Telegram bot, scheduler, activity logging.
            This is where Phase 1+ agents get registered as cron jobs.
  dashboard/  Next.js dashboard: activity feed + one card per agent, on/off toggle.
```

The dashboard and core are two independent processes that only share the SQLite database (`data/max.db`) — the dashboard writes an agent's `enabled` flag, core reads it before running that agent's job. Neither depends on the other being up.

## Setup

1. **Install dependencies** (from the repo root — this is an npm workspaces monorepo):
   ```
   npm install
   ```

2. **Configure environment**: copy `.env.example` to `.env` and fill in:
   - `TELEGRAM_BOT_TOKEN` — create a bot via [@BotFather](https://t.me/BotFather) (`/newbot`), paste the token it gives you.
   - `TELEGRAM_PUBLIC_CHANNEL_ID` — Job Scout's public/growth feed. Add your bot as an admin of that channel, forward one of its posts to [@userinfobot](https://t.me/userinfobot) to get the channel's chat id, and paste it here. Leave blank to skip the public feed (private feed still works).
   - `DASHBOARD_PASSWORD` — the password that gates the web dashboard.
   - `SESSION_SECRET` — any long random string (used to sign the session cookie).
   - `ANTHROPIC_API_KEY` — not used yet; agents from here on are keyword/rule-based, Claude gets wired in once an agent actually needs judgment calls.
   - `WEB3_CAREER_API_TOKEN` — optional, enables the Web3.career source. Free, request at [web3.career/web3-jobs-api](https://web3.career/web3-jobs-api).
   - `GOLDRUSH_API_KEY` — optional, enables the on-chain (Covalent/GoldRush) source. Reuse the key from ChainTale if you already have one.
   
   ⚠️ Only ever put real secrets in `.env` (gitignored). `.env.example` is committed to git — it should only ever hold placeholders.

3. **Set up the database**:
   ```
   npm run db:migrate   # creates data/max.db and applies the schema
   npm run db:seed      # populates the Agent table from the roster in agents.config.ts
   ```

4. **After changing anything in `packages/db` or `packages/shared`**, rebuild them before (re)starting the apps — the dashboard consumes their compiled `dist/` output, not the live TypeScript source, so edits there won't show up until you do:
   ```
   npm run build --workspace=@max/db
   npm run build --workspace=@max/shared
   ```
   (`apps/core`'s own `.ts` files hot-reload via `tsx watch`; only its workspace dependencies need a manual rebuild.)

5. **Run both apps** (two terminals):
   ```
   npm run dev:core
   npm run dev:dashboard
   ```
   Dashboard: http://localhost:3000. Telegram: message your bot `/start` to register for notifications, `/status` for a quick roster check.

## Job Scout (Phase 1)

Lives in [apps/core/src/agents/job-scout](./apps/core/src/agents/job-scout). Polls every 30 minutes when enabled (toggle on the dashboard card), keyword/rule-based only — no Claude calls yet, per spec.

**Sources implemented, verified against live data:**
- **RemoteOK** ([sources/remoteok.ts](./apps/core/src/agents/job-scout/sources/remoteok.ts)) — public JSON API, no key needed.
- **WeWorkRemotely** ([sources/weworkremotely.ts](./apps/core/src/agents/job-scout/sources/weworkremotely.ts)) — sitewide RSS feed (no JSON API exists).
- **CryptoJobsList** ([sources/cryptojobslist.ts](./apps/core/src/agents/job-scout/sources/cryptojobslist.ts)) — RSS feed. Unlike the others, this board isn't remote-only, so the remote-keyword check actually does real filtering here.
- **WorkingNomads** ([sources/workingnomads.ts](./apps/core/src/agents/job-scout/sources/workingnomads.ts)) — public JSON API, no key needed.
- **Mercor** ([sources/mercor.ts](./apps/core/src/agents/job-scout/sources/mercor.ts)) — no public API, but its careers page (a Next.js site) embeds real structured listing data server-side (`__NEXT_DATA__`) that any visitor's browser already receives — reads that directly rather than scraping rendered HTML. All matches here are tagged **AI Training / RLHF** (a new role category) regardless of title wording, and show "Mercor" as the poster rather than an individual, per addendum.
- **Web3.career** ([sources/web3career.ts](./apps/core/src/agents/job-scout/sources/web3career.ts)) — needs `WEB3_CAREER_API_TOKEN` (free, sign up required). The real response shape turned out to be a 3-element array (`[usageText, tosText, jobs[]]`, jobs at index 2) — quite different from the first guess, which silently returned 0 results until tested live with a real token and corrected.
- **Covalent/GoldRush (on-chain)** ([sources/covalent.ts](./apps/core/src/agents/job-scout/sources/covalent.ts)) — needs `GOLDRUSH_API_KEY`. Detects new Uniswap V3 pool creations on Ethereum/Base/Arbitrum/Optimism (same factory address on all four, deployed via CREATE2 with the same salt), then — since Covalent has no notion of a token's linked social/website presence — cross-checks each one against DexScreener's free public API for that specific compound condition from the spec ("launch + active social presence"). The event topic hash is computed at runtime via `keccak256` from the human-readable event signature rather than hand-typed — the first correct-*looking* hash a web search surfaced for this turned out to be invalid (one character too long for a real 32-byte hash) once checked. The initial endpoint guess (`/events/address/{contract}/`) was also wrong — it 400s without a required `starting-block` param, and even correctly parameterized, returns nothing for *any* contract. The real endpoint is `/events/topics/{hash}/` with `sender-address` to scope it, confirmed live against real decoded `PoolCreated` events.

**Sources checked and stubbed** ([sources/stubs.ts](./apps/core/src/agents/job-scout/sources/stubs.ts)) — each needs a decision from you, or genuinely has nothing to poll:
- **X/Twitter** — needs a *paid* API tier (free tier doesn't cover search). Skipped per addendum; revisit if the free sources prove insufficient.
- **LinkedIn** — no public API; scraping violates their ToS and risks the account it runs from. Skipped per addendum.
- **Wellfound (AngelList)** — checked: no public API or RSS exists, only paid third-party HTML scrapers (Apify) — same ToS/fragility risk profile as LinkedIn. Not built without an explicit go-ahead given that risk.
- **Turing / micro1** — checked both: neither has discrete listings at all, just a "create a profile, get matched later" application funnel. Nothing here to poll or de-dup against — if you're not already signed up to either, that's a one-time manual action, not something to automate.

Wiring in a real source later is just implementing the `JobSource` interface in `types.ts` and adding it to `ALL_SOURCES` in `index.ts` — nothing else in the pipeline changes.

**How matching works** (see [filter.ts](./apps/core/src/agents/job-scout/filter.ts)): role classification checks the listing's **title + tags only**, not the full description — an early version matched almost every listing because generic words like "developer" show up somewhere in nearly any job description, even unrelated ones. This trades some recall (a role worded unusually in its title might get missed) for far fewer false positives. Expect it to still be imperfect — that's what the Claude-based upgrade mentioned in SPEC.md is for. A source can also set `remote: true/false` directly (trusted over the text scan — useful when a listing never bothers to restate "remote") or `forcedRoleCategory` to skip keyword matching entirely (used by Mercor and the on-chain source, where every listing belongs to one category regardless of its title).

**Pay floor**: private feed excludes anything under $10/hr (flags $15/hr+ as 🔥 high priority); co-founder/ambassador/partnership leads skip the pay floor entirely per spec. The public feed's "looser pay floor" isn't a number the spec gave — it's currently set to $0 (still excludes explicitly-unpaid postings). Tune both in `PRIVATE_FEED_OPTIONS`/`PUBLIC_FEED_OPTIONS` in `filter.ts`.

**De-dup**: a shared `SeenItem` table (in `@max/db`) tracks every listing ever fetched per agent, so re-polling never re-alerts on the same posting — built generically so alpha-scout/apartment-scout can reuse it later.

## Reliability: retries, degraded sources, and filter reasoning

Three sources (`mercor`, `web3career`, `workingnomads`) were caught failing during an unattended overnight run — `"fetch failed"`/`"terminated"`, no further detail. Root cause: every source called plain `fetch()` with no timeout and no retry, so a network blip (or, for `workingnomads`, a hung connection — "terminated" is what Node's fetch throws when a connection drops mid-request with nothing to time it out) turned into a full miss with a useless error message.

Fixed with shared infrastructure every job-scout and alpha-scout source now uses, rather than a per-source patch:
- **[lib/http.ts](./apps/core/src/lib/http.ts)** — `fetchWithRetry()` wraps `fetch()` with a per-attempt timeout (default 15s) and retry-with-backoff on network errors, timeouts, 429, and 5xx (not on other 4xx — those won't succeed on retry). On final failure it surfaces the *real* cause (`err.cause`, or the response body) instead of a bare "fetch failed".
- **[lib/source-health.ts](./apps/core/src/lib/source-health.ts)** — tracks consecutive failures per `(agent, source)` in memory. Three in a row logs a distinct `error`-level "⚠️ DEGRADED" line instead of repeating the same `warn`, so a source that's actually broken doesn't look identical to a one-off blip in the activity feed. In-memory only (resets on process restart) — a deliberate scope limit, not an oversight; a durable version would need a new DB table, which felt like more than this warranted.

Separately, job-scout only ever logged pass/fail *counts* per run, with no way to tell "working correctly but strict" apart from "broken filter logic". [filter.ts](./apps/core/src/agents/job-scout/filter.ts)'s `applyFilters` now returns *why* — pass with the listing, or reject with the specific reason (`"not remote"`, `"pay ($5.00/hr) below $10/hr floor"`, etc.) — logged per listing to the **console only**, not the shared ActivityLog/dashboard feed. That's deliberate: a normal run checks 50-150+ listings, and logging one line per listing there would (a) flood the feed past usefulness and (b) since writing to the agent's own activity log updates its `lastActionAt` as a side effect, the *last* debug line would become the card's "last action" instead of the real run summary. Console output (visible in `apps/core`'s own terminal/log) is where per-listing debugging belongs; the dashboard keeps showing the aggregate summary line it already did.

## ⚠️ Dev-mode restarts and live Telegram credentials

`npm run dev:core` runs via `tsx watch` — it restarts the whole process on every source file save. If `.env` has a real `TELEGRAM_BOT_TOKEN`, **every one of those restarts is a real boot**, and the "🟢 Max core is online" notice used to fire on every single one of them: 28 messages went out to a real chat in about 7 minutes during one active editing session before this was caught and fixed.

Fixed in [telegram.ts](./apps/core/src/telegram.ts)'s `notifyOnBoot()`: it checks how long ago the *previous* "Max core started" line was logged (already-recorded ActivityLog history, not new state — in-memory state would reset on exactly the restarts this needs to detect) and suppresses the real send if it was less than 5 minutes ago. A genuine, isolated restart still notifies; a burst of dev-mode restarts from active editing now only notifies once.

The underlying lesson still applies beyond this one notification: **running `apps/core` with live credentials while actively editing its source will trigger real sends on every restart**, for anything that fires on boot or on a short poll interval. If you're doing a coding session that touches `apps/core`, consider running with a `.env` that has `TELEGRAM_BOT_TOKEN` blank (or agents disabled) until you're ready to test for real.

## Manually triggering an agent

Two ways to run an enabled agent immediately, instead of waiting for its scheduled interval — useful for testing:

- **Dashboard**: click "Run now" on the agent's card (only clickable when enabled). This sets `Agent.triggerRequestedAt`; the running `apps/core` process picks it up within ~10 seconds (`checkManualTriggers` in `scheduler.ts`) and runs it — a click won't feel perfectly instant, since it's the same "dashboard writes state, core reads state" pattern as the enable/disable toggle, not a direct call between the two processes. The card's "last action" and the activity feed update once the run actually finishes.
- **CLI**: `npm run trigger:job-scout` / `npm run trigger:alpha-scout` (generically: `npm run trigger --workspace=@max/core -- <agent-key>`). Runs in its own short-lived process, talking directly to the shared DB — does **not** require `apps/core`'s long-running process to be up. This is the faster path for local debugging.

Both require the agent to already be `enabled`, and both are wired through one shared registry — [apps/core/src/agents/registry.ts](./apps/core/src/agents/registry.ts) — so adding a new agent there makes it triggerable both ways automatically. Manual-trigger log lines are recorded under `"system"` rather than the agent's own key (a subtlety: logging them under the agent's key would move its `lastActionAt` immediately on the *request*, before the run actually finished, confusing the dashboard's completion-detection polling — search the code for the comment on this if touching it).

⚠️ **Both paths actually send real Telegram messages** if the agent's run finds matches and `TELEGRAM_BOT_TOKEN`/`TELEGRAM_PUBLIC_CHANNEL_ID` are set — there's no dry-run mode. Think about de-dup state (`SeenItem`) before the first real trigger of a newly-added or newly-fixed source: if it's never successfully run before, *everything* it finds counts as new, which can mean a large first batch. Both bugs below were caught precisely from this being true unexpectedly:
- The CLI trigger's first version silently sent nothing at all, in *any* configuration — it never called `createBot()`, so `notify()`/`notifyPublic()` always no-op'd. Fixed by initializing the bot client (not its long-polling loop — that stays exclusive to the real `apps/core` process) at the top of `cli/trigger.ts`.
- job-scout was found already enabled with a live run in its history that neither of us had triggered this session — traced to an old, still-running `core` process from earlier testing. It turned out safe (that process's Telegram bot was never initialized either, at the time), but it's a reminder that a long-running dev process left up across sessions can act on state changes made through the dashboard at any time. Stop `apps/core` between sessions if you don't want that.

## Alpha Scout (Phase 1)

Lives in [apps/core/src/agents/alpha-scout](./apps/core/src/agents/alpha-scout). Reuses job-scout's plumbing (scheduler, retry/health, `SeenItem` dedup, manual trigger) but is much simpler on purpose: no role/pay filtering (nothing in its spec calls for it), and **private feed only** for now — no public/growth-channel split yet.

Two signal types:

**Token/project launches** — same "launch + active social presence" compound signal as job-scout's on-chain source, extended to more chains:
- **[sources/covalent.ts](./apps/core/src/agents/alpha-scout/sources/covalent.ts)** — Ethereum, Base, Arbitrum, Optimism, Polygon, BNB Chain. All verified live. The Uniswap V3 factory address is the same across the first five (confirmed real `PoolCreated` events on each), but **not** BNB Chain — its deployment came later via separate governance at a different address (`0xdB1d...61F7`); using the "universal" address there silently found nothing until checked directly.
- **[sources/solana.ts](./apps/core/src/agents/alpha-scout/sources/solana.ts)** — deliberately **not** built on Covalent like the EVM chains. Covalent's Solana data only exposes new-pool/DEX activity via real-time streams, not a poll-friendly REST endpoint, which doesn't fit a 20-minute cron. Uses DexScreener's token-profiles feed alone instead, as both detector and social-check in one call.

**Testnet/airdrop tasks** — time-sensitive by nature (spec calls for timestamping + deadline-flagging):
- **[sources/airdropsio.ts](./apps/core/src/agents/alpha-scout/sources/airdropsio.ts)** — no official API/RSS (its default WordPress feed only carries blog posts, not listings), but its listing page is plain server-rendered HTML with a stable, well-structured custom-post-type markup (verified) — parsed with `cheerio` rather than regex. A public directory page with no login, not the kind of scraping-risk case LinkedIn/Wellfound are.
- **[sources/stubs.ts](./apps/core/src/agents/alpha-scout/sources/stubs.ts)**: **DappRadar** has an official API, but it's behind a signup-gated key and its docs site was unreachable from here (repeated DNS failures) — stubbed rather than guessed blind, unlike Web3.career/Covalent where at least partial docs were reachable. **X/Twitter** stubbed for the same paid-API-tier reason as job-scout.

Deadline detection ([deadline.ts](./apps/core/src/agents/alpha-scout/deadline.ts)) is a best-effort keyword scan (`deadline`, `ends`, `expires`, `until`, ...) returning the matching snippet as-is — deliberately not parsed into a hard date, since source text is too varied ("48 hours left", "until further notice") to normalize reliably.

## Docker

`docker-compose up --build` runs both services with a shared `./data` volume for the SQLite file. Hosting target isn't decided yet — this setup is meant to run unmodified on a VPS, Railway, Render, or any other Docker-capable host.

## Adding a new agent

1. Add an entry to `AGENT_REGISTRY` in [packages/shared/src/agents.config.ts](./packages/shared/src/agents.config.ts) (key, name, icon, description, phase).
2. Run `npm run db:seed` — it upserts the new row without touching existing agents' live state.
3. Implement the agent's job in `apps/core` (a new module, registered as a `cron.schedule(...)` call in `src/scheduler.ts`), gated by checking `Agent.enabled` for that key before doing any work.
4. Use `log(key, level, message)` from `apps/core/src/logger.ts` to report progress — it updates both the activity feed and the agent's dashboard card.
5. Use `notify(message)` from `apps/core/src/telegram.ts` to alert Mendez directly.
6. If the agent polls a source repeatedly (a "scout"), use `filterUnseen`/`markSeen` from `@max/db` (see Job Scout above) to avoid re-alerting on the same item every run.
7. Add it to `AGENT_RUNNERS` in [apps/core/src/agents/registry.ts](./apps/core/src/agents/registry.ts) — this is what makes both the dashboard's "Run now" button and `npm run trigger:<key>` work for it (see "Manually triggering an agent" above), on top of the cron.schedule() call from step 3.

No dashboard or schema changes needed for a new agent — the card renders from the registry + DB automatically.
