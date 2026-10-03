---
name: api-and-interface-design
description: Guides stable API and interface design. Use when designing APIs, module boundaries, or any public interface. Use when creating REST or GraphQL endpoints, defining type contracts between modules, or establishing boundaries between frontend and backend.
---

# API and Interface Design

## Overview

Design stable, well-documented interfaces that are hard to misuse. Good interfaces make the right thing easy and the wrong thing hard. This applies to REST APIs, GraphQL schemas, module boundaries, component props, and any surface where one piece of code talks to another.

## When to Use

- Designing new API endpoints
- Defining module boundaries or contracts between teams
- Creating component prop interfaces
- Establishing database schema that informs API shape
- Changing existing public interfaces

## Core Principles

1. **Hyrum's Law**: Every observable behavior of an API becomes a de facto contract. Be intentional about what you expose.
2. **Contract First**: Define the interface before implementing it.
3. **Consistent Error Semantics**: Pick one error strategy (code + message + details) and stick to it.
4. **Validate at Boundaries**: Trust internal code, but validate at system edges (user inputs, external APIs).
5. **Prefer Addition Over Modification**: Extend interfaces with optional fields rather than making breaking changes.
6. **Idempotency Keys**: For state-changing operations, accept and strictly honor idempotency keys.
