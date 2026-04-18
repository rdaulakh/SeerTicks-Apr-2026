CREATE TABLE `priceHistory` (
	`id` int AUTO_INCREMENT NOT NULL,
	`symbol` varchar(20) NOT NULL,
	`timestamp` bigint NOT NULL,
	`open` varchar(50) NOT NULL,
	`high` varchar(50) NOT NULL,
	`low` varchar(50) NOT NULL,
	`close` varchar(50) NOT NULL,
	`volume` varchar(50) NOT NULL,
	`source` varchar(20) NOT NULL DEFAULT 'coinbase',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `priceHistory_id` PRIMARY KEY(`id`),
	CONSTRAINT `idx_priceHistory_symbol_ts` UNIQUE(`symbol`,`timestamp`)
);
--> statement-breakpoint
CREATE INDEX `idx_priceHistory_symbol` ON `priceHistory` (`symbol`);