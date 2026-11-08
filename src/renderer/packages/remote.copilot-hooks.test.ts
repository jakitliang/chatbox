import { beforeEach, describe, expect, it, vi } from 'vitest'

const { state, query, infiniteQuery, tags, list } = vi.hoisted(() => ({
  state: { appApiServer: 'http://127.0.0.1:4567', language: 'en' },
  query: vi.fn(), infiniteQuery: vi.fn(), tags: vi.fn(), list: vi.fn(),
}))
vi.mock('@tanstack/react-query', () => ({ useQuery: query, useInfiniteQuery: infiniteQuery }))
vi.mock('react', () => ({ useMemo: (fn: () => unknown) => fn(), useCallback: (fn: unknown) => fn }))
vi.mock('jotai', () => ({ useAtomValue: vi.fn() }))
vi.mock('@/stores/copilotStore', () => ({
  addOrUpdateMyCopilot: vi.fn(), copilotMemoryOwnersAtom: {}, disableCopilotMemory: vi.fn(),
  enableCopilotMemory: vi.fn(), myCopilotsAtom: {}, readCopilotMemoryEnabled: vi.fn(), removeMyCopilot: vi.fn(),
}))
vi.mock('@/stores/settingsStore', () => ({
  useLanguage: () => state.language,
  useSettingsStore: (selector: (value: typeof state) => unknown) => selector(state),
}))
vi.mock('@/packages/remote', () => ({ listCopilotTags: tags, listCopilotsByCursor: list }))

import { useRemoteCopilotsByCursor, useRemoteCopilotTags } from '@/hooks/useCopilots'

describe('retired remote assistant hooks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    state.appApiServer = 'http://127.0.0.1:4567'
    query.mockReturnValue({ data: [] })
    infiniteQuery.mockReturnValue({ data: { pages: [] } })
  })

  it('never schedules backend requests or exposes a curated list', async () => {
    for (const server of ['http://127.0.0.1:4567', 'https://selfhost.example']) {
      state.appApiServer = server
      expect(useRemoteCopilotTags().tags).toEqual([])
      const result = useRemoteCopilotsByCursor({ limit: 2, tag: 'Writing', search: 'local' })
      expect(result).toMatchObject({ copilots: [], hasNextPage: false, isLoading: false })
      await result.fetchNextPage()
    }
    expect(query).not.toHaveBeenCalled()
    expect(infiniteQuery).not.toHaveBeenCalled()
    expect(tags).not.toHaveBeenCalled()
    expect(list).not.toHaveBeenCalled()
  })
})