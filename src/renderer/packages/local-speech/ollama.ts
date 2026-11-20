import { ollamaProvider } from '@shared/providers/definitions/ollama'
import type { ProviderSettings } from '@shared/types'
import { normalizeOpenAIApiHostAndPath } from '@shared/utils/llm_utils'
import { apiRequest } from '@/utils/request'
import type { SpeechPlaybackBackend } from './contracts'

export function normalizeSpeechWav(buffer: ArrayBuffer): Blob {
  const wav = new DataView(buffer)
  if (wav.byteLength < 12 || wav.getUint32(0) !== 0x52494646 || wav.getUint32(8) !== 0x57415645) {
    throw new Error('Ollama did not return WAV audio')
  }
  for (let offset = 12; offset + 8 <= wav.byteLength; ) {
    const size = wav.getUint32(offset + 4, true)
    const available = wav.byteLength - offset - 8
    if (wav.getUint32(offset) === 0x64617461) {
      if (!available || !size) break
      // Ollama writes streaming WAV sizes before it knows the final length.
      if (size > available) wav.setUint32(offset + 4, available, true)
      wav.setUint32(4, wav.byteLength - 8, true)
      return new Blob([buffer], { type: 'audio/wav' })
    }
    if (size > available) break
    offset += 8 + size + (size % 2)
  }
  throw new Error('Ollama returned no WAV samples')
}

function playAudio(blob: Blob, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted()
  const audio = new Audio()
  const url = URL.createObjectURL(blob)
  let abort: () => void
  return new Promise<void>((resolve, reject) => {
    abort = () => reject(signal.reason)
    signal.addEventListener('abort', abort, { once: true })
    audio.onended = () => resolve()
    audio.onerror = () => reject(new Error('Could not decode Ollama speech audio'))
    audio.src = url
    void audio.play().catch(reject)
  }).finally(() => {
    signal.removeEventListener('abort', abort)
    audio.onended = null
    audio.onerror = null
    audio.pause()
    audio.removeAttribute('src')
    URL.revokeObjectURL(url)
  })
}

export function createOllamaSpeech(
  settings: ProviderSettings,
  modelId: string,
  voices: string[]
): SpeechPlaybackBackend {
  const host = normalizeOpenAIApiHostAndPath({
    apiHost: settings.apiHost?.trim() || ollamaProvider.defaultSettings?.apiHost,
  }).apiHost
  const voiceOptions = voices.map((id) => ({ id, name: id, lang: '' }))
  return {
    getVoices: () => voiceOptions,
    async speak(voice, text, signal) {
      if (!voices.includes(voice.id)) throw new Error('Ollama speech voice is unavailable')
      for (const chunk of text.match(/[\s\S]{1,4000}/gu) ?? []) {
        if (!chunk.trim()) continue
        signal.throwIfAborted()
        const response = await apiRequest.post(
          `${host}/audio/speech`,
          {},
          JSON.stringify({ model: modelId, input: chunk, voice: voice.id, response_format: 'wav' }),
          { signal, useProxy: settings.useProxy, retry: 0, responseType: 'binary' }
        )
        await playAudio(normalizeSpeechWav(await response.arrayBuffer()), signal)
      }
    },
  }
}
