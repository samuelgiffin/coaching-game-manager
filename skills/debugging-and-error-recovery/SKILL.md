---
name: debugging-and-error-recovery
description: Systematic root-cause debugging and error isolation. Use whenever encountering a bug, unhandled exception, or unexpected test failure.
---

# Debugging and Error Recovery

## Systematic Process

1. **Inspect Logs & Stack Traces**: Read un-truncated error stack traces and logs BEFORE forming hypotheses.
2. **Reproduce Minimal Case**: Create a minimal reproducible test or script demonstrating the error.
3. **Trace Upstream Data**: Follow data flow backwards from point of failure to origin.
4. **Identify Root Cause**: Determine exact broken invariant or contract.
5. **Apply Verified Fix & Test**: Implement fix and prove with passing tests. Never swallow exceptions or use silent dummy fallbacks.
