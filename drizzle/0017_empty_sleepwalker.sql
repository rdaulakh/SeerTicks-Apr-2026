CREATE TABLE `tradingPipelineLog` (
	`id` int AUTO_INCREMENT NOT NULL,
	`timestamp` timestamp NOT NULL DEFAULT (now()),
	`userId` int,
	`eventType` varchar(50) NOT NULL,
	`symbol` varchar(20),
	`direction` varchar(10),
	`action` varchar(10),
	`confidence` decimal(8,4),
	`price` decimal(20,8),
	`quantity` decimal(20,10),
	`pnl` decimal(20,8),
	`pnlPercent` decimal(10,4),
	`reason` text,
	`metadata` json,
	CONSTRAINT `tradingPipelineLog_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `idx_tpl_timestamp` ON `tradingPipelineLog` (`timestamp`);--> statement-breakpoint
CREATE INDEX `idx_tpl_eventType` ON `tradingPipelineLog` (`eventType`);--> statement-breakpoint
CREATE INDEX `idx_tpl_symbol` ON `tradingPipelineLog` (`symbol`);--> statement-breakpoint
CREATE INDEX `idx_tpl_user_event` ON `tradingPipelineLog` (`userId`,`eventType`);--> statement-breakpoint
CREATE INDEX `idx_tpl_symbol_time` ON `tradingPipelineLog` (`symbol`,`timestamp`);