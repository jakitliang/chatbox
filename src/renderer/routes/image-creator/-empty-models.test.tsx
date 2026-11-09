// @vitest-environment jsdom
import { MantineProvider } from '@mantine/core'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ generate: vi.fn(), picture: undefined as { provider: string; modelId: string } | undefined }))
vi.mock('@tanstack/react-router', () => ({ createFileRoute: () => (route: unknown) => route }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('@/platform', () => ({ default: {} }))
vi.mock('@/i18n', () => ({ default: { t: (key: string) => key } }))
vi.mock('@/adapters', () => ({ createModelDependencies: vi.fn() }))
vi.mock('@mantine/hooks', async (original) => ({
  ...await original<typeof import('@mantine/hooks')>(), useElementSize: () => ({ ref: vi.fn(), width: 800, height: 100 }),
}))
vi.mock('@/components/layout/Page', () => ({ default: ({ children }: React.PropsWithChildren) => <main>{children}</main> }))
vi.mock('@/hooks/useScreenChange', () => ({ useIsSmallScreen: () => false }))
vi.mock('@/hooks/useProviders', () => ({ useProviders: () => ({ providers: [] }) }))
vi.mock('@/hooks/useImageModelGroups', () => ({ useImageModelGroups: () => [] }))
vi.mock('@/hooks/useLocalImageModels', () => ({ useLocalImageModels: () => ({ group: undefined }) }))
vi.mock('@/packages/local-image-backend', () => ({ LOCAL_IMAGE_BACKEND_ID: 'local-sdapi' }))
vi.mock('@/components/ImageModelSelect', () => ({
  ImageModelSelect: ({ modelGroups }: { modelGroups: unknown[] }) => <button type="button">{modelGroups.length ? 'Models' : 'No models available'}</button>,
}))
vi.mock('@/stores/localImageBackendStore', () => ({
  useLocalImageBackendStore: (select: (state: unknown) => unknown) => select({ url: '', defaultModelId: '', steps: 20 }),
}))
vi.mock('@/stores/lastUsedModelStore', () => ({
  useLastUsedModelStore: (select: (state: unknown) => unknown) => select({ picture: mocks.picture }),
  lastUsedModelStore: { getState: () => ({ setPictureModel: vi.fn() }) },
}))
vi.mock('@/stores/settingsStore', () => ({ settingsStore: { getState: () => ({ licenseKey: '' }) } }))
vi.mock('@/stores/queryClient', () => ({ queryClient: {} }))
vi.mock('@/stores/toastActions', () => ({ add: vi.fn() }))
vi.mock('@/packages/chatbox-cli/image-task-follow-up', () => ({ resumeImageGenerationWithFollowUp: vi.fn() }))
vi.mock('@/stores/imageGenerationActions', () => ({ createAndGenerate: mocks.generate, cancelGeneration: vi.fn(), retryGeneration: vi.fn() }))
vi.mock('@/stores/imageGenerationStore', () => ({
  useCurrentGeneratingId: () => null,
  useCurrentRecordId: () => null,
  useImageGenerationRecord: () => ({}),
  useImageGenerationHistory: () => ({}),
  imageGenerationStore: {}, deleteRecord: vi.fn(), IMAGE_GEN_LIST_QUERY_KEY: 'images',
}))
vi.mock('./-hooks/useReferenceImageDraft', () => ({
  useReferenceImageDraft: () => ({ images: [] }),
}))
vi.mock('./-components/EmptyState', () => ({
  EmptyState: ({ onPromptSelect }: { onPromptSelect: (prompt: string) => void }) => <button onClick={() => onPromptSelect('Quick prompt')}>Quick prompt</button>,
}))
vi.mock('./-components/HistoryPanel', () => ({ HistoryPanel: () => null }))
vi.mock('./-components/ReferenceImagesPreview', () => ({ ReferenceImagesPreview: () => null }))
vi.mock('./-components/GeneratedImagesGallery', () => ({ GeneratedImagesGallery: () => null }))
vi.mock('./-components/ImageGenerationErrorTips', () => ({ ImageGenerationErrorTips: () => null }))
vi.mock('./-components/MobileDrawers', () => ({ MobileHistoryDrawer: () => null, MobileModelDrawer: () => null, MobileRatioDrawer: () => null }))
vi.mock('./-components/PromptDisplay', () => ({ PromptDisplay: () => null }))

import { ImageCreatorPage } from './index'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.picture = undefined
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  })
  global.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
})
afterEach(cleanup)

it.each([undefined, { provider: 'local-sdapi', modelId: 'http://legacy:7860' }])(
  'keeps the existing empty creator and blocks button, Enter and quick-prompt generation (%j)',
  (picture) => {
    mocks.picture = picture
    const { container } = render(<MantineProvider><ImageCreatorPage /></MantineProvider>)
    const input = screen.getByPlaceholderText('Describe the image you want to create...')
    fireEvent.change(input, { target: { value: 'A landscape' } })
    expect(screen.getByRole('button', { name: 'No models available' })).not.toBeNull()
    const send = container.querySelector('button.mantine-ActionIcon-root') as HTMLButtonElement
    expect(send.disabled).toBe(true)
    fireEvent.click(send)
    fireEvent.keyDown(input, { key: 'Enter' })
    fireEvent.click(screen.getByRole('button', { name: 'Quick prompt' }))
    expect(mocks.generate).not.toHaveBeenCalled()
    expect(screen.queryByRole('alert')).toBeNull()
  }
)