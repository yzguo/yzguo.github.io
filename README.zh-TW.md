# 郭彥禛個人網站

[English](README.md) | [簡體中文](README.zh-CN.md) | **繁體中文**

這是一個以 Markdown 撰寫、使用 VitePress 建置、發佈在 GitHub Pages 上的個人網站。網站有英文、簡體中文與繁體中文三個版本，結構、事實與內容涵蓋範圍一致。你只需在 `docs/zh-cn/` 下撰寫簡體中文；`pnpm content:sync` 會產生英文與繁體中文版本，導覽與側邊欄則由內容目錄自動產生。不要手動維護三份副本。

- English: <https://yzguo.github.io/en/>
- 簡體中文: <https://yzguo.github.io/zh-cn/>
- 繁體中文: <https://yzguo.github.io/zh-tw/>
- 語言入口（自動選擇）: <https://yzguo.github.io/>

## 快速開始

需要 Node.js 與 pnpm；pnpm 版本由 `packageManager` 固定。

```sh
pnpm install --frozen-lockfile
pnpm content:sync
pnpm docs:dev
```

`content:sync` 需要下文所述的私有模型設定。一切已同步時，它不會呼叫模型，也不會變更檔案。

## 只寫簡體中文

工作流程：修改一個簡體中文頁面，執行 `pnpm content:sync`，用 `pnpm docs:dev` 預覽，然後提交簡體中文來源、兩個產生版本與狀態清單。

`docs/zh-cn/` 是唯一的內容來源。每個頁面依相對路徑對應到 `docs/en/` 與 `docs/zh-tw/`，以及對應的公開 URL：

| 簡體中文（來源） | 英文 | 繁體中文 |
| --- | --- | --- |
| `docs/zh-cn/Notes/Courses/demo.md` | `docs/en/Notes/Courses/demo.md` | `docs/zh-tw/Notes/Courses/demo.md` |
| `/zh-cn/Notes/Courses/demo` | `/en/Notes/Courses/demo` | `/zh-tw/Notes/Courses/demo` |

### 目錄與索引頁

- 把頁面放進它所屬的目錄。讀者需要作為欄目瀏覽的目錄應有一個 `index.md` 作為欄目首頁。目錄 URL 以 `/` 結尾；一般頁面 URL 去掉 `.md`。
- 如果目錄裡已有 Markdown 但沒有 `index.md`，`content:sync` 會產生一個最小的簡體中文索引及其兩個譯本。既有的 `index.md` 絕不會被覆寫，你可以自行修改它的標題與引言。
- 只有當簡體中文、英文與繁體中文三個頁面都存在、可讀，且都沒有標記 `draft: true` 或 `private: true` 時，條目才會出現在導覽與清單中；否則三個版本會同時隱藏該條目。

### 檔案名稱與標題

- 檔案名稱與目錄名稱會成為公開 URL。請使用簡短、穩定、不含空格的 ASCII 名稱；小寫單字加連字號最為穩妥。以 `.` 開頭的名稱不會進入導覽，`index.md` 保留給目錄首頁。
- 導覽與頁面標題依次取自 frontmatter 中的 YAML `title`、第一個可見的一級標題（忽略 HTML 註解、私密區塊與程式碼圍欄中的標題）、路徑名稱。
- 每個頁面開頭寫一個明確的一級標題。重新命名檔案或目錄會改變公開 URL，因此已發佈的名稱應盡量保持穩定。
- frontmatter 中可選的數字 `order` 決定排序（越小越前）；未標記的條目依相對路徑排序。關於、專案、筆記保持現有的頂層順序，新的頂層欄目排在筆記之後。

### 內容與連結

- 依一般 VitePress Markdown 撰寫。來源檔中的站內連結使用 `/zh-cn/...`；產生的版本會得到對應的 `/en/...` 與 `/zh-tw/...` 連結。
- 翻譯會保留程式碼區塊、行內程式碼、公式、數字、frontmatter、URL 與 Mermaid 結構。讀者可見的 Mermaid 標籤會在安全規則下翻譯。
- 筆記索引頁用 `<NotesIndex />` 自動列出子頁面，包含標題與簡短摘要（frontmatter `description` 或首段）。保留該元件與引言文字，不要手動加入條目連結。新增頁面與分類不需要改任何 TypeScript 或索引清單：重新啟動 `pnpm docs:dev` 或重新建置即可重新整理導覽與側邊欄；筆記清單在開發模式下還會即時更新。
- 用 `draft: true` 或 `private: true` 可把頁面從導覽與清單中隱藏；給某個欄目的 `index.md` 加上這些欄位會隱藏整棵子樹。這些欄位只影響導覽與清單，不影響 Git 或 VitePress 建置，所以絕不要把金鑰或真正私密的內容放進 `docs/`。未翻譯、無法讀取或 YAML 損壞的頁面同樣不會進入導覽。
- 不要編輯 `docs/en/`、`docs/zh-tw/` 或 `docs/.vitepress/navigation.*`。修改簡體中文來源後重新執行 `content:sync`。

## `content:sync` 的運作方式

- 用設定的模型把新增或修改過的簡體中文頁面翻譯成英文與繁體中文。兩個版本都是真正的 AI 翻譯；OpenCC 只輔助繁體用字校正。
- 為 `docs/zh-cn` 頁面（不含根目錄 README）記錄一份可提交的 `tools/content-sync-state.json`（版本 1）與 SHA-256 內容雜湊，未變更的來源會被略過，不會重複呼叫模型。清單只含路徑、雜湊與自動索引標記，不含頁面內容或憑證。
- 只有當目標由工具產生、且其雜湊仍與記錄的基準一致時才更新。手動改過的目標、沒有可信基準的目標，或並行變更，都會被拒絕並以結束碼 1 報告；不會悄悄覆寫。還原時從版本控制還原目標（或刪除目標後重跑），再同步一次；不要手動合併產生頁面。
- 清單缺少時，工具先對現有的完整三語頁面做雜湊，建立可信基準；此過程不讀取模型設定，也不呼叫模型。請提交這份基準。之後刪除清單會把目前目標內容當成新基準，因此更早的人工修改不再被偵測到。
- 為 `docs/zh-cn/` 下（根目錄除外）缺少 `index.md` 的內容目錄產生最小索引。Notes 目錄會得到動態的 `<NotesIndex />` 頁面；其他目錄會得到 `# <directory name>` 連結清單。自動建立的索引會在所屬目錄新增或刪除頁面時重新整理，並重新翻譯兩個版本。一旦手動修改自動建立的索引，它就會降級為一般來源，不再被自動改寫。工具執行前就存在的使用者索引絕不會被覆寫。
- 對每個產生目標依次執行：模型翻譯、結構與安全驗證、模型語意審閱。任何失敗都會在寫入前中止整次執行。這是逐個目標的檢查，不是全站兩階段審查。
- 所有目標都通過後，把目標頁面與狀態清單放在同一個原子批次中寫入，清單最後寫入。寫入失敗會回滾並報告。如果在檢查到重新命名之間的短暫窗口內崩潰，下次執行會把目標報告為衝突，而不是覆寫它。
- 一切已同步或已更新時結束碼為 `0`；衝突、產生、語意或寫入失敗為 `1`；參數錯誤為 `2`。

選項要寫在 `--` 之後，例如 `pnpm content:sync -- --dry-run`。常用選項：`--dry-run`（只計畫，不呼叫模型、不寫檔案）、`--only <source-or-target-path>`（可重複）、`--lang en|zh-tw`（可重複；只處理並記錄所選語言）、`--init`（為現存完整三語頁面建立基準；清單已存在時拒絕）、`--root <dir>`（隔離根目錄）、`--timeout <ms>` 與 `--help`。

## 敏感內容與模型邊界

`content:sync` 會把清理後的簡體中文來源文字傳送給設定的模型服務。如果該服務是遠端的，頁面內容就會離開這部電腦。

- HTML 註解與明確的私密區塊（`<!-- private:start -->` … `<!-- private:end -->`）會在傳送給模型前移除，也不會寫入產生版本。
- 私密標記不是存取控制。`docs/zh-cn/` 下的文字仍然存在於 Git 中，並會在簡體中文網站發佈；它們只用於避免內容進入模型輸入與譯本。
- 選用的 AI 搜尋只在本機開發伺服器執行。它會把問題與選取的公開頁面摘要傳送給設定的模型；標記 `draft: true` 或 `private: true` 的頁面、HTML 註解、私密區塊與非公開檔案都會被排除。端點只接受回送用戶端，並要求同源的 `Host`/`Origin` 標頭；憑證始終留在本機伺服器。
- 絕不要把 API 金鑰、權杖、密碼或私有設定寫進 Markdown、`config.json`、原始碼、Actions 或模型對話。
- `tools/config.yaml` 是本機私有模型設定。只有本機模型轉接器會在執行時讀取它。人類與 agent 絕不能讀取、列印、複製、移動或提交它，也絕不能用佔位值取代它。
- 生產網站不含 AI 端點、轉接器、設定物件或憑證。AI 搜尋只是本機開發功能，建置會拒絕可發佈路徑中的私有檔案或符號連結。

## 設定

公開、非敏感的開關位於根目錄 `config.json`：

```json
{
  "aiSearch": false,
  "prefetchLinks": false
}
```

兩個開關都是選用的，預設 `false`；未知欄位與非布林值會被拒絕。`aiSearch` 啟用本機開發用的 AI 搜尋，在生產建置中始終停用。`prefetchLinks` 控制 VitePress 的連結預取。

私有模型設定是 `tools/config.yaml`：被 Git 忽略，位於 `docs/` 與任何可發佈路徑之外，絕不會被提供或打包。最小形式如下：

```yaml
baseUrl: "https://model.example/v1"
apiKey: "<API_KEY>"
model: "<MODEL_ID>"
```

只有 `baseUrl`、`apiKey` 與 `model` 是必填項。選用欄位與預設值：`api`（`openai-completions`）、`timeoutMs`（`300000`）、`maxOutputTokens`（`16384`）、`reasoningEffort`（`none`）。`baseUrl` 必須使用 HTTPS（回送 HTTP 位址除外），不能包含憑證、查詢字串或片段，並且沒有隱含預設值，以免憑證被傳送到非預期的服務。API 預設為 OpenAI 相容的 chat completions。進階的單一提供者多模型目錄與既有的多提供者形式仍受支援。`AI_MODEL`、`AI_MODEL_CONFIG`、`AI_MODEL_PROVIDER` 與 `AI_REQUEST_TIMEOUT_MS` 可在單次執行中覆寫模型、設定檔、提供者與請求逾時。設定錯誤會以失敗處理。

## 檢查、預覽與發佈

```sh
pnpm check:multilingual:structure
pnpm check:multilingual
pnpm test:multilingual
pnpm docs:build
pnpm docs:preview
```

`check:multilingual:structure` 是全站確定性階段，不需要模型或憑證。`check:multilingual` 是全站兩階段審查：先結構，後語意。`test:multilingual` 執行翻譯與安全行為測試；`docs:build` 與 `docs:preview` 建置並預覽生產網站。

發佈前執行 `pnpm content:sync`，審閱產生的頁面，並執行 `pnpm check:multilingual` 完成全站兩階段審查。把簡體中文來源、產生的英文與繁體中文頁面以及狀態清單一起提交，這樣下次同步才有可信基準。

推送到 `main` 會觸發 `.github/workflows/static.yml`，安裝相依套件、建置網站，並把 `docs/.vitepress/dist` 部署到 GitHub Pages。儲存庫的 Pages 來源必須設為 **GitHub Actions**。工作流程不呼叫模型，也不持有模型憑證；生產環境始終停用 AI 搜尋。部署完成後等待工作流程結束，並抽查三個版本。

## 網站與安全規則

- 根 URL 依瀏覽器偏好語言選擇版本：繁體中文（`zh-TW`、`zh-HK`、`zh-MO`、`zh-Hant`）→ `/zh-tw/`，其他中文 → `/zh-cn/`，其他所有語言或停用 JavaScript → `/en/`。明確的語言路徑與導覽中的語言選單始終可用。
- 淺色或深色主題預設跟隨瀏覽器的系統偏好；訪客使用主題開關後，手動選擇會在後續瀏覽時保留。瀏覽器工具列顏色隨目前主題變化。
- 三個版本共享相同的相對路徑、結構、事實與內容涵蓋範圍。除非獲得明確授權，否則保持公開 URL、使用者內容與外部連結穩定。命令、結構或規則變更時，保持 `README.md`、`README.zh-CN.md` 與 `README.zh-TW.md` 語意一致。
- 所有瀏覽器執行階段資源都由本站提供。不要加入 CDN、第三方字型或遠端轉譯服務；CSP 會限制執行階段資源來源。
- 本儲存庫可能由多個 agent 在共享工作樹中編輯。每個檔案只分配給一個負責人；不要重設或覆寫他人的變更，也不要刪除無法辨識的使用者內容。agent 不得在中途執行建置、測試、lint 或格式化命令；所有變更落地後由主 agent 統一驗證一次。
- 報告真實結果、阻塞、風險與決策。不要聲稱未執行的檢查已通過，不要偽造翻譯品質，也不要為了讓檢查通過而削弱隱私或安全。
