ALTER TABLE `agentWeights` ADD `whaleTrackerWeight` varchar(50) DEFAULT '15.00' NOT NULL;--> statement-breakpoint
ALTER TABLE `agentWeights` ADD `fundingRateWeight` varchar(50) DEFAULT '15.00' NOT NULL;--> statement-breakpoint
ALTER TABLE `agentWeights` ADD `liquidationWeight` varchar(50) DEFAULT '15.00' NOT NULL;--> statement-breakpoint
ALTER TABLE `agentWeights` ADD `onChainFlowWeight` varchar(50) DEFAULT '15.00' NOT NULL;--> statement-breakpoint
ALTER TABLE `agentWeights` ADD `volumeProfileWeight` varchar(50) DEFAULT '20.00' NOT NULL;--> statement-breakpoint
ALTER TABLE `agentWeights` ADD `fastAgentMultiplier` varchar(50) DEFAULT '1.00' NOT NULL;--> statement-breakpoint
ALTER TABLE `agentWeights` ADD `slowAgentMultiplier` varchar(50) DEFAULT '0.20' NOT NULL;--> statement-breakpoint
ALTER TABLE `agentWeights` ADD `phase2AgentMultiplier` varchar(50) DEFAULT '0.50' NOT NULL;