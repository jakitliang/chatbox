import { Box, Divider } from '@mui/material'
import { ModelProvider, ModelSettings } from '../../../shared/types'
import AIProviderSelect from '../../components/AIProviderSelect'
// import AzureSetting from './AzureSetting'
// import ChatboxAISetting from './ChatboxAISetting'
// import ChatGLM6BSetting from './ChatGLMSetting'
// import ClaudeSetting from './ClaudeSetting'
import CustomProviderSetting from './CustomProviderSetting'
// import DeepSeekSetting from './DeepSeekSetting'
// import GeminiSetting from './GeminiSetting'
// import GroqSetting from './GroqSetting'
import LMStudioSetting from './LMStudioSetting'
import OllamaSetting from './OllamaSetting'
// import OpenAISetting from './OpenAISetting'
// import PerplexitySetting from './PerplexitySetting'
// import SiliconFlowSetting from './SiliconFlowSetting'
// import XAISetting from './XAISetting'

interface ModelConfigProps {
  settingsEdit: ModelSettings
  setSettingsEdit: (settings: ModelSettings) => void
}

export default function ModelSettingTab(props: ModelConfigProps) {
  const { settingsEdit, setSettingsEdit } = props
  return (
    <Box>
      <AIProviderSelect
        aiProvider={settingsEdit.aiProvider}
        onSwitchAIProvider={(v) => setSettingsEdit({ ...settingsEdit, aiProvider: v })}
        selectedCustomProviderId={settingsEdit.selectedCustomProviderId}
        onSwitchCustomProvider={(v) =>
          setSettingsEdit({
            ...settingsEdit,
            aiProvider: ModelProvider.Custom,
            selectedCustomProviderId: v,
          })
        }
      />
      <Divider sx={{ marginTop: '10px', marginBottom: '24px' }} />
      {settingsEdit.aiProvider === ModelProvider.Ollama && (
        <OllamaSetting settingsEdit={settingsEdit} setSettingsEdit={setSettingsEdit} />
      )}
      {settingsEdit.aiProvider === ModelProvider.Custom && (
        <CustomProviderSetting settingsEdit={settingsEdit} setSettingsEdit={setSettingsEdit} />
      )}
      {settingsEdit.aiProvider === ModelProvider.LMStudio && (
        <LMStudioSetting settingsEdit={settingsEdit} setSettingsEdit={setSettingsEdit} />
      )}
    </Box>
  )
}
