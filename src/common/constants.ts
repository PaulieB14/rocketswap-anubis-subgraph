import { Address, BigDecimal, BigInt, Bytes } from '@graphprotocol/graph-ts/index'

import { Factory as FactoryContract } from '../../generated/templates/Pair/Factory'
import { FACTORY_ADDRESS } from './chain'

export const ADDRESS_ZERO = '0x0000000000000000000000000000000000000000'

export const ZERO_BI = BigInt.fromI32(0)
export const ONE_BI = BigInt.fromI32(1)
export const ZERO_BD = BigDecimal.fromString('0')
export const ONE_BD = BigDecimal.fromString('1')
export const BI_18 = BigInt.fromI32(18)

// Singleton entity keyed by Bytes rather than the string '1', so every entity
// in this subgraph has a Bytes id. See the Bytes-as-IDs best practice.
export const BUNDLE_ID = Bytes.fromI32(1)

// The factory's own entity id. chain.ts keeps addresses as readable lowercase
// hex strings; conversion to Bytes happens here, once, rather than at each use.
export const FACTORY_ID = Bytes.fromHexString(FACTORY_ADDRESS)

export const factoryContract = FactoryContract.bind(Address.fromString(FACTORY_ADDRESS))
export const ALMOST_ZERO_BD = BigDecimal.fromString('0.000001')
