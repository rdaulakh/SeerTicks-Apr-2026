CREATE TABLE `learnedParameters` (
	`id` int AUTO_INCREMENT NOT NULL,
	`parameterName` varchar(100) NOT NULL,
	`parameterType` enum('consensus_threshold','agent_confidence','alpha_criteria','regime_multiplier','other') NOT NULL,
	`symbol` varchar(20),
	`regime` varchar(50),
	`agentName` varchar(50),
	`value` decimal(10,6) NOT NULL,
	`confidence` decimal(5,4) NOT NULL DEFAULT '0.5000',
	`sampleSize` int NOT NULL DEFAULT 0,
	`winRate` decimal(5,4),
	`sharpeRatio` decimal(6,3),
	`lastUpdated` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `learnedParameters_id` PRIMARY KEY(`id`),
	CONSTRAINT `unique_parameter` UNIQUE(`parameterName`,`symbol`,`regime`,`agentName`)
);
--> statement-breakpoint
CREATE INDEX `idx_parameter_lookup` ON `learnedParameters` (`parameterName`,`symbol`,`regime`);--> statement-breakpoint
CREATE INDEX `idx_agent_lookup` ON `learnedParameters` (`agentName`,`parameterName`);--> statement-breakpoint
CREATE INDEX `idx_last_updated` ON `learnedParameters` (`lastUpdated`);