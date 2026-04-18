CREATE TABLE `nnPredictions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`modelType` enum('lstm','transformer','ensemble') NOT NULL,
	`symbol` varchar(20) NOT NULL,
	`timeframe` varchar(10) NOT NULL,
	`predictionTimestamp` timestamp NOT NULL,
	`targetTimestamp` timestamp NOT NULL,
	`predictedPrice` decimal(20,8) NOT NULL,
	`predictedDirection` enum('up','down','neutral') NOT NULL,
	`confidence` decimal(6,4) NOT NULL,
	`actualPrice` decimal(20,8),
	`actualDirection` enum('up','down','neutral'),
	`predictionError` decimal(10,6),
	`wasCorrect` boolean,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `nnPredictions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `parameterOptimizationHistory` (
	`id` int AUTO_INCREMENT NOT NULL,
	`optimizationType` enum('strategy_params','agent_weights','risk_params','ml_hyperparams') NOT NULL,
	`targetMetric` varchar(50) NOT NULL,
	`symbol` varchar(20),
	`parameterSpace` text,
	`bestParameters` text,
	`bestScore` decimal(15,6),
	`iterationsCompleted` int NOT NULL DEFAULT 0,
	`totalIterations` int NOT NULL,
	`status` enum('running','completed','failed') NOT NULL DEFAULT 'running',
	`error` text,
	`startTime` timestamp NOT NULL,
	`endTime` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `parameterOptimizationHistory_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `rlModels` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(100) NOT NULL,
	`agentType` enum('dqn','ppo') NOT NULL,
	`symbol` varchar(20) NOT NULL,
	`timeframe` varchar(10) NOT NULL,
	`config` text,
	`modelData` mediumtext,
	`status` enum('training','ready','paper_trading','live','disabled') NOT NULL DEFAULT 'training',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `rlModels_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `rlTrainingHistory` (
	`id` int AUTO_INCREMENT NOT NULL,
	`modelId` int NOT NULL,
	`startTime` timestamp NOT NULL,
	`endTime` timestamp,
	`episodes` int NOT NULL DEFAULT 0,
	`totalTimesteps` int NOT NULL DEFAULT 0,
	`finalPnl` decimal(20,8),
	`finalSharpe` decimal(10,4),
	`finalMaxDrawdown` decimal(10,4),
	`finalWinRate` decimal(6,4),
	`tradeCount` int DEFAULT 0,
	`status` enum('running','completed','failed') NOT NULL DEFAULT 'running',
	`error` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `rlTrainingHistory_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `idx_nn_pred_symbol` ON `nnPredictions` (`symbol`);--> statement-breakpoint
CREATE INDEX `idx_nn_pred_model` ON `nnPredictions` (`modelType`);--> statement-breakpoint
CREATE INDEX `idx_nn_pred_target` ON `nnPredictions` (`targetTimestamp`);--> statement-breakpoint
CREATE INDEX `idx_nn_pred_timestamp` ON `nnPredictions` (`predictionTimestamp`);--> statement-breakpoint
CREATE INDEX `idx_param_opt_type` ON `parameterOptimizationHistory` (`optimizationType`);--> statement-breakpoint
CREATE INDEX `idx_param_opt_status` ON `parameterOptimizationHistory` (`status`);--> statement-breakpoint
CREATE INDEX `idx_param_opt_time` ON `parameterOptimizationHistory` (`startTime`);--> statement-breakpoint
CREATE INDEX `idx_rl_models_symbol` ON `rlModels` (`symbol`);--> statement-breakpoint
CREATE INDEX `idx_rl_models_status` ON `rlModels` (`status`);--> statement-breakpoint
CREATE INDEX `idx_rl_models_type` ON `rlModels` (`agentType`);--> statement-breakpoint
CREATE INDEX `idx_rl_training_model` ON `rlTrainingHistory` (`modelId`);--> statement-breakpoint
CREATE INDEX `idx_rl_training_status` ON `rlTrainingHistory` (`status`);--> statement-breakpoint
CREATE INDEX `idx_rl_training_time` ON `rlTrainingHistory` (`startTime`);