import { lstat, open, realpath, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const englishDirName = 'en'
export const chineseDirName = 'zh-cn'
export const traditionalDirName = 'zh-tw'
export const localeNames = [englishDirName, chineseDirName, traditionalDirName]

export const readmeEnglish = 'README.md'
export const readmeChinese = 'README.zh-CN.md'
export const readmeTraditional = 'README.zh-TW.md'
export const readmeSources = [readmeChinese]
export const readmeTargets = {
  en: readmeEnglish,
  'zh-tw': readmeTraditional
}

const cjkPattern = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u
const chineseLocaleSuffix = /\.zh-cn\.md$/i
const localizedSuffix = /\.(?:zh-tw|en)\.md$/i
const localePrefixPattern = /^\/(en|zh-cn|zh-tw)(?=$|[/?#])/i

export function hasCjk(value) {
  return cjkPattern.test(String(value ?? ''))
}

// Root Markdown files are sources only when their file name explicitly marks
// them as Simplified Chinese. A Chinese proper name inside an English-named
// page is not evidence that the page is a Chinese source. Traditional and
// English generated files are never sources, even though their names can
// contain Han characters.
export function rootDocumentTargetName(fileName, locale = englishDirName) {
  if (typeof fileName !== 'string' || !fileName.endsWith('.md')) return null
  if (locale !== englishDirName && locale !== traditionalDirName) return null
  if (fileName === readmeEnglish || fileName === readmeChinese || fileName === readmeTraditional) {
    return null
  }
  if (localizedSuffix.test(fileName)) return null
  if (chineseLocaleSuffix.test(fileName)) {
    const base = fileName.slice(0, -'.zh-CN.md'.length)
    return locale === traditionalDirName ? `${base}.zh-TW.md` : `${base}.md`
  }
  if (hasCjk(fileName)) {
    const base = fileName.slice(0, -'.md'.length)
    return locale === traditionalDirName ? `${base}.zh-TW.md` : `${base}.en.md`
  }
  return null
}

export function rootDocumentTargets(fileName) {
  const english = rootDocumentTargetName(fileName, englishDirName)
  if (!english) return null
  return {
    en: english,
    'zh-tw': rootDocumentTargetName(fileName, traditionalDirName)
  }
}

function localeOfPathPrefix(prefix) {
  const normalized = String(prefix ?? '').toLowerCase()
  return normalized === 'en' || normalized === 'zh-tw' ? normalized : chineseDirName
}

// Locale prefixes are presentation details. Semantic comparison, protected
// feature comparison, and generated-content safety checks all compare the same
// route without its /en, /zh-cn, or /zh-tw prefix.
export function canonicalInternalHref(href) {
  if (typeof href !== 'string') return href
  const match = href.match(localePrefixPattern)
  if (!match) return href
  const rest = href.slice(match[0].length)
  if (rest === '') return '/'
  return rest.startsWith('?') || rest.startsWith('#') ? `/${rest}` : rest
}

// Rewrites only site-internal absolute links that already carry a locale
// prefix (or the language-chooser root). Relative links, external URLs, and
// unprefixed public assets are preserved; the checker reports unprefixed page
// routes instead of guessing whether a path is a page or an asset.
const assetExtension = /\.(?:avif|bmp|csv|css|eot|gif|ico|jpe?g|js|json|map|mjs|mp[34]|ogg|otf|pdf|png|svg|tar|ttf|txt|wasm|wav|webp|woff2?|xml|zip)(?=$|[?#])/i

export function localizeInternalHref(href, locale = englishDirName) {
  if (typeof href !== 'string') return href
  const target = localeNames.includes(locale) ? locale : englishDirName
  const localized = localeOfPathPrefix(target)
  const match = href.match(localePrefixPattern)
  if (match) {
    const rest = href.slice(match[0].length)
    if (rest === '') return `/${localized}/`
    const normalized = rest.startsWith('/') ? rest : `/${rest}`
    const pathPart = normalized.split(/[?#]/, 1)[0]
    if (assetExtension.test(pathPart)) return normalized
    return `/${localized}${normalized}`
  }
  if (href === '/') return `/${localized}/`
  return href
}

export function isLocalePrefixedHref(href, locale) {
  if (typeof href !== 'string') return false
  const match = href.match(localePrefixPattern)
  return Boolean(match) && localeOfPathPrefix(match[1]) === locale
}

export function isPathInside(parentDir, candidatePath) {
  const relative = path.relative(path.resolve(parentDir), path.resolve(candidatePath))
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

export function normalizeRelativePath(value) {
  return value.split(path.sep).join('/')
}

function operations(fs = {}) {
  return {
    lstat: fs.lstat ?? lstat,
    realpath: fs.realpath ?? realpath
  }
}

export async function resolveRealRoot(rootDir, fs = {}) {
  const ops = operations(fs)
  const resolved = path.resolve(rootDir)
  try {
    return await ops.realpath(resolved)
  } catch (error) {
    throw new Error(`无法解析仓库根目录的真实路径：${error.code ?? error.message}`)
  }
}

// Walks every component between rootDir and targetPath. Any symbolic link or
// Windows junction/reparse point is rejected, and a resolved existing path must
// still be inside the real root. Repeated calls are made immediately around
// read/write operations; this narrows, but cannot completely eliminate, TOCTOU
// races on filesystems without directory-handle-relative open semantics.
export async function assertSafePath(rootDir, targetPath, options = {}) {
  const ops = operations(options.fs)
  const label = options.label ?? '路径'
  const allowMissing = options.allowMissing === true
  const requireFile = options.requireFile === true
  const rootAbs = path.resolve(rootDir)
  const targetAbs = path.resolve(targetPath)

  if (!isPathInside(rootAbs, targetAbs)) {
    throw new Error(`${label} 不在仓库目录内：${targetAbs}`)
  }

  let rootReal
  try {
    rootReal = await ops.realpath(rootAbs)
  } catch (error) {
    throw new Error(`无法解析仓库根目录：${error.code ?? error.message}`)
  }

  const relative = path.relative(rootAbs, targetAbs)
  const safeTarget = relative === '' ? rootReal : path.join(rootReal, relative)
  if (!isPathInside(rootReal, safeTarget)) {
    throw new Error(`${label} 的真实路径越出仓库目录`)
  }
  if (relative === '') return safeTarget

  const parts = relative.split(path.sep).filter(Boolean)
  let current = rootReal
  let missing = false

  for (let index = 0; index < parts.length; index += 1) {
    current = path.join(current, parts[index])
    let info
    try {
      info = await ops.lstat(current)
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw new Error(`${label} 无法检查路径：${error.code ?? error.message}`)
      }
      if (!allowMissing) throw new Error(`${label} 不存在`)
      missing = true
      break
    }

    if (info.isSymbolicLink()) {
      throw new Error(`${label} 的路径包含符号链接或 junction，拒绝继续`)
    }
    const last = index === parts.length - 1
    if (!last && !info.isDirectory()) {
      throw new Error(`${label} 的父路径不是目录`)
    }
    if (last && requireFile && !info.isFile()) {
      throw new Error(`${label} 不是普通文件`)
    }
  }

  if (!missing) {
    let realTarget
    try {
      realTarget = await ops.realpath(safeTarget)
    } catch (error) {
      throw new Error(`${label} 无法解析真实路径：${error.code ?? error.message}`)
    }
    if (!isPathInside(rootReal, realTarget)) {
      throw new Error(`${label} 的真实路径越出仓库目录`)
    }
  }

  return safeTarget
}

export async function assertSafeDirectory(rootDir, dirPath, fs = {}) {
  const safe = await assertSafePath(rootDir, dirPath, {
    allowMissing: false,
    requireFile: false,
    label: '输出目录',
    fs
  })
  const ops = operations(fs)
  let info
  try {
    info = await ops.lstat(safe)
  } catch (error) {
    throw new Error(`输出目录无法检查：${error.code ?? error.message}`)
  }
  if (!info.isDirectory()) throw new Error('输出目录不是目录')
  return safe
}

function splitLines(text) {
  return text.match(/[^\n]*\n|[^\n]+$/g) ?? []
}

function lineEnding(line) {
  if (line.endsWith('\r\n')) return '\r\n'
  if (line.endsWith('\n')) return '\n'
  return ''
}

function decodeDoubleQuoted(value) {
  if (!value.endsWith('"')) throw new Error('双引号 YAML 字符串未闭合')
  const inner = value.slice(1, -1)
  if (inner.includes('\n') || inner.includes('\r')) {
    throw new Error('暂不支持跨行的 YAML 双引号字符串')
  }
  let output = ''
  for (let index = 0; index < inner.length; index += 1) {
    const character = inner[index]
    if (character !== '\\') {
      output += character
      continue
    }
    const next = inner[index + 1]
    if (next === undefined) throw new Error('YAML 双引号字符串以反斜杠结尾')
    if (next === '"' || next === '\\') output += next
    else if (next === 'n') output += '\n'
    else if (next === 't') output += '\t'
    else throw new Error(`暂不支持 YAML 转义 \\${next}`)
    index += 1
  }
  return output
}

function decodeSingleQuoted(value) {
  if (!value.endsWith("'")) throw new Error('单引号 YAML 字符串未闭合')
  const inner = value.slice(1, -1)
  if (inner.includes('\n') || inner.includes('\r')) {
    throw new Error('暂不支持跨行的 YAML 单引号字符串')
  }
  return inner.replace(/''/g, "'")
}

function parseQuotedValue(raw) {
  if (raw.startsWith('"')) {
    let escaped = false
    for (let index = 1; index < raw.length; index += 1) {
      const character = raw[index]
      if (escaped) {
        escaped = false
      } else if (character === '\\') {
        escaped = true
      } else if (character === '"') {
        return {
          quote: '"',
          value: decodeDoubleQuoted(raw.slice(0, index + 1)),
          end: index + 1
        }
      }
    }
    throw new Error('双引号 YAML 字符串未闭合')
  }
  if (raw.startsWith("'")) {
    let index = 1
    while (index < raw.length) {
      if (raw[index] === "'") {
        if (raw[index + 1] === "'") {
          index += 2
          continue
        }
        return {
          quote: "'",
          value: decodeSingleQuoted(raw.slice(0, index + 1)),
          end: index + 1
        }
      }
      index += 1
    }
    throw new Error('单引号 YAML 字符串未闭合')
  }
  return null
}

function plainScalarNeedsQuotes(value) {
  // YAML plain scalars may start with any non-ASCII letter. Keeping CJK values
  // unquoted preserves the source style while the extra checks below still
  // quote anything that could be misread as YAML syntax.
  if (!/^[A-Za-z0-9\u0080-\uFFFF]/u.test(value)) return true
  if (/[\r\n\t]/.test(value)) return true
  if (/: | #|:$/.test(value)) return true
  if (/^(?:true|false|null|yes|no|on|off|~)$/i.test(value)) return true
  if (/^[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[-+]?\d+)?$/i.test(value)) return true
  return false
}

export function encodeValue(value, quote) {
  if (/[\r\n]/.test(value)) throw new Error('翻译结果包含换行，无法安全写入 YAML frontmatter')
  if (quote === '"') return JSON.stringify(value)
  if (quote === "'") return `'${value.replace(/'/g, "''")}'`
  if (/^(?:\/|\.\.?\/)[A-Za-z0-9._~!$&'()*+,;=:@%/?#-]*$/.test(value)) return value
  return plainScalarNeedsQuotes(value) ? JSON.stringify(value) : value
}

function parseRecord(content) {
  const mapping = content.match(/^(\s*(?:-\s+)?)([A-Za-z0-9_.-]+):([ \t]*)(.*)$/)
  if (mapping) {
    const prefix = `${mapping[1]}${mapping[2]}:${mapping[3]}`
    const raw = mapping[4]
    if (raw.trim() === '') return null
    return { prefix, raw, key: mapping[2] }
  }

  const sequence = content.match(/^(\s*-\s+)(.*)$/)
  if (sequence) {
    if (/^[A-Za-z0-9_.-]+:/.test(sequence[2])) return null
    return { prefix: sequence[1], raw: sequence[2], key: null }
  }

  return null
}

export function collectUnsupported(frontmatter) {
  const lines = splitLines(frontmatter)
  const problems = []

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].replace(/\r?\n$/, '')
    if (
      /^[ \t]+\S/.test(line) &&
      !/^[ \t]*(?:-\s+|[A-Za-z0-9_.-]+:)/.test(line) &&
      hasCjk(line)
    ) {
      problems.push(`第 ${index + 1} 行的 YAML 多行标量含中文，暂不支持安全翻译`)
    }
    const mapping = line.match(/^(\s*(?:-\s+)?)([A-Za-z0-9_.-]+):[ \t]*(.*)$/)
    if (!mapping) continue
    const indent = (mapping[1].match(/^[ \t]*/)?.[0] ?? '').replace(/\t/g, '  ').length
    const raw = mapping[3]
    const block = raw.match(/^[|>][+-]?\s*$/)
    if (block) {
      const values = []
      let cursor = index + 1
      for (; cursor < lines.length; cursor += 1) {
        const next = lines[cursor].replace(/\r?\n$/, '')
        if (next.trim() === '') {
          values.push(next)
          continue
        }
        const nextIndent = (next.match(/^[ \t]*/)?.[0] ?? '').replace(/\t/g, '  ').length
        if (nextIndent <= indent) break
        values.push(next)
      }
      if (values.some((value) => hasCjk(value))) {
        problems.push(`第 ${index + 1} 行的 YAML 块字符串含中文，暂不支持安全翻译`)
      }
      index = cursor - 1
      continue
    }
    if ((raw.startsWith('[') || raw.startsWith('{')) && hasCjk(raw)) {
      problems.push(`第 ${index + 1} 行的 YAML 流式集合含中文，暂不支持安全翻译`)
    }
    if ((raw.startsWith('&') || raw.startsWith('*') || raw.startsWith('!')) && hasCjk(raw)) {
      problems.push(`第 ${index + 1} 行的 YAML 锚点、别名或标签含中文，暂不支持安全翻译`)
    }
  }

  return problems
}

export function parseFrontmatterScalars(frontmatter) {
  if (typeof frontmatter !== 'string') throw new TypeError('frontmatter 必须是字符串')
  const lines = splitLines(frontmatter)
  const records = []

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const ending = lineEnding(line)
    const content = line.slice(0, line.length - ending.length)
    const parsed = parseRecord(content)
    if (!parsed) continue

    let raw = parsed.raw
    let suffix = ''
    const trailing = raw.match(/[ \t]+$/)
    if (trailing) {
      suffix = trailing[0]
      raw = raw.slice(0, -suffix.length)
    }
    if (raw.trim() === '') continue

    let quote = null
    let value
    let valueLength
    try {
      const quoted = parseQuotedValue(raw)
      if (quoted) {
        quote = quoted.quote
        value = quoted.value
        valueLength = quoted.end
        if (raw.slice(valueLength) !== '') {
          throw new Error('引号字符串后存在不支持的内容')
        }
      } else {
        if (raw.startsWith('|') || raw.startsWith('>') || raw.startsWith('[') || raw.startsWith('{')) {
          continue
        }
        if (raw.startsWith('&') || raw.startsWith('*') || raw.startsWith('!')) continue
        value = raw
        valueLength = raw.length
      }
    } catch (error) {
      if (hasCjk(raw)) {
        records.push({ error: error.message, line: index + 1 })
      }
      continue
    }

    records.push({
      line: index,
      content,
      ending,
      prefix: parsed.prefix,
      quote,
      value,
      suffix,
      key: parsed.key,
      valueStart: parsed.prefix.length,
      valueEnd: parsed.prefix.length + valueLength,
      localize: isLocaleLinkValue(value)
    })
  }

  return { lines, records }
}


export function isPathLikeValue(value) {
  return /^(?:[A-Za-z][A-Za-z0-9+.-]*:|\/|\.{1,2}\/|#)/.test(value)
}

function isLocaleLinkValue(value) {
  return value === '/' || /^\/(?:en|zh-cn|zh-tw)(?=$|[/?#])/i.test(value)
}

export const SAFE_MARKDOWN_READ_FAILED = 'SAFE_MARKDOWN_READ_FAILED'

const documentModelDirectory = path.dirname(fileURLToPath(import.meta.url))
const moduleConfigPath = path.join(documentModelDirectory, 'config.yaml')
const globalProtectedIdentities = new Set()
const rootProtectedIdentities = new Map()

function safeReadFailure() {
  const error = new Error('无法安全读取 Markdown 源文件')
  error.code = SAFE_MARKDOWN_READ_FAILED
  return error
}

function safeReadOptions(options) {
  return options !== null && typeof options === 'object' && !Array.isArray(options)
}

function fileOperations(fs = {}) {
  return {
    lstat: typeof fs.lstat === 'function' ? fs.lstat : lstat,
    stat: typeof fs.stat === 'function' ? fs.stat : stat,
    realpath: typeof fs.realpath === 'function' ? fs.realpath : realpath,
    open: typeof fs.open === 'function' ? fs.open : open
  }
}

function statIdentity(stats) {
  if (!stats || typeof stats.isFile !== 'function' || !stats.isFile()) return null
  const device = Number(stats.dev)
  const inode = Number(stats.ino)
  if (!Number.isFinite(device) || !Number.isFinite(inode) || inode === 0) return null
  return `${device}:${inode}`
}

function validateProtectedIdentitySet(value) {
  if (value === undefined) return undefined
  if (
    value === null ||
    typeof value.has !== 'function' ||
    typeof value.add !== 'function'
  ) {
    throw safeReadFailure()
  }
  return value
}

function protectedPathEntries(rootReal, extraPaths) {
  const entries = [
    { path: moduleConfigPath, scope: 'global' },
    { path: path.join(rootReal, 'tools', 'config.yaml'), scope: 'root' }
  ]

  const envPath = process.env.AI_MODEL_CONFIG
  if (envPath !== undefined) {
    const trimmed = envPath.trim()
    if (trimmed) {
      if (/[\u0000-\u001f\u007f]/.test(trimmed)) throw safeReadFailure()
      let resolved
      try {
        resolved = path.resolve(trimmed)
      } catch {
        throw safeReadFailure()
      }
      entries.push({ path: resolved, scope: 'global' })
    }
  }

  if (extraPaths !== undefined) {
    if (!Array.isArray(extraPaths)) throw safeReadFailure()
    for (const value of extraPaths) {
      if (typeof value !== 'string' || !value.trim()) throw safeReadFailure()
      if (/[\u0000-\u001f\u007f]/.test(value)) throw safeReadFailure()
      let resolved
      try {
        resolved = path.isAbsolute(value) ? path.resolve(value) : path.resolve(rootReal, value)
      } catch {
        throw safeReadFailure()
      }
      entries.push({ path: resolved, scope: 'global' })
    }
  }

  const seen = new Set()
  return entries.filter((entry) => {
    const key = `${entry.scope}\u0000${path.resolve(entry.path)}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

async function refreshProtectedIdentities(rootReal, entries, ops, externalIdentities) {
  const rootSet = rootProtectedIdentities.get(rootReal) ?? new Set()
  rootProtectedIdentities.set(rootReal, rootSet)

  for (const entry of entries) {
    let info
    try {
      info = await ops.lstat(entry.path)
    } catch (error) {
      if (error?.code === 'ENOENT') continue
      throw safeReadFailure()
    }
    if (!info) throw safeReadFailure()

    let realPath
    try {
      realPath = await ops.realpath(entry.path)
    } catch (error) {
      if (error?.code === 'ENOENT') continue
      throw safeReadFailure()
    }

    let stats
    try {
      stats = await ops.stat(realPath)
    } catch {
      throw safeReadFailure()
    }
    const identity = statIdentity(stats)
    if (!identity) throw safeReadFailure()

    if (entry.scope === 'global') globalProtectedIdentities.add(identity)
    else rootSet.add(identity)
    if (externalIdentities) externalIdentities.add(identity)
  }

  return { global: globalProtectedIdentities, root: rootSet }
}

async function recheckMarkdownPath(rootReal, candidate, ops, expectedIdentity) {
  try {
    await assertSafePath(rootReal, candidate, {
      allowMissing: false,
      requireFile: true,
      fs: { lstat: ops.lstat, realpath: ops.realpath }
    })
    const realPath = await ops.realpath(candidate)
    if (!isPathInside(rootReal, realPath)) throw safeReadFailure()
    const stats = await ops.stat(candidate)
    if (statIdentity(stats) !== expectedIdentity) throw safeReadFailure()
  } catch (error) {
    throw safeReadFailure()
  }
}

/**
 * Reads one Markdown source without following symlinks, escaping root, or
 * reading a protected model configuration through a hard link.
 *
 * Options: rootDir (required), protectedPaths, protectedIdentities (a mutable
 * Set of identity strings), fs ({ lstat, stat, realpath, open }). Returns the
 * utf8 text. Failures use code SAFE_MARKDOWN_READ_FAILED and a fixed message
 * that never contains a path, configuration value, or source content.
 */
export async function readSafeMarkdownSource(filePath, options = {}) {
  try {
    if (!safeReadOptions(options)) throw safeReadFailure()
    if (typeof filePath !== 'string' || !filePath) throw safeReadFailure()
    if (typeof options.rootDir !== 'string' || !options.rootDir) throw safeReadFailure()

    const externalIdentities = validateProtectedIdentitySet(options.protectedIdentities)
    const ops = fileOperations(options.fs)
    const rootReal = await resolveRealRoot(options.rootDir, {
      lstat: ops.lstat,
      realpath: ops.realpath
    })
    const candidate = path.resolve(filePath)
    const safeCandidate = await assertSafePath(rootReal, candidate, {
      allowMissing: false,
      requireFile: true,
      fs: { lstat: ops.lstat, realpath: ops.realpath }
    })

    const protectedEntries = protectedPathEntries(rootReal, options.protectedPaths)
    const beforeProtected = await refreshProtectedIdentities(
      rootReal,
      protectedEntries,
      ops,
      externalIdentities
    )

    let handle
    try {
      handle = await ops.open(safeCandidate, 'r')
    } catch {
      throw safeReadFailure()
    }

    try {
      const openedStats = await handle.stat()
      const openedIdentity = statIdentity(openedStats)
      if (!openedIdentity) throw safeReadFailure()

      await recheckMarkdownPath(rootReal, safeCandidate, ops, openedIdentity)
      if (
        beforeProtected.global.has(openedIdentity) ||
        beforeProtected.root.has(openedIdentity) ||
        externalIdentities?.has(openedIdentity)
      ) {
        throw safeReadFailure()
      }

      let text
      try {
        text = await handle.readFile({ encoding: 'utf8' })
      } catch {
        throw safeReadFailure()
      }
      if (typeof text !== 'string') throw safeReadFailure()

      await recheckMarkdownPath(rootReal, safeCandidate, ops, openedIdentity)
      const afterProtected = await refreshProtectedIdentities(
        rootReal,
        protectedEntries,
        ops,
        externalIdentities
      )
      if (
        afterProtected.global.has(openedIdentity) ||
        afterProtected.root.has(openedIdentity) ||
        externalIdentities?.has(openedIdentity)
      ) {
        throw safeReadFailure()
      }

      return text
    } finally {
      try {
        await handle.close()
      } catch {
        // Closing a verified read handle does not affect the returned content.
      }
    }
  } catch (error) {
    if (error?.code === SAFE_MARKDOWN_READ_FAILED) throw error
    throw safeReadFailure()
  }
}
