import type { RemoteConfig, SessionRagConfig } from '@shared/types'

/** Inert standalone defaults; old backend/cache values never enable cloud features. */
export const LOCAL_RUNTIME_CONFIG: Readonly<RemoteConfig> = {
  setting_chatboxai_first: false,
  current_version: '',
  product_ids: [],
}

export function loadLocalSessionRagConfig(): SessionRagConfig {
  return {
    models: { embedding: '', rerank: '' },
    capabilities: { session_attachment_embedding: false, session_attachment_rerank: false },
  }
}