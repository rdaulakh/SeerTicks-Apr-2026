# Dune Analytics API Research

## Pricing Tiers

| Plan | Price | Credits/Month | Datapoints/Credit | API Calls/Min | Storage |
|------|-------|---------------|-------------------|---------------|---------|
| Free | $0/mo | 2,500 | 1,000 | 40 | 100 MB |
| Analyst | $65/mo | 4,000 | 1,000 | 40 | 1 GB |
| Plus | $349/mo | 25,000 | 5,000 | 200 | 15 GB |
| Enterprise | Custom | Custom | Custom | Custom | 200 GB+ |

## Key Features

### Free Tier Capabilities
- 2,500 credits per month
- 1,000 datapoints per credit (API or CSV)
- 40 API calls per minute
- 1 concurrent SQL query
- 100 MB storage
- 1 alert/webhook
- 10 private queries
- 1 private dashboard

### API Integration
- Official SDKs: Python, TypeScript, Go
- Execute SQL queries via API
- Retrieve query results programmatically
- Webhooks for alerts (1 on free tier)

### Credit Calculation
- Credits = Datapoints / 1000
- Datapoints ≈ rows × columns
- 100 bytes per cell limit (spillover counts as additional cells)

## Integration Method for SEER

```typescript
// Install: npm install @duneanalytics/client
import { DuneClient } from '@duneanalytics/client';

const dune = new DuneClient('your-api-key');
const results = await dune.execute({ queryId: 3493826 });
```

## Pre-built Queries Available
Dune has thousands of community-created queries for:
- Whale wallet tracking
- DEX volume analysis
- Token holder distribution
- NFT analytics
- DeFi protocol metrics
- Exchange flows

## Pros for SEER
1. **Free tier available** - 2,500 credits/month
2. **Custom SQL queries** - Can create specific on-chain metrics
3. **Community queries** - Access to thousands of pre-built queries
4. **TypeScript SDK** - Easy integration with Node.js backend
5. **Real-time data** - Access to latest blockchain data

## Cons/Limitations
1. Free tier is limited (2,500 credits)
2. Query execution can be slow (seconds to minutes)
3. Rate limited to 40 calls/minute on free tier
4. Need to manage query IDs and results
