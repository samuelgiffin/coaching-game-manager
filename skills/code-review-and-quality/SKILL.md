---
name: code-review-and-quality
description: Five-axis code review evaluating correctness, maintainability, performance, security, and test coverage. Use before merging PRs or completing features.
---

# Code Review and Quality

## Five-Axis Review Framework

1. **Correctness & Functionality**: Does the code meet all spec requirements and handle edge cases?
2. **Security**: Are input validation, XSS, injection, authentication, and permissions enforced?
3. **Maintainability & Readability**: Is code clear, idiomatic, well-named, and DRY without over-engineering?
4. **Performance & Scalability**: Are there unnecessary re-renders, memory leaks, or N+1 queries?
5. **Testing & Verification**: Are unit and integration tests included and passing?

## Execution Checklist

- [ ] All requirements in spec are verified
- [ ] Code follows existing patterns and conventions
- [ ] No hardcoded secrets or sensitive credentials
- [ ] Clean error handling without swallowed exceptions
