# Spec: solana-sybil-score v1

## Goal
An open-source library that scores Solana wallets for airdrop sybil risk and shows its work. Every point of score
comes from a piece of evidence that names the wallets, addresses and transaction signatures behind it, so a wallet
owner who gets flagged can see why and contest it.

## Non-goals (v1)
- No machine learning. Every rule is a plain function a reader can check by hand.
- No off-chain signals (IP, browser fingerprint, social accounts).
- No token-transfer graph. v1 uses SOL transfers only.
- No built-in exchange address list. We could not verify one, and a wrong label does more harm than none.

## Core idea
Sybil scoring is a cohort problem. One wallet alone looks like any other wallet. A thousand wallets funded by the same
address in the same hour do not. So the input is the whole candidate list (for example, everyone eligible for an
airdrop), and each wallet is scored against the others.

## Data model
```ts
interface Transfer {     // one SOL movement
  signature: string;
  slot: number;
  blockTime: number;     // unix seconds
  from: string;
  to: string;
  lamports: number;
}

interface Activity {     // one transaction the wallet signed
  signature: string;
  slot: number;
  blockTime: number;
  programs: string[];    // program ids invoked at the top level
}

interface WalletHistory {
  address: string;
  transfers: Transfer[]; // SOL transfers in or out of this wallet
  activity: Activity[];
  complete: boolean;     // true if history goes back to the wallet's first transaction
}
```

Derived per wallet:
- **funder**: the sender of the earliest inbound SOL transfer. Only trusted when `complete` is true.
- **sweep**: the receiver of the latest outbound SOL transfer, if that transfer moved at least half of everything the
  wallet ever received (`sweepMinShare`, default 0.5). Small payments are not sweeps.

Labels are supplied by the caller: a map from address to `exchange`, `bridge`, `program` or `ignore`.

## Signals
Each signal emits evidence: `{ signal, weight, summary, wallets, details }`. `weight` is in [0, 1].

### 1. shared_funder (star, one to many)
Cohort wallets whose funder is the same unlabeled address outside the cohort (funders inside the cohort are covered
by funding_chain, so nothing is counted twice). Group size `n >= 2`.
`weight = min(0.9, 1 - 0.75^(n-1))`. Two wallets give 0.25, five give 0.68, ten or more give 0.9.

A funder that funded at least `hubFanout` (default 200) cohort wallets is treated as a hub (likely a service we have
no label for) and handled like an exchange in signal 4 instead.

### 2. shared_sweep (star, many to one)
Cohort wallets that swept to the same unlabeled address. Same weight curve as shared_funder.

### 3. funding_chain (chain or tree inside the cohort)
A cohort wallet was first funded by another cohort wallet. We take connected components of these
cohort-to-cohort funding edges. Component size `n >= 2`. Same weight curve. Catches peel chains like A funds B funds
C funds D.

### 4. exchange_burst
Many people withdraw from Binance, so an exchange funder alone means nothing. But farm operators withdraw to many
wallets at once with the same amount. For wallets funded by the same exchange or hub:
1. Sort by funding time. Split into bursts where consecutive gaps are at most `burstWindowSec` (default 600).
2. In each burst, sort by amount and chain wallets whose amounts are within `amountTolerance` (default 2%) of their
   neighbor.
3. Groups of `n >= 3` get `weight = min(0.8, 1 - 0.8^(n-1))`.

### 5. lockstep (timing)
Wallets that keep acting at the same moments. For each pair of wallets, count how many of A's transactions have a
transaction from B within `lockstepWindowSec` (default 60) that calls at least one of the same programs (ignoring
System, Compute Budget and similar plumbing). Moments with more than `crowdLimit` (default 25) distinct wallets are
skipped, because a popular mint or launch is not evidence.

`ratio = matches / min(txCount(A), txCount(B))`. A pair is linked if `matches >= 5` and `ratio >= 0.5`.
Linked pairs form groups (connected components). For a group of `n` wallets with average ratio `r`:
`weight = min(0.85, r * (1 - 0.7^n))`.

## Combining evidence
`score = 1 - product(1 - weight_i)` over a wallet's evidence (noisy-OR).
- Bounded in [0, 1].
- More evidence only raises it.
- A reader can recompute it from the report with a calculator.

Verdicts (configurable): `clear` below 0.3, `review` below 0.7, `sybil` at 0.7 or above. A project can use the raw
score to scale allocations instead of a hard cut.

## Clusters
All evidence that links wallets is merged with union-find. Each wallet in a cluster gets the cluster id and member
count. A project can then decide "one allocation per cluster" if it wants.

## Report
`analyze()` returns:
```ts
{
  version: string;
  config: Config;            // every threshold used
  wallets: WalletResult[];   // address, score, verdict, clusterId, evidence[], notes[]
  clusters: Cluster[];
}
```
`notes` records things that limited the analysis, such as incomplete history. Same input and config always give the
same report, byte for byte, so anyone can rerun it.

## Data provider
`RpcProvider` uses only standard Solana JSON-RPC (`getSignaturesForAddress`, `getTransaction` with `jsonParsed`), so it
works with any RPC. It pages back through history up to `maxSignatures` (default 1000) per wallet; if it stops early,
`complete` is false and funding signals skip that wallet. It parses SOL movements from System Program `transfer`,
`transferWithSeed`, `createAccount` and `createAccountWithSeed` instructions, including inner instructions. Only
transactions the wallet signed count as its activity, so spam sent to a wallet is not read as behavior.

The analysis core never touches the network. Callers can feed it histories from any source (Helius, a warehouse dump,
test fixtures).

## CLI
```
sybil-score fetch --rpc <url> wallets.txt > histories.json
sybil-score analyze histories.json [--labels labels.json] [--config config.json] > report.json
sybil-score explain report.json <wallet>
```

## Known weaknesses
- Real users who share a funder (a family, a payroll wallet, a DAO paying contributors) get linked. Weights are set so
  small groups land in `review`, not `sybil`.
- Without good exchange labels, a busy exchange looks like a giant shared funder. The hub rule limits this but labels
  are better.
- Farmers who fund through a mixer, bridge, or a fresh exchange withdrawal per wallet with random amounts and
  random timing will mostly get through v1.

## v2 ideas
- SPL token transfer edges (USDC funding is common).
- Program call sequence similarity (copycat behavior beyond timing).
- Louvain splitting of very large components, as the Arbitrum Foundation did.
- Behavioral outlier removal inside clusters to cut false positives, as Trusta describes.
