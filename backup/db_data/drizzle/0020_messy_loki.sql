ALTER TABLE `strategyPerformance` MODIFY COLUMN `winRate` varchar(50) NOT NULL DEFAULT '0.00';--> statement-breakpoint
ALTER TABLE `strategyPerformance` MODIFY COLUMN `totalPnL` varchar(50) NOT NULL DEFAULT '0.00';--> statement-breakpoint
ALTER TABLE `strategyPerformance` MODIFY COLUMN `realizedPnL` varchar(50) NOT NULL DEFAULT '0.00';--> statement-breakpoint
ALTER TABLE `strategyPerformance` MODIFY COLUMN `unrealizedPnL` varchar(50) NOT NULL DEFAULT '0.00';--> statement-breakpoint
ALTER TABLE `strategyPerformance` MODIFY COLUMN `avgWin` varchar(50) NOT NULL DEFAULT '0.00';--> statement-breakpoint
ALTER TABLE `strategyPerformance` MODIFY COLUMN `avgLoss` varchar(50) NOT NULL DEFAULT '0.00';