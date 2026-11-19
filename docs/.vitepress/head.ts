import { defineConfig } from 'vitepress'

export const headConfig = defineConfig({
    head: [
        // PNG fallback for browsers without SVG favicon support (older Safari).
        ['link', { rel: 'icon', href: '/images/favicon-48.png', type: 'image/png', sizes: '48x48' }],
        ['link', { rel: 'icon', href: '/favicon.svg', type: 'image/svg+xml', sizes: 'any' }],
        ['meta', { name: 'theme-color', content: '#0078D4' }],
        ['meta', { property: 'og:type', content: 'website' }],
        ['meta', { property: 'og:site_name', content: 'Yanzhen Guo' }],
        ['meta', { property: 'og:image', content: 'https://yzguo.github.io/images/pic.png' }],
        ['meta', { property: 'og:image:type', content: 'image/png' }],
        ['meta', { property: 'og:image:width', content: '320' }],
        ['meta', { property: 'og:image:height', content: '320' }],
        // All runtime assets must come from this site, including fonts and diagrams.
        ['meta', { 'http-equiv': 'Content-Security-Policy', content: "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'self'" }]
    ]
})
