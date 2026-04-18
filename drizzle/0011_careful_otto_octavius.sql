CREATE TABLE `globalSymbols` (
	`id` int AUTO_INCREMENT NOT NULL,
	`symbol` varchar(20) NOT NULL,
	`exchange` varchar(50) NOT NULL DEFAULT 'coinbase',
	`isActive` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `globalSymbols_id` PRIMARY KEY(`id`),
	CONSTRAINT `globalSymbols_symbol_unique` UNIQUE(`symbol`)
);
