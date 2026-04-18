/**
 * Rate Limit Widget
 * Displays real-time API usage status for all external APIs
 * Shows healthy/warning/backoff indicators with visual feedback
 */

import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { 
  Activity, 
  AlertTriangle, 
  CheckCircle, 
  XCircle,
  Wifi,
  WifiOff,
  Clock,
  RefreshCw
} from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface APIStatus {
  name: string;
  requestsUsed: number;
  requestsMax: number;
  percentUsed: number;
  inBackoff: boolean;
  backoffRemainingSeconds: number;
  consecutiveErrors: number;
  status: 'ok' | 'warning' | 'error';
  lastError?: string;
}

// Compact version for dashboard header
export function RateLimitIndicator() {
  const { data, isLoading } = trpc.health.getRateLimitStatus.useQuery(undefined, {
    refetchInterval: 10000,
    staleTime: 5000,
  });

  if (isLoading || !data) {
    return (
      <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-gray-800/50 border border-gray-700/50">
        <RefreshCw className="w-3 h-3 text-gray-500 animate-spin" />
        <span className="text-xs text-gray-500">APIs</span>
      </div>
    );
  }

  const apis = Object.values(data.apis) as APIStatus[];
  const errorCount = apis.filter(a => a.status === 'error').length;
  const warningCount = apis.filter(a => a.status === 'warning').length;
  const healthyCount = apis.filter(a => a.status === 'ok').length;

  const overallStatus = errorCount > 0 ? 'error' : warningCount > 0 ? 'warning' : 'ok';

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className={cn(
          "flex items-center gap-1.5 px-2 py-1 rounded-lg border cursor-pointer transition-colors",
          overallStatus === 'ok' && "bg-green-500/10 border-green-500/30 hover:bg-green-500/20",
          overallStatus === 'warning' && "bg-yellow-500/10 border-yellow-500/30 hover:bg-yellow-500/20",
          overallStatus === 'error' && "bg-red-500/10 border-red-500/30 hover:bg-red-500/20"
        )}>
          {overallStatus === 'ok' && <Wifi className="w-3 h-3 text-green-400" />}
          {overallStatus === 'warning' && <AlertTriangle className="w-3 h-3 text-yellow-400" />}
          {overallStatus === 'error' && <WifiOff className="w-3 h-3 text-red-400" />}
          <span className={cn(
            "text-xs font-medium",
            overallStatus === 'ok' && "text-green-400",
            overallStatus === 'warning' && "text-yellow-400",
            overallStatus === 'error' && "text-red-400"
          )}>
            {healthyCount}/{apis.length}
          </span>
        </div>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="p-0 bg-gray-900 border-gray-700">
        <div className="p-3 min-w-[200px]">
          <div className="text-xs font-semibold text-gray-300 mb-2">External API Status</div>
          <div className="space-y-1.5">
            {apis.map((api) => (
              <div key={api.name} className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-1.5">
                  {api.status === 'ok' && <CheckCircle className="w-3 h-3 text-green-400" />}
                  {api.status === 'warning' && <AlertTriangle className="w-3 h-3 text-yellow-400" />}
                  {api.status === 'error' && <XCircle className="w-3 h-3 text-red-400" />}
                  <span className="text-xs text-gray-400">{api.name}</span>
                </div>
                <span className={cn(
                  "text-xs font-mono",
                  api.status === 'ok' && "text-green-400",
                  api.status === 'warning' && "text-yellow-400",
                  api.status === 'error' && "text-red-400"
                )}>
                  {api.inBackoff ? `${api.backoffRemainingSeconds}s` : `${api.requestsUsed}/${api.requestsMax}`}
                </span>
              </div>
            ))}
          </div>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

// Full widget for dashboard or health page
export function RateLimitWidget({ compact = false }: { compact?: boolean }) {
  const { data, isLoading, refetch } = trpc.health.getRateLimitStatus.useQuery(undefined, {
    refetchInterval: 10000,
    staleTime: 5000,
  });

  if (isLoading) {
    return (
      <div className={cn(
        "rounded-xl border border-gray-700/50 bg-gray-900/50 p-4",
        compact ? "p-3" : "p-4"
      )}>
        <div className="flex items-center gap-2 text-gray-500">
          <RefreshCw className="w-4 h-4 animate-spin" />
          <span className="text-sm">Loading API status...</span>
        </div>
      </div>
    );
  }

  if (!data) {
    return null;
  }

  const apis = Object.values(data.apis) as APIStatus[];
  const errorCount = apis.filter(a => a.status === 'error').length;
  const warningCount = apis.filter(a => a.status === 'warning').length;

  return (
    <div className={cn(
      "rounded-xl border border-gray-700/50 bg-gray-900/50",
      compact ? "p-3" : "p-4"
    )}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Activity className={cn("w-4 h-4", compact && "w-3.5 h-3.5")} />
          <h3 className={cn("font-semibold text-white", compact ? "text-sm" : "text-base")}>
            API Status
          </h3>
        </div>
        <div className="flex items-center gap-2">
          {errorCount > 0 && (
            <span className="text-xs px-1.5 py-0.5 rounded bg-red-500/20 text-red-400">
              {errorCount} error{errorCount > 1 ? 's' : ''}
            </span>
          )}
          {warningCount > 0 && (
            <span className="text-xs px-1.5 py-0.5 rounded bg-yellow-500/20 text-yellow-400">
              {warningCount} warning{warningCount > 1 ? 's' : ''}
            </span>
          )}
          {errorCount === 0 && warningCount === 0 && (
            <span className="text-xs px-1.5 py-0.5 rounded bg-green-500/20 text-green-400">
              All healthy
            </span>
          )}
        </div>
      </div>

      <div className={cn("grid gap-2", compact ? "grid-cols-2" : "grid-cols-2 md:grid-cols-3")}>
        {apis.map((api) => (
          <APIStatusCard key={api.name} api={api} compact={compact} />
        ))}
      </div>
    </div>
  );
}

function APIStatusCard({ api, compact }: { api: APIStatus; compact: boolean }) {
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'ok': return 'border-green-500/30 bg-green-500/5';
      case 'warning': return 'border-yellow-500/30 bg-yellow-500/5';
      case 'error': return 'border-red-500/30 bg-red-500/5';
      default: return 'border-gray-700/50';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'ok': return <CheckCircle className="w-3.5 h-3.5 text-green-400" />;
      case 'warning': return <AlertTriangle className="w-3.5 h-3.5 text-yellow-400" />;
      case 'error': return <XCircle className="w-3.5 h-3.5 text-red-400" />;
      default: return null;
    }
  };

  return (
    <div className={cn(
      "rounded-lg border p-2.5 transition-colors",
      getStatusColor(api.status)
    )}>
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-1.5">
          {getStatusIcon(api.status)}
          <span className="text-xs font-medium text-gray-300">{api.name}</span>
        </div>
      </div>
      
      {api.inBackoff ? (
        <div className="flex items-center gap-1 text-red-400">
          <Clock className="w-3 h-3" />
          <span className="text-xs font-mono">{api.backoffRemainingSeconds}s backoff</span>
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between text-xs mb-1">
            <span className="text-gray-500">Usage</span>
            <span className={cn(
              "font-mono",
              api.percentUsed > 80 ? "text-yellow-400" : "text-gray-400"
            )}>
              {api.requestsUsed}/{api.requestsMax}
            </span>
          </div>
          <div className="h-1 bg-gray-800 rounded-full overflow-hidden">
            <div 
              className={cn(
                "h-full transition-all duration-300",
                api.percentUsed > 80 ? "bg-yellow-500" : "bg-green-500"
              )}
              style={{ width: `${Math.min(api.percentUsed, 100)}%` }}
            />
          </div>
        </>
      )}
      
      {api.lastError && (
        <p className="text-[10px] text-red-400/70 mt-1 truncate" title={api.lastError}>
          {api.lastError}
        </p>
      )}
    </div>
  );
}

export default RateLimitWidget;
