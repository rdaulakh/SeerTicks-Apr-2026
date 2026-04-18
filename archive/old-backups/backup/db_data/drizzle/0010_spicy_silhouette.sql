ALTER TABLE `paperPositions` ADD `exitReason` enum('manual','stop_loss','take_profit','liquidation','system');--> statement-breakpoint
ALTER TABLE `paperPositions` ADD `exitTime` timestamp;--> statement-breakpoint
ALTER TABLE `paperPositions` ADD `realizedPnl` decimal(18,8);