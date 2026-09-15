import { Address, BigDecimal, BigInt } from '@graphprotocol/graph-ts/index'

// RocketSwap on Anubis Mainnet (eip155:6714).
//
// Every address and threshold below was read from the chain on 2026-09-15 at
// block ~13.98M via https://rpc.anubispace.org, not taken from a block explorer
// listing or a docs page. Notes record what was measured so the next person can
// re-derive rather than trust.
//
// The factory is a verbatim Uniswap V2 fork: the contract verified on Blockscout
// under the name `UniswapV2Factory`, answers allPairsLength() and feeTo(), and
// its pairs answer token0/token1/getReserves/totalSupply/symbol with standard
// shapes. 811 pairs, 652 distinct tokens.

export const FACTORY_ADDRESS = '0xaf6f4e641c86a25518509bc840051a8652af598a'

// ── Tokens ───────────────────────────────────────────────────────────────────
//
// WARNING: match on address, never on symbol. Symbols collide badly here.
// Measured across the top 40 tokens by pair count: three contracts call
// themselves DAI (one of them is *named* "Anubis"), three call themselves USDT
// with two different decimal counts, four call themselves ANB, and two call
// themselves LGNS. Only the addresses below are the real ones.

const DAI = '0x83fd06f0846d9d90b3016bf670efe2e0b11cde14' // 18dec, "Dai Stablecoin"
const USDT = '0xdfb6a28bc6dc51fed17c27c880f2c66cdd040a3e' // 6dec,  "Bridged USDT"
const USDC = '0x7dd9c7cbc32df500fa3c06fd60cd62c4e97b2eef' // 6dec,  "Bridged USDC"
const LGNS = '0x4d1d808a081fdac440703b3765fc61f8028c06b8' // 9dec,  "Longinus"
const GLGNS = '0xf140a92c156e76f5a1d3d6f96284b250330f8f4c' // 18dec, "Governance LGNS"
const A = '0xa921267c56b3a57696d6fd7949c9fad0a8e0c177' // 18dec, "Bridged A"

// ── Reference token ──────────────────────────────────────────────────────────
//
// DAI, not a wrapped native. Anubis's gas token is gasDAI, so the hub asset of
// the DEX is itself a stablecoin — DAI is one side of 580 of the 811 pairs and
// holds 117.3M DAI of pooled liquidity. There is a DAI/WETH pair but BOTH its
// reserves are zero, so WETH is deliberately absent from the whitelist below;
// pricing through a dead pair is how a subgraph starts reporting nonsense.
export const REFERENCE_TOKEN = DAI

// DAI's own USD price is derived rather than assumed. It is close to but not
// exactly one: the DAI/USDT pair quoted 1 DAI = 0.9970 USDT when measured. The
// shared pricing code reserve-weights across these pairs, so the small
// depegging is carried through instead of being rounded away by declaring
// REFERENCE_TOKEN a dollar.
//
// Note the two pairs order their tokens differently — DAI is token0 in the USDT
// pair and token1 in the USDC pair — which exercises both branches of
// getEthPriceInUSD's stableTokenIsToken0 handling.
const DAI_USDT_PAIR = '0xf14c0e3da42fc36a416e6036dc4c7ca0375b734f' // 3.26M DAI / 3.25M USDT
const DAI_USDC_PAIR = '0x02fece8875b5f00561d883289794b46dc94dfe92' // 1.12M DAI / 1.12M USDC
export const STABLE_TOKEN_PAIRS = [DAI_USDT_PAIR, DAI_USDC_PAIR]

// ── Whitelist ────────────────────────────────────────────────────────────────
//
// Tokens whose USD value is trusted enough to count toward tracked volume and
// liquidity. Each one below has a DAI pair holding more than 1M DAI, measured:
//
//   LGNS   87.16M DAI    gLGNS  18.31M DAI    A      6.02M DAI
//   USDT    3.26M DAI    USDC    1.12M DAI
//
// LGNS, gLGNS and A are project tokens rather than stablecoins, which is a
// deliberate and reviewable call. Liquidity on this chain is extremely
// concentrated — the LGNS/DAI pair alone is 87.16M of the 117.27M DAI pooled,
// about 74% — so a stablecoin-only whitelist would classify most real trading
// on Anubis as untracked and leave the volume figures near useless. They are
// priced off deep DAI pairs, not off each other, so no pricing cycle is created.
// If any of these pools drains, drop the token from this list.
export const WHITELIST: string[] = [DAI, USDT, USDC, LGNS, GLGNS, A]

export const STABLECOINS = [DAI, USDT, USDC]

// ── Thresholds ───────────────────────────────────────────────────────────────
//
// Both are denominated in REFERENCE_TOKEN, i.e. DAI, i.e. roughly dollars —
// unlike an ETH-referenced chain where these numbers are ~3000x smaller. The
// tempo config is the precedent, being the other stablecoin-referenced chain.
//
// Sized against the measured distribution: of 580 DAI-side pairs, 16 hold more
// than 1,000 DAI and only 10 hold more than 10,000. A threshold in the tens of
// thousands would discard almost the whole chain, so these sit low enough to
// keep the real pools and high enough to reject the long tail of dust pairs.
export const MINIMUM_USD_THRESHOLD_NEW_PAIRS = BigDecimal.fromString('10000')

export const MINIMUM_LIQUIDITY_THRESHOLD_ETH = BigDecimal.fromString('2000')

export class TokenDefinition {
  address: Address
  symbol: string
  name: string
  decimals: BigInt
}

// Empty by design: every whitelisted token was called directly and all six
// returned symbol(), name(), decimals() and totalSupply() in standard form, so
// nothing needs a hardcoded definition or a totalSupply exemption.
export const STATIC_TOKEN_DEFINITIONS: TokenDefinition[] = []

export const SKIP_TOTAL_SUPPLY: string[] = []
