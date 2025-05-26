import MaxContextMessageCountSlider, {
  toBeRemoved_getContextMessageCount,
} from '@/components/MaxContextMessageCountSlider'
import { OllamaModelSelect } from '@/components/model-select/OllamaModelSelect'
import TemperatureSlider from '@/components/TemperatureSlider'
import TextFieldReset from '@/components/TextFieldReset'
import platform from '@/platform'
import { languageAtom } from '@/stores/atoms'
import { Alert, Box, Stack, Typography } from '@mui/material'
import { useAtomValue } from 'jotai'
import { Trans, useTranslation } from 'react-i18next'
import { ModelSettings } from '@/../shared/types'
import { Accordion, AccordionDetails, AccordionSummary } from '@/components/Accordion'
import { useState } from 'react';

export function OllamaHostInput(props: {
  ollamaHost: string
  setOllamaHost: (host: string) => void
  className?: string
}) {
  const { t } = useTranslation()
  const language = useAtomValue(languageAtom)
  const tutorial = `
# Linux/Mac
OLLAMA_HOST=0.0.0.0 ollama serve

# Windows PowerShell
$env:OLLAMA_HOST="0.0.0.0"; ollama serve
  `
  const [showTutorial, setShowTutorial] = useState(false);
  return (
    <>
      <TextFieldReset
        label={t('api host')}
        value={props.ollamaHost}
        defaultValue="http://localhost:11434"
        onValueChange={props.setOllamaHost}
        fullWidth
        className={props.className}
      />
      <Alert icon={false} severity="info" className="my-4">
        <p>
          <Trans
            i18nKey="Please ensure that the Remote Ollama Service is able to connect remotely. For more details, refer to <a>this tutorial</a>."
            components={{
              a: (
                <a
                  className="cursor-pointer font-bold"
                  // onClick={() => {
                  //   platform.openLink(`https://chatboxai.app/redirect_app/ollama_guide/${language}`)
                  // }}
                  onClick={() => {
                    setShowTutorial(!showTutorial)
                  }}
                ></a>
              ),
            }}
          />
        </p>
        {showTutorial && (<p>
          <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 'bold' }}>Ollama配置说明：</Typography>
          <Typography variant="body2">
            1. 下载并安装Ollama: 访问<a href="https://ollama.ai" target="_blank" rel="noopener noreferrer" className="text-blue-500">https://ollama.ai</a>
          </Typography>
          <Typography variant="body2">
            2. 启动Ollama服务
          </Typography>
          <Typography variant="body2">
            3. 如需远程访问，需要设置OLLAMA_HOST环境变量：
            <pre style={{ fontFamily: 'monospace' }}>
              {tutorial}
            </pre>
          </Typography>
          <Typography variant="body2">
            4. 下载模型: <span style={{ fontFamily: 'monospace' }}>ollama pull llama3</span>
          </Typography>
          <Typography variant="body2">
            5. 确保防火墙允许11434端口的访问
          </Typography>
        </p>)}
      </Alert>
    </>
  )
}

interface ModelConfigProps {
  settingsEdit: ModelSettings
  setSettingsEdit: (settings: ModelSettings) => void
}

export default function OllamaSetting(props: ModelConfigProps) {
  const { settingsEdit, setSettingsEdit } = props
  const { t } = useTranslation()
  return (
    <Stack spacing={2}>
      <OllamaHostInput
        ollamaHost={settingsEdit.ollamaHost}
        setOllamaHost={(v) => setSettingsEdit({ ...settingsEdit, ollamaHost: v })}
      />
      <OllamaModelSelect settingsEdit={settingsEdit} setSettingsEdit={setSettingsEdit} />
      <Accordion>
        <AccordionSummary aria-controls="panel1a-content">
          <Typography>{t('Advanced')}</Typography>
        </AccordionSummary>
        <AccordionDetails>
          <MaxContextMessageCountSlider
            value={toBeRemoved_getContextMessageCount(
              settingsEdit.openaiMaxContextMessageCount,
              settingsEdit.maxContextMessageCount
            )}
            onChange={(v) => setSettingsEdit({ ...settingsEdit, maxContextMessageCount: v })}
          />
          <TemperatureSlider
            value={settingsEdit.temperature}
            onChange={(v) => setSettingsEdit({ ...settingsEdit, temperature: v })}
          />
        </AccordionDetails>
      </Accordion>
    </Stack>
  )
}
