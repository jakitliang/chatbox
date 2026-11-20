import { useTranslation } from 'react-i18next'
import { AdaptiveSelect } from '@/components/AdaptiveSelect'
import { CheckedFieldRow } from '@/components/settings/CheckedFieldRow'
import { SettingRow, SettingsSection } from '@/components/settings/SettingsLayout'
import { documentParsers, getAvailableDocumentParsers, isActiveDocumentParser } from '@/packages/document-parsers'
import platform from '@/platform'
import { getPlatformDefaultDocumentParser, useSettingsStore } from '@/stores/settingsStore'

/** Parser choice and its credentials, as one settings section. */
export function DocumentParserSettings() {
  const { t } = useTranslation()

  const extension = useSettingsStore((state) => state.extension)
  const setSettings = useSettingsStore((state) => state.setSettings)

  const documentParser = extension?.documentParser
  const mineruToken = documentParser?.mineru?.apiToken || ''

  const parserOptions = getAvailableDocumentParsers(platform)
  const currentParserType = resolveDocumentParserType(documentParser?.type ?? getPlatformDefaultDocumentParser().type)

  return (
    <SettingsSection title={t('Parser')}>
      <SettingRow
        id="parser-type"
        label={t('Parser Type')}
        description={
          currentParserType === 'none'
            ? t('Only supports basic text files (.txt, .md, .json, code files, etc.).')
            : t(documentParsers[currentParserType].description)
        }
        controlLayout="block"
        control={(fieldId) => (
          <AdaptiveSelect
            id={fieldId}
            comboboxProps={{ withinPortal: true, withArrow: true }}
            aria-label={t('Parser Type') ?? undefined}
            data={[
              ...parserOptions.map((value) => ({ value, label: t(documentParsers[value].label) })),
              ...(currentParserType === 'none' ? [{ value: 'none', label: t('None'), disabled: true }] : []),
              ...(currentParserType === 'mineru' && !parserOptions.includes('mineru')
                ? [{ value: 'mineru', label: t(documentParsers.mineru.label), disabled: true }]
                : []),
            ]}
            value={currentParserType}
            onChange={(value) => {
              if (!isActiveDocumentParser(value) || !parserOptions.includes(value)) return
              setSettings({
                extension: { ...extension, documentParser: { ...documentParser, type: value } },
              })
            }}
          />
        )}
      />
      {currentParserType === 'mineru' && parserOptions.includes('mineru') && (
        <CheckedFieldRow
          id="mineru-api-token"
          label={t('MinerU API Token')}
          secret
          value={mineruToken}
          onChange={(apiToken) =>
            setSettings({
              extension: {
                ...extension,
                documentParser: { ...documentParser, type: 'mineru', mineru: { apiToken } },
              },
            })
          }
          check={async (token) => {
            const result = await platform.getKnowledgeBaseController().testMineruConnection(token)
            if (!result.success) throw new Error('MinerU rejected the token')
          }}
          failureMessage={t('API key invalid!')}
          getKeyUrl="https://mineru.net/apiManage"
          getKeyLabel={t('Get API Token') ?? undefined}
        />
      )}
    </SettingsSection>
  )
}

export default DocumentParserSettings
import { resolveDocumentParserType } from '@chatbox/core/domain/settings'
