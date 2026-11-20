import { SPEECH_CHANNELS } from '@shared/local-speech'
import { type IpcMainInvokeEvent, ipcMain, type WebContents } from 'electron'
import { listWindowsSpeechVoices, speakWithWindowsVoice } from './local-speech'

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
}
