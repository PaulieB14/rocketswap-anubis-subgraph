/* eslint-disable prefer-const */
import { Address, BigDecimal, BigInt, Bytes } from '@graphprotocol/graph-ts/index'

import { Bundle, Pair, PairTokenLookup, Token } from '../../generated/schema'
import {
  MAX_REFERENCE_PRICE_DEVIATION,
  MINIMUM_LIQUIDITY_THRESHOLD_ETH,
  MINIMUM_STABLE_PAIR_REFERENCE_RESERVE,
  MINIMUM_USD_THRESHOLD_NEW_PAIRS,
  REFERENCE_PRICE_FALLBACK,
  REFERENCE_TOKEN,
  STABLE_TOKEN_PAIRS,
  STABLECOINS,
  WHITELIST,
} from './chain'
import { ADDRESS_ZERO, BUNDLE_ID, ONE_BD, TWO_BD, ZERO_BD } from './constants'

export function getEthPriceInUSD(): BigDecimal {
  // On chains where the reference token is itself a USD stablecoin (e.g. Arc, whose native gas
  // token is USDC and which has no wrapped-native / reference-stable pair), the reference token's
  // USD price is 1 by definition. Such chains opt in by including REFERENCE_TOKEN in STABLE_TOKEN_PAIRS.
  if (STABLE_TOKEN_PAIRS.includes(REFERENCE_TOKEN)) {
    return ONE_BD
  }

  // Reserve-weighted average of the reference token's price across the stable pairs, counting
  // only pairs that are deep enough and quote a sane price. Without these guards a single
  // drained pair sets the price on its own: on Anubis, DAI/USDT at 6.9e-14 DAI vs 10.9 USDT
  // priced DAI at ~$1.58e14 and produced 2.64e18 of fake volume (see config/anubis/chain.ts).
  let totalReferenceReserve = ZERO_BD
  let weightedPrice = ZERO_BD
  for (let i = 0; i < STABLE_TOKEN_PAIRS.length; i++) {
    const stableTokenPair = Pair.load(Bytes.fromHexString(STABLE_TOKEN_PAIRS[i]))
    if (stableTokenPair === null) {
      continue
    }
    // referenceIsToken1: the stable is token0, so the reference reserve is reserve1 and the
    // reference token's price in the stable is token0Price (= reserve0 / reserve1).
    const referenceIsToken1 = stableTokenPair.token1.toHexString() == REFERENCE_TOKEN
    const referenceReserve = referenceIsToken1 ? stableTokenPair.reserve1 : stableTokenPair.reserve0
    const price = referenceIsToken1 ? stableTokenPair.token0Price : stableTokenPair.token1Price

    if (referenceReserve.le(ZERO_BD) || referenceReserve.lt(MINIMUM_STABLE_PAIR_REFERENCE_RESERVE)) {
      continue
    }
    if (MAX_REFERENCE_PRICE_DEVIATION.gt(ZERO_BD)) {
      const deviation = price.minus(ONE_BD)
      if (deviation.gt(MAX_REFERENCE_PRICE_DEVIATION) || deviation.lt(ZERO_BD.minus(MAX_REFERENCE_PRICE_DEVIATION))) {
        continue
      }
    }
    totalReferenceReserve = totalReferenceReserve.plus(referenceReserve)
    weightedPrice = weightedPrice.plus(price.times(referenceReserve))
  }

  if (totalReferenceReserve.equals(ZERO_BD)) {
    return REFERENCE_PRICE_FALLBACK
  }
  return weightedPrice.div(totalReferenceReserve)
}

// return 0 if denominator is 0 in division
export function safeDiv(amount0: BigDecimal, amount1: BigDecimal): BigDecimal {
  if (amount1.equals(ZERO_BD)) {
    return ZERO_BD
  } else {
    return amount0.div(amount1)
  }
}

/**
 * Search through graph to find derived Eth per token.
 * @todo update to be derived ETH (add stablecoin estimates)
 **/
export function findEthPerToken(token: Token): BigDecimal {
  if (token.id.toHexString() == REFERENCE_TOKEN) {
    return ONE_BD
  }

  if (STABLECOINS.includes(token.id.toHexString())) {
    const bundle = Bundle.load(BUNDLE_ID)!
    return safeDiv(ONE_BD, bundle.ethPrice)
  }

  // loop through whitelist and check if paired with any
  for (let i = 0; i < WHITELIST.length; ++i) {
    let pairLookup = PairTokenLookup.load(token.id.concat(Address.fromString(WHITELIST[i])))
    if (pairLookup) {
      let pairId = pairLookup.pair
      if (pairId.toHexString() != ADDRESS_ZERO) {
        let pair = Pair.load(pairId)
        if (pair) {
          // The liquidity guard counts only the whitelisted (pricing) side, doubled. pair.reserveETH
          // also includes the token being priced at its own previous derivedETH, so a token whose
          // price had already been inflated could pass the threshold on the strength of that
          // inflation. This is the Uniswap v3 convention (ETH locked on the whitelisted side).
          if (pair.token0.equals(token.id)) {
            let token1 = Token.load(pair.token1)
            if (
              token1 &&
              pair.reserve1.times(token1.derivedETH).times(TWO_BD).gt(MINIMUM_LIQUIDITY_THRESHOLD_ETH)
            ) {
              return pair.token1Price.times(token1.derivedETH as BigDecimal) // return token1 per our token * Eth per token 1
            }
          }
          if (pair.token1.equals(token.id)) {
            let token0 = Token.load(pair.token0)
            if (
              token0 &&
              pair.reserve0.times(token0.derivedETH).times(TWO_BD).gt(MINIMUM_LIQUIDITY_THRESHOLD_ETH)
            ) {
              return pair.token0Price.times(token0.derivedETH as BigDecimal) // return token0 per our token * ETH per token 0
            }
          }
        }
      }
    }
  }
  return ZERO_BD // nothing was found return 0
}

/**
 * Accepts tokens and amounts, return tracked amount based on token whitelist
 * If one token on whitelist, return amount in that token converted to USD.
 * If both are, return average of two amounts
 * If neither is, return 0
 */
export function getTrackedVolumeUSD(
  tokenAmount0: BigDecimal,
  token0: Token,
  tokenAmount1: BigDecimal,
  token1: Token,
  pair: Pair
): BigDecimal {
  let bundle = Bundle.load(BUNDLE_ID)!
  let price0 = token0.derivedETH.times(bundle.ethPrice)
  let price1 = token1.derivedETH.times(bundle.ethPrice)

  // if less than 5 LPs, require high minimum reserve amount amount or return 0
  if (pair.liquidityProviderCount.lt(BigInt.fromI32(5))) {
    let reserve0USD = pair.reserve0.times(price0)
    let reserve1USD = pair.reserve1.times(price1)
    if (WHITELIST.includes(token0.id.toHexString()) && WHITELIST.includes(token1.id.toHexString())) {
      if (reserve0USD.plus(reserve1USD).lt(MINIMUM_USD_THRESHOLD_NEW_PAIRS)) {
        return ZERO_BD
      }
    }
    if (WHITELIST.includes(token0.id.toHexString()) && !WHITELIST.includes(token1.id.toHexString())) {
      if (reserve0USD.times(BigDecimal.fromString('2')).lt(MINIMUM_USD_THRESHOLD_NEW_PAIRS)) {
        return ZERO_BD
      }
    }
    if (!WHITELIST.includes(token0.id.toHexString()) && WHITELIST.includes(token1.id.toHexString())) {
      if (reserve1USD.times(BigDecimal.fromString('2')).lt(MINIMUM_USD_THRESHOLD_NEW_PAIRS)) {
        return ZERO_BD
      }
    }
  }

  // both are whitelist tokens, take average of both amounts
  if (WHITELIST.includes(token0.id.toHexString()) && WHITELIST.includes(token1.id.toHexString())) {
    return tokenAmount0.times(price0).plus(tokenAmount1.times(price1)).div(BigDecimal.fromString('2'))
  }

  // take full value of the whitelisted token amount
  if (WHITELIST.includes(token0.id.toHexString()) && !WHITELIST.includes(token1.id.toHexString())) {
    return tokenAmount0.times(price0)
  }

  // take full value of the whitelisted token amount
  if (!WHITELIST.includes(token0.id.toHexString()) && WHITELIST.includes(token1.id.toHexString())) {
    return tokenAmount1.times(price1)
  }

  // neither token is on white list, tracked volume is 0
  return ZERO_BD
}

/**
 * Accepts tokens and amounts, return tracked amount based on token whitelist
 * If one token on whitelist, return amount in that token converted to USD * 2.
 * If both are, return sum of two amounts
 * If neither is, return 0
 */
export function getTrackedLiquidityUSD(
  tokenAmount0: BigDecimal,
  token0: Token,
  tokenAmount1: BigDecimal,
  token1: Token
): BigDecimal {
  let bundle = Bundle.load(BUNDLE_ID)!
  let price0 = token0.derivedETH.times(bundle.ethPrice)
  let price1 = token1.derivedETH.times(bundle.ethPrice)

  // both are whitelist tokens, take average of both amounts
  if (WHITELIST.includes(token0.id.toHexString()) && WHITELIST.includes(token1.id.toHexString())) {
    return tokenAmount0.times(price0).plus(tokenAmount1.times(price1))
  }

  // take double value of the whitelisted token amount
  if (WHITELIST.includes(token0.id.toHexString()) && !WHITELIST.includes(token1.id.toHexString())) {
    return tokenAmount0.times(price0).times(BigDecimal.fromString('2'))
  }

  // take double value of the whitelisted token amount
  if (!WHITELIST.includes(token0.id.toHexString()) && WHITELIST.includes(token1.id.toHexString())) {
    return tokenAmount1.times(price1).times(BigDecimal.fromString('2'))
  }

  // neither token is on white list, tracked volume is 0
  return ZERO_BD
}

export function getTokenTrackedLiquidityUSD(
  tokenForPricing: Token,
  tokenForPricingAmount: BigDecimal,
  companionTokenAmount: BigDecimal,
  companionToken: Token
): BigDecimal {
  let bundle = Bundle.load(BUNDLE_ID)!
  let price0 = tokenForPricing.derivedETH.times(bundle.ethPrice)
  let price1 = companionToken.derivedETH.times(bundle.ethPrice)

  // both are whitelist tokens, take average of both amounts
  if (WHITELIST.includes(tokenForPricing.id.toHexString()) && WHITELIST.includes(companionToken.id.toHexString())) {
    return tokenForPricingAmount.times(price0)
  }

  // take double value of the whitelisted token amount
  if (WHITELIST.includes(tokenForPricing.id.toHexString()) && !WHITELIST.includes(companionToken.id.toHexString())) {
    return tokenForPricingAmount.times(price0)
  }

  // take double value of the whitelisted token amount
  if (!WHITELIST.includes(tokenForPricing.id.toHexString()) && WHITELIST.includes(companionToken.id.toHexString())) {
    return companionTokenAmount.times(price1)
  }

  // neither token is on white list, tracked volume is 0
  return ZERO_BD
}
