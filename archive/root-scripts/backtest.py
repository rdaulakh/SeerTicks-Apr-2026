import mysql.connector
import json
import os
from collections import defaultdict

DATABASE_URL = os.environ.get('DATABASE_URL', '')

def parse_db_url(url):
    url = url.replace('mysql://', '')
    user_pass, rest = url.split('@')
    user, password = user_pass.split(':')
    host_port, database = rest.split('/')
    host, port = host_port.split(':') if ':' in host_port else (host_port, 3306)
    return {'user': user, 'password': password, 'host': host, 'port': int(port), 'database': database.split('?')[0]}

def get_connection():
    config = parse_db_url(DATABASE_URL)
    return mysql.connector.connect(host=config['host'], port=config['port'], user=config['user'], 
                                   password=config['password'], database=config['database'], ssl_disabled=False)

def run_backtest():
    conn = get_connection()
    cursor = conn.cursor(dictionary=True)
    
    print("=" * 80)
    print("SEER TRADING PLATFORM - BACKTEST ANALYSIS")
    print("=" * 80)
    
    # Agent stats
    cursor.execute("""SELECT agentName, COUNT(*) as total, AVG(CAST(confidence AS DECIMAL(10,4))) as avg_conf,
                      AVG(executionScore) as avg_exec FROM agentSignals GROUP BY agentName ORDER BY total DESC""")
    agent_stats = cursor.fetchall()
    
    print("\n1. AGENT PERFORMANCE")
    print("-" * 60)
    print(f"{'Agent':<25} {'Signals':>10} {'Avg Conf':>12} {'Exec Score':>12}")
    for a in agent_stats:
        print(f"{a['agentName']:<25} {a['total']:>10,} {float(a['avg_conf'] or 0):>11.2f}% {float(a['avg_exec'] or 0):>11.1f}")
    
    # Price data
    cursor.execute("""SELECT symbol, `interval`, COUNT(*) as cnt, MIN(timestamp) as s, MAX(timestamp) as e,
                      MIN(CAST(low AS DECIMAL(20,2))) as min_p, MAX(CAST(high AS DECIMAL(20,2))) as max_p
                      FROM historicalCandles GROUP BY symbol, `interval`""")
    price_stats = cursor.fetchall()
    
    print("\n2. PRICE DATA")
    print("-" * 60)
    for p in price_stats:
        print(f"  {p['symbol']} ({p['interval']}): {p['cnt']:,} candles")
        print(f"    {p['s']} to {p['e']}")
        print(f"    ${float(p['min_p']):,.2f} - ${float(p['max_p']):,.2f}")
    
    # Wallet
    cursor.execute("SELECT * FROM paperWallets LIMIT 1")
    wallet = cursor.fetchone()
    
    print("\n3. PAPER WALLET")
    print("-" * 60)
    if wallet:
        print(f"  Balance: ${float(wallet['balance']):,.2f}")
        print(f"  Equity: ${float(wallet['equity']):,.2f}")
        print(f"  Total P&L: ${float(wallet['totalPnL']):,.2f}")
        print(f"  Realized: ${float(wallet['realizedPnL']):,.2f}")
        print(f"  Unrealized: ${float(wallet['unrealizedPnL']):,.2f}")
        print(f"  Trades: {wallet['totalTrades']} (W:{wallet['winningTrades']} L:{wallet['losingTrades']})")
        print(f"  Win Rate: {float(wallet['winRate']):.2f}%")
    
    # Positions
    cursor.execute("SELECT * FROM paperPositions ORDER BY entryTime DESC")
    positions = cursor.fetchall()
    
    print("\n4. PAPER POSITIONS")
    print("-" * 60)
    for pos in positions:
        icon = "🟢" if pos['status'] == 'open' else "🔴"
        print(f"  {icon} #{pos['id']} {pos['symbol']} {pos['side'].upper()}")
        print(f"    Entry: ${float(pos['entryPrice']):,.2f} | Current: ${float(pos['currentPrice']):,.2f}")
        print(f"    P&L: ${float(pos['unrealizedPnL']):,.2f} ({float(pos['unrealizedPnLPercent']):.2f}%)")
        if pos['status'] == 'closed':
            print(f"    Exit: {pos['exitReason']} | Realized: ${float(pos['realizedPnl'] or 0):,.2f}")
    
    # Live positions
    cursor.execute("SELECT * FROM positions ORDER BY createdAt DESC LIMIT 5")
    live = cursor.fetchall()
    
    print("\n5. LIVE POSITIONS")
    print("-" * 60)
    for p in live:
        print(f"  #{p['id']} {p['symbol']} {p['side'].upper()} @ ${float(p['entryPrice']):,.2f}")
        print(f"    Current: ${float(p['currentPrice'] or 0):,.2f} | P&L: ${float(p['unrealizedPnl'] or 0):,.2f}")
    
    # Patterns
    cursor.execute("""SELECT patternName, symbol, timeframe, totalTrades, winRate, avgPnl 
                      FROM winningPatterns WHERE isActive=1 AND totalTrades>0 ORDER BY totalTrades DESC LIMIT 10""")
    patterns = cursor.fetchall()
    
    print("\n6. WINNING PATTERNS")
    print("-" * 70)
    print(f"{'Pattern':<25} {'Symbol':<10} {'TF':<5} {'Trades':>8} {'Win%':>8} {'Avg P&L':>10}")
    for p in patterns:
        print(f"{p['patternName']:<25} {p['symbol']:<10} {p['timeframe']:<5} {p['totalTrades']:>8} "
              f"{float(p['winRate'] or 0)*100:>7.1f}% ${float(p['avgPnl'] or 0):>9.2f}")
    
    cursor.close()
    conn.close()
    
    # Save summary
    summary = {
        'agents': [{'name': a['agentName'], 'signals': a['total'], 'confidence': float(a['avg_conf'] or 0)} for a in agent_stats],
        'wallet': {'balance': float(wallet['balance']), 'equity': float(wallet['equity']), 
                   'pnl': float(wallet['totalPnL']), 'trades': wallet['totalTrades'], 
                   'win_rate': float(wallet['winRate'])} if wallet else {},
        'positions': [{'id': p['id'], 'symbol': p['symbol'], 'side': p['side'], 
                       'entry': float(p['entryPrice']), 'pnl': float(p['unrealizedPnL']), 
                       'status': p['status']} for p in positions],
        'patterns': [{'name': p['patternName'], 'trades': p['totalTrades'], 
                      'win_rate': float(p['winRate'] or 0)*100} for p in patterns]
    }
    
    with open('/home/ubuntu/seer/backtest_results.json', 'w') as f:
        json.dump(summary, f, indent=2)
    
    print("\n✅ Results saved to backtest_results.json")

if __name__ == '__main__':
    run_backtest()
