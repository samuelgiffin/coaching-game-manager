---
name: deprecation-and-migration
description: Manages zero-downtime API deprecations and data migrations. Use when retiring legacy code, migrating data schemas, or replacing APIs.
---

# Deprecation and Migration

## Strategy

1. **Expand First**: Introduce new schema/API alongside old version.
2. **Migrate Write Paths**: Update code to write to both or new target.
3. **Backfill Data**: Migrate historical records safely.
4. **Migrate Read Paths**: Switch readers to new target.
5. **Contract Old**: Mark old interface deprecated with clear warnings and sunset date.
6. **Remove**: Clean up legacy code path once zero traffic remains.
