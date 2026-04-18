CREATE TABLE `agentActivities` (
	`id` int AUTO_INCREMENT NOT NULL,
	`agentId` int NOT NULL,
	`userId` int NOT NULL,
	`activityType` enum('analysis','signal','alert','trade_executed','whale_detected','risk_warning','insight','error') NOT NULL,
	`title` varchar(200) NOT NULL,
	`summary` text,
	`details` json,
	`importance` enum('low','medium','high','critical') NOT NULL DEFAULT 'medium',
	`isRead` boolean NOT NULL DEFAULT false,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `agentActivities_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `agentWatchedWallets` (
	`id` int AUTO_INCREMENT NOT NULL,
	`agentId` int NOT NULL,
	`userId` int NOT NULL,
	`address` varchar(100) NOT NULL,
	`chain` enum('ethereum','bitcoin','solana','polygon','arbitrum','optimism','base','avalanche') NOT NULL,
	`label` varchar(100),
	`minTransactionValue` decimal(20,2) DEFAULT '100000',
	`trackIncoming` boolean NOT NULL DEFAULT true,
	`trackOutgoing` boolean NOT NULL DEFAULT true,
	`totalTransactions` int NOT NULL DEFAULT 0,
	`lastTransactionAt` timestamp,
	`isActive` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `agentWatchedWallets_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `onchainAgentSignals` (
	`id` int AUTO_INCREMENT NOT NULL,
	`agentId` int NOT NULL,
	`userId` int NOT NULL,
	`symbol` varchar(20) NOT NULL,
	`signal` enum('strong_buy','buy','hold','sell','strong_sell') NOT NULL,
	`confidence` decimal(5,2) NOT NULL,
	`currentPrice` decimal(20,8) NOT NULL,
	`entryPrice` decimal(20,8),
	`targetPrice` decimal(20,8),
	`stopLoss` decimal(20,8),
	`reasoning` text,
	`indicators` json,
	`timeframe` varchar(10) NOT NULL,
	`validUntil` timestamp NOT NULL,
	`status` enum('pending','executed','expired','cancelled') NOT NULL DEFAULT 'pending',
	`outcome` enum('win','loss','breakeven','pending') NOT NULL DEFAULT 'pending',
	`actualExitPrice` decimal(20,8),
	`pnlPercent` decimal(10,4),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `onchainAgentSignals_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `onchainAgents` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`name` varchar(100) NOT NULL,
	`description` text,
	`avatar` varchar(255),
	`agentType` enum('whale_tracker','market_analyzer','trading_strategist','risk_manager','sentiment_analyst','arbitrage_hunter','custom') NOT NULL,
	`config` json,
	`status` enum('active','paused','stopped','error') NOT NULL DEFAULT 'stopped',
	`lastRunAt` timestamp,
	`nextRunAt` timestamp,
	`errorMessage` text,
	`totalRuns` int NOT NULL DEFAULT 0,
	`successfulRuns` int NOT NULL DEFAULT 0,
	`totalSignals` int NOT NULL DEFAULT 0,
	`accurateSignals` int NOT NULL DEFAULT 0,
	`canExecuteTrades` boolean NOT NULL DEFAULT false,
	`canSendAlerts` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `onchainAgents_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `idx_activity_agentId` ON `agentActivities` (`agentId`);--> statement-breakpoint
CREATE INDEX `idx_activity_userId` ON `agentActivities` (`userId`);--> statement-breakpoint
CREATE INDEX `idx_activity_type` ON `agentActivities` (`activityType`);--> statement-breakpoint
CREATE INDEX `idx_activity_createdAt` ON `agentActivities` (`createdAt`);--> statement-breakpoint
CREATE INDEX `idx_activity_importance` ON `agentActivities` (`importance`);--> statement-breakpoint
CREATE INDEX `idx_wallet_agentId` ON `agentWatchedWallets` (`agentId`);--> statement-breakpoint
CREATE INDEX `idx_wallet_address` ON `agentWatchedWallets` (`address`);--> statement-breakpoint
CREATE INDEX `idx_wallet_chain` ON `agentWatchedWallets` (`chain`);--> statement-breakpoint
CREATE INDEX `idx_oc_signal_agentId` ON `onchainAgentSignals` (`agentId`);--> statement-breakpoint
CREATE INDEX `idx_oc_signal_userId` ON `onchainAgentSignals` (`userId`);--> statement-breakpoint
CREATE INDEX `idx_oc_signal_symbol` ON `onchainAgentSignals` (`symbol`);--> statement-breakpoint
CREATE INDEX `idx_oc_signal_status` ON `onchainAgentSignals` (`status`);--> statement-breakpoint
CREATE INDEX `idx_oc_signal_createdAt` ON `onchainAgentSignals` (`createdAt`);--> statement-breakpoint
CREATE INDEX `idx_agent_userId` ON `onchainAgents` (`userId`);--> statement-breakpoint
CREATE INDEX `idx_agent_status` ON `onchainAgents` (`status`);--> statement-breakpoint
CREATE INDEX `idx_agent_type` ON `onchainAgents` (`agentType`);