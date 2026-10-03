# Security Checklist

- [ ] Input validation on all public/user endpoints.
- [ ] XSS sanitization (no unsafe `innerHTML` or `eval`).
- [ ] Parameterized database queries (no raw SQL/string concatenation).
- [ ] Anti-CSRF protection and secure session management.
- [ ] No hardcoded secrets, passwords, or tokens in source code.
- [ ] Proper HTTP security headers (CSP, HSTS, X-Content-Type-Options).
