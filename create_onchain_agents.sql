-- Create onchainAgents table
CREATE TABLE IF NOT EXISTS `onchainAgents` (
  `id` int AUTO_INCREMENT PRIMARY KEY,
  `userId` int NOT NULL,
  `name` varchar(100) NOT NULL,
  `description` text,
  `avatar` varchar(255),
  `agentType` enum('whale_tracker','market_analyzer','trading_strategist','risk_manager','sentiment_analyst','arbitrage_hunter','custom') NOT NULL,
  `config` json,
  `status` enum('active','paused','stopped','error') NOT NULL DEFAULT 'stopped',
  `lastRunAt` timestamp,
  `nextRunAt` timestamp,
  `errorMessage` text,
  `totalRuns` int NOT NULL DEFAULT 0,
  `successfulRuns` int NOT NULL DEFAULT 0,
  `totalSignals` int NOT NULL DEFAULT 0,
  `accurateSignals` int NOT NULL DEFAULT 0,
  `canExecuteTrades` boolean NOT NULL DEFAULT false,
  `canSendAlerts` boolean NOT NULL DEFAULT true,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX `idx_agent_userId` (`userId`),
  INDEX `idx_agent_status` (`status`),
  INDEX `idx_agent_type` (`agentType`)
);

-- Create agentActivities table
CREATE TABLE IF NOT EXISTS `agentActivities` (
  `id` int AUTO_INCREMENT PRIMARY KEY,
  `agentId` int NOT NULL,
  `userId` int NOT NULL,
  `activityType` enum('analysis','signal','alert','trade_executed','whale_detected','risk_warning','insight','error') NOT NULL,
  `title` varchar(200) NOT NULL,
  `summary` text,
  `details` json,
  `importance` enum('low','medium','high','critical') NOT NULL DEFAULT 'medium',
  `isRead` boolean NOT NULL DEFAULT false,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX `idx_activity_agentId` (`agentId`),
  INDEX `idx_activity_userId` (`userId`),
  INDEX `idx_activity_type` (`activityType`),
  INDEX `idx_activity_createdAt` (`createdAt`),
  INDEX `idx_activity_importance` (`importance`)
);

-- Create agentWatchedWallets table
CREATE TABLE IF NOT EXISTS `agentWatchedWallets` (
  `id` int AUTO_INCREMENT PRIMARY KEY,
  `agentId` int NOT NULL,
  `userId` int NOT NULL,
  `address` varchar(100) NOT NULL,
  `chain` enum('ethereum','bitcoin','solana','polygon','arbitrum','optimism','base','avalanche') NOT NULL,
  `label` varchar(100),
  `minTransactionValue` decimal(20,2) DEFAULT 100000,
  `trackIncoming` boolean NOT NULL DEFAULT true,
  `trackOutgoing` boolean NOT NULL DEFAULT true,
  `totalTransactions` int NOT NULL DEFAULT 0,
  `lastTransactionAt` timestamp,
  `isActive` boolean NOT NULL DEFAULT true,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX `idx_wallet_agentId` (`agentId`),
  INDEX `idx_wallet_address` (`address`),
  INDEX `idx_wallet_chain` (`chain`)
);

-- Create onchainAgentSignals table
CREATE TABLE IF NOT EXISTS `onchainAgentSignals` (
  `id` int AUTO_INCREMENT PRIMARY KEY,
  `agentId` int NOT NULL,
  `userId` int NOT NULL,
  `symbol` varchar(20) NOT NULL,
  `signal` enum('strong_buy','buy','hold','sell','strong_sell') NOT NULL,
  `confidence` decimal(5,2) NOT NULL,
  `currentPrice` decimal(20,8) NOT NULL,
  `entryPrice` decimal(20,8),
  `targetPrice` decimal(20,8),
  `stopLoss` decimal(20,8),
  `reasoning` text,
  `indicators` json,
  `timeframe` varchar(10) NOT NULL,
  `validUntil` timestamp NOT NULL,
  `status` enum('pending','executed','expired','cancelled') NOT NULL DEFAULT 'pending',
  `outcome` enum('win','loss','breakeven','pending') NOT NULL DEFAULT 'pending',
  `actualExitPrice` decimal(20,8),
  `pnlPercent` decimal(10,4),
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX `idx_oc_signal_agentId` (`agentId`),
  INDEX `idx_oc_signal_userId` (`userId`),
  INDEX `idx_oc_signal_symbol` (`symbol`),
  INDEX `idx_oc_signal_status` (`status`),
  INDEX `idx_oc_signal_createdAt` (`createdAt`)
);
