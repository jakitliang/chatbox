import { describe, expect, it, vi } from 'vitest'
import { type DocumentParser, parseDocument, selectDocumentParser } from './document-parsing'

function fixture() {
  const local: DocumentParser<{ name: string }> = {
    id: 'local',
    supports: vi.fn(() => true),
    parse: vi.fn().mockResolvedValue({ text: 'local text' }),
  }
  const mineru: DocumentParser<{ name: string }> = {
    id: 'mineru',
    supports: vi.fn(() => true),
    parse: vi.fn().mockResolvedValue({ text: 'remote text' }),
  }
  return { local, mineru, registry: { local: vi.fn(() => local), mineru: vi.fn(() => mineru) } }
}

describe('shared document parsing', () => {
  it('uses the configured instance and returns its identity', async () => {
    const { registry } = fixture()
    const input = { name: 'paper.pdf' }
    const parser = selectDocumentParser(registry, 'mineru', input, 'text-local')
    await expect(parseDocument(parser, input)).resolves.toEqual({ text: 'remote text', parserId: 'mineru' })
    expect(registry.local).not.toHaveBeenCalled()
  })

  it('selects local for legacy configuration or explicit text-local policy', () => {
    const { registry, local } = fixture()
    expect(selectDocumentParser(registry, 'chatbox-ai', { name: 'paper.pdf' })).toBe(local)
    expect(selectDocumentParser(registry, 'mineru', { name: 'readme.txt' }, 'text-local')).toBe(local)
    expect(registry.mineru).not.toHaveBeenCalled()
  })

  it('distinguishes no configuration, unavailable implementation, and unsupported format', () => {
    const { registry, local } = fixture()
    const input = { name: 'paper.pdf' }
    expect(() => selectDocumentParser(registry, 'none', input)).toThrow('not-configured')
    expect(() => selectDocumentParser({ local: registry.local }, 'mineru', input)).toThrow('unavailable')
    vi.mocked(local.supports).mockReturnValue(false)
    expect(() => selectDocumentParser(registry, 'local', input)).toThrow('unsupported')
    expect(registry.mineru).not.toHaveBeenCalled()
    expect(local.parse).not.toHaveBeenCalled()
  })

  it('does not fallback after failure or an empty result', async () => {
    const { registry, local } = fixture()
    const input = { name: 'paper.pdf' }
    vi.mocked(local.parse).mockRejectedValueOnce(new Error('broken file')).mockResolvedValueOnce({ text: ' \n' })
    const parser = selectDocumentParser(registry, 'local', input)
    await expect(parseDocument(parser, input)).rejects.toThrow('broken file')
    await expect(parseDocument(parser, input)).rejects.toMatchObject({ code: 'empty' })
    expect(registry.mineru).not.toHaveBeenCalled()
  })

  it('rejects cancelled runs before starting and discards late results', async () => {
    const { local } = fixture()
    const input = { name: 'paper.pdf' }
    const controller = new AbortController()
    vi.mocked(local.parse).mockImplementationOnce(async () => {
      controller.abort(new Error('cancelled'))
      return { text: 'late result' }
    })
    await expect(parseDocument(local, input, controller.signal)).rejects.toThrow('cancelled')
    await expect(parseDocument(local, input, controller.signal)).rejects.toThrow('cancelled')
    expect(local.parse).toHaveBeenCalledExactlyOnceWith(input, controller.signal)
  })
})
