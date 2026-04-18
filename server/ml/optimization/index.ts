/**
 * Optimization Module
 * 
 * Exports Bayesian optimization and self-tuning components
 */

export { BayesianOptimizer } from './BayesianOptimizer';
export type { 
  ParameterSpace, 
  OptimizationConfig, 
  OptimizationResult 
} from './BayesianOptimizer';

export { SelfOptimizer, getSelfOptimizer } from './SelfOptimizer';
export type { 
  OptimizationType,
  OptimizationTask,
  StrategyParams,
  AgentWeights,
  RiskParams,
  MLHyperparams
} from './SelfOptimizer';
