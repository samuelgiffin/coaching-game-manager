---
name: incremental-implementation
description: Breaks large features into small, testable, working increments. Use when executing complex multi-file changes or implementation plans.
---

# Incremental Implementation

## Core Rule

Never write large monolithic blocks of code across multiple files without intermediate verification.

1. Implement one atomic task at a time.
2. Verify task with tests / runtime checks.
3. Commit or checkpoint working state.
4. Proceed to next task.
