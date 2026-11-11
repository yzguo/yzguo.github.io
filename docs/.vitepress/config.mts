import { defineConfig } from 'vitepress'
import { withMermaid } from 'vitepress-plugin-mermaid'

const contacts = [
  { icon: 'github', link: 'https://github.com/yzguo', ariaLabel: 'GitHub' },
  { icon: { svg: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.03 2 11c0 2.66 1.3 5.04 3.38 6.6L4.5 22l4.7-2.48c.9.25 1.83.38 2.8.38 5.52 0 10-4.03 10-9S17.52 2 12 2Zm-4.5 10.2a1.2 1.2 0 1 1 0-2.4 1.2 1.2 0 0 1 0 2.4Zm4.5 0a1.2 1.2 0 1 1 0-2.4 1.2 1.2 0 0 1 0 2.4Zm4.5 0a1.2 1.2 0 1 1 0-2.4 1.2 1.2 0 0 1 0 2.4Z"/></svg>' }, link: 'https://wpa.qq.com/msgrd?v=3&uin=2912008839&site=qq&menu=yes', ariaLabel: 'QQ' },
  { icon: { svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M8.5 15.5a5 5 0 0 0 7 0M9 9.5h.01M15 9.5h.01M5.6 5.6l1.8 1.8m11-1.8-1.8 1.8"/></svg>' }, link: 'https://signal.me/#eu/EricGuo.06', ariaLabel: 'Signal' },
  { icon: { svg: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M21.8 4.3 18.7 20c-.2 1.1-.9 1.4-1.8.9l-5-3.7-2.4 2.3c-.3.3-.5.5-1 .5l.4-5.1 9.3-8.4c.4-.4-.1-.6-.6-.2L6.1 13.6l-5-1.6c-1.1-.4-1.1-1.1.2-1.6L20.7 3c.9-.3 1.6.2 1.1 1.3Z"/></svg>' }, link: 'https://t.me/guoyz', ariaLabel: 'Telegram' }
]

const config = {
  title: 'Yanzhen Guo',
  description: 'Yanzhen Guo — physics, computing, and engineering.',
  cleanUrls: true,
  lastUpdated: true,
  markdown: { math: true },
  head: [
    ['meta', { name: 'theme-color', content: '#111827' }],
    ['link', { rel: 'icon', href: '/favicon.svg', type: 'image/svg+xml' }]
  ],
  themeConfig: {
    siteTitle: 'Yanzhen Guo',
    socialLinks: contacts,
    search: { provider: 'local' },
    editLink: {
      pattern: 'https://github.com/yzguo/yzguo.github.io/edit/main/docs/:path',
      text: 'Edit this page on GitHub'
    },
    footer: { message: 'Built with Markdown and VitePress.', copyright: '© Yanzhen Guo' }
  },
  locales: {
    root: {
      label: 'English', lang: 'en', link: '/',
      themeConfig: {
        nav: [
          { text: 'About', link: '/about' },
          { text: 'Projects', link: '/projects' },
          { text: 'Blog', link: '/blog' }
        ],
        sidebar: { '/blog/': [{ text: 'Blog', items: [
          { text: 'All posts', link: '/blog/' },
          { text: 'Markdown examples', link: '/blog/rendering' }
        ] }] },
        outline: { label: 'On this page' },
        docFooter: { prev: 'Previous page', next: 'Next page' },
        lastUpdated: { text: 'Last updated' },
        editLink: { text: 'Edit this page on GitHub' },
        langMenuLabel: 'Languages', returnToTopLabel: 'Back to top', sidebarMenuLabel: 'Menu',
        darkModeSwitchLabel: 'Appearance', lightModeSwitchTitle: 'Switch to light theme', darkModeSwitchTitle: 'Switch to dark theme',
        notFound: { title: 'PAGE NOT FOUND', quote: 'The page you are looking for does not exist.', linkLabel: 'Go to home', linkText: 'Take me home' },
        search: { options: { translations: { button: { buttonText: 'Search', buttonAriaLabel: 'Search' }, modal: { noResultsText: 'No results', resetButtonTitle: 'Clear search', footer: { selectText: 'to select', navigateText: 'to navigate', closeText: 'to close' } } } } }
      }
    },
    'zh-CN': {
      label: '简体中文', lang: 'zh-CN', link: '/zh-CN/',
      title: '郭彦禛', description: '郭彦禛——物理、计算与工程。',
      themeConfig: {
        nav: [
          { text: '关于', link: '/zh-CN/about' },
          { text: '项目', link: '/zh-CN/projects' },
          { text: '博客', link: '/zh-CN/blog' }
        ],
        sidebar: { '/zh-CN/blog/': [{ text: '博客', items: [
          { text: '所有文章', link: '/zh-CN/blog/' },
          { text: 'Markdown 示例', link: '/zh-CN/blog/rendering' }
        ] }] },
        outline: { label: '本页目录' }, docFooter: { prev: '上一页', next: '下一页' },
        lastUpdated: { text: '最后更新' }, editLink: { text: '在 GitHub 上编辑此页' },
        langMenuLabel: '切换语言', returnToTopLabel: '返回顶部', sidebarMenuLabel: '菜单',
        darkModeSwitchLabel: '外观', lightModeSwitchTitle: '切换至浅色主题', darkModeSwitchTitle: '切换至深色主题',
        notFound: { title: '页面未找到', quote: '你访问的页面不存在。', linkLabel: '返回首页', linkText: '带我回首页' },
        search: { options: { translations: { button: { buttonText: '搜索', buttonAriaLabel: '搜索' }, modal: { noResultsText: '没有找到结果', resetButtonTitle: '清除搜索', footer: { selectText: '选择', navigateText: '导航', closeText: '关闭' } } } } }
      }
    }
  }
}

export default withMermaid(defineConfig(config))
