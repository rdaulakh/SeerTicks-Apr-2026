import { useState } from "react";
import { trpc } from "@/lib/trpc";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

interface CreateStrategyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CreateStrategyDialog({ open, onOpenChange }: CreateStrategyDialogProps) {
  const [name, setName] = useState("");
  const [strategyType, setStrategyType] = useState<string>("");
  const [allocatedBalance, setAllocatedBalance] = useState("1000");
  const utils = trpc.useUtils();

  const createMutation = trpc.multiStrategy.create.useMutation({
    onSuccess: () => {
      toast.success("Strategy created successfully");
      utils.multiStrategy.getDashboard.invalidate();
      onOpenChange(false);
      resetForm();
    },
    onError: (error) => {
      toast.error(`Failed to create strategy: ${error.message}`);
    },
  });

  const resetForm = () => {
    setName("");
    setStrategyType("");
    setAllocatedBalance("1000");
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!name.trim()) {
      toast.error("Please enter a strategy name");
      return;
    }

    if (!strategyType) {
      toast.error("Please select a strategy type");
      return;
    }

    const balance = parseFloat(allocatedBalance);
    if (isNaN(balance) || balance <= 0) {
      toast.error("Please enter a valid balance");
      return;
    }

    // Create strategy with default config based on type
    const config = getDefaultConfig(strategyType);

    createMutation.mutate({
      name,
      strategyType,
      allocatedBalance: balance.toFixed(2),
      config,
    });
  };

  const getDefaultConfig = (type: string): Record<string, any> => {
    switch (type) {
      case "scalping":
        return {
          timeframe: "1m",
          maxPositionSize: 10, // % of allocated balance
          stopLoss: 0.5, // %
          takeProfit: 1.0, // %
          maxOpenPositions: 5,
        };
      case "swing_trading":
        return {
          timeframe: "1h",
          maxPositionSize: 20,
          stopLoss: 2.0,
          takeProfit: 5.0,
          maxOpenPositions: 3,
        };
      case "momentum":
        return {
          timeframe: "5m",
          maxPositionSize: 15,
          stopLoss: 1.0,
          takeProfit: 3.0,
          maxOpenPositions: 4,
          momentumThreshold: 0.02, // 2% price change
        };
      case "mean_reversion":
        return {
          timeframe: "15m",
          maxPositionSize: 15,
          stopLoss: 1.5,
          takeProfit: 2.5,
          maxOpenPositions: 3,
          deviationThreshold: 2.0, // Standard deviations
        };
      default:
        return {};
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Create New Strategy</DialogTitle>
            <DialogDescription>
              Configure a new trading strategy instance with dedicated balance allocation
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="name">Strategy Name</Label>
              <Input
                id="name"
                placeholder="e.g., BTC Scalping v1"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="strategyType">Strategy Type</Label>
              <Select value={strategyType} onValueChange={setStrategyType}>
                <SelectTrigger id="strategyType">
                  <SelectValue placeholder="Select strategy type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="scalping">Scalping</SelectItem>
                  <SelectItem value="swing_trading">Swing Trading</SelectItem>
                  <SelectItem value="momentum">Momentum</SelectItem>
                  <SelectItem value="mean_reversion">Mean Reversion</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="balance">Allocated Balance ($)</Label>
              <Input
                id="balance"
                type="number"
                step="0.01"
                min="0"
                placeholder="1000.00"
                value={allocatedBalance}
                onChange={(e) => setAllocatedBalance(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Amount of capital to allocate to this strategy
              </p>
            </div>

            {strategyType && (
              <div className="rounded-lg bg-muted p-3 space-y-1">
                <p className="text-sm font-medium">Default Configuration:</p>
                <ul className="text-xs text-muted-foreground space-y-0.5">
                  {Object.entries(getDefaultConfig(strategyType)).map(([key, value]) => (
                    <li key={key}>
                      • {key.replace(/([A-Z])/g, " $1").toLowerCase()}: {String(value)}
                    </li>
                  ))}
                </ul>
                <p className="text-xs text-muted-foreground italic mt-2">
                  You can customize these settings after creation
                </p>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={createMutation.isPending}>
              {createMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Create Strategy
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
