#!/usr/bin/env python3
"""
SEER Deep System Audit - Data Collection Script
Executes all 30+ SQL queries from the audit prompt and saves results to JSON files.
"""
import json
import os
import sys
import subprocess
from datetime import datetime

# Output directory
OUTPUT_DIR = "/home/ubuntu/seer_audit_feb6_2026"
os.makedirs(OUTPUT_DIR, exist_ok=True)

# All queries organized by section
QUERIES = {
    # SECTION 1: System Health & Uptime
    "1.1_heartbeat": """
        SELECT 
            DATE(CONVERT_TZ(timestamp, '+00:00', '+05:30')) as date_ist,
            HOUR(CONVERT_TZ(timestamp, '+00:00', '+05:30')) as hour_ist,
            COUNT(*) as heartbeat_count,
            MIN(CONVERT_TZ(timestamp, '+00:00', '+05:30')) as first_heartbeat,
            MAX(CONVERT_TZ(timestamp, '+00:00', '+05:30')) as last_heartbeat,
            ROUND(AVG(cpuPercent), 2) as avg_cpu_percent,
            ROUND(AVG(memoryMb), 0) as avg_memory_mb,
            AVG(ticksProcessedLastMinute) as avg_ticks_per_min,
            AVG(positionsCheckedLastMinute) as avg_positions_checked,
            SUM(errorCount) as total_errors,
            SUM(restartCount) as total_restarts
        FROM systemHeartbeat
        WHERE timestamp >= CONVERT_TZ('2026-02-06 10:00:00', '+05:30', '+00:00')
        GROUP BY DATE(CONVERT_TZ(timestamp, '+00:00', '+05:30')), 
                 HOUR(CONVERT_TZ(timestamp, '+00:00', '+05:30'))
        ORDER BY date_ist DESC, hour_ist DESC
    """,
    "1.2_service_events": """
        SELECT 
            serviceName,
            eventType,
            COUNT(*) as event_count,
            MIN(CONVERT_TZ(timestamp, '+00:00', '+05:30')) as first_occurrence_ist,
            MAX(CONVERT_TZ(timestamp, '+00:00', '+05:30')) as last_occurrence_ist,
            GROUP_CONCAT(DISTINCT reason SEPARATOR '; ') as reasons,
            GROUP_CONCAT(DISTINCT LEFT(errorMessage, 100) SEPARATOR '; ') as error_samples
        FROM serviceEvents
        WHERE timestamp >= CONVERT_TZ('2026-02-06 10:00:00', '+05:30', '+00:00')
        GROUP BY serviceName, eventType
        ORDER BY serviceName, eventType
    """,
    "1.3_downtime_detection": """
        WITH heartbeat_times AS (
            SELECT 
                CONVERT_TZ(timestamp, '+00:00', '+05:30') as timestamp_ist,
                LAG(CONVERT_TZ(timestamp, '+00:00', '+05:30')) OVER (ORDER BY timestamp) as prev_timestamp_ist
            FROM systemHeartbeat
            WHERE timestamp >= CONVERT_TZ('2026-02-06 10:00:00', '+05:30', '+00:00')
        )
        SELECT 
            prev_timestamp_ist as downtime_start,
            timestamp_ist as downtime_end,
            TIMESTAMPDIFF(MINUTE, prev_timestamp_ist, timestamp_ist) as downtime_minutes
        FROM heartbeat_times
        WHERE TIMESTAMPDIFF(MINUTE, prev_timestamp_ist, timestamp_ist) > 5
        ORDER BY downtime_minutes DESC
        LIMIT 50
    """,

    # SECTION 2: Connection Health
    "2.1_api_connections": """
        SELECT 
            apiName,
            connectionStatus,
            COUNT(*) as total_attempts,
            MIN(CONVERT_TZ(timestamp, '+00:00', '+05:30')) as first_attempt_ist,
            MAX(CONVERT_TZ(timestamp, '+00:00', '+05:30')) as last_attempt_ist,
            ROUND(AVG(responseTimeMs), 0) as avg_response_ms,
            MAX(responseTimeMs) as max_response_ms,
            GROUP_CONCAT(DISTINCT failureReason SEPARATOR '; ') as failure_reasons,
            AVG(retryCount) as avg_retry_count
        FROM apiConnectionLog
        WHERE timestamp >= CONVERT_TZ('2026-02-06 10:00:00', '+05:30', '+00:00')
        GROUP BY apiName, connectionStatus
        ORDER BY apiName, connectionStatus
    """,
    "2.2_coinapi_status": """
        SELECT 
            'CoinAPI WebSocket Errors' as metric,
            COUNT(*) as count,
            GROUP_CONCAT(DISTINCT connectionStatus) as statuses,
            GROUP_CONCAT(DISTINCT failureReason SEPARATOR '; ') as failure_reasons
        FROM apiConnectionLog
        WHERE apiName LIKE '%coinapi%'
            AND timestamp >= CONVERT_TZ('2026-02-06 10:00:00', '+05:30', '+00:00')
        UNION ALL
        SELECT 
            'CoinAPI WebSocket Reconnection Attempts' as metric,
            COUNT(*) as count,
            NULL as statuses,
            NULL as failure_reasons
        FROM websocketHealthLog
        WHERE websocketName LIKE '%coinapi%'
            AND timestamp >= CONVERT_TZ('2026-02-06 10:00:00', '+05:30', '+00:00')
    """,
    "2.3_websocket_health": """
        SELECT 
            websocketName,
            connectionStatus,
            COUNT(*) as status_count,
            MIN(CONVERT_TZ(timestamp, '+00:00', '+05:30')) as first_seen_ist,
            MAX(CONVERT_TZ(timestamp, '+00:00', '+05:30')) as last_seen_ist,
            AVG(messagesReceivedLastMinute) as avg_messages_per_min,
            AVG(pingMs) as avg_ping_ms,
            AVG(avgLatencyMs) as avg_latency_ms,
            SUM(reconnectCount) as total_reconnects
        FROM websocketHealthLog
        WHERE timestamp >= CONVERT_TZ('2026-02-06 10:00:00', '+05:30', '+00:00')
        GROUP BY websocketName, connectionStatus
        ORDER BY websocketName, connectionStatus
    """,

    # SECTION 3: Exit System Performance
    "3.1_exit_distribution": """
        SELECT 
            exitReason,
            COUNT(*) as total_exits,
            ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER(), 2) as percentage,
            SUM(CASE WHEN realizedPnL > 0 THEN 1 ELSE 0 END) as winning_exits,
            SUM(CASE WHEN realizedPnL < 0 THEN 1 ELSE 0 END) as losing_exits,
            ROUND(SUM(CASE WHEN realizedPnL > 0 THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 2) as win_rate_pct,
            ROUND(AVG(realizedPnL), 4) as avg_pnl,
            ROUND(AVG(CASE WHEN realizedPnL > 0 THEN realizedPnL END), 4) as avg_win,
            ROUND(AVG(CASE WHEN realizedPnL < 0 THEN realizedPnL END), 4) as avg_loss,
            ROUND(AVG(TIMESTAMPDIFF(MINUTE, openedAt, closedAt)), 1) as avg_hold_minutes
        FROM paperPositions
        WHERE status = 'closed'
            AND closedAt >= CONVERT_TZ('2026-02-06 10:00:00', '+05:30', '+00:00')
        GROUP BY exitReason
        ORDER BY total_exits DESC
    """,
    "3.2_exit_decisions": """
        SELECT 
            triggeredExit,
            priority,
            COUNT(*) as decision_count,
            ROUND(AVG(confidenceAtExit), 4) as avg_confidence_at_exit,
            ROUND(AVG(pnlAtExit), 4) as avg_pnl_at_exit,
            ROUND(AVG(holdTimeMinutes), 1) as avg_hold_time,
            MIN(CONVERT_TZ(timestamp, '+00:00', '+05:30')) as first_decision_ist,
            MAX(CONVERT_TZ(timestamp, '+00:00', '+05:30')) as last_decision_ist
        FROM exitDecisionLog
        WHERE timestamp >= CONVERT_TZ('2026-02-06 10:00:00', '+05:30', '+00:00')
        GROUP BY triggeredExit, priority
        ORDER BY decision_count DESC
    """,
    "3.3_profit_targets": """
        SELECT 
            exitReason,
            COUNT(*) as count,
            ROUND(AVG(realizedPnL), 4) as avg_pnl,
            ROUND(SUM(realizedPnL), 4) as total_pnl,
            ROUND(AVG(TIMESTAMPDIFF(MINUTE, openedAt, closedAt)), 1) as avg_hold_minutes
        FROM paperPositions
        WHERE status = 'closed'
            AND exitReason LIKE '%profit_target%'
            AND closedAt >= CONVERT_TZ('2026-02-06 10:00:00', '+05:30', '+00:00')
        GROUP BY exitReason
        ORDER BY count DESC
    """,

    # SECTION 4: Trading Performance
    "4.1_overall_metrics": """
        SELECT 
            COUNT(*) as total_trades,
            SUM(CASE WHEN realizedPnL > 0 THEN 1 ELSE 0 END) as winning_trades,
            SUM(CASE WHEN realizedPnL < 0 THEN 1 ELSE 0 END) as losing_trades,
            SUM(CASE WHEN realizedPnL = 0 THEN 1 ELSE 0 END) as breakeven_trades,
            ROUND(SUM(CASE WHEN realizedPnL > 0 THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 2) as win_rate_pct,
            ROUND(SUM(realizedPnL), 4) as total_pnl,
            ROUND(AVG(realizedPnL), 4) as avg_pnl_per_trade,
            ROUND(AVG(CASE WHEN realizedPnL > 0 THEN realizedPnL END), 4) as avg_win,
            ROUND(AVG(CASE WHEN realizedPnL < 0 THEN realizedPnL END), 4) as avg_loss,
            ROUND(AVG(CASE WHEN realizedPnL > 0 THEN realizedPnL END) / ABS(AVG(CASE WHEN realizedPnL < 0 THEN realizedPnL END)), 2) as profit_factor,
            ROUND(MAX(realizedPnL), 4) as best_trade,
            ROUND(MIN(realizedPnL), 4) as worst_trade,
            ROUND(AVG(TIMESTAMPDIFF(MINUTE, openedAt, closedAt)), 1) as avg_hold_minutes,
            ROUND(SUM(realizedPnL) / 20000 * 100, 2) as return_on_capital_pct
        FROM paperPositions
        WHERE status = 'closed'
            AND closedAt >= CONVERT_TZ('2026-02-06 10:00:00', '+05:30', '+00:00')
    """,
    "4.2_hourly_trend": """
        SELECT 
            HOUR(CONVERT_TZ(closedAt, '+00:00', '+05:30')) as hour_ist,
            COUNT(*) as trades,
            SUM(CASE WHEN realizedPnL > 0 THEN 1 ELSE 0 END) as wins,
            ROUND(SUM(CASE WHEN realizedPnL > 0 THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 2) as win_rate,
            ROUND(SUM(realizedPnL), 4) as hourly_pnl,
            ROUND(AVG(realizedPnL), 4) as avg_pnl
        FROM paperPositions
        WHERE status = 'closed'
            AND closedAt >= CONVERT_TZ('2026-02-06 10:00:00', '+05:30', '+00:00')
        GROUP BY HOUR(CONVERT_TZ(closedAt, '+00:00', '+05:30'))
        ORDER BY hour_ist
    """,
    "4.3_hold_times": """
        SELECT 
            symbol,
            side,
            COUNT(*) as trade_count,
            ROUND(AVG(TIMESTAMPDIFF(MINUTE, openedAt, closedAt)), 1) as avg_hold_min,
            ROUND(MIN(TIMESTAMPDIFF(MINUTE, openedAt, closedAt)), 1) as min_hold_min,
            ROUND(MAX(TIMESTAMPDIFF(MINUTE, openedAt, closedAt)), 1) as max_hold_min,
            ROUND(AVG(realizedPnL), 4) as avg_pnl,
            ROUND(SUM(realizedPnL), 4) as total_pnl
        FROM paperPositions
        WHERE status = 'closed'
            AND closedAt >= CONVERT_TZ('2026-02-06 10:00:00', '+05:30', '+00:00')
        GROUP BY symbol, side
        ORDER BY trade_count DESC
    """,

    # SECTION 5: Capital Utilization
    "5.1_utilization": """
        SELECT 
            HOUR(CONVERT_TZ(timestamp, '+00:00', '+05:30')) as hour_ist,
            ROUND(AVG(utilizationPercent), 2) as avg_utilization_pct,
            ROUND(AVG(totalCapital), 2) as avg_total_capital,
            ROUND(AVG(allocatedCapital), 2) as avg_allocated,
            ROUND(AVG(availableCapital), 2) as avg_available,
            ROUND(AVG(openPositionCount), 1) as avg_open_positions,
            MAX(openPositionCount) as max_open_positions
        FROM capitalUtilization
        WHERE timestamp >= CONVERT_TZ('2026-02-06 10:00:00', '+05:30', '+00:00')
        GROUP BY HOUR(CONVERT_TZ(timestamp, '+00:00', '+05:30'))
        ORDER BY hour_ist
    """,
    "5.2_position_sizing": """
        SELECT 
            COUNT(*) as total_positions,
            ROUND(AVG(requestedSizeUsd), 2) as avg_requested_size,
            ROUND(AVG(finalSizeUsd), 2) as avg_final_size,
            ROUND(AVG(sizeReductionPct), 2) as avg_size_reduction_pct,
            ROUND(AVG(capitalUsedPct), 2) as avg_capital_used_pct,
            GROUP_CONCAT(DISTINCT constraintsApplied SEPARATOR '; ') as constraints_used,
            MIN(CONVERT_TZ(timestamp, '+00:00', '+05:30')) as first_sizing_ist,
            MAX(CONVERT_TZ(timestamp, '+00:00', '+05:30')) as last_sizing_ist
        FROM positionSizingLog
        WHERE timestamp >= CONVERT_TZ('2026-02-06 10:00:00', '+05:30', '+00:00')
    """,
    "5.3_size_distribution": """
        SELECT 
            symbol,
            COUNT(*) as position_count,
            ROUND(AVG(size * entryPrice), 2) as avg_capital_per_position,
            ROUND(MIN(size * entryPrice), 2) as min_capital,
            ROUND(MAX(size * entryPrice), 2) as max_capital,
            ROUND(AVG(size * entryPrice) / 20000 * 100, 2) as avg_pct_of_capital
        FROM paperPositions
        WHERE openedAt >= CONVERT_TZ('2026-02-06 10:00:00', '+05:30', '+00:00')
        GROUP BY symbol
        ORDER BY position_count DESC
    """,

    # SECTION 6: Agent Performance
    "6.1_agent_signals": """
        SELECT 
            agentName,
            COUNT(*) as total_signals,
            SUM(CASE WHEN signal = 'bullish' THEN 1 ELSE 0 END) as bullish,
            SUM(CASE WHEN signal = 'bearish' THEN 1 ELSE 0 END) as bearish,
            SUM(CASE WHEN signal = 'neutral' THEN 1 ELSE 0 END) as neutral,
            ROUND(SUM(CASE WHEN signal = 'bullish' THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 2) as bullish_pct,
            ROUND(SUM(CASE WHEN signal = 'bearish' THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 2) as bearish_pct,
            ROUND(SUM(CASE WHEN signal = 'neutral' THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 2) as neutral_pct,
            ROUND(AVG(confidence), 4) as avg_confidence,
            MIN(CONVERT_TZ(timestamp, '+00:00', '+05:30')) as first_signal_ist,
            MAX(CONVERT_TZ(timestamp, '+00:00', '+05:30')) as last_signal_ist
        FROM agentSignals
        WHERE timestamp >= CONVERT_TZ('2026-02-06 10:00:00', '+05:30', '+00:00')
        GROUP BY agentName
        ORDER BY total_signals DESC
    """,
    "6.2_entry_validation": """
        SELECT 
            outcome,
            COUNT(*) as decision_count,
            ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER(), 2) as percentage,
            ROUND(AVG(consensusScore), 4) as avg_consensus,
            ROUND(AVG(confidence), 4) as avg_confidence,
            GROUP_CONCAT(DISTINCT rejectionReason SEPARATOR '; ') as rejection_reasons
        FROM entryValidationLog
        WHERE timestamp >= CONVERT_TZ('2026-02-06 10:00:00', '+05:30', '+00:00')
        GROUP BY outcome
        ORDER BY decision_count DESC
    """,

    # SECTION 7: Alerts
    "7.1_critical_alerts": """
        SELECT 
            alertType,
            severity,
            COUNT(*) as alert_count,
            COUNT(DISTINCT title) as unique_alerts,
            MIN(CONVERT_TZ(timestamp, '+00:00', '+05:30')) as first_alert_ist,
            MAX(CONVERT_TZ(timestamp, '+00:00', '+05:30')) as last_alert_ist,
            GROUP_CONCAT(DISTINCT LEFT(message, 100) ORDER BY timestamp DESC SEPARATOR ' | ') as recent_messages,
            SUM(CASE WHEN acknowledged = TRUE THEN 1 ELSE 0 END) as acknowledged_count
        FROM alertLog
        WHERE timestamp >= CONVERT_TZ('2026-02-06 10:00:00', '+05:30', '+00:00')
        GROUP BY alertType, severity
        ORDER BY severity DESC, alert_count DESC
    """,
    "7.2_deduplication": """
        SELECT 
            alertType,
            COUNT(*) as total_alerts,
            COUNT(DISTINCT DATE_FORMAT(CONVERT_TZ(timestamp, '+00:00', '+05:30'), '%Y-%m-%d %H:%i')) as unique_minutes,
            ROUND(COUNT(*) / COUNT(DISTINCT DATE_FORMAT(CONVERT_TZ(timestamp, '+00:00', '+05:30'), '%Y-%m-%d %H:%i')), 2) as avg_alerts_per_minute
        FROM alertLog
        WHERE timestamp >= CONVERT_TZ('2026-02-06 10:00:00', '+05:30', '+00:00')
        GROUP BY alertType
        HAVING avg_alerts_per_minute > 2
        ORDER BY avg_alerts_per_minute DESC
    """,

    # SECTION 8: Diagnostics
    "8.1_open_positions": """
        SELECT 
            id,
            symbol,
            side,
            ROUND(size, 6) as size,
            ROUND(entryPrice, 2) as entry_price,
            CONVERT_TZ(openedAt, '+00:00', '+05:30') as opened_at_ist,
            TIMESTAMPDIFF(MINUTE, openedAt, NOW()) as minutes_open,
            ROUND(unrealizedPnL, 4) as current_pnl,
            targetsHit
        FROM paperPositions
        WHERE status = 'open'
        ORDER BY openedAt DESC
        LIMIT 20
    """,
    "8.2_table_counts": """
        SELECT 'systemHeartbeat' as table_name,
            COUNT(*) as row_count,
            MIN(CONVERT_TZ(timestamp, '+00:00', '+05:30')) as oldest_row_ist,
            MAX(CONVERT_TZ(timestamp, '+00:00', '+05:30')) as newest_row_ist
        FROM systemHeartbeat
        WHERE timestamp >= CONVERT_TZ('2026-02-06 10:00:00', '+05:30', '+00:00')
        UNION ALL
        SELECT 'serviceEvents', COUNT(*), 
               MIN(CONVERT_TZ(timestamp, '+00:00', '+05:30')), 
               MAX(CONVERT_TZ(timestamp, '+00:00', '+05:30'))
        FROM serviceEvents
        WHERE timestamp >= CONVERT_TZ('2026-02-06 10:00:00', '+05:30', '+00:00')
        UNION ALL
        SELECT 'apiConnectionLog', COUNT(*), 
               MIN(CONVERT_TZ(timestamp, '+00:00', '+05:30')), 
               MAX(CONVERT_TZ(timestamp, '+00:00', '+05:30'))
        FROM apiConnectionLog
        WHERE timestamp >= CONVERT_TZ('2026-02-06 10:00:00', '+05:30', '+00:00')
        UNION ALL
        SELECT 'websocketHealthLog', COUNT(*), 
               MIN(CONVERT_TZ(timestamp, '+00:00', '+05:30')), 
               MAX(CONVERT_TZ(timestamp, '+00:00', '+05:30'))
        FROM websocketHealthLog
        WHERE timestamp >= CONVERT_TZ('2026-02-06 10:00:00', '+05:30', '+00:00')
        UNION ALL
        SELECT 'exitDecisionLog', COUNT(*), 
               MIN(CONVERT_TZ(timestamp, '+00:00', '+05:30')), 
               MAX(CONVERT_TZ(timestamp, '+00:00', '+05:30'))
        FROM exitDecisionLog
        WHERE timestamp >= CONVERT_TZ('2026-02-06 10:00:00', '+05:30', '+00:00')
        UNION ALL
        SELECT 'capitalUtilization', COUNT(*), 
               MIN(CONVERT_TZ(timestamp, '+00:00', '+05:30')), 
               MAX(CONVERT_TZ(timestamp, '+00:00', '+05:30'))
        FROM capitalUtilization
        WHERE timestamp >= CONVERT_TZ('2026-02-06 10:00:00', '+05:30', '+00:00')
        UNION ALL
        SELECT 'positionSizingLog', COUNT(*), 
               MIN(CONVERT_TZ(timestamp, '+00:00', '+05:30')), 
               MAX(CONVERT_TZ(timestamp, '+00:00', '+05:30'))
        FROM positionSizingLog
        WHERE timestamp >= CONVERT_TZ('2026-02-06 10:00:00', '+05:30', '+00:00')
        UNION ALL
        SELECT 'entryValidationLog', COUNT(*), 
               MIN(CONVERT_TZ(timestamp, '+00:00', '+05:30')), 
               MAX(CONVERT_TZ(timestamp, '+00:00', '+05:30'))
        FROM entryValidationLog
        WHERE timestamp >= CONVERT_TZ('2026-02-06 10:00:00', '+05:30', '+00:00')
        UNION ALL
        SELECT 'alertLog', COUNT(*), 
               MIN(CONVERT_TZ(timestamp, '+00:00', '+05:30')), 
               MAX(CONVERT_TZ(timestamp, '+00:00', '+05:30'))
        FROM alertLog
        WHERE timestamp >= CONVERT_TZ('2026-02-06 10:00:00', '+05:30', '+00:00')
    """,

    # SECTION 9: Executive Summary
    "9.1_executive_dashboard": """
        SELECT 
            'System Uptime' as metric_category,
            'Heartbeat Count' as metric_name,
            COUNT(*) as value,
            '~60 per hour expected' as target
        FROM systemHeartbeat
        WHERE timestamp >= CONVERT_TZ('2026-02-06 10:00:00', '+05:30', '+00:00')
        UNION ALL
        SELECT 'System Uptime', 'Service Crashes', COUNT(*), '0 expected'
        FROM serviceEvents
        WHERE eventType = 'crash'
            AND timestamp >= CONVERT_TZ('2026-02-06 10:00:00', '+05:30', '+00:00')
        UNION ALL
        SELECT 'Trading Performance', 'Total Trades', COUNT(*), '>10 expected'
        FROM paperPositions
        WHERE status = 'closed'
            AND closedAt >= CONVERT_TZ('2026-02-06 10:00:00', '+05:30', '+00:00')
        UNION ALL
        SELECT 'Trading Performance', 'Win Rate %', 
               ROUND(SUM(CASE WHEN realizedPnL > 0 THEN 1 ELSE 0 END) * 100.0 / NULLIF(COUNT(*), 0), 2),
               '>45% target'
        FROM paperPositions
        WHERE status = 'closed'
            AND closedAt >= CONVERT_TZ('2026-02-06 10:00:00', '+05:30', '+00:00')
        UNION ALL
        SELECT 'Trading Performance', 'Total P&L', ROUND(SUM(realizedPnL), 4), 'Positive target'
        FROM paperPositions
        WHERE status = 'closed'
            AND closedAt >= CONVERT_TZ('2026-02-06 10:00:00', '+05:30', '+00:00')
        UNION ALL
        SELECT 'Exit System', 'Confidence Decay %',
               ROUND(COUNT(*) * 100.0 / NULLIF((SELECT COUNT(*) FROM paperPositions WHERE status = 'closed' AND closedAt >= CONVERT_TZ('2026-02-06 10:00:00', '+05:30', '+00:00')), 0), 2),
               '<10% target'
        FROM paperPositions
        WHERE status = 'closed'
            AND exitReason LIKE '%confidence%'
            AND closedAt >= CONVERT_TZ('2026-02-06 10:00:00', '+05:30', '+00:00')
        UNION ALL
        SELECT 'Exit System', 'Profit Target %',
               ROUND(COUNT(*) * 100.0 / NULLIF((SELECT COUNT(*) FROM paperPositions WHERE status = 'closed' AND closedAt >= CONVERT_TZ('2026-02-06 10:00:00', '+05:30', '+00:00')), 0), 2),
               '>30% target'
        FROM paperPositions
        WHERE status = 'closed'
            AND exitReason LIKE '%profit_target%'
            AND closedAt >= CONVERT_TZ('2026-02-06 10:00:00', '+05:30', '+00:00')
        UNION ALL
        SELECT 'Connection Health', 'CoinAPI Errors', COUNT(*), '0 expected (if disabled)'
        FROM apiConnectionLog
        WHERE apiName LIKE '%coinapi%'
            AND timestamp >= CONVERT_TZ('2026-02-06 10:00:00', '+05:30', '+00:00')
        UNION ALL
        SELECT 'Capital Utilization', 'Avg Utilization %',
               ROUND(AVG(utilizationPercent), 2), '60-80% target'
        FROM capitalUtilization
        WHERE timestamp >= CONVERT_TZ('2026-02-06 10:00:00', '+05:30', '+00:00')
        UNION ALL
        SELECT 'Alerts', 'Critical Alerts', COUNT(*), '0 expected'
        FROM alertLog
        WHERE severity IN ('critical', 'emergency')
            AND timestamp >= CONVERT_TZ('2026-02-06 10:00:00', '+05:30', '+00:00')
    """,
}

print(f"SEER Deep System Audit - Data Collection")
print(f"Audit Date: February 6, 2026")
print(f"Total Queries: {len(QUERIES)}")
print(f"Output Directory: {OUTPUT_DIR}")
print(f"=" * 60)

# Write queries to individual files so we can execute them via webdev_execute_sql equivalent
for query_id, sql in QUERIES.items():
    filepath = os.path.join(OUTPUT_DIR, f"query_{query_id}.sql")
    with open(filepath, 'w') as f:
        f.write(sql.strip())
    print(f"✅ Prepared: query_{query_id}.sql")

print(f"\n{'=' * 60}")
print(f"All {len(QUERIES)} query files prepared.")
print(f"Now execute each via webdev_execute_sql tool.")
