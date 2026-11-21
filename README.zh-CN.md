# 郭彦禛个人网站

[English](README.md) | **简体中文** | [繁體中文](README.zh-TW.md)

这是一个以 Markdown 写作、使用 VitePress 构建、发布在 GitHub Pages 上的个人网站。站点有英语、简体中文和繁体中文三个版本，结构、事实与内容覆盖一致。你只需在 `docs/zh-cn/` 下写简体中文；`pnpm content:sync` 会生成英语和繁体中文版本，导航和侧栏则由内容目录自动生成。不要手工维护三份副本。

- English: <https://yzguo.github.io/en/>
- 简体中文: <https://yzguo.github.io/zh-cn/>
- 繁體中文: <https://yzguo.github.io/zh-tw/>
- 语言入口（自动选择）: <https://yzguo.github.io/>

## 快速开始

需要 Node.js 和 pnpm；pnpm 版本由 `packageManager` 固定。

```sh
pnpm install --frozen-lockfile
pnpm content:sync
pnpm docs:dev
```

`content:sync` 需要下文所述的私有模型配置。一切已同步时，它不会调用模型，也不会改动文件。

## 只写简体中文

工作流程：修改一个简体中文页面，运行 `pnpm content:sync`，用 `pnpm docs:dev` 预览，然后提交简体中文源、两个生成版本和状态清单。

`docs/zh-cn/` 是唯一的内容源。每个页面按相对路径映射到 `docs/en/` 和 `docs/zh-tw/`，以及对应的公开 URL：

| 简体中文（源） | 英语 | 繁体中文 |
| --- | --- | --- |
| `docs/zh-cn/Notes/Courses/demo.md` | `docs/en/Notes/Courses/demo.md` | `docs/zh-tw/Notes/Courses/demo.md` |
| `/zh-cn/Notes/Courses/demo` | `/en/Notes/Courses/demo` | `/zh-tw/Notes/Courses/demo` |

### 目录与索引页

- 把页面放进它所属的目录。读者需要作为栏目浏览的目录应有一个 `index.md` 作为栏目首页。目录 URL 以 `/` 结尾；普通页面 URL 去掉 `.md`。
- 如果目录里已有 Markdown 但没有 `index.md`，`content:sync` 会生成一个最小的简体中文索引及其两个译本。已有的 `index.md` 绝不会被覆盖，你可以自行修改它的标题和引言。
- 只有当简体中文、英语和繁体中文三个页面都存在、可读，且都没有标记 `draft: true` 或 `private: true` 时，条目才会出现在导航和列表中；否则三个版本会同时隐藏该条目。

### 文件名与标题

- 文件名和目录名会成为公开 URL。请使用简短、稳定、不含空格的 ASCII 名称；小写单词加连字符最稳妥。以 `.` 开头的名称不会进入导航，`index.md` 保留给目录首页。
- 导航和页面标题依次取自 frontmatter 中的 YAML `title`、第一个可见的一级标题（忽略 HTML 注释、私密块和代码围栏中的标题）、路径名。
- 每个页面开头写一个明确的一级标题。重命名文件或目录会改变公开 URL，因此已发布的名称应尽量保持稳定。
- frontmatter 中可选的数字 `order` 决定排序（越小越前）；未标记的条目按相对路径排序。关于、项目、笔记保持现有的顶级顺序，新的顶级栏目排在笔记之后。

### 内容与链接

- 按普通 VitePress Markdown 写作。源文件中的站内链接使用 `/zh-cn/...`；生成的版本会得到对应的 `/en/...` 和 `/zh-tw/...` 链接。
- 翻译会保留代码块、行内代码、公式、数字、frontmatter、URL 和 Mermaid 结构。读者可见的 Mermaid 标签会在安全规则下翻译。
- 笔记索引页用 `<NotesIndex />` 自动列出子页面，包含标题和简短摘要（frontmatter `description` 或首段）。保留该组件和引言文字，不要手动添加条目链接。新增页面和分类不需要改任何 TypeScript 或索引列表：重启 `pnpm docs:dev` 或重新构建即可刷新导航和侧栏；笔记列表在开发模式下还会热更新。
- 用 `draft: true` 或 `private: true` 可把页面从导航和列表中隐藏；给某个栏目的 `index.md` 加上这些字段会隐藏整棵子树。这些字段只影响导航和列表，不影响 Git 或 VitePress 构建，所以绝不要把密钥或真正私密的内容放进 `docs/`。未翻译、不可读或 YAML 损坏的页面同样不会进入导航。
- 不要编辑 `docs/en/`、`docs/zh-tw/` 或 `docs/.vitepress/navigation.*`。修改简体中文源后重新运行 `content:sync`。

## `content:sync` 的工作方式

- 用配置的模型把新增或修改过的简体中文页面翻译成英语和繁体中文。两个版本都是真正的 AI 翻译；OpenCC 只辅助繁体用字校正。
- 为 `docs/zh-cn` 页面（不含根目录 README）记录一份可提交的 `tools/content-sync-state.json`（版本 1）和 SHA-256 内容哈希，未变化的源会被跳过，不会重复调用模型。清单只含路径、哈希和自动索引标记，不含页面内容或凭据。
- 只有当目标由工具生成、且其哈希仍与记录的基线一致时才更新。手工改过的目标、没有可信基线的目标，或并发变更，都会被拒绝并以退出码 1 报告；不会悄悄覆盖。恢复时从版本控制还原目标（或删除目标后重跑），再同步一次；不要手工合并生成页面。
- 清单缺失时，工具先对现有的完整三语页面做哈希，建立可信基线；此过程不读取模型配置，也不调用模型。请提交这份基线。之后删除清单会把当前目标内容当作新基线，因此更早的人工修改不再被检测到。
- 为 `docs/zh-cn/` 下（根目录除外）缺少 `index.md` 的内容目录生成最小索引。Notes 目录得到动态的 `<NotesIndex />` 页面；其他目录得到 `# <directory name>` 链接列表。自动创建的索引会在所属目录新增或删除页面时刷新，并重新翻译两个版本。一旦手工修改自动创建的索引，它就会降级为普通源，不再被自动改写。工具运行前就存在的用户索引绝不会被覆盖。
- 对每个生成目标依次执行：模型翻译、结构与安全校验、模型语义审阅。任何失败都会在写入前中止整次运行。这是逐个目标的校验，不是全站两阶段审查。
- 所有目标都通过后，把目标页面和状态清单放在同一个原子批次中写入，清单最后写入。写入失败会回滚并报告。如果在检查到重命名之间的短暂窗口内崩溃，下次运行会把目标报告为冲突，而不是覆盖它。
- 一切已同步或已更新时退出码为 `0`；冲突、生成、语义或写入失败为 `1`；参数错误为 `2`。

选项要写在 `--` 之后，例如 `pnpm content:sync -- --dry-run`。常用选项：`--dry-run`（只计划，不调用模型、不写文件）、`--only <source-or-target-path>`（可重复）、`--lang en|zh-tw`（可重复；只处理和记录所选语言）、`--init`（为现存完整三语页面建立基线；清单已存在时拒绝）、`--root <dir>`（隔离根目录）、`--timeout <ms>` 和 `--help`。

## 敏感内容与模型边界

`content:sync` 会把清理后的简体中文源文本发送给配置的模型服务。如果该服务是远程的，页面内容就会离开这台电脑。

- HTML 注释和显式私密块（`<!-- private:start -->` … `<!-- private:end -->`）会在发送给模型前移除，也不会写入生成版本。
- 私密标记不是访问控制。`docs/zh-cn/` 下的文字仍然存在于 Git 中，并会在简体中文站点发布；它们只用于避免内容进入模型输入和译本。
- 可选的 AI 搜索只在本地开发服务器运行。它会把问题和选中的公开页面摘要发送给配置的模型；标记 `draft: true` 或 `private: true` 的页面、HTML 注释、私密块和非公开文件都会被排除。端点只接受回环客户端，并要求同源的 `Host`/`Origin` 头；凭据始终留在本机服务器。
- 绝不要把 API 密钥、令牌、密码或私有配置写进 Markdown、`config.json`、源代码、Actions 或模型对话。
- `tools/config.yaml` 是本机私有模型配置。只有本机模型适配器会在运行时读取它。人类和 agent 绝不能读取、打印、复制、移动或提交它，也绝不能用占位值替换它。
- 生产站点不含 AI 端点、适配器、配置对象或凭据。AI 搜索只是本地开发功能，构建会拒绝可发布路径中的私有文件或符号链接。

## 配置

公开、非敏感的开关位于根目录 `config.json`：

```json
{
  "aiSearch": false,
  "prefetchLinks": false
}
```

两个开关都是可选的，默认 `false`；未知字段和非布尔值会被拒绝。`aiSearch` 启用本地开发用的 AI 搜索，在生产构建中始终禁用。`prefetchLinks` 控制 VitePress 的链接预取。

私有模型配置是 `tools/config.yaml`：被 Git 忽略，位于 `docs/` 和任何可发布路径之外，绝不会被提供或打包。最小形式如下：

```yaml
baseUrl: "https://model.example/v1"
apiKey: "<API_KEY>"
model: "<MODEL_ID>"
```

只有 `baseUrl`、`apiKey` 和 `model` 是必填项。可选字段及默认值：`api`（`openai-completions`）、`timeoutMs`（`300000`）、`maxOutputTokens`（`16384`）、`reasoningEffort`（`none`）。`baseUrl` 必须使用 HTTPS（回环 HTTP 地址除外），不能包含凭据、查询字符串或片段，并且没有隐式默认值，以免凭据被发送到非预期的服务。API 默认为 OpenAI 兼容的 chat completions。高级的单提供方多模型目录和现有的多提供方形式仍受支持。`AI_MODEL`、`AI_MODEL_CONFIG`、`AI_MODEL_PROVIDER` 和 `AI_REQUEST_TIMEOUT_MS` 可在单次运行中覆盖模型、配置文件、提供方和请求超时。配置错误会按失败处理。

## 检查、预览与发布

```sh
pnpm check:multilingual:structure
pnpm check:multilingual
pnpm test:multilingual
pnpm docs:build
pnpm docs:preview
```

`check:multilingual:structure` 是全站确定性阶段，不需要模型或凭据。`check:multilingual` 是全站两阶段审查：先结构，后语义。`test:multilingual` 运行翻译与安全行为测试；`docs:build` 和 `docs:preview` 构建并预览生产站点。

发布前运行 `pnpm content:sync`，审阅生成的页面，并运行 `pnpm check:multilingual` 完成全站两阶段审查。把简体中文源、生成的英语和繁体中文页面以及状态清单一起提交，这样下次同步才有可信基线。

推送到 `main` 会触发 `.github/workflows/static.yml`，安装依赖、构建站点，并把 `docs/.vitepress/dist` 部署到 GitHub Pages。仓库的 Pages 来源必须设为 **GitHub Actions**。工作流不调用模型，也不持有模型凭据；生产环境始终禁用 AI 搜索。部署完成后等待工作流结束，并抽查三个版本。

## 站点与安全规则

- 根 URL 按浏览器首选语言选择版本：繁体中文（`zh-TW`、`zh-HK`、`zh-MO`、`zh-Hant`）→ `/zh-tw/`，其他中文 → `/zh-cn/`，其他所有语言或禁用 JavaScript → `/en/`。显式语言路径和导航中的语言菜单始终可用。
- 浅色或深色主题默认跟随浏览器的系统偏好；访客使用主题开关后，手动选择会在后续访问中保留。浏览器工具栏颜色随当前主题变化。
- 三个版本共享相同的相对路径、结构、事实和内容覆盖。除非得到明确授权，否则保持公开 URL、用户内容和外部链接稳定。命令、结构或规则变化时，保持 `README.md`、`README.zh-CN.md` 与 `README.zh-TW.md` 语义一致。
- 所有浏览器运行时资源都由本站提供。不要添加 CDN、第三方字体或远程渲染服务；CSP 会限制运行时资源来源。
- 本仓库可能由多个 agent 在共享工作树中编辑。每个文件只分配给一个负责人；不要重置或覆盖他人的改动，也不要删除无法识别的用户内容。agent 不得在中途运行构建、测试、lint 或格式化命令；所有改动落地后由主 agent 统一验证一次。
- 报告真实结果、阻塞、风险和决策。不要声称未运行的检查已通过，不要伪造翻译质量，也不要为了让检查通过而削弱隐私或安全。
