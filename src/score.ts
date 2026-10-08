import { resolveConfig, type Config } from "./config.js";
import { fundingSignals, round } from "./signals/funding.js";
import { lockstepSignals } from "./signals/lockstep.js";
import { UnionFind } from "./unionfind.js";
import type { Cluster, Evidence, Labels, Report, SignalName, Verdict, WalletHistory, WalletResult } from "./types.js";

export const VERSION = "0.1.0";

export interface AnalyzeOptions {
  labels?: Labels;
  config?: Partial<Config>;
}

/** Noisy-OR: 1 - product(1 - w). */
export function combine(weights: number[]): number {
  return round(1 - weights.reduce((p, w) => p * (1 - w), 1));
}

export function verdictFor(score: number, cfg: Config): Verdict {
  if (score >= cfg.thresholds.sybil) return "sybil";
  if (score >= cfg.thresholds.review) return "review";
  return "clear";
}

/**
 * Score every wallet in the cohort against the others. Pure and deterministic: the same histories, labels and
 * config always give the same report.
 */
export function analyze(histories: WalletHistory[], opts: AnalyzeOptions = {}): Report {
  const cfg = resolveConfig(opts.config);
  const labels = opts.labels ?? {};

  // One history per address, sorted, so input order never matters.
  const byAddress = new Map<string, WalletHistory>();
  for (const h of histories) if (!byAddress.has(h.address)) byAddress.set(h.address, h);
  const cohort = [...byAddress.values()].sort((a, b) => (a.address < b.address ? -1 : 1));

  const evidence = [...fundingSignals(cohort, labels, cfg), ...lockstepSignals(cohort, cfg)];

  const perWallet = new Map<string, Evidence[]>();
  const uf = new UnionFind();
  for (const e of evidence) {
    for (const w of e.wallets) {
      if (!byAddress.has(w)) continue;
      const list = perWallet.get(w) ?? [];
      list.push(e);
      perWallet.set(w, list);
    }
    const inCohort = e.wallets.filter((w) => byAddress.has(w));
    for (let i = 1; i < inCohort.length; i++) uf.union(inCohort[0]!, inCohort[i]!);
  }

  const linked = [...perWallet.keys()];
  const clusters: Cluster[] = uf
    .groups(linked)
    .filter((g) => g.length >= 2)
    .map((wallets, i) => {
      const set = new Set(wallets);
      const signals = new Set<SignalName>();
      for (const e of evidence) if (e.wallets.some((w) => set.has(w))) signals.add(e.signal);
      return { id: i + 1, wallets, signals: [...signals].sort() };
    });
  const clusterOf = new Map<string, number>();
  for (const c of clusters) for (const w of c.wallets) clusterOf.set(w, c.id);

  const wallets: WalletResult[] = cohort.map((h) => {
    const ev = (perWallet.get(h.address) ?? []).slice().sort((a, b) => b.weight - a.weight || (a.signal < b.signal ? -1 : 1));
    const score = combine(ev.map((e) => e.weight));
    const notes: string[] = [];
    if (!h.complete) notes.push("History is incomplete, so funding signals could not check this wallet's first funder.");
    if (h.activity.length === 0 && h.transfers.length === 0) notes.push("No on-chain history was found for this wallet.");
    return { address: h.address, score, verdict: verdictFor(score, cfg), clusterId: clusterOf.get(h.address) ?? null, evidence: ev, notes };
  });

  return { version: VERSION, config: cfg, wallets, clusters };
}
