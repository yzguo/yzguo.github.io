# 郭彦禛个人网站

[English](README.md) | **简体中文** | [繁體中文](README.zh-TW.md)

一个使用 VitePress 构建、以 Markdown 写作、发布在 GitHub Pages 上的个人网站。站点提供英语、简体中文和繁体中文三个版本，三者的结构、事实与内容覆盖一致。本 README 是唯一的开发入口，说明安装、写作、翻译、配置、检查、安全与发布流程。

- English: <https://yzguo.github.io/en/>
- 简体中文: <https://yzguo.github.io/zh-cn/>
- 繁體中文: <https://yzguo.github.io/zh-tw/>
- 语言入口（自动选择）: <https://yzguo.github.io/>

## 站点架构

站点是纯静态 VitePress 项目。每种语言版本位于独立目录，并由对应的公开 URL 提供。所有浏览器运行时资源都由本站同源提供。

```text
.
├─ README.md
├─ README.zh-CN.md
├─ README.zh-TW.md
├─ package.json
├─ config.json
├─ docs/
│  ├─ index.md
│  ├─ en/
│  ├─ zh-cn/
│  ├─ zh-tw/
│  ├─ public/
│  └─ .vitepress/
│     ├─ config.mts
│     ├─ shared.ts
│     ├─ en-us.ts
│     ├─ zh-cn.ts
│     ├─ zh-tw.ts
│     ├─ head.ts
│     └─ theme/
├─ tools/
└─ .github/workflows/static.yml
```

`docs/zh-cn/` 是翻译源；`docs/en/` 与 `docs/zh-tw/` 在相同相对路径存放英语和繁体中文版本。`docs/index.md` 是根入口，按浏览器首选语言打开对应版本，不包含正文。`docs/.vitepress/config.mts` 组装三个语言版本；`en-us.ts`、`zh-cn.ts`、`zh-tw.ts` 分别维护可见导航、侧栏和对应语言的界面文案；`shared.ts` 保存三个版本共享的设置，以及 `en`、`zh-cn`、`zh-tw` 三语的本地搜索界面文案。

## 语言路由

根 URL 自动按浏览器首选语言打开对应版本：

- `zh-TW`、`zh-HK`、`zh-MO` 或 `zh-Hant` → `/zh-tw/`
- 其他 `zh` 语言 → `/zh-cn/`
- 英语及所有其他语言 → `/en/`

自动选择只在根路径执行，且仅在客户端进行，不使用服务器重定向。浏览器没有可用的语言偏好或禁用 JavaScript 时，站点默认进入英文版。访客无需选择语言，也不会看到语言选择页。启用 JavaScript 时会保留查询字符串和片段；无 JavaScript 的回退不会保留。明确的语言路径（`/en/`、`/zh-cn/`、`/zh-tw/`）和导航菜单中的语言切换保持可用，且不会被覆盖。路由不依赖外部浏览器资源。

## 内容与翻译

简体中文是翻译源：`README.zh-CN.md` 是 `README.md` 和 `README.zh-TW.md` 的源文件，`docs/zh-cn/` 是 `docs/en/` 和 `docs/zh-tw/` 的源文件。

### 路径映射

`/` 是语言入口，自动进入浏览器首选语言对应的版本（`docs/index.md`）。每个内容页在三个版本的 `docs/en/`、`docs/zh-cn/` 或 `docs/zh-tw/` 下各有一份相同相对路径的文件，公开 URL 使用对应前缀。

| 栏目 | 简体中文（源） | 英语 | 繁体中文 |
| --- | --- | --- | --- |
| 首页 | `/zh-cn/`（`docs/zh-cn/index.md`） | `/en/`（`docs/en/index.md`） | `/zh-tw/`（`docs/zh-tw/index.md`） |
| 关于 | `/zh-cn/About/` | `/en/About/` | `/zh-tw/About/` |
| 项目 | `/zh-cn/Projects/` | `/en/Projects/` | `/zh-tw/Projects/` |
| 笔记 | `/zh-cn/Notes/` | `/en/Notes/` | `/zh-tw/Notes/` |
| 笔记页面 | `/zh-cn/Notes/<Category>/<page>` | `/en/Notes/<Category>/<page>` | `/zh-tw/Notes/<Category>/<page>` |

笔记分为课程、学习、工作三类，每类都有索引页和演示页，三种语言保持相同条目和结构。

### 新增或修改页面

三种语言保持相同的相对路径、标题结构、事实、数学、代码和链接语义。

1. 在 `docs/zh-cn/...` 下新增或修改简体中文 Markdown；需要时添加 frontmatter。
2. 运行 `pnpm translate:docs:write` 生成英语和繁体中文对应页，或直接编辑；审阅每个生成结果。
3. 在所属分类索引中加入链接；新分类或新顶级栏目要同时更新三个语言版本的导航和侧栏。
4. 运行一致性检查；标题、代码块、表格、事实、数字、数学和链接目标必须对应。站内链接在各自版本中使用 `/en/`、`/zh-cn/` 或 `/zh-tw/`。
5. 删除页面时，在同一次修改中删除三个版本的文件及所有链接；未经明确授权，不要删除用户内容。

### 导航与界面文案

三种语言的可见文案和链接结构必须条目数量一致、含义对应；任何版本都不能出现占位文案。

- `docs/.vitepress/en-us.ts`：英文导航、侧栏和英文界面文案。
- `docs/.vitepress/zh-cn.ts`：简体中文导航、侧栏和界面文案。
- `docs/.vitepress/zh-tw.ts`：繁体中文导航、侧栏和界面文案。
- `docs/.vitepress/shared.ts`：三个版本共享的设置，以及 `en`、`zh-cn`、`zh-tw` 三语的本地搜索界面文案；英文文案与 VitePress 默认值一致。
- `docs/en/index.md`、`docs/zh-cn/index.md` 与 `docs/zh-tw/index.md`：保持对应的 hero 操作和功能卡片。
- 顶级栏目、笔记分类和页面数量必须在同一次修改中于三个语言版本同步增删。

## 工具与配置

所有开发工具都在 `tools/`；不要新建第二套工具目录。`package.json` 中的公开命令名是稳定接口，修改内部实现时不得改名。

```sh
pnpm translate:docs
pnpm translate:docs:write
pnpm translate:docs:force
pnpm check:multilingual:structure
pnpm check:multilingual
pnpm test:multilingual
```

- `pnpm translate:docs`：只读列出简体中文源及其英语、繁体中文目标；不写文件，也不调用模型。
- `pnpm translate:docs:write`：只创建缺失目标。英语页面由配置的本机模型翻译；繁体中文页面由本机 OpenCC 离线转换；已有目标不会被覆盖。审阅每个生成文件。
- `pnpm translate:docs:force`：按相同规则重新生成已有英语和繁体中文目标并覆盖它们。
- `pnpm check:multilingual:structure`：只运行第一阶段（等价 CLI：`node tools/check-multilingual.mjs --structure-only`）。它确定性地检查三个版本中每个页面、README 和可见界面文案的语言覆盖、结构、代码、数学、Mermaid、链接和配置，完成后直接退出，不调用模型。它不需要模型配置、凭据或网络。
- `pnpm check:multilingual`：严格按顺序运行两个阶段。第一阶段完整通过后，第二阶段才会把清理后的配对内容发送给配置的模型做语义审阅。第一阶段有任何错误都意味着零次模型请求。
- `pnpm test:multilingual`：翻译、两阶段多语言检查、隐私、路径和写入安全的行为测试，包括第一阶段失败时绝不调用模型。

翻译命令接受 `-- --lang en|zh-tw` 或 `-- --only <path>` 以缩小范围。翻译保留代码、公式、数字和 URL 目标；流程图、时序图和状态图的 Mermaid 标签按安全规则翻译，无法安全处理时整批报错且不写入。

- `tools/check-multilingual.mjs`：两阶段多语言检查器。
- `tools/translate-docs.mjs`：翻译命令行入口。
- `tools/document-model.mjs`、`tools/markdown-safety.mjs` 与 `tools/semantic-safe.mjs`：文档配对与结构、Markdown 隐私与写入安全、语义审阅投影。
- `tools/traditional-chinese.mjs` 与 `tools/mermaid-translate.mjs`：OpenCC 转换检查和安全的 Mermaid 标签翻译。
- `tools/ai-model.mjs` 与 `tools/ai-search.mjs`：本机模型适配器和仅用于开发服务器的 AI 搜索端点。
- `tools/site-config.mjs`：读取并校验根目录公开的 `config.json`；它绝不读取私有模型配置。
- `tools/config.yaml`：唯一的默认私有工具配置；仅本机模型适配器在运行时为认证和工具默认值读取它。
- `tools/*.test.mjs`：与实现同目录的行为测试。

### 公开站点配置

可选站点功能统一由根目录的公开、非敏感文件 `config.json` 配置。它只能包含已公开的开关；未知字段会被拒绝，且绝不能包含 endpoint、凭据、令牌或个人数据。

```json
{
  "aiSearch": {
    "enabled": false
  },
  "performance": {
    "prefetchLinks": false
  }
}
```

AI 搜索是可选的本机开发功能，不进入静态生产站点。它默认关闭；要使用它，将 `aiSearch.enabled` 改为 `true` 并重启 `pnpm docs:dev`。问题和选中的公开页面摘录会发送给配置的模型服务；私有块、HTML 注释、草稿和非公开页面不会进入模型输入。接口只接受来自回环地址且 `Host`/`Origin` 与本站同源匹配的客户端；界面提供取消按钮，错误和超时会明确显示。

`performance.prefetchLinks` 控制 VitePress 的链接预取。默认 `false` 避免首屏预取其他语言版本的页面，从而减少初始请求；设为 `true` 可能加快后续导航，但会增加首屏请求，请按需取舍。

适配器直接调用 OpenAI 兼容的模型 API。无论文件内容如何，`pnpm docs:build` 都把开关解析为 `false`，因此生产包不含 AI 按钮、endpoint、适配器、配置对象或凭据。GitHub Pages 是纯静态托管；公开可用的 AI 必须另建有服务端凭据保护的后端。开发服务器只提供 `docs/`、`docs/public/` 和 `node_modules/`，构建会拒绝可发布路径中的私有文件或符号链接/junction。这些是纵深防御，不构成对已失陷本地账户或文件系统的绝对保证。

### 私有工具配置

`tools/config.yaml` 是本机工具唯一的默认私有配置。它被 Git 忽略、仅本机存在，绝不会被服务、打包或发布。它同时保存模型目录和工具默认值：默认服务商、默认模型、请求超时和默认输出上限。仓库内没有第二份逐工具配置文件。

```yaml
# Default provider key from `providers` (optional; otherwise the built-in default when present, then the first).
provider: local
# Default model id (or display name) within that provider (optional; otherwise the first model).
model: example-model
# Model request timeout in milliseconds (optional; default 300000).
timeoutMs: 300000
# Default max output tokens per request (optional; default 16384).
maxOutputTokens: 16384

providers:
  local:
    baseUrl: "https://model.example/v1"
    api: openai-completions
    apiKey: "<your-api-key>"
    models:
      - id: example-model
        name: Example Model
        contextWindow: 32768
        maxTokens: 4096
        input: [text]
        # optional: reasoningEffort: none|low|medium|high|max|null (also allowed on the provider)
```

`provider` 与 `model` 选择默认值；省略时，适配器优先使用已配置的内置默认服务商，其次使用第一个服务商，并使用该服务商的第一个模型。`timeoutMs` 与 `maxOutputTokens` 是可选正整数，默认值如上。每次运行可用环境变量覆盖：`AI_MODEL_CONFIG` 指向另一份私有 YAML/JSON 文件，`AI_MODEL` 与 `AI_MODEL_PROVIDER` 选择模型和服务商，`AI_REQUEST_TIMEOUT_MS` 设置超时。配置缺失、不可读或无效时直接失败，不会使用伪造回退。

`providers` 把服务商名称映射到其设置。`api` 必须为 `openai-completions` 或 `openai-compatible`。`baseUrl` 必须使用 HTTPS（本机回环地址可使用 HTTP），且不得包含凭据、查询参数或片段。每个模型的 `id` 必须唯一；`contextWindow` 与 `maxTokens` 若存在必须为正整数，且 `maxTokens` 不得大于 `contextWindow`；`input` 若存在必须是非空字符串数组。`reasoningEffort` 如使用，只能是 `none`、`low`、`medium`、`high`、`max` 或 null。

**私钥规则：**`tools/config.yaml` 以及 `AI_MODEL_CONFIG` 指定的文件是用户的真实敏感配置。仅本机模型适配器可在运行时于本机读取它们用于认证。人和 agent 不得读取、打印、复制、移动或提交它们，也不得把其内容粘贴到文档、源码、Actions 或 AI 对话中；适配器不得泄露它们。备用文件必须位于仓库外或已忽略的私有位置，绝不能放在 `docs/` 或其他可发布路径。绝不能用占位值覆盖已有的私有配置文件。

## 本地开发

需要 Node.js 和 pnpm（pnpm 版本由 `packageManager` 固定）。安装、开发、构建和预览：

```sh
pnpm install --frozen-lockfile
pnpm docs:dev
pnpm docs:build
pnpm docs:preview
```

`pnpm docs:dev` 提供三个版本，包括根入口。Markdown 支持 `$...$` 行内公式、`$$...$$` 块级公式和围栏 `mermaid` 图表；课程笔记演示页包含这三类示例。字体、公式和图表都在本机渲染，不从 CDN 加载。

### 网络需求与离线边界

所有浏览器运行时资源都由本站同源提供，不请求 CDN 或第三方运行时服务。这不等于整个应用可以完全离线：

- 访问已部署的站点需要连接其托管服务器；`pnpm docs:dev` 和 `pnpm docs:preview` 需要本地服务器。
- 首次 `pnpm install` 需要访问包仓库；在本地缓存不完整时重新安装也需要网络。
- 如果配置的是远端模型 API，AI 搜索、英语翻译和依赖模型的检查需要连通该 API。适配器在本机运行，但这不代表模型可以离线使用。

网络传输时间取决于访问者的网络和托管服务；站点不保证任何加载耗时或单项资源时延。

不得把站点或其 AI 功能描述为完全离线，也不得为了绕过网络限制而引入外部运行时资源。

## 资源、字体与渲染

所有浏览器运行时资源必须同源提供。CSP 在 `docs/.vitepress/head.ts` 中限制资源来源；字体放在 `docs/public/fonts/`，图片放在 `docs/public/images/`。正文使用本地 Noto Sans SC，代码使用 Latin Modern Mono，公式使用 `markdown-it-mathjax3` 生成的 MathJax SVG，图表由本地加载的 Mermaid 绘制，符号与表情使用 Nerd Fonts、Noto Emoji 和 Twemoji Mozilla。字体授权文件随站点放在 `docs/public/fonts/` 下。不要引入 CDN、第三方字体或远程渲染服务；关于页的 GitHub、QQ、Telegram、Signal 是用户主动点击的外链，不属于运行时资源。

翻译工具保留代码、公式和链接目标；对流程图、时序图和状态图的 Mermaid 标签按安全规则翻译，无法安全处理时报错而不写入。

## 检查与验收

主要检查命令如下：

| 命令 | 用途 |
| --- | --- |
| `pnpm check:multilingual:structure` | 只做第一阶段确定性检查：完整的语言覆盖、页面与 README 结构、代码、数学、Mermaid、链接、繁体中文转换和界面文案。不需要模型配置或凭据。 |
| `pnpm check:multilingual` | 两个阶段：第一阶段必须完整通过，第二阶段才可调用模型做语义审阅。第一阶段有任何错误都意味着零次模型请求。 |
| `pnpm test:multilingual` | 翻译、两阶段多语言检查、隐私、路径和写入安全的行为测试。 |
| `pnpm docs:build` | 生成生产站点 `docs/.vitepress/dist`。 |

第一阶段枚举三个文档目录、根目录三份 README、其他受支持的根目录中文文档，以及从 `en-us.ts`、`zh-cn.ts`、`zh-tw.ts` 加载的可见界面文案。它检查路径、标题层级、段落、列表和引用结构、表格、代码围栏、数学、Mermaid 结构、链接目标与语言前缀、未转换的繁体中文、导航、侧栏、frontmatter、受保护内容和配置，并收集全部错误而不是在第一个错误处停止。文件不可读、隐私失败和配置失败同样计为第一阶段错误。`docs/index.md` 是根入口，不参与配对。

只有第一阶段没有任何错误时才运行第二阶段。它把清理后的配对页面内容和界面文案发送给配置的模型，逐页面做语义审阅；语义失败会以非零结果返回。模型输出只是审阅辅助，不能当作翻译质量的证明；请阅读结论，不要把语义失败当成通过。完整命令需要可用的私有模型配置，而 `pnpm check:multilingual:structure` 既不需要凭据，也不需要网络。

人工验收至少覆盖：三个版本的首页、导航、侧栏和笔记条目；根路径针对繁体中文、其他中文、英语及其他语言的自动选择；禁用 JavaScript 或浏览器未提供语言时根路径回退到英文；明确语言路径和导航菜单中的语言切换保持生效；桌面与手机宽度；浅色和深色主题；数学公式与 Mermaid；字体加载；以及无 AI、无本站以外运行时请求的生产构建。

冷缓存验收是目标而非保证：在访客网络、GitHub Pages 和浏览器条件允许时，全新、无缓存的浏览器首次加载每个版本的资源应低于 1 秒。部署后必须等 CI/CD workflow 完成，再用全新的浏览器配置、空缓存（或禁用缓存）测试线上站点，并报告真实测量结果和条件。不得伪造、挑选或隐藏耗时数据。

- 只报告实际运行过的命令、真实输出和覆盖范围；未运行的检查不得声称通过。
- 不得伪造内容、数据、截图或测试结果，也不得隐藏失败、警告或已知限制。
- 不得为了通过检查、减小体积或加快开发而降低隐私或安全保证，例如绕过路径校验、把密钥放进前端或引入外部运行时服务。
- 除非明确授权，保留现有公开 URL、用户内容和外部链接；不擅自改写个人事实。

## 隐私与数据安全

公开仓库中不得出现凭据、私有配置、草稿或未公开的个人数据。

- 根目录 `config.json` 只能包含公开、非敏感开关。不得加入 endpoint、密钥、令牌或私有服务商设置；未知字段会被拒绝。
- `tools/config.yaml` 必须保持被忽略、仅本机存在。仅本机模型适配器在运行时为认证读取它；人和 agent 不得读取、打印、复制或提交它。
- 私有块标记 `<!-- private:start -->` 与 `<!-- private:end -->` 只控制模型输入，不改变文件的可发布性；标记内的文字仍可能通过 Git 或 VitePress 公开。
- HTML 注释和私有块会从模型输入中移除；不要用它们存放密钥，也不要把密钥放进任何 Markdown。
- 翻译工具在写入整批文件前验证结果并检查冲突；冲突检查不能代替备份。避免同时编辑目标文件，`translate:docs:force` 会覆盖已有英语和繁体中文页面。
- 构建会拒绝可发布路径中的私有文件和符号链接/junction；开发服务器只按白名单提供文件。发现异常应修复原因，不要关闭保护。

## 协作与文件归属

本仓库可能在共享工作树中由多个 agent 协作。每个独立功能单独指派一个子 agent，并给出明确的文件清单和验收标准；不要把同一文件同时交给多个 agent。

- 子 agent 只改自己负责的文件；需要共享文件时先问其 owner 或主 agent，不得跨范围修改。
- 不要 reset、checkout 或覆盖用户及其他 agent 的改动；不要删除不认识的用户数据。`tools/config.yaml` 必须保持本地、被忽略；仅本机模型适配器在运行时读取，人和 agent 不得读取、打印、复制或提交它。
- 子 agent 不在中途运行 build、test、lint 或 format；所有改动落地后由主 agent 统一验收并报告真实结果。
- 功能拆分为可独立验收的小块；新功能要有对应行为测试，测试放在 `tools/` 并与实现同目录。
- 结构和命令变化时同步更新三份 README；本 README 是唯一开发入口，不要创建平行的开发说明。
- 报告阻塞、风险或需要决策的事项；不要用进度汇报代替实际完成。

## 部署

推送到 `main` 会触发 `.github/workflows/static.yml`，安装依赖、构建站点并把 `docs/.vitepress/dist` 部署到 GitHub Pages。仓库 Pages 的发布来源必须设为 **GitHub Actions**。

- workflow 只运行安装、构建和部署，不运行模型检查，也不持有任何模型凭据。
- 生产构建始终关闭 AI 搜索，即使 `config.json` 在本机为 `true`。
- 发布前确认检查通过、工作树中没有私有文件、没有未审阅的翻译覆盖。
- 部署后等 workflow 完成，再抽查三个版本的页面、导航、字体、公式和图表；站点不应请求非本站运行时资源。
- 然后用全新的浏览器配置和空缓存执行冷缓存测试，并报告真实结果；不得承诺或伪造固定加载时间。
