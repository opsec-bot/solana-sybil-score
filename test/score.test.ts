import { describe, expect, it } from "vitest";
import { analyze, combine, explain, firstFunding, resolveConfig, sweep, verdictFor } from "../src/index.js";
import { MINT, SWAP, T0, World, rng, scenario } from "./helpers.js";

const byAddr = (report: ReturnType<typeof analyze>) => new Map(report.wallets.map((w) => [w.address, w]));
const signalsOf = (report: ReturnType<typeof analyze>, a: string) => byAddr(report).get(a)!.evidence.map((e) => e.signal);

describe("derive", () => {
  it("finds the earliest inbound transfer as the funder", () => {
    const w = new World();
    w.transfer("late", "x", 1, T0 + 100);
    w.transfer("early", "x", 1, T0);
    w.transfer("x", "elsewhere", 0.1, T0 - 10); // outbound, not funding
    expect(firstFunding(w.wallet("x"))!.from).toBe("early");
  });

  it("only calls the last outbound transfer a sweep when it moved most of the funds", () => {
    const w = new World();
    w.transfer("f", "x", 1, T0);
    w.transfer("x", "shop", 0.1, T0 + 10);
    expect(sweep(w.wallet("x"), 0.5)).toBeNull();
    w.transfer("x", "collector", 0.8, T0 + 20);
    expect(sweep(w.wallet("x"), 0.5)!.to).toBe("collector");
  });
});

describe("combine and verdict", () => {
  it("is a noisy-OR", () => {
    expect(combine([])).toBe(0);
    expect(combine([0.5])).toBe(0.5);
    expect(combine([0.5, 0.5])).toBe(0.75);
    expect(combine([0.25, 0.6])).toBe(0.7);
  });

  it("maps scores to verdicts", () => {
    const cfg = resolveConfig();
    expect(verdictFor(0.29, cfg)).toBe("clear");
    expect(verdictFor(0.3, cfg)).toBe("review");
    expect(verdictFor(0.7, cfg)).toBe("sybil");
  });
});

describe("the mixed scenario", () => {
  const s = scenario();
  const report = analyze(s.cohort, { labels: s.labels });
  const res = byAddr(report);

  it("leaves every honest user clear, including the crowded mint and shared exchange", () => {
    for (const a of s.honest) {
      expect(res.get(a)!.verdict, a).toBe("clear");
      expect(res.get(a)!.evidence, a).toEqual([]);
    }
  });

  it("flags the star farm through shared funder and shared sweep", () => {
    for (const a of s.star) {
      expect(res.get(a)!.verdict).toBe("sybil");
      expect(signalsOf(report, a).sort()).toEqual(["shared_funder", "shared_sweep"]);
    }
    const ev = res.get(s.star[0]!)!.evidence.find((e) => e.signal === "shared_funder")!;
    expect(ev.wallets).toEqual([...s.star].sort());
    expect(ev.details.funder).toBe("operator");
    expect(ev.weight).toBe(0.8665); // 1 - 0.75^7
  });

  it("finds the peel chain", () => {
    for (const a of s.chain) expect(signalsOf(report, a)).toContain("funding_chain");
    const ev = res.get(s.chain[0]!)!.evidence[0]!;
    expect(ev.wallets).toEqual(s.chain);
    expect(ev.weight).toBe(0.5781); // 1 - 0.75^3
    expect(res.get(s.chain[0]!)!.verdict).toBe("review");
  });

  it("finds the same-amount exchange burst but not ordinary withdrawals", () => {
    for (const a of s.burst) expect(signalsOf(report, a)).toEqual(["exchange_burst"]);
    const ev = res.get(s.burst[0]!)!.evidence[0]!;
    expect(ev.details.spanSec).toBe(150);
    expect(ev.weight).toBe(0.6723); // 1 - 0.8^5
  });

  it("finds the lockstep farm even though each wallet has its own funder", () => {
    for (const a of s.lockstep) {
      expect(signalsOf(report, a)).toEqual(["lockstep"]);
      expect(res.get(a)!.verdict).toBe("sybil");
    }
    const ev = res.get(s.lockstep[0]!)!.evidence[0]!;
    expect(ev.details.averageRatio).toBe(1);
    expect(ev.weight).toBe(0.7599); // 1 * (1 - 0.7^4)
  });

  it("builds one cluster per farm", () => {
    const sets = report.clusters.map((c) => c.wallets.join(","));
    expect(sets).toContain([...s.star].sort().join(","));
    expect(sets).toContain(s.chain.join(","));
    expect(sets).toContain(s.burst.join(","));
    expect(sets).toContain(s.lockstep.join(","));
    expect(report.clusters).toHaveLength(4);
  });

  it("gives the same report regardless of input order", () => {
    const r = rng(7);
    const shuffled = [...s.cohort].map((h) => ({ h, k: r() })).sort((a, b) => a.k - b.k).map((x) => x.h);
    expect(JSON.stringify(analyze(shuffled, { labels: s.labels }))).toBe(JSON.stringify(report));
  });

  it("explains a score with the math and the linked wallets", () => {
    const text = explain(report, s.star[0]!);
    expect(text).toContain("shared_funder");
    expect(text).toContain("operator");
    expect(text).toContain("Score = 1 - (1 - 0.8665) * (1 - 0.8665)");
    expect(explain(report, s.honest[0]!)).toContain("No evidence");
  });
});

describe("edge cases", () => {
  it("skips funding signals for wallets with incomplete history and says so", () => {
    const w = new World();
    w.wallet("a", false);
    w.wallet("b", false);
    w.transfer("op", "a", 1, T0);
    w.transfer("op", "b", 1, T0 + 1);
    const report = analyze(w.cohort(["a", "b"]));
    expect(report.wallets.every((x) => x.score === 0)).toBe(true);
    expect(report.wallets[0]!.notes[0]).toMatch(/incomplete/);
  });

  it("ignores funders labeled ignore or program", () => {
    const w = new World();
    for (const a of ["a", "b", "c"]) w.transfer("faucet", a, 1, T0);
    expect(analyze(w.cohort(["a", "b", "c"]), { labels: { faucet: "ignore" } }).clusters).toEqual([]);
    expect(analyze(w.cohort(["a", "b", "c"])).clusters).toHaveLength(1);
  });

  it("treats a huge unlabeled funder as a hub and only flags bursts from it", () => {
    const w = new World();
    const r = rng(1);
    const cohort: string[] = [];
    for (let i = 0; i < 12; i++) {
      cohort.push(`u${i}`);
      w.transfer("bighub", `u${i}`, 0.2 + r() * 3, T0 + i * 86400);
    }
    const report = analyze(w.cohort(cohort), { config: { hubFanout: 10 } });
    expect(report.clusters).toEqual([]);
    const plain = analyze(w.cohort(cohort));
    expect(plain.wallets[0]!.evidence[0]!.signal).toBe("shared_funder");
  });

  it("does not link two wallets that only act in a crowded moment", () => {
    const w = new World();
    const cohort: string[] = [];
    for (let i = 0; i < 30; i++) {
      cohort.push(`m${i}`);
      for (let k = 0; k < 6; k++) w.act(`m${i}`, T0 + k * 86400 + (i % 10), [MINT]);
    }
    expect(analyze(w.cohort(cohort)).clusters).toEqual([]);
  });

  it("does not count matches on plumbing programs alone", () => {
    const w = new World();
    for (const a of ["a", "b"]) for (let k = 0; k < 10; k++) w.act(a, T0 + k * 1000, ["ComputeBudget111111111111111111111111111111"]);
    expect(analyze(w.cohort(["a", "b"])).clusters).toEqual([]);
    const w2 = new World();
    for (const a of ["a", "b"]) for (let k = 0; k < 10; k++) w2.act(a, T0 + k * 1000, [SWAP]);
    expect(analyze(w2.cohort(["a", "b"])).clusters).toHaveLength(1);
  });

  it("handles an empty cohort and wallets with no history", () => {
    expect(analyze([]).wallets).toEqual([]);
    const report = analyze([{ address: "x", transfers: [], activity: [], complete: true }]);
    expect(report.wallets[0]!.notes[0]).toMatch(/No on-chain history/);
  });
});
