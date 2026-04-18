CREATE TABLE `engineState` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`isRunning` boolean NOT NULL DEFAULT false,
	`startedAt` timestamp,
	`stoppedAt` timestamp,
	`config` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `engineState_id` PRIMARY KEY(`id`),
	CONSTRAINT `engineState_userId_unique` UNIQUE(`userId`)
);
