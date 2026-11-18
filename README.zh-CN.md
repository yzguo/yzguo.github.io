# 郭彦禛个人网站

**简体中文** | [English](README.md)

这是一个使用 VitePress 构建、以 Markdown 写作、发布在 GitHub Pages 上的中英双语个人网站。本 README 是唯一的开发入口，说明本地写作、增删页面/功能、工具与 AI、检查、安全和发布流程。

- English: <https://yzguo.github.io/>
- 简体中文: <https://yzguo.github.io/zh-cn/>

## 站点架构

站点是纯静态 VitePress 项目：英文内容位于 `docs/`，中文镜像位于 `docs/zh-cn/`，构建产物由 GitHub Pages 托管。所有浏览器运行时资源都由本站同源提供。

```text
.
├─ README.md
├─ README.zh-CN.md
├─ package.json
├─ ai-search.config.json
├─ docs/
│  ├─ index.md
│  ├─ About/
│  ├─ Projects/
│  ├─ Notes/
│  ├─ zh-cn/
│  ├─ public/
│  └─ .vitepress/
│     ├─ config.mts
│     ├─ shared.ts
│     ├─ en-us.ts
│     ├─ zh-cn.ts
│     ├─ head.ts
│     └─ theme/
├─ tools/
└─ .github/workflows/static.yml
```

`docs/Notes/` 是“笔记”区，公开 URL 使用 `/Notes/` 前缀，中文镜像使用 `/zh-cn/Notes/`。旧笔记 URL 不设重定向，旧书签和外部链接需要更新。`docs/.vitepress/config.mts` 组装两个 locale，`en-us.ts` 与 `zh-cn.ts` 分别维护可见导航、侧栏和对应语言的界面文案，`shared.ts` 放共享设置以及简体中文本地搜索翻译。

## 内容与导航

### 路径映射

每个英文页面位于 `docs/<path>`，中文对应页位于 `docs/zh-cn/<path>`，公开 URL 加 `/zh-cn/` 前缀。

| English | 中文 |
| --- | --- |
| `/`（`docs/index.md`） | `/zh-cn/`（`docs/zh-cn/index.md`） |
| `/About/` | `/zh-cn/About/` |
| `/Projects/` | `/zh-cn/Projects/` |
| `/Notes/` | `/zh-cn/Notes/` |
| `/Notes/<Category>/<page>` | `/zh-cn/Notes/<Category>/<page>` |

笔记目前分为 Courses、Learning、Work 三类，每类有索引页和演示页；两种语言保持相同的条目和结构。

### 增删或修改页面

新增页面时，以中文页为翻译源，保持两种语言同相对路径、同结构和同事实。

1. 在 `docs/zh-cn/...` 新建中文 Markdown；需要时添加 frontmatter。
2. 在 `docs/...` 新建英文对应页，或运行 `pnpm translate:docs:write` 生成后再审阅。
3. 在所属分类索引中加入链接；新分类或新顶级区还要同时更新两个语言的导航和侧栏。
4. 运行相应检查；确保标题、代码块、表格、事实、数字和链接在两种语言中一致。
5. 笔记区在两种语言中都使用 `docs/Notes/` 和 `/Notes/`；不得为旧笔记路由添加别名、重定向或重复页面。
6. 删除页面时，在同一次修改中删除中英文对应文件，并从分类索引及导航或侧栏移除链接；未经明确授权，不要删除用户内容。

### 导航与界面文案

两种语言的可见文案和链接结构必须条目数量一致、含义对应；中文界面不能出现英文占位文案。

- `docs/.vitepress/en-us.ts`：英文导航、侧栏和英文界面文案；英文本地搜索使用 VitePress 默认文案。
- `docs/.vitepress/zh-cn.ts`：中文导航、侧栏和中文界面文案；不要在此文件中维护搜索翻译。
- `docs/.vitepress/shared.ts`：两种语言共享的设置，以及简体中文本地搜索翻译（按钮、弹窗、无结果提示和键盘辅助标签）。
- `docs/index.md` 与 `docs/zh-cn/index.md`：保持对应的 hero 操作和功能卡片。
- 顶级入口、笔记分类和页面数量必须在同一次修改中于两种语言同步增删。

## 工具与 AI

### 工具目录

所有开发工具都在 `tools/`。原 `scripts/` 下的模块已按原 basename 全部迁入，不再保留 `scripts/` 目录或兼容 shim；不要新建第二套工具目录。`package.json` 的公开命令名保持不变，只把执行入口指向 `tools/`。

- `tools/ai-model.mjs`：本机模型适配器，负责配置校验、路径限制、超时和错误脱敏。
- `tools/ai-search.mjs`、`tools/ai-search-config.mjs`：开发服务器的 AI 搜索端点、公开开关和发布扫描。
- `tools/check-bilingual.mjs`：双语结构检查与模型语义审阅。
- `tools/translate-docs.mjs`：翻译命令行工具及其 Markdown、Mermaid、隐私和写入安全支持模块。
- `tools/*.test.mjs`：与实现同目录的行为测试。
- `tools/model-config.yaml`：被 Git 忽略的默认私有模型配置；仅本机模型适配器在运行时为认证读取。人和 agent 不得读取、打印、复制或提交它。

以下命令名是稳定接口；迁移内部实现时不要改名：

```sh
pnpm check:bilingual
pnpm translate:docs
pnpm translate:docs:write
pnpm translate:docs:force
pnpm test:bilingual
pnpm test:tools
```

### 本机 AI 搜索与开关

AI 搜索是可选的本机开发功能，不进入静态生产站点。唯一开关是根目录的公开、非敏感文件 `ai-search.config.json`：

```json
{
  "enabled": false
}
```

默认 `false`。要在本机启用，将 `enabled` 改为 `true` 并重启 `pnpm docs:dev`。启用后，问题和选中的公开页面摘录会发送给配置的模型服务；私有块、HTML 注释、草稿和非公开页面不会进入模型输入。接口只接受回环地址和同源 `Host`/`Origin`，界面提供取消按钮，错误和超时会明确显示。

本机适配器直接调用 OpenAI 兼容的模型 API，不需要 Oh My Pi（`omp`）可执行文件或认证网关。`pnpm docs:build` 无论开关写什么都会解析为 `false`；生产包只含布尔值 `false`，没有 AI 按钮、endpoint、适配器、配置对象或凭据。GitHub Pages 是纯静态托管，公开可用的 AI 必须另建有服务端凭据保护的后端，不能靠静态页面实现。

开发服务器的文件白名单只有 `docs/`、`docs/public/` 和 `node_modules/`；解析到 `tools/`、私有配置、`.env` 或白名单外的请求会被拒绝。构建会扫描可发布文档，发现私有配置或符号链接/junction 时停止。这些是纵深防御，不构成对已失陷本地账户或文件系统的绝对保证。

### 本机模型配置

本机模型适配器默认读取被 Git 忽略的 `tools/model-config.yaml`，或通过 `AI_MODEL_CONFIG` 指定仓库外或受允许的已忽略位置的安全私有 YAML/JSON 文件。配置格式为 YAML；`.json` 文件按 JSON 解析。下面的占位示例本身是有效的配置结构，不包含真实 endpoint 或凭据：

```yaml
providers:
  local:
    baseUrl: "https://model.example/v1"
    api: openai-completions
    apiKey: "<your-api-key>"
    models:
      - id: "<model-id>"
        name: "<model-name>"
        contextWindow: 32768
        maxTokens: 4096
        input: [text]
```

`api` 必须为 `openai-completions`（也接受 `openai-compatible`）。`baseUrl` 必须使用 HTTPS（本机回环地址可使用 HTTP），且不得包含凭据、查询参数或片段。每个模型的 `id` 必须唯一；`contextWindow` 与 `maxTokens` 为正整数，且 `maxTokens` 不得大于 `contextWindow`；`input` 若存在必须是非空字符串数组。`AI_MODEL`、`AI_MODEL_PROVIDER` 选择已配置的模型和服务商；`AI_REQUEST_TIMEOUT_MS` 默认 `300000` 毫秒，应低于浏览器 15 分钟硬上限。配置缺失、不可读或无效时直接失败，不会回退到环境变量密钥或 OMP。

仓库内只接受已忽略的私有位置：`tools/model-config.yaml`（也接受 `.yml` 或 `.json`）、根目录 `.env`/`.env.*`（`.env.example` 除外）、`tools/.env*`，以及 `tools/` 下匹配已忽略密钥模式的文件（`*.key`、`*.pem`、`*.secret.*`、`*.private.*`、`*.local.*`）。`docs/` 等可发布或未被忽略的仓库路径会被拒绝。旧默认私有配置路径不兼容，也没有兼容 shim；请始终以 `tools/model-config.yaml` 为默认。旧私有文件模式可能仍被忽略，仅用于防止误提交，不代表它受支持。不得提交私有配置，也不得把密钥放入受版本控制或可发布的路径。

**私钥规则：**`tools/model-config.yaml` 是用户的真实敏感文件。仅本机模型适配器可在运行时于本机读取它用于认证。人和 agent 不得读取、打印、复制、移动或提交它，也不得把其内容粘贴到文档、源码、Actions 或 AI 对话中；适配器不得泄露其内容。

## 本地开发

需要 Node.js 和 pnpm（版本由 `packageManager` 固定）。安装、开发、构建和预览：

```sh
pnpm install --frozen-lockfile
pnpm docs:dev
pnpm docs:build
pnpm docs:preview
```

`pnpm docs:dev` 同时提供两种语言。Markdown 支持 `$...$` 行内公式、`$$...$$` 块级公式和围栏 `mermaid` 图表；课程笔记演示页包含这三类示例。字体、公式和图表都在本机渲染，不从 CDN 加载。

### 网络需求与离线边界

所有浏览器运行时资源都由本站同源提供，不请求 CDN 或第三方运行时服务。这不等于整个应用可以完全离线：

- 访问已部署的站点需要连接其托管服务器；`pnpm docs:dev` 和 `pnpm docs:preview` 需要本地服务器。
- 首次 `pnpm install` 需要访问包仓库；在本地缓存不完整时重新安装也需要网络。
- 如果配置的是远端模型 API，AI 搜索和依赖模型的检查需要连通该 API。适配器在本机运行，但这不代表模型可以离线使用。

不得把站点或其 AI 功能描述为完全离线，也不得为了绕过网络限制而引入外部运行时资源。

## 资源、字体与渲染

所有浏览器运行时资源必须同源提供。CSP 在 `docs/.vitepress/head.ts` 中限制资源来源；字体放在 `docs/public/fonts/`，图片放在 `docs/public/images/`。不要引入 CDN、第三方字体或远程渲染服务；关于页的 GitHub、QQ、Telegram、Signal 是用户主动点击的外链，不属于运行时资源。

- 正文：本地 Noto Sans SC，同时覆盖中文和拉丁字符。
- 代码：本地 Latin Modern Mono。
- 公式：`markdown-it-mathjax3` 生成 MathJax SVG。
- 图表：`LocalMermaid.vue` 从本地依赖加载 Mermaid。
- 符号与表情：Nerd Fonts、Noto Emoji 和 Twemoji Mozilla。
- 许可证：字体授权文件位于 `docs/public/fonts/` 下，随站点一起发布。

翻译工具保留代码、公式和链接目标；对流程图、时序图和状态图的 Mermaid 标签按安全规则翻译，无法安全处理时报错而不写入。

## 检查与验收

主要检查命令如下：

| 命令 | 用途 |
| --- | --- |
| `pnpm check:bilingual` | 检查页面结构、导航/界面文案和翻译语义；调用配置的模型。 |
| `pnpm test:bilingual` | 翻译、双语检查、隐私、路径和写入安全的行为测试。 |
| `pnpm test:tools` | AI 适配器与 AI 搜索的行为测试。 |
| `pnpm docs:build` | 生成生产站点 `docs/.vitepress/dist`。 |

`pnpm check:bilingual` 会把配对页面和界面文案发送给配置的模型，应人工审阅其结论，不能当作翻译质量的证明。GitHub Actions 没有模型凭据，因此该检查只在本地或主验证阶段运行，不包含在部署 workflow 中。

人工验收至少覆盖：两种语言首页与导航、所有侧栏和笔记条目、桌面与手机宽度、浅色和深色主题、公式与 Mermaid、字体加载，以及生产构建中无 AI 和非本站运行时请求。

- 只报告实际运行过的命令、真实输出和覆盖范围；未运行的检查不得声称通过。
- 不得伪造内容、数据、截图或测试结果，也不得隐藏失败、警告或已知限制。
- 不得为了通过检查、减小体积或加快开发而降低隐私或安全保证，例如绕过路径校验、把密钥放进前端或引入外部运行时服务。
- 除非明确授权，保留现有公开 URL、用户内容和外部链接；不擅自改写个人事实。笔记区迁移是已授权的例外，因此旧笔记路由会被移除而不是保留。

## 隐私与数据安全

公开仓库中不得出现凭据、私有配置、草稿或未公开的个人数据。

- `tools/model-config.yaml` 必须保持被忽略、仅本机存在；仅本机模型适配器在运行时为认证读取，人和 agent 不得读取、打印、复制或提交它。
- `<!-- private:start -->` 与 `<!-- private:end -->` 只控制模型输入，不改变文件的可发布性；标记内的文字仍可能通过 Git 或 VitePress 公开。
- HTML 注释和私有块会从模型输入中移除；不要用它们存放密钥，也不要把密钥放进任何 Markdown。
- `ai-search.config.json` 只能包含公开布尔开关，不得写入 endpoint、密钥或其他敏感配置。
- 翻译工具在写入整批文件前验证结果并检查冲突；冲突检查不能代替备份。避免同时编辑目标文件，`translate:docs:force` 会覆盖已有英文页。
- 构建会拒绝可发布路径中的私有文件和符号链接/junction；开发服务器按白名单提供文件。发现异常应修复原因，不要关闭保护。

## 协作与文件归属

本仓库可能在共享工作树中由多个 agent 协作。每个独立功能单独指派一个子 agent，并给出明确的文件清单和验收标准；不要把同一文件同时交给多个 agent。

- 子 agent 只改自己负责的文件；需要共享文件时先问其 owner 或主 agent，不得跨范围修改。
- 不要 reset、checkout 或覆盖用户及其他 agent 的改动；不要删除不认识的用户数据。`tools/model-config.yaml` 必须保持本地、被忽略；仅本机模型适配器在运行时读取，人和 agent 不得读取、打印、复制或提交它。
- 子 agent 不在中途运行 build、test、lint 或 format；所有改动落地后由主 agent 统一验收并报告真实结果。
- 功能拆分为可独立验收的小块；新功能要有对应行为测试，测试放在 `tools/` 并与实现同目录。
- 结构和命令变化时同步更新两份 README；本 README 是唯一开发入口，不要创建平行的开发说明。
- 报告阻塞、风险或需要决策的事项；不要用进度汇报代替实际完成。

## 发布

推送到 `main` 会触发 `.github/workflows/static.yml`，安装依赖、构建站点并把 `docs/.vitepress/dist` 部署到 GitHub Pages。仓库 Pages 的发布来源必须设为 **GitHub Actions**。

- workflow 只运行安装、构建和部署，不运行模型检查，也不持有任何模型凭据。
- 生产构建始终关闭 AI 搜索，即使 `ai-search.config.json` 在本机为 `true`。
- 发布前确认检查通过、工作树中没有私有文件、没有未审阅的翻译覆盖。
- 部署后抽查两种语言的页面、导航、字体、公式和图表；站点不应请求非本站运行时资源。
