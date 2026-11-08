import { expect, it } from 'vitest'
import useChatboxAIModels from './useChatboxAIModels'

it('returns no historical or remote commercial catalog', () => {
  const result = useChatboxAIModels()
  expect(result.allChatboxAIModels).toEqual([])
  expect(result.chatboxAIImageModels).toEqual([])
  expect(result.chatboxAIModelList).toBeNull()
  expect(result.isFetching).toBe(false)
})