# BGeometrics Bitcoin API Research

## Overview
**URL:** https://bitcoin-data.com/v1/
**Documentation:** https://bitcoin-data.com/api/redoc.html

## Free Tier Limits
- **8 requests per hour**
- **15 requests per day**
- No API key required for basic access
- Token can be passed as URL parameter or header

## Available On-Chain Metrics (FREE)

### Core Bitcoin Metrics
| Metric | Endpoint | Description |
|--------|----------|-------------|
| MVRV | `/v1/mvrv` | Market Value to Realized Value ratio |
| NUPL | `/v1/nupl` | Net Unrealized Profit/Loss |
| SOPR | `/v1/sopr` | Spent Output Profit Ratio |
| NVT | `/v1/nvts` | Network Value to Transactions |
| NRPL | `/v1/nrpl` | Net Realized Profit/Loss |
| Puell Multiple | `/v1/puell-multiple` | Mining profitability indicator |
| Reserve Risk | `/v1/reserve-risk` | Long-term holder conviction |

### Supply Metrics
| Metric | Endpoint |
|--------|----------|
| Bitcoin Supply | `/v1/bitcoin-supply` |
| Supply in Profit | `/v1/supply-profit` |
| Supply in Loss | `/v1/supply-loss` |
| HODL Waves | `/v1/hodl-waves` |

### Market Metrics
| Metric | Endpoint |
|--------|----------|
| Market Cap | `/v1/market-cap` |
| Realized Cap | `/v1/realized-cap` |
| Thermo Cap | `/v1/thermo-cap` |
| Realized Price | `/v1/realized-price` |

### Network Metrics
| Metric | Endpoint |
|--------|----------|
| Active Addresses | `/v1/active-addresses` |
| Balance by Address | `/v1/balance-addr-*` |
| Hashrate | `/v1/hashrate` |
| Difficulty | `/v1/difficulty-btc` |
| Hashribbons | `/v1/hashribbons` |

### Derivatives (Updated Hourly)
| Metric | Endpoint |
|--------|----------|
| Funding Rate | `/v1/funding-rate` |
| Open Interest | `/v1/open-interest-1h` |
| Basis | `/v1/derivatives-basis-1h` |
| Taker Buy/Sell | `/v1/taker-buy-sell-volume-1h` |

### Technical Indicators
- RSI, MACD, SMA, EMA

### Multi-Crypto Support
ETH, BNB, SOL, XRP, ADA, DOGE, TON, AVAX, LINK, XLM, LTC, DOT, XMR, UNI, BCH, SHIB, ALGO, FIL, ATOM, ETC, XDC, HBAR, NEAR, VET, XTZ, XEM, ICP, STX, INJ

## API Usage Examples

```bash
# Get SOPR data
curl https://bitcoin-data.com/v1/sopr

# Get last MVRV value
curl https://bitcoin-data.com/v1/mvrv/last

# Get data with date range
curl "https://bitcoin-data.com/v1/nupl?startday=2024-01-01&endday=2024-12-31"

# Export to CSV
curl https://bitcoin-data.com/v1/sopr/csv
```

## Pros for SEER
1. **Completely FREE** - No API key required
2. **Pre-computed metrics** - MVRV, NUPL, SOPR, NVT all ready to use
3. **REST API** - Simple HTTP requests
4. **CSV export** - Easy data download
5. **Derivatives data** - Funding rates, open interest
6. **Multi-crypto** - Not just Bitcoin

## Cons/Limitations
1. **Very limited rate** - Only 15 requests/day on free tier
2. **Bitcoin-focused** - Most metrics are BTC only
3. **No real-time** - Daily data updates
4. **Beta status** - May have stability issues

## Recommendation for SEER
Best used for:
- Daily on-chain health checks
- MVRV/NUPL signals for macro positioning
- Derivatives sentiment (funding rates)

NOT suitable for:
- Real-time trading decisions
- High-frequency data needs
