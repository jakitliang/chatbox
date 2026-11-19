import { Flex, Slider, Text } from '@mantine/core'
import { contextWindowTiers, type ContextWindowTier } from '@shared/providers/context-window-control'
import { formatNumber } from '@shared/utils'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

export interface ContextWindowSelection {
  getTarget(tier: ContextWindowTier): number | undefined
  tier?: ContextWindowTier
  onChange?(tier: ContextWindowTier): void
}

export function ContextWindowPreview({ getTarget, tier: controlledTier, onChange }: ContextWindowSelection) {
  const { t } = useTranslation()
  const [localTier, setLocalTier] = useState<ContextWindowTier>('default')
  const tier = controlledTier ?? localTier
  const labels = {
    default: t('Default'),
    quarter: '¼',
    half: '½',
    'three-quarters': '¾',
    maximum: t('Maximum'),
  }
  const marks = contextWindowTiers.map((tier, value) => ({ value, label: labels[tier] }))
  const maxTier = marks.length - 1
  const target = getTarget(tier)
  const selection = target === undefined ? marks[0].label : formatNumber(target)

  return (
    <Flex direction="column" gap={4} px="xs" pt={4} pb="xs">
      <Flex justify="space-between" align="center" gap="xs">
        <Text size="sm">{t('Context Window')}</Text>
        <Text size="xs" c="dimmed">
          {t('Requested context window')}: {selection}
        </Text>
      </Flex>
      <Slider
        mx="lg"
        mb="lg"
        size="sm"
        color="chatbox-brand"
        min={0}
        max={maxTier}
        step={1}
        marks={marks}
        styles={{ mark: { borderColor: 'var(--mantine-color-dimmed)' } }}
        restrictToMarks
        value={contextWindowTiers.indexOf(tier)}
        onChange={(value) => {
          if (controlledTier === undefined) setLocalTier(contextWindowTiers[value])
          onChange?.(contextWindowTiers[value])
        }}
        label={null}
        thumbLabel={t('Context Window') || undefined}
      />
    </Flex>
  )
}
