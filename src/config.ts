export interface Config {
  /** A latest outbound transfer counts as a sweep if it moved at least this share of everything received. */
  sweepMinShare: number;
  /** A funder of this many cohort wallets is treated as an unlabeled service (a hub), like an exchange. */
  hubFanout: number;
  /** exchange_burst: max gap in seconds between consecutive withdrawals in one burst. */
  burstWindowSec: number;
  /** exchange_burst: max relative difference between neighboring amounts. */
  amountTolerance: number;
  /** exchange_burst: smallest group that counts. */
  burstMinSize: number;
  /** lockstep: two transactions match if they are this close in seconds and share a program. */
  lockstepWindowSec: number;
  /** lockstep: moments with more distinct wallets than this are skipped as crowded. */
  crowdLimit: number;
  /** lockstep: smallest number of matched transactions for a pair. */
  lockstepMinMatches: number;
  /** lockstep: smallest matches / min(txCount) for a pair. */
  lockstepMinRatio: number;
  /** Programs ignored when comparing what two transactions did. */
  plumbingPrograms: string[];
  /** Scores at or above `review` are "review", at or above `sybil` are "sybil". */
  thresholds: { review: number; sybil: number };
}

export const DEFAULT_CONFIG: Config = {
  sweepMinShare: 0.5,
  hubFanout: 200,
  burstWindowSec: 600,
  amountTolerance: 0.02,
  burstMinSize: 3,
  lockstepWindowSec: 60,
  crowdLimit: 25,
  lockstepMinMatches: 5,
  lockstepMinRatio: 0.5,
  plumbingPrograms: [
    "11111111111111111111111111111111", // System
    "ComputeBudget111111111111111111111111111111",
    "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr",
    "Memo1UhkJRfHyvLMcVucJwxXeuD728EqVDDwQDxFMNo",
    "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
    "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
    "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
  ],
  thresholds: { review: 0.3, sybil: 0.7 },
};

export function resolveConfig(partial: Partial<Config> = {}): Config {
  return {
    ...DEFAULT_CONFIG,
    ...partial,
    thresholds: { ...DEFAULT_CONFIG.thresholds, ...partial.thresholds },
  };
}
