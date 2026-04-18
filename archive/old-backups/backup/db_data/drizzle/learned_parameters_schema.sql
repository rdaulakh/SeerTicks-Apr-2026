-- Learned Parameters Table
-- Stores dynamically learned thresholds and parameters that adapt over time

CREATE TABLE IF NOT EXISTS `learnedParameters` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `parameterName` VARCHAR(100) NOT NULL,
  `parameterType` ENUM('consensus_threshold', 'agent_confidence', 'alpha_criteria', 'regime_multiplier', 'other') NOT NULL,
  `symbol` VARCHAR(20) NULL, -- NULL for global parameters
  `regime` VARCHAR(50) NULL, -- NULL for non-regime-specific parameters
  `agentName` VARCHAR(50) NULL, -- NULL for non-agent-specific parameters
  `value` DECIMAL(10, 6) NOT NULL,
  `confidence` DECIMAL(5, 4) NOT NULL DEFAULT 0.5000, -- Confidence in this parameter value (0-1)
  `sampleSize` INT NOT NULL DEFAULT 0, -- Number of trades used to learn this parameter
  `winRate` DECIMAL(5, 4) NULL, -- Win rate associated with this parameter
  `sharpeRatio` DECIMAL(6, 3) NULL, -- Sharpe ratio associated with this parameter
  `lastUpdated` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY `unique_parameter` (`parameterName`, `symbol`, `regime`, `agentName`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Index for fast lookups
CREATE INDEX `idx_parameter_lookup` ON `learnedParameters` (`parameterName`, `symbol`, `regime`);
CREATE INDEX `idx_agent_lookup` ON `learnedParameters` (`agentName`, `parameterName`);
CREATE INDEX `idx_last_updated` ON `learnedParameters` (`lastUpdated` DESC);

-- Example data:
-- Consensus threshold for BTC in trending_up regime
INSERT INTO `learnedParameters` (`parameterName`, `parameterType`, `symbol`, `regime`, `value`, `confidence`, `sampleSize`, `winRate`, `sharpeRatio`)
VALUES ('consensus_threshold', 'consensus_threshold', 'BTCUSDT', 'trending_up', 0.12, 0.85, 150, 0.62, 1.85)
ON DUPLICATE KEY UPDATE 
  `value` = VALUES(`value`),
  `confidence` = VALUES(`confidence`),
  `sampleSize` = VALUES(`sampleSize`),
  `winRate` = VALUES(`winRate`),
  `sharpeRatio` = VALUES(`sharpeRatio`);

-- Agent-specific confidence threshold for MacroAnalyst
INSERT INTO `learnedParameters` (`parameterName`, `parameterType`, `agentName`, `value`, `confidence`, `sampleSize`, `winRate`)
VALUES ('min_confidence', 'agent_confidence', 'MacroAnalyst', 0.25, 0.90, 200, 0.68)
ON DUPLICATE KEY UPDATE 
  `value` = VALUES(`value`),
  `confidence` = VALUES(`confidence`),
  `sampleSize` = VALUES(`sampleSize`),
  `winRate` = VALUES(`winRate`);
