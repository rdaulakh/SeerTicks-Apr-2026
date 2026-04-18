// Check if price feed is working by querying the latest prices
import { priceFeedService } from './server/services/priceFeedService.js';

console.log('=== PRICE FEED STATUS ===');

// Get latest prices for BTC and ETH
const btcPrice = priceFeedService.getLatestPrice('BTC-USD');
const ethPrice = priceFeedService.getLatestPrice('ETH-USD');

console.log('BTC-USD:', btcPrice);
console.log('ETH-USD:', ethPrice);

// Check if service is running
console.log('\nService status:', priceFeedService.isRunning ? 'RUNNING' : 'STOPPED');
