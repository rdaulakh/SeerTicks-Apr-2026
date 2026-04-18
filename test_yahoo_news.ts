#!/usr/bin/env tsx
/**
 * Test Yahoo Finance API for crypto news capabilities
 * Testing if we can get BTC news from Yahoo Finance
 */

import { callDataApi } from './server/_core/dataApi.js';

async function testYahooFinanceNews() {
  console.log('=== Testing Yahoo Finance News API for BTC ===\n');

  // Test 1: Try BTC-USD (Yahoo Finance crypto symbol)
  console.log('Test 1: Fetching insights for BTC-USD...');
  try {
    const btcInsights = await callDataApi('YahooFinance/get_stock_insights', {
      query: { symbol: 'BTC-USD' }
    });
    console.log('✅ BTC-USD insights response:', JSON.stringify(btcInsights, null, 2));
  } catch (error) {
    console.log('❌ BTC-USD insights failed:', error);
  }

  console.log('\n---\n');

  // Test 2: Try getting chart data for BTC-USD
  console.log('Test 2: Fetching chart for BTC-USD...');
  try {
    const btcChart = await callDataApi('YahooFinance/get_stock_chart', {
      query: {
        symbol: 'BTC-USD',
        region: 'US',
        interval: '1d',
        range: '5d'
      }
    });
    
    if (btcChart && btcChart.chart && btcChart.chart.result) {
      const meta = btcChart.chart.result[0]?.meta;
      console.log('✅ BTC-USD chart data available:');
      console.log(`  Current Price: $${meta?.regularMarketPrice}`);
      console.log(`  Exchange: ${meta?.exchangeName}`);
      console.log(`  Currency: ${meta?.currency}`);
    } else {
      console.log('❌ No chart data in response');
    }
  } catch (error) {
    console.log('❌ BTC-USD chart failed:', error);
  }

  console.log('\n---\n');

  // Test 3: Check if there's a news-specific endpoint
  console.log('Test 3: Checking available Yahoo Finance endpoints...');
  console.log('Available endpoints we know:');
  console.log('  - get_stock_chart');
  console.log('  - get_stock_insights');
  console.log('  - get_stock_holders');
  console.log('\nNote: Need to check if insights includes news data');

  console.log('\n=== Test Complete ===');
}

testYahooFinanceNews().catch(console.error);
