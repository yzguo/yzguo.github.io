import { defineConfig } from 'vitepress'

export const zh_cn = defineConfig({
    lang: 'zh-CN',
    description: "Yanzhen Guo's personal homepage.",
    themeConfig: {
        nav: [{ text: 'About', link: '/zh-cn/About/' },
            { text: 'Projects', link: '/zh-cn/Projects/' },
            { text: 'Blogs', link: '/zh-cn/Blogs/' }],
        sidebar: [{ text: 'About', link: '/zh-cn/About/' },
            { text: 'Projects', link: '/zh-cn/Projects/' },
            { text: 'Blogs', link: '/zh-cn/Blogs/' }]
    }
})
