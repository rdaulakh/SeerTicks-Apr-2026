DROP TABLE `capitalAllocations`;--> statement-breakpoint
DROP TABLE `paperTransactions`;--> statement-breakpoint
DROP TABLE `portfolioSnapshots`;--> statement-breakpoint
DROP TABLE `positionRiskMetrics`;--> statement-breakpoint
DROP TABLE `preTradeValidations`;--> statement-breakpoint
DROP TABLE `riskEvents`;--> statement-breakpoint
DROP TABLE `riskMetrics`;--> statement-breakpoint
DROP TABLE `strategies`;--> statement-breakpoint
DROP TABLE `strategyPositions`;--> statement-breakpoint
DROP TABLE `tradingStrategies`;--> statement-breakpoint
ALTER TABLE `paperPositions` DROP COLUMN `exitReason`;--> statement-breakpoint
ALTER TABLE `paperPositions` DROP COLUMN `exitTime`;--> statement-breakpoint
ALTER TABLE `paperPositions` DROP COLUMN `realizedPnl`;--> statement-breakpoint
ALTER TABLE `positions` DROP COLUMN `status`;--> statement-breakpoint
ALTER TABLE `positions` DROP COLUMN `exitReason`;--> statement-breakpoint
ALTER TABLE `positions` DROP COLUMN `exitTime`;--> statement-breakpoint
ALTER TABLE `positions` DROP COLUMN `realizedPnl`;