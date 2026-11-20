import { Stack, type StackProps } from '@mantine/core'

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
