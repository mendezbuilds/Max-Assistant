import path from "node:path";
import { PrismaClient } from "@prisma/client";

/**
 * Both apps/core and apps/dashboard import this client, but each app must
 * end up pointing at the same sqlite file (repo-root data/max.db).
 *
 * Each app's own entry point (apps/core/src/index.ts, apps/dashboard's
 * next.config.js) sets MAX_DB_FILE to an absolute path before this module
 * loads. That indirection matters for the dashboard specifically: Next.js's
 * bundler inlines this package's compiled code into its own .next chunk
 * files, so a __dirname computed *inside this file* would resolve relative
 * to wherever Next relocated that chunk, not to packages/db/dist — only
 * __dirname computed in an unbundled entry file (next.config.js, a plain
 * Node process) is reliable. Falling back to a __dirname guess here only
 * helps unbundled consumers (e.g. running prisma/seed.ts directly via tsx).
 */
const DB_PATH =
  process.env.MAX_DB_FILE ?? path.resolve(__dirname, "..", "..", "..", "data", "max.db");

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    datasources: { db: { url: `file:${DB_PATH}` } },
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
