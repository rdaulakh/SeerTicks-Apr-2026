/**
 * Exchange Configuration Wizard
 * Step-by-step onboarding for adding exchanges, API keys, and selecting symbols
 */

import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { ChevronRight, ChevronLeft, Check, AlertCircle, Loader2 } from "lucide-react";

type WizardStep = 'select_exchange' | 'api_keys' | 'test_connection' | 'select_symbols' | 'complete';

interface ExchangeConfig {
  exchangeName: 'binance' | 'coinbase';
  apiKey: string;
  apiSecret: string;
}

const AVAILABLE_EXCHANGES = [
  { name: 'binance' as const, displayName: 'Binance', description: 'World\'s largest crypto exchange' },
  { name: 'coinbase' as const, displayName: 'Coinbase', description: 'US-based regulated exchange' },
];

const POPULAR_SYMBOLS = [
  'BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT',
  'ADAUSDT', 'DOGEUSDT', 'MATICUSDT', 'DOTUSDT', 'AVAXUSDT'
];

export function ExchangeWizard({ onComplete }: { onComplete?: () => void }) {
  const [step, setStep] = useState<WizardStep>('select_exchange');
  const [config, setConfig] = useState<ExchangeConfig>({
    exchangeName: 'binance',
    apiKey: '',
    apiSecret: '',
  });
  const [selectedSymbols, setSelectedSymbols] = useState<string[]>(['BTCUSDT']);
  const [testingConnection, setTestingConnection] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<'idle' | 'success' | 'error'>('idle');

  // Mutations
  const addExchange = trpc.settings.addExchange.useMutation();
  const addSymbol = trpc.settings.addSymbol.useMutation();
  const testConnection = trpc.settings.testConnection.useMutation();

  const handleTestConnection = async () => {
    setTestingConnection(true);
    setConnectionStatus('idle');

    try {
      // Test connection with real exchange API
      const result = await testConnection.mutateAsync({
        exchangeName: config.exchangeName,
        apiKey: config.apiKey,
        apiSecret: config.apiSecret,
      });

      if (result.success) {
        setConnectionStatus('success');
        toast.success(result.message || 'Connection successful!');
      } else {
        setConnectionStatus('error');
        toast.error(result.message || 'Invalid API credentials');
      }
    } catch (error: any) {
      setConnectionStatus('error');
      toast.error(error.message || 'Connection test failed');
    } finally {
      setTestingConnection(false);
    }
  };

  const handleComplete = async () => {
    try {
      // Save exchange with API keys (encrypted)
      await addExchange.mutateAsync({
        exchangeName: config.exchangeName,
        apiKey: config.apiKey,
        apiSecret: config.apiSecret,
      });

      // Save selected symbols
      for (const symbol of selectedSymbols) {
        await addSymbol.mutateAsync({
          symbol,
          isActive: true,
        });
      }

      toast.success('Exchange configured successfully!');
      setStep('complete');
      onComplete?.();
    } catch (error: any) {
      toast.error(`Failed to save configuration: ${error.message}`);
    }
  };

  const canProceed = () => {
    switch (step) {
      case 'select_exchange':
        return true;
      case 'api_keys':
        return config.apiKey.length > 0 && config.apiSecret.length > 0;
      case 'test_connection':
        return connectionStatus === 'success';
      case 'select_symbols':
        return selectedSymbols.length > 0;
      default:
        return false;
    }
  };

  const renderStep = () => {
    switch (step) {
      case 'select_exchange':
        return (
          <div className="space-y-4">
            <div>
              <Label>Select Exchange</Label>
              <p className="text-sm text-muted-foreground mb-4">
                Choose the exchange you want to connect to SEER
              </p>
            </div>

            <div className="grid gap-4">
              {AVAILABLE_EXCHANGES.map((exchange) => (
                <Card
                  key={exchange.name}
                  className={`cursor-pointer transition-all ${
                    config.exchangeName === exchange.name
                      ? 'border-primary bg-primary/5'
                      : 'hover:border-primary/50'
                  }`}
                  onClick={() => setConfig({ ...config, exchangeName: exchange.name })}
                >
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <div>
                        <CardTitle>{exchange.displayName}</CardTitle>
                        <CardDescription>{exchange.description}</CardDescription>
                      </div>
                      {config.exchangeName === exchange.name && (
                        <Check className="w-5 h-5 text-primary" />
                      )}
                    </div>
                  </CardHeader>
                </Card>
              ))}
            </div>
          </div>
        );

      case 'api_keys':
        return (
          <div className="space-y-4">
            <div>
              <Label>API Credentials</Label>
              <p className="text-sm text-muted-foreground mb-4">
                Enter your {config.exchangeName === 'binance' ? 'Binance' : 'Coinbase'} API keys. These will be encrypted and stored securely.
              </p>
            </div>

            <div className="space-y-4">
              <div>
                <Label htmlFor="apiKey">API Key</Label>
                <Input
                  id="apiKey"
                  type="text"
                  placeholder="Enter your API key"
                  value={config.apiKey}
                  onChange={(e) => setConfig({ ...config, apiKey: e.target.value })}
                  className="font-mono"
                />
              </div>

              <div>
                <Label htmlFor="apiSecret">API Secret</Label>
                <Input
                  id="apiSecret"
                  type="password"
                  placeholder="Enter your API secret"
                  value={config.apiSecret}
                  onChange={(e) => setConfig({ ...config, apiSecret: e.target.value })}
                  className="font-mono"
                />
              </div>

              <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4">
                <p className="text-sm text-blue-400">
                  <strong>Note:</strong> Make sure your API key has "Spot Trading" permissions enabled.
                  For security, do NOT enable withdrawal permissions.
                </p>
              </div>
            </div>
          </div>
        );

      case 'test_connection':
        return (
          <div className="space-y-4">
            <div>
              <Label>Test Connection</Label>
              <p className="text-sm text-muted-foreground mb-4">
                Verify your API credentials by testing the connection
              </p>
            </div>

            <Card>
              <CardContent className="pt-6">
                <div className="flex flex-col items-center justify-center py-8">
                  {connectionStatus === 'idle' && (
                    <>
                      <AlertCircle className="w-16 h-16 text-muted-foreground mb-4" />
                      <p className="text-muted-foreground mb-4">Ready to test connection</p>
                      <Button
                        onClick={handleTestConnection}
                        disabled={testingConnection}
                      >
                        {testingConnection ? (
                          <>
                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                            Testing...
                          </>
                        ) : (
                          'Test Connection'
                        )}
                      </Button>
                    </>
                  )}

                  {connectionStatus === 'success' && (
                    <>
                      <div className="w-16 h-16 rounded-full bg-green-500/20 flex items-center justify-center mb-4">
                        <Check className="w-8 h-8 text-green-500" />
                      </div>
                      <p className="text-green-500 font-medium mb-2">Connection Successful!</p>
                      <p className="text-sm text-muted-foreground">Your API credentials are valid</p>
                    </>
                  )}

                  {connectionStatus === 'error' && (
                    <>
                      <div className="w-16 h-16 rounded-full bg-red-500/20 flex items-center justify-center mb-4">
                        <AlertCircle className="w-8 h-8 text-red-500" />
                      </div>
                      <p className="text-red-500 font-medium mb-2">Connection Failed</p>
                      <p className="text-sm text-muted-foreground mb-4">Please check your API credentials</p>
                      <Button
                        onClick={handleTestConnection}
                        variant="outline"
                        disabled={testingConnection}
                      >
                        Retry
                      </Button>
                    </>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        );

      case 'select_symbols':
        return (
          <div className="space-y-4">
            <div>
              <Label>Select Trading Symbols</Label>
              <p className="text-sm text-muted-foreground mb-4">
                Choose which cryptocurrency pairs you want to trade
              </p>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {POPULAR_SYMBOLS.map((symbol) => (
                <Card
                  key={symbol}
                  className={`cursor-pointer transition-all ${
                    selectedSymbols.includes(symbol)
                      ? 'border-primary bg-primary/5'
                      : 'hover:border-primary/50'
                  }`}
                  onClick={() => {
                    if (selectedSymbols.includes(symbol)) {
                      setSelectedSymbols(selectedSymbols.filter(s => s !== symbol));
                    } else {
                      setSelectedSymbols([...selectedSymbols, symbol]);
                    }
                  }}
                >
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <span className="font-mono font-medium">{symbol}</span>
                      {selectedSymbols.includes(symbol) && (
                        <Check className="w-4 h-4 text-primary" />
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>

            <p className="text-sm text-muted-foreground">
              Selected: {selectedSymbols.length} symbol{selectedSymbols.length !== 1 ? 's' : ''}
            </p>
          </div>
        );

      case 'complete':
        return (
          <div className="text-center py-8">
            <div className="w-16 h-16 rounded-full bg-green-500/20 flex items-center justify-center mx-auto mb-4">
              <Check className="w-8 h-8 text-green-500" />
            </div>
            <h3 className="text-xl font-semibold mb-2">Setup Complete!</h3>
            <p className="text-muted-foreground mb-6">
              Your exchange is configured and ready to trade
            </p>
            <div className="space-y-2 text-sm">
              <div className="flex items-center justify-center gap-2">
                <Badge>{config.exchangeName === 'binance' ? 'Binance' : 'Coinbase'}</Badge>
                <span className="text-muted-foreground">connected</span>
              </div>
              <div className="flex items-center justify-center gap-2">
                <Badge>{selectedSymbols.length}</Badge>
                <span className="text-muted-foreground">trading symbols selected</span>
              </div>
            </div>
          </div>
        );
    }
  };

  return (
    <Card className="max-w-2xl mx-auto">
      <CardHeader>
        <CardTitle>Exchange Configuration</CardTitle>
        <CardDescription>
          Step {['select_exchange', 'api_keys', 'test_connection', 'select_symbols', 'complete'].indexOf(step) + 1} of 5
        </CardDescription>
      </CardHeader>
      <CardContent>
        {renderStep()}

        {step !== 'complete' && (
          <div className="flex items-center justify-between mt-6 pt-6 border-t">
            <Button
              variant="outline"
              onClick={() => {
                const steps: WizardStep[] = ['select_exchange', 'api_keys', 'test_connection', 'select_symbols'];
                const currentIndex = steps.indexOf(step);
                if (currentIndex > 0) {
                  setStep(steps[currentIndex - 1]);
                }
              }}
              disabled={step === 'select_exchange'}
            >
              <ChevronLeft className="w-4 h-4 mr-2" />
              Back
            </Button>

            <Button
              onClick={() => {
                const steps: WizardStep[] = ['select_exchange', 'api_keys', 'test_connection', 'select_symbols'];
                const currentIndex = steps.indexOf(step);
                if (currentIndex < steps.length - 1) {
                  setStep(steps[currentIndex + 1]);
                } else {
                  handleComplete();
                }
              }}
              disabled={!canProceed()}
            >
              {step === 'select_symbols' ? 'Complete Setup' : 'Next'}
              <ChevronRight className="w-4 h-4 ml-2" />
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
