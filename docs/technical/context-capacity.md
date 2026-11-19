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

Ollama and FastFlowLM own their runtime sources. Their default budget delegates use the loaded model's `/api/ps` window. A failed query, invalid window or unloaded model is unknown; their policies do not replace it with a catalog capacity or the compatibility estimate. Ollama's native maximum metadata and FastFlowLM's catalog capacity remain separate from this runtime result.

Providers can opt into `contextWindowDelegate.control`. The token usage popup offers Default, ¼, ½, ¾ and Maximum when that control and a model maximum are available. The conversation stores only the selected tier, not a token count. Switching to a provider without control hides the selector and uses its default without clearing the conversation's preference. An explicit selection snapshots one target at submission for both compaction and transport; the actual loaded window is still shown separately from `/api/ps`. A queued override starts a separate turn rather than interjecting into a request that already has a window. Queue snapshots live only in memory; restored queue items use the conversation's stored tier. Other providers and the Default tier send no override.

On explicit selection, Ollama uses native `/api/chat` with `options.num_ctx` because its OpenAI-compatible endpoint does not accept a context override. FastFlowLM sends top-level `num_ctx` on its existing `/v1/chat/completions` path, after checking support for the requested model in the capability catalog. If the catalog does not advertise support, Chatbox does not send the chat request and displays a localized prompt to select Default. Neither changes the output token limit.

## Host orchestration and consumers

The renderer's runtime source orchestration owns deduplication, timeout, snapshots and subscriptions. UI reads a snapshot and subscribes to runtime/registry changes. Send-time resolution refreshes runtime sources before reading the same policy. Configuration-based providers perform no runtime probe.

`resolveModelCompactionBudget()` resolves capacity once and then calls the pure budget arithmetic. The input box uses `getContextWindowSnapshot()`. Portable token estimation uses the shared policy; a host-supplied capacity is treated as an already-resolved snapshot, and explicit `null` stays unknown.

Legacy compaction helpers remain compatibility wrappers around the same capacity policy. They must not acquire their own registry/fallback selection rules.

## Persistence compatibility

Existing `contextWindow` data remains readable. `maxContextWindow` is an optional additional field, so no bulk migration is needed. Registry enrichment fills a missing legacy window and records the model maximum separately rather than overwriting a saved effective window. Explicit model refresh can update the published maximum while preserving the configured window. FastFlowLM fetches `/v1/models?installed=true&include=capabilities` from the configured server and uses only `flm.max_position_embeddings` as the published maximum.

On the same refresh, FastFlowLM's `flm.vlm` and `flm.tools` update the existing vision and tool-use capabilities when supplied. A supported `think` switch or advertised effort levels indicate reasoning support. Missing capability information preserves saved choices; `think: false` alone only means the switch is unavailable.

FastFlowLM sends an explicit thinking choice as top-level `think` and omits it for the default choice. Tools and images use the existing OpenAI-compatible request format.

On explicit model fetch, Ollama maps the published `/api/show` capacity to `maxContextWindow`. The model list uses the same context-window display as other providers.