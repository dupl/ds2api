# Tool call parsing semantics (Go canonical spec)

This document defines the cross-runtime contract for `ParseToolCallsDetailed` / `parseToolCallsDetailed`.

## Output contract

- `calls`: accepted tool calls with normalized tool names.
- `sawToolCallSyntax`: true when tool-call-like syntax is detected (`tool_calls`, `<tool_call>`, `<function_call>`, `<invoke>`) or a valid call is parsed.
- `rejectedByPolicy`: true when parser extracted call syntax but all calls are rejected by allow-list policy.
- `rejectedToolNames`: de-duplicated rejected tool names in first-seen order.

## Parse pipeline

1. Strip fenced code blocks for non-standalone parsing.
2. Build candidates from:
   - full text,
   - fenced JSON snippets,
   - extracted JSON objects around `tool_calls`,
   - first `{` to last `}` object slice.
3. Parse each candidate in order:
   - JSON payload parser (`tool_calls`, list, single call object),
   - markup parser (`<tool_call>`, `<function_call>`, `<invoke>`; supports attributes + nested fields).
4. Stop at first candidate that yields at least one call.

## Name normalization policy

When matching parsed names against configured tools:

1. exact match,
2. case-insensitive match,
3. namespace tail match (`a.b.c` => `c`),
4. loose alnum match (remove non `[a-z0-9]`, compare).

## Standalone mode

Standalone mode (`ParseStandaloneToolCallsDetailed`) parses the whole input directly (no candidate slicing), while still applying:

- example-context guard,
- JSON then markup fallback,
- the same allow-list normalization policy.
