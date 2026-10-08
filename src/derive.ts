import type { Transfer, WalletHistory } from "./types.js";

/** Chain order: slot first, then signature so ties are stable. */
export function byChainOrder(a: { slot: number; signature: string }, b: { slot: number; signature: string }): number {
  return a.slot - b.slot || (a.signature < b.signature ? -1 : a.signature > b.signature ? 1 : 0);
}

/** The earliest inbound SOL transfer, or null. */
export function firstFunding(w: WalletHistory): Transfer | null {
  const inbound = w.transfers.filter((t) => t.to === w.address && t.from !== w.address && t.lamports > 0);
  if (inbound.length === 0) return null;
  return [...inbound].sort(byChainOrder)[0] ?? null;
}

/** The latest outbound transfer, if it moved at least `minShare` of everything the wallet received. */
export function sweep(w: WalletHistory, minShare: number): Transfer | null {
  const inbound = w.transfers.filter((t) => t.to === w.address && t.from !== w.address);
  const outbound = w.transfers.filter((t) => t.from === w.address && t.to !== w.address && t.lamports > 0);
  if (outbound.length === 0) return null;
  const last = [...outbound].sort(byChainOrder).at(-1)!;
  const received = inbound.reduce((sum, t) => sum + t.lamports, 0);
  if (received === 0 || last.lamports < received * minShare) return null;
  return last;
}
