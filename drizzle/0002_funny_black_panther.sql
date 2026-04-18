ALTER TABLE `paperPositions` ADD `originalConsensus` varchar(50);--> statement-breakpoint
ALTER TABLE `paperPositions` ADD `currentConfidence` varchar(50);--> statement-breakpoint
ALTER TABLE `paperPositions` ADD `peakConfidence` varchar(50);--> statement-breakpoint
ALTER TABLE `paperPositions` ADD `peakConfidenceTime` timestamp;