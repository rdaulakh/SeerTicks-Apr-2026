ALTER TABLE `tradingSymbols` ADD CONSTRAINT `idx_trading_symbols_user_symbol` UNIQUE(`userId`,`symbol`,`exchangeName`);--> statement-breakpoint
CREATE INDEX `idx_exchanges_user` ON `exchanges` (`userId`);--> statement-breakpoint
CREATE INDEX `idx_exchanges_active` ON `exchanges` (`isActive`);--> statement-breakpoint
CREATE INDEX `idx_trading_symbols_user` ON `tradingSymbols` (`userId`);--> statement-breakpoint
CREATE INDEX `idx_trading_symbols_active` ON `tradingSymbols` (`isActive`);