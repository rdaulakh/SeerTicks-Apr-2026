# DeFiLlama API Research

## Overview
**Base URL:** https://api.llama.fi
**Documentation:** https://api-docs.defillama.com/
**Pricing:** Free (Premium $300/mo for higher rate limits)

## Free Tier Features
- **Open API** - No API key required for most endpoints
- **No explicit rate limits** on free tier (but may be throttled)
- **Comprehensive DeFi data** across all chains

## Available Data Categories

### TVL (Total Value Locked)
| Endpoint | Description |
|----------|-------------|
| `GET /protocols` | List all protocols with TVL |
| `GET /protocol/{protocol}` | Historical TVL with token/chain breakdown |
| `GET /v2/historicalChainTvl` | Historical TVL for all chains |
| `GET /v2/historicalChainTvl/{chain}` | Historical TVL for specific chain |
| `GET /tvl/{protocol}` | Current TVL of a protocol |
| `GET /v2/chains` | Current TVL of all chains |

### Coins/Prices
| Endpoint | Description |
|----------|-------------|
| `GET /coins/prices/current/{coins}` | Current prices |
| `GET /coins/prices/historical/{timestamp}/{coins}` | Historical prices |
| `GET /coins/chart/{coins}` | Price charts |

### Stablecoins
| Endpoint | Description |
|----------|-------------|
| `GET /stablecoins` | List all stablecoins |
| `GET /stablecoincharts/all` | Historical stablecoin data |
| `GET /stablecoin/{asset}` | Specific stablecoin data |

### Yields/APY
| Endpoint | Description |
|----------|-------------|
| `GET /pools` | All yield pools |
| `GET /pool/{pool}` | Specific pool data |

### Volumes
| Endpoint | Description |
|----------|-------------|
| `GET /overview/dexs` | DEX volumes overview |
| `GET /overview/dexs/{chain}` | Chain-specific DEX volumes |
| `GET /summary/dexs/{protocol}` | Protocol DEX volume |

### Fees & Revenue
| Endpoint | Description |
|----------|-------------|
| `GET /overview/fees` | Fees overview |
| `GET /overview/fees/{chain}` | Chain-specific fees |
| `GET /summary/fees/{protocol}` | Protocol fees |

### Perps (Perpetuals)
| Endpoint | Description |
|----------|-------------|
| `GET /overview/perps` | Perps overview |
| `GET /overview/perps/{chain}` | Chain-specific perps |

### Bridges
| Endpoint | Description |
|----------|-------------|
| `GET /bridges` | All bridges |
| `GET /bridge/{id}` | Specific bridge data |

### ETFs
| Endpoint | Description |
|----------|-------------|
| `GET /etfs` | Bitcoin/Ethereum ETF data |

## API Usage Examples

```bash
# Get all protocols TVL
curl https://api.llama.fi/protocols

# Get Aave TVL history
curl https://api.llama.fi/protocol/aave

# Get current ETH price
curl https://api.llama.fi/coins/prices/current/ethereum:0x0000000000000000000000000000000000000000

# Get all DEX volumes
curl https://api.llama.fi/overview/dexs

# Get stablecoin data
curl https://api.llama.fi/stablecoins
```

## Pros for SEER
1. **Completely FREE** - No API key required
2. **Comprehensive DeFi data** - TVL, yields, volumes, fees
3. **Multi-chain support** - All major blockchains
4. **Real-time data** - Current prices and TVL
5. **Historical data** - Full history available
6. **Well-documented** - OpenAPI spec available

## Cons/Limitations
1. **DeFi-focused** - No traditional on-chain metrics (MVRV, NUPL)
2. **No whale tracking** - No address-level data
3. **Rate limits** - May be throttled on heavy usage
4. **No derivatives data** - Limited perps info

## Best Use Cases for SEER
- **DeFi sentiment** - TVL changes indicate capital flows
- **Stablecoin flows** - Track stablecoin supply changes
- **DEX volumes** - Market activity indicator
- **Yield farming** - APY tracking for opportunities
- **Protocol health** - Monitor protocol TVL changes
