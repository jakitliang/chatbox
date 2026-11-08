import { expect, it, vi } from 'vitest'
import { parseNativeChatboxAIDocument } from './native-document-parser'

it('disables the Chatbox parser without uploading the file', async () => {
  const upload = vi.fn<(url: string) => Promise<void>>()
  await expect(
    parseNativeChatboxAIDocument('license', { filename: 'private.pdf', filetype: 'application/pdf', upload })
  ).rejects.toThrow('Chatbox AI document parsing is disabled')
  expect(upload).not.toHaveBeenCalled()
})
