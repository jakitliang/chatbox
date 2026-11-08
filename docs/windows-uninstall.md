# Windows 卸载与注册表清理

## 应用拥有的注册项

标准 NSIS 卸载负责以下清理，升级内部调用卸载时跳过自定义注册清理：

| 注册项 | 处理方式 |
| --- | --- |
| electron-builder 安装位置、版本、卸载入口 | 使用 builder 的 `INSTALL_REGISTRY_KEY` / `UNINSTALL_REGISTRY_KEY` 原生删除，不猜测 GUID |
| HKCU / HKLM Software\Classes\chatbox | 仅当 open command 的第一个带引号可执行文件与正在卸载的安装路径一致时删除 |
| HKCU / HKLM Software\Microsoft\Windows\CurrentVersion\Run 的 Chatbox 值 | 同样按可执行路径核对，只删除该值，保留共享 Run 键 |
| Explorer\StartupApproved\Run / Run32 的 Chatbox 值 | 清理匹配自启动值的批准记录；自启动值已删除时，仅在同一 hive 的协议证明所有权后清理孤儿批准值 |

自定义代码同时检查 32 位和 64 位注册视图。HKLM 清理只在 all-users 卸载执行；
HKCU 仅代表实际运行卸载程序的 Windows 用户。遇到其他安装目录的协议或启动命令，保留该注册项。
开发环境的 chatbox-dev 协议指向开发工具，不属于已安装应用，不删除。

当前项目没有注册文件扩展名关联，也没有额外通知 AppUserModelID 注册键的写入代码；
`setAppUserModelId` 本身不是创建专属注册键的行为。

## 不能承诺“注册表完全无痕”

- 不删除 Windows 维护的 UserAssist、MuiCache、AppCompat、BAM、MRU、UserChoice 等历史或共享数据。
- 不卸载 Microsoft VC++ Redistributable，它是其他程序可能使用的共享组件。
- 不加载或修改其他用户的 NTUSER.DAT；多用户机器上的 HKCU 必须逐用户检查。
- 失去安装路径证据的旧版本孤儿项不会仅凭名称就强行删除。
- 手工删除安装目录不是标准卸载，无法触发卸载钩子。
- 聊天记录、文件、缓存位于磁盘而不是注册表；本次不改变原数据保留政策，也不删除用户导出的文件。

因此可验证的目标是 **标准卸载清除能够证明属于本次安装的应用注册项**，不是抹除所有 Windows 历史。

## 发布前 Windows 验收

本次 Linux 环境只执行静态集成回归测试，未执行真实 Windows 安装/卸载。
必须在干净 Windows VM 上使用最终打包安装器完成以下矩阵：

1. x64 / ARM64，当前用户安装 / 管理员 all-users 安装。
2. 安装后运行应用，确认协议命令；启用开机启动，确认 Run 值。
3. 在任务管理器禁用启动项，再卸载，检查两个 StartupApproved 位置。
4. 在应用关闭开机启动（Run 已移除）后卸载，检查批准孤儿值。
5. 检查 32/64 位视图的协议、Run/StartupApproved、安装位置及卸载入口均已移除。
6. 保留另一个安装路径的同名协议/Run 值，确认卸载不会误删。
7. 升级和静默升级，确认协议/启动设置未被自定义卸载清理。
8. 多用户机器逐用户检查；不要把卸载执行用户的 HKCU 结果当成所有用户的结果。

若注册表 ACL 拒绝删除或 Windows 验收发现残留，应视为验证失败并调查，不能仅凭源代码保证已清理。