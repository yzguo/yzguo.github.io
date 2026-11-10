import { defineConfig } from 'vitepress'
import mathjax3 from 'markdown-it-mathjax3'
import { withMermaid } from 'vitepress-plugin-mermaid'

const config = {
  title: 'Yanzhen Guo',
  description: 'Yanzhen Guo — physics, computing, and engineering.',
  cleanUrls: true,
  lastUpdated: true,
  markdown: {
    math: true
  },
  head: [
    ['meta', { name: 'theme-color', content: '#f8f7f4' }],
    ['link', { rel: 'icon', href: '/favicon.svg', type: 'image/svg+xml' }]
  ],
  themeConfig: {
    siteTitle: 'Yanzhen Guo',
    socialLinks: [{ icon: 'github', link: 'https://github.com/yzguo' }],
    search: { provider: 'local' },
    editLink: {
      pattern: 'https://github.com/yzguo/yzguo.github.io/edit/main/docs/:path',
      text: 'Edit this page on GitHub'
    },
    footer: {
      message: 'Built with Markdown and VitePress.',
      copyright: '© Yanzhen Guo'
    }
  },
  locales: {
    root: {
      label: 'English',
      lang: 'en',
      link: '/',
      themeConfig: {
        nav: [
          { text: 'About', link: '/about' },
          { text: 'Projects', link: '/projects' },
          { text: 'Notes', link: '/notes' }
        ],
        sidebar: {
          '/notes/': [{ text: 'Notes', items: [
            { text: 'Overview', link: '/notes/' },
            { text: 'Rich Markdown examples', link: '/notes/rendering' }
          ] }]
        },
        outline: { label: 'On this page' },
        docFooter: { prev: 'Previous page', next: 'Next page' },
        lastUpdated: { text: 'Last updated' },
        editLink: { text: 'Edit this page on GitHub' },
        langMenuLabel: 'Languages',
        returnToTopLabel: 'Back to top',
        sidebarMenuLabel: 'Menu',
        darkModeSwitchLabel: 'Appearance',
        lightModeSwitchTitle: 'Switch to light theme',
        darkModeSwitchTitle: 'Switch to dark theme',
        notFound: { title: 'PAGE NOT FOUND', quote: 'The page you are looking for does not exist.', linkLabel: 'Go to home', linkText: 'Take me home' },
        search: { options: { translations: { button: { buttonText: 'Search', buttonAriaLabel: 'Search' }, modal: { noResultsText: 'No results', resetButtonTitle: 'Clear search', footer: { selectText: 'to select', navigateText: 'to navigate', closeText: 'to close' } } } } }
      }
    },
    'zh-CN': {
      label: '简体中文',
      lang: 'zh-CN',
      link: '/zh-CN/',
      title: '郭言臻',
      description: '郭言臻——物理、计算与工程。',
      themeConfig: {
        nav: [
          { text: '关于', link: '/zh-CN/about' },
          { text: '项目', link: '/zh-CN/projects' },
          { text: '笔记', link: '/zh-CN/notes' }
        ],
        sidebar: {
          '/zh-CN/notes/': [{ text: '笔记', items: [
            { text: '笔记首页', link: '/zh-CN/notes/' },
            { text: 'Markdown 扩展示例', link: '/zh-CN/notes/rendering' }
          ] }]
        },
        outline: { label: '本页目录' },
        docFooter: { prev: '上一页', next: '下一页' },
        lastUpdated: { text: '最后更新' },
        editLink: { text: '在 GitHub 上编辑此页' },
        langMenuLabel: '切换语言',
        returnToTopLabel: '返回顶部',
        sidebarMenuLabel: '菜单',
        darkModeSwitchLabel: '外观',
        lightModeSwitchTitle: '切换至浅色主题',
        darkModeSwitchTitle: '切换至深色主题',
        notFound: { title: '页面未找到', quote: '你访问的页面不存在。', linkLabel: '返回首页', linkText: '带我回首页' },
        search: { options: { translations: { button: { buttonText: '搜索', buttonAriaLabel: '搜索' }, modal: { noResultsText: '没有找到结果', resetButtonTitle: '清除搜索', footer: { selectText: '选择', navigateText: '导航', closeText: '关闭' } } } } }
      }
    }
  }
}

export default withMermaid(defineConfig(config))
