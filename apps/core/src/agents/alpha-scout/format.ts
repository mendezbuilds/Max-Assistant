import { RawSignal } from "./types";

/** Escape characters that Telegram's Markdown v1 parser treats specially. */
function escapeMarkdown(text: string): string {
  // In Telegram's legacy Markdown: *, _, `, [ are special.
  // We only escape _ because it causes the most parse failures inside URLs.
  // Bold/italic markup in title/summary is intentional, so we leave * alone.
  return text.replace(/_/g, "\\_");
}

/** Telegram message for one signal, per the spec's output format. */
export function formatSignal(signal: RawSignal): string {
  const type = signal.kind === "token-launch" ? "Token Launch Lead" : "Testnet/Airdrop Task";

  const lines = [`*${type}*`];
  if (signal.chain) lines.push(`Chain: ${signal.chain}`);
  lines.push(`Platform: ${escapeMarkdown(signal.source)}`);
  if (signal.posterUsername) lines.push(`Poster: ${escapeMarkdown(signal.posterUsername)}`);
  lines.push(escapeMarkdown(signal.title));
  lines.push(escapeMarkdown(signal.summary));
  if (signal.deadlineText) lines.push(`Deadline: ${escapeMarkdown(signal.deadlineText)}`);
  lines.push(`Found: ${signal.foundAt.toISOString()}`);
  // URL sent without parse_mode markup — raw link so Telegram auto-previews it
  lines.push(signal.url);

  return lines.join("\n");
}
