# RocketSwap (Anubis) Subgraph

GraphQL API for [RocketSwap](https://browser.anubispace.org), the Uniswap V2-style DEX on
**Anubis Mainnet** (`eip155:6714`) — pairs, swaps, mints, burns, reserves, volume, and
daily/hourly aggregates.

Published to The Graph Network:

| | |
|---|---|
| Subgraph ID | `7Ld8cuaVRdtw9xQqWD4Z9tqnrt9jbyzYebqjo1qqtS9V` |
| Deployment | `QmRNKWfyMKewQc2iuG8titBS6Z1tsUVmd8jST9vSULiXJx` |
| Factory | `0xaf6f4e641c86a25518509bc840051a8652af598a` |
| Start block | 2059 |

```
https://gateway.thegraph.com/api/subgraphs/id/7Ld8cuaVRdtw9xQqWD4Z9tqnrt9jbyzYebqjo1qqtS9V
```

You need an API key from [Subgraph Studio](https://thegraph.com/studio/) to query the gateway.

> **Status: published, awaiting curation signal.** Anubis carries `issuanceRewards: false`, so no
> Indexer is incentivised to index this without signal. At 500 GRT it is picked up automatically.
> Until then the subgraph exists on-chain but will not sync.

## Why this exists

RocketSwap accounts for essentially all DeFi activity on Anubis. Measured directly against
`rpc.anubispace.org` on 2026-09-15 over a 5,000-block window:

- **10,919 swaps**, of which **100%** came from pairs created by this factory
- roughly **188,000 swaps/day**, across 22 distinct pairs in a 1.4-hour sample
- **811 pairs**, 652 distinct tokens, 1.00s blocks (~86,377 blocks/day)

Nothing indexed Anubis before this.

## Querying

Always check freshness first, and compare the block to the chain head:

```graphql
{ _meta { block { number } } }
```

Top pairs by real trading:

```graphql
{
  pairs(first: 10, orderBy: volumeUSD, orderDirection: desc) {
    id
    token0 { symbol }
    token1 { symbol }
    reserveUSD
    volumeUSD
    txCount
  }
}
```

**Do not `orderBy: reserveUSD`.** On Uniswap-V2-schema subgraphs that ranking surfaces untracked
pairs reporting absurd USD values against zero volume — roughly 8.8e33 USD in a case verified on
Uniswap's own mainnet subgraph. Rank by `volumeUSD` or `trackedReserveETH`; `reserveUSD` is fine to
*read* on a pair you already selected.

Entities: `Pair`, `Token`, `Swap`, `Mint`, `Burn`, `Transaction`, `UniswapFactory`, `Bundle`,
`UniswapDayData`, `PairDayData`, `PairHourData`, `TokenDayData`, `TokenHourData`.

Liquidity on Anubis is stable — a sample window showed 10,919 swaps against 4 mints and 0 burns —
so expect `Mint`/`Burn` collections to be sparse. That is the chain, not a bug.

## What the numbers mean on a privacy chain

Anubis is **selective-privacy**. A subgraph can only index what is public on-chain: transparent
transactions and the events they emit. Activity inside shielded (PLONK ZK) transactions never
appears on-chain and cannot be indexed at all.

So volume and liquidity here are *transparent-transaction* figures, not guaranteed totals. Say so
wherever you surface them — otherwise the first person who compares against RocketSwap's own UI
will assume the subgraph is broken.

## Pricing is anchored to DAI, not a wrapped native

Anubis's gas token is `gasDAI`, so the DEX hub asset is itself a stablecoin. `REFERENCE_TOKEN` is
DAI (`0x83fd06f0846d9d90b3016bf670efe2e0b11cde14`) — one side of **580 of 811 pairs**, holding
**117.3M DAI**.

DAI's own USD price is *derived*, not assumed. It measured **1 DAI = 0.9970 USDT**, so the config
lists two deep stable pairs and lets the reserve-weighting carry that small depeg through:

- DAI/USDT `0xf14c0e3da42fc36a416e6036dc4c7ca0375b734f` — 3.26M DAI / 3.25M USDT
- DAI/USDC `0x02fece8875b5f00561d883289794b46dc94dfe92` — 1.12M DAI / 1.12M USDC

A DAI/WETH pair exists with **both reserves at zero**, so WETH is deliberately excluded from the
whitelist. Pricing through a dead pair is how a subgraph starts publishing nonsense.

### Match tokens by address, never by symbol

Symbol collisions on Anubis are severe. Among the top 40 tokens by pair count: **three** contracts
call themselves `DAI` (one is *named* "Anubis"), **three** call themselves `USDT` at two different
decimal counts, **four** call themselves `ANB`, and **two** call themselves `LGNS`.

### The whitelist includes three project tokens

Liquidity is extremely concentrated — LGNS/DAI alone is **87.16M of the 117.27M DAI pooled (~74%)**,
and of 580 DAI-side pairs only 16 hold more than 1,000 DAI. A stablecoin-only whitelist would
classify most real trading as untracked and make volume useless, so LGNS, gLGNS and A are included
alongside the stables. Each has a DAI pair deeper than 1M DAI and is priced off that pair, so no
pricing cycle is created. **If any of those pools drains, drop the token.**

Thresholds are denominated in DAI (≈ dollars), so they are ~3000× smaller than an ETH-referenced
chain would use.

## Deploying: publish, do not use Studio

The Graph's [Anubis page](https://thegraph.com/docs/en/supported-networks/anubis/) states it
directly: Anubis is supported on The Graph Network but has **no Subgraph Studio testing/staging
support**, and the standard `graph deploy` path should be skipped.

Studio's UI offers Anubis in its network dropdown and the networks registry maps
`anubis → api.studio.thegraph.com/deploy`, so `graph deploy` looks correct right up until the
registrar refuses it:

```
network not supported by registrar: no network anubis found on chain ethereum
```

That was reproduced with graph-cli 0.64.1 and 0.98.1, identifiers `anubis` / `anubis-mainnet` /
`evm-6714`, and specVersion 0.0.8 and 1.2.0. The subgraph builds and uploads every time; only the
registrar step fails.

The supported path is `graph publish`, an on-chain action on Arbitrum One:

```bash
npm install --legacy-peer-deps
npm run build -- --network anubis --subgraph-type v2
graph publish
```

To validate before publishing, run a local Graph Node against the Anubis RPC:

```yaml
environment:
  ethereum: 'anubis:https://rpc.anubispace.org'
```

## Development

Fork of [Uniswap/v2-subgraph](https://github.com/Uniswap/v2-subgraph) at commit `3d7c069`
(2026-07-29), GPL-3.0-or-later. Upstream's multi-chain config system means the Anubis integration
is `config/anubis/` plus one `NETWORK` enum entry — **no mapping logic was changed**.

```bash
npm install --legacy-peer-deps
npm run build -- --network anubis --subgraph-type v2          # or --subgraph-type v2-tokens
```

Two build notes that will cost you time otherwise:

- `src/common` is **shared** between the `v2` and `v2-tokens` subgraphs. Changing one schema
  without the other breaks the other's build with type errors in the shared pricing code.
- `generated/` is rewritten per target, so `graph codegen` must precede each `graph build` when
  switching between them. Building `v2` straight after a `v2-tokens` codegen fails with missing
  `Mint`/`Burn`/`Swap` exports — that is build order, not a code fault.

### Bytes as IDs

Both schemas follow [immutable entities and Bytes as
IDs](https://thegraph.com/docs/en/subgraphs/best-practices/immutable-entities-bytes-as-ids/). Every
live entity keys on `Bytes!` — 15 in v2, 12 in v2-tokens. Composite ids use `Bytes` concatenation,
so `hash-index` is `hash.concatI32(index)`.

Immutability was already correct upstream: `Swap` and `PairTokenLookup` are immutable, while `Mint`
and `Burn` must stay mutable because they are created in `handleTransfer` and completed later in
`handleMint`/`handleBurn`.

`config/anubis/chain.ts` keeps addresses as readable lowercase hex strings; conversion to `Bytes`
happens once in `src/common/constants.ts` (`FACTORY_ID`, `BUNDLE_ID`).

This diverges the fork from upstream, so future Uniswap mapping changes will conflict here.

## A second factory exists

`0x428f2c738e8fd956089440190447a2de701284Af` also answers `allPairsLength()` (6 pairs) and is **not**
indexed here. Worth identifying before assuming this subgraph covers all of RocketSwap.

## License

GPL-3.0-or-later, inherited from Uniswap/v2-subgraph. See [LICENSE](./LICENSE).
