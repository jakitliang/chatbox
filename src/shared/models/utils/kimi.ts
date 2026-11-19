/**
 * Moonshot Kimi K2 / K3 families pin sampling parameters server-side
 * (temperature 1.0, or 0.6 when thinking is off; top_p 0.95). Passing any
 * other value returns invalid_request_error, so callers must omit them.
 *
 * Matches native ids (`kimi-k3`), aggregator prefixes
 * (`moonshotai/kimi-k3`, `moonshotai/Kimi-K2.6`), and OpenRouter's rolling
 * Kimi alias. Local adapters can opt out of this upstream sampling contract.
 */
const KIMI_FIXED_SAMPLING_MODEL_PATTERN = /(?:^|\/)kimi-k[23]/i
const KIMI_LATEST_OPENROUTER_ALIAS = '~moonshotai/kimi-latest'

export function isKimiFixedSamplingModel(modelId: string): boolean {
  return KIMI_FIXED_SAMPLING_MODEL_PATTERN.test(modelId) || modelId.toLowerCase() === KIMI_LATEST_OPENROUTER_ALIAS
}
