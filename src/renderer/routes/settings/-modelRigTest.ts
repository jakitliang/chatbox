import type { Settings } from '@shared/types'
import { ModelProviderEnum } from '@shared/types'
import type { PictureRef } from './-modelRigSettings'
import { describeError, effectiveParserType, type ModelRigSlotId, searchProvider } from './-modelRigSettings'

export type SlotTestStatus = 'idle' | 'testing' | 'ok' | 'fail'

export type SlotTestResult = {
  status: 'ok' | 'fail'
  latencyMs: number
  error?: string
  fix?: string
}

export type ModelRigTestDeps = {
  settings: Settings
  configuredProviderIds: ReadonlySet<string>
  picture?: PictureRef
  hasLicense: boolean
  isDesktopLike: boolean
  pingChat: (provider: string, modelId: string, vision?: boolean) => Promise<void>
  testMineru: (token: string) => Promise<boolean>
  searchWeb: () => Promise<void>
}

async function timed(run: () => Promise<void>): Promise<{ latencyMs: number }> {
  const started = performance.now()
  await run()
  return { latencyMs: Math.round(performance.now() - started) }
}

function fail(error: string, fix: string, latencyMs = 0): SlotTestResult {
  return { status: 'fail', latencyMs, error, fix }
}

function ok(latencyMs: number): SlotTestResult {
  return { status: 'ok', latencyMs }
}

export async function runSlotTest(slotId: ModelRigSlotId, deps: ModelRigTestDeps): Promise<SlotTestResult> {
  try {
    switch (slotId) {
      case 'asr':
      case 'tts':
        return fail('This feature is not available yet', 'No setup is needed.')
      case 'llm':
      case 'fast':
        return await testChatSlot(slotId, deps)
      case 'ocr':
        return await testOcrSlot(deps)
      case 'embedding':
      case 'rerank':
        return await testMemorySlot(slotId, deps)
      case 'parser':
        return await testParserSlot(deps)
      case 'search':
        return await testSearchSlot(deps)
      case 'image':
        return testImageSlot(deps)
    }
  } catch (error) {
    const described = describeError(error)
    return fail(described.error, described.fix)
  }
}

async function testChatSlot(slotId: 'llm' | 'fast', deps: ModelRigTestDeps): Promise<SlotTestResult> {
  const selection = slotId === 'llm' ? deps.settings.defaultChatModel : deps.settings.threadNamingModel
  if (!selection) return ok(0)
  const { latencyMs } = await timed(() => pingResolvedChat(deps, selection.provider, selection.model))
  return ok(latencyMs)
}

async function testOcrSlot(deps: ModelRigTestDeps): Promise<SlotTestResult> {
  const selection = deps.settings.ocrModel
  if (!selection) {
    return fail('No OCR model is available', 'Pick a vision model from a configured provider.')
  }
  const { latencyMs } = await timed(() => pingResolvedChat(deps, selection.provider, selection.model, true))
  return ok(latencyMs)
}

function testMemorySlot(slotId: 'embedding' | 'rerank', deps: ModelRigTestDeps): SlotTestResult {
  const selection = slotId === 'embedding' ? deps.settings.defaultEmbeddingModel : deps.settings.defaultRerankModel
  if (!selection || isChatboxProviderSafe(selection.provider)) {
    return fail('No model is selected', 'Pick a model from a configured provider.')
  }
  if (!deps.configuredProviderIds.has(selection.provider)) {
    return fail(
      'This provider is not configured',
      'Check the credentials in Model Provider settings, or choose another provider.'
    )
  }
  return ok(0)
}

async function testParserSlot(deps: ModelRigTestDeps): Promise<SlotTestResult> {
  const type = effectiveParserType(deps.settings, 'local')
  if (type === 'local') {
    return ok(0)
  }
  const token = deps.settings.extension?.documentParser?.mineru?.apiToken?.trim()
  if (!token) {
    return fail('MinerU API token is missing', 'Add a MinerU API token in Document Parser settings.')
  }
  const { latencyMs } = await timed(async () => {
    const success = await deps.testMineru(token)
    if (!success) {
      throw new Error('MinerU API key invalid')
    }
  })
  return ok(latencyMs)
}

async function testSearchSlot(deps: ModelRigTestDeps): Promise<SlotTestResult> {
  const provider = searchProvider(deps.settings)
  if (provider === 'tavily' && !deps.settings.extension?.webSearch?.tavilyApiKey) {
    return fail('Tavily API key is missing', 'Add a Tavily API key in Web Search settings.')
  }
  if (provider === 'bocha' && !deps.settings.extension?.webSearch?.bochaApiKey) {
    return fail('BoCha API key is missing', 'Add a BoCha API key in Web Search settings.')
  }
  if (provider === 'querit' && !deps.settings.extension?.webSearch?.queritApiKey) {
    return fail('Querit API key is missing', 'Add a Querit API key in Web Search settings.')
  }
  if (provider === 'searxng' && !deps.settings.extension?.webSearch?.searxngBaseUrl?.trim()) {
    return fail('SearXNG URL is missing', 'Add a SearXNG instance URL in Web Search settings.')
  }
  const { latencyMs } = await timed(() => deps.searchWeb())
  return ok(latencyMs)
}

function testImageSlot(deps: ModelRigTestDeps): SlotTestResult {
  const picture = deps.picture
  if (!picture || isChatboxProviderSafe(picture.provider)) {
    return fail('No image model is selected', 'Pick an image model from a configured provider.')
  }
  if (!deps.configuredProviderIds.has(picture.provider)) {
    return fail(
      'This provider is not configured',
      'Check the credentials in Model Provider settings, or choose another provider.'
    )
  }
  return ok(0)
}

async function pingResolvedChat(deps: ModelRigTestDeps, provider: string, modelId: string, vision?: boolean) {
  if (isChatboxProviderSafe(provider)) throw new Error('This provider is unavailable')
  await deps.pingChat(provider, modelId, vision)
}

function isChatboxProviderSafe(provider?: string) {
  return provider === ModelProviderEnum.ChatboxAI
}
