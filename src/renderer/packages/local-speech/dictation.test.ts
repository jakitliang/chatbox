import { beforeEach, describe, expect, it, vi } from 'vitest'
import { appendDictation, createBrowserDictation } from './dictation'

vi.mock('@/packages/navigator', () => ({ getOS: () => 'Linux' }))

class Recognition extends EventTarget {
  static available = vi.fn(async (_options: { langs: string[]; processLocally: true }) => 'available')
  static instance: Recognition
  processLocally = false
  lang = ''
  continuous = false
  interimResults = true
  constructor() {
    super()
    Recognition.instance = this
  }
  start = vi.fn()
  stop = vi.fn()
  abort = vi.fn()

  deliver(text: string, isFinal: boolean) {
    this.dispatchEvent(Object.assign(new Event('result'), { results: [{ isFinal, 0: { transcript: text } }] }))
  }
}

describe('device-only dictation', () => {
  beforeEach(() => Recognition.available.mockReset().mockResolvedValue('available'))

  it('only enables recognition with a local language pack', async () => {
    const backend = createBrowserDictation(Recognition)
    Recognition.available.mockResolvedValueOnce('downloadable')
    await expect(backend.availability('zh-CN')).resolves.toEqual({ kind: 'language-unavailable' })
    expect(Recognition.available).toHaveBeenCalledWith({ langs: ['zh-CN'], processLocally: true })
    await expect(createBrowserDictation(undefined).availability('zh-CN')).resolves.toEqual({ kind: 'unsupported' })
  })

  it('starts on-device and returns final text, not interim results, on stop', async () => {
    const session = createBrowserDictation(Recognition).start('zh-CN')
    const recognition = Recognition.instance
    expect(recognition).toMatchObject({ processLocally: true, lang: 'zh-CN', interimResults: false })
    expect(recognition.start).toHaveBeenCalledOnce()
    recognition.deliver('interim', false)
    session.stop()
    expect(recognition.stop).toHaveBeenCalledOnce()
    recognition.deliver('final', true)
    recognition.dispatchEvent(new Event('end'))
    await expect(session.result).resolves.toBe('final')
  })

  it('discards all results on cancellation', async () => {
    const session = createBrowserDictation(Recognition).start('en-US')
    const recognition = Recognition.instance
    recognition.deliver('discard this', true)
    session.cancel()
    expect(recognition.abort).toHaveBeenCalledOnce()
    await expect(session.result).resolves.toBe('')
  })

  it('appends to the latest draft without replacing its text or whitespace', () => {
    expect(appendDictation('typed', ' spoken ')).toBe('typed spoken')
    expect(appendDictation('typed\n', 'spoken')).toBe('typed\nspoken')
    expect(appendDictation('typed', ' ')).toBe('typed')
  })
})
