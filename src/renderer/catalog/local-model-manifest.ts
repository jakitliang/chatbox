import { z } from 'zod'
import browserCatalog from '../../../server/snapshot/browser-catalog.json'
import configs from '../../../server/snapshot/configs.json'

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

const snapshotEntrySchema = z.object({ provider: z.string(), status: z.number(), data: z.unknown() })
const snapshotManifestSchema = z.object({ data: manifestSchema })
const snapshotEntries = z.array(snapshotEntrySchema).parse(browserCatalog.models)

// If both snapshots include a provider, its explicit config takes precedence.
const manifests: Record<string, unknown> = {
  ...Object.fromEntries(
    snapshotEntries
      .filter((entry) => entry.status === 200)
      .map((entry) => [entry.provider, snapshotManifestSchema.parse(entry.data).data])
  ),
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