const path = require("node:path");

// This is a monorepo — the dashboard's own directory has no .env of its own.
// Load the repo-root .env before Next.js boots so DASHBOARD_PASSWORD /
// SESSION_SECRET (read from process.env in proxy.ts and the route handlers)
// are available. NEXT_PUBLIC_* vars still work as usual via Next's own
// loading; this only fills in the server-only ones Next wouldn't find.
require("dotenv").config({ path: path.resolve(__dirname, "..", "..", ".env") });

// Point @max/db at the shared sqlite file. This must be computed here, in
// next.config.js (a plain, unbundled Node file), not inside @max/db itself —
// Next's bundler inlines that package's code into its own .next chunk
// files, which would make a __dirname computed there resolve to the wrong
// place. See the comment on DB_PATH in packages/db/src/client.ts.
process.env.MAX_DB_FILE ??= path.resolve(__dirname, "..", "..", "data", "max.db");

/** @type {import('next').NextConfig} */
const nextConfig = {
  // @max/db and @max/shared are plain TS workspace packages (not prebuilt
  // before `next dev`), so Next needs to transpile them itself.
  transpilePackages: ["@max/db", "@max/shared"],
};

module.exports = nextConfig;
