#!/usr/bin/env python3
"""
Discuss MLPredictionAgent fix with Claude AI via Anthropic API
"""

import os
import anthropic

client = anthropic.Anthropic(api_key=os.environ.get("ANTHROPIC_API_KEY"))

# Current MLPredictionAgent issues
current_issues = """
## MLPredictionAgent Current Issues

1. **Requires 60 candles** - Often not available in context, causing fallback to neutral
2. **Fallback logic too conservative** - Basic price trend analysis tends toward neutral
3. **100% neutral signal output** - Agent is effectively non-functional

## Current Code Analysis
- REQUIRED_CANDLES = 60 (too high)
- Fallback only checks 5 candles for basic trend
- Only generates bullish/bearish if priceChange > 1% or < -1%
- No momentum acceleration analysis
- No volume-price correlation

## Proposed Fixes
1. Lower REQUIRED_CANDLES from 60 to 30
2. Enhance fallback with multi-factor momentum analysis:
   - Short-term candle trend
   - 24h price change
   - Price position in range
   - Volume-price correlation
   - Momentum acceleration detection
3. Lower signal thresholds for more directional outputs

## Question for Claude AI
What is the best approach to fix the MLPredictionAgent to generate more directional signals while maintaining prediction quality? Should we:
A) Focus on improving the fallback logic (since ML models rarely have enough data)
B) Lower the data requirements so ML models can run more often
C) Replace the ML approach entirely with a simpler momentum-based system
D) Combination approach - what specific implementation would you recommend?
"""

message = client.messages.create(
    model="claude-sonnet-4-20250514",
    max_tokens=4096,
    messages=[
        {
            "role": "user",
            "content": f"""You are a CTO-level trading system architect helping fix a broken ML prediction agent.

{current_issues}

Please provide:
1. Your recommended approach (A, B, C, or D with specifics)
2. Specific code changes or implementation details
3. Expected signal distribution after the fix (% bullish, % bearish, % neutral)
4. Any risks or considerations

Be specific and actionable - we're implementing this fix immediately."""
        }
    ]
)

response = message.content[0].text

# Save response
with open("/home/ubuntu/seer/CLAUDE_ML_AGENT_FIX_RECOMMENDATION.md", "w") as f:
    f.write("# Claude AI Recommendation: MLPredictionAgent Fix\n\n")
    f.write(f"**Generated:** {os.popen('date').read().strip()}\n\n")
    f.write("---\n\n")
    f.write(response)

print("Claude AI response saved to CLAUDE_ML_AGENT_FIX_RECOMMENDATION.md")
print("\n" + "="*60)
print("CLAUDE AI RECOMMENDATION:")
print("="*60 + "\n")
print(response)
