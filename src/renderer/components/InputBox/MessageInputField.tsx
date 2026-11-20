import { Textarea } from '@mantine/core'
import { TestId } from '@shared/automation/testids'
import type React from 'react'
import { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react'
import { useMessageInput } from '@/hooks/useMessageInput'
import type { DictationUpdate } from '@/packages/local-speech/contracts'
import { appendDictation } from '@/packages/local-speech/dictation'
import * as dom from '../../hooks/dom'

function isNativeComposing(nativeEvent: Event): boolean {
  return 'isComposing' in nativeEvent && nativeEvent.isComposing === true
}

export type MessageInputFieldRef = {
  getCommittedValue: () => string
  commitDictation: (text: string, signal: AbortSignal) => Promise<void>
  setValue: (val: string | ((prev: string) => string)) => void
  clearDraft: () => void
  getElement: () => HTMLTextAreaElement | null
}

type MessageInputFieldProps = {
  isNewSession: boolean
  viewportHeight: number
  isReadOnly: boolean
  placeholder: string
  ariaLabel: string
  autoFocus: boolean
  dictationPreview?: DictationUpdate
  /** Called on every committed value change (including programmatic setValue). */
  onValueChange: (value: string) => void
  /** Called only on real user typing (onChange), not programmatic setValue. */
  onUserInput?: () => void
  onKeyDown: (event: React.KeyboardEvent<HTMLTextAreaElement>) => void
  onPaste: (event: React.ClipboardEvent<HTMLTextAreaElement>) => void
}

export const MessageInputField = memo(
  forwardRef<MessageInputFieldRef, MessageInputFieldProps>(
    (
      {
        isNewSession,
        viewportHeight,
        isReadOnly,
        placeholder,
        ariaLabel,
        autoFocus,
        dictationPreview,
        onValueChange,
        onUserInput,
        onKeyDown,
        onPaste,
      },
      ref
    ) => {
      const { messageInput, setMessageInput, getMessageInput, clearDraft } = useMessageInput('', { isNewSession })
      const inputRef = useRef<HTMLTextAreaElement | null>(null)
      const [editValue, setEditValue] = useState(messageInput)
      const isComposingRef = useRef(false)
      const compositionRangeRef = useRef<{ start: number; end: number } | null>(null)
      const skipCompositionEndCommitRef = useRef(false)
      const deferredDictation = useRef<(() => void) | null>(null)
      const previewRef = useRef<HTMLDivElement>(null)

      useEffect(() => {
        setEditValue(messageInput)
      }, [messageInput])

      useEffect(() => {
        onValueChange(messageInput)
      }, [messageInput, onValueChange])

      const confirmed = dictationPreview?.confirmed
      const interim = dictationPreview?.interim
      useLayoutEffect(() => {
        if (confirmed || interim) {
          const preview = previewRef.current
          if (preview) preview.scrollTop = preview.scrollHeight
        }
      }, [confirmed, interim])

      const flushDictation = useCallback(() => {
        queueMicrotask(() => {
          if (!isComposingRef.current) deferredDictation.current?.()
        })
      }, [])

      useImperativeHandle(
        ref,
        () => ({
          getCommittedValue: getMessageInput,
          commitDictation: (text, signal) =>
            new Promise<void>((resolve) => {
              const finish = () => {
                if (deferredDictation.current === finish) deferredDictation.current = null
                signal.removeEventListener('abort', finish)
                if (!signal.aborted) {
                  setMessageInput((draft) => appendDictation(draft, text))
                  onUserInput?.()
                }
                resolve()
              }
              // Keep recognized text outside the editable value until the IME has committed its candidate.
              if (!signal.aborted && isComposingRef.current) {
                deferredDictation.current = finish
                signal.addEventListener('abort', finish, { once: true })
              } else {
                finish()
              }
            }),
          setValue: (val) => setMessageInput(val),
          clearDraft: () => clearDraft(),
          getElement: () => inputRef.current,
        }),
        [setMessageInput, getMessageInput, clearDraft, onUserInput]
      )

      const commitValue = useCallback(
        (value: string) => {
          setEditValue(value)
          setMessageInput(value)
          onUserInput?.()
        },
        [setMessageInput, onUserInput]
      )

      const onChange = useCallback(
        (event: React.ChangeEvent<HTMLTextAreaElement>) => {
          const next = event.target.value
          const composing = isNativeComposing(event.nativeEvent)
          if (composing) {
            isComposingRef.current = true
          } else {
            isComposingRef.current = false
          }
          // Keep the controlled display in sync during IME so React does not restore the pre-composition value.
          setEditValue(next)
          if (composing) {
            return
          }
          setMessageInput(next)
          onUserInput?.()
          flushDictation()
        },
        [setMessageInput, onUserInput, flushDictation]
      )

      const onCompositionStart = useCallback((event: React.CompositionEvent<HTMLTextAreaElement>) => {
        isComposingRef.current = true
        skipCompositionEndCommitRef.current = false
        compositionRangeRef.current = {
          start: event.currentTarget.selectionStart,
          end: event.currentTarget.selectionEnd,
        }
      }, [])

      const onCompositionEnd = useCallback(
        (event: React.CompositionEvent<HTMLTextAreaElement>) => {
          isComposingRef.current = false
          compositionRangeRef.current = null
          if (skipCompositionEndCommitRef.current) {
            skipCompositionEndCommitRef.current = false
          } else {
            commitValue(event.currentTarget.value)
          }
          flushDictation()
        },
        [commitValue, flushDictation]
      )

      const handleKeyDown = useCallback(
        (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
          // IME owns candidate navigation, confirmation and cancellation.
          if (isComposingRef.current || event.nativeEvent.isComposing || event.keyCode === 229) {
            event.stopPropagation()
            return
          }
          onKeyDown(event)
        },
        [onKeyDown]
      )

      const handlePaste = useCallback(
        (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
          if (isComposingRef.current) {
            isComposingRef.current = false
            skipCompositionEndCommitRef.current = true
            const pasted = event.clipboardData?.getData('text/plain') ?? ''
            if (pasted) {
              event.preventDefault()
              const committed = getMessageInput()
              const range = compositionRangeRef.current ?? { start: committed.length, end: committed.length }
              compositionRangeRef.current = null
              const next = committed.slice(0, range.start) + pasted + committed.slice(range.end)
              const cursor = range.start + pasted.length
              event.currentTarget.value = next
              event.currentTarget.setSelectionRange(cursor, cursor)
              commitValue(next)
            } else {
              setEditValue(getMessageInput())
              compositionRangeRef.current = null
            }
            flushDictation()
          }
          onPaste(event)
        },
        [commitValue, flushDictation, getMessageInput, onPaste]
      )

      return (
        <div className="min-w-0 flex-1">
          <Textarea
            unstyled={true}
            styles={{ input: { fontSize: 14 } }}
            classNames={{
              root: 'flex-1',
              wrapper: 'flex-1',
              input:
                'block w-full outline-none border-none px-2 py-1 resize-none bg-transparent text-chatbox-tint-primary leading-5',
            }}
            size="sm"
            id={dom.messageInputID}
            ref={inputRef}
            placeholder={placeholder}
            aria-label={ariaLabel}
            bg="transparent"
            autosize={true}
            minRows={1}
            // Grows with the draft up to 12 lines (240px), fewer on short viewports.
            maxRows={Math.min(12, Math.max(4, Math.floor(viewportHeight / 60)))}
            value={editValue}
            autoFocus={autoFocus}
            readOnly={isReadOnly}
            onChange={onChange}
            onCompositionStart={onCompositionStart}
            onCompositionEnd={onCompositionEnd}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            data-testid={TestId.chat.messageInput}
          />
          {(confirmed || interim) && (
            <div
              ref={previewRef}
              className="px-2 py-1 text-sm leading-5 whitespace-pre-wrap break-words max-h-24 overflow-y-auto"
            >
              <span className="text-chatbox-tint-primary" aria-live="polite">
                {confirmed}
              </span>
              {confirmed && interim ? ' ' : ''}
              <span className="text-chatbox-tint-tertiary">{interim}</span>
            </div>
          )}
        </div>
      )
    }
  )
)
