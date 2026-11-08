# Offline bundled catalogs

The downloaded assistant JSON, configuration JSON and avatar files under
`server/snapshot` are **build inputs only**. Vite imports their contents into the
application; the shipped application never reads that directory or contacts the
backend. Keep the downloaded snapshot available when building this checkout.
No snapshot or server files are modified by catalog loading.

`loadBundledCopilotSeed(now?)` returns all 77 downloaded assistants and 56 distinct
local avatar payloads. First hydration writes the avatars to blob storage before
persisting the assistants. This uses normal picture storage keys so backups carry
the original bytes. Upstream avatar URLs are never copied into saved definitions.

The durable `local-copilots-initialized` marker is intentionally unversioned.
Existing collections (including an empty restored list) are never reseeded.
Deleting every assistant or updating the shipped catalog does not resurrect it.
Both downloaded languages are seeded together, preserving their distinct IDs.

The independent model catalog exports:

- `loadLocalModelManifest(providerId: string): LocalModelManifest`
- `listLocalModelManifestProviders(): string[]`
- Types `LocalModelManifest` and `LocalModelInfo`

Loading is synchronous, has no network/settings/license dependency, and returns
detached arrays. Unknown providers return an empty manifest. The module is ready
for integration by the model-fetch owner; it does not mutate provider settings or
change model-registry fetching itself.