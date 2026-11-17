import { defineConfig, type Plugin } from 'vitepress'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { shared } from './shared.ts'
import { headConfig } from './head.ts'
import { en_us } from './en-us.ts'
import { zh_cn } from './zh-cn.ts'
import {
    assertPrivateModelConfigPlacement,
    readAiSearchConfig,
    resolveAiSearchEnabled,
    scanPublishableResources
} from '../../tools/ai-search-config.mjs'

const docsDirectory = path.resolve(
    fileURLToPath(new URL('..', import.meta.url))
)
const repositoryRoot = path.resolve(
    fileURLToPath(new URL('../..', import.meta.url))
)
const publicDirectory = path.join(docsDirectory, 'public')
const nodeModulesDirectory = path.join(repositoryRoot, 'node_modules')

const servedDirectories = [
    docsDirectory,
    publicDirectory,
    nodeModulesDirectory
]

// Runs for dev, build, and preview, regardless of the AI switch. A private
// model file inside served or publishable paths is a startup error.
assertPrivateModelConfigPlacement({
    aiModelConfig: process.env.AI_MODEL_CONFIG,
    servedRoots: servedDirectories,
    repositoryRoot,
    baseDirectory: process.cwd()
})

/*
 * One public boolean controls AI search. `ai-search.config.json` is read only
 * by this config file; the browser receives only the resolved
 * `__AI_SEARCH_ENABLED__` boolean, never the config object or any server
 * setting.
 *
 * - Development (`command === 'serve'`) honours the switch.
 * - Production (`command === 'build'`) is always disabled. GitHub Pages is
 *   static and cannot host model credentials or a secure model backend.
 *
 * The endpoint middleware exists only on the Vite dev server. It uses the
 * current dev-server root, so it cannot be pointed at another site's docs.
 * Loopback, Host, Origin, and same-origin checks live in tools/ai-search.mjs.
 * When the switch is off, the middleware still answers the endpoint with an
 * explicit JSON refusal; it never builds the index or calls a model.
 */
const aiSearchConfig = readAiSearchConfig()

function aiSearchPlugin(): Plugin {
    return {
        name: 'ai-search',
        config(_config, env) {
            const enabled = resolveAiSearchEnabled(
                env.command,
                aiSearchConfig
            )
            return {
                // This is the only value the client receives.
                define: {
                    __AI_SEARCH_ENABLED__: JSON.stringify(enabled)
                }
            }
        },
        async configureServer(server) {
            const enabled = resolveAiSearchEnabled('serve', aiSearchConfig)
            const toolsPath = path.resolve(
                server.config.root,
                '..',
                'tools',
                'ai-search.mjs'
            )
            const { attachLocalAiSearch } = await import(
                pathToFileURL(toolsPath).href
            )
            attachLocalAiSearch(server, {
                docsRoot: server.config.root,
                enabled
            })
        },
        buildStart() {
            // Refuse to copy public assets or compile pages when documentation
            // contains a symlink/junction or a private configuration file.
            scanPublishableResources({
                docsRoot: docsDirectory,
                publicDir: publicDirectory,
                apiKeyPath: path.join(
                    repositoryRoot,
                    'tools',
                    'api-key.txt'
                ),
                aiModelConfig: process.env.AI_MODEL_CONFIG,
                repositoryRoot,
                baseDirectory: process.cwd()
            })
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
        plugins: [aiSearchPlugin()],
        server: {
            fs: {
                // Vite's default deny list (.env, key material, .git, etc.)
                // stays in effect; only the allow list is narrowed so tools/,
                // scripts/, README, and repository config are not served.
                // Do not set `deny` here: a user-provided deny array would
                // replace Vite's built-in defaults.
                strict: true,
                allow: [
                    docsDirectory,
                    publicDirectory,
                    nodeModulesDirectory
                ]
            }
        }
    },
})
