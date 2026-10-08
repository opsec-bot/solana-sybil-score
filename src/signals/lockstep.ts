import type { Config } from "../config.js";
import { UnionFind } from "../unionfind.js";
import type { Evidence, WalletHistory } from "../types.js";
import { round } from "./funding.js";

interface Event {
  wallet: string;
  signature: string;
  blockTime: number;
  programs: Set<string>;
}

interface PairStat {
  a: string;
  b: string;
  matches: number;
  ratio: number;
  examples: [string, string][];
}

/**
 * lockstep: wallets that keep sending transactions to the same programs within seconds of each other.
 * Crowded moments (a popular mint, a launch) are skipped since many honest wallets act together there.
 */
export function lockstepSignals(cohort: WalletHistory[], cfg: Config): Evidence[] {
  const plumbing = new Set(cfg.plumbingPrograms);
  const events: Event[] = [];
  const txCount = new Map<string, number>();
  for (const w of cohort) {
    const seen = new Set<string>();
    for (const a of w.activity) {
      if (seen.has(a.signature)) continue;
      seen.add(a.signature);
      const programs = new Set(a.programs.filter((p) => !plumbing.has(p)));
      if (programs.size === 0) continue;
      events.push({ wallet: w.address, signature: a.signature, blockTime: a.blockTime, programs });
    }
    txCount.set(w.address, seen.size);
  }
  events.sort((x, y) => x.blockTime - y.blockTime || cmp(x.wallet, y.wallet) || cmp(x.signature, y.signature));

  const W = cfg.lockstepWindowSec;
  const crowded = markCrowded(events, W, cfg.crowdLimit);

  // directed[a][b] = how many of a's events have a matching event from b.
  const directed = new Map<string, Map<string, number>>();
  const examples = new Map<string, [string, string][]>();
  let lo = 0;
  for (let i = 0; i < events.length; i++) {
    const e = events[i]!;
    if (crowded[i]) continue;
    while (events[lo]!.blockTime < e.blockTime - W) lo++;
    const matched = new Set<string>();
    for (let j = lo; j < events.length && events[j]!.blockTime <= e.blockTime + W; j++) {
      const o = events[j]!;
      if (crowded[j] || o.wallet === e.wallet || o.signature === e.signature || matched.has(o.wallet)) continue;
      if (!shares(e.programs, o.programs)) continue;
      matched.add(o.wallet);
      let row = directed.get(e.wallet);
      if (!row) directed.set(e.wallet, (row = new Map()));
      row.set(o.wallet, (row.get(o.wallet) ?? 0) + 1);
      if (e.wallet < o.wallet) {
        const key = e.wallet + "|" + o.wallet;
        const ex = examples.get(key) ?? [];
        if (ex.length < 3) ex.push([e.signature, o.signature]);
        examples.set(key, ex);
      }
    }
  }

  const pairs: PairStat[] = [];
  for (const [a, row] of directed) {
    for (const [b, ab] of row) {
      if (a >= b) continue;
      const matches = Math.min(ab, directed.get(b)?.get(a) ?? 0);
      const ratio = matches / Math.min(txCount.get(a)!, txCount.get(b)!);
      if (matches < cfg.lockstepMinMatches || ratio < cfg.lockstepMinRatio) continue;
      pairs.push({ a, b, matches, ratio: round(ratio), examples: examples.get(a + "|" + b) ?? [] });
    }
  }
  if (pairs.length === 0) return [];

  const uf = new UnionFind();
  const members = new Set<string>();
  for (const p of pairs) {
    uf.union(p.a, p.b);
    members.add(p.a).add(p.b);
  }
  const out: Evidence[] = [];
  for (const wallets of uf.groups(members)) {
    const set = new Set(wallets);
    const groupPairs = pairs.filter((p) => set.has(p.a)).sort((x, y) => cmp(x.a, y.a) || cmp(x.b, y.b));
    const r = groupPairs.reduce((s, p) => s + p.ratio, 0) / groupPairs.length;
    const weight = round(Math.min(0.85, r * (1 - Math.pow(0.7, wallets.length))));
    out.push({
      signal: "lockstep",
      weight,
      summary: `Repeatedly used the same programs within ${W}s of ${wallets.length - 1} other wallet(s) in this list.`,
      wallets,
      details: { windowSec: W, averageRatio: round(r), pairs: groupPairs },
    });
  }
  return out;
}

/** An event is crowded if more than `limit` distinct wallets act within the window around it. */
function markCrowded(events: Event[], W: number, limit: number): boolean[] {
  const crowded = new Array<boolean>(events.length).fill(false);
  const counts = new Map<string, number>();
  let lo = 0;
  let hi = 0;
  for (let i = 0; i < events.length; i++) {
    const t = events[i]!.blockTime;
    while (hi < events.length && events[hi]!.blockTime <= t + W) {
      const w = events[hi]!.wallet;
      counts.set(w, (counts.get(w) ?? 0) + 1);
      hi++;
    }
    while (events[lo]!.blockTime < t - W) {
      const w = events[lo]!.wallet;
      const c = counts.get(w)! - 1;
      if (c === 0) counts.delete(w);
      else counts.set(w, c);
      lo++;
    }
    crowded[i] = counts.size > limit;
  }
  return crowded;
}

function shares(a: Set<string>, b: Set<string>): boolean {
  for (const x of a) if (b.has(x)) return true;
  return false;
}

function cmp(a: string, b: string) {
  return a < b ? -1 : a > b ? 1 : 0;
}
