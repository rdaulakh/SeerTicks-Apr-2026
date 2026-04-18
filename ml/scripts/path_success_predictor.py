#!/usr/bin/env python3
"""
Path Success Predictor - XGBoost Model for Trade Success Prediction

Predicts the probability of trade success based on:
- Agent signals (18 features): confidence, strength, quality for all 6 agents
- Pattern metrics (3 features): alpha score, similarity, times used
- Consensus metrics (3 features): score, confidence, agreeing agents
- Market conditions (6 features): volatility, volume ratio, trend strength, RSI, MACD, BB position
- Risk metrics (3 features): risk/reward ratio, position size, expected return
- Macro indicators (4 features): VIX, DXY, S&P 500 change, stablecoin change

Total: 35 input features
Output: Binary classification (success/failure)
"""

import sys
import json
import pickle
import os
from pathlib import Path
import numpy as np
import pandas as pd
from xgboost import XGBClassifier
from sklearn.model_selection import train_test_split
from sklearn.metrics import accuracy_score, roc_auc_score

# Model path
MODEL_DIR = Path(__file__).parent.parent / 'models'
MODEL_PATH = MODEL_DIR / 'path_success.pkl'

# Feature names (35 features)
FEATURE_NAMES = [
    # Agent signals (18 features)
    'technical_confidence', 'technical_strength', 'technical_quality',
    'pattern_confidence', 'pattern_strength', 'pattern_quality',
    'orderflow_confidence', 'orderflow_strength', 'orderflow_quality',
    'sentiment_confidence', 'sentiment_strength', 'sentiment_quality',
    'news_confidence', 'news_strength', 'news_quality',
    'macro_confidence', 'macro_strength', 'macro_quality',
    
    # Pattern metrics (3 features)
    'pattern_alpha', 'pattern_similarity', 'pattern_times_used',
    
    # Consensus metrics (3 features)
    'consensus_score', 'consensus_confidence', 'agreeing_agents',
    
    # Market conditions (6 features)
    'volatility', 'volume_ratio', 'trend_strength', 'rsi', 'macd', 'bb_position',
    
    # Risk metrics (3 features)
    'risk_reward_ratio', 'position_size', 'expected_return',
    
    # Macro indicators (4 features)
    'vix', 'dxy', 'sp500_change', 'stablecoin_change',
]


def train_model(training_data):
    """
    Train XGBoost model on historical trades
    
    Args:
        training_data: List of dicts with 'features' and 'was_successful'
    
    Returns:
        dict with accuracy, auc, train_samples, test_samples
    """
    if len(training_data) < 100:
        return {
            'error': f'Insufficient training data: {len(training_data)} samples (minimum 100 required)',
            'accuracy': 0,
            'auc': 0,
            'train_samples': 0,
            'test_samples': 0,
        }
    
    # Extract features and labels
    X = []
    y = []
    sample_weights = []
    
    for sample in training_data:
        features = sample['features']
        feature_vector = [features.get(name, 0) for name in FEATURE_NAMES]
        X.append(feature_vector)
        y.append(1 if sample['was_successful'] else 0)
        
        # Quality-weighted samples (A+ trades weighted higher)
        quality_weight = sample.get('quality_weight', 1.0)
        sample_weights.append(quality_weight)
    
    X = np.array(X)
    y = np.array(y)
    sample_weights = np.array(sample_weights)
    
    # Train/test split (80/20)
    X_train, X_test, y_train, y_test, w_train, w_test = train_test_split(
        X, y, sample_weights, test_size=0.2, random_state=42, stratify=y
    )
    
    # Train XGBoost model
    model = XGBClassifier(
        max_depth=6,
        learning_rate=0.1,
        n_estimators=200,
        objective='binary:logistic',
        eval_metric='auc',
        random_state=42,
        use_label_encoder=False,
    )
    
    model.fit(X_train, y_train, sample_weight=w_train)
    
    # Evaluate
    y_pred_train = model.predict(X_train)
    y_pred_test = model.predict(X_test)
    y_pred_proba_test = model.predict_proba(X_test)[:, 1]
    
    train_accuracy = accuracy_score(y_train, y_pred_train)
    test_accuracy = accuracy_score(y_test, y_pred_test)
    test_auc = roc_auc_score(y_test, y_pred_proba_test)
    
    # Save model
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    with open(MODEL_PATH, 'wb') as f:
        pickle.dump(model, f)
    
    return {
        'accuracy': float(test_accuracy),
        'auc': float(test_auc),
        'train_samples': len(X_train),
        'test_samples': len(X_test),
    }


def predict(features):
    """
    Predict trade success probability
    
    Args:
        features: Dict with 35 feature values
    
    Returns:
        dict with success_probability, confidence, model_available
    """
    if not MODEL_PATH.exists():
        return {
            'success_probability': 0.5,
            'confidence': 0.0,
            'model_available': False,
        }
    
    # Load model
    with open(MODEL_PATH, 'rb') as f:
        model = pickle.load(f)
    
    # Extract feature vector
    feature_vector = [features.get(name, 0) for name in FEATURE_NAMES]
    X = np.array([feature_vector])
    
    # Predict
    proba = model.predict_proba(X)[0]
    success_probability = float(proba[1])
    
    # Confidence = distance from 0.5 (max confidence at 0 or 1)
    confidence = abs(success_probability - 0.5) * 2
    
    return {
        'success_probability': success_probability,
        'confidence': confidence,
        'model_available': True,
    }


def get_feature_importance():
    """
    Get feature importance scores
    
    Returns:
        dict mapping feature names to importance scores
    """
    if not MODEL_PATH.exists():
        return {'error': 'Model not trained yet'}
    
    # Load model
    with open(MODEL_PATH, 'rb') as f:
        model = pickle.load(f)
    
    # Get feature importance
    importance = model.feature_importances_
    
    return {
        name: float(score)
        for name, score in zip(FEATURE_NAMES, importance)
    }


def main():
    """CLI interface"""
    if len(sys.argv) < 2:
        print(json.dumps({'error': 'Usage: path_success_predictor.py <command>'}))
        sys.exit(1)
    
    command = sys.argv[1]
    
    if command == 'train':
        # Read training data from stdin
        training_data = json.load(sys.stdin)
        result = train_model(training_data)
        print(json.dumps(result))
    
    elif command == 'predict':
        # Read features from stdin
        features = json.load(sys.stdin)
        result = predict(features)
        print(json.dumps(result))
    
    elif command == 'importance':
        result = get_feature_importance()
        print(json.dumps(result))
    
    else:
        print(json.dumps({'error': f'Unknown command: {command}'}))
        sys.exit(1)


if __name__ == '__main__':
    main()
