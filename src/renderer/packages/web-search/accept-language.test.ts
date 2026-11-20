import { describe, expect, it } from 'vitest'
import { getSearchAcceptLanguage } from './accept-language'

describe('getSearchAcceptLanguage', () => {
  it('maps English app language to English search preference', () => {
    expect(getSearchAcceptLanguage('en')).toBe('en-US,en;q=0.9')
  })

  it('maps Simplified Chinese app language to zh-CN search preference', () => {
    expect(getSearchAcceptLanguage('zh-Hans')).toBe('zh-CN,zh;q=0.9,en;q=0.8')
  })

  it('maps Traditional Chinese app language to zh-TW search preference', () => {
    expect(getSearchAcceptLanguage('zh-Hant')).toBe('zh-TW,zh-HK;q=0.9,zh;q=0.8,en;q=0.7')
  })
})
