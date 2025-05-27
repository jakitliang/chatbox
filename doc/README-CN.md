<p align="right">
  <a href="../README.md">English</a> |
  <a href="README-CN.md">简体中文</a>
</p>

这里是 Chatbox 社区版的代码仓库，以 GPLv3 许可证开源。对大多数用户来说，更建议直接使用 Chatbox 官方版（闭源）。它仍然完全免费，安装简单，而且支持更多最新功能。你可以在下面获取：

### 注意事项

**此版本由 `Jakit` 修改，个人本地使用.**

---


<h1 align="center">
<img src='./statics/icon.png' width='30'>
<span>
    Chatbox
    <span style="font-size:8px; font-weight: normal;">(Community Edition)</span>
</span>
</h1>
<p align="center">
    <em>Chatbox 是一个 AI 模型桌面客户端，支持 ChatGPT、Claude、Google Gemini、Ollama 等主流模型，适用于 Windows、Mac、Linux、Web、Android 和 iOS 全平台</em>
</p>

<img src="./statics/demo_desktop_1.jpg" alt="应用截图" style="box-shadow: 2px 2px 10px rgba(0,0,0,0.1); border: 1px solid #ddd; border-radius: 8px; width: 700px" />

<img src="./statics/demo_desktop_2.jpg" alt="应用截图" style="box-shadow: 2px 2px 10px rgba(0,0,0,0.1); border: 1px solid #ddd; border-radius: 8px; width: 700px" />

## 特性

-   **本地数据存储**  
    :floppy_disk: 您的数据保留在您的设备上，确保数据永不丢失并保护您的隐私。

-   **无需部署、直接安装的安装包**  
    :package: 通过可下载的安装包快速开始使用。无需复杂设置！

-   **支持多个 LLM 提供商**  
    :gear: 无缝集成多种 AI 模型：

    -   OpenAI (ChatGPT)
    -   Azure OpenAI
    -   Claude
    -   Google Gemini Pro
    -   Ollama (启用对本地模型的访问，如 llama2、Mistral、Mixtral、codellama、vicuna、yi 和 solar)
    -   ChatGLM-6B

-   **使用 Dall-E-3 生成图像**  
    :art: 使用 Dall-E-3 创建您想象中的图像。

-   **增强提示**  
    :speech_balloon: 高级提示功能，精炼并聚焦您的查询以获得更好的响应。

-   **键盘快捷键**  
    :keyboard: 使用加速您工作流程的快捷键保持高效。

-   **Markdown、Latex 和代码高亮**  
    :scroll: 使用 Markdown 和 Latex 的全部功能生成消息，并结合各种编程语言的语法高亮，提高可读性和呈现效果。

-   **提示库和消息引用**  
    :books: 保存和组织提示以供重复使用，并引用消息以在讨论中提供上下文。

-   **流式回复**  
    :arrow_forward: 通过即时、渐进式回复快速响应您的互动。

-   **人体工程学 UI 和深色主题**  
    :new_moon: 用户友好的界面，带有夜间模式选项，减少长时间使用时的眼睛疲劳。

-   **团队协作**  
    :busts_in_silhouette: 轻松协作并在团队中共享 OpenAI API 资源。[了解更多](../team-sharing/README.md)

-   **跨平台可用性**  
    :computer: 聊天盒已为 Windows、Mac、Linux 用户准备就绪。

-   **通过 Web 版本随处访问**  
    :globe_with_meridians: 在任何设备上使用带有浏览器的 Web 应用程序，随时随地。

-   **iOS 和 Android**  
    :phone: 使用移动应用程序，随时随地在您的指尖上带来这种能力。

-   **多语言支持**  
    :earth_americas: 通过提供多种语言的支持，迎合全球受众：

    -   English
    -   简体中文 (Simplified Chinese)
    -   繁體中文 (Traditional Chinese)
    -   日本語 (Japanese)
    -   한국어 (Korean)
    -   Français (French)
    -   Deutsch (German)
    -   Русский (Russian)

-   **更多...**  
    :sparkles: 不断增强体验，加入新功能！

## 常见问题解答

-   [常见问题](./FAQ-CN.md)

## 如何贡献

欢迎任何形式的贡献，包括但不限于：

-   提交问题
-   提交拉取请求
-   提交功能请求
-   提交错误报告
-   提交文档修订
-   提交翻译
-   提交任何其他形式的贡献

## 构建指南

### Ruby 环境

> 由于一些 API 依赖 `chatbox.ai` 官网，所以做了一些本地化的客制化

1. 安装 Ruby

#### For Windows:

1. 安装 ruby-2.3，[下载点这里](https://github.com/oneclick/rubyinstaller/releases/download/ruby-2.3.3/ruby-2.3.3-x64-mingw32.7z)
2. 下载 ruby-2.3 的 devkit，[下载点这里](https://github.com/oneclick/rubyinstaller/releases/download/devkit-4.7.2/DevKit-mingw64-64-4.7.2-20130224-1432-sfx.exe)

具体安装自己研究去吧……

#### For Linux:

1. 安装 rbenv

```
sudo apt install git build-essential zlib1g-dev libffi-dev libyaml-dev libreadline-dev
git clone https://github.com/rbenv/rbenv.git ~/.rbenv
echo 'eval "$(~/.rbenv/bin/rbenv init - bash)"' >> ~/.bashrc
eval "$(~/.rbenv/bin/rbenv init - bash)"
git clone https://github.com/rbenv/ruby-build.git "$(rbenv root)"/plugins/ruby-build
```

2. 安装 ruby

```
rbenv install 2.3.8
# wait ...
rbenv global 2.3.8
```

#### For macOS:

1. 安装 Xcode

2. 安装 ruby 依赖

```
brew install zlib libffi libyaml readline openssl@1.1
```

3. Install rbenv

```
git clone https://github.com/rbenv/rbenv.git ~/.rbenv
echo 'eval "$(~/.rbenv/bin/rbenv init - bash)"' >> ~/.bashrc
eval "$(~/.rbenv/bin/rbenv init - bash)"
git clone https://github.com/rbenv/ruby-build.git "$(rbenv root)"/plugins/ruby-build
```

4. 安装 ruby

```
rbenv install 2.3.8
# wait ...
rbenv global 2.3.8
```

### Ruby API 服务配置

1. 安装 bundler

```bash
gem install bundler -v 1.17.3
```

2. 配置并启动

```bash
cd server
bundle install
ruby app.rb
```

然后你就能看到这个地址监听了 `http://localhost:4567`

这时候，你最好还是弄个 `nginx` 绑个 url，就像这样：

```
server {
  ...
  location /api/ {
    proxy_pass http://localhost:4567/api/
  }
}
```

1. 从 Github 克隆仓库

```bash
git clone https://github.com/Bin-Huang/chatbox.git
```

2. 安装所需的依赖

```bash
npm install
```

3. 启动应用程序（开发模式）

```bash
LOCAL_API_ORIGIN=https://localhost:4567 npm run dev
```

4. 构建应用程序，为当前平台打包安装程序

```bash
LOCAL_API_ORIGIN=https://localhost:4567 npm run package
```

5. 构建应用程序，为所有平台打包安装程序

```bash
LOCAL_API_ORIGIN=https://localhost:4567 npm run package:all
```

### Web 服务 (开发模式)

```bash
LOCAL_API_ORIGIN=https://localhost:4567 npm run dev:web
```

### Web 服务 (正式、生产模式)

1. 构建

```bash
LOCAL_API_ORIGIN=https://localhost:4567 npm run build:web
```

2. 启动服务

```bash
npm run serve:web
```

## License

[LICENSE](./LICENSE)
