import { expect, it } from 'vitest'
import { fetchNativeChatboxAIModelCatalog } from './native-account'

it('does not revive the removed account model catalog', async () => {
  await expect(fetchNativeChatboxAIModelCatalog(undefined, undefined)).rejects.toThrow(
    'Chatbox AI account services are unavailable in the self-hosted edition'
  )
})
