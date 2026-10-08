export interface Transfer {
  signature: string;
  slot: number;
  /** Unix seconds. */
  blockTime: number;
  from: string;
  to: string;
  lamports: number;
}

/** A transaction the wallet signed. */
export interface Activity {
  signature: string;
  slot: number;
  blockTime: number;
  /** Program ids invoked at the top level of the transaction. */
  programs: string[];
}

export interface WalletHistory {
  address: string;
  /** SOL transfers into or out of this wallet. */
  transfers: Transfer[];
  activity: Activity[];
  /** True if the history reaches back to the wallet's first transaction. */
  complete: boolean;
}

export type Label = "exchange" | "bridge" | "program" | "ignore";
export type Labels = Record<string, Label>;

export type SignalName = "shared_funder" | "shared_sweep" | "funding_chain" | "exchange_burst" | "lockstep";

export interface Evidence {
  signal: SignalName;
  /** In [0, 1]. How much this one piece of evidence counts. */
  weight: number;
  /** One plain sentence a wallet owner can read. */
  summary: string;
  /** Every cohort wallet this evidence links together, sorted. */
  wallets: string[];
  /** Addresses, signatures and numbers behind the summary. */
  details: Record<string, unknown>;
}

export type Verdict = "clear" | "review" | "sybil";

export interface WalletResult {
  address: string;
  score: number;
  verdict: Verdict;
  clusterId: number | null;
  evidence: Evidence[];
  notes: string[];
}

export interface Cluster {
  id: number;
  wallets: string[];
  signals: SignalName[];
}

export interface Report {
  version: string;
  config: import("./config.js").Config;
  wallets: WalletResult[];
  clusters: Cluster[];
}
