ALTER TABLE `winningPatterns` MODIFY COLUMN `timeframe` enum('1m','5m','1h','4h','1d') NOT NULL;--> statement-breakpoint
ALTER TABLE `winningPatterns` ADD `symbol` varchar(20) NOT NULL;