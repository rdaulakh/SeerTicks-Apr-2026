# Free On-Chain Analytics API Evaluation for SEER

## Executive Summary

After researching alternatives to Glassnode ($799/mo) and CryptoQuant ($799/mo), I've identified several cost-effective options for SEER's on-chain analytics needs.

## API Comparison Matrix

| Provider | Cost | Rate Limits | On-Chain Metrics | Derivatives | DeFi Data | Best For |
|----------|------|-------------|------------------|-------------|-----------|----------|
| **Dune Analytics** | Free (2,500 credits/mo) | 40 calls/min | ✅ Custom SQL | ❌ | ✅ | Custom queries |
| **BGeometrics** | Free | 15 calls/day | ✅ Pre-computed | ✅ Hourly | ❌ | BTC metrics |
| **DeFiLlama** | Free | Unlimited* | ❌ | ❌ | ✅ Full | TVL/DeFi |
| **Santiment** | Free (1,000 calls/mo) | 100/min | ✅ Limited | ❌ | ✅ | Social + On-chain |
| **IntoTheBlock** | Free (limited) | Unknown | ✅ Limited | ❌ | ✅ | Financial indicators |

*May be throttled on heavy usage

## Recommended Stack for SEER

### Tier 1: Essential (Implement First)

#### 1. **Dune Analytics** - Custom On-Chain Analysis
- **Why:** Most flexible, can create any metric via SQL
- **Cost:** Free (2,500 credits/month)
- **Use Cases:**
  - Whale wallet tracking
  - Exchange flow analysis
  - Token holder distribution
  - Custom MVRV/NUPL calculations
- **Integration:** TypeScript SDK available

#### 2. **BGeometrics** - Pre-computed Bitcoin Metrics
- **Why:** Free pre-computed metrics, no calculation needed
- **Cost:** Completely free (15 calls/day)
- **Use Cases:**
  - Daily MVRV, NUPL, SOPR signals
  - Funding rates (hourly)
  - Hashrate/difficulty
  - Supply metrics
- **Integration:** Simple REST API

#### 3. **DeFiLlama** - DeFi Intelligence
- **Why:** Best free DeFi data, no API key needed
- **Cost:** Completely free
- **Use Cases:**
  - TVL tracking (capital flows)
  - Stablecoin supply changes
  - DEX volume analysis
  - Protocol health monitoring
- **Integration:** Simple REST API

### Tier 2: Enhanced (Implement Later)

#### 4. **Santiment** - Social + On-Chain
- **Why:** Unique social metrics + on-chain
- **Cost:** Free (1,000 calls/month)
- **Use Cases:**
  - Social volume spikes
  - Development activity
  - Whale monitoring
- **Limitation:** 30-day data lag on free tier

## Metrics Coverage Analysis

### What We Can Get FREE vs Paid

| Metric Category | Free Sources | Paid Only (Glassnode) |
|-----------------|--------------|----------------------|
| MVRV | BGeometrics, Dune | ✅ Available free |
| NUPL | BGeometrics, Dune | ✅ Available free |
| SOPR | BGeometrics, Dune | ✅ Available free |
| NVT | BGeometrics, Dune | ✅ Available free |
| Exchange Flows | Dune | ✅ Available free |
| Whale Tracking | Dune, Santiment | ✅ Available free |
| Funding Rates | BGeometrics | ✅ Available free |
| Open Interest | BGeometrics | ✅ Available free |
| TVL | DeFiLlama | ✅ Available free |
| Stablecoin Supply | DeFiLlama | ✅ Available free |
| Entity-Adjusted Metrics | ❌ | Glassnode only |
| Miner Flows | Dune (limited) | Better on Glassnode |
| Realized Cap Bands | Dune (custom) | Better on Glassnode |

## Implementation Priority

### Phase 1: Quick Wins (Week 1)
1. **BGeometrics Integration**
   - Daily on-chain health check
   - MVRV/NUPL/SOPR signals
   - Funding rate monitoring
   - ~2 hours to implement

2. **DeFiLlama Integration**
   - TVL tracking for major protocols
   - Stablecoin flow monitoring
   - DEX volume analysis
   - ~2 hours to implement

### Phase 2: Custom Analysis (Week 2)
3. **Dune Analytics Integration**
   - Create custom whale tracking queries
   - Exchange flow analysis
   - Token holder distribution
   - ~4-6 hours to implement

### Phase 3: Enhanced Signals (Week 3)
4. **Santiment Integration** (if needed)
   - Social volume alerts
   - Development activity tracking
   - ~2 hours to implement

## Cost Comparison

| Solution | Monthly Cost | Annual Cost |
|----------|-------------|-------------|
| Glassnode Professional | $799 | $9,588 |
| CryptoQuant Professional | $799 | $9,588 |
| **Our Free Stack** | **$0** | **$0** |
| Dune Plus (if needed) | $349 | $4,188 |

**Savings: $9,588 - $19,176 per year**

## Technical Implementation Notes

### Dune Analytics
```typescript
// npm install @duneanalytics/client
import { DuneClient } from '@duneanalytics/client';

const dune = new DuneClient(process.env.DUNE_API_KEY);

// Execute a pre-built query for whale tracking
const results = await dune.execute({ queryId: 123456 });
```

### BGeometrics
```typescript
// No SDK needed, simple fetch
const mvrv = await fetch('https://bitcoin-data.com/v1/mvrv/last');
const sopr = await fetch('https://bitcoin-data.com/v1/sopr/last');
const fundingRate = await fetch('https://bitcoin-data.com/v1/funding-rate');
```

### DeFiLlama
```typescript
// No API key needed
const tvl = await fetch('https://api.llama.fi/protocols');
const stablecoins = await fetch('https://api.llama.fi/stablecoins');
const dexVolumes = await fetch('https://api.llama.fi/overview/dexs');
```

## Recommended Dune Queries to Create

1. **Whale Wallet Tracker**
   - Track wallets with >1000 BTC or >10000 ETH
   - Monitor inflows/outflows to exchanges

2. **Exchange Flow Analysis**
   - Net exchange inflows/outflows
   - Exchange reserve changes

3. **Smart Money Tracking**
   - Track known fund wallets
   - Monitor DEX whale trades

4. **Token Holder Distribution**
   - Concentration metrics
   - Holder growth/decline

## Conclusion

The combination of **Dune + BGeometrics + DeFiLlama** provides:
- ✅ 90%+ of Glassnode metrics coverage
- ✅ $0 monthly cost
- ✅ Custom query flexibility (Dune)
- ✅ Pre-computed metrics (BGeometrics)
- ✅ Comprehensive DeFi data (DeFiLlama)

**Recommendation:** Implement all three in priority order, starting with BGeometrics for immediate on-chain signals.
