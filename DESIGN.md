---
name: NSIC
description: Design system for NetSuite Issue Copilot (local work app + PDF report). Derived from Vercel design.md principles.
upstream:
  guidance: https://vercel.com/design.md
  note: >
    The principles (restraint, Geist, evidence-led, anti-pattern list) are adopted. Vercel's brand identity
    (wordmark, triangle logo, authorship shell, vercel-brand.css stylesheet) is NOT used because the
    upstream is intended for official Vercel-made pages.
fonts:
  sans: { family: "Geist", source: "self-hosted woff2 (SIL OFL)", weights: [400, 500, 600] }
  mono: { family: "Geist Mono", source: "self-hosted woff2 (SIL OFL)", weights: [400, 500] }
colors:
  light:
    bg: "#FFFFFF"
    bg-subtle: "#FAFAFA"
    bg-muted: "#F2F2F2"
    text: "#171717"
    text-secondary: "#5C5C5C"
    text-tertiary: "#8F8F8F"
    border: "#EBEBEB"
    border-strong: "#D4D4D4"
    accent: "#0068D6"
    focus: "#0068D6"
    success: "#107D32"
    warning: "#A35200"
    error: "#C8102E"
    info: "#0068D6"
  dark:
    bg: "#0A0A0A"
    bg-subtle: "#111111"
    bg-muted: "#1A1A1A"
    text: "#EDEDED"
    text-secondary: "#A1A1A1"
    text-tertiary: "#707070"
    border: "#262626"
    border-strong: "#3A3A3A"
    accent: "#52A8FF"
    focus: "#52A8FF"
    success: "#4CC476"
    warning: "#F2A33A"
    error: "#FF6166"
    info: "#52A8FF"
typography:
  display:   { size: 32px, line: 40px, weight: 600, tracking: -0.04em }
  title:     { size: 24px, line: 32px, weight: 600, tracking: -0.03em }
  heading:   { size: 18px, line: 26px, weight: 600, tracking: -0.02em }
  subheading:{ size: 15px, line: 22px, weight: 500 }
  body:      { size: 14px, line: 22px, weight: 400 }
  compact:   { size: 13px, line: 20px, weight: 400 }
  label:     { size: 13px, line: 18px, weight: 500 }
  caption:   { size: 12px, line: 18px, weight: 400 }
  mono:      { size: 13px, line: 20px, weight: 400 }
spacing: [4, 8, 12, 16, 20, 24, 32, 40, 48, 64]
rounded: { sm: 4px, md: 6px, lg: 8px }
shadow:
  popover: "0 0 0 1px var(--ns-border), 0 4px 12px rgb(0 0 0 / 0.08)"
motion: { fast: 120ms, base: 180ms, easing: "cubic-bezier(0.2, 0, 0, 1)" }
---

# NSIC Design System

## 1. Character

NSIC is a technical work tool used for hours at a stretch. Its character is **calm, precise, information-dense,
and honest about evidence**. Hierarchy is built with typography and spacing, not boxes, color, or effects.
Every visual element must be justifiable by function.

Principles adopted from Vercel design.md:
- **Start from the reader's job.** Every screen answers: what needs to be decided or understood right now?
- **Monochrome first.** Color is only for status, actions, and data, always paired with a non-color marker (text/icon).
- **Typography before surface.** Different roles get different size/weight/text color, not a new border.
- **One owner per gap.** The container (flow/stack/grid) controls the gap; children never add their own margin.
- **Tables are evidence.** Semantic `<table>`, headers aligned with column content, numbers right-aligned with tabular numerals.
- **Quiet by default.** Motion only to explain a state change.

## 2. CSS tokens

All tokens are prefixed `--ns-`. **Light is the default theme.** Dark applies only when the user turns it on
(the "Dark theme" switch at the bottom of the nav, or Settings, Appearance), which sets `data-theme="dark"` on `<html>`.
The choice is stored per browser (`localStorage["nsic.theme"]`); an inline script in `web/index.html` applies it before
first paint. The OS `prefers-color-scheme` is deliberately ignored so the app always opens light unless the user chose dark.
Reports and PDFs always render light (they embed `tokens.css` without `data-theme`).
`web/styles/tokens.css` is generated from this file's front matter.

```css
:root {
  color-scheme: light;
  --ns-font-sans: "Geist", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  --ns-font-mono: "Geist Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;

  --ns-bg: #FFFFFF; --ns-bg-subtle: #FAFAFA; --ns-bg-muted: #F2F2F2;
  --ns-text: #171717; --ns-text-secondary: #5C5C5C; --ns-text-tertiary: #8F8F8F;
  --ns-border: #EBEBEB; --ns-border-strong: #D4D4D4;
  --ns-accent: #0068D6; --ns-focus: #0068D6;
  --ns-success: #107D32; --ns-warning: #A35200; --ns-error: #C8102E; --ns-info: #0068D6;

  --ns-space-1: 4px; --ns-space-2: 8px; --ns-space-3: 12px; --ns-space-4: 16px; --ns-space-5: 20px;
  --ns-space-6: 24px; --ns-space-8: 32px; --ns-space-10: 40px; --ns-space-12: 48px; --ns-space-16: 64px;
  --ns-radius-sm: 4px; --ns-radius-md: 6px; --ns-radius-lg: 8px;
  --ns-motion-fast: 120ms; --ns-motion-base: 180ms; --ns-ease: cubic-bezier(0.2, 0, 0, 1);
}
:root[data-theme="dark"] {
  color-scheme: dark;
  --ns-bg: #0A0A0A; --ns-bg-subtle: #111111; --ns-bg-muted: #1A1A1A;
  --ns-text: #EDEDED; --ns-text-secondary: #A1A1A1; --ns-text-tertiary: #707070;
  --ns-border: #262626; --ns-border-strong: #3A3A3A;
  --ns-accent: #52A8FF; --ns-focus: #52A8FF;
  --ns-success: #4CC476; --ns-warning: #F2A33A; --ns-error: #FF6166; --ns-info: #52A8FF;
}
```

Rule: never write hex colors in components; always `var(--ns-*)`. Never create a new token without updating this file.

## 3. Typography

| Role | Class | Used for |
|---|---|---|
| display | `.t-display` | Only the report's headline claim (one per document) |
| title | `.t-title` | Page title / issue title |
| heading | `.t-heading` | Main sections (Evidence, Timeline) |
| subheading | `.t-subheading` | Subsections, step titles |
| body | `.t-body` | Reading text, chat messages |
| compact | `.t-compact` | Table cells, dense lists |
| label | `.t-label` | Field labels, column names |
| caption | `.t-caption` | Captions under evidence, timestamp metadata |
| mono | `.t-mono` | Code, SuiteQL, paths, script IDs, internal IDs, account IDs, raw timestamps |

- Weight only 400/500/600. **No 700.**
- Large headings use negative tracking (see front matter).
- Numbers being compared: `font-variant-numeric: tabular-nums`.
- Mono is only for the identifier itself, not the whole sentence or table.
- Sentence case on all titles, labels, buttons. No ALL CAPS, no widely-tracked eyebrow text.
- UI copy never uses an em dash; use a period, comma, or colon instead.
- Reading text line length: 60-72 characters.

## 4. Layout

- 12-column grid on desktop (≥ 1024 px), 6 columns on tablet, 4 columns on mobile; gutter 24/20/16 px.
- App shell: 220 px nav sidebar (collapsible to 56 px) + content.
- Issue workspace: 3 / 6 / 3 columns (see docs/14).
- Report: content max 1080 px, prose 7 columns, tables/evidence 12 columns.
- Spacing: 8-12 px within a group, 24-32 px between groups, 40-48 px between major sections.
- Grid/flex children always get `min-width: 0`; wide tables scroll within their own wrapper, the page itself never scrolls horizontally.

## 5. App components

**Button**
- Primary: `--ns-text` background, `--ns-bg` text, 32 px tall, md radius. One primary per area.
- Secondary: transparent background, `--ns-border-strong` border.
- Ghost: no border, for table row actions.
- Danger: `--ns-error` text + border; used only for delete/reject.
- Focus: 2 px `--ns-focus` outline, 2 px offset.

**Input / textarea / select**: 32 px tall, `--ns-border-strong` border, label above (`.t-label`), helper below (`.t-caption`), error text `--ns-error` + icon.

**Table** (the most important component)
- Header: `.t-label`, `--ns-text-secondary`, `--ns-border` bottom border.
- Row: `.t-compact`, 40 px tall, thin border separator; hover `--ns-bg-subtle`.
- Numeric columns right-aligned including their header; text left-aligned; body cells `vertical-align: baseline`.
- No zebra striping, no cards inside cells.

**Status indicator**: 8 px dot + text. The dot carries the status color; the text stays `--ns-text-secondary`.
Example: `● investigating`, `● awaiting user`, `● resolved`. Never pulsing.

**Evidence level**: mono text `E0`-`E5` + label (`E3 · Reproduced`). Level ≥ E4 uses weight 500. No colored badge.

**Tier**: `Tier A · Full` text in the environment header; `A` alone is enough in a table.

**Timeline step**: a row with a time column (mono, tertiary) · title (subheading) · summary (body, secondary) · usage chip (caption, mono for numbers). A thin `--ns-border` vertical line connects steps. Expand for tool detail (mono block with `--ns-bg-subtle` background).

**Checkpoint / approval**: a block with a 2 px `--ns-accent` left border (no radius on that side), a question title, options as secondary buttons, primary for the agent's recommended answer.

**Guard blocked**: a row with a warning icon + `--ns-warning` text for the word "Blocked", the rest in regular text.

**Chat message**: no colored bubbles. Your messages: left-aligned with a "You" label; agent messages: "Agent" label + model (caption). 16 px spacing between messages. Markdown is rendered without raw HTML.

**Code / query block**: `--ns-font-mono`, `--ns-bg-subtle` background, `--ns-border` border, md radius, ghost copy button top right.

**Dialog & popover**: `--ns-bg` background, `popover` shadow, lg radius. Overlay `rgb(0 0 0 / 0.4)`.

**Toast**: bottom right corner, max 3, auto-dismiss after 5s except for errors.

**Screenshot gallery**: 3-4 column grid, step number (mono) + caption below the image, thin border on images, no shadow.

**Theme switch**: a nav row ("Dark theme" + a small track switch, `aria-pressed`) above Settings; icon-only when the nav is collapsed. Settings, Appearance offers the same choice as radio buttons.

**Icons**: a small in-house set of inline SVGs (1.5 px stroke, 16 px), max ~17 icons (the sun/moon pair is only for the theme switch). No external icon kit, and icons never sit in a colored box.

## 6. Report (PDF / preview)

The report is an evidence document for two reading speeds:
- **Executive path**: masthead, a claim-shaped title ("Vendor bill approval fails because two scripts write to the same record"), a one-sentence answer, status, evidence level, one decisive piece of evidence, all on the first page.
- **Audit path**: full evidence table, reproduce steps, diff, verification, limitations notes.

Rules:
- Masthead: NSIC's name (or your own name/brand if set in Settings) on the left; at most two metadata items on the right (issue key, date). No third-party logos.
- The title states the finding, not the document type ("Investigation Report" is not a good title).
- Tables take full width; the intro sits above them.
- Explicitly distinguish observations, hypotheses, and recommendations in the wording.
- Every screenshot has a step number + a caption stating what to look at.
- A limitations section is required whenever access was incomplete.
- Print: A4, 16 mm margins, images never cut across pages.

## 7. Motion

- Transitions only use opacity/transform, 120-180 ms, for: opening/closing a drawer, dialog, expanding a step.
- No shimmer, pulse, typing cursor, parallax, or scroll-triggered animation.
- `prefers-reduced-motion: reduce` → all transitions become 0 ms.

## 8. Reject these generated-design patterns

- All-caps eyebrow/overline text, decorative numbered section labels.
- Gradients, glow, blobs, glass, textures, decorative shadows.
- Centered hero + card grid; cards inside cards; every section wrapped in a box.
- Badges/pills for ordinary metadata.
- Repeated metric boxes when one table would be clearer.
- Small gray text used to force density.
- Decorative charts or color without meaning.
- Decorative icons in colored tiles.
- Em dashes in UI text.
- Non-English UI copy. All UI text, report text, and server messages are English; other languages appear only as client data or as matchers for it.

## 9. Accessibility

WCAG AA in both themes; focus is always visible; click targets ≥ 32 px (≥ 40 px on touch);
landmarks (`header`, `nav`, `main`); one `h1` per page; tables with a `<caption>` (may be visually hidden);
status is never conveyed by color alone.

## 10. Guidance for the coding agent

- Read this file before writing any UI. Use only the `--ns-*` tokens and typography classes above.
- Start from tables and text; add borders/surfaces only when spacing alone isn't enough to group things.
- Before finishing, check: one primary focus per screen, table headers aligned with columns, no color without meaning, light and dark equally legible, none of the patterns in §8.
