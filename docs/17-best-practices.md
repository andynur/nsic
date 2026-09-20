# 17 · Best Practices

## A. NetSuite security & access

1. **One role per purpose.** `NSIC MCP Read` (production, View-only), `NSIC MCP Sandbox`, `NSIC Integration`. Never use the Administrator role for any automation beyond setup.
2. **Read-only is enforced in NetSuite.** The application guard is a second layer, not the only one.
3. **Re-probe after a role change** and every 7 days (`Bun.cron`). The tier can change without you noticing.
4. **Record client consent** for automation per environment, including who approved it.
5. **Never store secrets in the repo or a prompt.** The master key lives only in the local `.env` (or a keychain), backed up separately from the `data/` folder.
6. **Rotate the master key** whenever your laptop changes or there's any sign of a leak (`bun run nsic rotate-key`).

## B. Investigation quality

7. **Evidence before conclusions.** Reject a root cause with no concrete reference (query, log, file:line, SDF object).
8. **Confirm entities early.** A wrong transaction number/ID sends the whole investigation in the wrong direction; a 30-second review upfront saves a lot of tokens.
9. **Always check for other automation on the same record** (UE, client scripts, workflows, scheduled Map/Reduce) before blaming a single script.
10. **Compare environments.** Many "only happens in production" issues come from differences in internal ID lists, account preferences, or deployment status.
11. **Save useful queries** as evidence; the same query often gets reused on the next issue.

## C. Reproduce & artifacts

12. **A repro script is an asset.** Save it, version it, and replay it as a regression check after a release.
13. **Use NetSuite field ids as targets**, not fragile CSS selectors.
14. **Redaction is on by default** for every capture; turn it off only for internal artifacts.
15. **One browser run per environment** at a time, to avoid session conflicts.

## D. AI cost & performance

16. **Pick the model to match the task** (Haiku for structured work, Sonnet for investigation, Opus for escalation).
17. **Watch the cache hit ratio.** If it's low, check whether the system prompt/project context is changing on every call.
18. **Set a realistic per-issue budget** and review it monthly from the Usage page; raise it for certain issue categories (integrations, performance).

## E. Engineering

19. **Bun built-ins first.** Every new dependency needs an ADR (reason, size, transitive deps, exit plan).
20. **Deterministic at the edges, AI in the middle.** Parsers, guards, the runner, and exports must be testable without an LLM.
21. **Guard tests are the most important tests.** The `tests/guard/*.test.ts` suite must pass before every commit (`bun test --changed`).
22. **Idempotent steps.** Every agent step and job has an idempotency key; a restart never duplicates an action.
23. **Structured per-session logging** (JSONL), and profile with `bun --cpu-prof-md` whenever something is slow.
24. **Automatic daily backups** (`VACUUM INTO`) and test restoring once a month.

## F. Communicating with consultants & clients

25. **Separate fact, hypothesis, and plan** in every answer.
26. **Never let an AI draft promise a date**; dates come only from you.
27. **Preview before sending.** A client-audience report is always re-read; the assistant only produces a draft.
28. **Flag recurring Q&A as FAQ** so it flows into the report and memory.
