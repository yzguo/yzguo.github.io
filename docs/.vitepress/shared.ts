import { defineConfig } from 'vitepress'

export const shared = defineConfig({
    title: 'Yanzhen Guo',
    /*
     * Explicitly keep VitePress's default appearance contract: the first visit
     * follows `prefers-color-scheme`, the dark class is applied in <head>
     * before paint, OS changes update an automatic choice, and the nav switch
     * stores a manual choice in localStorage. Do not override this with
     * `false`, `force-dark`, or `force-auto`.
     */
    appearance: true,
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
                // Local search resolves these strings by locale index. Keep the
                // three blocks structurally identical so every locale exposes
                // the same button and modal labels.
                locales: {
                    'en': {
                        translations: {
                            button: {
                                buttonText: 'Search',
                                buttonAriaLabel: 'Search'
                            },
                            modal: {
                                displayDetails: 'Display detailed list',
                                resetButtonTitle: 'Reset search',
                                backButtonTitle: 'Close search',
                                noResultsText: 'No results for',
                                footer: {
                                    selectText: 'to select',
                                    selectKeyAriaLabel: 'enter',
                                    navigateText: 'to navigate',
                                    navigateUpKeyAriaLabel: 'up arrow',
                                    navigateDownKeyAriaLabel: 'down arrow',
                                    closeText: 'to close',
                                    closeKeyAriaLabel: 'escape'
                                }
                            }
                        }
                    },
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
                    },
                    'zh-tw': {
                        translations: {
                            button: {
                                buttonText: '搜尋',
                                buttonAriaLabel: '搜尋'
                            },
                            modal: {
                                displayDetails: '顯示詳細清單',
                                resetButtonTitle: '重設搜尋',
                                backButtonTitle: '關閉搜尋',
                                noResultsText: '沒有結果',
                                footer: {
                                    selectText: '選擇',
                                    selectKeyAriaLabel: '輸入',
                                    navigateText: '導覽',
                                    navigateUpKeyAriaLabel: '上箭頭',
                                    navigateDownKeyAriaLabel: '下箭頭',
                                    closeText: '關閉',
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
