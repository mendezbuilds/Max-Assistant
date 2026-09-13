# Max — Personal AI Agent Hub

See [SPEC.md](./SPEC.md) for the full vision, architecture, and agent roster/build order. This repo implements **Phase 0** (dashboard skeleton + shared Telegram notification pipe) and the first Phase 1 agent, **Job Scout**.

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

**Sources implemented:**
- **RemoteOK** ([sources/remoteok.ts](./apps/core/src/agents/job-scout/sources/remoteok.ts)) — public JSON API, no key needed.
- **WeWorkRemotely** ([sources/weworkremotely.ts](./apps/core/src/agents/job-scout/sources/weworkremotely.ts)) — sitewide RSS feed (no JSON API exists).

**Sources stubbed, not built yet** ([sources/stubs.ts](./apps/core/src/agents/job-scout/sources/stubs.ts)) — each needs a decision from you before it's safe/possible to build:
- **X/Twitter** — the search/filtered-stream endpoints needed to watch hashtags and founder announcements require a *paid* X API tier. Needs a budget decision + API key.
- **LinkedIn** — no public API for this; scraping it violates LinkedIn's ToS and risks the account it runs from getting banned. Deliberately not built without your explicit go-ahead given that risk — flagging rather than assuming.
- **DEX/on-chain** — needs a data provider chosen (e.g. DexScreener, Birdeye) and a concrete rule for what counts as a "new launch → hiring signal" worth alerting on.
- **Specific sites you name** — not built (spec left this as "Mendez to name") — tell me which and I'll add them the same way as the two boards above.

Wiring in a real source later is just implementing the `JobSource` interface in `types.ts` and adding it to `ALL_SOURCES` in `index.ts` — nothing else in the pipeline changes.

**How matching works** (see [filter.ts](./apps/core/src/agents/job-scout/filter.ts)): role classification checks the listing's **title + tags only**, not the full description — an early version matched almost every listing because generic words like "developer" show up somewhere in nearly any job description, even unrelated ones. This trades some recall (a role worded unusually in its title might get missed) for far fewer false positives. Expect it to still be imperfect — that's what the Claude-based upgrade mentioned in SPEC.md is for.

**Pay floor**: private feed excludes anything under $10/hr (flags $15/hr+ as 🔥 high priority); co-founder/ambassador/partnership leads skip the pay floor entirely per spec. The public feed's "looser pay floor" isn't a number the spec gave — it's currently set to $0 (still excludes explicitly-unpaid postings). Tune both in `PRIVATE_FEED_OPTIONS`/`PUBLIC_FEED_OPTIONS` in `filter.ts`.

**De-dup**: a shared `SeenItem` table (in `@max/db`) tracks every listing ever fetched per agent, so re-polling never re-alerts on the same posting — built generically so alpha-scout/apartment-scout can reuse it later.

## Docker

`docker-compose up --build` runs both services with a shared `./data` volume for the SQLite file. Hosting target isn't decided yet — this setup is meant to run unmodified on a VPS, Railway, Render, or any other Docker-capable host.

## Adding a new agent

1. Add an entry to `AGENT_REGISTRY` in [packages/shared/src/agents.config.ts](./packages/shared/src/agents.config.ts) (key, name, icon, description, phase).
2. Run `npm run db:seed` — it upserts the new row without touching existing agents' live state.
3. Implement the agent's job in `apps/core` (a new module, registered as a `cron.schedule(...)` call in `src/scheduler.ts`), gated by checking `Agent.enabled` for that key before doing any work.
4. Use `log(key, level, message)` from `apps/core/src/logger.ts` to report progress — it updates both the activity feed and the agent's dashboard card.
5. Use `notify(message)` from `apps/core/src/telegram.ts` to alert Mendez directly.
6. If the agent polls a source repeatedly (a "scout"), use `filterUnseen`/`markSeen` from `@max/db` (see Job Scout above) to avoid re-alerting on the same item every run.

No dashboard or schema changes needed for a new agent — the card renders from the registry + DB automatically.
