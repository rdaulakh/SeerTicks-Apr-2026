import { useState } from 'react';
import { trpc } from '@/lib/trpc';
import { useAuth } from '@/_core/hooks/useAuth';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { 
  Database, 
  Play, 
  Pause, 
  RefreshCw, 
  Download,
  Clock,
  CheckCircle,
  XCircle,
  AlertCircle,
  Loader2,
  Rocket,
  BarChart3,
  Calendar
} from 'lucide-react';

const TIMEFRAMES = ['1m', '5m', '15m', '1h', '4h', '1d'] as const;
const SYMBOLS = ['BTC-USD', 'ETH-USD', 'SOL-USD', 'AVAX-USD', 'LINK-USD', 'DOGE-USD'];

function getStatusIcon(status: string) {
  switch (status) {
    case 'running':
      return <Loader2 className="h-4 w-4 animate-spin text-blue-500" />;
    case 'completed':
      return <CheckCircle className="h-4 w-4 text-green-500" />;
    case 'failed':
      return <XCircle className="h-4 w-4 text-red-500" />;
    case 'paused':
      return <Pause className="h-4 w-4 text-yellow-500" />;
    case 'pending':
      return <Clock className="h-4 w-4 text-gray-500" />;
    default:
      return <AlertCircle className="h-4 w-4 text-gray-500" />;
  }
}

function getStatusBadge(status: string) {
  const variants: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
    running: 'default',
    completed: 'secondary',
    failed: 'destructive',
    paused: 'outline',
    pending: 'outline'
  };
  return (
    <Badge variant={variants[status] || 'outline'} className="capitalize">
      {status}
    </Badge>
  );
}

function formatDate(date: Date | string | null): string {
  if (!date) return 'N/A';
  return new Date(date).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  });
}

function formatNumber(num: number): string {
  if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
  if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
  return num.toString();
}

export default function DataIngestion() {
  const { user, loading: authLoading } = useAuth();
  const [selectedSymbol, setSelectedSymbol] = useState<string>('BTC-USD');
  const [selectedTimeframe, setSelectedTimeframe] = useState<string>('1h');
  const [yearsOfData, setYearsOfData] = useState<string>('2');

  // Queries
  const { data: stats, refetch: refetchStats } = trpc.dataIngestion.getStats.useQuery(undefined, {
    refetchInterval: 5000 // Refresh every 5 seconds
  });

  const { data: jobs, refetch: refetchJobs } = trpc.dataIngestion.getAllJobs.useQuery(undefined, {
    refetchInterval: 3000 // Refresh every 3 seconds
  });

  const { data: coverage, refetch: refetchCoverage } = trpc.dataIngestion.getDataCoverage.useQuery();

  // Mutations
  const quickStartMutation = trpc.dataIngestion.quickStart.useMutation({
    onSuccess: (data) => {
      toast.success(data.message);
      refetchJobs();
      refetchStats();
    },
    onError: (error) => {
      toast.error(`Failed to start: ${error.message}`);
    }
  });

  const createJobMutation = trpc.dataIngestion.createJob.useMutation({
    onSuccess: (data) => {
      toast.success(`Job created: ${data.jobId}`);
      refetchJobs();
    },
    onError: (error) => {
      toast.error(`Failed to create job: ${error.message}`);
    }
  });

  const startJobMutation = trpc.dataIngestion.startJob.useMutation({
    onSuccess: () => {
      toast.success('Job started');
      refetchJobs();
    },
    onError: (error) => {
      toast.error(`Failed to start job: ${error.message}`);
    }
  });

  const pauseJobMutation = trpc.dataIngestion.pauseJob.useMutation({
    onSuccess: () => {
      toast.success('Job paused');
      refetchJobs();
    },
    onError: (error) => {
      toast.error(`Failed to pause job: ${error.message}`);
    }
  });

  const bulkIngestionMutation = trpc.dataIngestion.startBulkIngestion.useMutation({
    onSuccess: (data) => {
      toast.success(data.message);
      refetchJobs();
      refetchStats();
    },
    onError: (error) => {
      toast.error(`Failed to start bulk ingestion: ${error.message}`);
    }
  });

  const handleQuickStart = () => {
    quickStartMutation.mutate();
  };

  const handleCreateJob = () => {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setFullYear(startDate.getFullYear() - parseFloat(yearsOfData));

    createJobMutation.mutate({
      symbol: selectedSymbol,
      timeframe: selectedTimeframe as any,
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString()
    });
  };

  const handleStartJob = (jobId: string) => {
    startJobMutation.mutate({ jobId });
  };

  const handlePauseJob = (jobId: string) => {
    pauseJobMutation.mutate({ jobId });
  };

  const handleRefresh = () => {
    refetchStats();
    refetchJobs();
    refetchCoverage();
    toast.success('Data refreshed');
  };

  if (authLoading) {
    return (
      <div className="min-h-screen bg-[#0a0a0f] p-3 sm:p-4 lg:p-6 space-y-4 lg:space-y-6">
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-[#0a0a0f] p-3 sm:p-4 lg:p-6 space-y-4 lg:space-y-6">
        <div className="flex items-center justify-center h-64">
          <p className="text-muted-foreground">Please sign in to access data ingestion.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0a0f] p-3 sm:p-4 lg:p-6 space-y-4 lg:space-y-6">
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Historical Data Ingestion</h1>
            <p className="text-muted-foreground">
              Fetch and manage historical OHLCV data from Coinbase
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={handleRefresh}>
              <RefreshCw className="h-4 w-4 mr-2" />
              Refresh
            </Button>
            <Button 
              onClick={handleQuickStart}
              disabled={quickStartMutation.isPending}
            >
              {quickStartMutation.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Rocket className="h-4 w-4 mr-2" />
              )}
              Quick Start (BTC + ETH)
            </Button>
          </div>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Total Candles
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2">
                <Database className="h-5 w-5 text-primary" />
                <span className="text-2xl font-bold">
                  {stats ? formatNumber(stats.totalCandles) : '0'}
                </span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Active Jobs
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2">
                <Play className="h-5 w-5 text-green-500" />
                <span className="text-2xl font-bold">
                  {stats?.runningJobs || 0}
                </span>
                <span className="text-sm text-muted-foreground">
                  / {stats?.totalJobs || 0} total
                </span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Symbols Covered
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2">
                <BarChart3 className="h-5 w-5 text-blue-500" />
                <span className="text-2xl font-bold">
                  {stats?.symbolsCovered || 0}
                </span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Data Range
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2">
                <Calendar className="h-5 w-5 text-purple-500" />
                <span className="text-sm">
                  {stats?.oldestData ? formatDate(stats.oldestData) : 'N/A'} - {stats?.newestData ? formatDate(stats.newestData) : 'N/A'}
                </span>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Main Content */}
        <Tabs defaultValue="jobs" className="space-y-4">
          <TabsList>
            <TabsTrigger value="jobs">Ingestion Jobs</TabsTrigger>
            <TabsTrigger value="coverage">Data Coverage</TabsTrigger>
            <TabsTrigger value="create">Create Job</TabsTrigger>
          </TabsList>

          {/* Jobs Tab */}
          <TabsContent value="jobs" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Active & Recent Jobs</CardTitle>
                <CardDescription>
                  Monitor and control data ingestion jobs
                </CardDescription>
              </CardHeader>
              <CardContent>
                {!jobs || jobs.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <Download className="h-12 w-12 mx-auto mb-4 opacity-50" />
                    <p>No ingestion jobs yet.</p>
                    <p className="text-sm">Click "Quick Start" to begin fetching historical data.</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {jobs.map((job) => (
                      <div 
                        key={job.id} 
                        className="flex items-center justify-between p-4 border rounded-lg"
                      >
                        <div className="flex items-center gap-4">
                          {getStatusIcon(job.status)}
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-medium">{job.symbol}</span>
                              <Badge variant="outline">{job.timeframe}</Badge>
                              {getStatusBadge(job.status)}
                            </div>
                            <div className="text-sm text-muted-foreground">
                              {formatDate(job.startDate)} → {formatDate(job.endDate)}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-4">
                          <div className="text-right">
                            <div className="text-sm font-medium">
                              {formatNumber(job.candlesIngested)} / {formatNumber(job.progress)}%
                            </div>
                            <Progress value={job.progress} className="w-32 h-2" />
                          </div>

                          <div className="flex gap-2">
                            {job.status === 'running' && (
                              <Button 
                                size="sm" 
                                variant="outline"
                                onClick={() => handlePauseJob(job.id)}
                                disabled={pauseJobMutation.isPending}
                              >
                                <Pause className="h-4 w-4" />
                              </Button>
                            )}
                            {(job.status === 'pending' || job.status === 'paused' || job.status === 'failed') && (
                              <Button 
                                size="sm" 
                                variant="outline"
                                onClick={() => handleStartJob(job.id)}
                                disabled={startJobMutation.isPending}
                              >
                                <Play className="h-4 w-4" />
                              </Button>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Coverage Tab */}
          <TabsContent value="coverage" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Data Coverage Summary</CardTitle>
                <CardDescription>
                  View available historical data by symbol and timeframe
                </CardDescription>
              </CardHeader>
              <CardContent>
                {!coverage || coverage.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <Database className="h-12 w-12 mx-auto mb-4 opacity-50" />
                    <p>No data coverage yet.</p>
                    <p className="text-sm">Start an ingestion job to populate historical data.</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b">
                          <th className="text-left py-2 px-4">Symbol</th>
                          <th className="text-left py-2 px-4">Timeframe</th>
                          <th className="text-left py-2 px-4">Earliest</th>
                          <th className="text-left py-2 px-4">Latest</th>
                          <th className="text-right py-2 px-4">Candles</th>
                          <th className="text-right py-2 px-4">Days</th>
                          <th className="text-right py-2 px-4">Gaps</th>
                        </tr>
                      </thead>
                      <tbody>
                        {coverage.map((c, idx) => (
                          <tr key={idx} className="border-b hover:bg-muted/50">
                            <td className="py-2 px-4 font-medium">{c.symbol}</td>
                            <td className="py-2 px-4">
                              <Badge variant="outline">{c.timeframe}</Badge>
                            </td>
                            <td className="py-2 px-4">{formatDate(c.earliestDate)}</td>
                            <td className="py-2 px-4">{formatDate(c.latestDate)}</td>
                            <td className="py-2 px-4 text-right">{formatNumber(c.totalCandles)}</td>
                            <td className="py-2 px-4 text-right">
                              {c.earliestDate && c.latestDate 
                                ? Math.ceil((new Date(c.latestDate).getTime() - new Date(c.earliestDate).getTime()) / (1000 * 60 * 60 * 24))
                                : 0}
                            </td>
                            <td className="py-2 px-4 text-right">
                              <Badge variant="secondary">-</Badge>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Create Job Tab */}
          <TabsContent value="create" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Create Ingestion Job</CardTitle>
                <CardDescription>
                  Configure and start a new data ingestion job
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label>Symbol</Label>
                    <Select value={selectedSymbol} onValueChange={setSelectedSymbol}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {SYMBOLS.map((symbol) => (
                          <SelectItem key={symbol} value={symbol}>
                            {symbol}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label>Timeframe</Label>
                    <Select value={selectedTimeframe} onValueChange={setSelectedTimeframe}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {TIMEFRAMES.map((tf) => (
                          <SelectItem key={tf} value={tf}>
                            {tf}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label>Years of Data</Label>
                    <Input 
                      type="number" 
                      min="0.5" 
                      max="5" 
                      step="0.5"
                      value={yearsOfData}
                      onChange={(e) => setYearsOfData(e.target.value)}
                    />
                  </div>
                </div>

                <div className="flex gap-2">
                  <Button 
                    onClick={handleCreateJob}
                    disabled={createJobMutation.isPending}
                  >
                    {createJobMutation.isPending ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Download className="h-4 w-4 mr-2" />
                    )}
                    Create Job
                  </Button>
                </div>

                <div className="pt-4 border-t">
                  <h4 className="font-medium mb-2">Bulk Ingestion</h4>
                  <p className="text-sm text-muted-foreground mb-4">
                    Start ingestion for multiple symbols and timeframes at once.
                  </p>
                  <Button 
                    variant="outline"
                    onClick={() => {
                      bulkIngestionMutation.mutate({
                        symbols: ['BTC-USD', 'ETH-USD'],
                        timeframes: ['1h', '4h', '1d'],
                        yearsOfData: 2
                      });
                    }}
                    disabled={bulkIngestionMutation.isPending}
                  >
                    {bulkIngestionMutation.isPending ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Rocket className="h-4 w-4 mr-2" />
                    )}
                    Start Bulk Ingestion (BTC + ETH, 1h/4h/1d)
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
