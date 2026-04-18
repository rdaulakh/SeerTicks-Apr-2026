# CoinAPI WebSocket API Reference

## Connection Endpoints
| Region | Encrypted | URL |
|--------|-----------|-----|
| GeoDNS (auto-routing) | Yes | `wss://ws.coinapi.io/v1/` |
| North & South America | Yes | `wss://api-ncsa.coinapi.io/v1/` |
| Europe, Middle East & Africa | Yes | `wss://api-emea.coinapi.io/v1/` |
| Asia Pacific | Yes | `wss://api-apac.coinapi.io/v1/` |

## Authentication
- API key can be passed in:
  - Query string: `?apikey=YOUR-API-KEY`
  - Header: `X-CoinAPI-Key: YOUR-API-KEY`
  - Hello message: `{"type": "hello", "apikey": "YOUR-API-KEY", ...}`

## Hello Message (Subscribe)
```json
{
  "type": "hello",
  "apikey": "YOUR-API-KEY",
  "heartbeat": false,
  "subscribe_data_type": ["trade"],
  "subscribe_filter_symbol_id": ["COINBASE_SPOT_BTC_USD", "COINBASE_SPOT_ETH_USD"]
}
```

## Trade Message Format
```json
{
  "type": "trade",
  "symbol_id": "BITSTAMP_SPOT_BTC_USD",
  "sequence": 2323346,
  "time_exchange": "2013-09-28T22:40:50.0000000Z",
  "time_coinapi": "2017-03-18T22:42:21.3763342Z",
  "uuid": "770C7A3B-7258-4441-8182-83740F3E2457",
  "price": 770.000000000,
  "size": 0.050000000,
  "taker_side": "BUY"
}
```

## Quote Message Format (Best Bid/Ask)
```json
{
  "type": "quote",
  "symbol_id": "BITSTAMP_SPOT_BTC_USD",
  "sequence": 2323346,
  "time_exchange": "2013-09-28T22:40:50.0000000Z",
  "time_coinapi": "2017-03-18T22:42:21.3763342Z",
  "ask_price": 770.000000000,
  "ask_size": 3252,
  "bid_price": 760,
  "bid_size": 124
}
```

## Symbol ID Format
- Format: `{EXCHANGE}_{TYPE}_{BASE}_{QUOTE}`
- Examples:
  - `COINBASE_SPOT_BTC_USD`
  - `BINANCE_SPOT_BTC_USDT`
  - `BITSTAMP_SPOT_ETH_USD`

## Important Notes
- Must respond to "Ping" with "Pong" every minute
- Trade messages sent for every executed transaction
- Quote messages sent for each update on orderbook best bid/ask
- Precision: Full decimal precision (0.000000000)
