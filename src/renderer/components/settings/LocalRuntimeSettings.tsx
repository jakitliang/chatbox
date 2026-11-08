import { Button, Select, Stack, Text, Textarea, TextInput } from '@mantine/core'
import { isForbiddenHost, normalizeAppApiServer } from '@shared/privacy/local-runtime'
import { SettingsSchema } from '@shared/types'
import { useState } from 'react'
import { useSettingsStore } from '@/stores/settingsStore'

/** Application backend selection and model/network permissions are independent settings. */
export function LocalRuntimeSettings() {
  const runtime = useSettingsStore((state) => state.localRuntime)
  const setSettings = useSettingsStore((state) => state.setSettings)
  const language = useSettingsStore((state) => state.language)
  const zh = language.startsWith('zh')
  const [backendMode, setBackendMode] = useState(runtime?.appApiServer ? 'server' : 'local')
  const [appApiServer, setAppApiServer] = useState(runtime?.appApiServer ?? '')
  const [origins, setOrigins] = useState(() => (runtime?.allowedOrigins ?? []).join('\n'))
  const [config, setConfig] = useState(() => JSON.stringify(runtime?.remoteConfig ?? {}, null, 2))
  const [status, setStatus] = useState<{ error: boolean; message: string } | null>(null)

  const save = () => {
    try {
      if (config.length > 64 * 1024) throw new Error(zh ? '本地配置不能超过 64 KiB。' : 'Local config must be under 64 KiB.')
      const allowedOrigins = origins.split('\n').map((entry) => entry.trim()).filter(Boolean).map((entry) => {
        const url = new URL(entry)
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
          url.pathname !== '/' || url.search || url.hash || isForbiddenHost(url.hostname)) {
          throw new Error(zh ? '仅允许完整的 HTTP(S) 端点源，不接受路径、密钥或官方/遥测域名。' : 'Use HTTP(S) origins only, without paths, credentials, or vendor/telemetry domains.')
        }
        return url.origin
      })
      const parsed = SettingsSchema.shape.localRuntime.safeParse({
        appApiServer: backendMode === 'server' ? normalizeAppApiServer(appApiServer) : undefined,
        allowedOrigins: [...new Set(allowedOrigins)], remoteConfig: JSON.parse(config),
      })
      if (!parsed.success || !parsed.data) throw new Error(zh ? '本地配置格式无效。' : 'Invalid local configuration.')
      setSettings({ localRuntime: parsed.data })
      setStatus({ error: false, message: zh ? '已保存。本地配置立即生效。' : 'Saved. Local configuration is now active.' })
    } catch (error) {
      setStatus({ error: true, message: error instanceof Error ? error.message : 'Invalid local configuration' })
    }
  }

  return (
    <Stack gap="sm" p="sm">
      <Text fw={600}>{zh ? '本地网络与数据' : 'Local network & data'}</Text>
      <Text size="sm" c="chatbox-secondary">
        {zh
          ? '默认仅允许本机回环地址。官方 API、遥测、广告通知和自动更新已永久禁用。放行远程端点后，相关请求会发送给该端点，不再是完全离线。'
          : 'Only loopback addresses are allowed by default. Vendor APIs, telemetry, promotions and updates are disabled. Allowing a remote origin sends requests to that endpoint and is no longer fully offline.'}
      </Text>
      <Select
        label={zh ? 'UI 本体的 API Server（不是 AI 模型 API）' : 'Application API Server (not the AI model API)'}
        data={[
          { value: 'local', label: zh ? '进程内本地后端（默认，无网络请求）' : 'In-process local backend (default, no network)' },
          { value: 'server', label: zh ? '自建 API Server' : 'Self-hosted API Server' },
        ]}
        value={backendMode}
        onChange={(value) => { if (value) setBackendMode(value); setStatus(null) }}
        allowDeselect={false}
      />
      {backendMode === 'server' && (
        <TextInput
          label={zh ? '应用后端地址' : 'Application backend address'}
          placeholder="http://127.0.0.1:3002"
          description={zh
            ? '填写协议、主机和端口，不带 /api 或 /v1。保存即授权此来源；服务需要兼容应用接口，不会自动启动。模型 API 仍在模型提供商中配置。'
            : 'Use protocol, host and port without /api or /v1. Saving authorizes this origin; the server must implement the application API and is not started automatically. Model APIs remain in Provider settings.'}
          value={appApiServer}
          onChange={(event) => { setAppApiServer(event.currentTarget.value); setStatus(null) }}
        />
      )}
      <Text size="xs" c="chatbox-secondary">
        {zh
          ? '切换只影响后续应用 API 请求，不迁移账号或自动探测服务器。保存后重新启动界面可清除旧页面缓存；遥测、商业模型和自动更新仍禁用。'
          : 'Switching affects subsequent application API requests, without account migration or server probing. Restart the UI after saving to clear old page caches. Telemetry, commercial models and automatic updates remain disabled.'}
      </Text>
      <Textarea
        label={zh ? '明确放行的其他端点源（模型 API 等，每行一个）' : 'Other explicitly allowed origins (model APIs, one per line)'}
        placeholder="https://api.example.com"
        value={origins}
        onChange={(event) => { setOrigins(event.currentTarget.value); setStatus(null) }}
        autosize minRows={2} maxRows={8}
      />
      <Textarea
        label={zh ? '替代官方远程配置的本地 JSON' : 'Local JSON replacing vendor remote configuration'}
        description={zh ? '支持 current_version、product_ids、knowledge_base_models；不会抓取官方数据或模拟付费授权。' : 'Supports current_version, product_ids and knowledge_base_models; never fetches vendor data or simulates paid access.'}
        value={config}
        disabled={backendMode === 'server'}
        onChange={(event) => { setConfig(event.currentTarget.value); setStatus(null) }}
        autosize minRows={3} maxRows={12}
      />
      <Button variant="default" onClick={save} className="self-start">{zh ? '保存本地策略' : 'Save local policy'}</Button>
      {status && <Text role="status" size="sm" c={status.error ? 'chatbox-error' : 'chatbox-success'}>{status.message}</Text>}
    </Stack>
  )
}