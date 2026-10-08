#!/usr/bin/env -S npx tsx
import { readFileSync } from "node:fs";
import { analyze } from "./score.js";
import { explain } from "./explain.js";
import { RpcProvider } from "./rpc.js";
import type { Labels, Report, WalletHistory } from "./types.js";

const USAGE = `Usage:
  sybil-score fetch --rpc <url> [--max-signatures N] [--concurrency N] <wallets.txt>   > histories.json
  sybil-score analyze <histories.json> [--labels labels.json] [--config config.json]   > report.json
  sybil-score explain <report.json> <wallet>`;

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  if (i === -1) return undefined;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
}

const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, "utf8")) as T;

async function main(argv: string[]): Promise<number> {
  const [cmd, ...args] = argv;
  if (cmd === "fetch") {
    const rpc = flag(args, "--rpc") ?? process.env.SOLANA_RPC_URL;
    const max = flag(args, "--max-signatures");
    const concurrency = flag(args, "--concurrency");
    if (!rpc || !args[0]) return usage();
    const wallets = readFileSync(args[0], "utf8").split(/\s+/).filter(Boolean);
    const provider = new RpcProvider(rpc, {
      maxSignatures: max ? Number(max) : undefined,
      concurrency: concurrency ? Number(concurrency) : undefined,
    });
    const histories = await provider.histories(wallets, (d, t) => process.stderr.write(`\rfetched ${d}/${t}`));
    process.stderr.write("\n");
    process.stdout.write(JSON.stringify(histories) + "\n");
    return 0;
  }
  if (cmd === "analyze") {
    const labels = flag(args, "--labels");
    const config = flag(args, "--config");
    if (!args[0]) return usage();
    const report = analyze(readJson<WalletHistory[]>(args[0]), {
      labels: labels ? readJson<Labels>(labels) : undefined,
      config: config ? readJson(config) : undefined,
    });
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
    const counts = { clear: 0, review: 0, sybil: 0 };
    for (const w of report.wallets) counts[w.verdict]++;
    process.stderr.write(`${report.wallets.length} wallets: ${counts.clear} clear, ${counts.review} review, ${counts.sybil} sybil, ${report.clusters.length} clusters\n`);
    return 0;
  }
  if (cmd === "explain") {
    if (!args[0] || !args[1]) return usage();
    process.stdout.write(explain(readJson<Report>(args[0]), args[1]) + "\n");
    return 0;
  }
  return usage();
}

function usage(): number {
  process.stderr.write(USAGE + "\n");
  return 1;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err) => {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  },
);
