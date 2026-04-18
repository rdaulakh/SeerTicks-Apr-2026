#!/usr/bin/env python3
"""
Generate backtest visualization charts
"""

import json
import matplotlib.pyplot as plt
import matplotlib.dates as mdates
from datetime import datetime
import numpy as np

# Load backtest results
with open('/home/ubuntu/seer/backtest_results/backtest_BTC-USD_2026-01-01T13-33-38-785Z.json', 'r') as f:
    data = json.load(f)

metrics = data['metrics']
config = data['config']

# Set style
plt.style.use('seaborn-v0_8-darkgrid')
fig = plt.figure(figsize=(16, 20))

# 1. Monthly P&L Bar Chart
ax1 = fig.add_subplot(4, 2, 1)
months = list(metrics['monthlyPnL'].keys())
pnl_values = list(metrics['monthlyPnL'].values())
colors = ['#e74c3c' if v < 0 else '#2ecc71' for v in pnl_values]
bars = ax1.bar(months, pnl_values, color=colors, edgecolor='white', linewidth=0.5)
ax1.axhline(y=0, color='white', linestyle='-', linewidth=0.5)
ax1.set_xlabel('Month', fontsize=10)
ax1.set_ylabel('P&L ($)', fontsize=10)
ax1.set_title('Monthly P&L', fontsize=12, fontweight='bold')
ax1.tick_params(axis='x', rotation=45)
for bar, val in zip(bars, pnl_values):
    ax1.text(bar.get_x() + bar.get_width()/2, bar.get_height() + 10, 
             f'${val:.0f}', ha='center', va='bottom', fontsize=8)

# 2. Cumulative P&L (Equity Curve)
ax2 = fig.add_subplot(4, 2, 2)
cumulative = [config['initialCapital']]
for pnl in pnl_values:
    cumulative.append(cumulative[-1] + pnl)
ax2.plot(range(len(cumulative)), cumulative, color='#3498db', linewidth=2)
ax2.fill_between(range(len(cumulative)), config['initialCapital'], cumulative, 
                  where=[c < config['initialCapital'] for c in cumulative], 
                  color='#e74c3c', alpha=0.3, label='Drawdown')
ax2.axhline(y=config['initialCapital'], color='white', linestyle='--', linewidth=1, alpha=0.5)
ax2.set_xlabel('Month', fontsize=10)
ax2.set_ylabel('Equity ($)', fontsize=10)
ax2.set_title('Equity Curve', fontsize=12, fontweight='bold')
ax2.set_xticks(range(len(cumulative)))
ax2.set_xticklabels(['Start'] + months, rotation=45)
ax2.legend()

# 3. Position Tier Performance
ax3 = fig.add_subplot(4, 2, 3)
tiers = ['SCOUT', 'MODERATE', 'STANDARD', 'STRONG', 'HIGH']
tier_trades = [metrics['tierBreakdown'][t]['trades'] for t in tiers]
tier_pnl = [metrics['tierBreakdown'][t]['totalPnL'] for t in tiers]
tier_winrate = [metrics['tierBreakdown'][t]['winRate'] * 100 for t in tiers]

x = np.arange(len(tiers))
width = 0.35
bars1 = ax3.bar(x - width/2, tier_trades, width, label='Trades', color='#3498db')
ax3_twin = ax3.twinx()
bars2 = ax3_twin.bar(x + width/2, tier_winrate, width, label='Win Rate %', color='#2ecc71')
ax3.set_xlabel('Position Tier', fontsize=10)
ax3.set_ylabel('Number of Trades', fontsize=10, color='#3498db')
ax3_twin.set_ylabel('Win Rate (%)', fontsize=10, color='#2ecc71')
ax3.set_title('Position Tier Analysis', fontsize=12, fontweight='bold')
ax3.set_xticks(x)
ax3.set_xticklabels(tiers)
ax3.legend(loc='upper left')
ax3_twin.legend(loc='upper right')

# 4. Regime Performance
ax4 = fig.add_subplot(4, 2, 4)
regimes = ['trending_up', 'trending_down', 'ranging']
regime_trades = [metrics['regimeBreakdown'][r]['trades'] for r in regimes]
regime_winrate = [metrics['regimeBreakdown'][r]['winRate'] * 100 for r in regimes]
regime_pnl = [metrics['regimeBreakdown'][r]['totalPnL'] for r in regimes]

colors = ['#2ecc71', '#e74c3c', '#f39c12']
ax4.pie(regime_trades, labels=[f'{r}\n{t} trades\n{w:.1f}% win' 
                                for r, t, w in zip(regimes, regime_trades, regime_winrate)],
        colors=colors, autopct='%1.1f%%', startangle=90)
ax4.set_title('Trades by Market Regime', fontsize=12, fontweight='bold')

# 5. Agent Contribution
ax5 = fig.add_subplot(4, 2, 5)
agents = list(metrics['agentContribution'].keys())
agent_helped = [metrics['agentContribution'][a]['helpedTrades'] for a in agents]
agent_modes = [metrics['agentContribution'][a]['mode'] for a in agents]
colors = ['#3498db' if m == 'ACTIVE' else '#95a5a6' for m in agent_modes]

y_pos = np.arange(len(agents))
ax5.barh(y_pos, agent_helped, color=colors)
ax5.set_yticks(y_pos)
ax5.set_yticklabels([f'{a} ({m})' for a, m in zip(agents, agent_modes)], fontsize=8)
ax5.set_xlabel('Trades Helped', fontsize=10)
ax5.set_title('Agent Contribution (Trades Helped)', fontsize=12, fontweight='bold')
ax5.invert_yaxis()

# 6. Win/Loss Distribution
ax6 = fig.add_subplot(4, 2, 6)
labels = ['Winning Trades', 'Losing Trades']
sizes = [metrics['winningTrades'], metrics['losingTrades']]
colors = ['#2ecc71', '#e74c3c']
explode = (0.05, 0)
ax6.pie(sizes, explode=explode, labels=labels, colors=colors, autopct='%1.1f%%',
        shadow=True, startangle=90)
ax6.set_title(f'Win/Loss Distribution (Win Rate: {metrics["winRate"]*100:.1f}%)', 
              fontsize=12, fontweight='bold')

# 7. Key Metrics Summary
ax7 = fig.add_subplot(4, 2, 7)
ax7.axis('off')
metrics_text = f"""
BACKTEST SUMMARY
================

Performance Metrics:
  • Total Trades: {metrics['totalTrades']:,}
  • Win Rate: {metrics['winRate']*100:.1f}%
  • Net P&L: ${metrics['totalPnL']:,.2f} ({metrics['totalPnLPercent']*100:.2f}%)
  • Profit Factor: {metrics['profitFactor']:.2f}

Risk Metrics:
  • Max Drawdown: {metrics['maxDrawdownPercent']:.2f}%
  • Sharpe Ratio: {metrics['sharpeRatio']:.2f}
  • Sortino Ratio: {metrics['sortinoRatio']:.2f}
  • Calmar Ratio: {metrics['calmarRatio']:.2f}

Trade Statistics:
  • Avg Win: ${metrics['avgWin']:.2f} ({metrics['avgWinPercent']:.2f}%)
  • Avg Loss: ${metrics['avgLoss']:.2f} ({metrics['avgLossPercent']:.2f}%)
  • Largest Win: ${metrics['largestWin']:.2f}
  • Largest Loss: ${metrics['largestLoss']:.2f}
  • Avg Holding: {metrics['avgHoldingPeriodHours']:.1f} hours
"""
ax7.text(0.1, 0.9, metrics_text, transform=ax7.transAxes, fontsize=10,
         verticalalignment='top', fontfamily='monospace',
         bbox=dict(boxstyle='round', facecolor='#2c3e50', alpha=0.8),
         color='white')

# 8. Verdict
ax8 = fig.add_subplot(4, 2, 8)
ax8.axis('off')
verdict_text = f"""
VERDICT: FAILED
===============

Reason: Low win rate (11.6%); Negative profit factor (0.09);
        Negative Sharpe (-5.04); High drawdown (25.0% max DD);
        Negative returns (-25.2%)

Root Causes:
  1. Only 3 of 12 agents fully operational (25%)
  2. Stop-losses too tight (88.4% hit SL)
  3. Shadow agents inflating scores without edge
  4. No effective filtering of low-quality signals

Recommendations:
  1. Increase consensus threshold to 85%
  2. Widen stop-losses (2.5-4.0x ATR)
  3. Implement trend alignment filter
  4. Run with all agents active for valid test
"""
ax8.text(0.1, 0.9, verdict_text, transform=ax8.transAxes, fontsize=10,
         verticalalignment='top', fontfamily='monospace',
         bbox=dict(boxstyle='round', facecolor='#c0392b', alpha=0.8),
         color='white')

plt.suptitle('SEER Trading Platform - 1-Year Backtest Results\n'
             'BTC-USD | Jan 2025 - Oct 2025 | $10,000 Initial Capital',
             fontsize=14, fontweight='bold', y=1.02)

plt.tight_layout()
plt.savefig('/home/ubuntu/seer/backtest_results/backtest_visualization.png', 
            dpi=150, bbox_inches='tight', facecolor='#1a1a2e')
print('Chart saved to /home/ubuntu/seer/backtest_results/backtest_visualization.png')
