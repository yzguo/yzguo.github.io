import { defineConfig, type Plugin } from 'vitepress'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { shared } from './shared.ts'
import { headConfig } from './head.ts'
import { en_us } from './en-us.ts'
import { zh_cn } from './zh-cn.ts'

/*
 * The AI search endpoint only exists while the Vite dev server is running.
 * `apply: 'serve'` keeps it out of production builds, and the client-side
 * entry is additionally hidden with `import.meta.env.DEV`. The endpoint uses
 * the current dev-server root, so it cannot be pointed at another site's docs.
 * No separate or public listener is created; loopback and same-origin checks
 * live in tools/ai-search.mjs.
 */
function localAiSearchPlugin(): Plugin {
    return {
        name: 'local-ai-search',
        apply: 'serve',
        async configureServer(server) {
            if (process.env.NODE_ENV === 'production') return
            // The module is loaded only by a real dev server. Neither the
            // production build nor the bilingual checker imports it, so they
            // never need OMP, credentials, or network access.
            const toolsPath = path.resolve(
                server.config.root,
                '..',
                'tools',
                'ai-search.mjs'
            )
            const { attachLocalAiSearch } = await import(
                pathToFileURL(toolsPath).href
            )
            attachLocalAiSearch(server, { docsRoot: server.config.root })
        }
    }
}

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
    },
    vite: {
        plugins: [localAiSearchPlugin()],
    },
})
