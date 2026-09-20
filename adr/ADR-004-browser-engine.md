# ADR-004 · Bun.WebView as the browser engine, Playwright as an optional fallback

Status: Proposed (pending Spike S-01/S-01b)

## Context
We need to navigate NetSuite with a persistent login session, screenshots, screencast video, network
interception (production guard), and PDF printing.

## Decision
Default to `Bun.WebView` with the Chrome backend and `.cdp()`. The Repro DSL and runner are abstracted behind
a `BrowserDriver` interface so the driver can be swapped.

## Criteria for activating Playwright
Any one of these failing in the spike: persistent-profile/headed login, popups/new tabs, file upload, CDP screencast,
`Fetch` interception, printToPDF. If activated: add `playwright-core` as a dependency (a single package),
use the installed Chrome (no browser download), and take advantage of Playwright's built-in video/trace features.
