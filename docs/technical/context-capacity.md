# Context capacity resolution

> Last updated: 2026-11

## Two independent queries

- `getContextWindow(input)` returns the capacity used for request/compaction budgets, together with its source.
- `getMaxContextWindow(input)` returns a published model capacity for display. It never probes a server or invents a maximum.
- `maxOutput` remains the reply limit, not a context capacity.

Both queries live in `src/shared/providers/context-window.ts`. Providers may implement `contextWindowDelegate` and `maxContextWindowDelegate` independently. Providers with ordinary configuration/catalog behavior share the default implementations, including custom providers.

## Provider policies

The default budget policy uses a valid saved `contextWindow`, otherwise the maximum-capacity query, otherwise the existing 128,000-token compatibility estimate. The estimate is explicitly marked `fallback`, so it is not shown as a known model specification.

The default maximum query uses explicit `maxContextWindow`, provider registry metadata, built-in model limits, an unambiguous cross-provider registry match, and finally the legacy saved `contextWindow`. Cross-provider disagreement does not silently select whichever registry entry was visited last.

Ollama and FastFlowLM own their runtime sources. Their budget delegates use the loaded model's `/api/ps` window. A failed query, invalid window or unloaded model is unknown; their policies do not replace it with a catalog capacity or the compatibility estimate. Ollama's native maximum metadata and FastFlowLM's catalog capacity remain separate from this runtime result. `num_ctx` stays informational and is not sent as a new request option.

## Host orchestration and consumers

The renderer's runtime source orchestration owns deduplication, timeout, snapshots and subscriptions. UI reads a snapshot and subscribes to runtime/registry changes. Send-time resolution refreshes runtime sources before reading the same policy. Configuration-based providers perform no runtime probe.

`resolveModelCompactionBudget()` resolves capacity once and then calls the pure budget arithmetic. The input box uses `getContextWindowSnapshot()`. Portable token estimation uses the shared policy; a host-supplied capacity is treated as an already-resolved snapshot, and explicit `null` stays unknown.

Legacy compaction helpers remain compatibility wrappers around the same capacity policy. They must not acquire their own registry/fallback selection rules.

## Persistence compatibility

Existing `contextWindow` data remains readable. `maxContextWindow` is an optional additional field, so no bulk migration is needed. Registry enrichment fills a missing legacy window and records the model maximum separately rather than overwriting a saved effective window. Explicit model refresh can update the published maximum while preserving the configured window. FastFlowLM's newly discovered theoretical capacity is stored as `maxContextWindow`.

No capability checkboxes, reasoning protocol behavior or compression thresholds are changed by these interfaces.

On explicit model fetch, Ollama maps the published `/api/show` capacity to `maxContextWindow`. The model list uses the same context-window display as other providers.