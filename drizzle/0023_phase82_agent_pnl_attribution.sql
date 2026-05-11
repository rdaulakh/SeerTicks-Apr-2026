-- Phase 82 — per-agent signed $-P&L attribution
-- One row per (closed trade, agent). Lets the operator see each agent's
-- dollar contribution to the book, not just boolean accuracy.

CREATE TABLE `agentPnlAttribution` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`tradeId` int NOT NULL,
	`agentName` varchar(64) NOT NULL,
	`symbol` varchar(20) NOT NULL,
	`tradeSide` enum('long','short') NOT NULL,
	`agentDirection` varchar(16) NOT NULL,
	`agentConfidence` decimal(6,4),
	`pnlContribution` decimal(18,6) NOT NULL,
	`tradePnl` decimal(18,6) NOT NULL,
	`wasCorrect` boolean NOT NULL,
	`tradeQualityScore` varchar(2),
	`exitReason` varchar(64),
	`tradingMode` varchar(10),
	`closedAt` timestamp NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `agentPnlAttribution_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `idx_agent_pnl_user_agent` ON `agentPnlAttribution` (`userId`,`agentName`);--> statement-breakpoint
CREATE INDEX `idx_agent_pnl_trade` ON `agentPnlAttribution` (`tradeId`);--> statement-breakpoint
CREATE INDEX `idx_agent_pnl_closed` ON `agentPnlAttribution` (`closedAt`);--> statement-breakpoint
CREATE INDEX `idx_agent_pnl_agent_symbol` ON `agentPnlAttribution` (`agentName`,`symbol`);
