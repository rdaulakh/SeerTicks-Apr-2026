CREATE TABLE `executionLatencyLogs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`signalId` varchar(64) NOT NULL,
	`symbol` varchar(20) NOT NULL,
	`signalGeneratedAt` bigint NOT NULL,
	`consensusCalculatedAt` bigint,
	`decisionMadeAt` bigint,
	`orderPlacedAt` bigint,
	`orderFilledAt` bigint,
	`signalToConsensusMs` int,
	`consensusToDecisionMs` int,
	`decisionToOrderMs` int,
	`orderToFillMs` int,
	`totalLatencyMs` int NOT NULL,
	`executionResult` enum('executed','rejected','skipped','failed','timeout') NOT NULL,
	`agentCount` int NOT NULL,
	`consensusStrength` varchar(50),
	`priceAtSignal` varchar(50),
	`priceAtExecution` varchar(50),
	`slippageMs` int,
	`latencyGrade` enum('excellent','good','acceptable','slow','critical') NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `executionLatencyLogs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `idx_ell_userId` ON `executionLatencyLogs` (`userId`);--> statement-breakpoint
CREATE INDEX `idx_ell_symbol` ON `executionLatencyLogs` (`symbol`);--> statement-breakpoint
CREATE INDEX `idx_ell_latencyGrade` ON `executionLatencyLogs` (`latencyGrade`);--> statement-breakpoint
CREATE INDEX `idx_ell_createdAt` ON `executionLatencyLogs` (`createdAt`);--> statement-breakpoint
CREATE INDEX `idx_ell_totalLatency` ON `executionLatencyLogs` (`totalLatencyMs`);