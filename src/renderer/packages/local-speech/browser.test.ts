import { describe, expect, it, vi } from 'vitest'
import { createBrowserSpeech } from './browser'

function setup() {
  const local: SpeechSynthesisVoice = {
    default: false,
    localService: true,
    name: 'Local',
    lang: 'zh-CN',
    voiceURI: 'local',
  }
  const remote: SpeechSynthesisVoice = {
    default: true,
    localService: false,
    name: 'Remote',
    lang: 'en-US',
    voiceURI: 'remote',
  }
  class Utterance extends EventTarget {
    voice: SpeechSynthesisVoice | null = null
    lang = ''
    onend: (() => void) | null = null
    onerror: ((event: SpeechSynthesisErrorEvent) => void) | null = null
    constructor(readonly text: string) {
      super()
    }
  }
  const synth = {
    getVoices: vi.fn(() => [remote, local]),
    speak: vi.fn<(utterance: Utterance) => void>(),
    cancel: vi.fn(),
    addEventListener: vi.fn(),
  }
  vi.stubGlobal('SpeechSynthesisUtterance', Utterance)
  const backend = createBrowserSpeech(
    { speechSynthesis: synth as unknown as SpeechSynthesis },
    SpeechSynthesisUtterance
  )
  vi.unstubAllGlobals()
  return { backend, synth, local }
}

describe('device-only browser speech', () => {
  it('only lists local voices and never lets the browser pick the default voice', async () => {
    const { backend, synth, local } = setup()
    const voices = await backend.getVoices()
    expect(voices.map(({ id }) => id)).toEqual(['local'])
    synth.speak.mockImplementation((utterance) => utterance.onend?.())
    await backend.speak(voices[0], '試聽', new AbortController().signal)
    expect(synth.speak).toHaveBeenCalledWith(expect.objectContaining({ text: '試聽', voice: local, lang: 'zh-CN' }))
  })

  it('rejects instead of falling back when a voice stops being local', async () => {
    const { backend, synth, local } = setup()
    const [voice] = await backend.getVoices()
    synth.getVoices.mockReturnValue([{ ...local, localService: false }])
    await expect(backend.speak(voice, 'Hello', new AbortController().signal)).rejects.toThrow('no longer available')
    expect(synth.speak).not.toHaveBeenCalled()
  })

  it('cancels the current utterance and does not enqueue the rest', async () => {
    const { backend, synth } = setup()
    const [voice] = await backend.getVoices()
    const controller = new AbortController()
    const playback = backend.speak(voice, '中'.repeat(450), controller.signal)
    expect(synth.speak.mock.calls[0][0].text.length).toBe(200)
    controller.abort()
    await playback
    expect(synth.cancel).toHaveBeenCalledOnce()
    expect(synth.speak).toHaveBeenCalledOnce()
  })
})
