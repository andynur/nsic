# ADR-005 · No vector search in v1

Status: Accepted · 2026-09-18

## Context
The search we need: code (file names, functions, field ids, error messages) and similar issues. Most of it
is exact-identifier-based, not fuzzy semantic matching.

## Decision
FTS5 (BM25) for code, issues, and memory. The LLM reranks the top 20 results when needed.

## Re-evaluation
If "similar issue" recall is low after 50+ resolved issues, add embeddings (BLOB in SQLite + brute-force cosine).
