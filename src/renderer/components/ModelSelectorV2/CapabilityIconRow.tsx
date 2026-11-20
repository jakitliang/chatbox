import { Flex } from '@mantine/core'
import { getModelCapabilityIds } from '@shared/providers/model-config'
import type { ProviderModelInfo } from '@shared/types'
import clsx from 'clsx'
import { useTranslation } from 'react-i18next'
import { ScalableIcon } from '../common/ScalableIcon'
import { modelCapabilityIcons, modelSelectorCapabilityOrder } from '../model-capability-icons'

export function CapabilityIconRow({
  capabilities,
  audio,
  compact,
}: {
  capabilities?: ProviderModelInfo['capabilities']
  audio?: ProviderModelInfo['audio']
  compact?: boolean
}) {
  const { t } = useTranslation()
  const ids = getModelCapabilityIds({ capabilities, audio })
  const visibleItems = modelSelectorCapabilityOrder.filter((id) => ids.includes(id))

  if (visibleItems.length === 0) return null

  return (
    <Flex gap="xs" wrap="wrap">
      {visibleItems.map((id) => {
        const { label, icon, color, background } = modelCapabilityIcons[id]
        return (
          <Flex
            key={id}
            align="center"
            gap={4}
            className={clsx(
              'rounded-lg font-semibold',
              color,
              background,
              compact ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-sm'
            )}
          >
            <ScalableIcon icon={icon} size={compact ? 13 : 15} />
            <span>{t(label)}</span>
          </Flex>
        )
      })}
    </Flex>
  )
}
