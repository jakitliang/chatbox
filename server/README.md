# Chatbox manual snapshot sync backend

The runtime is now an authenticated, user-isolated SQLite snapshot service, not the former shared catalog manager.

**Use [SYNC.md](SYNC.md) for current setup, the exact HTTP/SQLite contract, TLS deployment, administration, tests and limitations.**

Downloaded catalog JSON, provenance and avatars are preserved. The offline catalog utilities remain available; the running sync service neither seeds nor exposes that shared catalog.

## Docker 部署（Linux）

基于 **debian:bookworm-slim**，使用 Python 3.11 + Gunicorn；需要 Docker Engine 和 Docker Compose v2。

```sh
cd server
cp .env.example .env
# 编辑 .env，设置 CHATBOX_ADMIN_PASSWORD（12–1024 字符）
chmod 600 .env
docker compose up --build
```

后续可用 `docker compose up -d` 后台运行。首次 `up` 会构建本地镜像 `chatbox-backend:bookworm`。
访问 <http://127.0.0.1:4567/admin>，使用 `admin` 登录；普通用户从注册页创建。
管理员仅管理普通用户，没有客户端存档空间。

- **配置**：宿主机 `.env` 只读挂载到 `/app/.env`，不会复制到镜像，也不使用 Compose `env_file` 传递密码。进程环境变量优先于挂载配置，密码不会进行 `${...}` 展开。更改密码后执行 `docker compose restart backend`。
- **权限**：入口进程读取配置后降权至 UID/GID 10001，Gunicorn 不以 root 运行。容器根文件系统只读；只有数据卷和临时目录可写。
- **数据**：宿主机 `./data` 读写挂载到容器 `/var/lib/chatbox`，首次启动自动创建。`data/users.db` 保存账号和会话，`data/users/<username>.db` 保存用户快照，`data/staging` 保存上传暂存。停止、删除或重建容器不会删除宿主机数据。入口会将目录和文件归属设为 UID/GID 10001，权限分别为 0700 / 0600；运维备份可能需要 sudo。数据目录不得包含符号链接。
- **网络**：默认使用 **Linux host networking**，仅监听宿主机 `127.0.0.1:4567`，不直接暴露公网 HTTP。Docker Desktop 的 host networking 支持有版本/配置限制，本模板面向 Linux 服务器。
- **端口冲突**：部署前停止已有的 4567 服务，或在 `.env` 修改 `CHATBOX_SERVER_PORT` 后重新创建容器。
- **远程访问**：在同一 Linux 宿主机部署 TLS 反向代理到 `127.0.0.1:4567`，填写 `.env.example` 中的准确 proxy peers、Host 和客户端 Origin 白名单；代理须保留 Host 并覆盖 `X-Forwarded-Proto: https`。不能只打开端口或泛化信任所有代理。启用远程 TLS 后注册默认关闭，可显式设置 `CHATBOX_SYNC_REGISTRATION=1`。
- **健康检查**：Compose 检查本地监听端口是否可连接，不绕过 TLS / Host 保护。生产环境还应从 TLS 代理检查登录页面，验证完整请求链路。
- **更新**：更新源码后 `docker compose up -d --build`。首次构建需要访问 Debian 和 Python 包源。
- **备份**：执行 `docker compose stop backend`，备份宿主机整个 `./data` 目录，再执行 `docker compose start backend`。恢复时停止容器并恢复整个目录，不要只恢复 users.db。`.env` 单独安全备份。数据为服务端可编辑明文，需要妥善保护磁盘和备份。

镜像仅包含当前快照服务和页面，不含 `.env`、本地数据、种子素材、旧目录服务或开发虚拟环境。

## Archived catalog-manager documentation (retired)

Everything below describes the previous implementation, **not the current runtime or deployment instructions**. Its unauthenticated endpoints, admin forms, automatic catalog seeding and statements that client data is not stored no longer apply. This historical material is retained only for asset provenance and offline import reference. Follow the sync guide above for deployment.

## 环境与启动

需要 Python 3.10+，唯一直接依赖为 Flask 3.1.x（其必需依赖由包管理器处理）。
WSL 已创建本目录的 .venv，并从中科大源安装 Flask 3.1.3；系统 Python 未修改。
该 venv 的 pip.conf 仅为此环境配置中科大源、15 秒超时及 2 次重试，不影响其他项目。
离线环境可用预先准备的 wheel 包安装。

在项目根目录执行：

```sh
python3 -m venv server/.venv
server/.venv/bin/python -m pip install -i https://mirrors.ustc.edu.cn/pypi/simple -r server/requirements.txt
server/.venv/bin/python server/app.py
```

访问 <http://127.0.0.1:4567/admin>。默认绑定 **127.0.0.1:4567**，不开 debug、不自动重载。

### 公开目录本地快照

本次已从官方公开接口下载 36 个简体中文助手、35 个官方头像，
并导入当前数据库和离线快照。最初失败的 6 个头像已通过浏览器原图下载补齐；
“投资研究搭档”的官方数据本身没有头像字段，并非抓取失败。
终端的失败发生在 TCP 建连前（HTTP 000），浏览器网络正常；不能归因于 User-Agent 拦截。
浏览器下载的素材可通过 `--browser-assets` 显式导入，只补缺图，不覆盖用户文案或已有头像。
英文目录已补齐 41 个助手，其中 21 个官方头像生成 256px WebP 本地缩略图；
其他 20 个官方记录没有头像。现在共 77 个中英文助手、56 个头像。
浏览器已完成 15 个非 Chatbox AI 提供商的模型清单查询，全部 HTTP 200；
OpenAI、Claude、Gemini、Groq 返回的 4 个非空模型组已导入，其余返回空目录。
这些是官方目录快照，不保证模型仍可调用；实际可用性以用户配置的提供商为准。
`--browser-catalog` 可增量导入浏览器下载的公开目录，不覆盖已有助手或提供商配置。
不会把官方收费能力开关、商业产品、更新版本和 Chatbox AI 模型重新导入。

显式执行 `server/.venv/bin/python server/snapshot.py --apply` 可下载快照；
重复下载会复用已有素材。`--apply` 只初始化空数据库，不覆盖管理页面修改。
默认安装首次启动也可从本地快照初始化空数据库，启动过程不会连接官方。
已有数据库补充内容应通过管理页面或离线导入，不能用此命令覆盖。

下载结果在本目录 snapshot 子目录（git 忽略），其中包含助手 JSON、配置 JSON、
来源 URL/时间/内容 SHA256 记录及头像。公开可访问不等于取得再分发许可，
这些第三方内容不作为项目可再分发源码提交；发布前应单独检查权利。
下载器遵守 robots、只访问明确的官方 HTTPS 域名、不跟随重定向、不带登录凭证，
遇到授权拒绝、机器人限制或超时会跳过并记录，不绕过限制。
若系统缺少 ensurepip/pip，普通 `python3 -m venv` 会报错；可安装系统 python3-venv，
或像本次一样先用 `--without-pip` 建立环境，再从可信包源下载并校验 pip wheel 来引导环境内 pip。
不要使用 `flask run --host=0.0.0.0`、debug 模式或反向代理将服务暴露到公网。
Flask 自带服务器适合本机低并发个人管理，不是公网生产服务器。本服务不是多用户系统，没有远程管理员登录功能。

默认数据位于本目录的 data 子目录；可指定绝对路径（支持 `~`）：

```sh
CHATBOX_SERVER_DATA_DIR="$HOME/.local/share/chatbox-server" server/.venv/bin/python server/app.py
```

数据库、会话签名密钥及上传头像都保存在该目录；会话密钥自动生成并持久化在 SQLite 的 metadata 表。
SQLite 新建文件权限 0600，新建目录权限 0700；请确保已有目录也仅对自己的操作系统账户开放。
备份时先停止服务，再复制整个数据目录（数据库和 uploads 必须一起备份）。
不要只复制数据库；也不要在运行时用其他程序修改上传目录或数据库。

## 日常管理

- 中文表单新增、编辑、改 ID、禁用、删除助手；名称、说明、提示词、标签、语言和头像均可编辑。
- ID 使用字母、数字、冒号、点、下划线、连字符；重复 ID 不覆盖已有助手。
- 标签用英文逗号分隔；语言精确匹配客户端传入的代码，如 zh-Hans、zh-Hant、en。
- 头像允许 PNG、JPEG、GIF、WebP，最多 **2 MiB**，同时检查扩展名与魔数，禁止 SVG。
  磁盘名由 UUID 生成；原文件名不作为存储路径。保存后在列表与编辑页预览，不使用前端脚本。
- 更换或删除头像时，只有没有任何助手引用的旧文件才会删除。失败的表单保存会清理新文件。
  数据库和文件系统无法构成同一原子事务；崩溃可能留下孤儿文件，可停止服务后执行下述 gc。
- CRM 式侧边导航分为助手管理、模型管理、应用设置、知识与检索；无需编辑 JSON。
- 助手列表可按名称/描述/标签搜索、按语言筛选，每页 20 条；无头像时显示名称首字占位。
- 提供商与模型通过独立表单新增、编辑和删除，删除前需确认。无效配置不写入数据库。
  此处只是清单和能力声明，**不是实际推理、embedding 或 rerank 服务**。

### 应用配置

在「应用设置」填写本地版本标识、知识库的嵌入/视觉/重排模型 ID。
版本标识只是静态配置，更新检查始终返回 false。商业提供商优先开关与商品列表固定关闭，
不在界面提供开启入口。

### 模型清单

在「模型管理」先新增提供商（标识须与客户端 aiProvider 一致），再添加对话/嵌入/重排或图像模型。
填写模型 ID、显示名称，通过下拉框选择类型和接口格式，通过复选框选择视觉、工具调用和推理能力。
还可填写说明、标签与上下文窗口。编辑保留未展示的既有模型元数据。
本后端不自动发现模型，不检查提供商账号，不存放 API key。

### RAG 配置

在「知识与检索」填写嵌入/重排模型 ID，并按需勾选附件能力。
默认能力全部关闭；启用前必须填写对应模型 ID，并确保客户端已配置可用的提供商。

## 客户端 API

在桌面客户端高级设置中，将应用 API 服务地址设置为 <http://127.0.0.1:4567>。
该设置只接管应用配置/助手清单，并不会替换模型 API 或保证整个客户端离线。
WSL 下服务的 29 项测试全部通过（包括 CRM 表单 CRUD/分页、Flask HTTP/模板/CORS/CSRF 与 SQLite），
另外通过运行中的 4567 端口完成 10 项真实本机 HTTP 验证，并打开管理页面检查显示。
桌面 Electron 端到端仍需另行验证。

| 路由 | 契约 |
| --- | --- |
| GET /api/remote_config/&lt;name&gt; | `{data: {name: value}}`；未知键为 null |
| GET /api/remote_config | `{data: 应用配置}` |
| GET /api/system_copilots/tags/&lt;lang&gt; | `{data: [标签]}`，仅启用助手 |
| POST /api/system_copilots/list | `{lang,limit,cursor,tag,search}` → `{data: [助手],next_cursor: null或字符串}` |
| GET / POST /api/copilots/list | 旧路由别名；GET 使用 query 参数；额外提供 next_cursor |
| POST /api/model_manifest | `{aiProvider}` → `{data:{groupName,models,imageModels}}`；未知提供商为空数组 |
| GET /api/session_rag/config | `{data:{models,capabilities}}` |
| GET /api/avatar/&lt;filename&gt; | 已关联 UUID 本地头像，明确图片 MIME；不存在/非法路径为 404 |
| GET /api/api_origins | 当前本机 origin |
| GET / POST /api/client_notifications/next、/api/dialog_config | `{data:null}`，不解析/保存客户端记录 |
| GET / POST /chatbox_need_update/&lt;version&gt; | `{need_update:false}` |
| POST /api/license/activate、/api/license/validate | `{data:{valid:false,instanceId:"",error:"..."}}`，不读取许可证 |
| 其他 /api/* | 403；包括分享、使用记录、许可证详情/注销、推理、云端账户等 |

助手响应包含 id/name/description/prompt/tags/lang/createdAt/updatedAt；有头像时同时包含
旧 picUrl 和新 `{type:"url",url:"http://本机地址/api/avatar/UUID.ext"}` avatar。
仅返回启用助手。搜索匹配名称、说明和标签（不搜索提示词），标签与语言精确匹配。
默认 limit 为 20（旧路由为 100），范围 1–100；旧列表超过 100 项也需要分页。
cursor 为最后一个 ID 的 URL-safe Base64，按 ID 稳定排序；不绑定筛选条件，继续翻页时应保持筛选不变。
目录读取和过滤是简单内存操作，适合个人助手库，不针对百万条记录优化。

## 安全边界

- 校验实际连接地址为 loopback，同时 Host 仅接受 localhost 或 loopback IP；不信任转发头。
- 客户端 CORS 只接受 `http://localhost:1212`、等价 127.0.0.1/IPv6 loopback 地址及 Electron `Origin: null`。
  无通配符、无跨源 cookie 凭证；允许客户端需要的 Content-Type、Authorization、CHATBOX-* 头。
- 管理页只允许同源 Origin，POST 表单需要会话 CSRF token；HttpOnly、SameSite=Strict cookie，模板默认转义，
  CSP 禁止脚本、外部资源和 iframe。浏览器本机 1212 与 null 来源不能执行管理员表单。
- null 来源无法区分 Electron 和其他 opaque origin（例如沙盒页面）；这里只提供只读配置/助手 API，不应放入秘密。
- 没有口令认证：**同一操作系统上的本机进程视为可信**。CSRF 不保护恶意本地进程、同账户文件访问或已控制的管理员浏览器。
- 魔数校验不是完整图片解码/病毒检测；Flask-only 方案不重编码图片。不要上传不可信图像。
- 直接启动时关闭 Werkzeug 逐请求访问日志，不写设备 ID、许可证、请求体、请求头或查询参数。
  若用外部 WSGI 服务器运行 create_app，也必须自行关闭其访问日志并维持仅本机部署。
- 只允许管理表单或明确运行的离线 CLI 写入数据。客户端 POST 只读清单，其他客户端写入功能返回 403。

## 可选离线导入（不会自动执行）

必须拥有内容或明确获得授权；不要直接把来源不明或抓取的专有助手 fixture 当作自己的内容导入。
先停止服务，明确指定自己的 JSON 和头像目录：

```sh
python3 server/import_data.py --data-dir "$HOME/.local/share/chatbox-server" import /path/to/my-assistants.json --avatars /path/to/my-avatars --lang zh-Hans --confirm-owned
python3 server/import_data.py --data-dir "$HOME/.local/share/chatbox-server" gc
```

导入器只用标准库，不需要 Flask。接受助手数组或 `{data:[...]}`；保留 ID、名称、说明、提示词、标签、语言、enabled。
旧 demoQuestion/demoAnswer/usedCount/shared 等字段不导入。缺少 tags 为 []，lang 使用 --lang，enabled 默认 true。
头像引用可为 avatar_filename、URL 类型 avatar.url 或旧 picUrl；只接受本地相对路径，兼容
/api/avatar/ 和 /static/api/avatar/ 前缀。拒绝远程 URL、绝对文件路径、..、百分号转义、反斜杠及符号链接。
所有图片同样校验大小/魔数并重新分配 UUID，源目录不被修改。
单次批量导入数据库使用一个事务；重复 ID 或无效数据整体回滚，并清理本次新头像。JSON 限制 10 MiB。
gc 仅删除 UUID 命名且无数据库引用的头像，其他文件与符号链接不动；**运行 gc 时必须停止服务**。

## 测试

在项目根目录：

```sh
python3 -m unittest discover -s server -v
python3 -m py_compile server/app.py server/storage.py server/import_data.py server/test_app.py
```

Flask 可用时运行 CRUD、HTTP 契约、模板、头像、CSRF、CORS、Host/loopback、持久化和“不记录客户端数据”测试。
Flask 不可用时明确跳过 HTTP 测试，仍执行标准库存储、魔数、路径、引用清理和离线导入回滚测试。
本说明不把跳过的测试视为通过，也不声称已验证桌面 UI 集成。