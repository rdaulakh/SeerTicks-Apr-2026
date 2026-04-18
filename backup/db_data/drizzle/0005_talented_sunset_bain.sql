ALTER TABLE `positions` ADD `orderId` varchar(100);--> statement-breakpoint
ALTER TABLE `positions` ADD `clientOrderId` varchar(100);--> statement-breakpoint
ALTER TABLE `positions` ADD `orderStatus` enum('PENDING','OPEN','FILLED','CANCELLED','EXPIRED','FAILED') DEFAULT 'PENDING';