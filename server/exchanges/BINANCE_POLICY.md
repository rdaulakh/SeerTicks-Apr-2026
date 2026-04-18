# Binance API Usage Policy & Compliance

This document outlines how SEER complies with Binance API policies to prevent IP bans and ensure reliable operation.

## ✅ Current Implementation Status

### WebSocket-Only Architecture (Compliant)

**Zero REST API calls to Binance in production:**
- All real-time market data via WebSocket streams
- Historical candles fetched via MetaAPI proxy (not direct Binance)
- No polling, no repeated REST requests

**WebSocket Streams Used:**
- `trade`: Real-time trade execution data (10-50ms latency)
- `ticker`: 24h rolling window statistics (1s updates)
- `kline_1m`, `kline_5m`, `kline_1h`, `kline_4h`, `kline_1d`: OHLCV candle data

### Connection Management (Compliant)

**Exponential Backoff Reconnection:**
```
Attempt 1: 1s delay
Attempt 2: 2s delay
Attempt 3: 4s delay
Attempt 4: 8s delay
...
Max attempts: 10
```

**Single Connection Per Symbol:**
- One WebSocket connection per symbol (no connection spam)
- Combined streams format: `/btcusdt@trade/btcusdt@ticker/btcusdt@kline_1h`
- Clean closure on unsubscribe

### Rate Limiting (Compliant)

**MetaAPI Historical Candles:**
- 1000ms delay between requests (increased from 500ms)
- Fetched ONCE on startup only
- WebSocket maintains cache thereafter

**No REST API Weight Concerns:**
- Zero REST calls = Zero weight consumption
- All data via WebSocket (unlimited)

## 🚫 What We DON'T Do (Avoiding Bans)

1. **No REST API Polling** - Never fetch ticker/candles via REST in loops
2. **No Excessive Connections** - One WebSocket per symbol, not per stream
3. **No Rapid Reconnects** - Exponential backoff prevents connection spam
4. **No Weight Violations** - Zero REST calls = Zero weight usage
5. **No IP Rotation Needed** - Compliant behavior = No bans

## 📊 Binance WebSocket Limits (Official)

**Connection Limits:**
- Max 300 connections per IP per 5 minutes
- Max 10 connections per second per IP
- **Our usage:** 1-5 connections total (well within limits)

**Message Limits:**
- Max 10 messages per second per connection
- **Our usage:** Receive-only (no outbound messages)

**Stream Limits:**
- Max 1024 streams per connection
- **Our usage:** 3-5 streams per connection (trade, ticker, klines)

## 🔍 Monitoring & Alerts

**Latency Tracking:**
- WebSocket latency: 10-50ms average
- Logged per message for performance monitoring

**Connection Health:**
- Automatic reconnection on disconnect
- Max reconnect attempts before alerting
- Event emission for monitoring: `connected`, `disconnected`, `error`

**Rate Limit Detection:**
- MetaAPI 429 errors logged
- Automatic backoff on errors
- No Binance 418/429 errors (compliant)

## 🛡️ Best Practices Implemented

1. **WebSocket-First Architecture** - All real-time data via WebSocket
2. **Exponential Backoff** - Prevents reconnection spam
3. **Connection Pooling** - Reuse connections across streams
4. **Graceful Degradation** - Continue operation if one stream fails
5. **Latency Monitoring** - Track performance for optimization

## 📝 Future Considerations

**If Adding REST API Calls:**
1. Implement request weight tracking
2. Add rate limiter (1200 weight/minute limit)
3. Use exponential backoff on 429 errors
4. Cache responses aggressively
5. Prefer WebSocket over REST when possible

**If Scaling to Multiple Symbols:**
1. Use combined streams (more efficient)
2. Monitor total connection count
3. Implement connection pooling
4. Consider using Binance's multi-stream endpoint

## 🔗 Official Documentation

- [Binance WebSocket Streams](https://binance-docs.github.io/apidocs/spot/en/#websocket-market-streams)
- [Binance API Rate Limits](https://binance-docs.github.io/apidocs/spot/en/#limits)
- [Binance WebSocket Limits](https://binance-docs.github.io/apidocs/spot/en/#websocket-limits)

## ✅ Compliance Checklist

- [x] WebSocket-only for real-time data
- [x] Exponential backoff reconnection
- [x] Single connection per symbol
- [x] Combined streams format
- [x] No REST API polling
- [x] Rate limiting on historical fetches
- [x] Connection health monitoring
- [x] Latency tracking
- [x] Graceful error handling
- [x] Clean connection closure

**Status:** ✅ **FULLY COMPLIANT** with Binance API policies
