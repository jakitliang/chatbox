import { describe, expect, it, vi } from 'vitest'
import { apiRequest } from '@/utils/request'
import { createOllamaSpeech, normalizeSpeechWav } from './ollama'
import { listSpeechModels, resolvePlayback } from './playback-backends'

vi.mock('@/utils/request', () => ({ apiRequest: { post: vi.fn() } }))
vi.mock('./built-in', () => ({ getBuiltInSpeech: () => ({}) }))

describe('Ollama speech playback', () => {
  it('only lists models advertising speech, without requiring audio input', () => {
    const settings = {
      models: [
        { modelId: 'transcriber', audio: { input: true, speech: false } },
        { modelId: 'speaker', audio: { input: false, speech: true, voices: ['default'] } },
        { modelId: 'audio-alias' },
      ],
    }
    expect(listSpeechModels(settings).map(({ modelId }) => modelId)).toEqual(['speaker'])
    expect(resolvePlayback('ollama:transcriber', settings)).toBeUndefined()
    expect(resolvePlayback('ollama:speaker', settings)?.getVoices()).toEqual([
      { id: 'default', name: 'default', lang: '' },
    ])
    expect(resolvePlayback('ollama:speaker', { models: [] })).toBeUndefined()
  })

  it('fixes streaming WAV lengths without changing audio samples', async () => {
    const buffer = new ArrayBuffer(22)
    const wav = new DataView(buffer)
    wav.setUint32(0, 0x52494646)
    wav.setUint32(4, 0xffffffff, true)
    wav.setUint32(8, 0x57415645)
    wav.setUint32(12, 0x64617461)
    wav.setUint32(16, 0xffffffff, true)
    wav.setInt16(20, 350, true)
    const normalized = new DataView(await normalizeSpeechWav(buffer).arrayBuffer())
    expect(normalized.getUint32(4, true)).toBe(14)
    expect(normalized.getUint32(16, true)).toBe(2)
    expect(normalized.getInt16(20, true)).toBe(350)
    expect(() => normalizeSpeechWav(new ArrayBuffer(24))).toThrow('did not return WAV')
  })

  it('uses the configured endpoint and never substitutes a missing voice', async () => {
    const backend = createOllamaSpeech(
      { apiHost: 'http://example.test/ollama/v1/chat/completions' },
      'custom-speaker',
      ['voice']
    )
    const signal = new AbortController().signal
    await expect(backend.speak({ id: 'removed', lang: '', name: '' }, 'Hello', signal)).rejects.toThrow('unavailable')
    expect(apiRequest.post).not.toHaveBeenCalled()
    vi.mocked(apiRequest.post).mockRejectedValueOnce(new Error('offline'))
    await expect(backend.speak({ id: 'voice', lang: '', name: '' }, 'Hello', signal)).rejects.toThrow('offline')
    expect(apiRequest.post).toHaveBeenCalledOnce()
    expect(apiRequest.post).toHaveBeenCalledWith(
      'http://example.test/ollama/v1/audio/speech',
      {},
      JSON.stringify({ model: 'custom-speaker', input: 'Hello', voice: 'voice', response_format: 'wav' }),
      expect.objectContaining({ signal, retry: 0, responseType: 'binary' })
    )
  })
})
