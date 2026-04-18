DROP TABLE `agentAccuracy`;--> statement-breakpoint
DROP TABLE `agentSignals`;--> statement-breakpoint
DROP TABLE `agentWeights`;--> statement-breakpoint
DROP TABLE `apiKeys`;--> statement-breakpoint
DROP TABLE `engineState`;--> statement-breakpoint
DROP TABLE `exchangeSettings`;--> statement-breakpoint
DROP TABLE `exchanges`;--> statement-breakpoint
DROP TABLE `externalApiKeys`;--> statement-breakpoint
DROP TABLE `historicalCandles`;--> statement-breakpoint
DROP TABLE `mlTrainingData`;--> statement-breakpoint
DROP TABLE `paperOrders`;--> statement-breakpoint
DROP TABLE `paperPositions`;--> statement-breakpoint
DROP TABLE `paperTrades`;--> statement-breakpoint
DROP TABLE `paperWallets`;--> statement-breakpoint
DROP TABLE `positions`;--> statement-breakpoint
DROP TABLE `systemConfig`;--> statement-breakpoint
DROP TABLE `systemHealth`;--> statement-breakpoint
DROP TABLE `thresholdConfig`;--> statement-breakpoint
DROP TABLE `trades`;--> statement-breakpoint
DROP TABLE `tradingModeConfig`;--> statement-breakpoint
DROP TABLE `tradingSymbols`;--> statement-breakpoint
DROP TABLE `userBias`;--> statement-breakpoint
DROP TABLE `winningPatterns`;--> statement-breakpoint
ALTER TABLE `users` MODIFY COLUMN `email` varchar(320);--> statement-breakpoint
ALTER TABLE `users` MODIFY COLUMN `loginMethod` varchar(64);