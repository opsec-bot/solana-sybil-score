import type { Config } from "../config.js";
import { firstFunding, sweep } from "../derive.js";
import { UnionFind } from "../unionfind.js";
import type { Evidence, Labels, Transfer, WalletHistory } from "../types.js";

/** 1 - base^(n-1), capped. The shared weight curve for group signals. */
export function groupWeight(n: number, base: number, cap: number): number {
  return round(Math.min(cap, 1 - Math.pow(base, n - 1)));
}

export function round(x: number): number {
  return Math.round(x * 10000) / 10000;
}

const sol = (lamports: number) => lamports / 1e9;

interface Funded {
  wallet: string;
  transfer: Transfer;
}

/**
 * The funding graph signals: shared_funder, shared_sweep, funding_chain and exchange_burst.
 * Only wallets with complete history take part in the funder based signals, since for the others we cannot be sure
 * the earliest transfer we saw is the real first one.
 */
export function fundingSignals(cohort: WalletHistory[], labels: Labels, cfg: Config): Evidence[] {
  const inCohort = new Set(cohort.map((w) => w.address));
  const evidence: Evidence[] = [];

  const byFunder = new Map<string, Funded[]>();
  const chainEdges: Funded[] = [];
  for (const w of cohort) {
    if (!w.complete) continue;
    const t = firstFunding(w);
    if (!t) continue;
    const label = labels[t.from];
    if (label === "ignore" || label === "program") continue;
    if (inCohort.has(t.from) && !label) {
      chainEdges.push({ wallet: w.address, transfer: t });
      continue;
    }
    push(byFunder, t.from, { wallet: w.address, transfer: t });
  }

  // shared_funder, or exchange_burst for exchanges, bridges and hubs.
  for (const [funder, group] of sorted(byFunder)) {
    const label = labels[funder];
    const isHub = !label && group.length >= cfg.hubFanout;
    if (label === "exchange" || label === "bridge" || isHub) {
      evidence.push(...exchangeBursts(funder, isHub ? "hub" : label!, group, cfg));
      continue;
    }
    if (group.length < 2) continue;
    const wallets = group.map((g) => g.wallet).sort();
    evidence.push({
      signal: "shared_funder",
      weight: groupWeight(wallets.length, 0.75, 0.9),
      summary: `First funded by ${funder}, the same address that first funded ${wallets.length - 1} other wallet(s) in this list.`,
      wallets,
      details: { funder, fundings: group.map(fundingDetail).sort(byWallet) },
    });
  }

  // funding_chain: components of cohort-to-cohort first funding edges.
  if (chainEdges.length > 0) {
    const uf = new UnionFind();
    const members = new Set<string>();
    for (const e of chainEdges) {
      uf.union(e.wallet, e.transfer.from);
      members.add(e.wallet).add(e.transfer.from);
    }
    for (const wallets of uf.groups(members)) {
      const set = new Set(wallets);
      const edges = chainEdges.filter((e) => set.has(e.wallet)).map(fundingDetail).sort(byWallet);
      evidence.push({
        signal: "funding_chain",
        weight: groupWeight(wallets.length, 0.75, 0.9),
        summary: `Part of a group of ${wallets.length} wallets in this list where each was first funded by another one in the group.`,
        wallets,
        details: { edges },
      });
    }
  }

  // shared_sweep: wallets that emptied into the same unlabeled address.
  const bySweep = new Map<string, Funded[]>();
  for (const w of cohort) {
    const t = sweep(w, cfg.sweepMinShare);
    if (!t || labels[t.to]) continue;
    push(bySweep, t.to, { wallet: w.address, transfer: t });
  }
  for (const [dest, group] of sorted(bySweep)) {
    if (group.length < 2) continue;
    const wallets = group.map((g) => g.wallet).sort();
    evidence.push({
      signal: "shared_sweep",
      weight: groupWeight(wallets.length, 0.75, 0.9),
      summary: `Sent most of its SOL to ${dest}, the same address ${wallets.length - 1} other wallet(s) in this list emptied into.`,
      wallets,
      details: {
        destination: dest,
        sweeps: group
          .map((g) => ({ wallet: g.wallet, signature: g.transfer.signature, sol: sol(g.transfer.lamports), blockTime: g.transfer.blockTime }))
          .sort(byWallet),
      },
    });
  }

  return evidence;
}

/** Withdrawals from one exchange that came in a tight burst with near equal amounts. */
function exchangeBursts(funder: string, kind: string, group: Funded[], cfg: Config): Evidence[] {
  const out: Evidence[] = [];
  const byTime = [...group].sort((a, b) => a.transfer.blockTime - b.transfer.blockTime || cmp(a.wallet, b.wallet));
  const bursts: Funded[][] = [];
  for (const f of byTime) {
    const cur = bursts.at(-1);
    if (cur && f.transfer.blockTime - cur.at(-1)!.transfer.blockTime <= cfg.burstWindowSec) cur.push(f);
    else bursts.push([f]);
  }
  for (const burst of bursts) {
    if (burst.length < cfg.burstMinSize) continue;
    const byAmount = [...burst].sort((a, b) => a.transfer.lamports - b.transfer.lamports || cmp(a.wallet, b.wallet));
    const groups: Funded[][] = [];
    for (const f of byAmount) {
      const cur = groups.at(-1);
      const prev = cur?.at(-1)?.transfer.lamports;
      if (cur && prev !== undefined && f.transfer.lamports - prev <= prev * cfg.amountTolerance) cur.push(f);
      else groups.push([f]);
    }
    for (const g of groups) {
      if (g.length < cfg.burstMinSize) continue;
      const wallets = g.map((x) => x.wallet).sort();
      const times = g.map((x) => x.transfer.blockTime);
      const span = Math.max(...times) - Math.min(...times);
      out.push({
        signal: "exchange_burst",
        weight: groupWeight(wallets.length, 0.8, 0.8),
        summary: `Funded by ${kind} ${funder} within ${span}s of ${wallets.length - 1} other wallet(s) in this list, all with nearly the same amount.`,
        wallets,
        details: { funder, kind, spanSec: span, fundings: g.map(fundingDetail).sort(byWallet) },
      });
    }
  }
  return out;
}

function fundingDetail(f: Funded) {
  return {
    wallet: f.wallet,
    from: f.transfer.from,
    signature: f.transfer.signature,
    sol: sol(f.transfer.lamports),
    blockTime: f.transfer.blockTime,
  };
}

function push<K, V>(m: Map<K, V[]>, k: K, v: V) {
  const arr = m.get(k);
  if (arr) arr.push(v);
  else m.set(k, [v]);
}

function sorted<V>(m: Map<string, V>): [string, V][] {
  return [...m.entries()].sort((a, b) => cmp(a[0], b[0]));
}

function cmp(a: string, b: string) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function byWallet(a: { wallet: string }, b: { wallet: string }) {
  return cmp(a.wallet, b.wallet);
}
