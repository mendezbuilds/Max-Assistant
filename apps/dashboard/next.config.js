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

// Same reasoning, same fix, for lib/core-control.ts: it needs the repo
// root to find node_modules/.bin/tsx.cmd and apps/core, and __dirname
// inside that file (bundled app code) would resolve wrong at runtime for
// the exact reason described above.
process.env.MAX_REPO_ROOT ??= path.resolve(__dirname, "..", "..");

// NOTE on react-three-fiber (tried and reverted for the orbit view's 3D
// scene): @react-three/fiber 8.x + react-reconciler 0.27 hit "Cannot read
// properties of undefined (reading 'ReactCurrentOwner')" on mount, under
// both Turbopack and webpack. Root cause, confirmed by reading the actual
// compiled chunk: Next 16's bundler aliases every client-side `react`
// import to its own internally vendored copy at next/dist/compiled/react —
// which for 16.3.5 is a React 19 canary build — regardless of what
// react/react-dom version is installed or forced via npm "overrides" in the
// root package.json. React 19 renamed the shared-internals export
// react-reconciler 0.27 reads (__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED)
// to __CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE, so the
// old name is undefined and reading .ReactCurrentOwner off it throws. No
// version pin can fix this — Next substitutes its own React copy in the
// client bundle no matter what's on disk. A real fix would mean upgrading
// to @react-three/fiber 9.x (targets React 19), not touching react/react-dom
// versions here.
/** @type {import('next').NextConfig} */
const nextConfig = {
  // @max/db and @max/shared are plain TS workspace packages (not prebuilt
  // before `next dev`), so Next needs to transpile them itself.
  transpilePackages: ["@max/db", "@max/shared"],
  // Local Whisper transcription (lib/whisper.ts) pulls in onnxruntime-node's
  // prebuilt native .node binary and ffmpeg-static's native binary — Next's
  // bundler doesn't know what to do with either and will otherwise try to
  // trace/inline them, breaking at runtime. Marking them external tells
  // Next to leave these as plain require() calls resolved from
  // node_modules at runtime instead.
  serverExternalPackages: ["onnxruntime-node", "@huggingface/transformers", "ffmpeg-static"],
};

module.exports = nextConfig;

// trigger restart
