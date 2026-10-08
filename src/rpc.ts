import type { Activity, Transfer, WalletHistory } from "./types.js";

const SYSTEM_PROGRAM = "11111111111111111111111111111111";

/** The parts of a `getTransaction` (jsonParsed) result we read. */
export interface ParsedTx {
  slot: number;
  blockTime: number | null;
  meta: { err: unknown; innerInstructions?: { instructions: ParsedIx[] }[] | null } | null;
  transaction: { signatures: string[]; message: { accountKeys: { pubkey: string; signer: boolean }[]; instructions: ParsedIx[] } };
}

interface ParsedIx {
  programId: string;
  program?: string;
  parsed?: { type?: string; info?: Record<string, unknown> } | string;
}

/** SOL movements of one transaction as seen from `wallet`, plus its top level programs if the wallet signed it. */
export function parseTransaction(tx: ParsedTx, wallet: string): { transfers: Transfer[]; activity: Activity | null } {
  const signature = tx.transaction.signatures[0]!;
  const blockTime = tx.blockTime ?? 0;
  if (tx.meta?.err) return { transfers: [], activity: null };

  const outer = tx.transaction.message.instructions;
  const inner = (tx.meta?.innerInstructions ?? []).flatMap((i) => i.instructions);
  const transfers: Transfer[] = [];
  for (const ix of [...outer, ...inner]) {
    const move = solMovement(ix);
    if (!move || (move.from !== wallet && move.to !== wallet)) continue;
    transfers.push({ signature, slot: tx.slot, blockTime, ...move });
  }
  // Only transactions the wallet signed count as its own activity. Being sent spam is not behavior.
  const signed = tx.transaction.message.accountKeys.some((k) => k.pubkey === wallet && k.signer);
  if (!signed) return { transfers, activity: null };
  const programs = [...new Set(outer.map((ix) => ix.programId))].sort();
  return { transfers, activity: { signature, slot: tx.slot, blockTime, programs } };
}

function solMovement(ix: ParsedIx): { from: string; to: string; lamports: number } | null {
  if (ix.programId !== SYSTEM_PROGRAM || typeof ix.parsed !== "object" || !ix.parsed.info) return null;
  const info = ix.parsed.info;
  const lamports = Number(info.lamports ?? 0);
  switch (ix.parsed.type) {
    case "transfer":
    case "transferWithSeed":
      return { from: String(info.source), to: String(info.destination), lamports };
    case "createAccount":
    case "createAccountWithSeed":
      return { from: String(info.source), to: String(info.newAccount), lamports };
    default:
      return null;
  }
}

export interface RpcProviderOptions {
  /** Stop paging back after this many signatures per wallet. History is then marked incomplete. */
  maxSignatures?: number;
  /** Parallel getTransaction calls. */
  concurrency?: number;
  /** Retries for HTTP 429 and 5xx. */
  retries?: number;
  fetch?: typeof fetch;
}

/** Builds wallet histories from any standard Solana JSON-RPC endpoint. */
export class RpcProvider {
  private id = 0;
  private readonly maxSignatures: number;
  private readonly concurrency: number;
  private readonly retries: number;
  private readonly fetchFn: typeof fetch;

  constructor(private readonly url: string, opts: RpcProviderOptions = {}) {
    this.maxSignatures = opts.maxSignatures ?? 1000;
    this.concurrency = opts.concurrency ?? 4;
    this.retries = opts.retries ?? 8;
    this.fetchFn = opts.fetch ?? fetch;
  }

  async history(address: string): Promise<WalletHistory> {
    const sigs: string[] = [];
    let before: string | undefined;
    let complete = false;
    while (sigs.length < this.maxSignatures) {
      const limit = Math.min(1000, this.maxSignatures - sigs.length);
      const page = await this.call<{ signature: string }[]>("getSignaturesForAddress", [address, { limit, ...(before ? { before } : {}) }]);
      sigs.push(...page.map((p) => p.signature));
      if (page.length < limit) {
        complete = true;
        break;
      }
      before = page.at(-1)!.signature;
    }

    const transfers: Transfer[] = [];
    const activity: Activity[] = [];
    await pool(sigs, this.concurrency, async (sig) => {
      const tx = await this.call<ParsedTx | null>("getTransaction", [sig, { encoding: "jsonParsed", maxSupportedTransactionVersion: 1 }]);
      if (!tx) return;
      const parsed = parseTransaction(tx, address);
      transfers.push(...parsed.transfers);
      if (parsed.activity) activity.push(parsed.activity);
    });
    const order = (a: { slot: number; signature: string }, b: { slot: number; signature: string }) =>
      a.slot - b.slot || (a.signature < b.signature ? -1 : 1);
    return { address, transfers: transfers.sort(order), activity: activity.sort(order), complete };
  }

  async histories(addresses: string[], onProgress?: (done: number, total: number) => void): Promise<WalletHistory[]> {
    const out: WalletHistory[] = [];
    for (const a of addresses) {
      out.push(await this.history(a));
      onProgress?.(out.length, addresses.length);
    }
    return out;
  }

  private async call<T>(method: string, params: unknown[]): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      const res = await this.fetchFn(this.url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: ++this.id, method, params }),
      });
      if ((res.status === 429 || res.status >= 500) && attempt < this.retries) {
        const retryAfter = Number(res.headers.get("retry-after"));
        const wait = retryAfter > 0 ? retryAfter * 1000 : Math.min(10_000, 500 * 2 ** attempt);
        await new Promise((r) => setTimeout(r, wait));
        continue;
      }
      if (!res.ok) throw new Error(`${method}: HTTP ${res.status}`);
      const body = (await res.json()) as { result?: T; error?: { message: string } };
      if (body.error) throw new Error(`${method}: ${body.error.message}`);
      return body.result as T;
    }
  }
}

async function pool<T>(items: T[], size: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) await fn(items[next++]!);
  });
  await Promise.all(workers);
}
