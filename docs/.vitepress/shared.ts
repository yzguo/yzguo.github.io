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
        search: {
            provider: 'local',
            options: {
                // Local search UI strings are resolved by the active locale.
                // The root (English) locale uses VitePress's built-in English
                // defaults; only Simplified Chinese needs overrides.
                locales: {
                    'zh-cn': {
                        translations: {
                            button: {
                                buttonText: '搜索',
                                buttonAriaLabel: '搜索'
                            },
                            modal: {
                                displayDetails: '显示详细列表',
                                resetButtonTitle: '重置搜索',
                                backButtonTitle: '关闭搜索',
                                noResultsText: '没有结果',
                                footer: {
                                    selectText: '选择',
                                    selectKeyAriaLabel: '输入',
                                    navigateText: '导航',
                                    navigateUpKeyAriaLabel: '上箭头',
                                    navigateDownKeyAriaLabel: '下箭头',
                                    closeText: '关闭',
                                    closeKeyAriaLabel: 'Esc'
                                }
                            }
                        }
                    }
                }
            }
        }
    },
})
