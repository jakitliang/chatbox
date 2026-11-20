import { describe, expect, it, vi } from 'vitest'
import { parseFileWithRouter } from './index'

const { parseLocal, parseMineru } = vi.hoisted(() => ({ parseLocal: vi.fn(), parseMineru: vi.fn() }))
vi.mock('../../util', () => ({ getLogger: () => ({ debug: vi.fn(), warn: vi.fn() }) }))
vi.mock('./local-parser', () => ({
  LocalParser: class {
    supports = () => true
    parse = parseLocal
  },
}))
vi.mock('./mineru-parser', () => ({
  MineruParser: class {
    supports = () => true
    parse = parseMineru
    constructor(readonly apiToken: string) {}
  },
}))

describe('knowledge base document parser routing', () => {
  const meta = { fileId: 1, filename: 'report.pdf', mimeType: 'application/pdf' }

  it.each(['local', 'chatbox-ai'] as const)('uses only local parsing for %s', async (type) => {
    parseLocal.mockResolvedValueOnce('Local content')
    await expect(parseFileWithRouter('report.pdf', meta, { type })).resolves.toEqual({
      content: 'Local content',
      parserUsed: 'local',
    })

    parseLocal.mockRejectedValueOnce(new Error('Invalid PDF'))
    await expect(parseFileWithRouter('report.pdf', meta, { type })).rejects.toThrow('Invalid PDF')
  })

  it('uses MinerU when explicitly configured', async () => {
    parseMineru.mockResolvedValueOnce('MinerU content')
    await expect(
      parseFileWithRouter('report.pdf', meta, { type: 'mineru', mineru: { apiToken: 'test-token' } })
    ).resolves.toEqual({ content: 'MinerU content', parserUsed: 'mineru' })
  })
})
