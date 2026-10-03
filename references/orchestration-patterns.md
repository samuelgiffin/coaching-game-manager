# Orchestration Patterns

Patterns for orchestrating subagents, workflow pipelines, and multi-step agentic execution:
- **Parallel Dispatch**: Use when tasks are independent with zero shared state dependencies.
- **Sequential Pipeline**: Hand off output from task A as input context for task B.
- **Supervisor-Worker**: Main agent delegates verification and specific implementations to isolated worker subagents.
