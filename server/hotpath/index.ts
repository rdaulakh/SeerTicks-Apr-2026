/**
 * Hot Path Module Exports
 * Real-time data ingestion, deviation detection, and path monitoring
 */

export { getRedisClient, closeRedis, RedisKeys, RedisHelpers } from "./redisClient";
export { 
  WebSocketManager, 
  getWSManager, 
  closeWSManager,
  WSManagerEvents,
  type StreamConfig,
  type TickEvent,
} from "./WebSocketManager";
export {
  DeviationEngine,
  getDeviationEngine,
  type ExpectedPath,
  type PathMilestone,
  type DeviationScore,
} from "./DeviationEngine";
export {
  HotPathOrchestrator,
  getHotPath,
  shutdownHotPath,
  HotPathEvents,
  type DeviationAlert,
  type ExitSignal,
} from "./HotPathOrchestrator";
