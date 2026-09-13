# Max — Personal AI Agent Hub

See [SPEC.md](./SPEC.md) for the full vision, architecture, and agent roster/build order. This repo currently implements **Phase 0**: the dashboard skeleton and the shared Telegram notification pipe.

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
   - `DASHBOARD_PASSWORD` — the password that gates the web dashboard.
   - `SESSION_SECRET` — any long random string (used to sign the session cookie).
   - `ANTHROPIC_API_KEY` — not used yet in Phase 0, but agents from Phase 1 onward will call Claude through this.

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

## Docker

`docker-compose up --build` runs both services with a shared `./data` volume for the SQLite file. Hosting target isn't decided yet — this setup is meant to run unmodified on a VPS, Railway, Render, or any other Docker-capable host.

## Adding a new agent

1. Add an entry to `AGENT_REGISTRY` in [packages/shared/src/agents.config.ts](./packages/shared/src/agents.config.ts) (key, name, icon, description, phase).
2. Run `npm run db:seed` — it upserts the new row without touching existing agents' live state.
3. Implement the agent's job in `apps/core` (a new module, registered as a `cron.schedule(...)` call in `src/scheduler.ts`), gated by checking `Agent.enabled` for that key before doing any work.
4. Use `log(key, level, message)` from `apps/core/src/logger.ts` to report progress — it updates both the activity feed and the agent's dashboard card.
5. Use `notify(message)` from `apps/core/src/telegram.ts` to alert Mendez directly.

No dashboard or schema changes needed for a new agent — the card renders from the registry + DB automatically.
