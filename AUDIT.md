# RocketSwap (Anubis) subgraph audit, 2026-10-11

Deployment audited: `QmRNKWfyMKewQc2iuG8titBS6Z1tsUVmd8jST9vSULiXJx` (subgraph `7Ld8cuaVRdtw9xQqWD4Z9tqnrt9jbyzYebqjo1qqtS9V`).
Subgraph data comes from the gateway. Chain data comes from `https://rpc.anubispace.org` (archive `eth_call` and `eth_getLogs`, 5,000-block log limit).
Subgraph head at audit time was block 16,203,990. Chain head was 16,203,943 to 16,204,000, so the lag is about 20 blocks. `hasIndexingErrors: false`.

## Findings, ranked by severity

### 1. CRITICAL: the reference (DAI) price came from a drained stable pair, giving 2.64e18 of fake volume. Fixed in this PR.
- `UniswapFactory.totalVolumeUSD` = 2,639,959,314,659,575,311.78. Of that, 2,639,959,308,780,691,536.86 lands on a **single day, 2026-04-27** (`UniswapDayData` `0x5a500000`). Every other day adds up to about **$5.88B** (5,878,883,774.92).
- On that day, DAI-side swaps were valued at about 1.6e14 USD per DAI. Example: tx `0x95bed814…753a`, block **1,733,668**, 6,270 DAI in for 1.043 gLGNS out on DAI/gLGNS `0x8c4ea5da…c58d`, recorded at `amountUSD` 994,981,937,053,123,183.
- Cause: `getEthPriceInUSD` reserve-weights the stable pairs, but at that point the only stable pair was DAI/USDT `0xf14c0e3d…734f`. DAI/USDC `0x02fece88…fe92` was only created later, at block 2,467,181. With one pair the weight is 1, however small the pair. `getReserves()` at block 1,733,668 returns **69,020 wei DAI (6.9e-14 DAI) against 10,906,686 (10.906686 USDT)**, which works out to 1.58e14 USDT per DAI. 6,270 DAI × 1.58e14 = 9.9e17, which matches the recorded swap.
- Pairs affected (all-time `volumeUSD`): DAI/gLGNS 2.158e18, GD/DAI `0x96744829…c2b7` 4.50e17, DAI/HORUS `0x1ffad8a9…76b1` 1.19e16, DAI/USDS `0x2d1b6c2d…8ebf` 9.38e15, TKNA/DAI `0xb6b2ccda…bcf3` 4.71e15, and more. All of it comes from the 2026-04-27 `PairDayData`.
- Fix: `getEthPriceInUSD` now skips any stable pair whose DAI reserve is below `MINIMUM_STABLE_PAIR_REFERENCE_RESERVE` (10,000 DAI on Anubis) or whose quoted price is more than `MAX_REFERENCE_PRICE_DEVIATION` (0.5) away from 1. If no pair qualifies it falls back to `REFERENCE_PRICE_FALLBACK`, which is 1 on Anubis because DAI is the reference stablecoin. Other networks' configs get defaults (0 / 0 / 0) that keep upstream behaviour.

### 2. HIGH: the contaminated values are stored and stay wrong until a resync.
Fixing the mapping doesn't rewrite history. Until a fixed version is deployed and synced, these fields stay wrong: `UniswapFactory.totalVolumeUSD/totalVolumeETH/untrackedVolumeUSD`, `Pair.volumeUSD/untrackedVolumeUSD` on the pairs above, `Token.tradeVolumeUSD` (gLGNS shows 2,157,890,349,692,494,228), the 2026-04-27 `UniswapDayData`, `PairDayData` and `TokenDayData`, and the `Swap.amountUSD` values from that day. Liquidity figures today are unaffected: the top 6 pairs' reserves match the chain exactly (see the verification section).

### 3. HIGH (not fixable in code): zero indexing rewards, by design of the network.
- In the networks registry, `anubis` has `issuanceRewards: false`, and the deployment carries `deniedAt: 25986290` in the network subgraph. **No indexer can ever earn indexing rewards on it**, so the lifetime `indexingRewardAmount` of 0 is expected.
- Allocations (epoch 1408): InfraDAO myrtle `0xa4d629ba…` 2,500 GRT (since epoch 1401) and InfraDAO production `0x63c9dc72…` 20 GRT (since 1388). Both are Active, with 0 rewards. Lifetime query fees: 0.
- Signal is **495 GRT**. The registry says the InfraDAO backstop covers Anubis subgraphs with **500+ GRT** of signal. It's below that threshold, so the backstop isn't guaranteed. Publishing a new version may move signal and cost curation tax, so top it up to ≥ 500 after publishing.
- Both indexers timed out on a single query that combined several `orderBy` sorts. The same fields queried one at a time returned fine.

### 4. MEDIUM: `findEthPerToken`'s liquidity guard counted the token's own (possibly inflated) value. Fixed.
The guard used `pair.reserveETH`, which includes the token being priced at its previous `derivedETH`. A token that had already been mispriced could pass the 2,000-DAI threshold because of its own mispricing. It now requires the whitelisted side's reserve × derivedETH × 2 to exceed the threshold, which is the Uniswap v3 convention.

### 5. MEDIUM: CI has been red on `main` since 2026-09-16. Fixed.
Run 35042068569 failed at "Build v2". `src/common/chain.ts` is gitignored and normally gets copied in by `script/build.ts`, but CI calls `graph` directly. Reproduced locally: `ERROR TS6054: File 'src/common/chain.ts' not found`. CI now copies `config/anubis/chain.ts` first.

### 6. MEDIUM: `pairCount` counts a pair that is never indexed. Fixed.
On-chain `allPairsLength()` = 855 and `UniswapFactory.pairCount` = 855, but only **854** `Pair` entities exist. The missing one is `allPairs(548)` = `0x4c41a3a0cb3939adbe87b76e2fcbaaf1cbae81e1`. Its token1 `0x83fde6f0…cde14` (a typo of the DAI address) has no code, so `decimals()` reverts and `handleNewPair` bails out after it has already incremented `pairCount`. That pair's reserves are 0, so no volume is lost. `pairCount` is now incremented only when the `Pair` is created.

### 7. MEDIUM: `UniswapDayData.totalVolumeUSD` / `totalVolumeETH` are always 0. Fixed.
Both are initialised to 0 and never written. All 179 day rows return `totalVolumeUSD: "0"`. They now snapshot the factory's running totals.

### 8. LOW: `Pair.totalSupply` is 1,000 wei below the on-chain `totalSupply()`. Fixed.
Examples: RM/USDT `0x8cbabf4e…` subgraph 0.000187735609717623 vs chain 0.000187735609718623, and ADAO2/USDT `0xb49e0c36…` 0.000109184854537789 vs 0.000109184854538789. The early return for the 1,000-wei MINIMUM_LIQUIDITY mint skipped the supply update. That mint is now counted, but still without creating a `Mint` entity.

### 9. LOW, documented and not changed
- `liquidityProviderCount` is never incremented, so it's 0 on every pair. The "<5 LPs needs more than $10k of reserves" rule in `getTrackedVolumeUSD` therefore applies to every pair, which works as an always-on minimum-liquidity rule for tracked volume. I left it as is because removing it would change which volume gets counted.
- `UniswapDayData.txCount` is the factory's cumulative count, not a daily count (upstream semantics). It increases monotonically, and the last value equals the factory's 47,195,327.
- `Swap.amountUSD` falls back to the untracked value (`derivedAmountUSD`) when tracked is 0, and it checks this with reference equality (`=== ZERO_BD`). `TokenDayData.dailyVolumeUSD` also uses untracked prices. Both are upstream behaviour, left alone so semantics don't change. Use `Pair.volumeUSD` / `UniswapDayData.dailyVolumeUSD` for trusted figures.
- There are no `UniswapDayData` rows for 2026-04-08..13, 04-15..16 and 04-18. That is before the DEX had meaningful activity: totals were 3 → 5 → 14,117 txs. Day entities are only created on events, so these are empty days, not missed data.
- Schema and performance: `Swap` and `PairTokenLookup` are already immutable. `Mint` and `Burn` have to stay mutable because they're completed across Transfer, Mint and Burn events. `Transaction.mints/burns/swaps` arrays are per-transaction, so they're bounded. Day and hour entities could move to timeseries/aggregations, but that would break the schema for consumers, so it's not done here. `getTokenTrackedLiquidityUSD` (unused) compared `Bytes` against a `string[]` whitelist; that's fixed.
- Other networks' configs inherited from upstream (e.g. `ethereum`) don't compile, even on `main` before this PR (`STABLECOINS.includes(...)` type error). Only `anubis` is built or deployed from this repo.

### 10. INFO: a second, separate DEX exists on Anubis.
In a sample window at blocks 8,000,000–8,000,299, 25 of 925 `Swap` logs came from pairs of a different factory, `0x428f2c738e8fd956089440190447a2de701284af`. It's a PancakeSwap fork (LP name "Pancake LPs") with `allPairsLength()` = 6. There were 0 swaps on its sampled pairs in blocks 16,198,944–16,203,943 or 12,000,000–12,004,999, and 0 `PairCreated` events from any emitter in the last 50,000 blocks. It's out of scope for a RocketSwap subgraph, and the RocketSwap factory has not changed.

## Verified correct
- **Event coverage.** Blocks 16,200,000–16,200,299: on-chain 805 Swap, 2 Mint, 0 Burn, 807 Sync from factory pairs across 418 txs. The subgraph has 418 `Transaction`s with 805 swaps, 2 mints and 0 burns, with an identical per-pair breakdown (LGNS/DAI 238, RM/USDT 210, …). Blocks 8,000,000–8,000,299: 900 Swap / 900 Sync from factory pairs, with no events from pairs missing in the subgraph.
- **Reserves.** `getReserves()` at block 16,203,923 matches the subgraph exactly for the top 6 pairs by tracked liquidity (LGNS/DAI, RM/USDT, LGNS/fLGNS, ADAO2/USDT, DAI/gLGNS, AiLGNS/DAI).
- **Decimals.** `decimals()` matches on all 10 tokens checked: DAI 18, USDT 6, USDC 6, LGNS 9, gLGNS 18, A 18, RM 9, fLGNS 18, ADAO2 9, AiLGNS 18.
- **Aggregates.** At block 16,203,990, `UniswapFactory.txCount` = 47,195,327, which equals the sum of `Pair.txCount` over all 854 pairs.
- **Pricing today.** The bundle price of 0.99789 is sane. The largest swap after 2026-04-27 is 10,000,000 USDT ($9.98M) on USDT/AiLGNS `0x926b2828…711a`, which is real size and not a pricing error.

## Resync cost
- Blocks: start block 2,059 to head ~16,203,943, about **16.2M blocks** at 1 s/block.
- Events: 47,195,327 Swap/Mint/Burn (the factory `txCount`), plus about one `Sync` per Swap/Mint/Burn (the sample windows were 807:807 and 900:900), plus LP `Transfer`s (few, since mints and burns are rare). That's **about 94M handler calls**. The current deployment holds about 68.5M entities (InfraDAO indexing status, 2026-10-10).
- Time: I haven't measured indexer throughput on Anubis. At 500 / 1,000 / 2,000 handled events per second, it would take about 52 h / 26 h / 13 h.
