import { expect, it } from 'vitest'
import { parseLocale } from './parser'
it.each(['zh', 'zh-CN', 'zh_SG', 'ZH-hans-CN'])('detects simplified Chinese environment %s', (locale) => {
  expect(parseLocale(locale)).toBe('zh-Hans')
})
it.each(['zh-TW', 'zh_HK', 'zh-MO', 'ZH-Hant-TW'])('detects traditional Chinese environment %s', (locale) => {
  expect(parseLocale(locale)).toBe('zh-Hant')
})
it('retains supported system languages and falls back to English', () => {
  expect(parseLocale('JA_jp')).toBe('ja')
  expect(parseLocale('unknown')).toBe('en')
})