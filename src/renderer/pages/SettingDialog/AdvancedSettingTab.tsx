import { Box, FormControlLabel, FormGroup, Switch, Typography } from '@mui/material'
import type { Settings } from '@shared/types'
import { useTranslation } from 'react-i18next'
import { Accordion, AccordionDetails, AccordionSummary } from '@/components/Accordion'
import TextFieldReset from '@/components/common/TextFieldReset'
import { ShortcutConfig } from '@/components/Shortcut'
import { BackupRestoreSections } from '@/components/settings/DataSections'
import { useIsSmallScreen } from '@/hooks/useScreenChange'
import platform from '@/platform'

interface Props {
  settingsEdit: Settings
  setSettingsEdit: (settings: Settings) => void
  onCancel: () => void
}

export default function AdvancedSettingTab(props: Props) {
  const { settingsEdit, setSettingsEdit } = props
  const { t } = useTranslation()
  const isSmallScreen = useIsSmallScreen()
  return (
    <Box>
      <Accordion>
        <AccordionSummary aria-controls="panel1a-content">
          <Typography>{t('Network Proxy')}</Typography>
        </AccordionSummary>
        <AccordionDetails>
          <TextFieldReset
            label={t('Proxy Address')}
            value={settingsEdit.proxy || ''}
            onValueChange={(value) => {
              setSettingsEdit({ ...settingsEdit, proxy: value.trim() })
            }}
            placeholder="socks5://127.0.0.1:6153"
            autoFocus={!isSmallScreen}
            fullWidth
            margin="dense"
            variant="outlined"
            disabled={platform.type === 'web'}
            inputProps={{
              className: platform.type === 'web' ? 'cursor-not-allowed' : '',
            }}
            helperText={
              platform.type === 'web' ? <span className="text-red-600">{t('not available in browser')}</span> : null
            }
          />
        </AccordionDetails>
      </Accordion>
      {platform.type !== 'mobile' && (
        <Accordion>
          <AccordionSummary aria-controls="panel1a-content">
            <Typography>{t('Hotkeys')}</Typography>
          </AccordionSummary>
          <AccordionDetails>
            <ShortcutConfig
              shortcuts={settingsEdit.shortcuts}
              setShortcuts={(shortcuts) => setSettingsEdit({ ...settingsEdit, shortcuts })}
            />
          </AccordionDetails>
        </Accordion>
      )}
      <Accordion>
        <AccordionSummary aria-controls="panel1a-content">
          <Typography>{t('Data Backup and Restore')}</Typography>
        </AccordionSummary>
        <AccordionDetails>
          <BackupRestoreSections />
        </AccordionDetails>
      </Accordion>
      {platform.type === 'desktop' && (
        <Box className="mt-2">
          <FormGroup>
            <FormControlLabel
              control={<Switch />}
              label={t('Launch at system startup')}
              checked={settingsEdit.autoLaunch}
              onChange={(e, checked) =>
                setSettingsEdit({
                  ...settingsEdit,
                  autoLaunch: checked,
                })
              }
            />
          </FormGroup>
        </Box>
      )}
      {platform.type === 'desktop' && (
        <Box className="mt-2">
          <FormGroup>
            <FormControlLabel
              control={<Switch />}
              label={t('Automatic updates')}
              checked={settingsEdit.autoUpdate}
              onChange={(e, checked) =>
                setSettingsEdit({
                  ...settingsEdit,
                  autoUpdate: checked,
                })
              }
            />
            {settingsEdit.autoUpdate && (
              <FormControlLabel
                control={<Switch />}
                label={t('Beta updates')}
                checked={settingsEdit.betaUpdate}
                onChange={(e, checked) =>
                  setSettingsEdit({
                    ...settingsEdit,
                    betaUpdate: checked,
                  })
                }
              />
            )}
          </FormGroup>
        </Box>
      )}
    </Box>
  )
}

/** Legacy UI exports retained without exposing reporting controls. */
export function AnalyticsSetting() {
  return null
}

export function AllowReportingAndTrackingCheckbox(_props: { className?: string }) {
  return null
}
