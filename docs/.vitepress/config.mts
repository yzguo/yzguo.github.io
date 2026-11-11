import { defineConfig } from 'vitepress'
import { shared } from './shared.ts'
import { headConfig } from './head.ts'
import { en_us } from './en-us.ts'
import { zh_cn } from './zh-cn.ts'

export default defineConfig({
    ...shared,
    ...headConfig,
    markdown: {
        math: true,
        config(md) {
            const fence = md.renderer.rules.fence!
            md.renderer.rules.fence = (tokens, index, options, env, self) => {
                const token = tokens[index]
                if (token.info.trim() === 'mermaid') {
                    return '<LocalMermaid source="' + encodeURIComponent(token.content) + '" />'
                }
                return fence(tokens, index, options, env, self)
            }
        }
    },
    locales: {
        root: { label: 'English', ...en_us },
        "zh-cn": { label: '简体中文', ...zh_cn },
    }
})
