import { describe, expect, it } from 'vitest'
import { translationResources } from './index'

const english = Object.entries(translationResources.en.translation)
const englishKeys = english.map(([key]) => key).sort()

function placeholders(text: string) {
  return Array.from(text.matchAll(/{{\s*([^{}]+?)\s*}}/g), ([, name]) => name).sort()
}

describe('translation catalogs', () => {
  it.each(Object.entries(translationResources))('keeps %s aligned with English', (_locale, { translation }) => {
    const catalog: Readonly<Record<string, string | undefined>> = translation
    expect(Object.keys(catalog).sort()).toEqual(englishKeys)
    const mismatches = english.flatMap(([key, text]) =>
      typeof catalog[key] === 'string' && placeholders(catalog[key]).join('\0') === placeholders(text).join('\0')
        ? []
        : [key]
    )
    expect(mismatches).toEqual([])
  })
})
