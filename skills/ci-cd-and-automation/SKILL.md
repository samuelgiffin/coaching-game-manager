---
name: ci-cd-and-automation
description: Automates build, test, and release pipelines. Use when setting up GitHub Actions, CI workflows, deployment scripts, or release automation.
---

# CI/CD and Automation

## Overview

Automate quality gates so every commit is built, tested, and validated in an isolated environment before merge or deployment.

## Core Rules

1. **Fast Feedback**: Keep PR check pipelines fast (< 5 minutes).
2. **Deterministic Pipelines**: Pin action versions, dependencies, and environment versions.
3. **Fail Fast**: Run quick lint and type checks first, followed by unit tests, integration tests, and security scans.
4. **Security**: Store secrets securely in vault/environment variables, never commit secrets.
