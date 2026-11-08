import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const installer = fs.readFileSync(path.resolve('assets/installer.nsh'), 'utf8')
const template = fs.readFileSync(path.resolve('node_modules/app-builder-lib/templates/nsis/uninstaller.nsh'), 'utf8')

describe('Windows uninstall registry integration', () => {
  it('uses the supported uninstall hook and skips upgrade uninstalls', () => {
    expect(template).toContain('!insertmacro customUnInstall')
    expect(installer).toMatch(/!macro customUnInstall\s+;[^\n]*\n\s*\$\{IfNot\} \$\{isUpdated\}/)
    expect(installer).toContain('SetRegView 32')
    expect(installer).toContain('SetRegView 64')
    expect(installer).toContain('!insertmacro check64BitAndSetRegView')
  })

  it('checks the exact quoted executable and argument boundary before deletion', () => {
    for (const name of ['ChatboxRemoveOwnedProtocol', 'ChatboxRemoveOwnedStartup']) {
      const macro = installer.split(`!macro ${name} ROOT`)[1].split('!macroend')[0]
      expect(macro).toContain('$INSTDIR\\${APP_EXECUTABLE_FILENAME}')
      expect(macro.indexOf('${If} $R3 == $R1')).toBeLessThan(macro.indexOf('DeleteReg'))
      expect(macro).toContain('StrCpy $R3 $R0 1 $R2')
      expect(macro).toContain('${OrIf} $R3 == " "')
    }
  })

  it('deletes startup values, never shared Windows keys or developer protocols', () => {
    expect(installer).toContain('DeleteRegValue ${ROOT} "Software\\Microsoft\\Windows\\CurrentVersion\\Run" "Chatbox"')
    expect(installer).toContain('Explorer\\StartupApproved\\Run32')
    expect(installer).not.toMatch(/DeleteRegKey[^\n]*(?:HKCR|CurrentVersion|VisualStudio|chatbox-dev)/)
    expect(installer).not.toMatch(/DeleteReg[^\n]*(?:UserChoice|UserAssist|MuiCache|AppCompat|BAM|MRU)/i)
    expect(installer).toContain('${If} $installMode == "all"')
  })

  it('retains electron-builder installation and uninstall-record cleanup', () => {
    expect(template).toContain('DeleteRegKey SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}"')
    expect(template).toContain('DeleteRegKey SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}"')
  })

  it('requires same-hive protocol ownership before cleaning an orphan startup approval', () => {
    const protocol = installer.split('!macro ChatboxRemoveOwnedProtocol ROOT')[1].split('!macroend')[0]
    const startup = installer.split('!macro ChatboxRemoveOwnedStartup ROOT')[1].split('!macroend')[0]
    expect(protocol).toContain('StrCpy $R4 0')
    expect(protocol.indexOf('StrCpy $R4 1')).toBeGreaterThan(protocol.indexOf('${If} $R3 == $R1'))
    expect(startup).toContain('${ElseIf} $R0 == ""\n  ${AndIf} $R4 == 1')
    expect(installer).toContain('Push $R4')
    expect(installer).toContain('Pop $R4')
  })
})