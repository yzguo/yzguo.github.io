# 郭彦禛个人网站

基于 VitePress 构建、使用 Markdown 写作的中英双语个人网站，通过 GitHub Pages 发布。

- English: <https://yzguo.github.io/>
- 简体中文: <https://yzguo.github.io/zh-cn/>

## 内容结构

- `docs/About/` 与 `docs/zh-cn/About/`：个人介绍与教育经历。
- `docs/Projects/` 与 `docs/zh-cn/Projects/`：项目索引与项目页面。
- `docs/Blogs/` 与 `docs/zh-cn/Blogs/`：课程、学习和工作笔记。

博客区分为 `Courses/`、`Learning/` 和 `Work/` 三个分类。每个分类都包含索引页和示例文章。可以复制示例文章的 Markdown 文件，替换为自己的笔记，并在分类索引中添加链接。内容增加后，可以继续建立子文件夹分类。

中文页面位于 `docs/zh-cn/`，英文页面放在 `docs/` 下相同的相对路径。本地翻译工具以中文页面为源。

## 本地开发

需要 Node.js 和 pnpm：

```sh
pnpm install --frozen-lockfile
pnpm docs:dev
```

本地翻译、双语检查和 AI 搜索使用 `tools/ai-model.mjs` 中的本机模型适配器，不再需要 Oh My Pi（`omp`）可执行文件或认证网关。

使用 `pnpm docs:build` 构建生产网站，使用 `pnpm docs:preview` 预览构建结果。运行 `pnpm check:bilingual` 检查页面结构、导航和界面文案以及翻译语义的一致性；检查会将中英文页面及界面内容发送给配置的模型，应人工审阅模型结果，而不应将其视为翻译质量的证明。

### AI 搜索（仅限本机）

AI 搜索由唯一一个公开、非敏感的配置文件 `ai-search.config.json` 控制：

```json
{
  "enabled": false
}
```

默认值为 `false`。如要在本机使用，将 `"enabled"` 改为 `true` 并重新启动 `pnpm docs:dev`。启用后，AI 按钮使用站内公开内容和本机配置的模型回答问题；问题和选中的公开页面摘录会发送到该模型服务。私有块、HTML 注释、草稿和非公开页面不会进入模型输入。接口只接受回环地址且 `Host`、`Origin` 与同源请求一致的客户端，界面提供取消按钮以中止请求。

`pnpm docs:build` 始终关闭 AI 搜索，即使配置文件写着 `true`。生产包只包含解析后的布尔值 `false`，不包含 AI 按钮、服务端 endpoint、模型适配器、配置对象或凭据。GitHub Pages 是纯静态托管，发布后的网站保留普通本地搜索，不会调用本机或远端模型。如需在公开网站使用 AI，必须另外部署安全的服务端后端并在服务端保管凭据；仅靠静态 GitHub Pages 无法做到。

开发服务器的文件白名单仅包含 `docs/`、`docs/public/` 和 `node_modules/`。即使 AI 搜索关闭，请求解析到 `tools/`、私有模型配置、`.env` 或密钥材料，或解析到这些根目录之外时，也会被请求 guard 拒绝。这些是纵深防御措施，不能保证在本地账户或文件系统已被攻陷时仍然安全。

### 本机模型配置

本机模型适配器读取被 Git 忽略的 YAML 文件 `tools/api-key.txt`，或通过 `AI_MODEL_CONFIG` 指定、位于下列允许位置的私有 JSON/YAML 文件。格式如下：

```yaml
providers:
  local:
    baseUrl: "<provider-base-url>"
    api: openai-completions
    apiKey: "<local-secret>"
    models:
      - id: "<model-id>"
        name: "<model-name>"
        contextWindow: "<context-window-tokens>"
        maxTokens: "<max-output-tokens>"
        input: [text]
```

所有尖括号内容均为占位示例，不构成对任何具体服务的声明。尤其是 `contextWindow` 和 `maxTokens`，必须替换为实际配置的服务商/模型所报告的值；请以实际服务为准。

`AI_MODEL_CONFIG` 按进程工作目录（通常即仓库根目录）解析。仓库外路径允许使用。仓库内路径按真实路径（含符号链接/junction）校验，仅允许：

- 默认的 `tools/api-key.txt`；
- `tools/` 直接子文件中名为 `api-key.*`、`*.key`、`*.pem`、`*.secret.*`、`*.private.*`、`*.local.*` 或 `.env*` 的文件；
- 仓库根目录的 `.env` 或 `.env.*`，但 `.env.example` 除外。

仓库内其他路径会被配置校验拒绝。`docs/`（含 `docs/public/`）即使通过符号链接/junction 解析进入也会被排除。开发服务器会拒绝解析到这些位置的请求；生产构建会在发布前扫描文档，并在检测到配置的私有文件或符号链接时停止。这些是纵深防御措施，不构成绝对保证。

上下文窗口和输出上限取决于具体服务，而不只是模型名称。服务商公开文档与转发端点的报告可能不同，因此适配器采用本地配置中声明的 `contextWindow` 与 `maxTokens`，并施加自身保守的提示和输出上限。仅就上下文信息而言，DeepSeek [公开文档](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/)将 `deepseek-flash` 标为 DeepSeek-V4.1-Flash-1017，上下文 1M、最大输出 384K；转发端点的模型元数据可能只提供最大输出值而不提供上下文窗口。转发服务的实际上下文上限尚未独立核实，这些公开数字并不构成对任何其他端点或配置的保证。

`api` 必须为 `openai-completions`（也接受 `openai-compatible`）。不要提交被忽略的配置文件，也不要把真实的 endpoint 或密钥写入文档、源码或 GitHub Actions。`AI_MODEL` 和 `AI_MODEL_PROVIDER` 用于选择已配置的模型与服务商。`AI_REQUEST_TIMEOUT_MS` 以毫秒设置模型超时（默认 `300000`，即 300 秒）；AI 搜索会把同一个整数超时传给适配器，因此正常超时会在大约 300 秒时明确报错。浏览器另设 15 分钟的有限硬上限，用于防止开发服务器挂死；请让 `AI_REQUEST_TIMEOUT_MS` 保持在该上限以下。界面不会无限等待，也不会隐藏超时错误。配置缺失、不可读或无效时会直接失败，不会回退到环境变量密钥或 OMP。

## 本地翻译

```sh
pnpm translate:docs
pnpm translate:docs:write
pnpm translate:docs:force
pnpm check:bilingual
```

第一条命令只列出中文源文件和英文目标，不写文件，也不调用模型。第二条生成缺失的英文文件；第三条会明确覆盖已有英文文件，请仔细审阅更改。最后一条检查双语页面和界面文案。翻译工具会在写入整批文件前验证每个生成结果。运行时请避免同时编辑目标文件；冲突检查不能代替备份。

工具还会将 `README.zh-CN.md` 映射到 `README.md`，并将根目录中文文件名的 Markdown 映射到对应的 `.en.md` 文件。英文文件中出现中文人名不会使其被当作中文源文件。

程序代码、公式和链接目标会原样保留。流程图、时序图和状态图中的 Mermaid 标签会被翻译；无法安全翻译的图表会报错，不会写入。发布前请审阅生成的译文。

翻译和检查工具使用同一个本机模型适配器，不会将模型配置或凭据复制到仓库或 GitHub Actions。翻译或检查所需的文字会发送到配置的模型服务；HTML 注释和显式标记的私有块不会发送给模型。两个命令都接受 `--timeout <milliseconds>`（毫秒）；`pnpm check:bilingual` 还接受 `--root <directory>`（目录）。

私有块使用 `<!-- private:start -->` 和 `<!-- private:end -->` 包围；如果没有闭合，工具会报错，而不会发送块内内容。

这些标记只控制模型输入：标记内的文字仍保留在源文件中，可能通过 Git 或 VitePress 公开。不要将凭据或未公开的私人数据放入准备提交到公开仓库的文件。

## 自动部署

推送到 `main` 会触发 `.github/workflows/static.yml`，构建网站并将 `docs/.vitepress/dist` 发布到 GitHub Pages。仓库 Pages 的发布来源需设置为 **GitHub Actions**。

Markdown 支持 LaTeX 数学公式和 Mermaid 图表，课程笔记演示文章中有示例。字体和渲染资源由本站提供，不从 CDN 加载。

中英文普通正文均使用本地部署的 Noto Sans SC。代码使用 Latin Modern Mono，公式保留 MathJax 默认 SVG 字形。符号字形使用 Nerd Fonts；由于 Nerd Fonts 不覆盖标准表情，表情使用本地部署的 Noto Emoji 和 Twemoji Mozilla 字体。
