ALTER TABLE `positions` ADD `status` enum('open','closed') DEFAULT 'open' NOT NULL;--> statement-breakpoint
ALTER TABLE `positions` ADD `exitReason` enum('manual','stop_loss','take_profit','liquidation','system');--> statement-breakpoint
ALTER TABLE `positions` ADD `exitTime` timestamp;--> statement-breakpoint
ALTER TABLE `positions` ADD `realizedPnl` decimal(18,8);