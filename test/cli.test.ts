import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const run = (...args: string[]) =>
  execFileSync(process.execPath, ["--import", "tsx", "src/cli.ts", ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

describe("cli", () => {
  it("analyzes the example cohort", () => {
    const report = JSON.parse(run("analyze", "examples/cohort.json", "--labels", "examples/labels.json"));
    const counts = { clear: 0, review: 0, sybil: 0 } as Record<string, number>;
    for (const w of report.wallets) counts[w.verdict]!++;
    expect(counts).toEqual({ clear: 40, review: 10, sybil: 12 });
  }, 30_000);
});
