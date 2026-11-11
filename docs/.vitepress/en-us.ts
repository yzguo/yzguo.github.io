import { defineConfig } from 'vitepress'

export const en_us = defineConfig({
    lang: 'en-US',
    description: "Yanzhen Guo's personal homepage.",
    themeConfig: {
        nav: [{ text: 'About', link: '/About/' },
            { text: 'Projects', link: '/Projects/' },
            { text: 'Blogs', link: '/Blogs/' }],
        sidebar: [{ text: 'About', link: '/About/' },
            { text: 'Projects', link: '/Projects/' },
            { text: 'Blogs', link: '/Blogs/' }]
    }
})
