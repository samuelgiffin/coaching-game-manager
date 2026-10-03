---
name: performance-optimization
description: Measures, profiles, and optimizes application performance. Use when addressing page load speed, runtime lag, memory leaks, or heavy computational bottlenecks.
---

# Performance Optimization

## Measure Before You Optimize

1. **Establish Baseline**: Profile before making changes (CPU trace, Memory heap, DevTools performance markers).
2. **Identify Bottleneck**: Focus on main thread blocking, excessive DOM repaints, layout thrashing, or redundant API calls.
3. **Apply Targeted Fix**: Memoization, virtualized rendering, lazy loading, debouncing/throttling.
4. **Verify Gain**: Measure after fix to prove empirical speedup.
