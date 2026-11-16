import { defineConfig } from 'vitepress'

export const headConfig = defineConfig({
    head: [
        ['link', { rel: 'icon', href: '/favicon.svg', type: 'image/svg+xml' }],
        ['meta', { name: 'theme-color', content: '#0078D4' }],
        ['meta', { property: 'og:type', content: 'website' }],
        ['meta', { property: 'og:site_name', content: 'Yanzhen Guo' }],
        ['meta', { property: 'og:image', content: 'https://yzguo.github.io/images/pic.png' }],
        // All runtime assets must come from this site, including fonts and diagrams.
        ['meta', { 'http-equiv': 'Content-Security-Policy', content: "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'self'" }]
    ]
})
