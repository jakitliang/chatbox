import { getDefaultStore } from 'jotai'
import * as atoms from './atoms'
import * as defaults from '../../shared/defaults'
import { Settings, ModelProvider, CustomProvider } from '../../shared/types'

export function modify(update: Partial<Settings>) {
  const store = getDefaultStore()
  store.set(atoms.settingsAtom, (settings) => ({
    ...settings,
    ...update,
  }))
}

export function needEditSetting() {
  const store = getDefaultStore()
  const settings = store.get(atoms.settingsAtom)
  if (settings.aiProvider === 'ollama' && !settings.ollamaModel) {
    return true
  }
  if (settings.aiProvider === 'lm-studio' && !settings.lmStudioModel) {
    return true
  }
  return false
}

export function getLanguage() {
  const store = getDefaultStore()
  const settings = store.get(atoms.settingsAtom)
  return settings.language
}

export function getProxy() {
  const store = getDefaultStore()
  const settings = store.get(atoms.settingsAtom)
  return settings.proxy
}

export function getLicenseKey() {
  const store = getDefaultStore()
  const settings = store.get(atoms.settingsAtom)
  return settings.licenseKey
}

export function getRemoteConfig() {
  const store = getDefaultStore()
  return store.get(atoms.remoteConfigAtom)
}

export function getSettings() {
  const store = getDefaultStore()
  return store.get(atoms.settingsAtom)
}

export function getAutoGenerateTitle() {
  const store = getDefaultStore()
  return store.get(atoms.autoGenerateTitleAtom)
}

export function setModelProvider(provider: ModelProvider) {
  const store = getDefaultStore()
  store.set(atoms.settingsAtom, (settings) => ({
    ...settings,
    aiProvider: provider,
  }))
}

export function getExtensionSettings() {
  const store = getDefaultStore()
  return store.get(atoms.settingsAtom).extension
}

export function createCustomProvider() {
  const newCustomProvider: CustomProvider = {
    id: `custom-provider-${Date.now()}`,
    name: 'Untitled',
    api: 'openai',
    host: 'https://api.openai.com/v1',
    path: '/chat/completions',
    key: '',
    model: 'gpt-4o',
  }
  const store = getDefaultStore()
  store.set(atoms.settingsAtom, (settings) => ({
    ...settings,
    aiProvider: ModelProvider.Custom,
    selectedCustomProviderId: newCustomProvider.id,
    customProviders: [newCustomProvider, ...settings.customProviders],
  }))
}
