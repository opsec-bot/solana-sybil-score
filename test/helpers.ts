import type { Activity, Transfer, WalletHistory } from "../src/types.js";

export const SOL = 1_000_000_000;
export const T0 = 1_760_000_000; // a fixed start time
export const SWAP = "SwapProgram1111111111111111111111111111111";
export const MINT = "MintProgram1111111111111111111111111111111";
export const SYSTEM = "11111111111111111111111111111111";

let sigCounter = 0;
export const sig = (tag = "s") => `${tag}${(++sigCounter).toString().padStart(8, "0")}`;

/** Builds wallet histories by replaying transfers and actions, so both sides of a transfer agree. */
export class World {
  private wallets = new Map<string, WalletHistory>();

  wallet(address: string, complete = true): WalletHistory {
    let w = this.wallets.get(address);
    if (!w) this.wallets.set(address, (w = { address, transfers: [], activity: [], complete }));
    return w;
  }

  transfer(from: string, to: string, sol: number, time: number): Transfer {
    const t: Transfer = { signature: sig("t"), slot: time, blockTime: time, from, to, lamports: Math.round(sol * SOL) };
    this.wallet(from).transfers.push(t);
    this.wallet(to).transfers.push(t);
    // The sender signed it.
    this.wallet(from).activity.push({ signature: t.signature, slot: time, blockTime: time, programs: [SYSTEM] });
    return t;
  }

  act(address: string, time: number, programs: string[]): Activity {
    const a: Activity = { signature: sig("a"), slot: time, blockTime: time, programs };
    this.wallet(address).activity.push(a);
    return a;
  }

  /** Only the listed addresses, as the cohort a project would score. */
  cohort(addresses: string[]): WalletHistory[] {
    return addresses.map((a) => this.wallet(a));
  }
}

/** Small deterministic PRNG so "random" honest users are the same every run. */
export function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A realistic mixed cohort:
 * - 40 honest users, each funded by their own address or by Binance at random times and amounts
 * - a star farm: 8 wallets funded by one operator address, all swept back to one collector
 * - a peel chain: farm-chain-0 funds 1 funds 2 funds 3
 * - an exchange burst: 6 wallets withdrawn from Binance within 3 minutes, all 0.5 SOL
 * - a lockstep farm: 4 wallets (with separate funders) swapping within seconds of each other, 12 times
 * - a crowded mint moment where 30 honest users mint in the same minute
 */
export function scenario() {
  const w = new World();
  const r = rng(42);
  const honest: string[] = [];
  for (let i = 0; i < 40; i++) {
    const a = `honest-${String(i).padStart(2, "0")}`;
    honest.push(a);
    const t = T0 + Math.floor(r() * 90 * 86400);
    if (i % 2 === 0) w.transfer(`own-funder-${i}`, a, 0.1 + r() * 5, t);
    else w.transfer("binance", a, 0.1 + r() * 5, t);
    for (let k = 0; k < 6; k++) w.act(a, t + 3600 + Math.floor(r() * 30 * 86400), [SWAP]);
  }
  // Crowded mint: honest users all mint inside one minute.
  for (let i = 0; i < 30; i++) w.act(honest[i]!, T0 + 100 * 86400 + i, [MINT]);

  const star: string[] = [];
  for (let i = 0; i < 8; i++) {
    const a = `farm-star-${i}`;
    star.push(a);
    w.transfer("operator", a, 0.05, T0 + 5 * 86400 + i * 400);
    w.act(a, T0 + 6 * 86400 + i * 900, [SWAP]);
    w.transfer(a, "collector", 0.045, T0 + 40 * 86400 + i * 900);
  }

  const chain = ["farm-chain-0", "farm-chain-1", "farm-chain-2", "farm-chain-3"];
  w.transfer("chain-root-cex", chain[0]!, 2, T0 + 10 * 86400);
  for (let i = 1; i < chain.length; i++) w.transfer(chain[i - 1]!, chain[i]!, 2 - i * 0.4, T0 + 10 * 86400 + i * 3600);

  const burst: string[] = [];
  for (let i = 0; i < 6; i++) {
    const a = `farm-burst-${i}`;
    burst.push(a);
    w.transfer("binance", a, 0.5, T0 + 20 * 86400 + i * 30);
  }

  const lockstep: string[] = [];
  for (let i = 0; i < 4; i++) {
    const a = `farm-lock-${i}`;
    lockstep.push(a);
    w.transfer(`lock-funder-${i}`, a, 1 + i, T0 + i * 7 * 86400);
    for (let k = 0; k < 12; k++) w.act(a, T0 + 30 * 86400 + k * 7200 + i * 5, [SWAP]);
  }

  const all = [...honest, ...star, ...chain, ...burst, ...lockstep];
  return { world: w, cohort: w.cohort(all), honest, star, chain, burst, lockstep, labels: { binance: "exchange" as const, "chain-root-cex": "exchange" as const } };
}
