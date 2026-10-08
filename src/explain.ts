import type { Report } from "./types.js";

/** Plain text explanation of one wallet's score, written for the wallet's owner. */
export function explain(report: Report, address: string): string {
  const w = report.wallets.find((x) => x.address === address);
  if (!w) return `${address} is not in this report.`;
  const lines = [`Wallet ${w.address}`, `Score ${w.score.toFixed(4)} (${w.verdict})`];
  if (w.evidence.length === 0) {
    lines.push("", "No evidence linked this wallet to any other wallet in the list.");
  } else {
    lines.push("", "Why:");
    w.evidence.forEach((e, i) => {
      lines.push(`  ${i + 1}. [${e.signal}, weight ${e.weight}] ${e.summary}`);
      const others = e.wallets.filter((x) => x !== w.address);
      if (others.length > 0) lines.push(`     Linked wallets: ${others.slice(0, 10).join(", ")}${others.length > 10 ? ` and ${others.length - 10} more` : ""}`);
    });
    const product = w.evidence.map((e) => `(1 - ${e.weight})`).join(" * ");
    lines.push("", `Score = 1 - ${product} = ${w.score.toFixed(4)}`);
  }
  if (w.clusterId !== null) {
    const c = report.clusters.find((x) => x.id === w.clusterId)!;
    lines.push(`Cluster ${c.id}: ${c.wallets.length} wallets, signals: ${c.signals.join(", ")}`);
  }
  for (const n of w.notes) lines.push(`Note: ${n}`);
  lines.push("", "Every signature and address behind this is in the report's evidence details, so you can check it on any explorer.");
  return lines.join("\n");
}
