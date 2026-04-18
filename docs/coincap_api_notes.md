# CoinCap API v3 Documentation Notes

## Key Endpoints

### REST API
- Base URL: `rest.coincap.io/v3/...`
- Authentication: Bearer token in header OR `apiKey` query parameter

### WebSocket
- URL: `wss://wss.coincap.io/`
- Prices endpoint: `wss://wss.coincap.io/prices?assets=bitcoin,usdc&apiKey=XXX`
- ALL assets: `wss://wss.coincap.io/prices?assets=ALL&apiKey=YourApiKey`
- Cost: 1 credit per minute

## Growth Tier (User's Plan)
- 225,000 credits/month
- Full WebSocket access
- 600 API calls per minute limit

## WebSocket Example
```bash
websocat "wss://wss.coincap.io/prices?assets=bitcoin,usdc&apiKey=XXX"
```

## Important Notes
- Asset IDs use slugs: `bitcoin`, `ethereum`, `solana`, etc.
- NOT ticker symbols like BTC, ETH
- Prices update several times per second based on market activity
