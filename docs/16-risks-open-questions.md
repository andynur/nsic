# 16 · Risks & Open Questions

## 1. Risks

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R1 | `Bun.WebView` isn't enough for persistent profiles / popups / screencast | Medium | High | Spike S-01; a Playwright fallback (ADR-004) without changing the Repro DSL |
| R2 | The agent hallucinates about the SuiteScript API or NetSuite behavior | High | Medium | Evidence-first, grounded in the repo + live data, E4 requires a concrete reference |
| R3 | An unintended write action in production | Low | Very high | 7 guard layers (doc 06 §6), a View-only role, automated guard tests in local CI |
| R4 | Prompt injection from a client email/page | Medium | High | `<untrusted_content>`, risky tools unavailable in prod, human approval |
| R5 | Browser sessions expire often (SSO/2FA) | High | Medium | Fast detection + notification; Login Assist takes < 1 minute |
| R6 | NetSuite UI changes per release break repro scripts | Medium | Medium | Targeting based on NetSuite field ids, bilingual text, versioned & editable scripts |
| R7 | LLM cost balloons on a stuck issue | Medium | Medium | Per-issue budget, loop detection, Haiku for lightweight tasks |
| R8 | A sandbox refresh wipes test data/configuration | Medium | Medium | The Repro DSL records data prerequisites; an optional data setup step |
| R9 | Sensitive client data leaks via a report/video | Low | High | Redaction on by default, a "client" audience mode, a mandatory preview before finalizing |
| R10 | The client's policy forbids UI or AI automation | Medium | High | Consent is recorded per environment; tier `none` remains useful (attachment + code analysis) |
| R11 | The in-house zip/XLSX writer has a compatibility bug | Medium | Low | Spike S-06, round-trip tests; an `fflate` fallback |
| R12 | A system dependency (Chrome, ffmpeg, Java, CLI) isn't installed | High | Low | A "System check" page in Settings, features degrade clearly |

## 2. Open questions

| # | Question | Owner | Target |
|---|---|---|---|
| Q1 | Which execution log source is most reliable (SuiteQL vs. a RESTlet helper)? | Spike S-05 | M0 |
| Q2 | Does the NetSuite integration record accept a `http://127.0.0.1:PORT/...` redirect? | Spike S-02 | M0 |
| Q3 | Is multi-role support needed per environment (e.g. reproducing as both AP Clerk and Controller)? | You | M4 |
| Q4 | Does the client report need your company's branding (logo, name)? | You | M5 |
| Q5 | Is syncing with the client's tracker needed in v1? | You | M5 |
| Q6 | Is a global monthly cost cap needed in addition to the per-issue budget? | You | M1 |
| Q7 | Video retention (disk size) and compression? | You | M6 |
