# Research notes

What existing sybil detection does, and what this project took from it. Read October 2026.

## Arbitrum Foundation (2023 ARB airdrop)
Source: [ArbitrumFoundation/sybil-detection](https://github.com/ArbitrumFoundation/sybil-detection),
[Arbitrum docs](https://docs.arbitrum.foundation/concepts/sybil-account)

- Built two graphs. One with every ETH transfer. One with only **funder** edges (the first ETH sent to an account) and
  **sweep** edges (the last ETH sent out of an account).
- Removed known entities first (exchanges, bridges, contracts) using Nansen labels and Hop's lists.
- Split the graphs into connected components, then broke large ones up with Louvain community detection.
- Flagged clusters of more than 20 addresses moving funds among themselves; collapsed each cluster to one recipient.
- Eligibility rules also docked wallets whose activity all fell inside 48 hours.

Taken: funder and sweep edges (our `shared_funder`, `shared_sweep`, `funding_chain`), removing labeled entities
first, and clusters as an output. Left for v2: Louvain splitting.

## Trusta Labs
Source: [ethresear.ch post](https://ethresear.ch/t/trusta-s-ai-and-machine-learning-framework-for-robust-sybil-resistance-in-airdrops/16828)

- Phase 1 finds clusters in transfer graphs by shape: star divergence (one funds many), star convergence (many send to
  one), tree, and chain.
- Treats the **gas funding** graph (who first paid gas for a new account) as a strong, sparse signal.
- Drops hub addresses before clustering.
- Phase 2 removes addresses that do not behave like the rest of their cluster (first and last tx dates, protocols
  used, amounts), to cut false positives.

Taken: the four shapes map onto our signals (star divergence = `shared_funder`, star convergence = `shared_sweep`,
chain and tree = `funding_chain`). The hub rule became `hubFanout`. Left for v2: the behavioral outlier filter.

## Liu et al. 2025, "Detecting Sybil Addresses in Blockchain Airdrops"
Source: [arXiv:2505.09313](https://arxiv.org/abs/2505.09313) (also IEEE ICBC 2025)

- Two-hop transaction subgraph per address, 75 features, LightGBM. Above 0.9 on precision, recall, F1 and AUC over
  193,701 addresses.
- The most useful features were lifecycle timing: when the address first got gas, first transacted, and joined the
  airdrop activity. Sybils cluster in time.
- Balance and outflow mattered too: sybils keep just enough to qualify and move funds out after.

Taken: timing is a first-class signal (`lockstep`, and the timing half of `exchange_burst`), and outflow back to a
common address (`shared_sweep`). Not taken: the model itself. A trained classifier can't explain itself to a flagged
user, which is the point of this project.

## Liu and Zhu 2022, "Fighting Sybils in Airdrops"
Source: [arXiv:2209.04603](https://arxiv.org/abs/2209.04603)

- Accounts as nodes, transfers and contract calls as edges.
- Looks for groups funded from one source that then perform similar DApp interactions.

Taken: same-source funding plus similar behavior, which is why `lockstep` requires a shared program, not just a
shared moment.

## Hyperlane (2025 HYPER airdrop)
Source: [The Defiant](https://thedefiant.io/hyperlane-sets-usdhyper-airdrop-date-on-april-20)

- Gave each eligible wallet a sybil likelihood score instead of a yes or no. Inputs reported: transactions in the last
  year, whether a wallet was funded only by another eligible wallet, and the share of its interactions with other
  eligible wallets.
- We could not find a primary source for the exact scale or cutoffs.

Taken: a graded score that can scale allocations, and "funded by another eligible wallet" (`funding_chain`).

## Solana specifics
- Jito's JTO airdrop removed sybils with help from Allium, but no method was published
  ([Crypto Times](https://www.cryptotimes.io/2023/12/13/jito-identifies-multiple-sybil-attackers-in-its-jto-airdrop/)).
- Jupiter's forum discussions list shared SOL sources, wallets funding each other, and sequenced transactions as the
  usual tells ([discuss.jup.ag](https://discuss.jup.ag/t/jupiter-airdrop-round-2-2025-analysis-discussion-proposal-for-distribution/26133/194)).
- We found no open-source, Solana-native sybil scorer that explains its output. That gap is why this exists.
- On Solana a wallet must receive SOL before it can pay fees, so the first inbound SOL transfer is the natural
  equivalent of Ethereum's first gas funding. Account creation (`createAccount`) is counted as funding too.

## Other reading
- [Sybil detection in token airdrops: a comparative analysis of clustering algorithms](https://thesis.eur.nl/pub/76086/)
  (Erasmus thesis, 2024)
- [Primitive's sybil filtering write-up](https://primitivexyz.substack.com/p/sybil-detection-on-defi-protocols)
