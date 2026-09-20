# 14 · UI/UX Spec

Every screen follows `DESIGN.md`. The application is an information-dense work tool: monochrome, Geist,
tables as the main structure, color reserved for status and actions.

## 0. Static mode (prototype)

`bun run ui` runs the same SPA with a fake backend in the browser (`web/app/mock/`), so
UI/UX revisions can be made without a DB, jobs, an LLM, or a NetSuite account. The data contract is identical to
`13-api-spec.md`; realtime events are simulated (agent steps, streaming text, checkpoints).
`bun run ui:shots` produces screenshots of every screen (light/dark) for review.

## 1. Screen map

```
/                         → Inbox (issues across projects)
/projects                 → Project list
/projects/:id             → Project overview (environments, repos, usage)
/projects/:id/env/:envId  → Environment: access profile, wizard, browser session
/issues/new               → Create an issue
/issues/:key              → Issue workspace (main screen)
/issues/:key/report       → Report preview & export
/usage                    → Tokens & cost
/settings                 → Models, pricing, default budget, default redaction, binary paths
```

Router: `URLPattern` + the History API, no library.

## 2. Inbox

- A full-width table: Key, Title, Project, Env (text label + tier status dot), Status, Evidence (E0-E5 as mono text, e.g. `E3`), Cost, Updated.
- Filters above the table (project, status, env kind), FTS search, default filter: "not yet resolved".
- Rows with a running session: a dot indicator + state text (`investigating`), no pulsing animation.
- Keyboard: `j/k` to navigate, `Enter` to open, `c` for a new issue, `/` to focus search.

## 3. New issue

- Fields: Project, Environment (showing the tier), Title, Description (a large textarea, pasting an image becomes an attachment directly), Reporter, Priority.
- An attachment dropzone with a file list + detected type + a warning for unsupported types.
- A toggle for "Run agent automatically" (defaults from the project), budget (defaults from the project).
- Submit → redirect to the workspace; ingestion is visibly running.

## 4. Issue workspace (main screen)

A three-column desktop layout on a 12-column grid:

| Area | Columns | Contents |
|---|---|---|
| Left | 3 | Issue summary, entities (confirmable), the **evidence board** sorted by level, hypotheses + confidence |
| Center | 6 | **Agent** tab (step timeline + chat) and **Consultant** tab |
| Right | 3 | The active session (state, tokens, cost vs. budget), artifacts (screenshot gallery, video), primary actions |

Primary actions (right side, in order): **Capture final** (enabled once ≥ E3), **Fix** (tier A/B), **Export**, **Re-run**.

Agent timeline:
- Every step: a title, a 1-2 line summary, a usage chip, duration; click to expand tool input/output (monospace, collapsible).
- A checkpoint appears as a question block with quick-answer buttons + a free-text input.
- Deploy approval: a block with the diff and object list, **Approve** / **Reject** buttons.
- A guard block appears as a warning row (text + warning icon, with the warning color applied only to the icon/text).

Consultant tab: a question box, language/tone/length/audience controls, a list of drafts with a Copy button.

Responsive: below 1024 px, the left & right columns become drawers; below 640 px, a single column with tabs (Summary, Agent, Artifacts).

## 5. Artifacts & video

- Screenshot gallery: a numbered grid matching the steps; click → a lightbox with a caption, arrow navigation.
- Video: a native `<video>` player (the server supports Range), a caption list acting as clickable chapters.
- Before/after: two players side by side + a per-step table.

## 6. Environment & wizard

- Header: env name, kind, account ID (mono), a large **tier** shown as text (`Tier A · Full`), last probe time.
- A capability table: name, status (available/not), how to enable it.
- The wizard as a vertical stepper (the 8 steps from doc 06 §3), each step markable as done; values that need copying have a copy button.
- An embedded terminal (PTY) for `suitecloud account:setup`: a monospace area, not a full emulator.

## 7. Report preview

- Shows the HTML report exactly as the PDF will look.
- Narrative fields can be edited inline (contentEditable limited to text blocks), with changes saved as overrides.
- An options panel: audience, include cost, redacted only, format.

## 8. Usage

- Key stats: cost this month, issue count, average cost per issue, cache hit ratio.
- A table per issue (sorted by cost), per model, and a daily trend with a shared scale. Daily bars use intensity colors (low, medium, high), are keyboard focusable, and expose the exact value on hover or focus. Cost/token toggles let operators switch the chart metric without changing the reporting period; the expandable daily table supports day and cost sorting.

## 9. Required UI states

Every screen handles: loading (a light skeleton, no shimmer), empty (an explanation + a first action),
error (a message + a recovery action), server offline (a "server not connected, retrying" banner).

## 10. Theme & language

- Light is the default. The user can switch to dark from the nav ("Dark theme") or Settings, Appearance; the choice is stored per browser and applied before first paint (DESIGN.md §2). The report preview stays light because it mirrors the PDF.
- All UI copy is English. Decimal inputs (prices, budgets) always show a dot separator regardless of OS locale and accept a typed comma.

## 11. Accessibility

Landmarks, a "Skip to content" link, a descriptive tab title per page, one `h1` per page, visible focus, every action reachable by keyboard, AA contrast in light & dark,
status never marked by color alone (there's always text), `prefers-reduced-motion` is respected.

## Dashboard (`/dashboard`)

The first navigation item opens a cross-project operational overview. Inbox remains
at `/`. Project and cost-period filters persist in the URL and support browser history.
Four counters summarize open issues, issues needing attention, total issues, and
estimated AI cost. Current status and evidence distributions use labeled bars;
daily UTC cost has a shared zero baseline and an expandable numeric table.
The oldest 10 attention items link directly to issue workspaces and show lifetime
cost against the effective budget. A project table links to project workspaces.

The daily cost chart uses intensity colors, keyboard-focusable bars, exact value
tooltips, and a selected-day status line. Operators can filter it to all days or
days with recorded cost; the expandable table remains the text equivalent.

Refresh is available manually and every 30 seconds while the document is visible,
and on returning to the tab. Background refresh preserves the rendered dashboard;
changing filters clears the old snapshot. Loading, retryable errors, empty workspace,
no attention, and zero-cost states are explicit. Charts have text equivalents;
wide tables scroll within their containers. Light and dark use existing design tokens.
