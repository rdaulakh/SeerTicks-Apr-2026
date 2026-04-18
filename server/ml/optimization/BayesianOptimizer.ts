/**
 * Bayesian Optimization for Hyperparameter Tuning
 * 
 * Implements Gaussian Process-based Bayesian optimization for
 * efficient hyperparameter search in trading strategies and ML models.
 */

export interface ParameterSpace {
  name: string;
  type: 'continuous' | 'integer' | 'categorical';
  min?: number;
  max?: number;
  values?: (string | number)[];
}

export interface OptimizationConfig {
  maxIterations: number;
  explorationRate: number;     // Balance exploration vs exploitation
  acquisitionFunction: 'ei' | 'ucb' | 'poi';  // Expected Improvement, Upper Confidence Bound, Probability of Improvement
  randomInitPoints: number;    // Number of random points before optimization
  convergenceThreshold: number;
}

export interface OptimizationResult {
  bestParameters: Record<string, number | string>;
  bestScore: number;
  iterationHistory: Array<{
    iteration: number;
    parameters: Record<string, number | string>;
    score: number;
    acquisitionValue: number;
  }>;
  convergenceIteration: number | null;
  totalIterations: number;
}

interface GaussianProcessPoint {
  x: number[];
  y: number;
}

export class BayesianOptimizer {
  private config: OptimizationConfig;
  private parameterSpace: ParameterSpace[];
  private observedPoints: GaussianProcessPoint[] = [];
  private bestScore: number = -Infinity;
  private bestParameters: Record<string, number | string> = {};
  private iterationHistory: OptimizationResult['iterationHistory'] = [];
  
  // Gaussian Process hyperparameters
  private lengthScale: number = 1.0;
  private signalVariance: number = 1.0;
  private noiseVariance: number = 0.01;
  
  constructor(
    parameterSpace: ParameterSpace[],
    config: Partial<OptimizationConfig> = {}
  ) {
    this.parameterSpace = parameterSpace;
    this.config = {
      maxIterations: 50,
      explorationRate: 0.1,
      acquisitionFunction: 'ei',
      randomInitPoints: 5,
      convergenceThreshold: 0.001,
      ...config
    };
  }
  
  /**
   * Run optimization with objective function
   */
  async optimize(
    objectiveFunction: (params: Record<string, number | string>) => Promise<number>,
    onIteration?: (iteration: number, params: Record<string, number | string>, score: number) => void
  ): Promise<OptimizationResult> {
    // Random initialization
    for (let i = 0; i < this.config.randomInitPoints; i++) {
      const params = this.sampleRandom();
      const score = await objectiveFunction(params);
      this.addObservation(params, score);
      
      if (onIteration) {
        onIteration(i, params, score);
      }
    }
    
    let convergenceIteration: number | null = null;
    let previousBestScore = this.bestScore;
    let stagnationCount = 0;
    
    // Bayesian optimization loop
    for (let i = this.config.randomInitPoints; i < this.config.maxIterations; i++) {
      // Find next point to evaluate using acquisition function
      const { params, acquisitionValue } = this.suggestNext();
      
      // Evaluate objective function
      const score = await objectiveFunction(params);
      this.addObservation(params, score);
      
      this.iterationHistory.push({
        iteration: i,
        parameters: params,
        score,
        acquisitionValue
      });
      
      if (onIteration) {
        onIteration(i, params, score);
      }
      
      // Check for convergence
      if (Math.abs(this.bestScore - previousBestScore) < this.config.convergenceThreshold) {
        stagnationCount++;
        if (stagnationCount >= 5 && convergenceIteration === null) {
          convergenceIteration = i;
        }
      } else {
        stagnationCount = 0;
        previousBestScore = this.bestScore;
      }
    }
    
    return {
      bestParameters: this.bestParameters,
      bestScore: this.bestScore,
      iterationHistory: this.iterationHistory,
      convergenceIteration,
      totalIterations: this.config.maxIterations
    };
  }
  
  /**
   * Sample random parameters from the space
   */
  private sampleRandom(): Record<string, number | string> {
    const params: Record<string, number | string> = {};
    
    for (const param of this.parameterSpace) {
      if (param.type === 'continuous' && param.min !== undefined && param.max !== undefined) {
        params[param.name] = param.min + Math.random() * (param.max - param.min);
      } else if (param.type === 'integer' && param.min !== undefined && param.max !== undefined) {
        params[param.name] = Math.floor(param.min + Math.random() * (param.max - param.min + 1));
      } else if (param.type === 'categorical' && param.values) {
        params[param.name] = param.values[Math.floor(Math.random() * param.values.length)];
      }
    }
    
    return params;
  }
  
  /**
   * Convert parameters to normalized vector
   */
  private paramsToVector(params: Record<string, number | string>): number[] {
    const vector: number[] = [];
    
    for (const param of this.parameterSpace) {
      if (param.type === 'continuous' || param.type === 'integer') {
        const value = params[param.name] as number;
        const min = param.min ?? 0;
        const max = param.max ?? 1;
        vector.push((value - min) / (max - min));
      } else if (param.type === 'categorical' && param.values) {
        const index = param.values.indexOf(params[param.name]);
        vector.push(index / (param.values.length - 1));
      }
    }
    
    return vector;
  }
  
  /**
   * Convert normalized vector to parameters
   */
  private vectorToParams(vector: number[]): Record<string, number | string> {
    const params: Record<string, number | string> = {};
    
    for (let i = 0; i < this.parameterSpace.length; i++) {
      const param = this.parameterSpace[i];
      const value = vector[i];
      
      if (param.type === 'continuous' && param.min !== undefined && param.max !== undefined) {
        params[param.name] = param.min + value * (param.max - param.min);
      } else if (param.type === 'integer' && param.min !== undefined && param.max !== undefined) {
        params[param.name] = Math.round(param.min + value * (param.max - param.min));
      } else if (param.type === 'categorical' && param.values) {
        const index = Math.round(value * (param.values.length - 1));
        params[param.name] = param.values[index];
      }
    }
    
    return params;
  }
  
  /**
   * Add observation to the Gaussian Process
   */
  private addObservation(params: Record<string, number | string>, score: number): void {
    const x = this.paramsToVector(params);
    this.observedPoints.push({ x, y: score });
    
    if (score > this.bestScore) {
      this.bestScore = score;
      this.bestParameters = { ...params };
    }
  }
  
  /**
   * RBF (Radial Basis Function) kernel
   */
  private rbfKernel(x1: number[], x2: number[]): number {
    let sqDist = 0;
    for (let i = 0; i < x1.length; i++) {
      sqDist += Math.pow(x1[i] - x2[i], 2);
    }
    return this.signalVariance * Math.exp(-sqDist / (2 * this.lengthScale * this.lengthScale));
  }
  
  /**
   * Compute covariance matrix
   */
  private computeCovarianceMatrix(points: number[][]): number[][] {
    const n = points.length;
    const K: number[][] = [];
    
    for (let i = 0; i < n; i++) {
      K[i] = [];
      for (let j = 0; j < n; j++) {
        K[i][j] = this.rbfKernel(points[i], points[j]);
        if (i === j) {
          K[i][j] += this.noiseVariance;
        }
      }
    }
    
    return K;
  }
  
  /**
   * Compute cross-covariance vector
   */
  private computeCrossCovariance(points: number[][], x: number[]): number[] {
    return points.map(p => this.rbfKernel(p, x));
  }
  
  /**
   * Cholesky decomposition for matrix inversion
   */
  private choleskyDecomposition(A: number[][]): number[][] {
    const n = A.length;
    const L: number[][] = Array(n).fill(null).map(() => Array(n).fill(0));
    
    for (let i = 0; i < n; i++) {
      for (let j = 0; j <= i; j++) {
        let sum = 0;
        for (let k = 0; k < j; k++) {
          sum += L[i][k] * L[j][k];
        }
        
        if (i === j) {
          L[i][j] = Math.sqrt(Math.max(0.0001, A[i][i] - sum));
        } else {
          L[i][j] = (A[i][j] - sum) / L[j][j];
        }
      }
    }
    
    return L;
  }
  
  /**
   * Solve linear system using Cholesky decomposition
   */
  private choleskySolve(L: number[][], b: number[]): number[] {
    const n = L.length;
    
    // Forward substitution: Ly = b
    const y: number[] = Array(n).fill(0);
    for (let i = 0; i < n; i++) {
      let sum = 0;
      for (let j = 0; j < i; j++) {
        sum += L[i][j] * y[j];
      }
      y[i] = (b[i] - sum) / L[i][i];
    }
    
    // Backward substitution: L^T x = y
    const x: number[] = Array(n).fill(0);
    for (let i = n - 1; i >= 0; i--) {
      let sum = 0;
      for (let j = i + 1; j < n; j++) {
        sum += L[j][i] * x[j];
      }
      x[i] = (y[i] - sum) / L[i][i];
    }
    
    return x;
  }
  
  /**
   * Predict mean and variance at a point
   */
  private predict(x: number[]): { mean: number; variance: number } {
    if (this.observedPoints.length === 0) {
      return { mean: 0, variance: this.signalVariance };
    }
    
    const X = this.observedPoints.map(p => p.x);
    const y = this.observedPoints.map(p => p.y);
    
    const K = this.computeCovarianceMatrix(X);
    const k = this.computeCrossCovariance(X, x);
    const kStar = this.rbfKernel(x, x) + this.noiseVariance;
    
    const L = this.choleskyDecomposition(K);
    const alpha = this.choleskySolve(L, y);
    
    // Mean prediction
    let mean = 0;
    for (let i = 0; i < k.length; i++) {
      mean += k[i] * alpha[i];
    }
    
    // Variance prediction
    const v = this.choleskySolve(L, k);
    let variance = kStar;
    for (let i = 0; i < v.length; i++) {
      variance -= v[i] * k[i];
    }
    variance = Math.max(0.0001, variance);
    
    return { mean, variance };
  }
  
  /**
   * Expected Improvement acquisition function
   */
  private expectedImprovement(x: number[]): number {
    const { mean, variance } = this.predict(x);
    const std = Math.sqrt(variance);
    
    if (std < 1e-10) return 0;
    
    const improvement = mean - this.bestScore - this.config.explorationRate;
    const z = improvement / std;
    
    // Approximate normal CDF and PDF
    const cdf = 0.5 * (1 + Math.tanh(z * 0.7978845608));
    const pdf = Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI);
    
    return improvement * cdf + std * pdf;
  }
  
  /**
   * Upper Confidence Bound acquisition function
   */
  private upperConfidenceBound(x: number[]): number {
    const { mean, variance } = this.predict(x);
    const std = Math.sqrt(variance);
    const beta = 2.0 + 0.5 * Math.log(this.observedPoints.length + 1);
    return mean + Math.sqrt(beta) * std;
  }
  
  /**
   * Probability of Improvement acquisition function
   */
  private probabilityOfImprovement(x: number[]): number {
    const { mean, variance } = this.predict(x);
    const std = Math.sqrt(variance);
    
    if (std < 1e-10) return 0;
    
    const z = (mean - this.bestScore - this.config.explorationRate) / std;
    return 0.5 * (1 + Math.tanh(z * 0.7978845608));
  }
  
  /**
   * Compute acquisition function value
   */
  private acquisitionFunction(x: number[]): number {
    switch (this.config.acquisitionFunction) {
      case 'ei':
        return this.expectedImprovement(x);
      case 'ucb':
        return this.upperConfidenceBound(x);
      case 'poi':
        return this.probabilityOfImprovement(x);
      default:
        return this.expectedImprovement(x);
    }
  }
  
  /**
   * Suggest next point to evaluate
   */
  private suggestNext(): { params: Record<string, number | string>; acquisitionValue: number } {
    // Grid search over acquisition function
    const numSamples = 1000;
    let bestX: number[] = [];
    let bestAcquisition = -Infinity;
    
    for (let i = 0; i < numSamples; i++) {
      const x = this.parameterSpace.map(() => Math.random());
      const acquisition = this.acquisitionFunction(x);
      
      if (acquisition > bestAcquisition) {
        bestAcquisition = acquisition;
        bestX = x;
      }
    }
    
    // Local optimization around best point
    const step = 0.01;
    for (let iter = 0; iter < 10; iter++) {
      const gradient = bestX.map((_, i) => {
        const xPlus = [...bestX];
        const xMinus = [...bestX];
        xPlus[i] = Math.min(1, xPlus[i] + step);
        xMinus[i] = Math.max(0, xMinus[i] - step);
        return (this.acquisitionFunction(xPlus) - this.acquisitionFunction(xMinus)) / (2 * step);
      });
      
      bestX = bestX.map((v, i) => Math.max(0, Math.min(1, v + 0.1 * gradient[i])));
    }
    
    return {
      params: this.vectorToParams(bestX),
      acquisitionValue: bestAcquisition
    };
  }
  
  /**
   * Get current best parameters
   */
  getBestParameters(): Record<string, number | string> {
    return { ...this.bestParameters };
  }
  
  /**
   * Get current best score
   */
  getBestScore(): number {
    return this.bestScore;
  }
  
  /**
   * Get iteration history
   */
  getIterationHistory(): OptimizationResult['iterationHistory'] {
    return [...this.iterationHistory];
  }
  
  /**
   * Reset optimizer state
   */
  reset(): void {
    this.observedPoints = [];
    this.bestScore = -Infinity;
    this.bestParameters = {};
    this.iterationHistory = [];
  }
}

export default BayesianOptimizer;
