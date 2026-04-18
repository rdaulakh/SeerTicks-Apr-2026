DROP TABLE `dataCoverageSummary`;--> statement-breakpoint
DROP TABLE `dataIngestionJobs`;--> statement-breakpoint
DROP TABLE `historicalOHLCV`;--> statement-breakpoint
DROP TABLE `tradeJournalEntries`;--> statement-breakpoint
ALTER TABLE `tradingSymbols` DROP INDEX `idx_trading_symbols_user_symbol`;--> statement-breakpoint
DROP INDEX `idx_exchanges_user` ON `exchanges`;--> statement-breakpoint
DROP INDEX `idx_exchanges_active` ON `exchanges`;--> statement-breakpoint
DROP INDEX `idx_trading_symbols_user` ON `tradingSymbols`;--> statement-breakpoint
DROP INDEX `idx_trading_symbols_active` ON `tradingSymbols`;--> statement-breakpoint
ALTER TABLE `tradingModeConfig` DROP COLUMN `autoTradeEnabled`;--> statement-breakpoint
ALTER TABLE `tradingModeConfig` DROP COLUMN `portfolioFunds`;