import {
  collectToolCallSummaries,
  type ExportableThread,
  type SessionChatExport,
  getAttachmentNames,
  stringifyDataForExport,
  type ToolCallSummary,
} from '@chatbox/core/utils/chat-export'
import { MantineProvider } from '@mantine/core'
import type { Message } from '@shared/types'
import { escape as escapeHtml } from 'lodash'
import ReactDOMServer from 'react-dom/server'
import { currentBlobStorage } from '@/adapters/CurrentBlobStorage'
import Markdown, { BlockCodeCollapsedStateProvider } from '@/components/Markdown'
import * as base64 from '@/packages/base64'

// Plain-text Markdown / TXT exporters are shared with the native mobile shell.
export { formatChatAsMarkdown, formatChatAsTxt } from '@chatbox/core/utils/chat-export'

function renderToolCallHtml(summary: ToolCallSummary): string {
  let html = '<div class="mt-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">\n'
  html += `<p class="font-semibold text-sm">${escapeHtml(summary.toolName)} <span class="text-xs text-slate-500">(state: ${escapeHtml(summary.state)})</span></p>\n`
  const argsText = stringifyDataForExport(summary.args)
  if (argsText) {
    html += '<p class="text-xs text-slate-500 mt-1 mb-1">Args</p>\n'
    html += `<pre class="bg-white border border-slate-200 rounded p-2 text-xs whitespace-pre-wrap overflow-x-auto">${escapeHtml(argsText)}</pre>\n`
  }
  const resultText = stringifyDataForExport(summary.result)
  if (resultText) {
    html += '<p class="text-xs text-slate-500 mt-2 mb-1">Result</p>\n'
    html += `<pre class="bg-white border border-slate-200 rounded p-2 text-xs whitespace-pre-wrap overflow-x-auto">${escapeHtml(resultText)}</pre>\n`
  }
  html += '</div>\n'
  return html
}

async function renderMessageHtml(message: Message): Promise<string> {
  const attachments = getAttachmentNames(message)
  const toolCallSummaries = collectToolCallSummaries(message)
  const renderedToolCalls = new Set<string>()
  let content = '<div class="chatbox-export-message mb-4">\n'
  if (message.role !== 'assistant') {
    content += `<p class="text-green-500 text-lg"><b>${message.role.toUpperCase()}: </b></p>\n`
  } else {
    content += `<p class="text-blue-500 text-lg"><b>${message.role.toUpperCase()}: </b></p>\n`
  }
  for (const part of message.contentParts) {
    if (part.type === 'tool-call') {
      if (renderedToolCalls.has(part.toolCallId)) {
        continue
      }
      const summary = toolCallSummaries.get(part.toolCallId)
      if (!summary) {
        continue
      }
      content += renderToolCallHtml(summary)
      renderedToolCalls.add(part.toolCallId)
      continue
    }
    if (part.type === 'text') {
      content += ReactDOMServer.renderToStaticMarkup(
        <MantineProvider>
          <BlockCodeCollapsedStateProvider defaultCollapsed={false}>
            {/* 导出页面没有 theme，代码块应该总是使用 dark 否则 color scheme 看不清 */}
            <Markdown hiddenCodeActions forceColorScheme="dark">
              {part.text}
            </Markdown>
          </BlockCodeCollapsedStateProvider>
        </MantineProvider>
      )
    } else if (part.type === 'image' && part.storageKey) {
      let url = ''
      const b64 = await currentBlobStorage.get(part.storageKey)
      if (b64) {
        let { type, data } = base64.parseImage(b64)
        if (type === '') {
          type = 'image/png'
          data = b64
        }
        url = `data:${type};base64,${data}`
      } else if ('url' in part) {
        url = part.url as string
      }
      content += `<img src="${escapeHtml(url)}" class="my-2" />\n`
    }
  }
  if (attachments.length > 0) {
    content += '<div class="mt-2">\n'
    content += '<p class="font-semibold text-sm mb-1">Attachments:</p>\n'
    content += '<ul class="list-disc pl-6 text-sm text-slate-600">\n'
    for (const name of attachments) {
      content += `<li>${escapeHtml(name)}</li>\n`
    }
    content += '</ul>\n'
    content += '</div>\n'
  }
  content += '</div>\n'
  return content
}

function renderHtmlDocument(sessionName: string, content: string, interactiveScript = ''): string {
  const escapedSessionName = escapeHtml(sessionName)
  return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>${escapedSessionName}</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
      * { box-sizing: border-box; }
      body { margin: 0; background: #f1f5f9; color: #1e293b; font: 16px/1.65 system-ui, sans-serif; }
      .prose { max-width: 64rem; margin: 0 auto; padding: 1.5rem 2rem; background: white; overflow-wrap: anywhere; box-shadow: 0 1px 6px #0001; }
      h1, h2, h3, h4 { line-height: 1.3; margin: 1.5em 0 0.75em; color: #0f172a; }
      h1 { font-size: 2rem; } h2 { font-size: 1.5rem; } h3 { font-size: 1.25rem; }
      p { margin: 0.75em 0; } a { color: #0369a1; text-decoration: underline; }
      hr { border: 0; border-top: 1px solid #e2e8f0; margin: 1.5rem 0; }
      img, svg { max-width: 100%; height: auto; } img { display: block; }
      ul, ol { padding-left: 1.5rem; } li { margin: 0.25em 0; }
      blockquote { margin: 1rem 0; padding: 0.25rem 1rem; border-left: 4px solid #cbd5e1; color: #475569; }
      table { display: block; overflow-x: auto; border-collapse: collapse; max-width: 100%; }
      th, td { padding: 0.5rem 0.75rem; border: 1px solid #cbd5e1; text-align: left; } th { background: #f8fafc; }
      pre, code { font-family: ui-monospace, monospace; font-size: 0.875em; }
      code { background: #f1f5f9; padding: 0.15em 0.3em; border-radius: 0.25rem; }
      pre { overflow-x: auto; padding: 1rem; border-radius: 0.5rem; background: #0f172a; color: #e2e8f0; white-space: pre; }
      pre code { padding: 0; background: transparent; color: inherit; }
      .code-block-container { margin: 1rem 0; border-radius: 0.5rem; overflow: hidden; background: #0f172a; color: #e2e8f0; }
      .code-block-header { display: flex; justify-content: space-between; padding: 0.5rem 1rem; color: #cbd5e1; }
      .code-block-header > div { display: flex; align-items: center; gap: 0.5rem; }
      .code-block-header svg { width: 14px; height: 14px; }
      .code-block-container pre { margin: 0; border-radius: 0; }
      .shiki-code-wrapper { max-width: 100%; overflow-x: auto; }
      .inline-code { background: #f1f5f9; color: #334155; }
      .chatbox-export-message { margin-bottom: 1.5rem; }
      .text-green-500 { color: #15803d; } .text-blue-500 { color: #1d4ed8; }
      .text-lg { font-size: 1.125rem; } .text-sm, .prose-sm { font-size: 0.875rem; } .text-xs { font-size: 0.75rem; }
      .font-semibold { font-weight: 600; } .text-slate-500 { color: #64748b; } .text-slate-600 { color: #475569; }
      .mt-1 { margin-top: 0.25rem; } .mt-2 { margin-top: 0.5rem; } .mb-1 { margin-bottom: 0.25rem; }
      .my-2 { margin-top: 0.5rem; margin-bottom: 0.5rem; } .mb-4 { margin-bottom: 1rem; }
      .rounded, .rounded-lg { border-radius: 0.5rem; } .border { border: 1px solid #e2e8f0; }
      .bg-white { background: white; } .bg-slate-50 { background: #f8fafc; }
      .p-2 { padding: 0.5rem; } .p-3 { padding: 0.75rem; } .pl-6 { padding-left: 1.5rem; }
      .whitespace-pre-wrap { white-space: pre-wrap; } .overflow-x-auto { overflow-x: auto; }
      /* KaTeX includes accessible MathML. Use native math rendering without CDN fonts/CSS. */
      .katex-html { display: none; }
      .katex-mathml { position: static !important; clip: auto !important; width: auto !important; height: auto !important; overflow: visible !important; }
      .katex-display { display: block; text-align: center; margin: 1rem 0; overflow-x: auto; }
      @media (max-width: 640px) { .prose { padding: 1rem; } h1 { font-size: 1.5rem; } }
      @media print { body { background: white; } .prose { max-width: none; box-shadow: none; padding: 0; } }
      .chatbox-fork-navigation { display: flex; justify-content: flex-end; align-items: center; gap: 0.5rem; margin: -0.5rem 1rem 0.75rem; color: #868e96; }
      .chatbox-fork-navigation button { appearance: none; border: 0; border-radius: 9999px; background: transparent; color: inherit; cursor: pointer; font-size: 1.25rem; line-height: 1; padding: 0.25rem 0.5rem; }
      .chatbox-fork-navigation button:hover { background: #f1f3f5; color: #495057; }
      .chatbox-fork-position { min-width: 3.5rem; text-align: center; font-size: 0.75rem; }
    </style>
</head>
<body class='bg-slate-100'>
    <div class='mx-auto max-w-5xl shadow-md prose bg-white px-2 py-4'>
        <h1>${escapedSessionName}</h1>
        <hr />
        ${content}
        <hr />
    </div>
    ${interactiveScript}
</body>
</html>
`
}

export async function formatChatAsHtml(
  sessionName: string,
  threads: AsyncIterable<ExportableThread> | Iterable<ExportableThread>
) {
  let content = '<div class="prose-sm">\n'
  let i = 0
  for await (const thread of threads) {
    i++
    content += `<h2>${i}. ${escapeHtml(thread.name)}</h2>\n`
    for await (const msg of thread.messages) {
      content += await renderMessageHtml(msg)
    }
    content += '<hr />\n'
  }
  content += '</div>\n'
  return renderHtmlDocument(sessionName, content)
}

function serializeHtmlJson(value: unknown): string {
  return JSON.stringify(value)
    .replaceAll('<', '\\u003c')
    .replaceAll('>', '\\u003e')
    .replaceAll('&', '\\u0026')
    .replaceAll('\u2028', '\\u2028')
    .replaceAll('\u2029', '\\u2029')
}

const interactiveHtmlController = `
<script>
(() => {
  const dataElement = document.getElementById('chatbox-export-data')
  const root = document.getElementById('chatbox-export-root')
  if (!dataElement || !root) return

  const data = JSON.parse(dataElement.textContent || '{}')
  const messages = new Map(data.messages.map((message) => [message.id, message]))
  const forks = new Map(data.forks.map((fork) => [fork.id, fork]))
  const threads = data.threads

  const forkTailStartIndex = (messageIds, forkMessageIndex) => {
    let index = forkMessageIndex + 1
    while (index < messageIds.length && messages.get(messageIds[index])?.isSummary) index += 1
    return index
  }

  const renderThread = (threadIndex) => {
    const thread = threads[threadIndex]
    const section = document.createElement('section')
    section.dataset.threadIndex = String(threadIndex)

    const title = document.createElement('h2')
    title.textContent = String(threadIndex + 1) + '. ' + thread.name
    section.appendChild(title)

    for (const messageId of thread.messages) {
      const message = messages.get(messageId)
      if (!message) continue

      const wrapper = document.createElement('div')
      wrapper.dataset.messageId = messageId
      wrapper.innerHTML = message.html
      section.appendChild(wrapper)

      const fork = forks.get(messageId)
      if (!fork || fork.lists.length <= 1) continue

      const navigation = document.createElement('div')
      navigation.className = 'chatbox-fork-navigation'
      navigation.dataset.forkId = messageId

      const previous = document.createElement('button')
      previous.type = 'button'
      previous.textContent = '‹'
      previous.setAttribute('aria-label', 'Previous reply')
      previous.dataset.forkAction = 'prev'
      previous.dataset.threadIndex = String(threadIndex)
      previous.dataset.forkId = messageId

      const position = document.createElement('span')
      position.className = 'chatbox-fork-position'
      position.textContent = String(fork.position + 1) + ' / ' + String(fork.lists.length)

      const next = document.createElement('button')
      next.type = 'button'
      next.textContent = '›'
      next.setAttribute('aria-label', 'Next reply')
      next.dataset.forkAction = 'next'
      next.dataset.threadIndex = String(threadIndex)
      next.dataset.forkId = messageId

      navigation.append(previous, position, next)
      section.appendChild(navigation)
    }

    section.appendChild(document.createElement('hr'))
    const previousSection = root.querySelector('section[data-thread-index="' + String(threadIndex) + '"]')
    if (previousSection) previousSection.replaceWith(section)
    else root.appendChild(section)
  }

  const switchFork = (threadIndex, forkMessageId, direction) => {
    const fork = forks.get(forkMessageId)
    const thread = threads[threadIndex]
    if (!fork || !thread || fork.lists.length <= 1) return

    const forkMessageIndex = thread.messages.indexOf(forkMessageId)
    if (forkMessageIndex < 0) return

    const tailStart = forkTailStartIndex(thread.messages, forkMessageIndex)
    const currentTail = thread.messages.slice(tailStart)
    const currentPosition = fork.position
    const isCurrentBranchEmpty = currentTail.length === 0
    let updatedLists = fork.lists
    let adjustedCurrentPosition = currentPosition

    if (isCurrentBranchEmpty) {
      updatedLists = fork.lists.filter((_, index) => index !== currentPosition)
      if (updatedLists.length <= 1) {
        thread.messages = thread.messages.slice(0, tailStart).concat(updatedLists[0]?.messages || [])
        forks.delete(forkMessageId)
        renderThread(threadIndex)
        return
      }
      adjustedCurrentPosition = currentPosition >= updatedLists.length ? updatedLists.length - 1 : currentPosition
    }

    const total = updatedLists.length
    const newPosition = direction === 'next'
      ? (adjustedCurrentPosition + 1) % total
      : (adjustedCurrentPosition - 1 + total) % total
    const branchMessages = updatedLists[newPosition]?.messages || []

    fork.lists = updatedLists.map((list, index) => {
      if (!isCurrentBranchEmpty && index === adjustedCurrentPosition && adjustedCurrentPosition !== newPosition) {
        return { ...list, messages: currentTail }
      }
      if (index === newPosition) return { ...list, messages: [] }
      return list
    })
    fork.position = newPosition
    thread.messages = thread.messages.slice(0, tailStart).concat(branchMessages)
    renderThread(threadIndex)
  }

  root.addEventListener('click', (event) => {
    const button = event.target instanceof Element ? event.target.closest('button[data-fork-action]') : null
    if (!button) return
    const threadIndex = Number(button.dataset.threadIndex)
    const forkMessageId = button.dataset.forkId
    const direction = button.dataset.forkAction
    if (!forkMessageId || (direction !== 'next' && direction !== 'prev')) return
    switchFork(threadIndex, forkMessageId, direction)
  })

  threads.forEach((_, index) => renderThread(index))
})()
</script>`

/** Each body is rendered once into the exported document, then released. */
export async function formatChatAsInteractiveHtml(
  source: SessionChatExport,
  includeArchived: boolean
): Promise<string> {
  let messages = ''
  let forks = ''
  let threads = ''
  for await (const thread of source.threads(includeArchived)) {
    let selectedIds = ''
    for await (const row of source.path(thread))
      selectedIds += (selectedIds ? ',' : '') + serializeHtmlJson(row.messageId)
    threads +=
      (threads ? ',' : '') + `{"name":${serializeHtmlJson(source.threadName(thread))},"messages":[${selectedIds}]}`
    for await (const row of source.allRows(thread)) {
      const message = await source.message(row.messageId)
      messages +=
        (messages ? ',' : '') +
        serializeHtmlJson({
          id: message.id,
          html: await renderMessageHtml(message),
          isSummary: Boolean(message.isSummary),
        })
      const fork = await source.fork(row)
      if (!fork) continue
      let lists = ''
      for await (const branch of fork.branches) {
        let ids = ''
        if (!branch.selected)
          for await (const child of source.path(thread, branch.firstMessageId))
            ids += (ids ? ',' : '') + serializeHtmlJson(child.messageId)
        lists += (lists ? ',' : '') + `{"id":${serializeHtmlJson(branch.branchId)},"messages":[${ids}]}`
      }
      forks +=
        (forks ? ',' : '') + `{"id":${serializeHtmlJson(fork.pivotId)},"position":${fork.position},"lists":[${lists}]}`
    }
  }
  await source.assertCurrent()
  const data = `{"messages":[${messages}],"forks":[${forks}],"threads":[${threads}]}`
  const dataScript = `<div id="chatbox-export-root" class="prose-sm"></div>\n<script id="chatbox-export-data" type="application/json">${data}</script>`
  return renderHtmlDocument(source.header.name, dataScript, interactiveHtmlController)
}
