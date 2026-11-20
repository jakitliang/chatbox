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
    const onUpdate = vi.fn()
    const session = createBrowserDictation(Recognition).start('zh-CN', onUpdate)
    const recognition = Recognition.instance
    expect(recognition).toMatchObject({ processLocally: true, lang: 'zh-CN', interimResults: true })
    expect(recognition.start).toHaveBeenCalledOnce()
    recognition.deliver('interim', false)
    expect(onUpdate).toHaveBeenLastCalledWith({ confirmed: '', interim: 'interim' })
    session.stop()
    expect(recognition.stop).toHaveBeenCalledOnce()
    recognition.deliver('final', true)
    expect(onUpdate).toHaveBeenLastCalledWith({ confirmed: 'final', interim: '' })
    recognition.dispatchEvent(new Event('end'))
    recognition.deliver('too late', true)
    expect(onUpdate).toHaveBeenCalledTimes(2)
    await expect(session.result).resolves.toBe('final')
  })

  it('projects cumulative results and clears revised or withdrawn hypotheses without duplicating text', async () => {
    const onUpdate = vi.fn()
    const session = createBrowserDictation(Recognition).start('en-US', onUpdate)
    function deliver(...parts: [string, boolean][]) {
      const results = parts.map(([transcript, isFinal]) => ({ isFinal, 0: { transcript } }))
      Recognition.instance.dispatchEvent(Object.assign(new Event('result'), { results }))
    }
    deliver(['one', true], ['tree', false])
    deliver(['one', true], ['two', false])
    deliver(['one', true])
    deliver(['one', true], ['two', true])
    Recognition.instance.dispatchEvent(new Event('end'))
    expect(onUpdate.mock.calls.map(([update]) => update)).toEqual([
      { confirmed: 'one', interim: 'tree' },
      { confirmed: 'one', interim: 'two' },
      { confirmed: 'one', interim: '' },
      { confirmed: 'one two', interim: '' },
    ])
    await expect(session.result).resolves.toBe('one two')
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
