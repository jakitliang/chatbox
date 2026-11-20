import { Accordion, ActionIcon, Box, Container, Flex, Image, Kbd, Stack, Table, Text, Title } from '@mantine/core'
import { IconChevronRight, IconFileText, IconListDetails, IconX } from '@tabler/icons-react'
import { createFileRoute, useCanGoBack, useNavigate, useRouter } from '@tanstack/react-router'
import { useCallback, useEffect, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { getConfigurationQuickReference, recentStandaloneCommits } from '@/components/about/standaloneAboutContent'
import { ScalableIcon } from '@/components/common/ScalableIcon'
import BrandGithub from '@/components/icons/BrandGithub'
import Page from '@/components/layout/Page'
import { useIsSmallScreen } from '@/hooks/useScreenChange'
import useVersion from '@/hooks/useVersion'
import platform from '@/platform'
import iconPNG from '@/static/icon.png'
import { useLanguage } from '@/stores/settingsStore'

export const Route = createFileRoute('/about')({
  component: RouteComponent,
})

function RouteComponent() {
  const { t } = useTranslation()
  const version = useVersion()
  const language = useLanguage()
  const isSmallScreen = useIsSmallScreen()
  const router = useRouter()
  const navigate = useNavigate()
  const canGoBack = useCanGoBack()
  const quickReference = getConfigurationQuickReference(language)
  const editionTitle = t('about-standalone-title')
  const displayTitle = `${editionTitle}${/\d/.test(version.version) ? ` (v${version.version})` : ''}`
  const closeAbout = useCallback(() => {
    if (canGoBack) {
      router.history.back()
    } else {
      void navigate({ to: '/', replace: true })
    }
  }, [canGoBack, navigate, router])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing || event.repeat) return
      if (event.target instanceof Element && event.target.closest('[aria-modal="true"]')) return
      event.preventDefault()
      closeAbout()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [closeAbout])

  return (
    <Page
      title={t('About')}
      right={
        <Flex gap="xs" align="center">
          {!isSmallScreen && (
            <Kbd size="xs" aria-hidden="true">
              Esc
            </Kbd>
          )}
          <ActionIcon
            variant="light"
            color="chatbox-gray"
            size={36}
            radius="lg"
            aria-label={t('Close')}
            aria-keyshortcuts="Escape"
            onClick={closeAbout}
          >
            <ScalableIcon icon={IconX} size={20} />
          </ActionIcon>
        </Flex>
      }
    >
      <Container size="md" p={0}>
        <Stack gap="xxl" px={isSmallScreen ? 'sm' : 'md'} py={isSmallScreen ? 'xl' : 'md'}>
          <Flex gap="xxl" p="md" className="rounded-lg bg-chatbox-background-secondary">
            <Image h={100} w={100} mah={'20vw'} maw={'20vw'} src={iconPNG} />
            <Stack flex={1} gap="xxs">
              <Flex justify="space-between" align="center" wrap="wrap" gap={isSmallScreen ? 'xs' : 'sm'} rowGap="xs">
                <Title order={5} lh={1.5} lineClamp={1} title={displayTitle}>
                  {displayTitle}
                </Title>
              </Flex>
              <Text>{t('about-slogan')}</Text>
              <Text c="chatbox-tertiary">{t('about-introduction')}</Text>
              <Text c="chatbox-tertiary">{t('about-standalone-edition')}</Text>
            </Stack>
          </Flex>

          <Box className="rounded-lg bg-chatbox-background-secondary">
            <RepositoryLink icon={<BrandGithub className="w-full h-full" />} title={t('Github')} />
          </Box>

          <Accordion variant="separated">
            <Accordion.Item value="changelog">
              <Accordion.Control icon={<ScalableIcon icon={IconFileText} size={20} />}>
                {t('Changelog')}
              </Accordion.Control>
              <Accordion.Panel>
                <Stack component="ol" gap="sm" m={0} ps="lg">
                  {recentStandaloneCommits.map(([hash, date, subject]) => (
                    <li key={hash}>
                      <Text size="sm" style={{ overflowWrap: 'anywhere' }}>
                        {subject}
                      </Text>
                      <Text size="xs" c="chatbox-tertiary">
                        <time dateTime={date}>{date}</time> · <code>{hash}</code>
                      </Text>
                    </li>
                  ))}
                </Stack>
              </Accordion.Panel>
            </Accordion.Item>
            <Accordion.Item value="quick-reference">
              <Accordion.Control icon={<ScalableIcon icon={IconListDetails} size={20} />}>
                {quickReference.title}
              </Accordion.Control>
              <Accordion.Panel>
                <Table.ScrollContainer minWidth={600}>
                  <Table aria-label={quickReference.title} striped highlightOnHover>
                    <Table.Thead>
                      <Table.Tr>
                        {quickReference.headers.map((header) => (
                          <Table.Th key={header} scope="col">
                            {header}
                          </Table.Th>
                        ))}
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {quickReference.rows.map(([item, ...cells]) => (
                        <Table.Tr key={item}>
                          <Table.Th scope="row">{item}</Table.Th>
                          {cells.map((cell, index) => (
                            <Table.Td key={quickReference.headers[index + 1]}>{cell}</Table.Td>
                          ))}
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                </Table.ScrollContainer>
              </Accordion.Panel>
            </Accordion.Item>
          </Accordion>
        </Stack>
      </Container>
    </Page>
  )
}

function RepositoryLink({ icon, title }: { icon: ReactElement; title: string }) {
  return (
    <Flex
      component="button"
      type="button"
      w="100%"
      px="md"
      py="sm"
      gap="xs"
      align="center"
      className="cursor-pointer rounded-lg border-0 bg-transparent text-start"
      onClick={() => platform.openLink('https://github.com/jakitliang/chatbox')}
      c="chatbox-tertiary"
    >
      <Box w={20} h={20} className="flex-shrink-0 " c="chatbox-primary">
        {icon}
      </Box>
      <Text flex={1} size="md">
        {title}
      </Text>

      <Text size="md" c="chatbox-tertiary">
        chatbox
      </Text>
      <ScalableIcon icon={IconChevronRight} size={20} className="!text-inherit" />
    </Flex>
  )
}
