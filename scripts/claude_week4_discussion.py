#!/usr/bin/env python3
"""
Discuss Week 4 agent fixes with Claude AI via Anthropic API
Covers: MLPredictionAgent, WhaleTracker, OnChainFlowAnalyst
"""

import os
import anthropic

client = anthropic.Anthropic(api_key=os.environ.get("ANTHROPIC_API_KEY"))

# Comprehensive context for Week 4 fixes
context = """
## SEER Trading Platform - Week 4 Agent Fixes Discussion

### Background
We are fixing broken agents in a crypto trading platform. So far we've fixed:
- Week 1-2: SentimentAnalyst (Z-score model), TechnicalAnalyst (SuperTrend 2.5, trend confirmation)
- Week 2: NewsSentinel (balanced keywords), MacroAnalyst (regime thresholds)
- Week 3: FundingRateAnalyst & LiquidationHeatmap (multi-exchange fallback via Bybit/OKX)

### Week 4 Remaining Agents (All outputting 100% neutral signals)

#### 1. MLPredictionAgent Issues
- Requires 60 candles of OHLCV data (rarely available)
- Falls back to basic price trend analysis that's too conservative
- Only generates signal if priceChange > 1% (too high threshold)
- EnsemblePredictor (LSTM + Transformer) rarely runs due to data requirements

#### 2. WhaleTracker Issues (Already partially fixed with MultiSourceWhaleService)
- Whale Alert API returns empty transactions
- Fallback requires volume spikes >130% AND price changes >1%
- Created MultiSourceWhaleService but need to verify integration

#### 3. OnChainFlowAnalyst Issues (Already partially fixed with MultiSourceOnChainService)
- Was using simulated data (generateRealisticFlowData)
- Created MultiSourceOnChainService but need to verify integration

### Questions for Claude AI

1. **MLPredictionAgent**: What's the best approach?
   - Lower REQUIRED_CANDLES from 60 to 30?
   - Improve fallback with multi-factor momentum analysis?
   - Replace ML entirely with simpler momentum system?
   - What specific thresholds and logic would you recommend?

2. **WhaleTracker & OnChainFlowAnalyst**: 
   - Are the multi-source services we created sufficient?
   - Any additional improvements needed?
   - What signal distribution should we target?

3. **Overall Week 4 Strategy**:
   - Should we prioritize any agent over others?
   - What's the expected impact on overall system performance?
   - Any risks we should be aware of?

### Constraints
- Paper trading mode (no real money at risk)
- Research phase - can experiment freely
- Must maintain system stability
- Each fix should be measurable
"""

message = client.messages.create(
    model="claude-sonnet-4-20250514",
    max_tokens=4096,
    messages=[
        {
            "role": "user",
            "content": f"""You are a CTO-level trading system architect. We're collaborating on fixing broken agents in the SEER trading platform.

{context}

Please provide:

1. **MLPredictionAgent Fix Recommendation**
   - Recommended approach with specific implementation details
   - Exact thresholds and logic changes
   - Code snippets if helpful
   - Expected signal distribution after fix

2. **WhaleTracker & OnChainFlowAnalyst Verification**
   - Are the multi-source services sufficient?
   - Any additional improvements needed?

3. **Implementation Priority**
   - Which agent should we fix first?
   - Expected impact on overall win rate

4. **Risk Assessment**
   - Any potential issues with these fixes?
   - How to validate the fixes are working?

Be specific and actionable - we're implementing immediately based on your recommendations."""
        }
    ]
)

response = message.content[0].text

# Save response
with open("/home/ubuntu/seer/CLAUDE_WEEK4_RECOMMENDATIONS.md", "w") as f:
    f.write("# Claude AI Recommendations: Week 4 Agent Fixes\n\n")
    f.write(f"**Generated:** {os.popen('date').read().strip()}\n\n")
    f.write("---\n\n")
    f.write(response)

print("Claude AI response saved to CLAUDE_WEEK4_RECOMMENDATIONS.md")
print("\n" + "="*80)
print("CLAUDE AI WEEK 4 RECOMMENDATIONS:")
print("="*80 + "\n")
print(response)
