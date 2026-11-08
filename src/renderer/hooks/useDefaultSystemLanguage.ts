import { useEffect } from 'react'
import { initSettingsStore } from '@/stores/settingsStore'

export function useSystemLanguageWhenInit() {
  useEffect(() => {
    // Language is resolved during hydration, before rendering and without a timer.
    void initSettingsStore()
  }, [])
}
