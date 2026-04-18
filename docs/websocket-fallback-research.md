# WebSocket Fallback Options Research

## Overview

This document outlines the research findings for fallback WebSocket options to ensure reliable real-time cryptocurrency price data for the SEER Trading Platform.

## Current Primary Source: Coinbase WebSocket

- **URL**: `wss://ws-feed.exchange.coinbase.com`
- **Authentication**: No authentication required for public market data
- **Channels**: ticker, level2, heartbeat, trades
- **Pairs**: BTC-USD, ETH-USD (currently active)
- **Status**: Working (as of Jan 16, 2026)

## Recommended Fallback Options

### 1. CoinCap WebSocket API (Recommended Primary Fallback)

**Why CoinCap?**
- Simplest implementation
- No authentication required
- Lightweight JSON format
- Good for price tickers without order book overhead

**Connection Details:**
- **URL**: `wss://ws.coincap.io/prices?assets=bitcoin,ethereum`
- **Authentication**: None required
- **Format**: Simple JSON with asset-price pairs
- **Example Response**: `{"bitcoin":"95696.45","ethereum":"3313.22"}`

**Implementation Example:**
```typescript
const ws = new WebSocket('wss://ws.coincap.io/prices?assets=bitcoin,ethereum');
ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  if (data.bitcoin) console.log(`BTC: $${data.bitcoin}`);
  if (data.ethereum) console.log(`ETH: $${data.ethereum}`);
};
```

**Pros:**
- Very simple to implement
- No API key needed
- Reliable uptime
- Low latency

**Cons:**
- Limited to price data only (no order book, trades)
- May not have all trading pairs

---

### 2. Binance WebSocket API (Secondary Fallback)

**Why Binance?**
- Highest liquidity exchange
- Comprehensive data streams
- Well-documented API

**Connection Details:**
- **URL**: `wss://stream.binance.com:9443/ws/<stream>`
- **Streams**: 
  - Trade: `btcusdt@trade`
  - Ticker: `btcusdt@ticker`
  - Depth: `btcusdt@depth`
- **Authentication**: None required for public data

**Implementation Example:**
```typescript
const ws = new WebSocket('wss://stream.binance.com:9443/ws/btcusdt@trade');
ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  console.log(`BTC/USDT: $${data.p}`);
};
```

**Pros:**
- Very comprehensive data
- High liquidity = accurate prices
- Multiple stream types

**Cons:**
- Geo-restrictions (blocked in some regions including US)
- 24-hour connection limit (requires reconnection logic)
- May throttle under heavy load

---

### 3. Kraken WebSocket API (Tertiary Fallback)

**Why Kraken?**
- US-friendly exchange
- No authentication for public data
- Good for redundancy

**Connection Details:**
- **URL**: `wss://ws.kraken.com/`
- **Authentication**: None required for public market data
- **Subscription**: `{"event":"subscribe", "subscription":{"name":"ticker"}, "pair":["BTC/USD"]}`

**Implementation Example:**
```typescript
const ws = new WebSocket('wss://ws.kraken.com/');
ws.onopen = () => {
  ws.send(JSON.stringify({
    event: "subscribe",
    subscription: { name: "ticker" },
    pair: ["XBT/USD", "ETH/USD"]
  }));
};
ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  // Parse ticker data
};
```

**Pros:**
- US-friendly
- No API key needed for public data
- Heartbeat messages for connection health

**Cons:**
- Uses XBT instead of BTC for Bitcoin
- More complex message format

---

### 4. Alpaca Crypto WebSocket (Alternative)

**Why Alpaca?**
- US-focused platform
- Supports both Alpaca and Kraken data
- Good for trading integration

**Connection Details:**
- **URL**: `wss://stream.data.alpaca.markets/v1beta3/crypto/us`
- **Authentication**: Required (API key + secret)
- **Channels**: trades, quotes, bars, orderbooks

**Pros:**
- US-compliant
- Multiple data sources (Alpaca + Kraken)
- Comprehensive data types

**Cons:**
- Requires authentication
- Need Alpaca account

---

## Recommended Fallback Strategy

### Priority Order:
1. **Coinbase** (Primary) - Currently working
2. **CoinCap** (First Fallback) - Simplest, no auth
3. **Kraken** (Second Fallback) - US-friendly
4. **Binance** (Third Fallback) - If geo-restrictions don't apply

### Implementation Architecture:

```
┌─────────────────────────────────────────────────────────┐
│                  WebSocket Manager                       │
├─────────────────────────────────────────────────────────┤
│  ┌─────────┐   ┌─────────┐   ┌─────────┐   ┌─────────┐ │
│  │Coinbase │ → │ CoinCap │ → │ Kraken  │ → │ Binance │ │
│  │(Primary)│   │(Fallback│   │(Fallback│   │(Fallback│ │
│  │         │   │   #1)   │   │   #2)   │   │   #3)   │ │
│  └─────────┘   └─────────┘   └─────────┘   └─────────┘ │
│                                                         │
│  Features:                                              │
│  - Automatic failover on disconnect                     │
│  - Exponential backoff reconnection                     │
│  - Health monitoring with heartbeats                    │
│  - Price normalization across providers                 │
└─────────────────────────────────────────────────────────┘
```

### Key Implementation Requirements:

1. **Automatic Reconnection**
   - Exponential backoff: 1s, 2s, 4s, 8s, 16s, max 30s
   - Max retry attempts before failover: 3-5

2. **Health Monitoring**
   - Track last message timestamp
   - Timeout threshold: 30 seconds
   - Heartbeat/ping-pong handling

3. **Failover Logic**
   - Detect connection failure
   - Switch to next provider in priority order
   - Attempt to reconnect to primary periodically

4. **Price Normalization**
   - Handle different symbol formats (BTC vs XBT)
   - Normalize price data structure
   - Handle different decimal precisions

---

## Limitations to Consider

### Geo-Restrictions
- Binance: Blocked in US and some regions
- Some providers may block certain IPs

### Connection Limits
- Binance: 24-hour connection limit
- Most providers: Rate limits on subscriptions

### Data Quality
- Latency varies by provider
- Price differences between exchanges (arbitrage)
- Server load can affect update frequency

### Historical Data
- WebSockets provide live data only
- Need REST APIs for historical data

---

## Next Steps

1. Implement WebSocket Manager with fallback support
2. Add CoinCap adapter as first fallback
3. Add Kraken adapter as second fallback
4. Implement automatic reconnection with exponential backoff
5. Add health monitoring and alerting
6. Test failover scenarios

---

## References

- [Coinbase WebSocket API](https://docs.cloud.coinbase.com/exchange/docs/websocket-overview)
- [CoinCap WebSocket API](https://docs.coincap.io/#websocket)
- [Binance WebSocket API](https://binance-docs.github.io/apidocs/spot/en/#websocket-market-streams)
- [Kraken WebSocket API](https://docs.kraken.com/websockets/)
- [Alpaca Crypto WebSocket](https://docs.alpaca.markets/docs/real-time-crypto-pricing-data)
