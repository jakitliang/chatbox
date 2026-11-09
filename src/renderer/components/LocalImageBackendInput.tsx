import { Loader, TextInput } from '@mantine/core'
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { getLocalImageModels, normalizeLocalImageBackendUrl } from '@/packages/local-image-backend'
import { useLastUsedModelStore } from '@/stores/lastUsedModelStore'
import { useLocalImageBackendStore } from '@/stores/localImageBackendStore'
import { queryClient } from '@/stores/queryClient'

export type LocalImageValidationResult = { status: 'ok' | 'fail' | 'idle'; error?: string }

export interface LocalImageBackendInputHandle {
  validate(signal?: AbortSignal): Promise<LocalImageValidationResult>
  hasDraft(): boolean
}

/** A dedicated image-backend address. Only explicit validation saves it. */
export const LocalImageBackendInput = forwardRef<
  LocalImageBackendInputHandle,
  {
    disabled?: boolean
    onValidated?: () => void
    onValidationRequested?: () => void
  }
>(function LocalImageBackendInput({ disabled = false, onValidated, onValidationRequested }, ref) {
  const { t } = useTranslation()
  const picture = useLastUsedModelStore((state) => state.picture)
  const savedUrl = useLocalImageBackendStore((state) => state.url)
  const initialUrl = savedUrl
  const [value, setValue] = useState(initialUrl)
  const [error, setError] = useState('')
  const [checking, setChecking] = useState(false)
  const request = useRef<AbortController>()

  useEffect(() => {
    request.current?.abort()
    setChecking(false)
    setValue(initialUrl)
    setError('')
    return () => request.current?.abort()
  }, [initialUrl, picture?.provider, picture?.modelId])

  const validate = async (signal?: AbortSignal): Promise<LocalImageValidationResult> => {
    if (signal?.aborted) return { status: 'idle' }
    request.current?.abort()
    const controller = new AbortController()
    request.current = controller
    const abort = () => controller.abort()
    signal?.addEventListener('abort', abort, { once: true })
    setChecking(true)
    setError('')
    try {
      const normalizedUrl = normalizeLocalImageBackendUrl(value)
      const discovery = await getLocalImageModels(normalizedUrl, controller.signal)
      if (controller.signal.aborted) return { status: 'idle' }
      const store = useLocalImageBackendStore.getState()
      const defaultModelId = discovery.models.some((model) => model.id === store.defaultModelId)
        ? store.defaultModelId
        : discovery.currentModelId || discovery.models[0]?.id || ''
      queryClient.setQueryData(['local-image-models', normalizedUrl], discovery)
      store.setConfig({ url: normalizedUrl, defaultModelId })
      setValue(normalizedUrl)
      onValidated?.()
      return { status: 'ok' }
    } catch (cause) {
      if (controller.signal.aborted) return { status: 'idle' }
      setValue('')
      setError(
        `${t('Local image backend validation failed. The saved selection is unchanged.', {
          defaultValue: '绘图地址验证失败，原已保存配置保持不变。',
        })} ${cause instanceof Error ? cause.message : String(cause)}`
      )
      return { status: 'fail', error: cause instanceof Error ? cause.message : String(cause) }
    } finally {
      signal?.removeEventListener('abort', abort)
      if (!controller.signal.aborted) setChecking(false)
    }
  }

  useImperativeHandle(ref, () => ({ validate, hasDraft: () => value !== initialUrl }))

  return (
    <TextInput
      className="flex-1 min-w-0"
      label={t('Local SDAPI address', { defaultValue: '本地 SDAPI 绘图地址' })}
      value={value}
      disabled={disabled}
      error={error || undefined}
      rightSection={checking ? <Loader size="xs" /> : undefined}
      onChange={(event) => {
        request.current?.abort()
        setChecking(false)
        setError('')
        setValue(event.currentTarget.value)
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Enter') return
        event.preventDefault()
        event.stopPropagation()
        if (!event.nativeEvent.isComposing) {
          if (onValidationRequested) onValidationRequested()
          else if (!disabled) void validate()
        }
      }}
    />
  )
})