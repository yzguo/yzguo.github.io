import {
  closeSync,
  constants as fsConstants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync
} from 'node:fs'
import path from 'node:path'
import {
  fileIdentity,
  isWithinPath,
  pathKey,
  resolveFileSystemOps,
  resolveProtectedResource
} from '../../tools/site-config.mjs'

/*
 * Navigation reads page titles and excerpts from Markdown. That read must not
 * become a side channel for the private model configuration:
 *
 * - every path component is checked with lstat and the final file is opened by
 *   handle; the handle identity must match stat() on the path before and after
 *   the read;
 * - the real path must stay inside docs/<locale>;
 * - the opened file's dev+ino identity is compared with the default private
 *   configuration (tools/config.yaml) and AI_MODEL_CONFIG. Only metadata is
 *   read from those paths; their contents are never opened here;
 * - identities and paths observed for private configuration are retained for
 *   the life of the process, so a replaced configuration cannot make an old
 *   hardlink readable;
 * - any ambiguity (unreadable metadata, inode unavailable, a changed path,
 *   an unexpected filesystem error) fails closed and returns no text.
 *
 * tools/site-config.mjs owns the canonical path/identity rules; this module
 * only composes them with a handle-based read.
 */

const defaultReadFs = Object.freeze({
  lstatSync,
  readdirSync,
  realpathSync,
  statSync,
  openSync,
  fstatSync,
  closeSync,
  readFileSync,
  constants: fsConstants
})

// Shared across the config bundle and the data-loader bundle in the same
// process. Identities are never removed: a replaced private configuration
// must not make an older hardlink readable again.
const historyKey = Symbol.for('yzguo.navigation.privateConfigIdentities')
const privateConfigIdentityHistory =
  globalThis[historyKey] ?? (globalThis[historyKey] = new Set())
const directoryHistoryKey = Symbol.for(
  'yzguo.navigation.privateConfigDirectoryIdentities'
)
const privateConfigDirectoryIdentityHistory =
  globalThis[directoryHistoryKey] ??
  (globalThis[directoryHistoryKey] = new Set())

/** Test-only reset; production never clears observed private identities. */
export function resetPrivateConfigIdentityHistory() {
  privateConfigIdentityHistory.clear()
  privateConfigDirectoryIdentityHistory.clear()
}

function isMissing(error) {
  return error?.code === 'ENOENT' || error?.code === 'ENOTDIR'
}

function normalizePrivateConfigPath(value) {
  return typeof value === 'string' && value.trim() !== '' ? value : null
}

// resolveProtectedResource() validates canonical paths and returns an
// identity when one exists. It deliberately reports paths but never contents.
function inspectPrivateConfig(value, { baseDirectory, fs }) {
  const resource = resolveProtectedResource(value, { baseDirectory, fs })
  const result = {
    lexicalKey: resource.lexicalKey,
    canonicalKey: resource.canonicalKey,
    directory: resource.directory,
    identity: resource.identity,
    priorIdentity: resource.identity,
    statsIdentity: null,
    directoryIdentity: null
  }

  let stats
  try {
    stats = fs.statSync(resource.lexical)
  } catch (error) {
    if (isMissing(error)) return result
    throw error
  }

  if (stats.isDirectory()) {
    result.directory = true
    result.identity = null
    const directoryIdentity = fileIdentity(stats)
    if (!directoryIdentity) {
      throw new Error('Private configuration directory identity is unavailable')
    }
    result.directoryIdentity = directoryIdentity
    return result
  }
  if (!stats.isFile()) {
    throw new Error('Private configuration is not a regular file or directory')
  }

  const identity = fileIdentity(stats)
  if (!identity) {
    throw new Error('Private configuration identity is unavailable')
  }
  result.identity = identity
  result.statsIdentity = identity
  return result
}

function createPrivateConfigGuard({
  docsRoot,
  env = process.env,
  cwd = process.cwd(),
  fs = defaultReadFs,
  privateConfigPaths = []
} = {}) {
  const state = {
    uncertain: false,
    pathKeys: new Set(),
    directoryKeys: new Set()
  }

  const candidates = [
    path.join(path.dirname(path.resolve(docsRoot)), 'tools', 'config.yaml')
  ]
  for (const value of privateConfigPaths) {
    const normalized = normalizePrivateConfigPath(value)
    if (normalized) candidates.push(normalized)
  }
  const envConfig = normalizePrivateConfigPath(env?.AI_MODEL_CONFIG)
  if (envConfig) candidates.push(envConfig)
  const uniqueCandidates = [...new Set(candidates)]

  for (const value of uniqueCandidates) {
    let info
    try {
      info = inspectPrivateConfig(value, { baseDirectory: cwd, fs })
    } catch {
      state.uncertain = true
      break
    }

    state.pathKeys.add(info.lexicalKey)
    state.pathKeys.add(info.canonicalKey)
    if (info.directory) {
      state.directoryKeys.add(info.lexicalKey)
      state.directoryKeys.add(info.canonicalKey)
    }
    if (info.directoryIdentity) {
      privateConfigDirectoryIdentityHistory.add(info.directoryIdentity)
    }
    if (info.priorIdentity) {
      privateConfigIdentityHistory.add(info.priorIdentity)
    }
    if (info.identity) privateConfigIdentityHistory.add(info.identity)
    if (info.statsIdentity) {
      privateConfigIdentityHistory.add(info.statsIdentity)
    }
  }

  const refresh = () => {
    if (state.uncertain) return
    for (const value of uniqueCandidates) {
      let info
      try {
        info = inspectPrivateConfig(value, { baseDirectory: cwd, fs })
      } catch {
        state.uncertain = true
        return
      }
      state.pathKeys.add(info.lexicalKey)
      state.pathKeys.add(info.canonicalKey)
      if (info.directory) {
        state.directoryKeys.add(info.lexicalKey)
        state.directoryKeys.add(info.canonicalKey)
      }
      if (info.directoryIdentity) {
        privateConfigDirectoryIdentityHistory.add(info.directoryIdentity)
      }
      if (info.priorIdentity) {
        privateConfigIdentityHistory.add(info.priorIdentity)
      }
      if (info.identity) privateConfigIdentityHistory.add(info.identity)
      if (info.statsIdentity) {
        privateConfigIdentityHistory.add(info.statsIdentity)
      }
    }
  }

  const isBlocked = (absolutePath, realPath, identity) => {
    if (state.uncertain) return true
    const lexicalKey = pathKey(absolutePath)
    const realKey = pathKey(realPath)
    if (state.pathKeys.has(lexicalKey) || state.pathKeys.has(realKey)) {
      return true
    }
    for (const directoryKey of state.directoryKeys) {
      if (
        isWithinPath(directoryKey, lexicalKey) ||
        isWithinPath(directoryKey, realKey)
      ) {
        return true
      }
    }
    if (!identity) return true
    return privateConfigIdentityHistory.has(identity)
  }

  return {
    get uncertain() {
      return state.uncertain
    },
    refresh,
    isBlocked
  }
}

export function createSafeMarkdownReader(options = {}) {
  const {
    docsRoot,
    env = process.env,
    cwd = process.cwd(),
    fs = defaultReadFs,
    privateConfigPaths = []
  } = options

  const ops = resolveFileSystemOps(fs)
  for (const name of ['openSync', 'fstatSync', 'closeSync', 'readFileSync']) {
    if (typeof fs[name] !== 'function') {
      throw new TypeError(`fs.${name} must be a function`)
    }
  }

  const lexicalDocsRoot = path.resolve(docsRoot)
  const guard = createPrivateConfigGuard({
    docsRoot: lexicalDocsRoot,
    env,
    cwd,
    fs: ops,
    privateConfigPaths
  })
  let uncertain = guard.uncertain
  let realDocsRoot = null

  try {
    const rootStats = ops.lstatSync(lexicalDocsRoot)
    if (!rootStats.isDirectory() || rootStats.isSymbolicLink()) {
      uncertain = true
    } else {
      realDocsRoot = path.resolve(ops.realpathSync(lexicalDocsRoot))
    }
  } catch {
    uncertain = true
  }

  const noFollow =
    fs.constants?.O_NOFOLLOW ?? fsConstants.O_NOFOLLOW ?? 0
  const openFlags =
    (fs.constants?.O_RDONLY ?? fsConstants.O_RDONLY) | noFollow

  const componentsAreSafe = (locale, relativePath) => {
    if (
      typeof locale !== 'string' ||
      locale === '' ||
      locale.includes('/') ||
      locale.includes('\\')
    ) {
      return false
    }
    const segments = relativePath.split('/')
    if (
      segments.length === 0 ||
      segments.some(
        (segment) =>
          segment === '' ||
          segment === '.' ||
          segment === '..' ||
          segment.includes('\\')
      )
    ) {
      return false
    }

    let current = lexicalDocsRoot
    let rootStats
    try {
      rootStats = ops.lstatSync(current)
    } catch {
      return false
    }
    if (rootStats.isSymbolicLink() || !rootStats.isDirectory()) return false
    const rootIdentity = fileIdentity(rootStats)
    if (
      rootIdentity &&
      privateConfigDirectoryIdentityHistory.has(rootIdentity)
    ) {
      return false
    }

    const allSegments = [locale, ...segments]
    for (let index = 0; index < allSegments.length; index += 1) {
      current = path.join(current, allSegments[index])
      let stats
      try {
        stats = ops.lstatSync(current)
      } catch {
        return false
      }
      if (stats.isSymbolicLink()) return false
      if (index === allSegments.length - 1) {
        if (!stats.isFile()) return false
      } else {
        if (!stats.isDirectory()) return false
        const directoryIdentity = fileIdentity(stats)
        if (
          directoryIdentity &&
          privateConfigDirectoryIdentityHistory.has(directoryIdentity)
        ) {
          return false
        }
      }
    }
    return true
  }

  const fail = () => ({ ok: false, text: '' })

  const read = (absolutePath, { locale, relativePath } = {}) => {
    if (uncertain || guard.uncertain || !realDocsRoot) return fail()
    if (typeof relativePath !== 'string' || relativePath === '') return fail()

    try {
      const lexicalPath = path.resolve(absolutePath)
      const expectedLexical = path.resolve(
        lexicalDocsRoot,
        locale,
        ...relativePath.split('/')
      )
      if (pathKey(lexicalPath) !== pathKey(expectedLexical)) return fail()
      if (!isWithinPath(pathKey(lexicalDocsRoot), pathKey(lexicalPath))) {
        return fail()
      }

      const expectedReal = path.resolve(
        realDocsRoot,
        locale,
        ...relativePath.split('/')
      )
      if (!componentsAreSafe(locale, relativePath)) return fail()

      guard.refresh()
      if (guard.uncertain) {
        uncertain = true
        return fail()
      }

      // Check the path by metadata before opening. A private configuration
      // (or a hardlink to it) is never given an open handle at all.
      const preStats = ops.statSync(lexicalPath)
      if (!preStats.isFile()) return fail()
      const preIdentity = fileIdentity(preStats)
      if (!preIdentity) return fail()
      const preRealPath = path.resolve(ops.realpathSync(lexicalPath))
      if (pathKey(preRealPath) !== pathKey(expectedReal)) return fail()
      guard.refresh()
      if (guard.uncertain) {
        uncertain = true
        return fail()
      }
      if (guard.isBlocked(lexicalPath, preRealPath, preIdentity)) return fail()

      let descriptor = null
      try {
        descriptor = ops.openSync(lexicalPath, openFlags)

        const before = ops.fstatSync(descriptor)
        if (!before.isFile()) return fail()
        const identity = fileIdentity(before)
        if (!identity || identity !== preIdentity) return fail()

        const realPath = path.resolve(ops.realpathSync(lexicalPath))
        if (pathKey(realPath) !== pathKey(expectedReal)) return fail()

        const pathStats = ops.statSync(lexicalPath)
        const pathIdentity = fileIdentity(pathStats)
        if (!pathIdentity || pathIdentity !== identity) return fail()

        const pathLinkStats = ops.lstatSync(lexicalPath)
        if (pathLinkStats.isSymbolicLink() || !pathLinkStats.isFile()) {
          return fail()
        }

        guard.refresh()
        if (guard.uncertain) {
          uncertain = true
          return fail()
        }
        if (guard.isBlocked(lexicalPath, realPath, identity)) return fail()

        const text = ops.readFileSync(descriptor, 'utf8')

        guard.refresh()
        if (guard.uncertain) {
          uncertain = true
          return fail()
        }

        const after = ops.fstatSync(descriptor)
        const afterIdentity = fileIdentity(after)
        if (!afterIdentity || afterIdentity !== identity) return fail()

        const postRealPath = path.resolve(ops.realpathSync(lexicalPath))
        if (pathKey(postRealPath) !== pathKey(expectedReal)) return fail()

        const postStats = ops.statSync(lexicalPath)
        const postIdentity = fileIdentity(postStats)
        if (!postIdentity || postIdentity !== identity) return fail()

        const postLinkStats = ops.lstatSync(lexicalPath)
        if (postLinkStats.isSymbolicLink() || !postLinkStats.isFile()) {
          return fail()
        }
        if (!componentsAreSafe(locale, relativePath)) return fail()
        if (guard.isBlocked(lexicalPath, postRealPath, afterIdentity)) {
          return fail()
        }

        return { ok: true, text }
      } finally {
        if (descriptor !== null) {
          try {
            ops.closeSync(descriptor)
          } catch {
            // The read result is discarded above if post-read checks fail.
          }
        }
      }
    } catch {
      return fail()
    }
  }

  return {
    fs: ops,
    get uncertain() {
      return uncertain || guard.uncertain
    },
    read
  }
}
