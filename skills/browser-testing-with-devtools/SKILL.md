---
name: browser-testing-with-devtools
description: Guides runtime verification and debugging in browsers using Chrome DevTools MCP. Use when inspecting DOM layout, checking console errors, monitoring network requests, analyzing web performance, or visually verifying UI components.
---

# Browser Testing with DevTools

## Overview

Unit tests alone aren't enough for web applications. Use runtime inspection to observe DOM structure, console logs, network payloads, computed CSS, performance markers, and visual screenshots.

## Workflow

1. **REPRODUCE**: Navigate to the page, inspect state, capture screenshot.
2. **INSPECT**: Check console logs for JS errors, Network tab for API status, DOM tree for layout integrity.
3. **DIAGNOSE**: Compare actual runtime behavior with expected behavior.
4. **FIX**: Apply targeted fixes in code.
5. **VERIFY**: Reload, verify console is clean, confirm visual rendering.
