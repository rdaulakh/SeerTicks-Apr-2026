# ThinkTank AI Architecture — Key Concepts for SEER Mapping

## Core Pipeline
1. Intent Analyzer → structured objective from input
2. Strategic Planner → which agents/expertise needed
3. Task Graph Generator → parallel task DAG
4. Specialized Agents → domain expert workers
5. Tool Layer → web search, code, DBs, APIs
6. Aggregation Engine → combine, deduplicate, unify
7. Evaluator Layer → quality gate, can reject and re-trigger agents
8. Final Output → structured decision

## Decision Simulation Engine
- Scenario Generator (best/realistic/worst)
- Market Simulation
- Financial Projection
- Risk Engine
- Outcome Comparison
- Strategic Recommendation

## Key Principles
- NOT simple chatbot-style → structured orchestrated agents
- Parallel task execution (task graph, not sequential)
- Layered reasoning with evaluation loop
- Each agent gets SPECIFIC role and SPECIFIC task
- Aggregation removes duplication, finds common insights
- Evaluator can REJECT and re-trigger specific agents
