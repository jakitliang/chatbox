import { type ButtonProps, Stack, type StackProps } from '@mantine/core'

export const defaultModelCardFieldClass = 'w-full min-w-0 sm:w-[320px]'
export const defaultModelCardAction = { variant: 'default', size: 'sm' } satisfies ButtonProps
export const defaultModelCardLink = {
  variant: 'subtle',
  size: 'compact-xs',
  className: 'self-start',
} satisfies ButtonProps

export function DefaultModelSettingsCard({
  children,
  ...accessibility
}: Pick<StackProps, 'children' | 'role' | 'aria-label'>) {
  return (
    <Stack
      {...accessibility}
      gap="sm"
      p="md"
      className="min-w-0 border border-solid border-chatbox-border-primary rounded-xl bg-chatbox-background-primary"
    >
      {children}
    </Stack>
  )
}
