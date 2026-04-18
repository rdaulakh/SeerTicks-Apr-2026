CREATE TABLE `candleData` (
	`id` int AUTO_INCREMENT NOT NULL,
	`symbol` varchar(20) NOT NULL,
	`timestamp` timestamp NOT NULL,
	`open` varchar(50) NOT NULL,
	`high` varchar(50) NOT NULL,
	`low` varchar(50) NOT NULL,
	`close` varchar(50) NOT NULL,
	`volume` varchar(50) NOT NULL,
	`interval` varchar(10) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `candleData_id` PRIMARY KEY(`id`)
);
