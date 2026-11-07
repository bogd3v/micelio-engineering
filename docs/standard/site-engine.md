# Micelio engineering standard: site engine profile

Profile `site-engine` of standard version 2.0 (2026-11-06). Canonical copy: `bogd3v/micelio-engineering`, `docs/standard/site-engine.md`.

The rules for a repository that serves sites, next to the core, `docs/engineering-standard.md`, and a language profile. A Micelio repository that serves sites pins it. Each section has the number of the section of the core it belongs to, and "section N" means that section of the core.

## 9. Security, privacy, accessibility, performance and sustainability

### Security

- HTML built from content is sanitized on the server. `v-html` renders only sanitized output, with the reason on the line.
- The Content Security Policy is built from hashes. A new inline script, embed or media origin is probed on a production build before merging.
- A site serves `/.well-known/security.txt` (RFC 9116) when its owner has set a security contact, and nothing otherwise.

### Accessibility

- The target is WCAG 2.2, level AA.
- Semantic HTML first; ARIA only where HTML has no element for the job. Everything works with the keyboard and has a visible focus.
- `prefers-reduced-motion` is honoured. Every heavy island has a static alternative.
- The contrast matrix of `theme:check` and the axe run (the WCAG 2.0, 2.1 and 2.2 rules of levels A and AA) pass with no exclusions.
- Automated rules find only part of the problems. A theme is admitted with a manual check recorded in its report: keyboard only, a screen reader, 200 % zoom and reflow at 320 px, reduced motion and forced colors.

### Performance

- Every page type has a budget, measured in CI for every installed theme and site mode. A change that moves a budget records the number and the reason in `docs/performance.md`.

### Sustainability

- Micelio follows the W3C Web Sustainability Guidelines where they apply to a site engine: less data transferred, no work the visitor did not ask for, static output whenever the content allows it.
- The performance report estimates the emissions of each page type from the bytes it transfers, next to its weight. The estimate becomes a budget once it has a baseline.
