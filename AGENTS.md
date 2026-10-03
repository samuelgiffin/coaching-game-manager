# AGENTS.md — Coaching Game Manager Agent Guidelines

This repository manages the **Coaching Game Manager** application (soccer match, substitution, roster, and player time management).

## Core Agent Rules & Standards

1. **Skill First Workflow**: Before starting any task, check if a skill in `skills/` applies. If so, invoke and follow it strictly.
2. **Spec Before Code**: For non-trivial features, draft a spec and plan (`skills/spec-driven-development`, `skills/planning-and-task-breakdown`).
3. **Test-Driven Development**: Write failing tests before writing production implementation (`skills/test-driven-development`).
4. **Incremental Implementation**: Work in small, verifiable, atomic slices (`skills/incremental-implementation`).
5. **Quality & Review**: Run thorough code, security, and performance reviews before declaring work done (`skills/code-review-and-quality`, `skills/security-and-hardening`, `skills/performance-optimization`).

## Skill Directory Structure

- `skills/` — Project-level agent skills (canonical definition per skill).
- `.agents/skills/` — Multi-agent skill definitions for cross-compatibility.
- `references/` — Supplementary checklists for accessibility, security, testing, performance, definition of done, and observability.
- `agents/` — Agent persona definitions for code review, security audit, test engineering, and web performance.

## Intent → Skill Mapping

| Intent / Task | Primary Skill | Secondary / Supporting Skills |
|---|---|---|
| New Feature / Core Logic | `spec-driven-development` | `planning-and-task-breakdown`, `incremental-implementation` |
| UI Component / Layout | `frontend-ui-engineering` | `api-and-interface-design`, `accessibility-checklist` |
| Bug / Error / Failures | `debugging-and-error-recovery` | `test-driven-development` (Prove-It pattern) |
| Code Optimization | `performance-optimization` | `code-simplification` |
| Code Review / QA | `code-review-and-quality` | `security-and-hardening` |
| Refactoring | `code-simplification` | `doubt-driven-development` |
| Shipping / Release | `shipping-and-launch` | `git-workflow-and-versioning` |
