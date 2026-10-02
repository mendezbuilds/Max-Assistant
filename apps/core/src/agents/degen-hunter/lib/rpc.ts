import { Connection } from "@solana/web3.js";

/**
 * The Solana RPC endpoint, read when it's USED, not when this module loads.
 *
 * It used to be a module-level constant (`const SOLANA_RPC_ENDPOINT = process.env…`).
 * apps/core's entry point calls dotenv.config() and then imports modules, but tsx
 * (esbuild) hoists imports above that call, so those modules loaded first, saw no
 * variable, and froze the public mainnet-beta default into the constant — ignoring
 * a configured QuickNode/Helius endpoint entirely (and getting rate-limited with
 * 429s on getTokenLargestAccounts every time).
 */
const DEFAULT_ENDPOINT = "https://api.mainnet-beta.solana.com";

export function rpcEndpoint(): string {
  return process.env.SOLANA_RPC_ENDPOINT?.trim() || DEFAULT_ENDPOINT;
}

/** Host only. Provider URLs carry the API key in the path (QuickNode) or query (Helius), so only the host is ever logged. */
export function rpcHost(): string {
  try {
    return new URL(rpcEndpoint()).host;
  } catch {
    return "(invalid SOLANA_RPC_ENDPOINT)";
  }
}

/** Strips the endpoint — and so its API key — out of an error message before it is logged or shown. */
export function redactRpc(message: string): string {
  const endpoint = rpcEndpoint();
  let out = message.split(endpoint).join(`https://${rpcHost()}`);
  try {
    const u = new URL(endpoint);
    if (u.pathname.length > 1) out = out.split(u.pathname).join("/…");
    if (u.search) out = out.split(u.search).join("");
  } catch { /* not a URL: nothing more to strip */ }
  return out;
}

let cached: { endpoint: string; connection: Connection } | null = null;

/** A web3.js Connection to the current endpoint (rebuilt if the endpoint changes). */
export function getConnection(): Connection {
  const endpoint = rpcEndpoint();
  if (!cached || cached.endpoint !== endpoint) cached = { endpoint, connection: new Connection(endpoint, "confirmed") };
  return cached.connection;
}
