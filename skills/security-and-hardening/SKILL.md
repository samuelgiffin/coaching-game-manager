---
name: security-and-hardening
description: Audit and harden code against OWASP Top 10 vulnerabilities. Use when implementing auth, data persistence, file uploads, or public endpoints.
---

# Security and Hardening

## Defense Checklist

- **XSS Prevention**: Never inject unsanitized HTML into innerHTML/eval. Escape all user inputs before DOM insertion.
- **CSRF & Injection**: Use parameterized queries, CSP headers, anti-CSRF tokens.
- **Authentication & AuthZ**: Enforce strict server-side permission checks on every route.
- **Secrets Management**: Keep API keys in environment variables; never commit credentials.
