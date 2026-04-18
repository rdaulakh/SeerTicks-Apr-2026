ALTER TABLE `agentAccuracy` MODIFY COLUMN `accuracy` varchar(50) NOT NULL;--> statement-breakpoint
ALTER TABLE `agentPerformanceMetrics` MODIFY COLUMN `accuracy` varchar(50);--> statement-breakpoint
ALTER TABLE `agentPerformanceMetrics` MODIFY COLUMN `avgConfidence` varchar(50);--> statement-breakpoint
ALTER TABLE `agentPerformanceMetrics` MODIFY COLUMN `sharpeRatio` varchar(50);--> statement-breakpoint
ALTER TABLE `agentPerformanceMetrics` MODIFY COLUMN `profitFactor` varchar(50);--> statement-breakpoint
ALTER TABLE `agentSignals` MODIFY COLUMN `confidence` varchar(50);--> statement-breakpoint
ALTER TABLE `agentWeights` MODIFY COLUMN `technicalWeight` varchar(50) NOT NULL DEFAULT '40.00';--> statement-breakpoint
ALTER TABLE `agentWeights` MODIFY COLUMN `patternWeight` varchar(50) NOT NULL DEFAULT '35.00';--> statement-breakpoint
ALTER TABLE `agentWeights` MODIFY COLUMN `orderFlowWeight` varchar(50) NOT NULL DEFAULT '25.00';--> statement-breakpoint
ALTER TABLE `agentWeights` MODIFY COLUMN `sentimentWeight` varchar(50) NOT NULL DEFAULT '33.33';--> statement-breakpoint
ALTER TABLE `agentWeights` MODIFY COLUMN `newsWeight` varchar(50) NOT NULL DEFAULT '33.33';--> statement-breakpoint
ALTER TABLE `agentWeights` MODIFY COLUMN `macroWeight` varchar(50) NOT NULL DEFAULT '33.34';--> statement-breakpoint
ALTER TABLE `agentWeights` MODIFY COLUMN `onChainWeight` varchar(50) NOT NULL DEFAULT '0.00';--> statement-breakpoint
ALTER TABLE `agentWeights` MODIFY COLUMN `timeframeBonus` varchar(50) NOT NULL DEFAULT '10.00';--> statement-breakpoint
ALTER TABLE `automatedTradeLog` MODIFY COLUMN `signalConfidence` varchar(50) NOT NULL;--> statement-breakpoint
ALTER TABLE `automatedTradeLog` MODIFY COLUMN `requestedQuantity` varchar(50);--> statement-breakpoint
ALTER TABLE `automatedTradeLog` MODIFY COLUMN `requestedValue` varchar(50);--> statement-breakpoint
ALTER TABLE `automatedTradeLog` MODIFY COLUMN `executedPrice` varchar(50);--> statement-breakpoint
ALTER TABLE `automatedTradeLog` MODIFY COLUMN `executedQuantity` varchar(50);--> statement-breakpoint
ALTER TABLE `automatedTradeLog` MODIFY COLUMN `preTradeBalance` varchar(50);--> statement-breakpoint
ALTER TABLE `automatedTradeLog` MODIFY COLUMN `preTradeEquity` varchar(50);--> statement-breakpoint
ALTER TABLE `automatedTradeLog` MODIFY COLUMN `dailyPnL` varchar(50);--> statement-breakpoint
ALTER TABLE `automatedTradingMetrics` MODIFY COLUMN `executionRate` varchar(50);--> statement-breakpoint
ALTER TABLE `automatedTradingMetrics` MODIFY COLUMN `totalPnL` varchar(50) DEFAULT '0.00';--> statement-breakpoint
ALTER TABLE `automatedTradingMetrics` MODIFY COLUMN `winRate` varchar(50);--> statement-breakpoint
ALTER TABLE `automatedTradingMetrics` MODIFY COLUMN `avgWin` varchar(50);--> statement-breakpoint
ALTER TABLE `automatedTradingMetrics` MODIFY COLUMN `avgLoss` varchar(50);--> statement-breakpoint
ALTER TABLE `automatedTradingMetrics` MODIFY COLUMN `profitFactor` varchar(50);--> statement-breakpoint
ALTER TABLE `automatedTradingMetrics` MODIFY COLUMN `maxDrawdown` varchar(50);--> statement-breakpoint
ALTER TABLE `automatedTradingMetrics` MODIFY COLUMN `sharpeRatio` varchar(50);--> statement-breakpoint
ALTER TABLE `automatedTradingSettings` MODIFY COLUMN `kellyFraction` varchar(50) DEFAULT '0.25';--> statement-breakpoint
ALTER TABLE `automatedTradingSettings` MODIFY COLUMN `maxDailyLossUSD` varchar(50) NOT NULL DEFAULT '500.00';--> statement-breakpoint
ALTER TABLE `automatedTradingSettings` MODIFY COLUMN `limitOrderOffsetPercent` varchar(50) DEFAULT '0.10';--> statement-breakpoint
ALTER TABLE `capitalAllocations` MODIFY COLUMN `totalCapital` varchar(50) NOT NULL;--> statement-breakpoint
ALTER TABLE `capitalAllocations` MODIFY COLUMN `activeTradingCapital` varchar(50) NOT NULL;--> statement-breakpoint
ALTER TABLE `capitalAllocations` MODIFY COLUMN `maintenanceMarginBuffer` varchar(50) NOT NULL;--> statement-breakpoint
ALTER TABLE `capitalAllocations` MODIFY COLUMN `drawdownProtectionReserve` varchar(50) NOT NULL;--> statement-breakpoint
ALTER TABLE `capitalAllocations` MODIFY COLUMN `opportunityCapital` varchar(50) NOT NULL;--> statement-breakpoint
ALTER TABLE `capitalAllocations` MODIFY COLUMN `activeTradingPercent` varchar(50) NOT NULL;--> statement-breakpoint
ALTER TABLE `capitalAllocations` MODIFY COLUMN `marginBufferPercent` varchar(50) NOT NULL;--> statement-breakpoint
ALTER TABLE `capitalAllocations` MODIFY COLUMN `drawdownReservePercent` varchar(50) NOT NULL;--> statement-breakpoint
ALTER TABLE `capitalAllocations` MODIFY COLUMN `opportunityPercent` varchar(50) NOT NULL;--> statement-breakpoint
ALTER TABLE `exchangeSettings` MODIFY COLUMN `maxPositionSize` varchar(50) NOT NULL DEFAULT '20.00';--> statement-breakpoint
ALTER TABLE `exchangeSettings` MODIFY COLUMN `maxTotalExposure` varchar(50) NOT NULL DEFAULT '50.00';--> statement-breakpoint
ALTER TABLE `historicalCandles` MODIFY COLUMN `open` varchar(50) NOT NULL;--> statement-breakpoint
ALTER TABLE `historicalCandles` MODIFY COLUMN `high` varchar(50) NOT NULL;--> statement-breakpoint
ALTER TABLE `historicalCandles` MODIFY COLUMN `low` varchar(50) NOT NULL;--> statement-breakpoint
ALTER TABLE `historicalCandles` MODIFY COLUMN `close` varchar(50) NOT NULL;--> statement-breakpoint
ALTER TABLE `historicalCandles` MODIFY COLUMN `volume` varchar(50) NOT NULL;--> statement-breakpoint
ALTER TABLE `mlTrainingData` MODIFY COLUMN `label` varchar(50) NOT NULL;--> statement-breakpoint
ALTER TABLE `mlTrainingData` MODIFY COLUMN `qualityWeight` varchar(50) NOT NULL;--> statement-breakpoint
ALTER TABLE `paperOrders` MODIFY COLUMN `quantity` varchar(50) NOT NULL;--> statement-breakpoint
ALTER TABLE `paperOrders` MODIFY COLUMN `price` varchar(50);--> statement-breakpoint
ALTER TABLE `paperOrders` MODIFY COLUMN `stopPrice` varchar(50);--> statement-breakpoint
ALTER TABLE `paperOrders` MODIFY COLUMN `filledPrice` varchar(50);--> statement-breakpoint
ALTER TABLE `paperOrders` MODIFY COLUMN `filledQuantity` varchar(50);--> statement-breakpoint
ALTER TABLE `paperOrders` MODIFY COLUMN `commission` varchar(50);--> statement-breakpoint
ALTER TABLE `paperOrders` MODIFY COLUMN `slippage` varchar(50);--> statement-breakpoint
ALTER TABLE `paperPositions` MODIFY COLUMN `entryPrice` varchar(50) NOT NULL;--> statement-breakpoint
ALTER TABLE `paperPositions` MODIFY COLUMN `currentPrice` varchar(50) NOT NULL;--> statement-breakpoint
ALTER TABLE `paperPositions` MODIFY COLUMN `quantity` varchar(50) NOT NULL;--> statement-breakpoint
ALTER TABLE `paperPositions` MODIFY COLUMN `stopLoss` varchar(50);--> statement-breakpoint
ALTER TABLE `paperPositions` MODIFY COLUMN `takeProfit` varchar(50);--> statement-breakpoint
ALTER TABLE `paperPositions` MODIFY COLUMN `unrealizedPnL` varchar(50) NOT NULL DEFAULT '0.00';--> statement-breakpoint
ALTER TABLE `paperPositions` MODIFY COLUMN `unrealizedPnLPercent` varchar(50) NOT NULL DEFAULT '0.00';--> statement-breakpoint
ALTER TABLE `paperPositions` MODIFY COLUMN `commission` varchar(50) NOT NULL DEFAULT '0.00';--> statement-breakpoint
ALTER TABLE `paperPositions` MODIFY COLUMN `realizedPnl` varchar(50);--> statement-breakpoint
ALTER TABLE `paperTrades` MODIFY COLUMN `price` varchar(50) NOT NULL;--> statement-breakpoint
ALTER TABLE `paperTrades` MODIFY COLUMN `quantity` varchar(50) NOT NULL;--> statement-breakpoint
ALTER TABLE `paperTrades` MODIFY COLUMN `pnl` varchar(50) NOT NULL;--> statement-breakpoint
ALTER TABLE `paperTrades` MODIFY COLUMN `commission` varchar(50) NOT NULL;--> statement-breakpoint
ALTER TABLE `paperTransactions` MODIFY COLUMN `amount` varchar(50) NOT NULL;--> statement-breakpoint
ALTER TABLE `paperTransactions` MODIFY COLUMN `balanceBefore` varchar(50) NOT NULL;--> statement-breakpoint
ALTER TABLE `paperTransactions` MODIFY COLUMN `balanceAfter` varchar(50) NOT NULL;--> statement-breakpoint
ALTER TABLE `paperWallets` MODIFY COLUMN `balance` varchar(50) NOT NULL DEFAULT '10000.00';--> statement-breakpoint
ALTER TABLE `paperWallets` MODIFY COLUMN `equity` varchar(50) NOT NULL DEFAULT '10000.00';--> statement-breakpoint
ALTER TABLE `paperWallets` MODIFY COLUMN `margin` varchar(50) NOT NULL DEFAULT '0.00';--> statement-breakpoint
ALTER TABLE `paperWallets` MODIFY COLUMN `marginLevel` varchar(50) NOT NULL DEFAULT '0.00';--> statement-breakpoint
ALTER TABLE `paperWallets` MODIFY COLUMN `totalPnL` varchar(50) NOT NULL DEFAULT '0.00';--> statement-breakpoint
ALTER TABLE `paperWallets` MODIFY COLUMN `realizedPnL` varchar(50) NOT NULL DEFAULT '0.00';--> statement-breakpoint
ALTER TABLE `paperWallets` MODIFY COLUMN `unrealizedPnL` varchar(50) NOT NULL DEFAULT '0.00';--> statement-breakpoint
ALTER TABLE `paperWallets` MODIFY COLUMN `totalCommission` varchar(50) NOT NULL DEFAULT '0.00';--> statement-breakpoint
ALTER TABLE `paperWallets` MODIFY COLUMN `winRate` varchar(50) NOT NULL DEFAULT '0.00';--> statement-breakpoint
ALTER TABLE `portfolioRiskMetrics` MODIFY COLUMN `totalValue` varchar(50) NOT NULL;--> statement-breakpoint
ALTER TABLE `portfolioRiskMetrics` MODIFY COLUMN `dailyReturn` varchar(50);--> statement-breakpoint
ALTER TABLE `portfolioRiskMetrics` MODIFY COLUMN `cumulativeReturn` varchar(50);--> statement-breakpoint
ALTER TABLE `portfolioRiskMetrics` MODIFY COLUMN `sharpeRatio` varchar(50);--> statement-breakpoint
ALTER TABLE `portfolioRiskMetrics` MODIFY COLUMN `sortinoRatio` varchar(50);--> statement-breakpoint
ALTER TABLE `portfolioRiskMetrics` MODIFY COLUMN `maxDrawdown` varchar(50);--> statement-breakpoint
ALTER TABLE `portfolioRiskMetrics` MODIFY COLUMN `volatility` varchar(50);--> statement-breakpoint
ALTER TABLE `portfolioRiskMetrics` MODIFY COLUMN `allocatedCapital` varchar(50) NOT NULL;--> statement-breakpoint
ALTER TABLE `portfolioRiskMetrics` MODIFY COLUMN `availableCash` varchar(50) NOT NULL;--> statement-breakpoint
ALTER TABLE `portfolioSnapshots` MODIFY COLUMN `totalEquity` varchar(50) NOT NULL;--> statement-breakpoint
ALTER TABLE `portfolioSnapshots` MODIFY COLUMN `cash` varchar(50) NOT NULL;--> statement-breakpoint
ALTER TABLE `portfolioSnapshots` MODIFY COLUMN `positionsValue` varchar(50) NOT NULL;--> statement-breakpoint
ALTER TABLE `portfolioSnapshots` MODIFY COLUMN `unrealizedPnL` varchar(50) NOT NULL;--> statement-breakpoint
ALTER TABLE `portfolioSnapshots` MODIFY COLUMN `realizedPnL` varchar(50) NOT NULL;--> statement-breakpoint
ALTER TABLE `portfolioSnapshots` MODIFY COLUMN `dailyReturn` varchar(50);--> statement-breakpoint
ALTER TABLE `portfolioSnapshots` MODIFY COLUMN `dailyPnL` varchar(50);--> statement-breakpoint
ALTER TABLE `portfolioSnapshots` MODIFY COLUMN `portfolioVaR95` varchar(50);--> statement-breakpoint
ALTER TABLE `portfolioSnapshots` MODIFY COLUMN `currentDrawdown` varchar(50);--> statement-breakpoint
ALTER TABLE `portfolioSnapshots` MODIFY COLUMN `sharpeRatio` varchar(50);--> statement-breakpoint
ALTER TABLE `portfolioSnapshots` MODIFY COLUMN `activeTradingCapital` varchar(50);--> statement-breakpoint
ALTER TABLE `portfolioSnapshots` MODIFY COLUMN `reserveCapital` varchar(50);--> statement-breakpoint
ALTER TABLE `positionRiskMetrics` MODIFY COLUMN `positionVaR95` varchar(50);--> statement-breakpoint
ALTER TABLE `positionRiskMetrics` MODIFY COLUMN `varContribution` varchar(50);--> statement-breakpoint
ALTER TABLE `positionRiskMetrics` MODIFY COLUMN `correlationWithPortfolio` varchar(50);--> statement-breakpoint
ALTER TABLE `positionRiskMetrics` MODIFY COLUMN `kellyOptimalSize` varchar(50);--> statement-breakpoint
ALTER TABLE `positionRiskMetrics` MODIFY COLUMN `currentSize` varchar(50);--> statement-breakpoint
ALTER TABLE `positionRiskMetrics` MODIFY COLUMN `sizeDeviation` varchar(50);--> statement-breakpoint
ALTER TABLE `positionRiskMetrics` MODIFY COLUMN `stopLossDistance` varchar(50);--> statement-breakpoint
ALTER TABLE `positionRiskMetrics` MODIFY COLUMN `takeProfitDistance` varchar(50);--> statement-breakpoint
ALTER TABLE `positionRiskMetrics` MODIFY COLUMN `riskRewardRatio` varchar(50);--> statement-breakpoint
ALTER TABLE `positions` MODIFY COLUMN `entryPrice` varchar(50) NOT NULL;--> statement-breakpoint
ALTER TABLE `positions` MODIFY COLUMN `currentPrice` varchar(50);--> statement-breakpoint
ALTER TABLE `positions` MODIFY COLUMN `quantity` varchar(50) NOT NULL;--> statement-breakpoint
ALTER TABLE `positions` MODIFY COLUMN `stopLoss` varchar(50) NOT NULL;--> statement-breakpoint
ALTER TABLE `positions` MODIFY COLUMN `takeProfit` varchar(50) NOT NULL;--> statement-breakpoint
ALTER TABLE `positions` MODIFY COLUMN `currentDeviation` varchar(50);--> statement-breakpoint
ALTER TABLE `positions` MODIFY COLUMN `unrealizedPnl` varchar(50);--> statement-breakpoint
ALTER TABLE `positions` MODIFY COLUMN `realizedPnl` varchar(50);--> statement-breakpoint
ALTER TABLE `preTradeValidations` MODIFY COLUMN `requestedQuantity` varchar(50) NOT NULL;--> statement-breakpoint
ALTER TABLE `preTradeValidations` MODIFY COLUMN `requestedValue` varchar(50) NOT NULL;--> statement-breakpoint
ALTER TABLE `preTradeValidations` MODIFY COLUMN `currentPrice` varchar(50) NOT NULL;--> statement-breakpoint
ALTER TABLE `preTradeValidations` MODIFY COLUMN `overallRiskScore` varchar(50);--> statement-breakpoint
ALTER TABLE `preTradeValidations` MODIFY COLUMN `kellyOptimalSize` varchar(50);--> statement-breakpoint
ALTER TABLE `preTradeValidations` MODIFY COLUMN `kellyDeviation` varchar(50);--> statement-breakpoint
ALTER TABLE `preTradeValidations` MODIFY COLUMN `portfolioVaR` varchar(50);--> statement-breakpoint
ALTER TABLE `preTradeValidations` MODIFY COLUMN `positionVaR` varchar(50);--> statement-breakpoint
ALTER TABLE `preTradeValidations` MODIFY COLUMN `varLimit` varchar(50);--> statement-breakpoint
ALTER TABLE `preTradeValidations` MODIFY COLUMN `varUtilization` varchar(50);--> statement-breakpoint
ALTER TABLE `preTradeValidations` MODIFY COLUMN `availableBalance` varchar(50);--> statement-breakpoint
ALTER TABLE `preTradeValidations` MODIFY COLUMN `requiredMargin` varchar(50);--> statement-breakpoint
ALTER TABLE `preTradeValidations` MODIFY COLUMN `marginUtilization` varchar(50);--> statement-breakpoint
ALTER TABLE `rebalancingHistory` MODIFY COLUMN `totalCapitalAllocated` varchar(50) NOT NULL;--> statement-breakpoint
ALTER TABLE `riskEvents` MODIFY COLUMN `portfolioValue` varchar(50);--> statement-breakpoint
ALTER TABLE `riskEvents` MODIFY COLUMN `drawdownPercent` varchar(50);--> statement-breakpoint
ALTER TABLE `riskEvents` MODIFY COLUMN `varBreach` varchar(50);--> statement-breakpoint
ALTER TABLE `riskEvents` MODIFY COLUMN `marginUtilization` varchar(50);--> statement-breakpoint
ALTER TABLE `riskEvents` MODIFY COLUMN `capitalAdjustment` varchar(50);--> statement-breakpoint
ALTER TABLE `riskLimitBreaches` MODIFY COLUMN `limitValue` varchar(50) NOT NULL;--> statement-breakpoint
ALTER TABLE `riskLimitBreaches` MODIFY COLUMN `actualValue` varchar(50) NOT NULL;--> statement-breakpoint
ALTER TABLE `riskMetrics` MODIFY COLUMN `portfolioValue` varchar(50) NOT NULL;--> statement-breakpoint
ALTER TABLE `riskMetrics` MODIFY COLUMN `portfolioVaR95` varchar(50);--> statement-breakpoint
ALTER TABLE `riskMetrics` MODIFY COLUMN `portfolioVaR99` varchar(50);--> statement-breakpoint
ALTER TABLE `riskMetrics` MODIFY COLUMN `historicalVaR` varchar(50);--> statement-breakpoint
ALTER TABLE `riskMetrics` MODIFY COLUMN `parametricVaR` varchar(50);--> statement-breakpoint
ALTER TABLE `riskMetrics` MODIFY COLUMN `monteCarloVaR` varchar(50);--> statement-breakpoint
ALTER TABLE `riskMetrics` MODIFY COLUMN `currentDrawdown` varchar(50);--> statement-breakpoint
ALTER TABLE `riskMetrics` MODIFY COLUMN `maxDrawdown` varchar(50);--> statement-breakpoint
ALTER TABLE `riskMetrics` MODIFY COLUMN `peakEquity` varchar(50);--> statement-breakpoint
ALTER TABLE `riskMetrics` MODIFY COLUMN `sharpeRatio30d` varchar(50);--> statement-breakpoint
ALTER TABLE `riskMetrics` MODIFY COLUMN `sharpeRatio60d` varchar(50);--> statement-breakpoint
ALTER TABLE `riskMetrics` MODIFY COLUMN `sharpeRatio90d` varchar(50);--> statement-breakpoint
ALTER TABLE `riskMetrics` MODIFY COLUMN `sortinoRatio` varchar(50);--> statement-breakpoint
ALTER TABLE `riskMetrics` MODIFY COLUMN `calmarRatio` varchar(50);--> statement-breakpoint
ALTER TABLE `riskMetrics` MODIFY COLUMN `realizedVolatility` varchar(50);--> statement-breakpoint
ALTER TABLE `riskMetrics` MODIFY COLUMN `impliedVolatility` varchar(50);--> statement-breakpoint
ALTER TABLE `riskMetrics` MODIFY COLUMN `currentLeverage` varchar(50);--> statement-breakpoint
ALTER TABLE `riskMetrics` MODIFY COLUMN `marginUtilization` varchar(50);--> statement-breakpoint
ALTER TABLE `riskMetrics` MODIFY COLUMN `avgPositionCorrelation` varchar(50);--> statement-breakpoint
ALTER TABLE `riskMetrics` MODIFY COLUMN `portfolioDiversification` varchar(50);--> statement-breakpoint
ALTER TABLE `strategies` MODIFY COLUMN `meanExcessReturn` varchar(50);--> statement-breakpoint
ALTER TABLE `strategies` MODIFY COLUMN `stdDeviation` varchar(50);--> statement-breakpoint
ALTER TABLE `strategies` MODIFY COLUMN `kellyFraction` varchar(50);--> statement-breakpoint
ALTER TABLE `strategies` MODIFY COLUMN `kellyMultiplier` varchar(50) NOT NULL DEFAULT '0.5000';--> statement-breakpoint
ALTER TABLE `strategies` MODIFY COLUMN `sharpeRatio` varchar(50);--> statement-breakpoint
ALTER TABLE `strategies` MODIFY COLUMN `sortinoRatio` varchar(50);--> statement-breakpoint
ALTER TABLE `strategies` MODIFY COLUMN `calmarRatio` varchar(50);--> statement-breakpoint
ALTER TABLE `strategies` MODIFY COLUMN `winRate` varchar(50);--> statement-breakpoint
ALTER TABLE `strategies` MODIFY COLUMN `profitFactor` varchar(50);--> statement-breakpoint
ALTER TABLE `strategies` MODIFY COLUMN `avgWin` varchar(50);--> statement-breakpoint
ALTER TABLE `strategies` MODIFY COLUMN `avgLoss` varchar(50);--> statement-breakpoint
ALTER TABLE `strategies` MODIFY COLUMN `maxDrawdown` varchar(50);--> statement-breakpoint
ALTER TABLE `strategies` MODIFY COLUMN `allocatedCapital` varchar(50) NOT NULL DEFAULT '0.00';--> statement-breakpoint
ALTER TABLE `strategies` MODIFY COLUMN `targetAllocation` varchar(50);--> statement-breakpoint
ALTER TABLE `strategies` MODIFY COLUMN `minAllocation` varchar(50);--> statement-breakpoint
ALTER TABLE `strategies` MODIFY COLUMN `maxAllocation` varchar(50);--> statement-breakpoint
ALTER TABLE `strategies` MODIFY COLUMN `maxPositionSize` varchar(50) NOT NULL DEFAULT '20.00';--> statement-breakpoint
ALTER TABLE `strategies` MODIFY COLUMN `maxCorrelation` varchar(50) NOT NULL DEFAULT '0.6000';--> statement-breakpoint
ALTER TABLE `strategies` MODIFY COLUMN `stopLossPercent` varchar(50) NOT NULL DEFAULT '5.00';--> statement-breakpoint
ALTER TABLE `strategies` MODIFY COLUMN `takeProfitPercent` varchar(50) NOT NULL DEFAULT '10.00';--> statement-breakpoint
ALTER TABLE `strategyPositions` MODIFY COLUMN `entryValue` varchar(50) NOT NULL;--> statement-breakpoint
ALTER TABLE `strategyPositions` MODIFY COLUMN `currentValue` varchar(50);--> statement-breakpoint
ALTER TABLE `strategyPositions` MODIFY COLUMN `pnl` varchar(50);--> statement-breakpoint
ALTER TABLE `thresholdConfig` MODIFY COLUMN `highVolatilityAtrMin` varchar(50) NOT NULL DEFAULT '5.00';--> statement-breakpoint
ALTER TABLE `thresholdConfig` MODIFY COLUMN `mediumVolatilityAtrMin` varchar(50) NOT NULL DEFAULT '2.00';--> statement-breakpoint
ALTER TABLE `thresholdConfig` MODIFY COLUMN `lowVolatilityAtrMax` varchar(50) NOT NULL DEFAULT '2.00';--> statement-breakpoint
ALTER TABLE `thresholdConfig` MODIFY COLUMN `highVolatilityThreshold` varchar(50) NOT NULL DEFAULT '50.00';--> statement-breakpoint
ALTER TABLE `thresholdConfig` MODIFY COLUMN `mediumVolatilityThreshold` varchar(50) NOT NULL DEFAULT '60.00';--> statement-breakpoint
ALTER TABLE `thresholdConfig` MODIFY COLUMN `lowVolatilityThreshold` varchar(50) NOT NULL DEFAULT '70.00';--> statement-breakpoint
ALTER TABLE `thresholdConfig` MODIFY COLUMN `scoutTier` varchar(50) NOT NULL DEFAULT '3.00';--> statement-breakpoint
ALTER TABLE `thresholdConfig` MODIFY COLUMN `standardTier` varchar(50) NOT NULL DEFAULT '5.00';--> statement-breakpoint
ALTER TABLE `thresholdConfig` MODIFY COLUMN `highTier` varchar(50) NOT NULL DEFAULT '7.00';--> statement-breakpoint
ALTER TABLE `thresholdConfig` MODIFY COLUMN `veryHighTier` varchar(50) NOT NULL DEFAULT '10.00';--> statement-breakpoint
ALTER TABLE `thresholdConfig` MODIFY COLUMN `extremeTier` varchar(50) NOT NULL DEFAULT '15.00';--> statement-breakpoint
ALTER TABLE `thresholdConfig` MODIFY COLUMN `maxTier` varchar(50) NOT NULL DEFAULT '20.00';--> statement-breakpoint
ALTER TABLE `tradeExecutionLog` MODIFY COLUMN `quantity` varchar(50) NOT NULL;--> statement-breakpoint
ALTER TABLE `tradeExecutionLog` MODIFY COLUMN `price` varchar(50);--> statement-breakpoint
ALTER TABLE `tradeExecutionLog` MODIFY COLUMN `fillPrice` varchar(50);--> statement-breakpoint
ALTER TABLE `tradeExecutionLog` MODIFY COLUMN `fillQuantity` varchar(50);--> statement-breakpoint
ALTER TABLE `tradeExecutionLog` MODIFY COLUMN `slippage` varchar(50);--> statement-breakpoint
ALTER TABLE `tradeExecutionLog` MODIFY COLUMN `fees` varchar(50);--> statement-breakpoint
ALTER TABLE `trades` MODIFY COLUMN `entryPrice` varchar(50) NOT NULL;--> statement-breakpoint
ALTER TABLE `trades` MODIFY COLUMN `exitPrice` varchar(50);--> statement-breakpoint
ALTER TABLE `trades` MODIFY COLUMN `quantity` varchar(50) NOT NULL;--> statement-breakpoint
ALTER TABLE `trades` MODIFY COLUMN `pnl` varchar(50);--> statement-breakpoint
ALTER TABLE `trades` MODIFY COLUMN `pnlAfterCosts` varchar(50);--> statement-breakpoint
ALTER TABLE `trades` MODIFY COLUMN `totalCosts` varchar(50);--> statement-breakpoint
ALTER TABLE `trades` MODIFY COLUMN `confidence` varchar(50);--> statement-breakpoint
ALTER TABLE `tradingSignals` MODIFY COLUMN `price` varchar(50) NOT NULL;--> statement-breakpoint
ALTER TABLE `tradingStrategies` MODIFY COLUMN `allocatedCapital` varchar(50) NOT NULL;--> statement-breakpoint
ALTER TABLE `tradingStrategies` MODIFY COLUMN `availableCapital` varchar(50) NOT NULL;--> statement-breakpoint
ALTER TABLE `tradingStrategies` MODIFY COLUMN `maxCapital` varchar(50) NOT NULL;--> statement-breakpoint
ALTER TABLE `tradingStrategies` MODIFY COLUMN `maxDrawdown` varchar(50) NOT NULL DEFAULT '15.00';--> statement-breakpoint
ALTER TABLE `tradingStrategies` MODIFY COLUMN `maxDailyLoss` varchar(50) NOT NULL;--> statement-breakpoint
ALTER TABLE `tradingStrategies` MODIFY COLUMN `maxPositionSize` varchar(50) NOT NULL DEFAULT '20.00';--> statement-breakpoint
ALTER TABLE `tradingStrategies` MODIFY COLUMN `totalPnL` varchar(50) NOT NULL DEFAULT '0.00';--> statement-breakpoint
ALTER TABLE `tradingStrategies` MODIFY COLUMN `realizedPnL` varchar(50) NOT NULL DEFAULT '0.00';--> statement-breakpoint
ALTER TABLE `tradingStrategies` MODIFY COLUMN `unrealizedPnL` varchar(50) NOT NULL DEFAULT '0.00';--> statement-breakpoint
ALTER TABLE `tradingStrategies` MODIFY COLUMN `currentDrawdown` varchar(50) NOT NULL DEFAULT '0.00';--> statement-breakpoint
ALTER TABLE `tradingStrategies` MODIFY COLUMN `maxDrawdownReached` varchar(50) NOT NULL DEFAULT '0.00';--> statement-breakpoint
ALTER TABLE `tradingStrategies` MODIFY COLUMN `sharpeRatio` varchar(50);--> statement-breakpoint
ALTER TABLE `tradingStrategies` MODIFY COLUMN `sortinoRatio` varchar(50);--> statement-breakpoint
ALTER TABLE `tradingStrategies` MODIFY COLUMN `winRate` varchar(50) NOT NULL DEFAULT '0.00';--> statement-breakpoint
ALTER TABLE `tradingStrategies` MODIFY COLUMN `avgWin` varchar(50);--> statement-breakpoint
ALTER TABLE `tradingStrategies` MODIFY COLUMN `avgLoss` varchar(50);--> statement-breakpoint
ALTER TABLE `tradingStrategies` MODIFY COLUMN `profitFactor` varchar(50);--> statement-breakpoint
ALTER TABLE `tradingStrategies` MODIFY COLUMN `performanceScore` varchar(50) NOT NULL DEFAULT '50.00';--> statement-breakpoint
ALTER TABLE `userBias` MODIFY COLUMN `biasValue` varchar(50) NOT NULL;--> statement-breakpoint
ALTER TABLE `winningPatterns` MODIFY COLUMN `winRate` varchar(50);--> statement-breakpoint
ALTER TABLE `winningPatterns` MODIFY COLUMN `avgPnl` varchar(50);--> statement-breakpoint
ALTER TABLE `winningPatterns` MODIFY COLUMN `profitFactor` varchar(50);--> statement-breakpoint
ALTER TABLE `winningPatterns` MODIFY COLUMN `stopLoss` varchar(50);--> statement-breakpoint
ALTER TABLE `winningPatterns` MODIFY COLUMN `takeProfit` varchar(50);