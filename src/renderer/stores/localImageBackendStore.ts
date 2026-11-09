import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { normalizeLocalImageBackendUrl, validateLocalImageSteps } from '@/packages/local-image-backend'
import { getSafeStorage } from './safeStorage'

export interface LocalImageBackendConfig {
  url: string
  defaultModelId: string
  steps: number
}

interface LocalImageBackendState extends LocalImageBackendConfig {
  setConfig(config: Partial<LocalImageBackendConfig>): void
  setDefaultModelId(modelId: string): void
  setSteps(steps: number): void
}

const defaults: LocalImageBackendConfig = { url: '', defaultModelId: '', steps: 20 }

function validated(config: LocalImageBackendConfig): LocalImageBackendConfig {
  return {
    url: config.url.trim() ? normalizeLocalImageBackendUrl(config.url) : '',
    defaultModelId: config.defaultModelId,
    steps: validateLocalImageSteps(config.steps),
  }
}

/** Defaults only. Temporary Image Creator selections must never write this store. */
export const useLocalImageBackendStore = create<LocalImageBackendState>()(
  persist(
    (set, get) => ({
      ...defaults,
      setConfig: (config) => set(validated({ ...get(), ...config })),
      setDefaultModelId: (defaultModelId) => set({ defaultModelId }),
      setSteps: (steps) => set({ steps: validateLocalImageSteps(steps) }),
    }),
    {
      name: 'local-image-backend',
      version: 1,
      storage: getSafeStorage<LocalImageBackendConfig>(),
      partialize: ({ url, defaultModelId, steps }) => ({ url, defaultModelId, steps }),
      merge: (saved, current) => {
        try {
          return { ...current, ...validated({ ...defaults, ...(saved as Partial<LocalImageBackendConfig>) }) }
        } catch {
          return current
        }
      },
    }
  )
)