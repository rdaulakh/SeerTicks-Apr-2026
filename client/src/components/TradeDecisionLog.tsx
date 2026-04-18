/**
 * Trade Decision Log Component
 * 
 * Comprehensive audit trail of all trading decisions with full agent breakdown
 * Shows confidence scores, execution status, entry/exit prices, and P&L
 * All timestamps displayed in IST (Indian Standard Time, GMT+5:30)
 */

import { useState, useMemo } from 'react';
import { trpc } from '@/lib/trpc';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { 
  Activity, 
  TrendingUp, 
  TrendingDown, 
  Target, 
  AlertTriangle,
  CheckCircle,
  XCircle,
  Clock,
  ChevronDown,
  ChevronUp,
  Filter,
  Calendar,
  RefreshCw,
  Loader2,
  Brain,
  Zap,
  Eye,
  BarChart3,
  DollarSign,
  Percent,
  FileText,
  Scale
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface AgentScore {
  score: number;
  weight: number;
  signal: 'BUY' | 'SELL' | 'HOLD';
  confidence: number;
  reasoning?: string;
}

interface TradeDecision {
  id: number;
  signalId: string;
  timestamp: Date;
  symbol: string;
  exchange: string;
  price: number;
  signalType: 'BUY' | 'SELL' | 'HOLD';
  signalStrength: number | null;
  fastScore: number | null;
  slowBonus: number | null;
  totalConfidence: number;
  threshold: number;
  agentScores: Record<string, AgentScore>;
  decision: 'EXECUTED' | 'SKIPPED' | 'VETOED' | 'PENDING' | 'FAILED' | 'PARTIAL';
  decisionReason: string | null;
  positionId: number | null;
  orderId: string | null;
  entryPrice: number | null;
  quantity: number | null;
  positionSizePercent: number | null;
  exitPrice: number | null;
  exitTime: Date | null;
  exitReason: string | null;
  pnl: number | null;
  pnlPercent: number | null;
  status: string;
  marketConditions: any;
  holdDuration: number | null;
  maxDrawdown: number | null;
  maxProfit: number | null;
}

/**
 * Format date to IST (Indian Standard Time, GMT+5:30)
 */
function formatToIST(date: Date | string): string {
  const d = new Date(date);
  const istOptions: Intl.DateTimeFormatOptions = {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true
  };
  return d.toLocaleString('en-IN', istOptions);
}

/**
 * Format date to IST with only time
 */
function formatTimeIST(date: Date | string): string {
  const d = new Date(date);
  const istOptions: Intl.DateTimeFormatOptions = {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true
  };
  return d.toLocaleString('en-IN', istOptions);
}

/**
 * Format date to IST with date only
 */
function formatDateIST(date: Date | string): string {
  const d = new Date(date);
  const istOptions: Intl.DateTimeFormatOptions = {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: 'short',
    day: '2-digit'
  };
  return d.toLocaleString('en-IN', istOptions);
}

export default function TradeDecisionLog() {
  const [startDate, setStartDate] = useState<string>(() => {
    const date = new Date();
    date.setDate(date.getDate() - 7);
    return date.toISOString().split('T')[0];
  });
  const [endDate, setEndDate] = useState<string>(() => {
    return new Date().toISOString().split('T')[0];
  });
  const [symbolFilter, setSymbolFilter] = useState<string>('all');
  const [decisionFilter, setDecisionFilter] = useState<string>('actionable');
  const [statusFilter, setStatusFilter] = useState<string>('actionable');
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());
  const [selectedDecision, setSelectedDecision] = useState<TradeDecision | null>(null);

  // Fetch trade decision logs
  // 'actionable' filter shows only EXECUTED trades and genuine MISSED opportunities
  const { data: logsData, isLoading: logsLoading, refetch: refetchLogs } = trpc.tradeDecisionLog.getLogs.useQuery({
    startDate,
    endDate,
    symbol: symbolFilter !== 'all' ? symbolFilter : undefined,
    decision: decisionFilter !== 'all' && decisionFilter !== 'actionable' ? decisionFilter as any : undefined,
    status: statusFilter !== 'all' && statusFilter !== 'actionable' ? statusFilter as any : undefined,
    limit: 100,
  }, {
    staleTime: 30000,
  });

  // Filter logs client-side for 'actionable' view
  // Actionable = EXECUTED trades OR genuine OPPORTUNITY_MISSED (consensus >= threshold but not executed)
  const filteredLogs = useMemo(() => {
    let result = logsData?.logs || [];
    
    // Apply actionable filter: only show EXECUTED or genuine OPPORTUNITY_MISSED
    if (decisionFilter === 'actionable' || statusFilter === 'actionable') {
      result = result.filter(log => {
        // Always show executed trades
        if (log.decision === 'EXECUTED') return true;
        // Show genuine missed opportunities (consensus >= threshold but skipped)
        if (log.status === 'OPPORTUNITY_MISSED' && log.totalConfidence >= log.threshold) return true;
        // Show open and closed positions
        if (log.status === 'POSITION_OPENED' || log.status === 'POSITION_CLOSED') return true;
        // Hide correctly rejected signals (below threshold)
        return false;
      });
    }
    
    return result;
  }, [logsData?.logs, decisionFilter, statusFilter]);

  // Fetch stats
  const { data: stats, isLoading: statsLoading, refetch: refetchStats } = trpc.tradeDecisionLog.getStats.useQuery({
    startDate,
    endDate,
    symbol: symbolFilter !== 'all' ? symbolFilter : undefined,
  }, {
    staleTime: 30000,
  });

  // Fetch available symbols
  const { data: symbols } = trpc.tradeDecisionLog.getSymbols.useQuery(undefined, {
    staleTime: 60000,
  });

  const logs = filteredLogs;
  const isLoading = logsLoading || statsLoading;

  const toggleRow = (id: number) => {
    const newExpanded = new Set(expandedRows);
    if (newExpanded.has(id)) {
      newExpanded.delete(id);
    } else {
      newExpanded.add(id);
    }
    setExpandedRows(newExpanded);
  };

  const handleRefresh = () => {
    refetchLogs();
    refetchStats();
  };

  const getDecisionBadge = (decision: string) => {
    switch (decision) {
      case 'EXECUTED':
        return <Badge className="bg-green-500/20 text-green-400 border-green-500/30"><CheckCircle className="w-3 h-3 mr-1" />Executed</Badge>;
      case 'SKIPPED':
        return <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30"><AlertTriangle className="w-3 h-3 mr-1" />Skipped</Badge>;
      case 'VETOED':
        return <Badge className="bg-red-500/20 text-red-400 border-red-500/30"><XCircle className="w-3 h-3 mr-1" />Vetoed</Badge>;
      case 'PENDING':
        return <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30"><Clock className="w-3 h-3 mr-1" />Pending</Badge>;
      case 'FAILED':
        return <Badge className="bg-red-500/20 text-red-400 border-red-500/30"><XCircle className="w-3 h-3 mr-1" />Failed</Badge>;
      default:
        return <Badge variant="outline">{decision}</Badge>;
    }
  };

  const getSignalBadge = (signalType: string) => {
    switch (signalType) {
      case 'BUY':
        return <Badge className="bg-green-500/20 text-green-400 border-green-500/30"><TrendingUp className="w-3 h-3 mr-1" />BUY</Badge>;
      case 'SELL':
        return <Badge className="bg-red-500/20 text-red-400 border-red-500/30"><TrendingDown className="w-3 h-3 mr-1" />SELL</Badge>;
      case 'HOLD':
        return <Badge className="bg-slate-500/20 text-slate-400 border-slate-500/30">HOLD</Badge>;
      default:
        return <Badge variant="outline">{signalType}</Badge>;
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'POSITION_OPENED':
        return <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30">Open</Badge>;
      case 'POSITION_CLOSED':
        return <Badge className="bg-purple-500/20 text-purple-400 border-purple-500/30">Closed</Badge>;
      case 'OPPORTUNITY_MISSED':
        return <Badge className="bg-orange-500/20 text-orange-400 border-orange-500/30">Missed</Badge>;
      case 'SIGNAL_GENERATED':
        return <Badge className="bg-cyan-500/20 text-cyan-400 border-cyan-500/30">Signal</Badge>;
      case 'DECISION_MADE':
        return <Badge className="bg-indigo-500/20 text-indigo-400 border-indigo-500/30">Decided</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const formatDuration = (seconds: number | null) => {
    if (!seconds) return '-';
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
    return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
  };

  /**
   * Generate audit trail explanation for why a trade was executed or missed
   */
  const getAuditExplanation = (log: TradeDecision): string => {
    const passedThreshold = log.totalConfidence >= log.threshold;
    const thresholdDiff = (log.totalConfidence - log.threshold).toFixed(1);
    
    if (log.decision === 'EXECUTED') {
      return `✅ TRADE EXECUTED: Combined Score (${log.totalConfidence.toFixed(1)}%) exceeded threshold (${log.threshold}%) by ${thresholdDiff}%. All conditions met for ${log.signalType} signal.`;
    } else if (log.status === 'OPPORTUNITY_MISSED') {
      return `⚠️ OPPORTUNITY MISSED: Combined Score (${log.totalConfidence.toFixed(1)}%) met threshold (${log.threshold}%) but trade was not executed. Reason: ${log.decisionReason || 'Unknown - possible system delay or risk limit'}`;
    } else if (log.decision === 'SKIPPED' && !passedThreshold) {
      return `❌ CORRECTLY REJECTED: Combined Score (${log.totalConfidence.toFixed(1)}%) below threshold (${log.threshold}%) by ${Math.abs(parseFloat(thresholdDiff)).toFixed(1)}%. Signal did not qualify.`;
    } else if (log.decision === 'VETOED') {
      return `🚫 VETOED BY RISK MANAGEMENT: ${log.decisionReason || 'Risk limits or position constraints prevented execution'}`;
    } else if (log.decision === 'FAILED') {
      return `💥 EXECUTION FAILED: ${log.decisionReason || 'Technical error during trade execution'}`;
    }
    return log.decisionReason || 'No additional details available';
  };

  /**
   * Calculate weighted contribution of each agent
   */
  const getAgentContribution = (agentScore: AgentScore): number => {
    return agentScore.score * agentScore.weight;
  };

  return (
    <div className="space-y-6">
      {/* Section Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white flex items-center gap-3">
            <FileText className="w-7 h-7 text-purple-400" />
            Trade Execution Audit Log
          </h2>
          <p className="text-slate-400 mt-1">
            Comprehensive audit trail showing executed trades and missed opportunities with full agent breakdown
            <span className="text-xs text-slate-500 ml-2">(All times in IST)</span>
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={handleRefresh} className="gap-2">
          <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
        <Card className="glass-card p-4 border-slate-800/50">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs text-slate-400">Total Signals</p>
            <Activity className="w-4 h-4 text-blue-400" />
          </div>
          <p className="text-xl font-bold text-white">{stats?.totalSignals || 0}</p>
        </Card>

        <Card className="glass-card p-4 border-slate-800/50">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs text-slate-400">Executed</p>
            <CheckCircle className="w-4 h-4 text-green-400" />
          </div>
          <p className="text-xl font-bold text-green-400">{stats?.executedTrades || 0}</p>
        </Card>

        <Card className="glass-card p-4 border-slate-800/50">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs text-slate-400">Missed Opps</p>
            <Eye className="w-4 h-4 text-orange-400" />
          </div>
          <p className="text-xl font-bold text-orange-400">{stats?.opportunitiesMissed || 0}</p>
        </Card>

        <Card className="glass-card p-4 border-slate-800/50">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs text-slate-400">Win Rate</p>
            <Target className="w-4 h-4 text-purple-400" />
          </div>
          <p className="text-xl font-bold text-white">{(stats?.winRate || 0).toFixed(1)}%</p>
        </Card>

        <Card className="glass-card p-4 border-slate-800/50">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs text-slate-400">Total P&L</p>
            <DollarSign className="w-4 h-4 text-cyan-400" />
          </div>
          <p className={`text-xl font-bold ${(stats?.totalPnl || 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
            {(stats?.totalPnl || 0) >= 0 ? '+' : ''}${(stats?.totalPnl || 0).toFixed(2)}
          </p>
        </Card>

        <Card className="glass-card p-4 border-slate-800/50">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs text-slate-400">Avg Confidence</p>
            <Scale className="w-4 h-4 text-indigo-400" />
          </div>
          <p className="text-xl font-bold text-white">{(stats?.avgConfidence || 0).toFixed(1)}%</p>
        </Card>
      </div>

      {/* Filters */}
      <Card className="glass-card p-4 border-slate-800/50">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-slate-400" />
            <span className="text-sm text-slate-400">Filters:</span>
          </div>

          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4 text-slate-400" />
            <Input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-36 bg-slate-800/50 border-slate-700 text-white text-sm"
            />
            <span className="text-slate-400">to</span>
            <Input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="w-36 bg-slate-800/50 border-slate-700 text-white text-sm"
            />
          </div>

          <Select value={symbolFilter} onValueChange={setSymbolFilter}>
            <SelectTrigger className="w-32 bg-slate-800/50 border-slate-700 text-white">
              <SelectValue placeholder="Symbol" />
            </SelectTrigger>
            <SelectContent className="bg-slate-800 border-slate-700">
              <SelectItem value="all">All Symbols</SelectItem>
              {symbols?.map((symbol) => (
                <SelectItem key={symbol} value={symbol}>{symbol}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={decisionFilter} onValueChange={setDecisionFilter}>
            <SelectTrigger className="w-44 bg-slate-800/50 border-slate-700 text-white">
              <SelectValue placeholder="Decision" />
            </SelectTrigger>
            <SelectContent className="bg-slate-800 border-slate-700">
              <SelectItem value="actionable">Actionable Only</SelectItem>
              <SelectItem value="all">All Decisions</SelectItem>
              <SelectItem value="EXECUTED">Executed</SelectItem>
              <SelectItem value="SKIPPED">Skipped</SelectItem>
              <SelectItem value="VETOED">Vetoed</SelectItem>
              <SelectItem value="PENDING">Pending</SelectItem>
              <SelectItem value="FAILED">Failed</SelectItem>
            </SelectContent>
          </Select>

          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-44 bg-slate-800/50 border-slate-700 text-white">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent className="bg-slate-800 border-slate-700">
              <SelectItem value="actionable">Actionable Only</SelectItem>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="POSITION_OPENED">Open</SelectItem>
              <SelectItem value="POSITION_CLOSED">Closed</SelectItem>
              <SelectItem value="OPPORTUNITY_MISSED">Missed</SelectItem>
              <SelectItem value="SIGNAL_GENERATED">Signal</SelectItem>
              <SelectItem value="DECISION_MADE">Decided</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </Card>

      {/* Decision Log Table */}
      <Card className="glass-card border-slate-800/50 overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
          </div>
        ) : logs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-slate-500">
            <Brain className="w-12 h-12 mb-4 opacity-50" />
            <p>No trade decisions found for the selected period</p>
            <p className="text-sm mt-1">Executed trades and missed opportunities will appear here</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-800 bg-slate-900/50">
                  <th className="text-left py-3 px-4 text-xs font-semibold text-slate-400 uppercase tracking-wider">Time (IST)</th>
                  <th className="text-left py-3 px-4 text-xs font-semibold text-slate-400 uppercase tracking-wider">Symbol</th>
                  <th className="text-left py-3 px-4 text-xs font-semibold text-slate-400 uppercase tracking-wider">Signal</th>
                  <th className="text-center py-3 px-4 text-xs font-semibold text-slate-400 uppercase tracking-wider">Combined Score</th>
                  <th className="text-center py-3 px-4 text-xs font-semibold text-slate-400 uppercase tracking-wider">Threshold</th>
                  <th className="text-left py-3 px-4 text-xs font-semibold text-slate-400 uppercase tracking-wider">Decision</th>
                  <th className="text-left py-3 px-4 text-xs font-semibold text-slate-400 uppercase tracking-wider">Status</th>
                  <th className="text-right py-3 px-4 text-xs font-semibold text-slate-400 uppercase tracking-wider">Entry</th>
                  <th className="text-right py-3 px-4 text-xs font-semibold text-slate-400 uppercase tracking-wider">Exit</th>
                  <th className="text-right py-3 px-4 text-xs font-semibold text-slate-400 uppercase tracking-wider">P&L</th>
                  <th className="text-center py-3 px-4 text-xs font-semibold text-slate-400 uppercase tracking-wider">Audit</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log: TradeDecision) => (
                  <>
                    <tr 
                      key={log.id} 
                      className={`border-b border-slate-800/50 hover:bg-slate-800/30 cursor-pointer transition-colors ${
                        log.status === 'OPPORTUNITY_MISSED' ? 'bg-orange-500/5' : 
                        log.decision === 'EXECUTED' ? 'bg-green-500/5' : ''
                      }`}
                      onClick={() => toggleRow(log.id)}
                    >
                      <td className="py-3 px-4">
                        <div className="flex flex-col">
                          <span className="text-sm text-white font-medium">{formatDateIST(log.timestamp)}</span>
                          <span className="text-xs text-slate-500">{formatTimeIST(log.timestamp)}</span>
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex flex-col">
                          <span className="text-sm font-medium text-white">{log.symbol}</span>
                          <span className="text-xs text-slate-500">${log.price.toLocaleString()}</span>
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        {getSignalBadge(log.signalType)}
                      </td>
                      <td className="py-3 px-4 text-center">
                        <div className="flex flex-col items-center">
                          <span className={`text-lg font-bold ${
                            log.totalConfidence >= log.threshold ? 'text-green-400' : 'text-yellow-400'
                          }`}>
                            {log.totalConfidence.toFixed(1)}%
                          </span>
                          {log.fastScore !== null && (
                            <span className="text-xs text-slate-500">
                              Fast: {log.fastScore.toFixed(1)} + Slow: {log.slowBonus?.toFixed(1) || '0'}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-center">
                        <div className="flex flex-col items-center">
                          <span className="text-sm text-slate-400">{log.threshold}%</span>
                          <span className={`text-xs ${log.totalConfidence >= log.threshold ? 'text-green-500' : 'text-red-500'}`}>
                            {log.totalConfidence >= log.threshold ? '✓ PASS' : '✗ FAIL'}
                          </span>
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        {getDecisionBadge(log.decision)}
                      </td>
                      <td className="py-3 px-4">
                        {getStatusBadge(log.status)}
                      </td>
                      <td className="py-3 px-4 text-right">
                        {log.entryPrice ? (
                          <span className="text-sm text-white">${log.entryPrice.toLocaleString()}</span>
                        ) : (
                          <span className="text-sm text-slate-500">-</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right">
                        {log.exitPrice ? (
                          <span className="text-sm text-white">${log.exitPrice.toLocaleString()}</span>
                        ) : (
                          <span className="text-sm text-slate-500">-</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right">
                        {log.pnl !== null ? (
                          <div className="flex flex-col items-end">
                            <span className={`text-sm font-bold ${log.pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                              {log.pnl >= 0 ? '+' : ''}${log.pnl.toFixed(2)}
                            </span>
                            {log.pnlPercent !== null && (
                              <span className={`text-xs ${log.pnlPercent >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                                {log.pnlPercent >= 0 ? '+' : ''}{log.pnlPercent.toFixed(2)}%
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="text-sm text-slate-500">-</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-center">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedDecision(log);
                          }}
                          className="text-slate-400 hover:text-white"
                        >
                          <Eye className="w-4 h-4" />
                        </Button>
                        {expandedRows.has(log.id) ? (
                          <ChevronUp className="w-4 h-4 inline ml-1 text-slate-400" />
                        ) : (
                          <ChevronDown className="w-4 h-4 inline ml-1 text-slate-400" />
                        )}
                      </td>
                    </tr>
                    {/* Expanded Row - Audit Trail */}
                    {expandedRows.has(log.id) && (
                      <tr className="bg-slate-900/70">
                        <td colSpan={11} className="py-4 px-6">
                          <div className="space-y-4">
                            {/* Audit Explanation */}
                            <div className={`rounded-lg p-4 border ${
                              log.decision === 'EXECUTED' ? 'bg-green-500/10 border-green-500/30' :
                              log.status === 'OPPORTUNITY_MISSED' ? 'bg-orange-500/10 border-orange-500/30' :
                              'bg-slate-800/50 border-slate-700/50'
                            }`}>
                              <h4 className="text-sm font-semibold text-white mb-2 flex items-center gap-2">
                                <FileText className="w-4 h-4" />
                                Audit Trail Explanation
                              </h4>
                              <p className="text-sm text-slate-300">{getAuditExplanation(log)}</p>
                            </div>

                            {/* Threshold Check Details */}
                            <div className="bg-slate-800/50 rounded-lg p-4 border border-slate-700/50">
                              <h4 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
                                <Scale className="w-4 h-4 text-cyan-400" />
                                Threshold Check Details
                              </h4>
                              <div className="grid grid-cols-4 gap-4 text-center">
                                <div>
                                  <p className="text-2xl font-bold text-cyan-400">{log.totalConfidence.toFixed(1)}%</p>
                                  <p className="text-xs text-slate-400">Combined Score</p>
                                </div>
                                <div>
                                  <p className="text-2xl font-bold text-purple-400">{log.threshold}%</p>
                                  <p className="text-xs text-slate-400">Required Threshold</p>
                                </div>
                                <div>
                                  <p className={`text-2xl font-bold ${log.totalConfidence >= log.threshold ? 'text-green-400' : 'text-red-400'}`}>
                                    {(log.totalConfidence - log.threshold).toFixed(1)}%
                                  </p>
                                  <p className="text-xs text-slate-400">Margin</p>
                                </div>
                                <div>
                                  <p className={`text-2xl font-bold ${log.totalConfidence >= log.threshold ? 'text-green-400' : 'text-red-400'}`}>
                                    {log.totalConfidence >= log.threshold ? '✓ PASS' : '✗ FAIL'}
                                  </p>
                                  <p className="text-xs text-slate-400">Result</p>
                                </div>
                              </div>
                              
                              {/* Visual Progress Bar */}
                              <div className="mt-4">
                                <div className="h-4 bg-slate-700 rounded-full overflow-hidden relative">
                                  <div 
                                    className={`h-full transition-all ${
                                      log.totalConfidence >= log.threshold 
                                        ? 'bg-gradient-to-r from-green-500 to-emerald-400' 
                                        : 'bg-gradient-to-r from-yellow-500 to-orange-400'
                                    }`}
                                    style={{ width: `${Math.min(log.totalConfidence, 100)}%` }}
                                  />
                                  <div 
                                    className="absolute top-0 bottom-0 w-1 bg-white shadow-lg"
                                    style={{ left: `${log.threshold}%` }}
                                  />
                                </div>
                                <div className="flex justify-between mt-1 text-xs text-slate-500">
                                  <span>0%</span>
                                  <span className="text-white font-medium">Threshold: {log.threshold}%</span>
                                  <span>100%</span>
                                </div>
                              </div>
                            </div>

                            {/* Agent Scores Grid */}
                            <div>
                              <h4 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
                                <Brain className="w-4 h-4 text-purple-400" />
                                Agent Votes & Contributions
                              </h4>
                              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                                {Object.entries(log.agentScores || {}).map(([agentName, agentScore]) => {
                                  const contribution = getAgentContribution(agentScore as AgentScore);
                                  return (
                                    <div 
                                      key={agentName}
                                      className="bg-slate-800/50 rounded-lg p-3 border border-slate-700/50"
                                    >
                                      <div className="flex items-center justify-between mb-2">
                                        <span className="text-xs font-medium text-slate-300">{agentName}</span>
                                        {getSignalBadge((agentScore as AgentScore).signal)}
                                      </div>
                                      <div className="space-y-1">
                                        <div className="flex justify-between text-xs">
                                          <span className="text-slate-500">Raw Score</span>
                                          <span className="text-white font-medium">{(agentScore as AgentScore).score.toFixed(1)}</span>
                                        </div>
                                        <div className="flex justify-between text-xs">
                                          <span className="text-slate-500">Weight</span>
                                          <span className="text-slate-400">{((agentScore as AgentScore).weight * 100).toFixed(0)}%</span>
                                        </div>
                                        <div className="flex justify-between text-xs">
                                          <span className="text-slate-500">Contribution</span>
                                          <span className="text-cyan-400 font-medium">{contribution.toFixed(1)}</span>
                                        </div>
                                        <div className="flex justify-between text-xs">
                                          <span className="text-slate-500">Confidence</span>
                                          <span className="text-purple-400">{(agentScore as AgentScore).confidence.toFixed(1)}%</span>
                                        </div>
                                      </div>
                                      {(agentScore as AgentScore).reasoning && (
                                        <p className="text-xs text-slate-500 mt-2 line-clamp-2 bg-slate-900/50 rounded p-1">
                                          {(agentScore as AgentScore).reasoning}
                                        </p>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            </div>

                            {/* Trade Details */}
                            {(log.holdDuration || log.maxDrawdown || log.maxProfit || log.exitReason) && (
                              <div className="flex flex-wrap gap-6 text-sm bg-slate-800/30 rounded-lg p-3">
                                {log.holdDuration && (
                                  <div>
                                    <span className="text-slate-500">Hold Duration:</span>
                                    <span className="text-white ml-2 font-medium">{formatDuration(log.holdDuration)}</span>
                                  </div>
                                )}
                                {log.maxDrawdown && (
                                  <div>
                                    <span className="text-slate-500">Max Drawdown:</span>
                                    <span className="text-red-400 ml-2 font-medium">-{log.maxDrawdown.toFixed(2)}%</span>
                                  </div>
                                )}
                                {log.maxProfit && (
                                  <div>
                                    <span className="text-slate-500">Max Profit:</span>
                                    <span className="text-green-400 ml-2 font-medium">+{log.maxProfit.toFixed(2)}%</span>
                                  </div>
                                )}
                                {log.exitReason && (
                                  <div>
                                    <span className="text-slate-500">Exit Reason:</span>
                                    <span className="text-white ml-2 font-medium capitalize">{log.exitReason.replace(/_/g, ' ')}</span>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination Info */}
        {logsData && logsData.total > 0 && (
          <div className="px-4 py-3 border-t border-slate-800 flex items-center justify-between">
            <p className="text-sm text-slate-400">
              Showing {logs.length} of {logsData.total} actionable decisions
            </p>
            {logsData.hasMore && (
              <p className="text-sm text-slate-500">Scroll or adjust filters to see more</p>
            )}
          </div>
        )}
      </Card>

      {/* Detail Modal */}
      <Dialog open={!!selectedDecision} onOpenChange={() => setSelectedDecision(null)}>
        <DialogContent className="max-w-4xl bg-slate-900 border-slate-700 text-white max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="w-5 h-5 text-purple-400" />
              Trade Execution Audit Details
            </DialogTitle>
          </DialogHeader>
          
          {selectedDecision && (
            <div className="space-y-6">
              {/* Audit Summary */}
              <div className={`rounded-lg p-4 border ${
                selectedDecision.decision === 'EXECUTED' ? 'bg-green-500/10 border-green-500/30' :
                selectedDecision.status === 'OPPORTUNITY_MISSED' ? 'bg-orange-500/10 border-orange-500/30' :
                'bg-slate-800/50 border-slate-700/50'
              }`}>
                <p className="text-sm text-slate-300">{getAuditExplanation(selectedDecision)}</p>
              </div>

              {/* Header Info */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div>
                  <p className="text-xs text-slate-400 uppercase">Symbol</p>
                  <p className="text-lg font-bold text-white">{selectedDecision.symbol}</p>
                  <p className="text-xs text-slate-500">{selectedDecision.exchange}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-400 uppercase">Time (IST)</p>
                  <p className="text-sm font-medium text-white">{formatToIST(selectedDecision.timestamp)}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-400 uppercase">Decision</p>
                  <div className="mt-1">{getDecisionBadge(selectedDecision.decision)}</div>
                </div>
                <div>
                  <p className="text-xs text-slate-400 uppercase">Status</p>
                  <div className="mt-1">{getStatusBadge(selectedDecision.status)}</div>
                </div>
              </div>

              {/* Confidence Breakdown */}
              <div className="bg-slate-800/50 rounded-lg p-4">
                <h4 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
                  <BarChart3 className="w-4 h-4 text-cyan-400" />
                  Combined Score Analysis
                </h4>
                <div className="grid grid-cols-4 gap-4">
                  <div className="text-center">
                    <p className="text-2xl font-bold text-cyan-400">{selectedDecision.totalConfidence.toFixed(1)}%</p>
                    <p className="text-xs text-slate-400">Combined Score</p>
                  </div>
                  <div className="text-center">
                    <p className="text-2xl font-bold text-purple-400">{selectedDecision.threshold}%</p>
                    <p className="text-xs text-slate-400">Threshold</p>
                  </div>
                  <div className="text-center">
                    <p className={`text-2xl font-bold ${selectedDecision.totalConfidence >= selectedDecision.threshold ? 'text-green-400' : 'text-red-400'}`}>
                      {(selectedDecision.totalConfidence - selectedDecision.threshold).toFixed(1)}%
                    </p>
                    <p className="text-xs text-slate-400">Margin</p>
                  </div>
                  <div className="text-center">
                    <p className={`text-2xl font-bold ${selectedDecision.totalConfidence >= selectedDecision.threshold ? 'text-green-400' : 'text-red-400'}`}>
                      {selectedDecision.totalConfidence >= selectedDecision.threshold ? '✓ PASS' : '✗ FAIL'}
                    </p>
                    <p className="text-xs text-slate-400">Result</p>
                  </div>
                </div>
                
                {/* Score Breakdown */}
                {selectedDecision.fastScore !== null && (
                  <div className="mt-4 grid grid-cols-2 gap-4 text-center border-t border-slate-700 pt-4">
                    <div>
                      <p className="text-lg font-bold text-blue-400">{selectedDecision.fastScore.toFixed(1)}</p>
                      <p className="text-xs text-slate-400">Fast Agents Score</p>
                    </div>
                    <div>
                      <p className="text-lg font-bold text-orange-400">+{selectedDecision.slowBonus?.toFixed(1) || '0'}</p>
                      <p className="text-xs text-slate-400">Slow Agents Bonus</p>
                    </div>
                  </div>
                )}
                
                {/* Confidence Bar */}
                <div className="mt-4">
                  <div className="h-4 bg-slate-700 rounded-full overflow-hidden relative">
                    <div 
                      className={`h-full ${selectedDecision.totalConfidence >= selectedDecision.threshold ? 'bg-gradient-to-r from-green-500 to-emerald-400' : 'bg-gradient-to-r from-yellow-500 to-orange-400'}`}
                      style={{ width: `${Math.min(selectedDecision.totalConfidence, 100)}%` }}
                    />
                    <div 
                      className="absolute top-0 bottom-0 w-1 bg-white shadow-lg"
                      style={{ left: `${selectedDecision.threshold}%` }}
                    />
                  </div>
                  <div className="flex justify-between mt-1 text-xs text-slate-500">
                    <span>0%</span>
                    <span className="text-white">Threshold: {selectedDecision.threshold}%</span>
                    <span>100%</span>
                  </div>
                </div>
              </div>

              {/* Agent Scores */}
              <div>
                <h4 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
                  <Zap className="w-4 h-4 text-yellow-400" />
                  Agent Votes & Contributions
                </h4>
                <div className="grid grid-cols-2 gap-3">
                  {Object.entries(selectedDecision.agentScores || {}).map(([agentName, agentScore]) => {
                    const contribution = getAgentContribution(agentScore as AgentScore);
                    return (
                      <div 
                        key={agentName}
                        className="bg-slate-800/50 rounded-lg p-3 border border-slate-700/50"
                      >
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-sm font-medium text-white">{agentName}</span>
                          {getSignalBadge((agentScore as AgentScore).signal)}
                        </div>
                        <div className="grid grid-cols-4 gap-2 text-center">
                          <div>
                            <p className="text-lg font-bold text-white">{(agentScore as AgentScore).score.toFixed(1)}</p>
                            <p className="text-xs text-slate-500">Score</p>
                          </div>
                          <div>
                            <p className="text-lg font-bold text-slate-400">{((agentScore as AgentScore).weight * 100).toFixed(0)}%</p>
                            <p className="text-xs text-slate-500">Weight</p>
                          </div>
                          <div>
                            <p className="text-lg font-bold text-cyan-400">{contribution.toFixed(1)}</p>
                            <p className="text-xs text-slate-500">Contrib</p>
                          </div>
                          <div>
                            <p className="text-lg font-bold text-purple-400">{(agentScore as AgentScore).confidence.toFixed(1)}%</p>
                            <p className="text-xs text-slate-500">Conf</p>
                          </div>
                        </div>
                        {(agentScore as AgentScore).reasoning && (
                          <p className="text-xs text-slate-400 mt-2 bg-slate-900/50 rounded p-2">
                            {(agentScore as AgentScore).reasoning}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Trade Results */}
              {(selectedDecision.entryPrice || selectedDecision.pnl !== null) && (
                <div className="bg-slate-800/50 rounded-lg p-4">
                  <h4 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
                    <DollarSign className="w-4 h-4 text-green-400" />
                    Trade Results
                  </h4>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    {selectedDecision.entryPrice && (
                      <div>
                        <p className="text-xs text-slate-400">Entry Price</p>
                        <p className="text-lg font-bold text-white">${selectedDecision.entryPrice.toLocaleString()}</p>
                      </div>
                    )}
                    {selectedDecision.exitPrice && (
                      <div>
                        <p className="text-xs text-slate-400">Exit Price</p>
                        <p className="text-lg font-bold text-white">${selectedDecision.exitPrice.toLocaleString()}</p>
                      </div>
                    )}
                    {selectedDecision.pnl !== null && (
                      <div>
                        <p className="text-xs text-slate-400">P&L</p>
                        <p className={`text-lg font-bold ${selectedDecision.pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                          {selectedDecision.pnl >= 0 ? '+' : ''}${selectedDecision.pnl.toFixed(2)}
                        </p>
                      </div>
                    )}
                    {selectedDecision.holdDuration && (
                      <div>
                        <p className="text-xs text-slate-400">Hold Duration</p>
                        <p className="text-lg font-bold text-white">{formatDuration(selectedDecision.holdDuration)}</p>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Decision Reason */}
              {selectedDecision.decisionReason && (
                <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-4">
                  <h4 className="text-sm font-semibold text-yellow-400 mb-2 flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4" />
                    Decision Reason
                  </h4>
                  <p className="text-sm text-white">{selectedDecision.decisionReason}</p>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
