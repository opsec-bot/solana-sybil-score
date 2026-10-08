# solana-sybil-score

Open, explainable airdrop sybil scoring for Solana wallets.

Give it the list of wallets eligible for your airdrop. It pulls their on-chain history, links wallets that look like
one operator, and gives each wallet a score from 0 to 1 with the reasons behind it. Every reason names the addresses
and transaction signatures it came from, so anyone flagged can check the evidence on an explorer and contest it.

Most airdrop sybil filtering today is done in private, and each project builds its own. This is a shared, auditable
starting point.

## How it works
Sybil scoring only makes sense across a group. One wallet looks like any other; fifty wallets funded by the same
address in the same hour do not. So you score the whole cohort at once.

v1 has five signals, all plain rules you can check by hand:

| Signal | What it catches | Weight |
|---|---|---|
| `shared_funder` | Many wallets first funded by the same address | `1 - 0.75^(n-1)`, max 0.9 |
| `shared_sweep` | Many wallets emptied into the same address | `1 - 0.75^(n-1)`, max 0.9 |
| `funding_chain` | Wallets in the list funding each other (A funds B funds C) | `1 - 0.75^(n-1)`, max 0.9 |
| `exchange_burst` | Withdrawals from one exchange within minutes, same amount | `1 - 0.8^(n-1)`, max 0.8 |
| `lockstep` | Wallets using the same programs within seconds of each other, again and again | `r * (1 - 0.7^n)`, max 0.85 |

A wallet's score combines its evidence: `score = 1 - (1 - w1) * (1 - w2) * ...`. Default verdicts: below 0.3 is
`clear`, below 0.7 is `review`, 0.7 and up is `sybil`. Linked wallets are grouped into clusters, so you can also give
one allocation per cluster.

The full rules, thresholds and known weaknesses are in [docs/SPEC.md](docs/SPEC.md). The research behind them is in
[docs/RESEARCH.md](docs/RESEARCH.md).

## Try it
Needs Node 22 or newer.

```sh
npm install
npm test

# Score the demo cohort: 40 honest users and four kinds of farm.
npx tsx src/cli.ts analyze examples/cohort.json --labels examples/labels.json > report.json
npx tsx src/cli.ts explain report.json farm-star-0
```

```
Wallet farm-star-0
Score 0.9822 (sybil)

Why:
  1. [shared_funder, weight 0.8665] First funded by operator, the same address that first funded 7 other wallet(s) in this list.
  2. [shared_sweep, weight 0.8665] Sent most of its SOL to collector, the same address 7 other wallet(s) in this list emptied into.

Score = 1 - (1 - 0.8665) * (1 - 0.8665) = 0.9822
```

## Score real wallets
```sh
# wallets.txt: one address per line
npx tsx src/cli.ts fetch --rpc https://your-rpc-url wallets.txt > histories.json
npx tsx src/cli.ts analyze histories.json --labels labels.json > report.json
npx tsx src/cli.ts explain report.json <wallet>
```

`fetch` works with any Solana RPC. It pages back through each wallet's history up to `--max-signatures` (default
1000). If a wallet has more, its history is marked incomplete and the funding signals skip it, since we can't be sure
we found its first funder. The public RPC rate limits hard, so use `--concurrency 1` there or bring your own endpoint.

### Labels
`labels.json` maps addresses to `exchange`, `bridge`, `program` or `ignore`:

```json
{ "<binance hot wallet>": "exchange", "<faucet you run>": "ignore" }
```

Exchanges and bridges fund huge numbers of honest users, so they are never a `shared_funder`. Wallets funded by one
only get flagged for a tight burst of near equal withdrawals. No exchange list ships with this repo because we could
not verify one, and a wrong label does more harm than none. Without labels, any address that funded 200 or more
wallets in your list is treated like an exchange (`hubFanout` in the config).

### Config
Every threshold is in `src/config.ts` and can be overridden with `--config config.json`. The report includes the
config it ran with, so a result can always be rerun.

## Use it as a library
```ts
import { analyze, explain, RpcProvider } from "solana-sybil-score";

const histories = await new RpcProvider(process.env.RPC_URL!).histories(wallets);
const report = analyze(histories, { labels, config: { thresholds: { review: 0.4, sybil: 0.8 } } });
console.log(explain(report, wallets[0]));
```

`analyze` never touches the network, so you can feed it histories from anywhere (Helius, a data warehouse, your own
indexer) as long as they match `WalletHistory` in `src/types.ts`. Same input and config always give the same report.

## Limits
- Honest people who share a funder (a family, a payroll wallet) get linked. Small groups land in `review`, not `sybil`,
  so a person should look before excluding them.
- Farms that fund every wallet from a fresh exchange withdrawal with random amounts and timing will mostly get past v1.
- SOL only. SPL token funding (USDC) is not traced yet.

## Contributing
Issues and PRs welcome, especially false positive reports with the evidence attached, and new signals with tests.

## License
MIT
