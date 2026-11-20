import type { ModelCapabilityId } from '@shared/providers/model-config'
import { IconBulb, IconEye, IconTool, IconWaveSine } from '@tabler/icons-react'

export const modelSelectorCapabilityOrder = ['vision', 'reasoning', 'tool_use', 'audio'] as const

export const modelCapabilityIcons = {
  vision: { label: 'Vision', icon: IconEye, color: 'text-sky-600', background: 'bg-sky-50', tone: 'chatbox-brand' },
  reasoning: {
    label: 'Reasoning',
    icon: IconBulb,
    color: 'text-amber-600',
    background: 'bg-amber-50',
    tone: 'chatbox-warning',
  },
  tool_use: {
    label: 'Tool Use',
    icon: IconTool,
    color: 'text-emerald-600',
    background: 'bg-emerald-50',
    tone: 'chatbox-success',
  },
  audio: { label: 'Audio', icon: IconWaveSine, color: 'text-violet-600', background: 'bg-violet-50', tone: undefined },
} as const satisfies Partial<Record<ModelCapabilityId, unknown>>
