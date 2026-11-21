import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse as parseYaml } from 'yaml'
import {
  sanitizeMarkdownForModel,
  splitMarkdownDocument
} from '../../tools/markdown-safety.mjs'
import { createSafeMarkdownReader } from './navigation-safe-fs.mjs'

/*
 * Navigation is derived from the Markdown tree, never from a hand-maintained
 * list in a locale config. The Simplified Chinese edition is the source of
 * truth; a page is public in the navigation only when the same relative path
 * exists in all three editions, is readable, and is not marked private in any
 * edition. That keeps the three nav/sidebar structures identical while making
 * new pages and content:sync-created indexes discoverable without edits.
 *
 * Titles come from the edition's own frontmatter `title`, then its first
 * visible H1, then a deterministic path-name fallback. Ordering uses the
 * source edition's optional numeric `order` and otherwise the relative path.
 * The original About/Projects/Notes top-level order is kept as a default.
 */

const LOCALES = Object.freeze(['en', 'zh-cn', 'zh-tw'])
const SOURCE_LOCALE = 'zh-cn'

const defaultDocsRoot = path.resolve(
  fileURLToPath(new URL('..', import.meta.url))
)

const legacyTopLevelOrder = new Map([
  ['About', 0],
  ['Projects', 1],
  ['Notes', 2]
])

// `.vitepress` and dot paths are skipped by VitePress' page glob as well.
// `public`/`dist`/`node_modules` are never page sources.
const ignoredDirectories = new Set([
  '.git',
  '.vitepress',
  'dist',
  'node_modules',
  'public'
])

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0
}

function isMapping(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isIndexFile(relativePath) {
  return relativePath === 'index.md' || relativePath.endsWith('/index.md')
}

function parentDirectory(value) {
  const separator = value.lastIndexOf('/')
  return separator === -1 ? '' : value.slice(0, separator)
}

function lastSegment(value) {
  const separator = value.lastIndexOf('/')
  return separator === -1 ? value : value.slice(separator + 1)
}

function stripHtmlComments(text) {
  return String(text)
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<!--[\s\S]*$/g, '')
}

// Content inside raw script/style/pre/textarea/template blocks is not visible prose and
// must never supply a navigation title or excerpt. An unterminated block is
// removed to the end of the document.
function stripRawHtmlBlocks(text) {
  return String(text)
    .replace(
      /<(script|style|pre|textarea|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,
      ''
    )
    .replace(/<(script|style|pre|textarea|template)\b[^>]*>[\s\S]*$/gi, '')
}

function plainInlineText(value) {
  return stripHtmlComments(stripRawHtmlBlocks(String(value ?? '')))
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\[[^\]]*\]/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/<[^>]*>/g, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/~~([^~]+)~~/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function truncateText(text, limit = 180) {
  const characters = Array.from(text)
  if (characters.length <= limit) return text
  return `${characters.slice(0, limit).join('').trimEnd()}…`
}

function humanizeSegment(value) {
  const cleaned = String(value)
    .replace(/\.md$/i, '')
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!cleaned) return String(value)
  return /^[a-z]/.test(cleaned)
    ? `${cleaned[0].toUpperCase()}${cleaned.slice(1)}`
    : cleaned
}

// Unknown or structural values are not treated as "not true". Only the
// explicit public forms are accepted; everything else keeps the page hidden.
function isPublicFlagState(frontmatter) {
  for (const [key, value] of Object.entries(frontmatter)) {
    const name = key.toLowerCase()
    if (name !== 'draft' && name !== 'private') continue
    if (value === false || value === 0) continue
    if (
      typeof value === 'string' &&
      ['false', 'no', 'off'].includes(value.trim().toLowerCase())
    ) {
      continue
    }
    return false
  }
  return true
}

// Comments and fenced code are blanked line by line so neither can supply a
// visible heading or an index excerpt. The sanitizer has already removed
// private blocks and ordinary HTML comments outside code; this also removes
// comment text that is literal inside code or any residual block.
function visibleLines(body) {
  const text = stripHtmlComments(stripRawHtmlBlocks(body)).replace(/\r\n?/g, '\n')
  const lines = text.split('\n')
  const output = []
  let fence = null

  for (const line of lines) {
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})/)
    if (fence) {
      if (
        marker &&
        marker[1][0] === fence.character &&
        marker[1].length >= fence.length
      ) {
        fence = null
      }
      output.push('')
      continue
    }
    if (marker) {
      fence = { character: marker[1][0], length: marker[1].length }
      output.push('')
      continue
    }
    output.push(line)
  }

  return output
}

function isIndentedCode(line) {
  return /^(?: {4}|\t)/.test(line)
}

function isAtxHeading(line) {
  return /^ {0,3}#{1,6}(?:[ \t]+|$)/.test(line)
}

function isBlockStarter(line) {
  const trimmed = line.trim()
  if (!trimmed) return false
  if (isIndentedCode(line)) return true
  if (isAtxHeading(line)) return true
  if (/^ {0,3}(?:[-*+]|\d{1,9}[.)])(?:[ \t]+|$)/.test(line)) return true
  if (/^ {0,3}>/.test(line)) return true
  if (/^ {0,3}\|/.test(line)) return true
  if (/^ {0,3}:{3,}/.test(line)) return true
  if (/^ {0,3}</.test(line)) return true
  if (/^ {0,3}(?:-{3,}|\*{3,}|_{3,})[ \t]*$/.test(line)) return true
  if (/^ {0,3}=+[ \t]*$/.test(line)) return true
  if (/^ {0,3}(?:import|export)\b/.test(line)) return true
  if (/^ {0,3}\[[^\]]+\]:/.test(line)) return true
  return false
}

function findFirstHeading(lines) {
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (!line.trim() || isIndentedCode(line)) continue

    const atx = line.match(/^ {0,3}(#{1,6})(?:[ \t]+(.*?))?[ \t]*$/)
    if (atx) {
      if (atx[1].length !== 1) continue
      const content = (atx[2] ?? '')
        .replace(/[ \t]+#+[ \t]*$/, '')
        .trim()
      const text = plainInlineText(content)
      if (text) return { text, start: index, end: index }
      continue
    }

    if (isBlockStarter(line)) continue
    const next = lines[index + 1]
    if (next && /^ {0,3}=+[ \t]*$/.test(next)) {
      const text = plainInlineText(line)
      if (text) return { text, start: index, end: index + 1 }
    }
  }
  return null
}

function firstParagraph(lines, heading) {
  let index = heading ? heading.end + 1 : 0

  for (; index < lines.length; index += 1) {
    const line = lines[index]
    if (!line.trim() || isBlockStarter(line)) continue

    const parts = [line.trim()]
    index += 1
    while (index < lines.length) {
      const next = lines[index]
      if (
        !next.trim() ||
        isBlockStarter(next) ||
        /^ {0,3}=+[ \t]*$/.test(next)
      ) {
        break
      }
      parts.push(next.trim())
      index += 1
    }

    return truncateText(plainInlineText(parts.join(' ')))
  }

  return ''
}

function hiddenPage(relativePath, status) {
  return {
    status,
    relPath: relativePath,
    title: '',
    excerpt: '',
    order: null,
    private: true
  }
}

function parseMarkdownPage(source, relativePath = '') {
  const text = String(source)

  // The shared sanitizer removes closed private blocks together with their
  // contents, ordinary HTML comments, and private frontmatter keys. It throws
  // for unclosed/nested/stray markers, true or ambiguous private/draft flags,
  // YAML anchors/aliases/merge keys, malformed YAML, and other unsafe input;
  // any such page is hidden entirely.
  let sanitized
  try {
    sanitized = sanitizeMarkdownForModel(text)
  } catch {
    return hiddenPage(relativePath, 'blocked')
  }

  let document
  try {
    document = splitMarkdownDocument(sanitized)
  } catch {
    return hiddenPage(relativePath, 'blocked')
  }

  let frontmatter = {}
  if (document.frontmatter !== null) {
    try {
      frontmatter = parseYaml(document.frontmatter) ?? {}
    } catch {
      return hiddenPage(relativePath, 'blocked')
    }
    if (!isMapping(frontmatter)) {
      return hiddenPage(relativePath, 'blocked')
    }
  }
  if (!isPublicFlagState(frontmatter)) {
    return hiddenPage(relativePath, 'blocked')
  }

  const lines = visibleLines(document.body)
  const heading = findFirstHeading(lines)
  const frontmatterTitle =
    typeof frontmatter.title === 'string'
      ? plainInlineText(frontmatter.title)
      : ''
  const title = frontmatterTitle || heading?.text || ''
  const description =
    typeof frontmatter.description === 'string'
      ? truncateText(plainInlineText(frontmatter.description))
      : ''
  const excerpt = description || firstParagraph(lines, heading)
  const order =
    typeof frontmatter.order === 'number' && Number.isFinite(frontmatter.order)
      ? frontmatter.order
      : null

  // A page whose only body content was a private block (and which has no
  // public frontmatter title or description) has nothing that may be exposed
  // as a directory entry. Do not fall back to the file name for it.
  if (
    !title &&
    !excerpt &&
    document.body.trim() === '' &&
    sanitized !== text
  ) {
    return hiddenPage(relativePath, 'blocked')
  }

  return {
    status: 'ok',
    relPath: relativePath,
    title,
    excerpt,
    order,
    private: false
  }
}

function scanLocale(locale, docsRoot, reader) {
  const pages = new Map()
  const localeRoot = path.join(docsRoot, locale)
  const fsOps = reader.fs

  let rootInfo
  try {
    rootInfo = fsOps.lstatSync(localeRoot)
  } catch {
    return pages
  }
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) return pages

  const walk = (absoluteDirectory, relativeDirectory) => {
    let entries
    try {
      entries = fsOps.readdirSync(absoluteDirectory, { withFileTypes: true })
    } catch {
      return
    }
    entries.sort((left, right) => compareText(left.name, right.name))

    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue
      if (entry.isSymbolicLink()) continue

      const relativePath = relativeDirectory
        ? `${relativeDirectory}/${entry.name}`
        : entry.name

      if (entry.isDirectory()) {
        if (ignoredDirectories.has(entry.name)) continue
        walk(path.join(absoluteDirectory, entry.name), relativePath)
        continue
      }

      if (!entry.isFile() || !entry.name.endsWith('.md')) continue

      const result = reader.read(path.join(absoluteDirectory, entry.name), {
        locale,
        relativePath
      })
      if (!result.ok) {
        pages.set(relativePath, hiddenPage(relativePath, 'unreadable'))
        continue
      }
      pages.set(relativePath, parseMarkdownPage(result.text, relativePath))
    }
  }

  walk(localeRoot, '')
  return pages
}

function isPublicPage(page) {
  return Boolean(page && page.status === 'ok' && !page.private)
}

function fallbackTitle(node) {
  const segment = lastSegment(node.key)
  return humanizeSegment(segment || node.key)
}

function pickTitle(node, locale) {
  const title = node.titles?.[locale]
  return typeof title === 'string' && title.trim()
    ? title
    : fallbackTitle(node)
}

function sectionLink(locale, key) {
  return `/${locale}/${key}/`
}

function pageLink(locale, key) {
  return `/${locale}/${key}`
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function effectiveOrder(node) {
  if (node.order !== null) return node.order
  if (node.type === 'section' && !node.key.includes('/')) {
    const legacy = legacyTopLevelOrder.get(node.key)
    if (legacy !== undefined) return legacy
  }
  return null
}

function compareNodes(left, right) {
  const leftOrder = effectiveOrder(left)
  const rightOrder = effectiveOrder(right)
  if (leftOrder !== null && rightOrder === null) return -1
  if (leftOrder === null && rightOrder !== null) return 1
  if (leftOrder !== null && rightOrder !== null && leftOrder !== rightOrder) {
    return leftOrder < rightOrder ? -1 : 1
  }
  return compareText(left.sortPath, right.sortPath)
}

function finalizeNodes(nodes) {
  const byKey = new Map()
  for (const node of nodes) {
    const existing = byKey.get(node.key)
    if (!existing) {
      byKey.set(node.key, node)
      continue
    }
    // `index.md` owns a directory route; a sibling `<dir>.md` would produce
    // the same reader-facing entry, so the section wins deterministically.
    if (existing.type === 'page' && node.type === 'section') {
      byKey.set(node.key, node)
    }
  }

  const result = [...byKey.values()]
  result.sort(compareNodes)
  for (const node of result) {
    node.children = finalizeNodes(node.children)
  }
  return result
}

function attachMetadata(nodes, pagesByLocale) {
  for (const node of nodes) {
    if (node.type === 'section' && !node.hasIndex) {
      const fallback = fallbackTitle(node)
      node.titles = { en: fallback, 'zh-cn': fallback, 'zh-tw': fallback }
      node.excerpts = { en: '', 'zh-cn': '', 'zh-tw': '' }
    } else {
      const titles = {}
      const excerpts = {}
      const fallback = fallbackTitle(node)
      for (const locale of LOCALES) {
        const page = pagesByLocale.get(locale).get(node.fileRel)
        titles[locale] = isPublicPage(page) && page.title
          ? page.title
          : fallback
        excerpts[locale] = isPublicPage(page) ? page.excerpt || '' : ''
      }
      node.titles = titles
      node.excerpts = excerpts
    }
    attachMetadata(node.children, pagesByLocale)
  }
}

function buildCatalog(options = {}) {
  const docsRoot = path.resolve(options.docsRoot ?? defaultDocsRoot)
  let reader
  try {
    reader = createSafeMarkdownReader({
      docsRoot,
      env: options.env,
      cwd: options.cwd,
      fs: options.fs,
      privateConfigPaths: options.privateConfigPaths
    })
  } catch {
    return []
  }
  if (reader.uncertain) return []

  const pagesByLocale = new Map(
    LOCALES.map((locale) => [locale, scanLocale(locale, docsRoot, reader)])
  )
  // If private-configuration metadata became uncertain while reading, publish
  // no navigation or excerpts at all rather than a partial tree.
  if (reader.uncertain) return []
  const sourcePages = pagesByLocale.get(SOURCE_LOCALE)

  const isPublicEverywhere = (relativePath) => {
    for (const locale of LOCALES) {
      if (!isPublicPage(pagesByLocale.get(locale).get(relativePath))) {
        return false
      }
    }
    return true
  }

  // A private or unreadable section index hides its whole subtree. That is a
  // predictable privacy boundary and avoids publishing links under a hidden
  // section in one edition but not another.
  const blockedDirectories = new Set()
  for (const relativePath of sourcePages.keys()) {
    if (relativePath === 'index.md' || !isIndexFile(relativePath)) continue
    if (!isPublicEverywhere(relativePath)) {
      blockedDirectories.add(parentDirectory(relativePath))
    }
  }

  const hasBlockedAncestor = (relativePath) => {
    const segments = relativePath.split('/')
    for (let index = 1; index < segments.length; index += 1) {
      if (blockedDirectories.has(segments.slice(0, index).join('/'))) {
        return true
      }
    }
    return false
  }

  /** @type {Map<string, { key: string, hasIndex: boolean, indexRel: string | null, order: number | null }>} */
  const directoryInfos = new Map()
  const pagesByDirectory = new Map()

  const ensureDirectory = (key) => {
    if (!key) return
    const segments = key.split('/')
    let current = ''
    for (const segment of segments) {
      current = current ? `${current}/${segment}` : segment
      if (!directoryInfos.has(current)) {
        directoryInfos.set(current, {
          key: current,
          hasIndex: false,
          indexRel: null,
          order: null
        })
      }
    }
  }

  const addPage = (key) => {
    const directory = parentDirectory(key)
    ensureDirectory(directory)
    if (!pagesByDirectory.has(directory)) pagesByDirectory.set(directory, [])
    pagesByDirectory.get(directory).push(key)
  }

  const sourcePaths = [...sourcePages.keys()].sort(compareText)
  for (const relativePath of sourcePaths) {
    if (relativePath === 'index.md') continue
    if (!isPublicEverywhere(relativePath)) continue
    if (hasBlockedAncestor(relativePath)) continue

    if (isIndexFile(relativePath)) {
      const directory = parentDirectory(relativePath)
      ensureDirectory(directory)
      const info = directoryInfos.get(directory)
      info.hasIndex = true
      info.indexRel = relativePath
      info.order = sourcePages.get(relativePath).order
      continue
    }

    addPage(relativePath.slice(0, -3))
  }

  const buildPageNode = (key) => {
    const sourcePage = sourcePages.get(`${key}.md`)
    return {
      type: 'page',
      key,
      hasIndex: false,
      fileRel: `${key}.md`,
      order: sourcePage ? sourcePage.order : null,
      sortPath: `${key}.md`,
      titles: null,
      excerpts: null,
      children: []
    }
  }

  const buildDirectoryNode = (key) => {
    const info = directoryInfos.get(key)
    if (!info) return null

    const children = []
    for (const childKey of directoryInfos.keys()) {
      if (childKey !== key && parentDirectory(childKey) === key) {
        const child = buildDirectoryNode(childKey)
        if (child) children.push(child)
      }
    }
    for (const pageKey of pagesByDirectory.get(key) ?? []) {
      children.push(buildPageNode(pageKey))
    }

    return {
      type: 'section',
      key,
      hasIndex: info.hasIndex,
      fileRel: info.indexRel,
      order: info.hasIndex ? info.order : null,
      sortPath: `${key}/`,
      titles: null,
      excerpts: null,
      children
    }
  }

  const topLevel = []
  for (const key of directoryInfos.keys()) {
    if (parentDirectory(key) !== '') continue
    const node = buildDirectoryNode(key)
    if (node) topLevel.push(node)
  }
  for (const pageKey of pagesByDirectory.get('') ?? []) {
    topLevel.push(buildPageNode(pageKey))
  }

  const result = finalizeNodes(topLevel)
  attachMetadata(result, pagesByLocale)
  return result
}

// All three locale configs are evaluated in one process. Build the tree once
// per docs root; the data loader deliberately calls buildCatalog directly so
// its dev watch can refresh after Markdown edits.
const navigationCatalogCache = new Map()

function catalogForNavigation(options = {}) {
  const hasCustomOptions =
    options.docsRoot !== undefined ||
    options.env !== undefined ||
    options.cwd !== undefined ||
    options.fs !== undefined ||
    options.privateConfigPaths !== undefined
  if (hasCustomOptions) return buildCatalog(options)

  const docsRoot = path.resolve(defaultDocsRoot)
  if (!navigationCatalogCache.has(docsRoot)) {
    navigationCatalogCache.set(docsRoot, buildCatalog({ docsRoot }))
  }
  return navigationCatalogCache.get(docsRoot)
}

function sidebarItem(node, locale) {
  const item = { text: pickTitle(node, locale) }
  if (node.type === 'section') {
    if (node.hasIndex) item.link = sectionLink(locale, node.key)
  } else {
    item.link = pageLink(locale, node.key)
  }
  if (node.children.length > 0) {
    item.items = node.children.map((child) => sidebarItem(child, locale))
  }
  return item
}

export function buildLocaleNavigation(locale, options = {}) {
  if (!LOCALES.includes(locale)) {
    throw new TypeError(`Unsupported locale for navigation: ${locale}`)
  }

  const nodes = catalogForNavigation(options)
  const nav = []
  const sidebar = {}

  for (const node of nodes) {
    if (node.type === 'page') {
      nav.push({
        text: pickTitle(node, locale),
        link: pageLink(locale, node.key),
        activeMatch: `^/${locale}/${escapeRegExp(node.key)}(?:/|$)`
      })
      continue
    }

    if (node.hasIndex) {
      nav.push({
        text: pickTitle(node, locale),
        link: sectionLink(locale, node.key),
        activeMatch: `^/${locale}/${escapeRegExp(node.key)}/`
      })
    }
    // A directory without a landing page is not a nav destination, but its
    // sidebar group still keeps directly addressed child pages navigable.
    sidebar[`/${locale}/${node.key}/`] = [sidebarItem(node, locale)]
  }

  return { nav, sidebar }
}

// Used by the Notes index component. Returns a serializable tree containing
// all three editions' titles and excerpts; the component selects the current
// locale. Hidden pages are absent from the tree entirely.
export function buildNotesCatalog(options = {}) {
  const nodes = buildCatalog(options)
  const notes = nodes.find((node) => node.key === 'Notes')
  if (!notes || notes.type !== 'section' || !notes.hasIndex) return null
  return notes
}
