# ADR-002 · SQLite (bun:sqlite) + local filesystem for all state

Status: Accepted · 2026-09-18

## Context
We need storage for issues, evidence, agent events, a job queue, token usage, and text search.
There is no need for multi-user support or horizontal scaling.

## Decision
- One `data/nsic.db` file (WAL), FTS5 for search, the job queue as a table.
- Large artifacts live under `data/issues/{id}/...`, with the DB storing the path.
- No Redis/Postgres/vector DB in v1.

## Consequences
+ Backup = copy the folder / `VACUUM INTO`.
+ Simple queries, no extra server.
- Semantic search doesn't exist in v1 (replaced by FTS5 + LLM rerank).
