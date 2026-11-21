import { defineConfig } from 'vitepress'
import { buildLocaleNavigation } from './navigation.mjs'

/*
 * 導覽與側欄由 docs/zh-tw 的 Markdown 樹自動產生；新增頁面或執行
 * content:sync 後無需修改本檔案。標題取本語言 frontmatter title 或首個可見
 * H1。這裡只維護可見介面文案。
 */
const navigation = buildLocaleNavigation('zh-tw')

export const zh_tw = defineConfig({
    lang: 'zh-TW',
    description: "個人主頁。",
    title: '郭彥禛',
    themeConfig: {
        nav: navigation.nav,
        sidebar: navigation.sidebar,
        editLink: {
            pattern: 'https://github.com/yzguo/yzguo.github.io/edit/main/docs/:path',
            text: "在 GitHub 上編輯此頁"
        },
        docFooter: {"prev":"← 上一頁","next":"下一頁 →"},
        outline: {"label":"頁面目錄"},
        lastUpdated: {"text":"最後更新於","formatOptions":{"dateStyle":"short","timeStyle":"medium"}},
        langMenuLabel: "多語言",
        returnToTopLabel: "回到頂部",
        sidebarMenuLabel: "選單",
        darkModeSwitchLabel: "主題",
        lightModeSwitchTitle: "切換到淺色模式",
        darkModeSwitchTitle: "切換到深色模式"
    }
})
