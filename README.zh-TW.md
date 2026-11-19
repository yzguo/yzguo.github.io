# 郭彥禛個人網站

[English](README.md) | [簡體中文](README.zh-CN.md) | **繁體中文**

一個使用 VitePress 建置、以 Markdown 撰寫、發佈在 GitHub Pages 上的個人網站。網站提供英文、簡體中文與繁體中文三個版本，三者的結構、事實與內容涵蓋範圍一致。本 README 是唯一的開發入口，說明安裝、撰寫、翻譯、檢查、安全與發佈流程。

- English: <https://yzguo.github.io/en/>
- 簡體中文: <https://yzguo.github.io/zh-cn/>
- 繁體中文: <https://yzguo.github.io/zh-tw/>
- 語言入口（自動選擇）: <https://yzguo.github.io/>

## 網站架構

網站是純靜態 VitePress 專案。每種語言版本位於獨立目錄，並由對應的公開 URL 提供。所有瀏覽器執行階段資源都由本站同源提供。

```text
.
├─ README.md
├─ README.zh-CN.md
├─ README.zh-TW.md
├─ package.json
├─ ai-search.config.json
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

`docs/zh-cn/` 是翻譯來源；`docs/en/` 與 `docs/zh-tw/` 在相同相對路徑存放英文和繁體中文版本。`docs/index.md` 是根入口，依瀏覽器偏好語言開啟對應版本，不包含正文。`docs/.vitepress/config.mts` 組裝三個語言版本；`en-us.ts`、`zh-cn.ts`、`zh-tw.ts` 分別維護可見導覽、側邊欄和對應語言的介面文案；`shared.ts` 保存三個版本共享的設定，以及 `en`、`zh-cn`、`zh-tw` 三語的本地搜尋介面文案。

## 語言路由

根 URL 自動依瀏覽器偏好語言開啟對應版本：

- `zh-TW`、`zh-HK`、`zh-MO` 或 `zh-Hant` → `/zh-tw/`
- 其他 `zh` 語言 → `/zh-cn/`
- 英文及所有其他語言 → `/en/`

自動選擇只在根路徑執行，且僅在用戶端進行，不使用伺服器重新導向。瀏覽器沒有可用的語言偏好或停用 JavaScript 時，網站預設進入英文版。訪客無需選擇語言，也不會看到語言選擇頁。啟用 JavaScript 時會保留查詢字串和片段；無 JavaScript 的備援不會保留。明確的語言路徑（`/en/`、`/zh-cn/`、`/zh-tw/`）和導覽選單中的語言切換保持可用，且不會被覆寫。路由不依賴外部瀏覽器資源。

## 內容與翻譯

簡體中文是翻譯來源：`README.zh-CN.md` 是 `README.md` 和 `README.zh-TW.md` 的來源檔案，`docs/zh-cn/` 是 `docs/en/` 和 `docs/zh-tw/` 的來源檔案。

### 路徑對應

`/` 是語言入口，自動進入瀏覽器偏好語言對應的版本（`docs/index.md`）。每個內容頁在三個版本的 `docs/en/`、`docs/zh-cn/` 或 `docs/zh-tw/` 下各有一份相同相對路徑的檔案，公開 URL 使用對應前綴。

| 欄目 | 簡體中文（來源） | 英文 | 繁體中文 |
| --- | --- | --- | --- |
| 首頁 | `/zh-cn/`（`docs/zh-cn/index.md`） | `/en/`（`docs/en/index.md`） | `/zh-tw/`（`docs/zh-tw/index.md`） |
| 關於 | `/zh-cn/About/` | `/en/About/` | `/zh-tw/About/` |
| 專案 | `/zh-cn/Projects/` | `/en/Projects/` | `/zh-tw/Projects/` |
| 筆記 | `/zh-cn/Notes/` | `/en/Notes/` | `/zh-tw/Notes/` |
| 筆記頁面 | `/zh-cn/Notes/<Category>/<page>` | `/en/Notes/<Category>/<page>` | `/zh-tw/Notes/<Category>/<page>` |

筆記分為課程、學習、工作三類，每類都有索引頁和示範頁，三種語言保持相同條目和結構。

### 新增或修改頁面

三種語言保持相同的相對路徑、標題結構、事實、數學、程式碼和連結語意。

1. 在 `docs/zh-cn/...` 下新增或修改簡體中文 Markdown；需要時加入 frontmatter。
2. 執行 `pnpm translate:docs:write` 產生英文和繁體中文對應頁，或直接編輯；審閱每個產生結果。
3. 在所屬分類索引中加入連結；新分類或新頂層欄目要同時更新三個語言版本的導覽和側邊欄。
4. 執行一致性檢查；標題、程式碼區塊、表格、事實、數字、數學和連結目標必須對應。站內連結在各自版本中使用 `/en/`、`/zh-cn/` 或 `/zh-tw/`。
5. 刪除頁面時，在同一次修改中刪除三個版本的檔案及所有連結；未經明確授權，不要刪除使用者內容。

### 導覽與介面文案

三種語言的可見文案和連結結構必須條目數量一致、含義對應；任何版本都不能出現佔位文案。

- `docs/.vitepress/en-us.ts`：英文導覽、側邊欄和英文介面文案。
- `docs/.vitepress/zh-cn.ts`：簡體中文導覽、側邊欄和介面文案。
- `docs/.vitepress/zh-tw.ts`：繁體中文導覽、側邊欄和介面文案。
- `docs/.vitepress/shared.ts`：三個版本共享的設定，以及 `en`、`zh-cn`、`zh-tw` 三語的本地搜尋介面文案；英文文案與 VitePress 預設值一致。
- `docs/en/index.md`、`docs/zh-cn/index.md` 與 `docs/zh-tw/index.md`：保持對應的 hero 操作和功能卡片。
- 頂層欄目、筆記分類和頁面數量必須在同一次修改中於三個語言版本同步增刪。

## 工具與翻譯指令

所有開發工具都在 `tools/`；不要新建第二套工具目錄。`package.json` 中的公開指令名稱是穩定介面，修改內部實作時不得改名。

```sh
pnpm translate:docs
pnpm translate:docs:write
pnpm translate:docs:force
pnpm check:bilingual
pnpm test:bilingual
pnpm test:tools
```

- `pnpm translate:docs`：唯讀列出簡體中文來源及其英文、繁體中文目標；不寫檔案，也不呼叫模型。
- `pnpm translate:docs:write`：只建立缺失目標。英文頁面由設定的本機模型翻譯；繁體中文頁面由本機 OpenCC 離線轉換；既有目標不會被覆寫。審閱每個產生檔案。
- `pnpm translate:docs:force`：依相同規則重新產生既有英文和繁體中文目標並覆寫它們。
- `pnpm check:bilingual`：檢查三個文件目錄、根目錄三份 README、其他受支援的根目錄中文文件、逐頁結構、事實、數學、程式碼和連結目標，以及從 `en-us.ts`、`zh-cn.ts`、`zh-tw.ts` 載入的可見介面文案。`docs/index.md` 是根入口，不參與配對。
- `pnpm test:bilingual`：翻譯、三語檢查、隱私、路徑和寫入安全的行為測試。
- `pnpm test:tools`：AI 適配器與 AI 搜尋的行為測試。

翻譯指令接受 `-- --lang en|zh-tw` 或 `-- --only <path>` 以縮小範圍。翻譯保留程式碼、公式、數字和 URL 目標；流程圖、時序圖和狀態圖的 Mermaid 標籤依安全規則翻譯，無法安全處理時整批報錯且不寫入。

- `tools/ai-model.mjs`、`tools/ai-search.mjs` 與 `tools/ai-search-config.mjs`：本機模型適配器、開發伺服器的 AI 搜尋端點、公開開關和發佈掃描。
- `tools/check-bilingual.mjs`、`tools/translate-docs.mjs`、`tools/traditional-chinese.mjs` 與 `tools/locale-links.mjs`：三語檢查、翻譯命令列、OpenCC 轉換和逐版本連結對應。
- `tools/model-config.yaml`：被 Git 忽略的預設私有模型設定；僅本機模型適配器在執行階段為認證讀取。人和 agent 不得讀取、列印、複製或提交它。
- `tools/*.test.mjs`：與實作同目錄的行為測試。

### 本機 AI 搜尋與開關

AI 搜尋是可選的本機開發功能，不會進入靜態生產網站。唯一開關是根目錄的公開、非敏感檔案 `ai-search.config.json`：

```json
{
  "enabled": false
}
```

預設 `false`。要使用它，將 `enabled` 改為 `true` 並重新啟動 `pnpm docs:dev`。問題和選取的公開頁面摘錄會傳送給設定的模型服務；私有區塊、HTML 註解、草稿和非公開頁面不會進入模型輸入。介面只接受來自回環位址且 `Host`/`Origin` 與本站同源相符的用戶端；介面提供取消按鈕，錯誤和逾時會明確顯示。

適配器直接呼叫 OpenAI 相容的模型 API。無論檔案內容為何，`pnpm docs:build` 都把開關解析為 `false`，因此生產套件不含 AI 按鈕、endpoint、適配器、設定物件或憑證。GitHub Pages 是純靜態託管；公開可用的 AI 必須另建有伺服器端憑證保護的後端。開發伺服器只提供 `docs/`、`docs/public/` 和 `node_modules/`，建置會拒絕可發佈路徑中的私有檔案或符號連結/junction。這些是縱深防禦，不構成對已遭入侵本機帳戶或檔案系統的絕對保證。

### 本機模型設定

本機模型適配器預設讀取被 Git 忽略的 `tools/model-config.yaml`，或透過 `AI_MODEL_CONFIG` 指定儲存庫外或受允許的已忽略位置的安全私有 YAML/JSON 檔案。設定格式為 YAML；`.json` 檔案依 JSON 解析。下面的佔位範例是有效的設定結構，不包含真實 endpoint 或憑證：

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

`api` 必須為 `openai-completions`（也接受 `openai-compatible`）。`baseUrl` 必須使用 HTTPS（本機回環位址可使用 HTTP），且不得包含憑證、查詢參數或片段。每個模型的 `id` 必須唯一；`contextWindow` 與 `maxTokens` 為正整數，且 `maxTokens` 不得大於 `contextWindow`；`input` 若存在必須是非空字串陣列。`AI_MODEL`、`AI_MODEL_PROVIDER` 選擇已設定的模型和服務提供者；`AI_REQUEST_TIMEOUT_MS` 預設 `300000` 毫秒，應低於瀏覽器 15 分鐘硬性上限。設定缺失、無法讀取或無效時直接失敗，不會回退到環境變數金鑰或 OMP。

儲存庫內只接受已忽略的私有位置：`tools/model-config.yaml`（也接受 `.yml` 或 `.json`）、根目錄 `.env`/`.env.*`（`.env.example` 除外）、`tools/.env*`，以及 `tools/` 下符合已忽略金鑰模式的檔案。`docs/` 等可發佈或未被忽略的路徑會被拒絕；不得提交私有設定，也不得把金鑰放入受版本控制或可發佈的路徑。

**私鑰規則：**`tools/model-config.yaml` 是使用者的真實敏感檔案。僅本機模型適配器可在執行階段於本機讀取它用於認證。人和 agent 不得讀取、列印、複製、移動或提交它，也不得把其內容貼到文件、原始碼、Actions 或 AI 對話中；適配器不得洩露其內容。

## 本機開發

需要 Node.js 和 pnpm（版本由 `packageManager` 固定）。安裝、開發、建置和預覽：

```sh
pnpm install --frozen-lockfile
pnpm docs:dev
pnpm docs:build
pnpm docs:preview
```

`pnpm docs:dev` 提供三個版本，包括根入口。Markdown 支援 `$...$` 行內公式、`$$...$$` 區塊公式和圍欄 `mermaid` 圖表；課程筆記示範頁包含這三類範例。字型、公式和圖表都在本機轉譯，不從 CDN 載入。

### 網路需求與離線邊界

所有瀏覽器執行階段資源都由本站同源提供，不請求 CDN 或第三方執行階段服務。這不等於整個應用程式可以完全離線：

- 存取已部署的網站需要連線其託管伺服器；`pnpm docs:dev` 和 `pnpm docs:preview` 需要本機伺服器。
- 首次 `pnpm install` 需要存取套件倉庫；在本機快取不完整時重新安裝也需要網路。
- 如果設定的是遠端模型 API，AI 搜尋、英文翻譯和依賴模型的檢查需要連通該 API。適配器在本機執行，但這不代表模型可以離線使用。

網路傳輸時間取決於訪客的網路和託管服務；網站不保證任何載入耗時或單項資源延遲。

不得把網站或其 AI 功能描述為完全離線，也不得為了繞過網路限制而引入外部執行階段資源。

## 資源、字型與轉譯

所有瀏覽器執行階段資源必須同源提供。CSP 在 `docs/.vitepress/head.ts` 中限制資源來源；字型放在 `docs/public/fonts/`，圖片放在 `docs/public/images/`。正文使用本機 Noto Sans SC，程式碼使用 Latin Modern Mono，公式使用 `markdown-it-mathjax3` 產生的 MathJax SVG，圖表由本機載入的 Mermaid 繪製，符號與表情使用 Nerd Fonts、Noto Emoji 和 Twemoji Mozilla。字型授權檔案隨網站放在 `docs/public/fonts/` 下。不要引入 CDN、第三方字型或遠端轉譯服務；關於頁的 GitHub、QQ、Telegram、Signal 是使用者主動點擊的外連，不屬於執行階段資源。

翻譯工具保留程式碼、公式和連結目標；對流程圖、時序圖和狀態圖的 Mermaid 標籤依安全規則翻譯，無法安全處理時報錯而不寫入。

## 檢查與驗收

主要檢查指令如下：

| 指令 | 用途 |
| --- | --- |
| `pnpm check:bilingual` | 檢查三個文件目錄、根目錄三份 README、頁面結構和連結以及可見介面文案，並做模型語意審閱。 |
| `pnpm test:bilingual` | 翻譯、三語檢查、隱私、路徑和寫入安全的行為測試。 |
| `pnpm test:tools` | AI 適配器與 AI 搜尋的行為測試。 |
| `pnpm docs:build` | 產生生產網站 `docs/.vitepress/dist`。 |

`pnpm check:bilingual` 會把配對頁面內容和介面文案傳送給設定的模型，應人工審閱其結論，不能當作翻譯品質的證明。GitHub Actions 沒有模型憑證，因此該檢查只在本地或主驗證階段執行，不包含在部署 workflow 中。

人工驗收至少涵蓋：三個版本的首頁、導覽、側邊欄和筆記條目；根路徑針對繁體中文、其他中文、英文及其他語言的自動選擇；停用 JavaScript 或瀏覽器未提供語言時根路徑回退到英文；明確語言路徑和導覽選單中的語言切換保持生效；桌面與手機寬度；淺色和深色主題；數學公式與 Mermaid；字型載入；以及無 AI、無本站以外執行階段資源請求的生產建置。

- 只報告實際執行過的指令、真實輸出和涵蓋範圍；未執行的檢查不得聲稱通過。
- 不得偽造內容、資料、截圖或測試結果，也不得隱藏失敗、警告或已知限制。
- 不得為了通過檢查、減小體積或加快開發而降低隱私或安全保證，例如繞過路徑驗證、把金鑰放進前端或引入外部執行階段服務。
- 除非明確授權，保留現有公開 URL、使用者內容和外部連結；不擅自改寫個人事實。

## 隱私與資料安全

公開儲存庫中不得出現憑證、私有設定、草稿或未公開的個人資料。

- `tools/model-config.yaml` 必須保持被忽略、僅本機存在；僅本機模型適配器在執行階段為認證讀取，人和 agent 不得讀取、列印、複製或提交它。
- 私有區塊標記 `<!-- private:start -->` 與 `<!-- private:end -->` 只控制模型輸入，不改變檔案的可發佈性；標記內的文字仍可能透過 Git 或 VitePress 公開。
- HTML 註解和私有區塊會從模型輸入中移除；不要用它們存放金鑰，也不要把金鑰放進任何 Markdown。
- `ai-search.config.json` 只能包含公開布林開關，不得寫入 endpoint、金鑰或其他敏感設定。
- 翻譯工具在寫入整批檔案前驗證結果並檢查衝突；衝突檢查不能代替備份。避免同時編輯目標檔案，`translate:docs:force` 會覆寫既有英文和繁體中文頁面。
- 建置會拒絕可發佈路徑中的私有檔案和符號連結/junction；開發伺服器依白名單提供檔案。發現異常應修復原因，不要關閉保護。

## 協作與檔案歸屬

本儲存庫可能在共享工作樹中由多個 agent 協作。每個獨立功能單獨指派一個子 agent，並給予明確的檔案清單和驗收標準；不要把同一檔案同時交給多個 agent。

- 子 agent 只改自己負責的檔案；需要共享檔案時先問其 owner 或主 agent，不得跨範圍修改。
- 不要 reset、checkout 或覆寫使用者及其他 agent 的改動；不要刪除不認識的使用者資料。`tools/model-config.yaml` 必須保持本機、被忽略；僅本機模型適配器在執行階段讀取，人和 agent 不得讀取、列印、複製或提交它。
- 子 agent 不在中途執行 build、test、lint 或 format；所有改動落地後由主 agent 統一驗收並報告真實結果。
- 功能拆分為可獨立驗收的小塊；新功能要有對應行為測試，測試放在 `tools/` 並與實作同目錄。
- 結構和指令變化時同步更新三份 README；本 README 是唯一開發入口，不要建立平行的開發說明。
- 報告阻塞、風險或需要決策的事項；不要用進度彙報代替實際完成。

## 部署

推送到 `main` 會觸發 `.github/workflows/static.yml`，安裝相依套件、建置網站並把 `docs/.vitepress/dist` 部署到 GitHub Pages。儲存庫 Pages 的發佈來源必須設為 **GitHub Actions**。

- workflow 只執行安裝、建置和部署，不執行模型檢查，也不持有任何模型憑證。
- 生產建置始終關閉 AI 搜尋，即使 `ai-search.config.json` 在本機為 `true`。
- 發佈前確認檢查通過、工作樹中沒有私有檔案、沒有未審閱的翻譯覆寫。
- 部署後抽查三個版本的頁面、導覽、字型、公式和圖表；網站不應請求非本站執行階段資源。
