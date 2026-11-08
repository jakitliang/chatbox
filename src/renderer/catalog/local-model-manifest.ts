import { z } from 'zod'
import configs from '../../../server/snapshot/configs.json'
import browserCatalog from '../../../server/snapshot/browser-catalog.json'

const modelSchema = z.object({
  modelId: z.string(),
  modelName: z.string(),
  description: z.string().optional(),
  labels: z.array(z.string()).optional(),
  type: z.enum(['chat', 'embedding', 'rerank', 'image']).optional(),
  apiStyle: z.enum(['google', 'openai', 'openai-responses', 'anthropic']).optional(),
  contextWindow: z.number().optional(),
  capabilities: z.array(z.enum(['vision', 'tool_use', 'reasoning'])).optional(),
})
const manifestSchema = z.object({
  groupName: z.string(),
  models: z.array(modelSchema).nullish().transform((models) => models ?? []),
  imageModels: z.array(modelSchema).nullish().transform((models) => models ?? []),
})

// configs contains the four nonempty groups; the crawl also retained eleven
// successful empty responses. Preserve both rather than inventing model entries.
const manifests: Record<string, unknown> = {
  ...Object.fromEntries(browserCatalog.models.filter((entry) => entry.status === 200)
    .map((entry) => [entry.provider, entry.data.data])),
  ...configs.models,
}

export type LocalModelInfo = z.infer<typeof modelSchema>
export type LocalModelManifest = z.infer<typeof manifestSchema>

/** Provider IDs in the downloaded snapshot, including genuinely empty manifests. */
export function listLocalModelManifestProviders(): string[] {
  return Object.keys(manifests)
}

/** Synchronous, network-free, detached result. Unknown providers return an empty manifest. */
export function loadLocalModelManifest(providerId: string): LocalModelManifest {
  return manifestSchema.parse(
    Object.hasOwn(manifests, providerId) ? manifests[providerId] : { groupName: '', models: [], imageModels: [] }
  )
}