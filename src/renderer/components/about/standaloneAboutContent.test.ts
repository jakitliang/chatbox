import { translationResources } from '@chatbox/i18n'
import { MAX_TOOL_CALLS_BEFORE_CONFIRMATION } from '@shared/utils/tool-call-limit-pause'
import { createInstance } from 'i18next'
import { describe, expect, it } from 'vitest'
import { getConfigurationQuickReference } from './standaloneAboutContent'

describe('standalone configuration quick reference', () => {
  it.each(Object.keys(translationResources))('resolves every table label in %s without fallback', async (lng) => {
    const i18n = createInstance()
    const missing: string[] = []
    await i18n.init({
      lng,
      resources: translationResources,
      fallbackLng: false,
      saveMissing: true,
      missingKeyHandler: (_languages, _namespace, key) => missing.push(key),
    })

    const reference = getConfigurationQuickReference(i18n.getFixedT(lng))
    expect(missing).toEqual([])
    expect(reference.headers).toHaveLength(5)
    expect(reference.rows).toHaveLength(11)
    expect(reference.rows.every((row) => row.length === 5 && row.every(Boolean))).toBe(true)
    const provider = i18n.t('Model Provider')
    expect(reference.rows[0][0]).toBe(provider)
    expect(reference.rows[0][1]).toContain(provider)
    const count = MAX_TOOL_CALLS_BEFORE_CONFIRMATION
    const pauseRow = reference.rows.find(([label]) => label === i18n.t('Pause after every {{count}} steps', { count }))
    expect(pauseRow?.[4]).toContain(String(count))
    expect(pauseRow?.[4]).not.toContain('{{count}}')
  })
})
