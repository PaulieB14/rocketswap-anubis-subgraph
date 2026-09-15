# RocketSwap (Anubis) — Uniswap V2 subgraph

A fork of [Uniswap/v2-subgraph](https://github.com/Uniswap/v2-subgraph) (GPL-3.0-or-later)
adding **Anubis Mainnet** (`eip155:6714`). Upstream's multi-chain config system means this is a
new `config/anubis/` directory plus one enum entry — no mapping code is changed.

Build: `npm install --legacy-peer-deps && npm run build -- --network anubis --subgraph-type v2`

## Everything below was read from the chain, not from a listing

Verified 2026-09-15 against `https://rpc.anubispace.org` at block ~13.98M.

| | |
|---|---|
| Factory | `0xaf6f4e641c86a25518509bc840051a8652af598a` |
| Verified name | `UniswapV2Factory` (Blockscout) |
| Deployed | block **2059** — near genesis, so full history is cheap |
| Pairs | **811** (`allPairsLength()`) |
| Distinct tokens | 652 |
| Block time | **1.00s** (~86,377 blocks/day) |
| Chain-wide swaps | **~236,000/day** |

It is a genuine Uniswap V2 fork, not merely V2-like:

- factory answers `allPairsLength()` and `feeTo()`
- pairs answer `token0` / `token1` / `getReserves` / `totalSupply` / `symbol` with standard shapes
- `PairCreated` logs match the canonical topic0
  `0x0d3648bd0f6ba80134a33ba9275ac585d9d315f0ad8355cddefde31afa28d0e9`, with 3 topics and the
  pair address in data
- the first `PairCreated` (block 4081) yields the same address as `allPairs(0)`

So the upstream ABIs and mappings apply unmodified.

## Why the pricing config looks unusual

Anubis's gas token is **gasDAI**, so the DEX hub asset is itself a stablecoin. `REFERENCE_TOKEN`
is DAI (`0x83fd…de14`), not a wrapped native — DAI is one side of **580 of 811 pairs** and holds
**117.3M DAI** of pooled liquidity.

DAI's USD price is *derived*, not assumed: it measured **1 DAI = 0.9970 USDT**, so the config lists
two deep stable pairs and lets upstream's reserve-weighting carry the small depeg through rather
than declaring the reference token a dollar. (Upstream supports assuming 1.0 by putting
`REFERENCE_TOKEN` in `STABLE_TOKEN_PAIRS`; we deliberately don't.)

Those two pairs also order their tokens differently — DAI is `token0` in the USDT pair and `token1`
in the USDC pair — which exercises both branches of `getEthPriceInUSD`.

**There is a DAI/WETH pair with both reserves at zero.** WETH is deliberately excluded from the
whitelist; pricing through a dead pair is how a subgraph starts publishing nonsense.

## Match on address, never on symbol

Symbol collisions are severe here. Among the top 40 tokens by pair count:

- **3** contracts call themselves `DAI` — one of them is *named* "Anubis"
- **3** call themselves `USDT`, at two different decimal counts (6 and 18)
- **4** call themselves `ANB`
- **2** call themselves `LGNS`

Every entry in `WHITELIST` / `STABLECOINS` is an address for this reason.

## The whitelist call

Liquidity is extremely concentrated: LGNS/DAI alone is **87.16M of the 117.27M DAI pooled (~74%)**,
and of 580 DAI-side pairs only **16 hold more than 1,000 DAI** and **10 more than 10,000**.

So the whitelist includes three project tokens (LGNS, gLGNS, A) alongside the stables. A
stablecoin-only whitelist would classify most real trading on Anubis as untracked and make the
volume figures useless. Each included token has a DAI pair deeper than 1M DAI and is priced off
that pair rather than off the others, so no pricing cycle is created. **If any of those pools
drains, drop the token.**

Thresholds are denominated in DAI (≈ dollars), not ETH — roughly 3000× smaller numbers than an
ETH-referenced chain would use. `tempo` is the precedent, being upstream's other
stablecoin-referenced chain.

## Best practices

Against [immutable entities and Bytes as IDs](https://thegraph.com/docs/en/subgraphs/best-practices/immutable-entities-bytes-as-ids/):

**Immutable entities — already satisfied upstream.** `Swap` and `PairTokenLookup` are
`@entity(immutable: true)`. `Mint` and `Burn` are deliberately mutable and must stay so: this
implementation creates them in `handleTransfer` and completes them later in `handleMint` /
`handleBurn` (hence `mint.save()` at both core.ts:84 and core.ts:322). Marking them immutable would
break that two-phase pattern.

**Bytes as IDs — applied.** Every live entity in both schemas now keys on `Bytes!` rather than
`ID!`: 15 entities in v2, 12 in v2-tokens. Address and tx-hash ids drop the `.toHexString()` round
trip, and composite ids move from string concatenation to `Bytes`, so `hash-index` becomes
`hash.concatI32(index)` and `address-dayId` becomes `address.concatI32(dayId)`.

`chain.ts` keeps its addresses as readable lowercase hex strings. Conversion happens once, in
constants (`FACTORY_ID`, `BUNDLE_ID`), and comparisons against the string
`WHITELIST` / `STABLECOINS` / `REFERENCE_TOKEN` config go the other way via
`token.id.toHexString()`. Two places keep a string deliberately: `store.remove()` takes a string
entity id, and `ADDRESS_ZERO` is compared against values rather than ids.

This diverges the fork from upstream, so future Uniswap changes to the mappings will conflict here.
That is the accepted cost at ~236k swaps/day.

Worth knowing if you touch it: `src/common` is shared between the v2 and v2-tokens subgraphs, so
converting only one schema breaks the other's build with type errors in the shared pricing code —
both must move together. And `generated/` is rewritten per target, so `graph codegen` must precede
each `graph build` when switching between them; building v2 straight after a v2-tokens codegen
fails with missing `Mint`/`Burn`/`Swap` exports, which is build order rather than a code fault.

## Deploying: do NOT use Subgraph Studio

The Graph's own page for this chain states it plainly:

> Anubis is supported on The Graph Network, but does not currently have Subgraph Studio
> testing/staging support. Skip the standard `graph deploy` and Studio playground path.

Studio's UI *does* offer Anubis in its network dropdown, and the networks registry maps
`anubis -> api.studio.thegraph.com/deploy`, so `graph deploy` looks like it should work. It does
not. The build and IPFS upload succeed and then the registrar refuses:

    Could not deploy subgraph on graph-node:
    network not supported by registrar: no network anubis found on chain ethereum

Confirmed against graph-cli 0.64.1 and 0.98.1, with network identifiers `anubis`,
`anubis-mainnet` and `evm-6714`, and with specVersion 0.0.8 and 1.2.0. It is the deploy path that
is wrong, not the subgraph.

**The supported path is `graph publish`** — publishing on-chain to The Graph Network, where an
Indexer that supports Anubis picks it up:

    graph codegen && graph build
    graph publish

Publishing opens a browser to connect a wallet and is an on-chain transaction. The
`--protocol-network` flag refers to where The Graph's contracts live (Arbitrum One), not to Anubis.

**Signal matters here.** Without curation signal no Indexer is incentivised to index the subgraph;
at 500 GRT or more it is picked up automatically. Adding the signal during the publish transaction
saves gas versus doing it separately. This is the practical consequence of Anubis having
`issuanceRewards: false` — attention has to be bought rather than assumed.

To validate before publishing, run a local Graph Node against the Anubis RPC rather than Studio:

    environment:
      ethereum: 'anubis:https://rpc.anubispace.org'

    graph create --node http://localhost:8020/ rocket-swap
    graph deploy --node http://localhost:8020/ --ipfs http://localhost:5001 rocket-swap

## A privacy caveat that changes what the numbers mean

Anubis is a **selective-privacy** chain. A subgraph can only index what is public on-chain:
transparent transactions and the events they emit. Data inside shielded (PLONK ZK) transactions is
not visible on-chain and therefore cannot be indexed at all.

So volume and liquidity from this subgraph are *transparent-transaction* volume and liquidity, not
necessarily all activity. That is the correct framing for a DEX API on this chain, and it should be
stated wherever the figures are surfaced rather than left for a reader to assume.

## Before trusting the output

- Run `{ _meta { block { number } } }` and compare against the chain head.
- Do **not** `orderBy: reserveUSD`. On Uniswap-V2-schema subgraphs that ranking surfaces untracked
  pairs reporting absurd USD values (~8.8e33 observed elsewhere) against zero volume. Rank by
  `trackedReserveETH`; `reserveUSD` is fine to read on an already-selected pair.
- Anubis has `issuanceRewards: false` in The Graph's networks registry, and no Subgraph Studio
  support — see the deploy section above. Publishing on-chain with curation signal is the route to
  getting it indexed.

## A second factory exists

`0x428f2c738e8fd956089440190447a2de701284Af` also answers `allPairsLength()` (6 pairs). It is not
indexed here. Worth identifying before assuming this subgraph covers all of RocketSwap.
