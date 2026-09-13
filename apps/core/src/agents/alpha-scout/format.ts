import { RawSignal } from "./types";

/** Telegram message for one signal, per the spec's output format. */
export function formatSignal(signal: RawSignal): string {
  const type = signal.kind === "token-launch" ? "Token Launch Lead" : "Testnet/Airdrop Task";

  const lines = [`*${type}*`];
  if (signal.chain) lines.push(`Chain: ${signal.chain}`);
  lines.push(`Platform: ${signal.source}`);
  if (signal.posterUsername) lines.push(`Poster: ${signal.posterUsername}`);
  lines.push(signal.title);
  lines.push(signal.summary);
  if (signal.deadlineText) lines.push(`Deadline: ${signal.deadlineText}`);
  lines.push(`Found: ${signal.foundAt.toISOString()}`);
  lines.push(signal.url);

  return lines.join("\n");
}
