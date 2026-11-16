import { defineConfig } from 'vitepress'

export const shared = defineConfig({
    title: 'Yanzhen Guo',
    metaChunk: true,
    lastUpdated: true,
    themeConfig: {
        logo: '/favicon.svg',
        socialLinks: [
            { icon: 'tencentqq', link: 'https://wpa.qq.com/msgrd?v=3&uin=2912008839&site=qq&menu=yes' },
            { icon: 'telegram', link: 'https://t.me/guoyz' },
            { icon: 'github', link: 'https://github.com/yzguo' }
        ],
        footer: {
            copyright: `Copyright © 2026 - ${new Date().getFullYear()} <a href="https://yzguo.github.io/" target="_blank" rel="noopener noreferrer">Yanzhen Guo</a> All Rights Reserved.`
        },
        search: { provider: 'local' }
    },
})
