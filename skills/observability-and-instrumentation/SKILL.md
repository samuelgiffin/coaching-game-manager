---
name: observability-and-instrumentation
description: Instruments applications with metrics, structured logging, and tracing. Use when adding diagnostic telemetry or error tracking.
---

# Observability and Instrumentation

## Rules

- **Structured Logging**: Use JSON or key-value format with standard metadata (`timestamp`, `level`, `trace_id`, `context`).
- **Sanitize Data**: Never log passwords, tokens, API keys, or sensitive PII.
- **Metrics**: Track latency, error rate, throughput, and resource utilization.
