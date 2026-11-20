import { Flex, Select, Text } from '@mantine/core'
import { getWebSearchRegistration } from '@shared/services/web-search-providers'
import type { Settings } from '@shared/types'
import { IconCheck, IconX } from '@tabler/icons-react'
import { createFileRoute } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { AdaptiveSelect } from '@/components/AdaptiveSelect'
import { CheckedFieldRow } from '@/components/settings/CheckedFieldRow'
import { SettingRow, SettingsPage, SettingsSection } from '@/components/settings/SettingsLayout'
import { checkWebSearchProviderConnection } from '@/packages/web-search'
import { WEB_SEARCH_PROVIDERS, type WebSearchProviderValue } from '@/packages/web-search/constants'
import { getRendererWebSearchProvider } from '@/packages/web-search/provider'
import { useSettingsStore } from '@/stores/settingsStore'

export const Route = createFileRoute('/settings/web-search')({
  component: RouteComponent,
})

type WebSearchSettings = Settings['extension']['webSearch']

const MAX_RESULTS_OPTIONS = Array.from({ length: 10 }, (_, index) => String(index + 1))

function ProvidedTools({ settings }: { settings: WebSearchSettings }) {
  const { t } = useTranslation()
  const tools = [
    { label: t('Web Search'), supported: true },
    { label: t('Read Webpage'), supported: Boolean(getRendererWebSearchProvider(settings).parseLink) },
  ]
  return (
    <Flex gap="sm" wrap="wrap" align="center" mt={2}>
      <Text fz={12} lh="18px" c="chatbox-tertiary">
        {t('Provided tools')}
      </Text>
      {tools.map(({ label, supported }) => (
        <Flex key={label} align="center" gap={4}>
          {supported ? (
            <IconCheck size={14} className="text-chatbox-tint-success" />
          ) : (
            <IconX size={14} className="text-chatbox-tint-tertiary" />
          )}
          <Text fz={12} lh="18px" c={supported ? 'chatbox-secondary' : 'chatbox-tertiary'}>
            {label}
          </Text>
        </Flex>
      ))}
    </Flex>
  )
}

export function RouteComponent() {
  const { t } = useTranslation()
  const setSettings = useSettingsStore((state) => state.setSettings)
  const extension = useSettingsStore((state) => state.extension)
  const webSearch = extension.webSearch
  const provider = webSearch.provider

  const updateWebSearch = (patch: Partial<WebSearchSettings>) =>
    setSettings({ extension: { ...extension, webSearch: { ...webSearch, ...patch } } })

  const { credential, options, note } = getWebSearchRegistration(provider)
  const values: Record<string, unknown> = webSearch

  return (
    <SettingsPage title={t('Web Search')} description={t('The search service used when a model searches the web.')}>
      <SettingsSection title={t('Search Provider')}>
        <SettingRow
          id="search-provider"
          label={t('Search Provider')}
          description={note && t(note)}
          status={<ProvidedTools settings={webSearch} />}
          controlLayout="block"
          control={(fieldId) => (
            <AdaptiveSelect
              id={fieldId}
              comboboxProps={{ withinPortal: true, withArrow: true }}
              aria-label={t('Search Provider') ?? undefined}
              data={WEB_SEARCH_PROVIDERS}
              value={provider}
              onChange={(value) => value && updateWebSearch({ provider: value as WebSearchProviderValue })}
            />
          )}
        />
        {credential && (
          <CheckedFieldRow
            key={credential.key}
            id={`${provider}-${credential.type === 'apiKey' ? 'api-key' : 'url'}`}
            label={t(credential.label)}
            description={credential.description && t(credential.description)}
            secret={credential.type === 'apiKey'}
            value={String(values[credential.key] ?? '')}
            onChange={(value) => updateWebSearch({ [credential.key]: value })}
            placeholder={credential.placeholder ? (t(credential.placeholder) ?? undefined) : undefined}
            check={(value) => checkWebSearchProviderConnection({ ...webSearch, [credential.key]: value })}
            failureMessage={credential.type === 'apiKey' ? t('API key invalid!') : t('Connection failed!')}
            getKeyUrl={credential.getKeyUrl}
          />
        )}
      </SettingsSection>

      {options && (
        <SettingsSection title={t(options.title)}>
          <SettingRow
            id={`${provider}-max-results`}
            label={t('Max Results')}
            description={t('Maximum number of results to return.')}
            control={(fieldId) => (
              <Select
                id={fieldId}
                w={120}
                comboboxProps={{ withinPortal: true, withArrow: true }}
                aria-label={t('Max Results') ?? undefined}
                data={MAX_RESULTS_OPTIONS}
                value={String(values[options.maxResults] || 5)}
                onChange={(value) => value && updateWebSearch({ [options.maxResults]: Number.parseInt(value, 10) })}
              />
            )}
          />
          <SettingRow
            id={`${provider}-time-range`}
            label={t('Time Range')}
            description={t('Time range of the search. For example, the last month.')}
            control={(fieldId) => (
              <Select
                id={fieldId}
                w={120}
                comboboxProps={{ withinPortal: true, withArrow: true }}
                aria-label={t('Time Range') ?? undefined}
                data={[
                  { value: 'none', label: 'None' },
                  { value: 'd1', label: 'Day' },
                  { value: 'w1', label: 'Week' },
                  { value: 'm1', label: 'Month' },
                  { value: 'y1', label: 'Year' },
                ]}
                value={String(values[options.timeRange] || 'none')}
                onChange={(value) => value && updateWebSearch({ [options.timeRange]: value })}
              />
            )}
          />
        </SettingsSection>
      )}
    </SettingsPage>
  )
}
