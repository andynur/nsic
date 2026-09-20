# ADR-007 · A design system derived from Vercel design.md, without Vercel's brand identity

Status: Accepted · 2026-09-18

## Context
We want a consistent look following Vercel's design.md. That file is a skill for producing
official Vercel-made website reports: it requires the Vercel wordmark/logo and the `vercel-brand.css`
stylesheet, and it's aimed at reports rather than product UI.

## Decision
NSIC's `DESIGN.md` adopts its principles (restraint, Geist, monochrome, typographic hierarchy, tables as
evidence, executive/audit paths for reports, the anti-pattern list) with its own tokens (`--ns-*`) and its
own identity. The Geist font is self-hosted (OFL license). No Vercel assets/stylesheets are included.

## Consequences
+ A consistent look that can be used in client-facing reports without misattributing the brand.
- Tokens must be maintained in-house; upstream changes don't flow in automatically (review periodically).
