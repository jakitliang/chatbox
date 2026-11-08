import NiceModal from '@ebay/nice-modal-react'
import { filterCopilotsByCategory, getCopilotCategories, searchCopilots } from '@chatbox/core/application/copilots'
import { Button, Flex, Grid, Stack, Switch, Text } from '@mantine/core'
import type { CopilotDetail } from '@shared/types'
import { IconPlus } from '@tabler/icons-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useMyCopilots } from '@/hooks/useCopilots'
import { useUIStore } from '@/stores/uiStore'
import CopilotItem from './CopilotItem'

export default function LocalCopilotList({ search = '' }: { search?: string }) {
  const { t, i18n } = useTranslation()
  const store = useMyCopilots()
  const [category, setCategory] = useState<string | undefined>()
  const [pinnedOnly, setPinnedOnly] = useState(true)
  const [pagination, setPagination] = useState({ key: '', count: 12 })
  const categories = getCopilotCategories(store.copilots)
  const filtered = searchCopilots(filterCopilotsByCategory(store.copilots, category), search)
    .filter((copilot) => !pinnedOnly || copilot.starred)
  const filterKey = JSON.stringify([search, category ?? null, pinnedOnly])
  const visibleCount = pagination.key === filterKey ? pagination.count : 12
  const showInNewSession = useUIStore((state) => state.showCopilotsInNewSession)
  const setShowInNewSession = useUIStore((state) => state.setShowCopilotsInNewSession)
  const choices = [
    { value: undefined, label: t('All') },
    ...categories.map((value) => ({ value, label: value })),
    { value: '', label: t('Uncategorized', { defaultValue: i18n.language.startsWith('zh') ? '未分类' : 'Uncategorized' }) },
  ]

  return (
    <Stack px="sm" py="xl" gap="lg" className="max-w-7xl">
      <Flex justify="space-between" align="center" gap="sm" wrap="wrap">
        <Button
          variant="outline"
          size="xs"
          leftSection={<IconPlus size={16} />}
          onClick={() => void NiceModal.show('copilot-settings', {
            copilot: null,
            mode: 'create',
            onSave: (copilot: CopilotDetail) => store.addOrUpdate(copilot),
          })}
        >
          {t('Create')}
        </Button>
        <Switch
          checked={showInNewSession}
          onChange={(event) => setShowInNewSession(event.currentTarget.checked)}
          label={t('Show My Copilots in New Conversations')}
          size="sm"
        />
      </Flex>
      <Flex gap="xs" wrap="wrap" role="group" aria-label={t('Category', { defaultValue: i18n.language.startsWith('zh') ? '分类' : 'Category' }) || undefined}>
        <Button size="compact-xs" variant={pinnedOnly ? 'filled' : 'light'} aria-pressed={pinnedOnly}
          onClick={() => { setPinnedOnly(true); setCategory(undefined); setPagination({ key: '', count: 12 }) }}>
          {t('Pinned')}
        </Button>
        {choices.map((choice) => (
          <Button
            key={choice.value === undefined ? 'all' : `category:${choice.value}`}
            size="compact-xs"
            variant={!pinnedOnly && category === choice.value ? 'filled' : 'light'}
            aria-pressed={!pinnedOnly && category === choice.value}
            onClick={() => { setPinnedOnly(false); setCategory(choice.value); setPagination({ key: '', count: 12 }) }}
          >
            {choice.label}
          </Button>
        ))}
      </Flex>
      {store.error ? (
        <Stack align="center">
          <Text c="red" role="alert">{store.error.message}</Text>
          <Button variant="outline" onClick={() => void store.reload().catch(() => undefined)}>{t('Retry')}</Button>
        </Stack>
      ) : store.isLoading ? (
        <Text c="dimmed" ta="center">{t('Loading...')}</Text>
      ) : filtered.length === 0 ? (
        <Stack align="center" justify="center" gap="sm" py={48} px="md" mih={300} role="status">
          <svg width="160" height="136" viewBox="0 0 160 136" aria-hidden="true" className="text-chatbox-tint-primary">
            <ellipse cx="80" cy="122" rx="46" ry="7" fill="currentColor" opacity="0.08" />
            <circle cx="80" cy="67" r="54" fill="currentColor" opacity="0.06" />
            <path d="M45 58 L37 28 Q36 19 44 23 L65 39 M95 39 L116 23 Q124 19 123 28 L115 58" fill="var(--chatbox-background-primary)" stroke="currentColor" strokeWidth="3" strokeLinejoin="round" />
            <rect x="38" y="40" width="84" height="73" rx="30" fill="var(--chatbox-background-primary)" stroke="currentColor" strokeWidth="3" />
            <ellipse cx="57" cy="82" rx="8" ry="5" fill="currentColor" opacity="0.14" />
            <ellipse cx="103" cy="82" rx="8" ry="5" fill="currentColor" opacity="0.14" />
            <path d="M58 69 Q63 64 68 69 M92 69 Q97 64 102 69 M74 81 Q80 88 86 81" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
            <path d="M23 57 V67 M18 62 H28 M135 82 V92 M130 87 H140" stroke="currentColor" strokeWidth="2" opacity="0.4" strokeLinecap="round" />
            <circle cx="131" cy="37" r="3" fill="currentColor" opacity="0.3" />
          </svg>
          <Text fw={600} fz={14} ta="center">{t('No results found')}</Text>
          <Text c="chatbox-tertiary" fz={13} lh="20px" ta="center" maw={360}>
            {store.copilots.length === 0
              ? t('No copilots yet. Create your first one!')
              : search ? t('No copilots matched your search.') : pinnedOnly ? t('Pinned') : category || t('Uncategorized')}
          </Text>
          {pinnedOnly && store.copilots.length > 0 && (
            <Button variant="subtle" size="sm" onClick={() => { setPinnedOnly(false); setCategory(undefined); setPagination({ key: '', count: 12 }) }}>
              {t('All')}
            </Button>
          )}
        </Stack>
      ) : (
        <Grid gutter="xs">
          {filtered.slice(0, visibleCount).map((copilot) => (
            <Grid.Col span={{ base: 12, md: 6, lg: 4, xl: 3 }} key={copilot.id}>
              <CopilotItem copilot={copilot} highlightTerm={search} />
            </Grid.Col>
          ))}
        </Grid>
      )}
      {!store.isLoading && !store.error && filtered.length > visibleCount && (
        <Flex justify="center">
          <Button variant="default" size="sm" onClick={() => setPagination({ key: filterKey, count: visibleCount + 12 })}>
            {t('Load More')}
          </Button>
        </Flex>
      )}
    </Stack>
  )
}