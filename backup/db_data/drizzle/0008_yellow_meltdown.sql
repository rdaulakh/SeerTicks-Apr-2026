CREATE TABLE `healthMetrics` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`p50Latency` int NOT NULL,
	`p95Latency` int NOT NULL,
	`p99Latency` int NOT NULL,
	`avgLatency` int NOT NULL,
	`totalTraces` int NOT NULL,
	`completedTraces` int NOT NULL,
	`failedTraces` int NOT NULL,
	`errorRate` int NOT NULL,
	`agentHealth` json,
	`timestamp` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `healthMetrics_id` PRIMARY KEY(`id`)
);
