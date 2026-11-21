/**
 * Public, non-sensitive site options.
 *
 * The root `config.json` holds two optional flat booleans:
 * `{ "aiSearch": false, "prefetchLinks": false }`. A missing field means
 * `false`. It is never imported by browser code: the VitePress config reads
 * it at build time and exposes only the resolved switches through the
 * compile-time `__AI_SEARCH_ENABLED__` constant and VitePress router options.
 * Unknown fields and non-boolean values are rejected deliberately so
 * credentials or provider settings can never be smuggled into a published
 * file.
 *
 * Production builds always resolve `aiSearch` to `false`, even when the
 * public config file says `true`. GitHub Pages is static and cannot host a
 * private model credential or a secure model backend, so enabling the switch
 * there would only display a button that cannot work.
 */

import { readFileSync, lstatSync, readdirSync, realpathSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const SITE_CONFIG_FILENAME = 'config.json'
export const SITE_CONFIG_PATH = fileURLToPath(
    new URL('../config.json', import.meta.url)
)

/** Injectable filesystem surface used by the dev guard and build scan. */
export const DEFAULT_FILE_SYSTEM_OPS = Object.freeze({
    lstatSync,
    readdirSync,
    realpathSync,
    statSync,
})

const PRIVATE_FILE_NAMES = [
    /^\.env(?:\..*)?[. ]*$/iu,
    /^\.npmrc$/iu,
    /^\.yarnrc\.yml$/iu,
    /^api-key(?:\.(?:txt|ya?ml|json|env|key|crt|pem))?[. ]*$/iu,
    /^(?:model-config(?:[. ]|$)|config\.ya?ml[. ]*$)/iu,
    /\.(?:crt|pem|key|p12|pfx|cer|der)[. ]*$/iu,
    /\.(?:secret|private|local)\./iu,
]
const PRIVATE_PATH_SEGMENT = /(?:^|[\\/])\.git\.?(?:[\\/]|$)/iu

/**
 * True for names that must never be served or published from documentation.
 * Windows ignores trailing dots/spaces, so those are stripped before matching.
 */
export function isPrivateResourcePath(value) {
    const normalized = String(value).replace(/\\/gu, '/')
    let name = normalized.slice(normalized.lastIndexOf('/') + 1)
    if (process.platform === 'win32') {
        name = name.replace(/[. ]+$/u, '')
    }
    return (
        PRIVATE_FILE_NAMES.some((pattern) => pattern.test(name)) ||
        PRIVATE_PATH_SEGMENT.test(normalized)
    )
}

export function pathKey(value) {
    const resolved = path.resolve(value)
    return process.platform === 'win32'
        ? resolved.toLowerCase()
        : resolved
}

export function isWithinPath(rootKey, targetKey) {
    const relative = path.relative(rootKey, targetKey)
    return (
        relative === '' ||
        (!relative.startsWith('..') && !path.isAbsolute(relative))
    )
}

export function resolveFileSystemOps(fs) {
    const ops = fs || DEFAULT_FILE_SYSTEM_OPS
    for (const name of ['lstatSync', 'readdirSync', 'realpathSync', 'statSync']) {
        if (typeof ops[name] !== 'function') {
            throw new TypeError(`fs.${name} must be a function`)
        }
    }
    return ops
}

/**
 * Resolve the real path of a file that may not exist yet: resolve the longest
 * existing ancestor and append the missing segments. Errors other than
 * ENOENT/ENOTDIR propagate so callers can fail closed.
 */
export function canonicalizeFilePath(value, fs = DEFAULT_FILE_SYSTEM_OPS) {
    const ops = resolveFileSystemOps(fs)
    let current = path.resolve(value)
    const missing = []

    for (;;) {
        try {
            const real = ops.realpathSync(current)
            return path.resolve(real, ...missing.reverse())
        } catch (error) {
            if (error?.code !== 'ENOENT' && error?.code !== 'ENOTDIR') {
                throw error
            }
            const parent = path.dirname(current)
            if (parent === current) throw error
            missing.push(path.basename(current))
            current = parent
        }
    }
}

export function fileIdentity(stats) {
    return stats && Number(stats.ino) > 0
        ? `${stats.dev}:${stats.ino}`
        : null
}

/**
 * Resolve a private file and return comparison keys. The directory flag lets
 * request guards reject every file below a configured directory. Errors are
 * deliberately generic: callers must never print configuration values.
 */
export function resolveProtectedResource(
    value,
    { baseDirectory = process.cwd(), fs, label = 'Private configuration' } = {}
) {
    if (typeof value !== 'string' || value.trim() === '') {
        throw new Error(`${label} path is invalid.`)
    }

    const ops = resolveFileSystemOps(fs)
    let lexical
    let canonical
    let directory = false
    let identity = null
    try {
        lexical = path.resolve(baseDirectory, value)
        canonical = canonicalizeFilePath(lexical, ops)
        try {
            const stats = ops.statSync(lexical)
            directory = stats.isDirectory()
            identity = directory ? null : fileIdentity(stats)
        } catch (error) {
            if (error?.code !== 'ENOENT' && error?.code !== 'ENOTDIR') {
                throw error
            }
        }
    } catch {
        throw new Error(`${label} path cannot be resolved safely.`)
    }

    return {
        lexical,
        canonical,
        lexicalKey: pathKey(lexical),
        canonicalKey: pathKey(canonical),
        directory,
        identity,
    }
}

/**
 * Only these ignored locations are allowed for a private model file inside
 * the repository. Everything else must live outside the repository.
 */
function isAllowedRepositoryConfigPath(relativePath) {
    const normalized = relativePath.replace(/\\/gu, '/')
    if (!normalized || normalized.startsWith('..') || path.isAbsolute(normalized)) {
        return false
    }

    const segments = normalized.split('/')
    if (segments.length === 1) {
        return (
            segments[0] === '.env' ||
            (segments[0].startsWith('.env.') && segments[0] !== '.env.example')
        )
    }
    if (segments.length !== 2 || segments[0] !== 'tools') return false

    const name = segments[1]
    return (
        name === 'config.yaml' ||
        name.endsWith('.key') ||
        name.endsWith('.pem') ||
        name.includes('.secret.') ||
        name.includes('.private.') ||
        name.includes('.local.') ||
        name.startsWith('.env')
    )
}

/**
 * `AI_MODEL_CONFIG` must not live in any directory the dev server serves or
 * the production build can publish. Both the lexical path and the real path
 * are checked so a symlink/junction cannot hide a served config.
 */
export function assertPrivateModelConfigPlacement({
    aiModelConfig,
    servedRoots = [],
    repositoryRoot,
    baseDirectory = process.cwd(),
    fs,
} = {}) {
    if (
        aiModelConfig === undefined ||
        aiModelConfig === null ||
        aiModelConfig === ''
    ) {
        return null
    }

    const entry = resolveProtectedResource(aiModelConfig, {
        baseDirectory,
        fs,
        label: 'Private model configuration',
    })
    const ops = resolveFileSystemOps(fs)
    const rootKeys = []
    for (const root of servedRoots) {
        rootKeys.push(pathKey(root))
        try {
            rootKeys.push(pathKey(canonicalizeFilePath(root, ops)))
        } catch {
            // The lexical root is still checked; a missing root cannot be
            // used to smuggle a served configuration path.
        }
    }
    for (const rootKey of rootKeys) {
        if (
            isWithinPath(rootKey, entry.lexicalKey) ||
            isWithinPath(rootKey, entry.canonicalKey)
        ) {
            throw new Error(
                'Private model configuration must not be inside a served or publishable path.'
            )
        }
    }

    if (repositoryRoot) {
        const repoRoot = path.resolve(repositoryRoot)
        const isInsideRepository = (value) => {
            const relative = path.relative(repoRoot, value)
            return (
                relative === '' ||
                (!relative.startsWith('..') && !path.isAbsolute(relative))
            )
        }
        const isAllowedInsideRepository = (value) => {
            const relative = path.relative(repoRoot, value)
            return (
                relative !== '' &&
                !relative.startsWith('..') &&
                !path.isAbsolute(relative) &&
                isAllowedRepositoryConfigPath(relative)
            )
        }
        if (
            (isInsideRepository(entry.lexical) &&
                !isAllowedInsideRepository(entry.lexical)) ||
            (isInsideRepository(entry.canonical) &&
                !isAllowedInsideRepository(entry.canonical))
        ) {
            throw new Error(
                'Private model configuration must be outside the repository or use an ignored tools/ or root .env path.'
            )
        }
    }

    return entry
}

/**
 * Fail the production build before public files are copied if documentation
 * contains a symbolic link/junction, a private file name, or the configured
 * private model file. Only a generic message is emitted; paths and contents
 * are never printed.
 */
export function scanPublishableResources({
    docsRoot,
    publicDir,
    modelConfigPath,
    aiModelConfig,
    protectedFiles = [],
    repositoryRoot,
    baseDirectory = process.cwd(),
    fs,
} = {}) {
    if (typeof docsRoot !== 'string' || docsRoot.trim() === '') {
        throw new Error('Documentation root is unavailable for the publish scan.')
    }

    const ops = resolveFileSystemOps(fs)
    const resolvedDocsRoot = path.resolve(docsRoot)
    const resolvedPublicDir = path.resolve(
        publicDir || path.join(resolvedDocsRoot, 'public')
    )
    const resolvedRepositoryRoot = path.resolve(
        repositoryRoot || path.dirname(resolvedDocsRoot)
    )
    const docsKey = pathKey(resolvedDocsRoot)
    const publicKey = pathKey(resolvedPublicDir)

    if (
        aiModelConfig !== undefined &&
        aiModelConfig !== null &&
        aiModelConfig !== ''
    ) {
        assertPrivateModelConfigPlacement({
            aiModelConfig,
            servedRoots: [resolvedDocsRoot, resolvedPublicDir],
            repositoryRoot: resolvedRepositoryRoot,
            baseDirectory,
            fs: ops,
        })
    }

    const protectedEntries = []
    const defaultModelConfigPath = path.join(
        resolvedRepositoryRoot,
        'tools',
        'config.yaml'
    )
    const protectedValues = [
        modelConfigPath || defaultModelConfigPath,
        ...(modelConfigPath ? [defaultModelConfigPath] : []),
        ...(aiModelConfig ? [aiModelConfig] : []),
        ...protectedFiles,
    ]
    for (const value of protectedValues) {
        if (value === undefined || value === null || value === '') continue
        protectedEntries.push(
            resolveProtectedResource(value, {
                baseDirectory,
                fs: ops,
                label: 'Protected file',
            })
        )
    }
    const protectedIdentities = new Set(
        protectedEntries
            .map((entry) => entry.identity)
            .filter((value) => typeof value === 'string')
    )

    const excluded = new Set(
        [
            path.join(resolvedDocsRoot, '.vitepress', 'cache'),
            path.join(resolvedDocsRoot, '.vitepress', 'dist'),
            path.join(resolvedDocsRoot, '.vitepress', '.temp'),
        ].map(pathKey)
    )
    const failure = () =>
        new Error(
            'Refusing to publish private configuration or symbolic links from documentation.'
        )

    const walk = (directory) => {
        let rootStats
        try {
            rootStats = ops.lstatSync(directory)
        } catch {
            throw failure()
        }
        if (!rootStats.isDirectory() || rootStats.isSymbolicLink()) {
            throw failure()
        }

        let entries
        try {
            entries = ops.readdirSync(directory, { withFileTypes: true })
        } catch {
            throw failure()
        }

        for (const entry of entries) {
            const full = path.join(directory, entry.name)
            let stats
            try {
                stats = ops.lstatSync(full)
            } catch {
                throw failure()
            }

            if (stats.isSymbolicLink()) throw failure()
            if (stats.isDirectory()) {
                if (excluded.has(pathKey(full))) continue
                walk(full)
                continue
            }
            if (!stats.isFile()) throw failure()

            if (isPrivateResourcePath(full)) throw failure()
            let canonical
            try {
                canonical = canonicalizeFilePath(full, ops)
            } catch {
                throw failure()
            }
            if (isPrivateResourcePath(canonical)) throw failure()

            let fileStats
            try {
                fileStats = ops.statSync(canonical)
            } catch {
                throw failure()
            }
            if (
                !fileStats.isDirectory() &&
                protectedIdentities.has(fileIdentity(fileStats))
            ) {
                throw failure()
            }

            const fullKey = pathKey(full)
            const canonicalKey = pathKey(canonical)
            for (const entryValue of protectedEntries) {
                if (
                    entryValue.directory
                        ? isWithinPath(entryValue.lexicalKey, fullKey) ||
                          isWithinPath(entryValue.canonicalKey, canonicalKey)
                        : fullKey === entryValue.lexicalKey ||
                          canonicalKey === entryValue.canonicalKey ||
                          fullKey === entryValue.canonicalKey ||
                          canonicalKey === entryValue.lexicalKey
                ) {
                    throw failure()
                }
            }
        }
    }

    walk(resolvedDocsRoot)
    if (!isWithinPath(docsKey, publicKey)) {
        walk(resolvedPublicDir)
    }
}


/**
 * Defaults used when the public config file is absent or a field is omitted.
 * Both switches default to `false`:
 * - `aiSearch`: expose the local model-backed AI search endpoint on the Vite
 *   dev server. Production builds always disable it.
 * - `prefetchLinks`: VitePress idle-time prefetch of in-viewport links. Off so
 *   a cold first paint does not request other pages, including the other
 *   locale homepages.
 * Deep-frozen so callers cannot mutate the shared defaults.
 */
export const DEFAULT_SITE_CONFIG = Object.freeze({
    aiSearch: false,
    prefetchLinks: false,
})

const SITE_CONFIG_FIELDS = Object.freeze(['aiSearch', 'prefetchLinks'])

function isPlainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/**
 * Accept `{}` or any subset of
 * `{ "aiSearch": <boolean>, "prefetchLinks": <boolean> }` and return both
 * switches, defaulting omitted fields to `false`. Rejecting extra fields is
 * deliberate: this file is public, and the client must never receive
 * environment or provider configuration through it. Future public feature
 * options are added explicitly here, never by accepting unknown keys.
 */
export function parseSiteConfig(value) {
    if (!isPlainObject(value)) {
        throw new TypeError(
            `${SITE_CONFIG_FILENAME} must contain a JSON object.`
        )
    }

    const config = { ...DEFAULT_SITE_CONFIG }
    for (const key of Object.keys(value)) {
        if (!SITE_CONFIG_FIELDS.includes(key)) {
            // Never echo a field name: a rejected public file may contain a
            // secret disguised as a key.
            throw new TypeError(
                `${SITE_CONFIG_FILENAME} contains an unsupported field.`
            )
        }
        if (typeof value[key] !== 'boolean') {
            throw new TypeError(
                `${SITE_CONFIG_FILENAME} field "${key}" must be a boolean.`
            )
        }
        config[key] = value[key]
    }

    return Object.freeze(config)
}

/**
 * Read and validate the public config file. A missing file means the default
 * (disabled) rather than a broken site. Parse and shape errors are reported
 * without echoing file contents, which prevents accidental secret output.
 */
export function readSiteConfig(
    configPath = SITE_CONFIG_PATH
) {
    let text
    try {
        text = readFileSync(configPath, 'utf8')
    } catch (error) {
        if (error && error.code === 'ENOENT') {
            return DEFAULT_SITE_CONFIG
        }
        throw new Error(
            `Could not read ${SITE_CONFIG_FILENAME}.`
        )
    }

    let parsed
    try {
        parsed = JSON.parse(text)
    } catch {
        throw new Error(
            `${SITE_CONFIG_FILENAME} is not valid JSON.`
        )
    }

    return parseSiteConfig(parsed)
}

/**
 * Resolve the AI search client/server switch from the public site options.
 * Only a development server can enable AI search; `vitepress build` is always
 * disabled by construction. `prefetchLinks` does not affect this.
 */
export function resolveAiSearchEnabled(command, config) {
    return command === 'serve' && config?.aiSearch === true
}
