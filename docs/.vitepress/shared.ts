import { defineConfig } from 'vitepress'

export const shared = defineConfig({
    title: 'Yanzhen Guo',
    metaChunk: true,
    themeConfig: {
        logo: '/favicon.ico',
        socialLinks: [{ icon: 'github', link: 'https://github.com/yzguo' }],
        search: { provider: 'local' }
    },
    // Keep existing homepage Markdown intact while retiring its old doc routes.
    transformPageData(pageData) {
        if (!['index.md', 'zh-cn/index.md'].includes(pageData.relativePath)) return
        const prefix = pageData.relativePath.startsWith('zh-cn/') ? '/zh-cn' : ''
        for (const action of pageData.frontmatter.hero?.actions ?? []) {
            if (action.link === prefix + '/introduction/what-is-otp') action.link = prefix + '/About/'
            if (action.link === prefix + '/introduction/download') action.link = prefix + '/Projects/'
        }
    }
})
