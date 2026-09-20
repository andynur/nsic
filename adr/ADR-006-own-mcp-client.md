# ADR-006 · A minimal, in-house MCP client

Status: Accepted · 2026-09-18

## Context
NSIC needs to call the NetSuite AI Connector Service with full control: a per-environment tool allowlist,
per-call auditing, blocking write tools in production, and local token refresh.

## Decision
Implement JSON-RPC 2.0 over Streamable HTTP (initialize, tools/list, tools/call) in `src/netsuite/mcp-client.ts`.
Do not use Anthropic's server-side MCP connector, and do not use an MCP SDK in v1.

## Consequences
+ Guarding and auditing live in the local process.
- We need to track changes to the MCP spec ourselves; if complexity grows, consider the official SDK via a new ADR.
