CREATE TABLE `balanceVerificationLog` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`exchangeId` int NOT NULL,
	`verificationType` enum('pre_live_switch','pre_trade','periodic_check','manual_check') NOT NULL,
	`availableBalance` decimal(20,8) NOT NULL,
	`totalBalance` decimal(20,8) NOT NULL,
	`marginUsed` decimal(20,8),
	`currency` varchar(10) NOT NULL,
	`minimumRequired` decimal(20,8) NOT NULL,
	`isVerified` boolean NOT NULL,
	`verificationMessage` text,
	`actionAllowed` boolean NOT NULL,
	`actionBlocked` boolean NOT NULL,
	`blockReason` text,
	`exchangeResponse` json,
	`latencyMs` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `balanceVerificationLog_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `tradingActivityLog` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`activityType` enum('order_placed','order_filled','order_partially_filled','order_rejected','order_cancelled','order_modified','position_opened','position_closed','stop_loss_triggered','take_profit_triggered','margin_call','balance_check','mode_switch') NOT NULL,
	`tradingMode` enum('paper','live') NOT NULL,
	`orderId` varchar(64),
	`tradeId` int,
	`positionId` int,
	`exchangeId` int,
	`symbol` varchar(20),
	`side` enum('buy','sell','long','short'),
	`orderType` enum('market','limit','stop','stop_limit'),
	`quantity` decimal(20,8),
	`price` decimal(20,8),
	`filledQuantity` decimal(20,8),
	`filledPrice` decimal(20,8),
	`status` enum('success','failed','pending','partial') NOT NULL,
	`errorCode` varchar(50),
	`errorMessage` text,
	`fees` decimal(20,8),
	`pnl` decimal(20,8),
	`balanceBefore` decimal(20,8),
	`balanceAfter` decimal(20,8),
	`triggeredBy` enum('user','system','ai_agent','stop_loss','take_profit','margin_call'),
	`agentId` varchar(64),
	`signalId` int,
	`metadata` json,
	`timestamp` timestamp NOT NULL DEFAULT (now()),
	`executedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `tradingActivityLog_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `idx_balance_ver_userId` ON `balanceVerificationLog` (`userId`);--> statement-breakpoint
CREATE INDEX `idx_balance_ver_exchangeId` ON `balanceVerificationLog` (`exchangeId`);--> statement-breakpoint
CREATE INDEX `idx_balance_ver_type` ON `balanceVerificationLog` (`verificationType`);--> statement-breakpoint
CREATE INDEX `idx_balance_ver_createdAt` ON `balanceVerificationLog` (`createdAt`);--> statement-breakpoint
CREATE INDEX `idx_activity_userId` ON `tradingActivityLog` (`userId`);--> statement-breakpoint
CREATE INDEX `idx_activity_type` ON `tradingActivityLog` (`activityType`);--> statement-breakpoint
CREATE INDEX `idx_activity_tradingMode` ON `tradingActivityLog` (`tradingMode`);--> statement-breakpoint
CREATE INDEX `idx_activity_symbol` ON `tradingActivityLog` (`symbol`);--> statement-breakpoint
CREATE INDEX `idx_activity_status` ON `tradingActivityLog` (`status`);--> statement-breakpoint
CREATE INDEX `idx_activity_timestamp` ON `tradingActivityLog` (`timestamp`);--> statement-breakpoint
CREATE INDEX `idx_activity_orderId` ON `tradingActivityLog` (`orderId`);