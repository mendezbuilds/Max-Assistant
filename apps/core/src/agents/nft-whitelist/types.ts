/**
 * "verified" is deliberately never "verified" in this build — see the
 * header comment on sources/nftevening.ts and the README for why genuine
 * contract/mint-site verification isn't something this pipeline can
 * actually perform yet, and why defaulting to unverified (rather than
 * inventing a false sense of confidence) is the responsible choice given
 * the spec's own explicit warning: never present a link as verified unless
 * it's actually been cross-checked.
 */
export interface RawNftLead {
  externalId: string;
  source: string;
  kind: "whitelist" | "ambassador";
  /** Often absent for a project-posted (not individual-posted) lead. */
  posterUsername?: string;
  title: string;
  summary: string;
  url: string;
  foundAt: Date;
  deadlineText?: string;
  verified: boolean;
  /** Human-readable reason for the verified/unverified status shown in the Telegram message. */
  verificationNote: string;
}

export interface NftSource {
  name: string;
  fetch(): Promise<RawNftLead[]>;
}
