<p align="right">
  <a href="README.md">English</a> |
  <a href="./doc/README-CN.md">简体中文</a>
</p>

This is the repository for the Chatbox Community Edition, open-sourced under the GPLv3 license. For most users, I recommend using the Chatbox Official Edition (closed-source). It's still completely free, easy to install, and supports more of the latest features. You can get it below:

### Note

**This version is modified by `Jakit` for personal usage.**

#### Change

1. Disable all the online `Chatbox` service API.
2. Disable all the `Chatbox` commercial functionalities (UI components).
2. Optimized for local usage.

---

<h1 align="center">
<img src='./doc/statics/icon.png' width='30'>
<span>
    Chatbox
    <span style="font-size:8px; font-weight: normal;">(Community Edition)</span>
</span>
</h1>
<p align="center">
    <em>Your Ultimate AI Copilot on the Desktop. <br />Chatbox is a desktop client for ChatGPT, Claude and other LLMs, available on Windows, Mac, Linux</em>
</p>

<a href="./doc/statics/snapshot_light.png">
<img src="./doc/statics/snapshot_light.png" width="400"/>
</a>
<a href="./doc/statics/snapshot_dark.png">
<img src="./doc/statics/snapshot_dark.png" width="400"/>
</a>

## Features

-   **Local Data Storage**  
    :floppy_disk: Your data remains on your device, ensuring it never gets lost and maintains your privacy.

-   **No-Deployment Installation Packages**  
    :package: Get started quickly with downloadable installation packages. No complex setup necessary!

-   **Support for Multiple LLM Providers**  
    :gear: Seamlessly integrate with a variety of cutting-edge language models:

    -   OpenAI (ChatGPT)
    -   Azure OpenAI
    -   Claude
    -   Google Gemini Pro
    -   Ollama (enable access to local models like llama2, Mistral, Mixtral, codellama, vicuna, yi, and solar)
    -   ChatGLM-6B

-   **Image Generation with Dall-E-3**  
    :art: Create the images of your imagination with Dall-E-3.

-   **Enhanced Prompting**  
    :speech_balloon: Advanced prompting features to refine and focus your queries for better responses.

-   **Keyboard Shortcuts**  
    :keyboard: Stay productive with shortcuts that speed up your workflow.

-   **Markdown, Latex & Code Highlighting**  
    :scroll: Generate messages with the full power of Markdown and Latex formatting, coupled with syntax highlighting for various programming languages, enhancing readability and presentation.

-   **Prompt Library & Message Quoting**  
    :books: Save and organize prompts for reuse, and quote messages for context in discussions.

-   **Streaming Reply**  
    :arrow_forward: Provide rapid responses to your interactions with immediate, progressive replies.

-   **Ergonomic UI & Dark Theme**  
    :new_moon: A user-friendly interface with a night mode option for reduced eye strain during extended use.

-   **Team Collaboration**  
    :busts_in_silhouette: Collaborate with ease and share OpenAI API resources among your team. [Learn More](./team-sharing/README.md)

-   **Cross-Platform Availability**  
    :computer: Chatbox is ready for Windows, Mac, Linux users.

-   **Access Anywhere with the Web Version**  
    :globe_with_meridians: Use the web application on any device with a browser, anywhere.

-   **iOS & Android**  
    :phone: Use the mobile applications that will bring this power to your fingertips on the go.

-   **Multilingual Support**  
    :earth_americas: Catering to a global audience by offering support in multiple languages:

    -   English
    -   简体中文 (Simplified Chinese)
    -   繁體中文 (Traditional Chinese)
    -   日本語 (Japanese)
    -   한국어 (Korean)
    -   Français (French)
    -   Deutsch (German)
    -   Русский (Russian)
    -   Español (Spanish)

-   **And More...**  
    :sparkles: Constantly enhancing the experience with new features!

## FAQ

-   [Frequently Asked Questions](./doc/FAQ.md)

## Why I made Chatbox?

I developed Chatbox initially because I was debugging some prompts and found myself in need of a simple and easy-to-use prompt and API debugging tool. I thought there might be more people who needed such a tool, so I open-sourced it.

At first, I didn't know that it would be so popular. I listened to the feedback from the open-source community and continued to develop and improve it. Now, it has become a very useful AI desktop application. There are many users who love Chatbox, and they not only use it for developing and debugging prompts, but also for daily chatting, and even to do some more interesting things like using well-designed prompts to make AI play various professional roles to assist them in everyday work...

## How to Contribute

Any form of contribution is welcome, including but not limited to:

-   Submitting issues
-   Submitting pull requests
-   Submitting feature requests
-   Submitting bug reports
-   Submitting documentation revisions
-   Submitting translations
-   Submitting any other forms of contribution

## Build Instructions

### Ruby Environment

> Since API depends on `chatbox.ai` API, so I make a mock server to fill APIs

1. Install Ruby

#### For Windows:

1. Install ruby-2.3 from [RubyInstaller](https://github.com/oneclick/rubyinstaller/releases/download/ruby-2.3.3/ruby-2.3.3-x64-mingw32.7z)
2. Setup [devkit](https://github.com/oneclick/rubyinstaller/releases/download/devkit-4.7.2/DevKit-mingw64-64-4.7.2-20130224-1432-sfx.exe) for ruby-2.3

#### For Linux:

Install ruby from `apt-get` or other utilities

1. Install rbenv

```
sudo apt install git build-essential zlib1g-dev libffi-dev libyaml-dev libreadline-dev
git clone https://github.com/rbenv/rbenv.git ~/.rbenv
echo 'eval "$(~/.rbenv/bin/rbenv init - bash)"' >> ~/.bashrc
eval "$(~/.rbenv/bin/rbenv init - bash)"
git clone https://github.com/rbenv/ruby-build.git "$(rbenv root)"/plugins/ruby-build
```

2. Install ruby

```
rbenv install 2.3.8
# wait ...
rbenv global 2.3.8
```

#### For macOS:

1. Install Xcode

2. Install ruby dependencies

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

4. Install ruby

```
rbenv install 2.3.8
# wait ...
rbenv global 2.3.8
```

### Ruby API server setup

1. Install bundler

```bash
gem install bundler -v 1.17.3
```

2. Setup local API server

```bash
cd server
bundle install
ruby app.rb
```

Then you see server will run on port `http://localhost:4567`

You'd better install `nginx` to bind to a `url`

```
server {
  ...
  location /api/ {
    proxy_pass http://localhost:4567/api/
  }
}
```

### Build the App and run

1. Clone the repository from Github

```bash
git clone https://github.com/jakitliang/chatbox
```

2. Install the required dependencies

```bash
npm install
```

3. Start the application (in development mode)

> Note: `LOCAL_API_ORIGIN=https://localhost:4567` is important for API address

```bash
LOCAL_API_ORIGIN=https://localhost:4567 npm run dev
```

4. Build the application, package the installer for current platform

```bash
LOCAL_API_ORIGIN=https://localhost:4567 npm run package
```

5. Build the application, package the installer for all platforms

```bash
LOCAL_API_ORIGIN=https://localhost:4567 npm run package:all
```

### Web server (for develpment)

```bash
LOCAL_API_ORIGIN=https://localhost:4567 npm run dev:web
```

### Web server (for deployment)

1. Build the web application

```bash
LOCAL_API_ORIGIN=https://localhost:4567 npm run build:web
```

2. Start web server

```bash
npm run serve:web
```

## License

[LICENSE](./LICENSE)
