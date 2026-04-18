CREATE TABLE `tradeJournalEntries` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`tradeId` int,
	`title` varchar(200),
	`setup` text,
	`strategy` varchar(100),
	`timeframe` varchar(20),
	`marketCondition` enum('trending','ranging','volatile','calm'),
	`entryReason` text,
	`confluenceFactors` json,
	`exitReason` text,
	`lessonsLearned` text,
	`mistakes` text,
	`improvements` text,
	`emotionBefore` enum('confident','neutral','anxious','fearful','greedy','frustrated'),
	`emotionDuring` enum('confident','neutral','anxious','fearful','greedy','frustrated'),
	`emotionAfter` enum('satisfied','neutral','disappointed','frustrated','relieved'),
	`executionRating` int,
	`followedPlan` boolean,
	`screenshots` json,
	`tags` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `tradeJournalEntries_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `idx_journal_userId` ON `tradeJournalEntries` (`userId`);--> statement-breakpoint
CREATE INDEX `idx_journal_tradeId` ON `tradeJournalEntries` (`tradeId`);--> statement-breakpoint
CREATE INDEX `idx_journal_strategy` ON `tradeJournalEntries` (`strategy`);--> statement-breakpoint
CREATE INDEX `idx_journal_createdAt` ON `tradeJournalEntries` (`createdAt`);