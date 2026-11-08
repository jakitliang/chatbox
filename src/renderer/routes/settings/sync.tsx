import { Alert, Button, Checkbox, Divider, Group, PasswordInput, Progress, Stack, Text, TextInput } from '@mantine/core'
import { createFileRoute } from '@tanstack/react-router'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { normalizeAppApiServer } from '@shared/request/chatbox-api-origin'
import { SettingsPage, SettingsSection } from '@/components/settings/SettingsLayout'
import { downloadManualSyncRecovery, restoreManualSync, restoreManualSyncRecovery, uploadManualSync } from '@/packages/manual-sync'
import { useSettingsStore } from '@/stores/settingsStore'

export const Route = createFileRoute('/settings/sync')({ component: RouteComponent })

export function RouteComponent() {
  const { t: translate } = useTranslation()
  const t = (key: string): string => String(translate(key))
  const address = useSettingsStore((s) => s.appApiServer)
  const setSettings = useSettingsStore((s) => s.setSettings)
  // Suggest the same-origin backend only for integrated Web builds; saving is
  // still explicit and no request is made on mount or when saving the address.
  const suggestedAddress = import.meta.env.VITE_INTEGRATED_DEPLOYMENT ? window.location.origin : ''
  const [draft, setDraft] = useState(address || suggestedAddress)
  const [username, setUsername] = useState('')
  const password = useRef<HTMLInputElement>(null)
  const running = useRef(false)
  const [busy, setBusy] = useState(false)
  const [confirmed, setConfirmed] = useState(false)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [percent, setPercent] = useState(0)
  const action = async (restore: boolean) => {
    if (running.current || (restore && !confirmed)) return
    running.current = true
    setBusy(true); setError('')
    // Credentials stay only in this manual call, never in settings/localStorage or a saved session.
    const secret = password.current?.value ?? ''
    if (password.current) password.current.value = ''
    try {
      if (draft.trim() !== address) throw new Error(t('Save the backend address first.'))
      const progress = (message: string, value = 0) => { setStatus(message); setPercent(value) }
      await (restore ? restoreManualSync : uploadManualSync)(address, username, secret, progress)
      setStatus(restore ? t('Restore complete. The pre-restore recovery backup is stored locally.') : t('Complete snapshot committed to backend.'))
    } catch (e) { setError(e instanceof Error ? e.message : t('Sync failed. Please try again.')) }
    finally { running.current = false; setBusy(false); setConfirmed(false) }
  }
  return (
    <SettingsPage title={t('Manual Sync')} description={t('Only connects when you manually back up or restore. No automatic sync or background requests.')}>
      <SettingsSection title={t('Sync Backend')} description={t('Saving the address does not connect. Leave it empty to run independently.')}>
        <Stack gap="md" p={{ base: 16, sm: 24 }}>
          <TextInput label={t('Backend address (not the model API)')} placeholder="https://sync.example.com / 127.0.0.1:4567" size="sm" radius="sm"
            value={draft} disabled={busy} onChange={(e) => setDraft(e.currentTarget.value)} />
          <Group><Button size="sm" variant="default" disabled={busy} onClick={() => {
            try { const value = normalizeAppApiServer(draft); setSettings({ appApiServer: value }); setDraft(value); setError(''); setStatus(value ? t('Address saved. No connection was made.') : t('Backend disconnected. The client continues to run independently.')) }
            catch { setError(t('Invalid backend address.')) }
          }}>{t('Save address')}</Button></Group>
          <Text fz={12} c="chatbox-tertiary" lh="18px">{t('Remote connections require HTTPS. HTTP is only allowed on loopback. Register an account on the backend or contact its administrator.')}</Text>
        </Stack>
      </SettingsSection>
      <SettingsSection title={t('Complete SQLite Snapshot')} description={t('Manual backup and restore, without automatic sync.')}>
        <Stack gap="lg" p={{ base: 16, sm: 24 }}>
          <Alert color="yellow" variant="light" radius="md" title={t('Privacy notice: not end-to-end encrypted')} styles={{ title: { fontSize: 14 }, message: { fontSize: 13, lineHeight: '20px' } }}>
            {t('The snapshot includes conversations, attachments, settings, assistants and API credentials. The backend administrator can read it. The last successful upload replaces the backend snapshot.')}
            {' '}{t('Restore replaces local data and deletes conversations and assistants absent from the snapshot. It does not merge. Other local data, such as knowledge base files, is outside the V3 scope.')}
          </Alert>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-start">
            <TextInput label={t('Backend account')} size="sm" radius="sm" placeholder={t('Backend account')} autoComplete="off" value={username} disabled={busy} onChange={(e) => setUsername(e.currentTarget.value)} />
            <PasswordInput label={t('Password (enter for each operation; not saved)')} size="sm" radius="sm" ref={password} autoComplete="off" disabled={busy} />
          </div>
          <Group gap="sm">
            <Button size="sm" disabled={busy} onClick={() => void action(false)}>{t('Back up to backend')}</Button>
          </Group>
          <Divider />
          <Stack gap="md">
            <Text fz={14} lh="20px" fw={600}>{t('Replace and restore')}</Text>
            <Checkbox label={t('I confirm replacing local conversations, settings and assistants. A local recovery backup will be saved first.')}
              size="sm" styles={{ label: { fontSize: 13, lineHeight: '20px' }, body: { alignItems: 'flex-start' } }}
              checked={confirmed} disabled={busy} onChange={(e) => setConfirmed(e.currentTarget.checked)} />
          <Group gap="sm">
            <Button size="sm" color="red" disabled={busy || !confirmed} onClick={() => void action(true)}>{t('Restore from backend')}</Button>
            <Button size="sm" variant="default" disabled={busy} onClick={() => {
              void downloadManualSyncRecovery().catch((e) => setError(e.message))
            }}>{t('Export pre-restore recovery backup')}</Button>
            <Button size="sm" variant="default" disabled={busy || !confirmed} onClick={async () => {
              if (running.current) return
              running.current = true; setBusy(true); setError('')
              try {
                await restoreManualSyncRecovery((message, value = 0) => { setStatus(message); setPercent(value) })
              } catch (e) { setError(e instanceof Error ? e.message : t('Restore failed.')) }
              finally { running.current = false; setBusy(false); setConfirmed(false) }
            }}>{t('Restore previous local data')}</Button>
          </Group>
          </Stack>
          <Text size="xs" c="dimmed" lh={1.7}>{t('Maximum size: 256 MiB. Stop generation and avoid editing data or using other windows during the operation. A failed restore may leave partial changes. Use the local recovery action to roll back without connecting.')}</Text>
          {busy && <Progress value={percent} animated aria-label={t('Sync progress')} />}
          {status && <Text fz={13} lh="20px" role="status">{status}</Text>}
          {error && <Alert color="red" radius="md" styles={{ message: { fontSize: 13, lineHeight: '20px' } }} role="alert">{error}</Alert>}
        </Stack>
      </SettingsSection>
    </SettingsPage>
  )
}