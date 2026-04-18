#!/usr/bin/env python3
"""
Discuss Week 5-6 Entry System Improvements with Claude AI via Anthropic API
"""

import os
import anthropic

client = anthropic.Anthropic(api_key=os.environ.get("ANTHROPIC_API_KEY"))

# Context about current system and what we need to implement
context = """
# SEER Trading Platform - Week 5-6: Entry System Improvements

## Current System State
We have fixed 9 agent biases in Weeks 1-4:
- SentimentAnalyst: Z-score normalization (was 99.8% bullish)
- TechnicalAnalyst: SuperTrend 2.5, trend confirmation filter (was 76.5% bullish)
- NewsSentinel: Balanced keywords, wider neutral zone (was 96.9% bearish)
- MacroAnalyst: Regime thresholds ±0.2 (was 75.7% neutral)
- FundingRateAnalyst: Multi-exchange fallback (was 100% neutral)
- LiquidationHeatmap: Multi-exchange fallback (was 100% neutral)
- WhaleTracker: Multi-source service (was 100% neutral)
- OnChainFlowAnalyst: Multi-source service (was 100% neutral)
- MLPredictionAgent: Reduced candles, multi-factor momentum (was 100% neutral)

## Current Entry System Issues
1. Trades enter on single agent signals without confirmation
2. No multi-timeframe alignment check
3. No volume confirmation before entry
4. Win rate is still low (2.01% before fixes)

## What We Need to Implement (Week 5-6)
1. **Entry Confirmation Filters**: Require minimum 2+ agents to agree on direction
2. **Multi-Timeframe Alignment**: Check that 1m, 5m, 15m, 1h timeframes agree
3. **Volume Confirmation**: Require above-average volume for entry

## Current Entry Flow
The entry decision is made in TieredDecisionMaking.ts which:
1. Collects signals from all agents
2. Calculates weighted consensus
3. If consensus > threshold (65-75%), enters trade

## Questions for Claude AI
1. What's the optimal minimum agent agreement count for entry confirmation?
2. How should we weight multi-timeframe alignment (all must agree vs majority)?
3. What volume threshold should we use (1.2x, 1.5x, 2x average)?
4. Should we add a "cooling off" period after failed entries?
5. How do we handle conflicting timeframe signals?
6. What's the recommended implementation approach - modify existing TieredDecisionMaking or create new EntryConfirmationService?
"""

print("=" * 80)
print("WEEK 5-6: ENTRY SYSTEM IMPROVEMENTS - CLAUDE AI DISCUSSION")
print("=" * 80)

message = client.messages.create(
    model="claude-sonnet-4-20250514",
    max_tokens=4096,
    messages=[
        {
            "role": "user",
            "content": f"""{context}

Please provide your expert recommendations for implementing the Week 5-6 Entry System Improvements. Include:

1. **Entry Confirmation Filter Design**
   - Optimal minimum agent agreement count
   - How to handle agent weight differences
   - Code structure recommendation

2. **Multi-Timeframe Alignment Strategy**
   - Which timeframes to check (1m, 5m, 15m, 1h, 4h?)
   - Alignment threshold (all agree vs majority)
   - How to weight different timeframes

3. **Volume Confirmation Logic**
   - Optimal volume threshold (1.2x, 1.5x, 2x average?)
   - Volume lookback period
   - How to handle low-volume periods

4. **Implementation Architecture**
   - Should we modify TieredDecisionMaking or create new service?
   - How to integrate with existing consensus calculation
   - Error handling and fallback logic

5. **Expected Impact**
   - Estimated win rate improvement
   - Trade frequency impact
   - Risk reduction

Please provide specific code examples where helpful."""
        }
    ]
)

response_text = message.content[0].text

print("\n" + response_text)

# Save response to file
with open("/home/ubuntu/seer/CLAUDE_WEEK5_ENTRY_SYSTEM_RECOMMENDATIONS.md", "w") as f:
    f.write("# Claude AI Recommendations: Week 5-6 Entry System Improvements\n\n")
    f.write(response_text)

print("\n" + "=" * 80)
print("Response saved to CLAUDE_WEEK5_ENTRY_SYSTEM_RECOMMENDATIONS.md")
print("=" * 80)
