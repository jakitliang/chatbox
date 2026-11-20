// @vitest-environment jsdom
import NiceModal from '@ebay/nice-modal-react'
import { translationResources, type TranslationKey } from '@chatbox/i18n'
import { createInstance } from 'i18next'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { capacitorDocumentParser } from './document-parser'

const mocks = vi.hoisted(() => ({ local: vi.fn(), pdf: vi.fn(), cloud: vi.fn(), license: vi.fn(), t: vi.fn() }))
vi.mock('./execution-service', () => ({ capacitorExecution: { parseDocument: mocks.local } }))
vi.mock('@/packages/pdf-parser', () => ({ parsePdfFileLocally: mocks.pdf }))
vi.mock('@/packages/remote', () => ({ uploadAndParseUserFile: mocks.cloud }))
vi.mock('@/stores/settingActions', () => ({ getLicenseKey: mocks.license }))
vi.mock('@ebay/nice-modal-react', () => ({ default: { show: vi.fn(), hide: vi.fn() } }))
vi.mock('@/i18n', () => ({
  default: { t: mocks.t },
}))

const parse = (name: string, signal = new AbortController().signal) =>
  capacitorDocumentParser.parse(`input/${name}`, btoa('fixture'), signal)

beforeEach(() => {
  vi.resetAllMocks()
  mocks.t.mockImplementation((key: string, args?: Record<string, string>) =>
    key.replace(/{{(\w+)}}/g, (_, name: string) => args?.[name] ?? '')
  )
  mocks.license.mockReturnValue('test-license')
  mocks.cloud.mockResolvedValue('Cloud document text')
  vi.mocked(NiceModal.show).mockResolvedValue(true)
})

describe('mobile work document parsing', () => {
  it.each(['report.docx', 'table.xlsx', 'deck.pptx'])(
    'parses %s locally without cloud consent or a license',
    async (name) => {
      mocks.license.mockReturnValue('')
      mocks.local.mockResolvedValue({ text: 'Local text', truncated: true })
      expect(await parse(name)).toEqual({ text: 'Local text', truncated: true })
      expect(mocks.cloud).not.toHaveBeenCalled()
      expect(NiceModal.show).not.toHaveBeenCalled()
    }
  )

  it('uses the existing PDF parser and bounds its result', async () => {
    mocks.pdf.mockResolvedValue('p'.repeat(100001))
    const signal = new AbortController().signal
    expect(await parse('REPORT.PDF', signal)).toEqual({ text: 'p'.repeat(100000), truncated: true })
    expect(mocks.pdf.mock.calls[0][0]).toMatchObject({ name: 'REPORT.PDF', type: 'application/pdf' })
    expect(mocks.pdf.mock.calls[0][1]).toEqual({ signal, failOnPageError: true })
    expect(mocks.cloud).not.toHaveBeenCalled()
  })

  it.each(['report.doc', 'table.xls', 'deck.ppt'])('rejects legacy Office %s without uploading', async (name) => {
    await expect(parse(name)).rejects.toThrow('Convert it to PDF, DOCX, XLSX, or PPTX')
    expect(mocks.local).not.toHaveBeenCalled()
    expect(mocks.pdf).not.toHaveBeenCalled()
    expect(NiceModal.show).not.toHaveBeenCalled()
    expect(mocks.cloud).not.toHaveBeenCalled()
  })

  it.each(['report.pdf', 'report.docx'])('surfaces local failure for %s without uploading', async (name) => {
    mocks.pdf.mockRejectedValue(new Error('Invalid PDF'))
    mocks.local.mockRejectedValue(new Error('Invalid document'))
    await expect(parse(name)).rejects.toThrow('could not be parsed locally')
    expect(NiceModal.show).not.toHaveBeenCalled()
    expect(mocks.cloud).not.toHaveBeenCalled()
  })

  it.each(['report.pdf', 'report.docx'])('reports empty local output for %s without uploading', async (name) => {
    mocks.pdf.mockResolvedValue(' \n')
    mocks.local.mockResolvedValue({ text: ' \n', truncated: false })
    await expect(parse(name)).rejects.toThrow('No readable text')
    expect(NiceModal.show).not.toHaveBeenCalled()
    expect(mocks.cloud).not.toHaveBeenCalled()
  })
  it.each([
    ['pdf_password_protected', 'This PDF is password-protected'],
    ['local_parser_file_too_large', 'Work Mode attachments must be 10 MB or smaller.'],
  ])('surfaces %s without uploading', async (code, message) => {
    mocks.pdf.mockRejectedValue(new Error(code))
    await expect(parse('report.pdf')).rejects.toThrow(message)
    expect(NiceModal.show).not.toHaveBeenCalled()
    expect(mocks.cloud).not.toHaveBeenCalled()
  })

  it('does not upload when local parsing completes after cancellation', async () => {
    const controller = new AbortController()
    mocks.pdf.mockImplementation(async () => {
      controller.abort()
      return ''
    })
    await expect(parse('report.pdf', controller.signal)).rejects.toThrow(/stopped|aborted/)
    expect(NiceModal.show).not.toHaveBeenCalled()
    expect(mocks.cloud).not.toHaveBeenCalled()
  })
})

describe('localized mobile document errors', () => {
  beforeEach(async () => {
    const instance = createInstance()
    await instance.init({ resources: translationResources, lng: 'zh-Hans', interpolation: { escapeValue: false } })
    mocks.t.mockImplementation((key: TranslationKey, args?: Record<string, string>) => instance.t(key, args ?? {}))
  })

  it('shows the supported document formats in Chinese', async () => {
    await expect(parse('archive.zip')).rejects.toThrow('本地文档解析支持 PDF、DOCX、XLSX 和 PPTX 文件。')
    expect(NiceModal.show).not.toHaveBeenCalled()
    expect(mocks.cloud).not.toHaveBeenCalled()
  })

  it('shows the interpolated size limit in Chinese for an oversized workspace file', async () => {
    await expect(
      capacitorDocumentParser.parse(
        'input/report.pdf',
        btoa('x'.repeat(10 * 1024 * 1024 + 1)),
        new AbortController().signal
      )
    ).rejects.toThrow('工作模式附件不能超过 10 MB。')
    expect(mocks.pdf).not.toHaveBeenCalled()
    expect(NiceModal.show).not.toHaveBeenCalled()
    expect(mocks.cloud).not.toHaveBeenCalled()
  })

  it.each([
    ['pdf_password_protected', '此 PDF 已加密，无法读取其内容。请移除密码后重新上传。'],
    ['local_parser_file_too_large', '工作模式附件不能超过 10 MB。'],
  ])('translates %s into an actionable Chinese error', async (code, message) => {
    mocks.pdf.mockRejectedValue(new Error(code))
    await expect(parse('report.pdf')).rejects.toThrow(message)
    expect(NiceModal.show).not.toHaveBeenCalled()
    expect(mocks.cloud).not.toHaveBeenCalled()
  })
})
