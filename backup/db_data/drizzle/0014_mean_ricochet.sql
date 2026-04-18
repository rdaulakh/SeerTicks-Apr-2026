CREATE TABLE `tradingSignals` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`symbol` varchar(20) NOT NULL,
	`signalType` enum('BUY','SELL','NEUTRAL') NOT NULL,
	`source` enum('RSI','MACD','STOCHASTIC','COMBINED') NOT NULL,
	`strength` int NOT NULL,
	`confidence` int NOT NULL,
	`price` decimal(18,8) NOT NULL,
	`indicators` json NOT NULL,
	`reasoning` text NOT NULL,
	`executed` boolean NOT NULL DEFAULT false,
	`executedAt` timestamp,
	`tradeId` int,
	`timestamp` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `tradingSignals_id` PRIMARY KEY(`id`)
);
