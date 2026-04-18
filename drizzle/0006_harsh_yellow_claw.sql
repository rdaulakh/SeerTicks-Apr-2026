ALTER TABLE `paperWallets` DROP INDEX `paperWallets_userId_unique`;--> statement-breakpoint
ALTER TABLE `paperOrders` ADD `tradingMode` enum('paper','live') DEFAULT 'paper' NOT NULL;--> statement-breakpoint
ALTER TABLE `paperPositions` ADD `tradingMode` enum('paper','live') DEFAULT 'paper' NOT NULL;--> statement-breakpoint
ALTER TABLE `paperPositions` ADD `tradeQualityScore` varchar(2);--> statement-breakpoint
ALTER TABLE `paperPositions` ADD `pnlAfterCosts` varchar(50);--> statement-breakpoint
ALTER TABLE `paperPositions` ADD `totalCosts` varchar(50);--> statement-breakpoint
ALTER TABLE `paperPositions` ADD `costBreakdown` json;--> statement-breakpoint
ALTER TABLE `paperTrades` ADD `tradingMode` enum('paper','live') DEFAULT 'paper' NOT NULL;--> statement-breakpoint
ALTER TABLE `paperTransactions` ADD `tradingMode` enum('paper','live') DEFAULT 'paper' NOT NULL;--> statement-breakpoint
ALTER TABLE `paperWallets` ADD `tradingMode` enum('paper','live') DEFAULT 'paper' NOT NULL;--> statement-breakpoint
ALTER TABLE `paperWallets` ADD CONSTRAINT `idx_paperWallets_userId_mode` UNIQUE(`userId`,`tradingMode`);--> statement-breakpoint
CREATE INDEX `idx_agentAccuracy_userId_agentName` ON `agentAccuracy` (`userId`,`agentName`);--> statement-breakpoint
CREATE INDEX `idx_agentAccuracy_symbol` ON `agentAccuracy` (`symbol`);--> statement-breakpoint
CREATE INDEX `idx_agentSignals_userId_timestamp` ON `agentSignals` (`userId`,`timestamp`);--> statement-breakpoint
CREATE INDEX `idx_agentSignals_agentName` ON `agentSignals` (`agentName`);--> statement-breakpoint
CREATE INDEX `idx_autoTradeLog_userId_status` ON `automatedTradeLog` (`userId`,`status`);--> statement-breakpoint
CREATE INDEX `idx_autoTradeLog_symbol` ON `automatedTradeLog` (`symbol`);--> statement-breakpoint
CREATE INDEX `idx_autoTradeLog_createdAt` ON `automatedTradeLog` (`createdAt`);--> statement-breakpoint
CREATE INDEX `idx_candleData_symbol_interval_ts` ON `candleData` (`symbol`,`interval`,`timestamp`);--> statement-breakpoint
CREATE INDEX `idx_notifications_userId_isRead` ON `notifications` (`userId`,`isRead`);--> statement-breakpoint
CREATE INDEX `idx_notifications_createdAt` ON `notifications` (`createdAt`);--> statement-breakpoint
CREATE INDEX `idx_paperOrders_userId_status` ON `paperOrders` (`userId`,`status`);--> statement-breakpoint
CREATE INDEX `idx_paperOrders_symbol` ON `paperOrders` (`symbol`);--> statement-breakpoint
CREATE INDEX `idx_paperPositions_userId_status` ON `paperPositions` (`userId`,`status`);--> statement-breakpoint
CREATE INDEX `idx_paperPositions_symbol` ON `paperPositions` (`symbol`);--> statement-breakpoint
CREATE INDEX `idx_paperTrades_userId` ON `paperTrades` (`userId`);--> statement-breakpoint
CREATE INDEX `idx_paperTrades_symbol` ON `paperTrades` (`symbol`);--> statement-breakpoint
CREATE INDEX `idx_paperTrades_timestamp` ON `paperTrades` (`timestamp`);--> statement-breakpoint
CREATE INDEX `idx_positions_userId_status` ON `positions` (`userId`,`status`);--> statement-breakpoint
CREATE INDEX `idx_positions_symbol` ON `positions` (`symbol`);--> statement-breakpoint
CREATE INDEX `idx_trades_userId` ON `trades` (`userId`);--> statement-breakpoint
CREATE INDEX `idx_trades_userId_status` ON `trades` (`userId`,`status`);--> statement-breakpoint
CREATE INDEX `idx_trades_symbol_status` ON `trades` (`symbol`,`status`);--> statement-breakpoint
CREATE INDEX `idx_trades_createdAt` ON `trades` (`createdAt`);--> statement-breakpoint
CREATE INDEX `idx_tradingSignals_userId_symbol` ON `tradingSignals` (`userId`,`symbol`);--> statement-breakpoint
CREATE INDEX `idx_tradingSignals_timestamp` ON `tradingSignals` (`timestamp`);