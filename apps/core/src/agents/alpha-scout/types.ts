/** One signal a source found. No role/pay filtering here (unlike job-scout) — the spec for this agent doesn't call for it, so nothing is invented. */
export interface RawSignal {
  /** Unique within its source; combined with the source name for the SeenItem key. */
  externalId: string;
  source: string; // e.g. "Covalent (Base)", "airdrops.io"
  kind: "token-launch" | "testnet-airdrop";
  /** Only meaningful for token launches. */
  chain?: string;
  /** Token launches often have no individual poster — leave unset rather than inventing one. */
  posterUsername?: string;
  title: string;
  summary: string;
  url: string;
  /** When we found it (not necessarily when the underlying thing happened) — these are time-sensitive per spec, so this is always set. */
  foundAt: Date;
  /** Raw snippet mentioning a deadline, if the source's own content mentioned one. Unset, not a guess, when none was found. */
  deadlineText?: string;
}

export interface AlphaSource {
  name: string;
  fetch(): Promise<RawSignal[]>;
}
