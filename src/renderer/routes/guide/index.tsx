import { Button, Group, Paper, Stack, Text, Title } from '@mantine/core'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { PageHeader } from '@/components/layout/Page'
import { onboardingStore } from '@/stores/onboardingStore'

export const Route = createFileRoute('/guide/')({ component: GuidePage })

function GuidePage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const finishSetup = () => {
    onboardingStore.getState().markCompleted()
    void navigate({ to: '/' })
  }
  return (
    <Stack h="100%" gap={0} className="bg-chatbox-background-primary">
      <PageHeader title={t('Getting Started')} />
      <Stack p="lg" gap="lg" maw={720} mx="auto" w="100%" style={{ overflowY: 'auto' }}>
        <Title order={2}>{t('Configure your AI provider')}</Title>
        <Text c="chatbox-secondary">
          {t('Use your own API key or a local model. Setup is manual and does not contact a hosted guide service.')}
        </Text>
        <Paper withBorder p="lg" radius="md">
          <Stack gap="sm">
            <Text fw={600}>{t('Model Provider')}</Text>
            <Text size="sm">{t('Choose a provider and enter its API key and API host, or configure a local model server.')}</Text>
            <Button onClick={() => void navigate({ to: '/settings/provider/$providerId', params: { providerId: 'openai' } })}>
              {t('Settings')}
            </Button>
          </Stack>
        </Paper>
        <Paper withBorder p="lg" radius="md">
          <Stack gap="sm">
            <Text fw={600}>{t('Default Models')}</Text>
            <Text size="sm">{t('Select your default models after configuring a provider.')}</Text>
            <Button variant="default" onClick={() => void navigate({ to: '/settings/default-models' })}>
              {t('Default Models')}
            </Button>
          </Stack>
        </Paper>
        <Group justify="flex-end"><Button onClick={finishSetup}>{t('Start Chat')}</Button></Group>
      </Stack>
    </Stack>
  )
}