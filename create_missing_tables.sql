-- Drop and recreate all risk management tables to ensure consistency

DROP TABLE IF EXISTS `riskEvents`;
DROP TABLE IF EXISTS `capitalAllocations`;
DROP TABLE IF EXISTS `riskMetrics`;
DROP TABLE IF EXISTS `portfolioSnapshots`;
DROP TABLE IF EXISTS `portfolioRiskMetrics`;

CREATE TABLE `riskMetrics` (
  `id` int AUTO_INCREMENT NOT NULL,
  `userId` int NOT NULL,
  `timestamp` timestamp NOT NULL DEFAULT (now()),
  `portfolioValue` decimal(18,2) NOT NULL,
  `portfolioVaR95` decimal(18,2),
  `portfolioVaR99` decimal(18,2),
  `historicalVaR` decimal(18,2),
  `parametricVaR` decimal(18,2),
  `monteCarloVaR` decimal(18,2),
  `currentDrawdown` decimal(10,2),
  `maxDrawdown` decimal(10,2),
  `peakEquity` decimal(18,2),
  `drawdownDuration` int,
  `sharpeRatio30d` decimal(10,4),
  `sharpeRatio60d` decimal(10,4),
  `sharpeRatio90d` decimal(10,4),
  `sortinoRatio` decimal(10,4),
  `calmarRatio` decimal(10,4),
  `realizedVolatility` decimal(10,6),
  `impliedVolatility` decimal(10,6),
  `volatilityPercentile` int,
  `currentLeverage` decimal(10,4),
  `marginUtilization` decimal(5,2),
  `avgPositionCorrelation` decimal(5,4),
  `portfolioDiversification` decimal(5,4),
  `circuitBreakerLevel` enum('green','yellow','orange','red','emergency') NOT NULL DEFAULT 'green',
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `riskMetrics_id` PRIMARY KEY(`id`)
);

CREATE TABLE `capitalAllocations` (
  `id` int AUTO_INCREMENT NOT NULL,
  `userId` int NOT NULL,
  `timestamp` timestamp NOT NULL DEFAULT (now()),
  `totalCapital` decimal(18,2) NOT NULL,
  `activeTradingCapital` decimal(18,2) NOT NULL,
  `maintenanceMarginBuffer` decimal(18,2) NOT NULL,
  `drawdownProtectionReserve` decimal(18,2) NOT NULL,
  `opportunityCapital` decimal(18,2) NOT NULL,
  `activeTradingPercent` decimal(5,2) NOT NULL,
  `marginBufferPercent` decimal(5,2) NOT NULL,
  `drawdownReservePercent` decimal(5,2) NOT NULL,
  `opportunityPercent` decimal(5,2) NOT NULL,
  `strategyAllocations` json,
  `trigger` enum('scheduled','performance','drawdown','volatility','manual') NOT NULL,
  `reason` text,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `capitalAllocations_id` PRIMARY KEY(`id`)
);

CREATE TABLE `riskEvents` (
  `id` int AUTO_INCREMENT NOT NULL,
  `userId` int NOT NULL,
  `timestamp` timestamp NOT NULL DEFAULT (now()),
  `eventType` enum('drawdown_alert','var_breach','margin_warning','circuit_breaker_yellow','circuit_breaker_orange','circuit_breaker_red','circuit_breaker_emergency','position_size_violation','correlation_spike','volatility_spike','reserve_deployment','forced_liquidation') NOT NULL,
  `severity` enum('info','warning','critical','emergency') NOT NULL,
  `title` varchar(200) NOT NULL,
  `description` text,
  `portfolioValue` decimal(18,2),
  `drawdownPercent` decimal(10,2),
  `varBreach` decimal(18,2),
  `marginUtilization` decimal(5,2),
  `actionTaken` text,
  `positionsAffected` json,
  `capitalAdjustment` decimal(18,2),
  `resolved` boolean NOT NULL DEFAULT false,
  `resolvedAt` timestamp,
  `resolutionNotes` text,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `riskEvents_id` PRIMARY KEY(`id`)
);

CREATE TABLE `portfolioSnapshots` (
  `id` int AUTO_INCREMENT NOT NULL,
  `userId` int NOT NULL,
  `snapshotDate` timestamp NOT NULL,
  `totalEquity` decimal(18,2) NOT NULL,
  `cash` decimal(18,2) NOT NULL,
  `positionsValue` decimal(18,2) NOT NULL,
  `unrealizedPnL` decimal(18,2) NOT NULL,
  `realizedPnL` decimal(18,2) NOT NULL,
  `dailyReturn` decimal(10,6),
  `dailyPnL` decimal(18,2),
  `numberOfPositions` int NOT NULL,
  `positionDetails` json,
  `portfolioVaR95` decimal(18,2),
  `currentDrawdown` decimal(10,2),
  `sharpeRatio` decimal(10,4),
  `activeTradingCapital` decimal(18,2),
  `reserveCapital` decimal(18,2),
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `portfolioSnapshots_id` PRIMARY KEY(`id`)
);

CREATE TABLE `portfolioRiskMetrics` (
  `id` int AUTO_INCREMENT NOT NULL,
  `userId` int NOT NULL,
  `timestamp` timestamp NOT NULL DEFAULT (now()),
  `totalValue` decimal(18,2) NOT NULL,
  `dailyReturn` decimal(10,6),
  `cumulativeReturn` decimal(10,6),
  `sharpeRatio` decimal(10,4),
  `sortinoRatio` decimal(10,4),
  `maxDrawdown` decimal(10,2),
  `volatility` decimal(10,6),
  `numberOfPositions` int NOT NULL,
  `allocatedCapital` decimal(18,2) NOT NULL,
  `availableCash` decimal(18,2) NOT NULL,
  `correlationMatrix` json,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `portfolioRiskMetrics_id` PRIMARY KEY(`id`)
);
