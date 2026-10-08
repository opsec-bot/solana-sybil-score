import { describe, expect, it } from "vitest";
import { RpcProvider, parseTransaction, type ParsedTx } from "../src/rpc.js";
import real from "./fixtures/rpc-transfer.json" with { type: "json" };

// A real mainnet transaction: 10000 lamports from 54uJ... to vines1... (saved from getTransaction, jsonParsed).
const REAL = real.result as unknown as ParsedTx;
const SENDER = "54uJifihfpmTjCGperSxWaZmEHzGFpsaKKEiiGL1fmTs";
const RECEIVER = "vines1vzrYbzLMRdu58ou5XTby4qAqVRLmqo36NKPTg";

function tx(over: Partial<ParsedTx> & { ix?: unknown[]; inner?: unknown[]; signers?: string[] }): ParsedTx {
  return {
    slot: 5,
    blockTime: 1000,
    meta: { err: null, innerInstructions: over.inner ? [{ instructions: over.inner as never }] : [] },
    transaction: {
      signatures: ["sigX"],
      message: {
        accountKeys: (over.signers ?? ["payer"]).map((p) => ({ pubkey: p, signer: true })),
        instructions: (over.ix ?? []) as never,
      },
    },
    ...over,
  };
}

const sys = (type: string, info: Record<string, unknown>) => ({
  program: "system",
  programId: "11111111111111111111111111111111",
  parsed: { type, info },
});

describe("parseTransaction", () => {
  it("reads a real mainnet SOL transfer", () => {
    const forReceiver = parseTransaction(REAL, RECEIVER);
    expect(forReceiver.transfers).toEqual([
      { signature: REAL.transaction.signatures[0], slot: 410047079, blockTime: 1774943281, from: SENDER, to: RECEIVER, lamports: 10000 },
    ]);
    // The receiver did not sign it, so it is not the receiver's activity.
    expect(forReceiver.activity).toBeNull();
    const forSender = parseTransaction(REAL, SENDER);
    expect(forSender.activity!.programs).toEqual(["11111111111111111111111111111111"]);
  });

  it("reads createAccount and inner transfers, and skips other wallets' transfers", () => {
    const t = tx({
      signers: ["me"],
      ix: [sys("createAccount", { source: "me", newAccount: "new", lamports: 2039280 }), { programId: "Dex1111", accounts: [], data: "" }],
      inner: [sys("transfer", { source: "pool", destination: "me", lamports: 5 }), sys("transfer", { source: "a", destination: "b", lamports: 7 })],
    });
    const p = parseTransaction(t, "me");
    expect(p.transfers.map((x) => [x.from, x.to, x.lamports])).toEqual([
      ["me", "new", 2039280],
      ["pool", "me", 5],
    ]);
    expect(p.activity!.programs).toEqual(["11111111111111111111111111111111", "Dex1111"]);
  });

  it("ignores failed transactions", () => {
    const t = tx({ ix: [sys("transfer", { source: "payer", destination: "x", lamports: 1 })] });
    t.meta = { err: { InstructionError: [0, "Custom"] } };
    expect(parseTransaction(t, "x")).toEqual({ transfers: [], activity: null });
  });
});

describe("RpcProvider", () => {
  function fakeRpc(sigCount: number, opts: { fail429?: number } = {}) {
    let fails = opts.fail429 ?? 0;
    const calls: string[] = [];
    const all = Array.from({ length: sigCount }, (_, i) => `sig${sigCount - i}`); // newest first
    const fetchFn = (async (_url: string, init: { body: string }) => {
      const body = JSON.parse(init.body);
      calls.push(body.method);
      if (fails > 0) {
        fails--;
        return new Response("slow down", { status: 429 });
      }
      let result: unknown;
      if (body.method === "getSignaturesForAddress") {
        const { limit, before } = body.params[1];
        const start = before ? all.indexOf(before) + 1 : 0;
        result = all.slice(start, start + limit).map((signature) => ({ signature }));
      } else {
        const s = body.params[0] as string;
        const n = Number(s.slice(3));
        result = tx({ slot: n, blockTime: n, signers: ["w"], ix: [sys("transfer", { source: "w", destination: "z", lamports: n })] });
        (result as ParsedTx).transaction.signatures = [s];
      }
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result }));
    }) as unknown as typeof fetch;
    return { fetchFn, calls };
  }

  it("pages through history and marks it complete when it reaches the start", async () => {
    const { fetchFn } = fakeRpc(1500);
    const h = await new RpcProvider("http://x", { fetch: fetchFn, maxSignatures: 5000 }).history("w");
    expect(h.complete).toBe(true);
    expect(h.activity).toHaveLength(1500);
    expect(h.transfers[0]!.slot).toBe(1); // sorted oldest first
  });

  it("marks history incomplete when it stops at maxSignatures", async () => {
    const { fetchFn } = fakeRpc(50);
    const h = await new RpcProvider("http://x", { fetch: fetchFn, maxSignatures: 20 }).history("w");
    expect(h.complete).toBe(false);
    expect(h.activity).toHaveLength(20);
  });

  it("retries on 429", async () => {
    const { fetchFn, calls } = fakeRpc(2, { fail429: 1 });
    const h = await new RpcProvider("http://x", { fetch: fetchFn }).history("w");
    expect(h.activity).toHaveLength(2);
    expect(calls[0]).toBe("getSignaturesForAddress");
    expect(calls[1]).toBe("getSignaturesForAddress");
  });
});
