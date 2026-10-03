# Accessibility Checklist

Quick reference for WCAG 2.1 AA compliance. Use alongside `frontend-ui-engineering`.

## Essential Checks

### Keyboard Navigation
- [ ] All interactive elements focusable via Tab key
- [ ] Focus order follows visual/logical order
- [ ] Visible focus outlines on focused elements
- [ ] Modals trap focus while open, return focus on close

### Screen Readers & Labels
- [ ] All images have descriptive `alt` text (or `alt=""` for decorative)
- [ ] All form inputs have associated `<label>` or `aria-label`
- [ ] Buttons and links have descriptive text
- [ ] Icon buttons have `aria-label`
- [ ] One `<h1>` per page, logical heading hierarchy

### Visual & Contrast
- [ ] Text contrast ≥ 4.5:1 (normal text) or ≥ 3:1 (large text)
- [ ] Touch targets ≥ 44x44px on mobile touch interfaces
