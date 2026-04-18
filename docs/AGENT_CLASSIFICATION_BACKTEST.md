# SEER Agent Classification for Backtesting

## Overview

This document classifies all trading agents in the SEER system based on their data dependencies for accurate backtesting.

## Agent Classification Summary

| Agent | Classification | Mode in Backtest | Data Dependencies |
|-------|---------------|------------------|-------------------|
| TechnicalAnalyst | **Fully Replayable** | ACTIVE | OHLCV candles only (RSI, MACD, Bollinger, SMA, EMA, ATR, SuperTrend, VWAP) |
| PatternMatcher | **Fully Replayable** | ACTIVE | OHLCV candles, winning patterns from DB |
| VolumeProfileAnalyzer | **Fully Replayable** | ACTIVE | OHLCV candles (VWAP, POC, Value Area) |
| OrderFlowAnalyst | **API-Dependent** | PROXY | Order book data (live WebSocket) - use volume proxy |
| WhaleTracker | **API-Dependent** | PROXY | Whale Alert API - use volume fallback |
| WhaleAlertAgent | **API-Dependent** | PROXY | Whale Alert API - use volume fallback |
| FundingRateAnalyst | **API-Dependent** | PROXY | Binance Futures API - use momentum proxy |
| LiquidationHeatmap | **API-Dependent** | PROXY | Binance Futures OI/LS ratio - use volatility proxy |
| OnChainFlowAnalyst | **API-Dependent** | PROXY | Exchange flow data - use volume proxy |
| OnChainAnalyst | **API-Dependent** | PROXY | Whale Alert + on-chain metrics - use volume proxy |
| NewsSentinel | **Live-Only** | SHADOW | CoinGecko news API - cannot replay |
| SentimentAnalyst | **Live-Only** | SHADOW | Fear & Greed Index, social sentiment - cannot replay |
| MacroAnalyst | **Live-Only** | SHADOW | DXY, VIX, S&P500, stablecoin supply - cannot replay |
| ForexCorrelationAgent | **API-Dependent** | PROXY | MetaAPI forex data - use correlation proxy |

## Detailed Classification

### 1. Fully Replayable Agents (OHLCV-Only)

These agents can run normally during backtest using historical candle data:

#### TechnicalAnalyst
- **Data Source**: OHLCV candles from WebSocket cache or REST API
- **Indicators**: RSI, MACD, Bollinger Bands, SMA (20/50/200), EMA (12/26), ATR, SuperTrend, VWAP
- **Backtest Mode**: ACTIVE - Full signal generation
- **Evaluation**: Full performance metrics

#### PatternMatcher
- **Data Source**: Multi-timeframe OHLCV (1d, 4h, 5m, 1m)
- **Features**: Classic chart patterns, winning patterns from DB, alpha decay tracking
- **Backtest Mode**: ACTIVE - Full signal generation
- **Evaluation**: Full performance metrics

#### VolumeProfileAnalyzer
- **Data Source**: OHLCV candles (1h timeframe)
- **Features**: VWAP bands, POC, Value Area, HVN/LVN detection
- **Backtest Mode**: ACTIVE - Full signal generation
- **Evaluation**: Full performance metrics

### 2. API-Dependent Agents (Requires Proxy/Approximation)

These agents have deterministic fallback logic that can be used during backtest:

#### OrderFlowAnalyst
- **Live Data**: Order book snapshots via WebSocket
- **Fallback Available**: Yes - volume-based analysis
- **Proxy Logic**: Use volume spikes and price momentum as order flow proxy
- **Backtest Mode**: PROXY - Use deterministic fallback
- **Evaluation**: Signal frequency and correlation with outcomes

#### WhaleTracker / WhaleAlertAgent
- **Live Data**: Whale Alert API ($500k+ transactions)
- **Fallback Available**: Yes - volume-based whale detection
- **Proxy Logic**: Large volume candles (>2x average) indicate whale activity
- **Backtest Mode**: PROXY - Use volume fallback
- **Evaluation**: Signal frequency and correlation with outcomes

#### FundingRateAnalyst
- **Live Data**: Binance Futures funding rates
- **Fallback Available**: Yes - price momentum analysis
- **Proxy Logic**: Extreme price moves suggest funding rate extremes
- **Backtest Mode**: PROXY - Use momentum proxy
- **Evaluation**: Signal frequency and correlation with outcomes

#### LiquidationHeatmap
- **Live Data**: Binance Futures OI and Long/Short ratio
- **Fallback Available**: Yes - volatility analysis
- **Proxy Logic**: High volatility suggests liquidation cascades
- **Backtest Mode**: PROXY - Use volatility proxy
- **Evaluation**: Signal frequency and correlation with outcomes

#### OnChainFlowAnalyst / OnChainAnalyst
- **Live Data**: Exchange flow data, SOPR, MVRV, NVT
- **Fallback Available**: Yes - volume-based flow estimation
- **Proxy Logic**: Volume patterns indicate accumulation/distribution
- **Backtest Mode**: PROXY - Use volume proxy
- **Evaluation**: Signal frequency and correlation with outcomes

#### ForexCorrelationAgent
- **Live Data**: MetaAPI forex data (DXY, XAUUSD, EURUSD)
- **Fallback Available**: Partial - use historical correlation assumptions
- **Proxy Logic**: Apply historical BTC-DXY correlation (-0.6 to -0.8)
- **Backtest Mode**: PROXY - Use correlation proxy
- **Evaluation**: Signal frequency and correlation with outcomes

### 3. Live-Only Agents (Non-Replayable)

These agents cannot be accurately replayed and should run in shadow mode:

#### NewsSentinel
- **Live Data**: CoinGecko news API, real-time news feeds
- **Fallback Available**: No - news cannot be replayed
- **Backtest Mode**: SHADOW - Log signals only, no consensus influence
- **Evaluation**: Signal frequency, correlation analysis only

#### SentimentAnalyst
- **Live Data**: Fear & Greed Index, social media sentiment
- **Fallback Available**: Partial - deterministic fallback exists but not accurate
- **Backtest Mode**: SHADOW - Log signals only, no consensus influence
- **Evaluation**: Signal frequency, correlation analysis only

#### MacroAnalyst
- **Live Data**: DXY, VIX, S&P500, stablecoin supply, Fed announcements
- **Fallback Available**: Partial - deterministic fallback exists
- **Backtest Mode**: SHADOW - Log signals only, no consensus influence
- **Evaluation**: Signal frequency, veto correlation analysis

## Backtest Configuration

### Active Agents (Full Consensus Participation)
1. TechnicalAnalyst
2. PatternMatcher
3. VolumeProfileAnalyzer

### Proxy Agents (Capped Influence)
1. OrderFlowAnalyst - Max 15% consensus weight
2. WhaleTracker - Max 10% consensus weight
3. FundingRateAnalyst - Max 10% consensus weight
4. LiquidationHeatmap - Max 10% consensus weight
5. OnChainFlowAnalyst - Max 10% consensus weight
6. ForexCorrelationAgent - Max 10% consensus weight

### Shadow Agents (No Consensus Influence)
1. NewsSentinel - Log only
2. SentimentAnalyst - Log only
3. MacroAnalyst - Log only (veto analysis)

## Data Availability

Based on database analysis:

| Table | Symbol | Interval | Candle Count | Date Range |
|-------|--------|----------|--------------|------------|
| historicalCandles | BTC-USD | 1h | 8,195 | Oct 15, 2025 - Dec 31, 2025 |
| historicalCandles | ETH-USD | 1h | 7,995 | Oct 15, 2025 - Jan 1, 2026 |

**Available Backtest Period**: ~2.5 months (Oct 15, 2025 - Jan 1, 2026)

**Note**: The user mentioned 2 years of data, but the database shows only ~2.5 months. The backtest will use all available data.

## Recommendations

1. **Do Not Touch**: TechnicalAnalyst, PatternMatcher, VolumeProfileAnalyzer - these are working correctly
2. **Add Proxy Logic**: Improve fallback accuracy for API-dependent agents
3. **Live Validation Only**: NewsSentinel, SentimentAnalyst, MacroAnalyst - validate in live trading
4. **Safe Tuning**: Consensus thresholds, position sizing tiers
5. **Overfitting Risk**: Avoid tuning based on limited 2.5-month data
