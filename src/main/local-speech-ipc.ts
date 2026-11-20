import { SPEECH_CHANNELS } from '@shared/local-speech'
import { type IpcMainInvokeEvent, ipcMain, type WebContents } from 'electron'
import { listWindowsSpeechVoices, speakWithWindowsVoice } from './local-speech'
import { listWindowsDictationLanguages, startWindowsDictation } from './windows-dictation'

export function registerLocalSpeechHandlers(getAppContents: () => WebContents | undefined) {
  function authorize(event: IpcMainInvokeEvent) {
    if (event.sender !== getAppContents() || !event.senderFrame || event.senderFrame !== event.sender.mainFrame) {
      throw new Error('Speech is restricted to the application window')
    }
  }

  let playing: AbortController | undefined
  ipcMain.handle(SPEECH_CHANNELS.voices, (event) => {
    authorize(event)
    return listWindowsSpeechVoices()
  })
  ipcMain.handle(SPEECH_CHANNELS.speak, async (event, voiceId: unknown, text: unknown) => {
    authorize(event)
    if (
      typeof voiceId !== 'string' ||
      !voiceId ||
      voiceId.length > 512 ||
      typeof text !== 'string' ||
      !text.trim() ||
      text.length > 100_000
    ) {
      throw new Error('Invalid speech input')
    }
    playing?.abort()
    const playback = new AbortController()
    playing = playback
    const stop = () => playback.abort()
    const sender = event.sender
    sender.once('destroyed', stop)
    sender.once('render-process-gone', stop)
    sender.once('did-navigate', stop)
    try {
      await speakWithWindowsVoice(voiceId, text, playback.signal)
    } catch (error) {
      if (!playback.signal.aborted) throw error
    } finally {
      if (!sender.isDestroyed()) {
        sender.off('destroyed', stop)
        sender.off('render-process-gone', stop)
        sender.off('did-navigate', stop)
      }
      if (playing === playback) playing = undefined
    }
  })
  ipcMain.handle(SPEECH_CHANNELS.stop, (event) => {
    authorize(event)
    playing?.abort()
  })

  let dictation: { id: string; abort: AbortController; stop: () => void } | undefined
  ipcMain.handle(SPEECH_CHANNELS.dictationLanguages, (event) => {
    authorize(event)
    return listWindowsDictationLanguages()
  })
  ipcMain.handle(SPEECH_CHANNELS.dictationStart, async (event, id: unknown, lang: unknown) => {
    authorize(event)
    if (
      typeof id !== 'string' ||
      !/^[a-z0-9-]{1,64}$/i.test(id) ||
      typeof lang !== 'string' ||
      !/^[a-z0-9-]{2,40}$/i.test(lang)
    ) {
      throw new Error('Invalid dictation request')
    }
    dictation?.abort.abort()
    const abort = new AbortController()
    const sender = event.sender
    const frame = event.senderFrame
    const { result, stop } = startWindowsDictation(lang, abort.signal, (confirmed, interim) => {
      if (!abort.signal.aborted && frame && !frame.isDestroyed() && !frame.detached) {
        frame.send(SPEECH_CHANNELS.dictationUpdate, id, confirmed, interim)
      }
    })
    const current = { id, abort, stop }
    dictation = current
    const cancel = () => abort.abort()
    sender.once('destroyed', cancel)
    sender.once('render-process-gone', cancel)
    sender.once('did-navigate', cancel)
    try {
      return await result
    } finally {
      if (!sender.isDestroyed()) {
        sender.off('destroyed', cancel)
        sender.off('render-process-gone', cancel)
        sender.off('did-navigate', cancel)
      }
      if (dictation === current) dictation = undefined
    }
  })
  ipcMain.handle(SPEECH_CHANNELS.dictationEnd, (event, id: unknown, cancel: unknown) => {
    authorize(event)
    if (!dictation || dictation.id !== id) return
    if (cancel === true) dictation.abort.abort()
    else dictation.stop()
  })
}
