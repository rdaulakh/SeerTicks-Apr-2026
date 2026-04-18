/**
 * System Health - Unified Health Monitoring Dashboard
 * 
 * Combines all system health monitoring into one autonomous view:
 * - Overall system status
 * - Service health monitoring
 * - Latency metrics
 * - Agent health
 * - Connection health (WebSocket, price feed, circuit breakers)
 * - System Logs (real-time)
 * 
 * Autonomous principle: Monitor everything, intervene never
 */

import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { 
  Loader2, CheckCircle2, XCircle, AlertCircle, Clock, RefreshCw,
  Activity, Wifi, WifiOff, TrendingUp, TrendingDown, Zap, Info,
  Heart, Server, Database, Globe, ScrollText, Search, Filter,
  ArrowDown, Pause, Play, AlertTriangle, Terminal, MemoryStick
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { LineChart, Line, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer, Legend } from "recharts";
import CountUp from "react-countup";

type HealthStatus = "healthy" | "degraded" | "down" | "unknown";

const statusConfig: Record<HealthStatus, { icon: any; color: string; bgColor: string; label: string }> = {
  healthy: { icon: CheckCircle2, color: "text-green-500", bgColor: "bg-green-500/10", label: "Healthy" },
  degraded: { icon: AlertCircle, color: "text-yellow-500", bgColor: "bg-yellow-500/10", label: "Degraded" },
  down: { icon: XCircle, color: "text-red-500", bgColor: "bg-red-500/10", label: "Down" },
  unknown: { icon: Clock, color: "text-gray-400", bgColor: "bg-gray-500/10", label: "Unknown" },
};

// Format uptime to human-readable
function formatUptimeDisplay(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    return `${days}d ${hours % 24}h ${minutes % 60}m`;
  } else if (hours > 0) {
    return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  } else {
    return `${seconds}s`;
  }
}

// Live uptime ticker component
function LiveUptime({ startTimeMs }: { startTimeMs: number }) {
  const [now, setNow] = useState(Date.now());
  
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);
  
  const uptimeMs = now - startTimeMs;
  return <span className="font-mono">{formatUptimeDisplay(uptimeMs)}</span>;
}

const calculateTrend = (current: number, previous: number | undefined): { direction: 'up' | 'down' | 'stable', percent: number } => {
  if (!previous || previous === 0) return { direction: 'stable', percent: 0 };
  const change = ((current - previous) / previous) * 100;
  if (Math.abs(change) < 1) return { direction: 'stable', percent: 0 };
  return {
    direction: change > 0 ? 'up' : 'down',
    percent: Math.abs(change)
  };
};

// Log level colors
const logLevelConfig = {
  info: { color: 'text-blue-400', bg: 'bg-blue-500/10', border: 'border-blue-500/20', icon: Info },
  warn: { color: 'text-yellow-400', bg: 'bg-yellow-500/10', border: 'border-yellow-500/20', icon: AlertTriangle },
  error: { color: 'text-red-400', bg: 'bg-red-500/10', border: 'border-red-500/20', icon: XCircle },
  debug: { color: 'text-gray-400', bg: 'bg-gray-500/10', border: 'border-gray-500/20', icon: Terminal },
};

// Category badge colors
const categoryColors: Record<string, string> = {
  trading: 'bg-green-500/20 text-green-400',
  websocket: 'bg-blue-500/20 text-blue-400',
  agents: 'bg-purple-500/20 text-purple-400',
  engine: 'bg-indigo-500/20 text-indigo-400',
  market_data: 'bg-cyan-500/20 text-cyan-400',
  health: 'bg-pink-500/20 text-pink-400',
  system: 'bg-orange-500/20 text-orange-400',
  database: 'bg-teal-500/20 text-teal-400',
  error: 'bg-red-500/20 text-red-400',
  auth: 'bg-amber-500/20 text-amber-400',
  api: 'bg-sky-500/20 text-sky-400',
  general: 'bg-gray-500/20 text-gray-400',
};

export default function SystemHealth() {
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());
  const [prevMetrics, setPrevMetrics] = useState<any>(null);

  // Service Health Queries
  const { data: serviceHealth, isLoading: servicesLoading, refetch: refetchServices } = trpc.health.getServiceHealth.useQuery();
  const { data: latestStartup, isLoading: startupLoading, refetch: refetchStartup } = trpc.health.getLatestStartup.useQuery();
  
  // Health Metrics Queries
  const { data: healthMetrics, isLoading: healthLoading, refetch: refetchHealth } = trpc.seerMulti.getHealthMetrics.useQuery(
    undefined,
    { refetchInterval: 5000, refetchIntervalInBackground: true }
  );

  // Process Uptime — the REAL uptime from Node.js process.uptime()
  const { data: processUptime } = trpc.health.getProcessUptime.useQuery(
    undefined,
    { refetchInterval: 10000, refetchIntervalInBackground: true }
  );

  // Agent Health
  const { data: agentHealth, isLoading: agentsLoading, refetch: refetchAgents } = trpc.seerMulti.getAgentHealthDetails.useQuery(
    undefined,
    { refetchInterval: 5000, refetchIntervalInBackground: true }
  );

  // Latency Metrics
  const { data: latencyMetrics, refetch: refetchLatency } = trpc.seerMulti.getLatencyMetrics.useQuery(
    undefined,
    { refetchInterval: 2000 }
  );

  // Historical data for charts
  const { data: history24h, isLoading: historyLoading } = trpc.seerMulti.getHealthMetricsHistory.useQuery(
    { hours: 24 },
    { refetchInterval: 30000, refetchIntervalInBackground: true }
  );

  // Health check mutation
  const runHealthCheck = trpc.health.runHealthCheck.useMutation({
    onSuccess: () => {
      refetchServices();
      refetchStartup();
      refetchHealth();
      refetchAgents();
      refetchLatency();
    },
  });

  // Auto-run health check on page mount to get fresh status
  const hasAutoChecked = useRef(false);
  useEffect(() => {
    if (!hasAutoChecked.current) {
      hasAutoChecked.current = true;
      // Small delay to let queries settle first
      const timer = setTimeout(() => {
        runHealthCheck.mutate();
      }, 1500);
      return () => clearTimeout(timer);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Update lastUpdate when metrics change
  useEffect(() => {
    if (healthMetrics) {
      setLastUpdate(new Date());
      setPrevMetrics(healthMetrics);
    }
  }, [healthMetrics]);

  const isLoading = servicesLoading || startupLoading || healthLoading;
  const hasNoServices = !serviceHealth?.services || serviceHealth.services.length === 0;

  // Calculate overall status from LIVE data — not stale DB records
  const getOverallStatus = (): HealthStatus => {
    // Priority 1: If we have live process uptime and health metrics, system is running
    const hasLiveUptime = processUptime && processUptime.uptimeMs > 0;
    const hasLiveMetrics = healthMetrics && healthMetrics.signals;
    const hasLiveAgents = agentHealth && Array.isArray(agentHealth) && agentHealth.length > 0;
    
    // If live data confirms system is running, check for degradation
    if (hasLiveUptime && hasLiveMetrics) {
      // Check if any critical service is actually down from fresh health check
      if (serviceHealth?.services && serviceHealth.services.length > 0) {
        const hasDown = serviceHealth.services.some((s) => s.status === "down");
        if (hasDown) return "degraded"; // Some services down but system is running
      }
      return "healthy";
    }
    
    // Fallback to service health DB records
    if (!serviceHealth?.services || serviceHealth.services.length === 0) {
      return hasLiveUptime ? "healthy" : "unknown";
    }
    const hasDown = serviceHealth.services.some((s) => s.status === "down");
    const hasDegraded = serviceHealth.services.some((s) => s.status === "degraded");
    if (hasDown) return "down";
    if (hasDegraded) return "degraded";
    return "healthy";
  };

  const overallStatus = getOverallStatus();
  const OverallIcon = statusConfig[overallStatus].icon;

  const signalRateTrend = calculateTrend(healthMetrics?.signals?.ratePerMinute || 0, prevMetrics?.signals?.ratePerMinute);

  // Compute server start time from process uptime
  const serverStartTimeMs = useMemo(() => {
    if (processUptime?.uptimeMs) {
      return Date.now() - processUptime.uptimeMs;
    }
    return Date.now();
  }, [processUptime?.uptimeMs]);

  return (
    <TooltipProvider>
      <div className="min-h-screen bg-[#0a0a0f] p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-white flex items-center gap-3">
              <div className="p-2 rounded-xl bg-gradient-to-br from-red-500/20 to-pink-500/20 border border-red-500/20">
                <Heart className="w-7 h-7 text-red-400" />
              </div>
              System Health
            </h1>
            <p className="text-gray-400 mt-1">
              Autonomous monitoring - AI manages all systems
            </p>
          </div>
          <div className="flex items-center gap-3">
            {/* Live Indicator */}
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-green-500/10 border border-green-500/20">
              <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
              <span className="text-xs text-green-400 font-medium">LIVE</span>
            </div>
            {/* Process Uptime Badge */}
            {processUptime && (
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-blue-500/10 border border-blue-500/20">
                <Clock className="w-3.5 h-3.5 text-blue-400" />
                <span className="text-xs text-blue-400 font-medium">
                  <LiveUptime startTimeMs={serverStartTimeMs} />
                </span>
              </div>
            )}
            <Button 
              onClick={() => runHealthCheck.mutate()} 
              disabled={runHealthCheck.isPending || isLoading}
              variant="outline"
            >
              {runHealthCheck.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Checking...
                </>
              ) : (
                <>
                  <RefreshCw className="mr-2 h-4 w-4" />
                  Run Health Check
                </>
              )}
            </Button>
          </div>
        </div>

        {/* Overall Status Banner */}
        <Card className={statusConfig[overallStatus].bgColor}>
          <CardHeader>
            <CardTitle className="flex items-center gap-3">
              <OverallIcon className={`h-8 w-8 ${statusConfig[overallStatus].color}`} />
              <div>
                <div className="text-2xl">System Status: {statusConfig[overallStatus].label}</div>
                <div className="text-sm text-muted-foreground font-normal">
                  {runHealthCheck.isPending ? (
                    <span className="text-blue-400">Running health check...</span>
                  ) : latestStartup ? (
                    <>
                      Last checked {formatDistanceToNow(new Date(latestStartup.startedAt), { addSuffix: true })}
                      {latestStartup.canTrade ? (
                        <Badge variant="default" className="ml-2">Trading Enabled</Badge>
                      ) : (
                        <Badge variant="destructive" className="ml-2">Trading Disabled</Badge>
                      )}
                    </>
                  ) : (
                    "Health check running on page load..."
                  )}
                </div>
              </div>
            </CardTitle>
          </CardHeader>
          {latestStartup && (
            <CardContent>
              <div className="grid grid-cols-3 gap-4">
                <div className="text-center">
                  <div className="text-sm text-muted-foreground">Total Checks</div>
                  <div className="text-3xl font-bold">{latestStartup.totalChecks}</div>
                </div>
                <div className="text-center">
                  <div className="text-sm text-muted-foreground">Passed</div>
                  <div className="text-3xl font-bold text-green-500">{latestStartup.passedChecks}</div>
                </div>
                <div className="text-center">
                  <div className="text-sm text-muted-foreground">Failed</div>
                  <div className="text-3xl font-bold text-red-500">{latestStartup.failedChecks}</div>
                </div>
              </div>
            </CardContent>
          )}
        </Card>

        {/* Tabs for different health views */}
        <Tabs defaultValue="overview" className="w-full">
          <TabsList className="grid w-full grid-cols-7 mb-6">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="connection" className="flex items-center gap-1.5">
              <Wifi className="h-3.5 w-3.5" />
              Connection
            </TabsTrigger>
            <TabsTrigger value="services">Services</TabsTrigger>
            <TabsTrigger value="agents">Agents</TabsTrigger>
            <TabsTrigger value="latency">Latency</TabsTrigger>
            <TabsTrigger value="memory" className="flex items-center gap-1.5">
              <MemoryStick className="h-3.5 w-3.5" />
              Memory
            </TabsTrigger>
            <TabsTrigger value="logs" className="flex items-center gap-1.5">
              <ScrollText className="h-3.5 w-3.5" />
              Logs
            </TabsTrigger>
          </TabsList>

          {/* Overview Tab */}
          <TabsContent value="overview" className="space-y-6">
            {/* Key Metrics Grid */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              {/* Uptime — uses real process.uptime() */}
              <Card className="relative overflow-hidden">
                <CardContent className="p-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-muted-foreground">Server Uptime</p>
                      <p className="text-2xl font-bold text-green-400">
                        {processUptime ? (
                          <LiveUptime startTimeMs={serverStartTimeMs} />
                        ) : (
                          <Skeleton className="h-8 w-20" />
                        )}
                      </p>
                      {processUptime && (
                        <p className="text-xs text-muted-foreground mt-1">
                          PID {processUptime.pid} | {processUptime.memory.heapUsedMB}MB heap
                        </p>
                      )}
                    </div>
                    <Clock className="h-8 w-8 text-green-500/50" />
                  </div>
                </CardContent>
              </Card>

              {/* Signal Rate */}
              <Card className="relative overflow-hidden">
                <CardContent className="p-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-muted-foreground">Signal Rate</p>
                      <p className="text-2xl font-bold">
                        {healthMetrics?.signals?.ratePerMinute !== undefined ? (
                          <CountUp end={healthMetrics.signals.ratePerMinute} duration={1} decimals={1} suffix="/m" />
                        ) : (
                          <Skeleton className="h-8 w-20" />
                        )}
                      </p>
                    </div>
                    <Zap className="h-8 w-8 text-muted-foreground/50" />
                  </div>
                </CardContent>
              </Card>

              {/* Active Agents */}
              <Card className="relative overflow-hidden">
                <CardContent className="p-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-muted-foreground">Active Agents</p>
                      <p className="text-2xl font-bold">
                        {agentHealth ? (
                          <CountUp end={agentHealth.filter((a: any) => a.status === 'healthy' || a.isActive).length} duration={1} />
                        ) : (
                          <Skeleton className="h-8 w-20" />
                        )}
                      </p>
                    </div>
                    <Activity className="h-8 w-8 text-muted-foreground/50" />
                  </div>
                </CardContent>
              </Card>

              {/* WebSocket Status */}
              <Card className="relative overflow-hidden">
                <CardContent className="p-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-muted-foreground">WebSocket</p>
                      <p className="text-2xl font-bold flex items-center gap-2">
                        {healthMetrics?.websocket?.connected ? (
                          <>
                            <Wifi className="h-5 w-5 text-green-500" />
                            <span className="text-green-500">Connected</span>
                          </>
                        ) : (
                          <>
                            <WifiOff className="h-5 w-5 text-red-500" />
                            <span className="text-red-500">Disconnected</span>
                          </>
                        )}
                      </p>
                    </div>
                    <Globe className="h-8 w-8 text-muted-foreground/50" />
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Historical Chart */}
            {history24h && history24h.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>24-Hour Health Trend</CardTitle>
                  <CardDescription>Signal generation and system metrics over time</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={history24h}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                        <XAxis 
                          dataKey="timestamp" 
                          stroke="#666"
                          tickFormatter={(value) => new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        />
                        <YAxis stroke="#666" />
                        <RechartsTooltip 
                          contentStyle={{ backgroundColor: '#1a1a1a', border: '1px solid #333' }}
                        />
                        <Legend />
                        <Area 
                          type="monotone" 
                          dataKey="signalRate" 
                          stroke="#3b82f6" 
                          fill="#3b82f6" 
                          fillOpacity={0.2}
                          name="Signal Rate"
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* Connection Tab */}
          <TabsContent value="connection" className="space-y-6">
            <ConnectionHealthPanel />
          </TabsContent>

          {/* Services Tab */}
          <TabsContent value="services" className="space-y-6">
            {isLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : hasNoServices ? (
              <Card className="p-12 text-center">
                <Server className="w-16 h-16 mx-auto mb-4 text-muted-foreground opacity-50" />
                <h3 className="text-lg font-semibold mb-2">No Service Data</h3>
                <p className="text-muted-foreground mb-4">Run a health check to see service status</p>
                <Button onClick={() => runHealthCheck.mutate()}>
                  Run Health Check
                </Button>
              </Card>
            ) : (
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {serviceHealth!.services.map((service) => {
                  const StatusIcon = statusConfig[service.status].icon;
                  return (
                    <Card key={service.id} className={statusConfig[service.status].bgColor}>
                      <CardHeader>
                        <CardTitle className="flex items-center justify-between">
                          <span className="text-base capitalize">{service.serviceName.replace(/_/g, " ")}</span>
                          <StatusIcon className={`h-5 w-5 ${statusConfig[service.status].color}`} />
                        </CardTitle>
                        <CardDescription>
                          <Badge variant={service.status === "healthy" ? "default" : service.status === "degraded" ? "secondary" : "destructive"}>
                            {statusConfig[service.status].label}
                          </Badge>
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-2">
                        <div className="text-sm">
                          <span className="text-muted-foreground">Last Check:</span>
                          <span className="ml-2">{formatDistanceToNow(new Date(service.lastCheckAt), { addSuffix: true })}</span>
                        </div>
                        {service.consecutiveFailures > 0 && (
                          <div className="text-sm">
                            <span className="text-muted-foreground">Consecutive Failures:</span>
                            <span className="ml-2 text-destructive font-medium">{service.consecutiveFailures}</span>
                          </div>
                        )}
                        {service.errorMessage && (
                          <div className="mt-2 p-2 bg-destructive/10 border border-destructive/20 rounded text-xs">
                            <p className="text-destructive">{service.errorMessage}</p>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </TabsContent>

          {/* Agents Tab */}
          <TabsContent value="agents" className="space-y-6">
            {agentsLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : !agentHealth || agentHealth.length === 0 ? (
              <Card className="p-12 text-center">
                <Activity className="w-16 h-16 mx-auto mb-4 text-muted-foreground opacity-50" />
                <h3 className="text-lg font-semibold mb-2">No Agent Data</h3>
                <p className="text-muted-foreground">Start the engine to see agent health</p>
              </Card>
            ) : (
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {agentHealth.map((agent: any) => (
                  <Card key={agent.name} className={agent.isActive ? "bg-green-500/5" : "bg-gray-500/5"}>
                    <CardHeader>
                      <CardTitle className="flex items-center justify-between">
                        <span className="text-base">{agent.name}</span>
                        {agent.isActive ? (
                          <CheckCircle2 className="h-5 w-5 text-green-500" />
                        ) : (
                          <XCircle className="h-5 w-5 text-gray-400" />
                        )}
                      </CardTitle>
                      <CardDescription>
                        <Badge variant={agent.isActive ? "default" : "secondary"}>
                          {agent.isActive ? "Active" : "Inactive"}
                        </Badge>
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      <div className="grid grid-cols-2 gap-2 text-sm">
                        <div>
                          <span className="text-muted-foreground">Signals:</span>
                          <span className="ml-2 font-medium">{agent.signalCount || 0}</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Accuracy:</span>
                          <span className="ml-2 font-medium">{((agent.accuracy || 0) * 100).toFixed(1)}%</span>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>

          {/* Latency Tab */}
          <TabsContent value="latency" className="space-y-6">
            {!latencyMetrics ? (
              <Card className="p-12 text-center">
                <Clock className="w-16 h-16 mx-auto mb-4 text-muted-foreground opacity-50" />
                <h3 className="text-lg font-semibold mb-2">No Latency Data</h3>
                <p className="text-muted-foreground">Start the engine to see latency metrics</p>
              </Card>
            ) : (
              <>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  <Card>
                    <CardContent className="p-6">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm text-muted-foreground">Total Traces</p>
                          <p className="text-2xl font-bold">
                            <CountUp end={latencyMetrics.totalTraces || 0} duration={1} />
                          </p>
                        </div>
                        <Zap className="h-8 w-8 text-blue-500/50" />
                      </div>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardContent className="p-6">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm text-muted-foreground">Avg Latency</p>
                          <p className="text-2xl font-bold">
                            <CountUp end={latencyMetrics.avgTotalLatency || 0} duration={1} suffix="ms" />
                          </p>
                        </div>
                        <Activity className="h-8 w-8 text-purple-500/50" />
                      </div>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardContent className="p-6">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm text-muted-foreground">P95 Latency</p>
                          <p className="text-2xl font-bold">
                            <CountUp end={latencyMetrics.p95Latency || 0} duration={1} suffix="ms" />
                          </p>
                        </div>
                        <Globe className="h-8 w-8 text-green-500/50" />
                      </div>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardContent className="p-6">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm text-muted-foreground">P99 Latency</p>
                          <p className="text-2xl font-bold">
                            <CountUp end={latencyMetrics.p99Latency || 0} duration={1} suffix="ms" />
                          </p>
                        </div>
                        <Clock className="h-8 w-8 text-orange-500/50" />
                      </div>
                    </CardContent>
                  </Card>
                </div>

                {/* Latency Breakdown */}
                <Card>
                  <CardHeader>
                    <CardTitle>Latency Pipeline</CardTitle>
                    <CardDescription>End-to-end latency breakdown for trade execution</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-center justify-between gap-2">
                      {[
                        { label: "P50", value: latencyMetrics.p50Latency, color: "bg-blue-500" },
                        { label: "P95", value: latencyMetrics.p95Latency, color: "bg-purple-500" },
                        { label: "P99", value: latencyMetrics.p99Latency, color: "bg-indigo-500" },
                        { label: "Avg", value: latencyMetrics.avgTotalLatency, color: "bg-green-500" },
                        { label: "Active", value: latencyMetrics.activeTraces, color: "bg-yellow-500" },
                      ].map((stage) => (
                        <div key={stage.label} className="flex-1">
                          <div className="text-center mb-2">
                            <div className="text-xs text-muted-foreground">{stage.label}</div>
                            <div className="text-sm font-medium">{stage.value || 0}ms</div>
                          </div>
                          <div className={`h-2 rounded ${stage.color}`} />
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </>
            )}
          </TabsContent>

          {/* Memory Tab */}
          <TabsContent value="memory" className="space-y-4">
            <MemoryDashboardPanel />
          </TabsContent>

          {/* Logs Tab */}
          <TabsContent value="logs" className="space-y-4">
            <SystemLogsPanel />
          </TabsContent>
        </Tabs>
      </div>
    </TooltipProvider>
  );
}

// ==========================================
// System Logs Panel Component
// ==========================================
function SystemLogsPanel() {
  const [levelFilter, setLevelFilter] = useState<string>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [searchText, setSearchText] = useState('');
  const [autoScroll, setAutoScroll] = useState(true);
  const [lastSeenId, setLastSeenId] = useState(0);
  const logContainerRef = useRef<HTMLDivElement>(null);

  // Fetch logs with polling
  const { data: logsData, isLoading: logsLoading } = trpc.health.getServerLogs.useQuery(
    {
      limit: 300,
      level: levelFilter !== 'all' ? levelFilter as any : undefined,
      category: categoryFilter !== 'all' ? categoryFilter : undefined,
      search: searchText || undefined,
    },
    { refetchInterval: 2000, refetchIntervalInBackground: true }
  );

  // Fetch log stats
  const { data: logStats } = trpc.health.getLogStats.useQuery(
    undefined,
    { refetchInterval: 5000 }
  );

  // Fetch categories
  const { data: categories } = trpc.health.getLogCategories.useQuery(
    undefined,
    { refetchInterval: 30000 }
  );

  // Process errors
  const { data: processErrors } = trpc.health.getProcessErrors.useQuery(
    undefined,
    { refetchInterval: 10000 }
  );

  // Auto-scroll to bottom when new logs arrive
  useEffect(() => {
    if (autoScroll && logContainerRef.current && logsData?.logs) {
      const container = logContainerRef.current;
      container.scrollTop = container.scrollHeight;
    }
  }, [logsData?.logs, autoScroll]);

  // Handle scroll — disable auto-scroll if user scrolls up
  const handleScroll = useCallback(() => {
    if (!logContainerRef.current) return;
    const container = logContainerRef.current;
    const isAtBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 50;
    if (!isAtBottom && autoScroll) {
      setAutoScroll(false);
    }
  }, [autoScroll]);

  const logs = logsData?.logs || [];

  return (
    <div className="space-y-4">
      {/* Log Stats Bar */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Card className="bg-blue-500/5 border-blue-500/20">
          <CardContent className="p-3 flex items-center gap-3">
            <ScrollText className="h-5 w-5 text-blue-400" />
            <div>
              <p className="text-xs text-muted-foreground">Total Entries</p>
              <p className="text-lg font-bold text-blue-400">{logStats?.totalEntries || 0}</p>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-red-500/5 border-red-500/20">
          <CardContent className="p-3 flex items-center gap-3">
            <XCircle className="h-5 w-5 text-red-400" />
            <div>
              <p className="text-xs text-muted-foreground">Errors (5m)</p>
              <p className="text-lg font-bold text-red-400">{logStats?.errorsLast5Min || 0}</p>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-yellow-500/5 border-yellow-500/20">
          <CardContent className="p-3 flex items-center gap-3">
            <AlertTriangle className="h-5 w-5 text-yellow-400" />
            <div>
              <p className="text-xs text-muted-foreground">Warnings (5m)</p>
              <p className="text-lg font-bold text-yellow-400">{logStats?.warningsLast5Min || 0}</p>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-orange-500/5 border-orange-500/20">
          <CardContent className="p-3 flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-orange-400" />
            <div>
              <p className="text-xs text-muted-foreground">Process Errors</p>
              <p className="text-lg font-bold text-orange-400">{processErrors?.totalErrors || 0}</p>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-green-500/5 border-green-500/20">
          <CardContent className="p-3 flex items-center gap-3">
            <CheckCircle2 className="h-5 w-5 text-green-400" />
            <div>
              <p className="text-xs text-muted-foreground">Categories</p>
              <p className="text-lg font-bold text-green-400">{categories?.length || 0}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap items-center gap-3">
            {/* Search */}
            <div className="flex-1 min-w-[200px]">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search logs..."
                  value={searchText}
                  onChange={(e) => setSearchText(e.target.value)}
                  className="pl-9 bg-[#0a0a0f] border-gray-700"
                />
              </div>
            </div>

            {/* Level Filter */}
            <Select value={levelFilter} onValueChange={setLevelFilter}>
              <SelectTrigger className="w-[130px] bg-[#0a0a0f] border-gray-700">
                <SelectValue placeholder="Level" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Levels</SelectItem>
                <SelectItem value="error">Error</SelectItem>
                <SelectItem value="warn">Warning</SelectItem>
                <SelectItem value="info">Info</SelectItem>
                <SelectItem value="debug">Debug</SelectItem>
              </SelectContent>
            </Select>

            {/* Category Filter */}
            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger className="w-[160px] bg-[#0a0a0f] border-gray-700">
                <SelectValue placeholder="Category" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Categories</SelectItem>
                {(categories || []).map((cat) => (
                  <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Auto-scroll toggle */}
            <Button
              variant={autoScroll ? "default" : "outline"}
              size="sm"
              onClick={() => {
                setAutoScroll(!autoScroll);
                if (!autoScroll && logContainerRef.current) {
                  logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
                }
              }}
              className="gap-1.5"
            >
              {autoScroll ? <ArrowDown className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
              {autoScroll ? 'Following' : 'Paused'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Log Entries */}
      <Card className="overflow-hidden">
        <div
          ref={logContainerRef}
          onScroll={handleScroll}
          className="h-[600px] overflow-y-auto font-mono text-xs bg-[#050508]"
        >
          {logsLoading ? (
            <div className="flex items-center justify-center h-full">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : logs.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
              <ScrollText className="h-12 w-12 mb-3 opacity-30" />
              <p>No logs matching filters</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-800/50">
              {logs.map((log: any) => {
                const levelConf = logLevelConfig[log.level as keyof typeof logLevelConfig] || logLevelConfig.info;
                const LevelIcon = levelConf.icon;
                const catColor = categoryColors[log.category] || categoryColors.general;
                
                return (
                  <div
                    key={log.id}
                    className={`flex items-start gap-2 px-4 py-1.5 hover:bg-white/[0.02] ${
                      log.level === 'error' ? 'bg-red-500/[0.03]' : 
                      log.level === 'warn' ? 'bg-yellow-500/[0.02]' : ''
                    }`}
                  >
                    {/* Timestamp */}
                    <span className="text-gray-500 whitespace-nowrap shrink-0 pt-0.5">
                      {new Date(log.timestamp).toLocaleTimeString('en-IN', { 
                        hour: '2-digit', minute: '2-digit', second: '2-digit',
                        hour12: false, timeZone: 'Asia/Kolkata'
                      })}
                    </span>
                    
                    {/* Level */}
                    <span className={`${levelConf.color} uppercase font-semibold w-[42px] shrink-0 pt-0.5`}>
                      {log.level === 'warn' ? 'WARN' : log.level.toUpperCase().slice(0, 4)}
                    </span>
                    
                    {/* Category Badge */}
                    <span className={`${catColor} text-[10px] px-1.5 py-0.5 rounded shrink-0`}>
                      {log.category}
                    </span>
                    
                    {/* Message */}
                    <span className={`text-gray-300 break-all ${log.level === 'error' ? 'text-red-300' : ''}`}>
                      {log.message}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        
        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-2 bg-[#0a0a0f] border-t border-gray-800">
          <span className="text-xs text-muted-foreground">
            Showing {logs.length} of {logsData?.totalCount || 0} entries
          </span>
          <div className="flex items-center gap-2">
            {autoScroll && (
              <div className="flex items-center gap-1.5">
                <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                <span className="text-xs text-green-400">Live</span>
              </div>
            )}
          </div>
        </div>
      </Card>
    </div>
  );
}

// ==========================================
// Connection Health Panel Component
// ==========================================
function ConnectionHealthPanel() {
  // Price Feed Health — Coinbase WS + Binance REST fallback
  const { data: priceFeedHealth, isLoading: pfLoading } = trpc.health.getPriceFeedHealth.useQuery(
    undefined,
    { refetchInterval: 5000, refetchIntervalInBackground: true }
  );

  // Circuit Breaker Status — LLM and exchange circuit breakers
  const { data: circuitBreakers, isLoading: cbLoading } = trpc.health.getCircuitBreakerStatus.useQuery(
    undefined,
    { refetchInterval: 10000, refetchIntervalInBackground: true }
  );

  // Rate Limit Status
  const { data: rateLimitStatus, isLoading: rlLoading } = trpc.health.getRateLimitStatus.useQuery(
    undefined,
    { refetchInterval: 5000, refetchIntervalInBackground: true }
  );

  // LLM Circuit Breaker Stats
  const { data: llmCircuitBreaker } = trpc.health.getLLMCircuitBreakerStats.useQuery(
    undefined,
    { refetchInterval: 10000, refetchIntervalInBackground: true }
  );

  // Candle Cache Status
  const { data: candleCache } = trpc.health.getCandleCacheStatus.useQuery(
    undefined,
    { refetchInterval: 15000, refetchIntervalInBackground: true }
  );

  // Engine status for uptime
  const { data: engineStatus } = trpc.seerMulti.getStatus.useQuery(
    undefined,
    { refetchInterval: 5000, refetchIntervalInBackground: true }
  );

  const isLoading = pfLoading || cbLoading || rlLoading;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Determine overall connection health
  const primaryConnected = priceFeedHealth?.primary?.status === 'healthy';
  const fallbackActive = priceFeedHealth?.fallback?.isActive;
  const overallFeedStatus = priceFeedHealth?.overallStatus || 'critical';

  return (
    <div className="space-y-6">
      {/* Connection Status Header */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {/* Server Engine */}
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wider">Server Engine</p>
                <div className="flex items-center gap-2 mt-2">
                  <div className={`w-2.5 h-2.5 rounded-full ${engineStatus?.isRunning ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`} />
                  <span className={`text-lg font-bold ${engineStatus?.isRunning ? 'text-green-400' : 'text-red-400'}`}>
                    {engineStatus?.isRunning ? 'Running' : 'Stopped'}
                  </span>
                </div>
                {engineStatus?.startedAt && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Since {formatDistanceToNow(new Date(engineStatus.startedAt), { addSuffix: true })}
                  </p>
                )}
              </div>
              <Server className="h-8 w-8 text-green-500/30" />
            </div>
          </CardContent>
        </Card>

        {/* Price Feed */}
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wider">Price Feed</p>
                <div className="flex items-center gap-2 mt-2">
                  <div className={`w-2.5 h-2.5 rounded-full ${
                    overallFeedStatus === 'healthy' ? 'bg-green-500 animate-pulse' :
                    overallFeedStatus === 'degraded' ? 'bg-yellow-500 animate-pulse' : 'bg-red-500'
                  }`} />
                  <span className={`text-lg font-bold ${
                    overallFeedStatus === 'healthy' ? 'text-green-400' :
                    overallFeedStatus === 'degraded' ? 'text-yellow-400' : 'text-red-400'
                  }`}>
                    {overallFeedStatus === 'healthy' ? 'Healthy' :
                     overallFeedStatus === 'degraded' ? 'Degraded' : 'Critical'}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {priceFeedHealth?.priceFeed?.priceCount || 0} symbols tracked
                </p>
              </div>
              <Activity className="h-8 w-8 text-blue-500/30" />
            </div>
          </CardContent>
        </Card>

        {/* WebSocket Connection */}
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wider">Coinbase WS</p>
                <div className="flex items-center gap-2 mt-2">
                  {primaryConnected ? (
                    <>
                      <Wifi className="h-4 w-4 text-green-500" />
                      <span className="text-lg font-bold text-green-400">Connected</span>
                    </>
                  ) : (
                    <>
                      <WifiOff className="h-4 w-4 text-red-500" />
                      <span className="text-lg font-bold text-red-400">Disconnected</span>
                    </>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {priceFeedHealth?.primary?.messagesReceived?.toLocaleString() || 0} messages
                </p>
              </div>
              <Globe className="h-8 w-8 text-cyan-500/30" />
            </div>
          </CardContent>
        </Card>

        {/* Circuit Breakers */}
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wider">Circuit Breakers</p>
                <div className="flex items-center gap-2 mt-2">
                  {(() => {
                    const openBreakers = circuitBreakers?.breakers?.filter((b: any) => b.state === 'open')?.length || 0;
                    const halfOpen = circuitBreakers?.breakers?.filter((b: any) => b.state === 'half-open')?.length || 0;
                    if (openBreakers > 0) {
                      return (
                        <>
                          <AlertCircle className="h-4 w-4 text-red-500" />
                          <span className="text-lg font-bold text-red-400">{openBreakers} Open</span>
                        </>
                      );
                    }
                    if (halfOpen > 0) {
                      return (
                        <>
                          <AlertCircle className="h-4 w-4 text-yellow-500" />
                          <span className="text-lg font-bold text-yellow-400">{halfOpen} Half-Open</span>
                        </>
                      );
                    }
                    return (
                      <>
                        <CheckCircle2 className="h-4 w-4 text-green-500" />
                        <span className="text-lg font-bold text-green-400">All Closed</span>
                      </>
                    );
                  })()}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {circuitBreakers?.breakers?.length || 0} monitored
                </p>
              </div>
              <Zap className="h-8 w-8 text-orange-500/30" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Price Feed Details */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="h-5 w-5 text-blue-400" />
            Price Feed Architecture
          </CardTitle>
          <CardDescription>{priceFeedHealth?.architecture || 'Loading...'}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Primary: Coinbase WebSocket */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Badge variant={primaryConnected ? 'default' : 'destructive'} className="text-xs">
                  PRIMARY
                </Badge>
                <span className="text-sm font-medium">{priceFeedHealth?.primary?.name}</span>
              </div>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Status</span>
                  <span className={
                    priceFeedHealth?.primary?.status === 'healthy' ? 'text-green-400' :
                    priceFeedHealth?.primary?.status === 'degraded' ? 'text-yellow-400' : 'text-red-400'
                  }>
                    {priceFeedHealth?.primary?.status || 'unknown'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Messages Received</span>
                  <span className="font-mono">{priceFeedHealth?.primary?.messagesReceived?.toLocaleString() || 0}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Last Message</span>
                  <span className="font-mono text-xs">{priceFeedHealth?.primary?.lastMessageTime || 'N/A'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Stale (seconds)</span>
                  <span className={`font-mono ${(priceFeedHealth?.primary?.staleSec || 0) > 30 ? 'text-red-400' : 'text-green-400'}`}>
                    {priceFeedHealth?.primary?.staleSec ?? 'N/A'}s
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Reconnect Attempts</span>
                  <span className="font-mono">{priceFeedHealth?.primary?.reconnectAttempts || 0}</span>
                </div>
              </div>
            </div>

            {/* Fallback: Binance REST */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Badge variant="secondary" className="text-xs">
                  FALLBACK
                </Badge>
                <span className="text-sm font-medium">{priceFeedHealth?.fallback?.name}</span>
              </div>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Status</span>
                  <span className={fallbackActive ? 'text-yellow-400' : 'text-gray-400'}>
                    {priceFeedHealth?.fallback?.status || 'standby'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Mode</span>
                  <span className="font-mono">{priceFeedHealth?.fallback?.mode || 'standby'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Total Polls</span>
                  <span className="font-mono">{priceFeedHealth?.fallback?.totalPolls?.toLocaleString() || 0}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Last Poll</span>
                  <span className="font-mono text-xs">{priceFeedHealth?.fallback?.lastPollTime || 'N/A'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Consecutive Errors</span>
                  <span className={`font-mono ${(priceFeedHealth?.fallback?.consecutiveErrors || 0) > 0 ? 'text-red-400' : 'text-green-400'}`}>
                    {priceFeedHealth?.fallback?.consecutiveErrors || 0}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Circuit Breakers Detail */}
      {circuitBreakers?.breakers && circuitBreakers.breakers.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Zap className="h-5 w-5 text-orange-400" />
              Circuit Breakers
            </CardTitle>
            <CardDescription>Protection against cascading failures in external services</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {circuitBreakers.breakers.map((breaker: any) => (
                <div
                  key={breaker.name}
                  className={`p-4 rounded-lg border ${
                    breaker.state === 'closed' ? 'border-green-500/20 bg-green-500/5' :
                    breaker.state === 'half-open' ? 'border-yellow-500/20 bg-yellow-500/5' :
                    'border-red-500/20 bg-red-500/5'
                  }`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium truncate">{breaker.name}</span>
                    <Badge variant={
                      breaker.state === 'closed' ? 'default' :
                      breaker.state === 'half-open' ? 'secondary' : 'destructive'
                    } className="text-xs capitalize">
                      {breaker.state}
                    </Badge>
                  </div>
                  <div className="space-y-1 text-xs text-muted-foreground">
                    <div className="flex justify-between">
                      <span>Failures</span>
                      <span className="font-mono">{breaker.failures || 0}/{breaker.threshold || 5}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Total Requests</span>
                      <span className="font-mono">{breaker.totalRequests?.toLocaleString() || 0}</span>
                    </div>
                    {breaker.lastFailure && (
                      <div className="flex justify-between">
                        <span>Last Failure</span>
                        <span className="font-mono">{formatDistanceToNow(new Date(breaker.lastFailure), { addSuffix: true })}</span>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* LLM Circuit Breaker */}
      {llmCircuitBreaker && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Heart className="h-5 w-5 text-purple-400" />
              LLM Service Health
            </CardTitle>
            <CardDescription>AI model availability and rate limiting</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="text-center p-3 rounded-lg bg-gray-900/50">
                <p className="text-xs text-muted-foreground">State</p>
                <p className={`text-lg font-bold mt-1 ${
                  (llmCircuitBreaker as any)?.state === 'closed' ? 'text-green-400' :
                  (llmCircuitBreaker as any)?.state === 'half-open' ? 'text-yellow-400' : 'text-red-400'
                }`}>
                  {(llmCircuitBreaker as any)?.state || 'unknown'}
                </p>
              </div>
              <div className="text-center p-3 rounded-lg bg-gray-900/50">
                <p className="text-xs text-muted-foreground">Success Rate</p>
                <p className="text-lg font-bold mt-1 text-blue-400">
                  {(llmCircuitBreaker as any)?.successRate != null
                    ? `${((llmCircuitBreaker as any).successRate * 100).toFixed(1)}%`
                    : 'N/A'}
                </p>
              </div>
              <div className="text-center p-3 rounded-lg bg-gray-900/50">
                <p className="text-xs text-muted-foreground">Total Calls</p>
                <p className="text-lg font-bold mt-1 text-white font-mono">
                  {(llmCircuitBreaker as any)?.totalCalls?.toLocaleString() || 0}
                </p>
              </div>
              <div className="text-center p-3 rounded-lg bg-gray-900/50">
                <p className="text-xs text-muted-foreground">Failures</p>
                <p className={`text-lg font-bold mt-1 font-mono ${
                  ((llmCircuitBreaker as any)?.failures || 0) > 0 ? 'text-red-400' : 'text-green-400'
                }`}>
                  {(llmCircuitBreaker as any)?.failures || 0}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Rate Limits */}
      {rateLimitStatus && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-yellow-400" />
              API Rate Limits
            </CardTitle>
            <CardDescription>Current rate limit usage across external APIs</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {Object.entries(rateLimitStatus as Record<string, any>).map(([service, data]) => {
                if (typeof data !== 'object' || !data) return null;
                const usage = data.used || 0;
                const limit = data.limit || 100;
                const percent = Math.min(100, (usage / limit) * 100);
                return (
                  <div key={service} className="space-y-1.5">
                    <div className="flex items-center justify-between text-sm">
                      <span className="capitalize font-medium">{service.replace(/_/g, ' ')}</span>
                      <span className="text-muted-foreground font-mono text-xs">
                        {usage}/{limit} ({percent.toFixed(0)}%)
                      </span>
                    </div>
                    <div className="h-2 rounded-full bg-gray-800 overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-500 ${
                          percent > 90 ? 'bg-red-500' :
                          percent > 70 ? 'bg-yellow-500' : 'bg-green-500'
                        }`}
                        style={{ width: `${percent}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Candle Cache Status */}
      {candleCache && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Database className="h-5 w-5 text-teal-400" />
              Candle Cache
            </CardTitle>
            <CardDescription>WebSocket candle data cache for technical analysis</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="text-center p-3 rounded-lg bg-gray-900/50">
                <p className="text-xs text-muted-foreground">Cached Symbols</p>
                <p className="text-lg font-bold mt-1 text-white font-mono">
                  {(candleCache as any)?.symbolCount || (candleCache as any)?.totalSymbols || 0}
                </p>
              </div>
              <div className="text-center p-3 rounded-lg bg-gray-900/50">
                <p className="text-xs text-muted-foreground">Total Candles</p>
                <p className="text-lg font-bold mt-1 text-white font-mono">
                  {((candleCache as any)?.totalCandles || 0).toLocaleString()}
                </p>
              </div>
              <div className="text-center p-3 rounded-lg bg-gray-900/50">
                <p className="text-xs text-muted-foreground">Timeframes</p>
                <p className="text-lg font-bold mt-1 text-white font-mono">
                  {(candleCache as any)?.timeframeCount || (candleCache as any)?.timeframes?.length || 0}
                </p>
              </div>
              <div className="text-center p-3 rounded-lg bg-gray-900/50">
                <p className="text-xs text-muted-foreground">Memory</p>
                <p className="text-lg font-bold mt-1 text-white font-mono">
                  {(candleCache as any)?.memoryUsageMB
                    ? `${(candleCache as any).memoryUsageMB.toFixed(1)}MB`
                    : 'N/A'}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Removed Services Info */}
      {priceFeedHealth?.removedServices && (
        <Card className="border-gray-800/50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-gray-500">
              <Info className="h-5 w-5" />
              Decommissioned Services
            </CardTitle>
            <CardDescription>Previously used services that have been removed</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {Object.entries(priceFeedHealth.removedServices).map(([name, data]: [string, any]) => (
                <div key={name} className="p-3 rounded-lg bg-gray-900/30 border border-gray-800/30">
                  <div className="flex items-center gap-2 mb-1">
                    <XCircle className="h-3.5 w-3.5 text-gray-500" />
                    <span className="text-sm font-medium text-gray-400 capitalize">{name}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">{data.reason}</p>
                  {data.monthlySavings && (
                    <p className="text-xs text-green-500/60 mt-1">Savings: {data.monthlySavings}/mo</p>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}


// ==========================================
// Memory Dashboard Panel Component
// ==========================================
function MemoryDashboardPanel() {
  const memStatus = trpc.health.getMemoryStatus.useQuery(undefined, {
    refetchInterval: 10_000, // Refresh every 10s
  });
  const memHistory = trpc.health.getMemoryHistory.useQuery({ minutes: 60 }, {
    refetchInterval: 30_000, // Refresh every 30s
  });

  const status = memStatus.data;
  const history = memHistory.data;

  // Format timestamp for chart
  const formatTime = (ts: number) => {
    const d = new Date(ts);
    return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
  };

  // Determine status color based on usage percent
  const getUsageColor = (pct: number) => {
    if (pct >= 95) return 'text-red-500';
    if (pct >= 85) return 'text-orange-500';
    if (pct >= 70) return 'text-yellow-500';
    return 'text-green-500';
  };

  const getUsageBg = (pct: number) => {
    if (pct >= 95) return 'bg-red-500';
    if (pct >= 85) return 'bg-orange-500';
    if (pct >= 70) return 'bg-yellow-500';
    return 'bg-green-500';
  };

  const getStatusLabel = (pct: number) => {
    if (pct >= 95) return 'EMERGENCY';
    if (pct >= 85) return 'CRITICAL';
    if (pct >= 70) return 'WARNING';
    return 'HEALTHY';
  };

  if (memStatus.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  const chartData = (history?.history || []).map(h => ({
    time: formatTime(h.timestamp),
    rss: h.rssMB,
    heap: h.heapUsedMB,
    heapTotal: h.heapTotalMB,
    external: h.externalMB,
    limit: status?.limitMB || 1024,
    gc: h.gcTriggered ? h.rssMB : null,
  }));

  return (
    <div className="space-y-4">
      {/* Status Cards Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
        {/* RSS Usage */}
        <Card className="relative overflow-hidden">
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground mb-1">RSS Memory</div>
            <div className={`text-2xl font-bold font-mono ${getUsageColor(status?.usagePercent || 0)}`}>
              {status?.rssMB || 0}MB
            </div>
            <div className="text-xs text-muted-foreground">
              / {status?.limitMB || 0}MB ({status?.usagePercent || 0}%)
            </div>
            {/* Progress bar */}
            <div className="mt-2 h-1.5 bg-muted rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${getUsageBg(status?.usagePercent || 0)}`}
                style={{ width: `${Math.min(status?.usagePercent || 0, 100)}%` }}
              />
            </div>
          </CardContent>
        </Card>

        {/* Heap Used */}
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground mb-1">Heap Used</div>
            <div className="text-2xl font-bold font-mono text-blue-400">
              {status?.heapUsedMB || 0}MB
            </div>
            <div className="text-xs text-muted-foreground">
              / {status?.heapTotalMB || 0}MB total
            </div>
          </CardContent>
        </Card>

        {/* Growth */}
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground mb-1">Growth</div>
            <div className={`text-2xl font-bold font-mono ${(status?.growthMB || 0) > 100 ? 'text-yellow-500' : 'text-green-500'}`}>
              +{status?.growthMB || 0}MB
            </div>
            <div className="text-xs text-muted-foreground">since start</div>
          </CardContent>
        </Card>

        {/* Peak RSS */}
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground mb-1">Peak RSS</div>
            <div className="text-2xl font-bold font-mono text-purple-400">
              {status?.peakRSS || 0}MB
            </div>
            <div className="text-xs text-muted-foreground">all-time high</div>
          </CardContent>
        </Card>

        {/* GC Count */}
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground mb-1">GC Runs</div>
            <div className="text-2xl font-bold font-mono text-cyan-400">
              {status?.gcCount || 0}
            </div>
            <div className="text-xs text-muted-foreground">
              {status?.lastGCTime ? formatDistanceToNow(new Date(status.lastGCTime), { addSuffix: true }) : 'never'}
            </div>
          </CardContent>
        </Card>

        {/* Uptime */}
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground mb-1">Uptime</div>
            <div className="text-2xl font-bold font-mono text-emerald-400">
              {status?.uptimeMin || 0}m
            </div>
            <div className="text-xs text-muted-foreground">
              {status?.cleanupCount || 0} cleanups
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Status Banner */}
      <Card>
        <CardContent className="p-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Badge variant="outline" className={`${getUsageColor(status?.usagePercent || 0)} border-current`}>
                {getStatusLabel(status?.usagePercent || 0)}
              </Badge>
              <span className="text-sm text-muted-foreground">
                External: {status?.externalMB || 0}MB | ArrayBuffers: {status?.arrayBuffersMB || 0}MB | Clearables: {status?.registeredClearables || 0}
              </span>
            </div>
            <span className="text-xs text-muted-foreground">
              Staggered cleanup: Cache 7m | GC 11m | DB 13m
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Memory Timeline Chart */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Activity className="h-4 w-4" />
            Memory Timeline (Last 60 min)
          </CardTitle>
          <CardDescription>RSS, Heap Used, and Heap Total over time</CardDescription>
        </CardHeader>
        <CardContent>
          {chartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
              <AreaChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
                <XAxis
                  dataKey="time"
                  tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
                  interval="preserveStartEnd"
                />
                <YAxis
                  tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
                  domain={[0, status?.limitMB || 1024]}
                  label={{ value: 'MB', angle: -90, position: 'insideLeft', style: { fill: 'hsl(var(--muted-foreground))' } }}
                />
                <RechartsTooltip
                  contentStyle={{
                    backgroundColor: 'hsl(var(--card))',
                    border: '1px solid hsl(var(--border))',
                    borderRadius: '8px',
                    fontSize: '12px',
                  }}
                  labelStyle={{ color: 'hsl(var(--foreground))' }}
                />
                <Legend />
                {/* Limit line */}
                <Line
                  type="monotone"
                  dataKey="limit"
                  stroke="#ef4444"
                  strokeDasharray="5 5"
                  dot={false}
                  strokeWidth={1}
                  name="Limit"
                />
                {/* RSS area */}
                <Area
                  type="monotone"
                  dataKey="rss"
                  stroke="#f59e0b"
                  fill="#f59e0b"
                  fillOpacity={0.15}
                  strokeWidth={2}
                  name="RSS"
                />
                {/* Heap Total area */}
                <Area
                  type="monotone"
                  dataKey="heapTotal"
                  stroke="#6366f1"
                  fill="#6366f1"
                  fillOpacity={0.1}
                  strokeWidth={1.5}
                  name="Heap Total"
                />
                {/* Heap Used area */}
                <Area
                  type="monotone"
                  dataKey="heap"
                  stroke="#22d3ee"
                  fill="#22d3ee"
                  fillOpacity={0.2}
                  strokeWidth={2}
                  name="Heap Used"
                />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[300px] flex items-center justify-center text-muted-foreground">
              <div className="text-center">
                <MemoryStick className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p>Collecting memory data...</p>
                <p className="text-xs mt-1">History will appear after 1-2 minutes</p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Cleanup Events */}
      {history?.cleanupEvents && history.cleanupEvents.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <RefreshCw className="h-4 w-4" />
              Cleanup Events
            </CardTitle>
            <CardDescription>Recent memory cleanup operations</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 max-h-[200px] overflow-y-auto">
              {[...history.cleanupEvents].reverse().slice(0, 20).map((evt, i) => {
                const levelColors: Record<string, string> = {
                  periodic: 'bg-blue-500/10 text-blue-400',
                  warning: 'bg-yellow-500/10 text-yellow-400',
                  critical: 'bg-orange-500/10 text-orange-400',
                  emergency: 'bg-red-500/10 text-red-400',
                };
                return (
                  <div key={i} className="flex items-center justify-between py-1.5 px-3 rounded-md bg-muted/30">
                    <div className="flex items-center gap-3">
                      <Badge variant="outline" className={levelColors[evt.level] || ''}>
                        {evt.level.toUpperCase()}
                      </Badge>
                      <span className="text-xs text-muted-foreground font-mono">
                        {formatTime(evt.timestamp)}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-xs font-mono">
                      <span className="text-muted-foreground">{evt.beforeMB}MB</span>
                      <span className="text-muted-foreground">→</span>
                      <span className="text-muted-foreground">{evt.afterMB}MB</span>
                      <Badge variant={evt.freedMB > 0 ? 'default' : 'secondary'} className="text-xs">
                        {evt.freedMB > 0 ? `-${evt.freedMB}MB` : `+${Math.abs(evt.freedMB)}MB`}
                      </Badge>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Memory Breakdown */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Database className="h-4 w-4" />
            Memory Breakdown
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: 'RSS (Total)', value: status?.rssMB || 0, color: 'text-amber-400', desc: 'Total resident set size' },
              { label: 'Heap Used', value: status?.heapUsedMB || 0, color: 'text-cyan-400', desc: 'V8 heap in use' },
              { label: 'Heap Total', value: status?.heapTotalMB || 0, color: 'text-indigo-400', desc: 'V8 heap allocated' },
              { label: 'External', value: status?.externalMB || 0, color: 'text-pink-400', desc: 'C++ objects bound to JS' },
            ].map(item => (
              <div key={item.label} className="text-center p-3 rounded-lg bg-muted/30">
                <div className={`text-xl font-bold font-mono ${item.color}`}>{item.value}MB</div>
                <div className="text-xs font-medium mt-1">{item.label}</div>
                <div className="text-xs text-muted-foreground mt-0.5">{item.desc}</div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
