import { randomBytes } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createMarkdownRenderer } from 'vitepress'
import {
  canonicalInternalHref,
  englishDirName,
  isLocalePrefixedHref,
  localeNames,
  localizeInternalHref,
  parseFrontmatterScalars
} from './document-model.mjs'
import {
  isAlias,
  isMap,
  isPair,
  isScalar,
  isSeq,
  parseDocument
} from 'yaml'

const safetyHere = path.dirname(fileURLToPath(import.meta.url))
const defaultParserDocsDir = path.join(safetyHere, '..', 'docs')
const parserCache = new Map()

export function getMarkdownParser(docsDir = defaultParserDocsDir) {
  if (!parserCache.has(docsDir)) {
    parserCache.set(docsDir, createMarkdownRenderer(docsDir, { math: true }, '/'))
  }
  return parserCache.get(docsDir)
}

// Content sent to the local model must not include private notes. HTML comments
// are treated as private by default. An explicit private block
// (`<!-- private:start -->` ... `<!-- private:end -->`, or
// `<!-- private -->` ... `<!-- /private -->`) is removed together with its
// contents. Fenced code and inline code keep their literal contents, because a
// code example such as `<!-- example -->` is code, not a private note.
//
// Frontmatter is parsed as YAML instead of being matched line by line: quoted
// keys, flow collections, block scalars, tags, and nesting must all resolve to
// the same fields the site itself would see. Constructs that cannot be removed
// without changing the meaning of the document (anchors, aliases, merge keys,
// complex keys, unknown tags, malformed YAML, directives) fail closed before the
// model is called. Error messages never include frontmatter values.
const privateStartPatterns = [
  /^\s*@?private:start\s*$/i,
  /^\s*@?private\s*$/i
]
const privateEndPatterns = [
  /^\s*@?private:end\s*$/i,
  /^\s*@?endprivate\s*$/i,
  /^\s*\/private\s*$/i
]

const privateFrontmatterKeys = new Set([
  'private',
  'private_data',
  'secret',
  'secrets',
  'password',
  'passwords',
  'token',
  'tokens',
  'apikey',
  'api_key',
  'accesstoken',
  'access_token',
  'refreshtoken',
  'refresh_token',
  'sensitive'
])

const defaultYamlTagPrefix = 'tag:yaml.org,2002:'
const mergeKey = '<<'
const mergeTag = `${defaultYamlTagPrefix}merge`

export class PrivacyError extends Error {
  constructor(message) {
    super(message)
    this.name = 'PrivacyError'
    this.code = 'OMP_PRIVATE_CONTENT'
  }
}

function isPrivateKey(key) {
  return privateFrontmatterKeys.has(key.toLowerCase().replace(/-/g, '_'))
}

function lineEndAt(text, start) {
  const newline = text.indexOf('\n', start)
  return newline === -1 ? text.length : newline + 1
}

function standaloneComment(text, start, end) {
  const lineStart = text.lastIndexOf('\n', start - 1) + 1
  const endOfLine = lineEndAt(text, end)
  const before = text.slice(lineStart, start)
  const after = text.slice(end, endOfLine)
  return {
    start: before.trim() === '' ? lineStart : start,
    end: after.trim() === '' ? endOfLine : end,
    lineStart,
    endOfLine
  }
}

function fenceRanges(text) {
  const ranges = []
  let position = 0
  let fence = null

  while (position < text.length) {
    const lineEnd = lineEndAt(text, position)
    const line = text.slice(position, lineEnd).replace(/\r?\n$/, '')

    if (!fence) {
      const opening = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/)
      if (opening) {
        fence = { start: position, character: opening[1][0], length: opening[1].length }
      }
    } else {
      const character = fence.character === '`' ? '`' : '~'
      const closing = new RegExp(`^ {0,3}${character}{${fence.length},}[ \\t]*$`)
      if (closing.test(line)) {
        ranges.push({ start: fence.start, end: lineEnd })
        fence = null
      }
    }

    position = lineEnd
    if (lineEnd === text.length) break
  }

  if (fence) ranges.push({ start: fence.start, end: text.length })
  return ranges
}

function inRanges(position, ranges) {
  return ranges.find((range) => position >= range.start && position < range.end)
}

function findComments(text, options = {}) {
  const includeCode = options.includeCode === true
  const fences = includeCode ? [] : fenceRanges(text)
  const comments = []
  let position = 0

  while (position < text.length) {
    const fence = inRanges(position, fences)
    if (fence) {
      position = fence.end
      continue
    }

    if (!includeCode && text.startsWith('`', position)) {
      let runLength = 1
      while (text[position + runLength] === '`') runLength += 1
      const marker = '`'.repeat(runLength)
      const closing = text.indexOf(marker, position + runLength)
      if (closing !== -1) {
        position = closing + runLength
        continue
      }
    }

    if (text.startsWith('<!--', position)) {
      const closing = text.indexOf('-->', position + 4)
      if (closing === -1) {
        throw new PrivacyError('Unclosed HTML comment; refusing to send page content to the model')
      }
      comments.push({
        start: position,
        end: closing + 3,
        content: text.slice(position + 4, closing)
      })
      position = closing + 3
      continue
    }

    position += 1
  }

  return comments
}

function isPrivateStart(comment) {
  return privateStartPatterns.some((pattern) => pattern.test(comment.content))
}

function isPrivateEnd(comment) {
  return privateEndPatterns.some((pattern) => pattern.test(comment.content))
}

function removeRanges(text, ranges) {
  const ordered = [...ranges].sort((left, right) => left.start - right.start || left.end - right.end)
  const merged = []
  for (const range of ordered) {
    const previous = merged.at(-1)
    if (previous && range.start <= previous.end) {
      previous.end = Math.max(previous.end, range.end)
    } else {
      merged.push({ ...range })
    }
  }

  let output = ''
  let position = 0
  for (const range of merged) {
    if (range.start < position) continue
    output += text.slice(position, range.start)
    position = Math.max(position, range.end)
  }
  output += text.slice(position)
  return output
}

function stripBodyPrivateContent(body, options = {}) {
  const comments = findComments(body, { includeCode: options.stripAllComments === true })
  const removals = []
  let privateComment = null

  for (const comment of comments) {
    if (isPrivateStart(comment)) {
      if (privateComment) {
        throw new PrivacyError('Nested private block markers are not supported')
      }
      privateComment = comment
      continue
    }
    if (isPrivateEnd(comment)) {
      if (!privateComment) {
        throw new PrivacyError('Found a private block end marker without a start marker')
      }
      const start = standaloneComment(body, privateComment.start, privateComment.end)
      const end = standaloneComment(body, comment.start, comment.end)
      removals.push({ start: start.start, end: Math.max(end.end, start.end) })
      privateComment = null
      continue
    }
    if (privateComment) continue

    const range = standaloneComment(body, comment.start, comment.end)
    removals.push({ start: range.start, end: range.end })
  }

  if (privateComment) {
    throw new PrivacyError('Unclosed private block; refusing to send page content to the model')
  }

  return removeRanges(body, removals)
}

function blankNonNewlines(text) {
  // Keep every newline so YAML offsets and line numbers still point at the
  // original frontmatter while the comment text itself is gone.
  return text.replace(/[^\r\n]/g, ' ')
}

function stripFrontmatterHtmlComments(frontmatter) {
  let comments
  try {
    comments = findComments(frontmatter, { includeCode: true })
  } catch {
    throw new PrivacyError('Unclosed HTML comment in frontmatter')
  }

  const removals = []
  let privateStart = null

  for (const comment of comments) {
    if (isPrivateStart(comment)) {
      if (privateStart) {
        throw new PrivacyError('Nested private block markers are not supported in frontmatter')
      }
      privateStart = comment
      continue
    }
    if (isPrivateEnd(comment)) {
      if (!privateStart) {
        throw new PrivacyError('Found a private block end marker without a start marker in frontmatter')
      }
      removals.push({ start: privateStart.start, end: comment.end })
      privateStart = null
      continue
    }
    if (privateStart) continue
    removals.push({ start: comment.start, end: comment.end })
  }

  if (privateStart) {
    throw new PrivacyError('Unclosed private block in frontmatter')
  }

  let output = ''
  let position = 0
  for (const range of removals) {
    output += frontmatter.slice(position, range.start)
    output += blankNonNewlines(frontmatter.slice(range.start, range.end))
    position = range.end
  }
  return `${output}${frontmatter.slice(position)}`
}

function lineNumberAt(text, offset) {
  const end = Math.min(Math.max(Number.isInteger(offset) ? offset : 0, 0), text.length)
  let line = 1
  for (let index = 0; index < end; index += 1) {
    if (text[index] === '\n') line += 1
  }
  return line
}

function nodeLocation(text, node) {
  const offset = node?.range?.[0]
  return Number.isInteger(offset) ? `line ${lineNumberAt(text, offset)}` : 'unknown position'
}

function yamlErrorLocation(text, error) {
  const line = error?.linePos?.[0]?.line
  if (Number.isInteger(line) && line > 0) return `line ${line}`
  const offset = error?.pos?.[0]
  if (Number.isInteger(offset)) return `line ${lineNumberAt(text, offset)}`
  return 'unknown position'
}

function hasUnsupportedDirectives(doc) {
  const directives = doc.directives
  if (!directives) return false
  if (directives.docStart || directives.docEnd) return true
  if (directives.yaml?.explicit) return true
  return Object.entries(directives.tags ?? {}).some(
    ([handle, prefix]) => handle !== '!!' || prefix !== defaultYamlTagPrefix
  )
}

function parseFrontmatterYaml(frontmatter) {
  let doc
  try {
    doc = parseDocument(frontmatter)
  } catch {
    return { doc: null, issues: ['invalid YAML in frontmatter'] }
  }

  const issues = []
  for (const error of doc.errors) {
    issues.push(`invalid YAML at ${yamlErrorLocation(frontmatter, error)}`)
  }
  for (const warning of doc.warnings) {
    issues.push(`unsupported YAML feature at ${yamlErrorLocation(frontmatter, warning)}`)
  }
  if (hasUnsupportedDirectives(doc)) {
    issues.push('YAML directives are not supported in frontmatter')
  }

  const unique = [...new Set(issues)]
  if (unique.length > 0) return { doc: null, issues: unique }
  return { doc, issues: unique }
}

function validateYamlDocument(doc, frontmatter) {
  const issues = []
  const add = (message, node) => {
    issues.push(`${message} at ${nodeLocation(frontmatter, node)}`)
  }

  const visit = (node) => {
    if (!node || typeof node !== 'object') return
    if (isAlias(node)) {
      add('YAML alias in frontmatter', node)
      return
    }
    if (node.anchor) {
      add('YAML anchor in frontmatter', node)
    }
    if (node.tag === mergeTag) {
      add('YAML merge tag in frontmatter', node)
    }
    if (isPair(node)) {
      if (isScalar(node.key)) {
        if (node.key.value === mergeKey || node.key.tag === mergeTag) {
          add('YAML merge key in frontmatter', node.key)
        }
      } else if (node.key !== null && node.key !== undefined) {
        add('unsupported complex YAML key in frontmatter', node.key)
      }
      visit(node.key)
      visit(node.value)
      return
    }
    if (isMap(node) || isSeq(node)) {
      for (const item of node.items) visit(item)
    }
  }

  visit(doc.contents)
  return [...new Set(issues)]
}

function clearYamlComments(node) {
  if (!node || typeof node !== 'object') return
  if ('commentBefore' in node) node.commentBefore = undefined
  if ('comment' in node) node.comment = undefined
  if (isPair(node)) {
    clearYamlComments(node.key)
    clearYamlComments(node.value)
  } else if (isMap(node) || isSeq(node)) {
    for (const item of node.items) clearYamlComments(item)
  }
}

function processYamlDocument(doc, frontmatter, options = {}) {
  const sanitize = options.sanitize === true
  const issues = []

  const addPrivateKey = (key) => {
    issues.push(`private frontmatter key "${key.value}" at ${nodeLocation(frontmatter, key)}`)
  }

  const visit = (node) => {
    if (!node || typeof node !== 'object') return

    if (isMap(node)) {
      const kept = []
      for (const item of node.items) {
        if (
          isPair(item) &&
          isScalar(item.key) &&
          typeof item.key.value === 'string' &&
          isPrivateKey(item.key.value)
        ) {
          addPrivateKey(item.key)
          if (sanitize) continue
        }
        visit(item.value)
        kept.push(item)
      }
      if (sanitize) node.items = kept
      return
    }

    if (isSeq(node)) {
      const kept = []
      for (const item of node.items) {
        if (
          isPair(item) &&
          isScalar(item.key) &&
          typeof item.key.value === 'string' &&
          isPrivateKey(item.key.value)
        ) {
          addPrivateKey(item.key)
          if (sanitize) continue
        }
        if (isPair(item)) visit(item.value)
        else visit(item)
        kept.push(item)
      }
      if (sanitize) node.items = kept
      return
    }

    if (isPair(node)) {
      visit(node.value)
    }
  }

  visit(doc.contents)
  return [...new Set(issues)]
}

function collectYamlCommentIssues(doc, frontmatter) {
  const issues = []
  const add = (node) => {
    issues.push(`YAML comment in frontmatter at ${nodeLocation(frontmatter, node)}`)
  }

  if (doc.commentBefore || doc.comment) {
    if (doc.contents) add(doc.contents)
    else issues.push('YAML comment in frontmatter at line 1')
  }

  const visit = (node) => {
    if (!node || typeof node !== 'object') return
    if (node.commentBefore || node.comment) add(node)
    if (isPair(node)) {
      visit(node.key)
      visit(node.value)
    } else if (isMap(node) || isSeq(node)) {
      for (const item of node.items) visit(item)
    }
  }

  visit(doc.contents)
  return [...new Set(issues)]
}

function flagTruthiness(node) {
  if (!isScalar(node)) return 'ambiguous'
  const value = node.value
  if (value === true || value === 1) return 'true'
  if (value === false || value === 0) return 'false'
  if (typeof value !== 'string') return 'ambiguous'
  const normalized = value.trim().toLowerCase()
  if (['true', 'yes', 'on'].includes(normalized)) return 'true'
  if (['false', 'no', 'off'].includes(normalized)) return 'false'
  return 'ambiguous'
}

function documentFlagIssues(doc, frontmatter) {
  const issues = []
  if (!isMap(doc.contents)) return issues

  for (const item of doc.contents.items) {
    if (!isPair(item) || !isScalar(item.key) || typeof item.key.value !== 'string') continue
    const name = item.key.value.toLowerCase()
    if (name !== 'private' && name !== 'draft') continue

    const truthiness = flagTruthiness(item.value)
    if (truthiness === 'true') {
      issues.push(`non-public document flag "${name}" at ${nodeLocation(frontmatter, item.key)}`)
    } else if (truthiness === 'ambiguous') {
      issues.push(`unsupported ${name} flag at ${nodeLocation(frontmatter, item.key)}`)
    }
  }

  return issues
}

function inspectFrontmatter(frontmatter) {
  const issues = []
  let yamlText = frontmatter

  if (frontmatter.includes('<!--')) {
    issues.push(
      `HTML comment in frontmatter at line ${lineNumberAt(frontmatter, frontmatter.indexOf('<!--'))}`
    )
    try {
      yamlText = stripFrontmatterHtmlComments(frontmatter)
    } catch {
      return [...new Set(issues)]
    }
  }

  const parsed = parseFrontmatterYaml(yamlText)
  issues.push(...parsed.issues)
  if (!parsed.doc) return [...new Set(issues)]

  issues.push(...validateYamlDocument(parsed.doc, yamlText))
  issues.push(...documentFlagIssues(parsed.doc, yamlText))
  issues.push(...processYamlDocument(parsed.doc, yamlText))
  issues.push(...collectYamlCommentIssues(parsed.doc, yamlText))
  return [...new Set(issues)]
}

function normalizeFrontmatterOutput(output, original) {
  if (output === '') return ''
  const normalized = output.replace(/\r\n?/g, '\n').replace(/\n+$/, '\n')
  if (normalized.trim() === '') return ''
  return original.includes('\r\n') ? normalized.replace(/\n/g, '\r\n') : normalized
}

function sanitizeFrontmatter(frontmatter) {
  const cleaned = stripFrontmatterHtmlComments(frontmatter)
  const parsed = parseFrontmatterYaml(cleaned)
  if (!parsed.doc) {
    throw new PrivacyError(`Cannot safely process frontmatter: ${parsed.issues.join(', ')}`)
  }

  const unsupported = [
    ...validateYamlDocument(parsed.doc, cleaned),
    ...documentFlagIssues(parsed.doc, cleaned)
  ]
  if (unsupported.length > 0) {
    throw new PrivacyError(`Cannot safely process frontmatter: ${unsupported.join(', ')}`)
  }

  processYamlDocument(parsed.doc, cleaned, { sanitize: true })
  parsed.doc.commentBefore = undefined
  parsed.doc.comment = undefined
  clearYamlComments(parsed.doc.contents)

  let serialized
  try {
    serialized = parsed.doc.contents === null ? '' : parsed.doc.toString({ lineWidth: 0 })
  } catch {
    throw new PrivacyError('Cannot safely serialize sanitized frontmatter')
  }

  const sanitized = normalizeFrontmatterOutput(serialized, frontmatter)
  if (inspectFrontmatter(sanitized).length > 0) {
    throw new PrivacyError('Sanitized frontmatter still contains private content')
  }
  return sanitized
}

export function splitMarkdownDocument(text) {
  if (typeof text !== 'string') throw new TypeError('Markdown text must be a string')
  const opening = text.match(/^(?:\uFEFF)?---[ \t]*\r?\n/)
  if (!opening) return { frontmatter: null, body: text, opening: '', closing: '' }

  const closingPattern = /^(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/gm
  closingPattern.lastIndex = opening[0].length
  const closing = closingPattern.exec(text)
  if (!closing) {
    throw new PrivacyError('Unclosed frontmatter; refusing to send page content to the model')
  }

  return {
    opening: text.slice(0, opening[0].length),
    frontmatter: text.slice(opening[0].length, closing.index),
    closing: text.slice(closing.index, closing.index + closing[0].length),
    body: text.slice(closing.index + closing[0].length)
  }
}

export function sanitizeMarkdownForModel(text, options = {}) {
  const document = splitMarkdownDocument(text)
  if (document.frontmatter === null) {
    return stripBodyPrivateContent(document.body, options)
  }

  const frontmatter = sanitizeFrontmatter(document.frontmatter)
  const body = stripBodyPrivateContent(document.body, options)
  return `${document.opening}${frontmatter}${document.closing}${body}`
}

export function findPrivateContent(text) {
  const document = splitMarkdownDocument(text)
  const issues = []

  if (document.frontmatter !== null) {
    issues.push(...inspectFrontmatter(document.frontmatter))
  }

  const comments = findComments(document.body)
  if (comments.length > 0) issues.push('HTML comment in body')

  return [...new Set(issues)]
}

export function assertNoPrivateContent(text, label = 'generated English') {
  const issues = findPrivateContent(text)
  if (issues.length > 0) {
    throw new PrivacyError(`${label} contains private content: ${issues.join(', ')}`)
  }
}

function protectLineEndAt(text, start) {
  const newline = text.indexOf('\n', start)
  return newline === -1 ? text.length : newline + 1
}

function isEscaped(text, position) {
  let slashes = 0
  for (let index = position - 1; index >= 0 && text[index] === '\\'; index -= 1) {
    slashes += 1
  }
  return slashes % 2 === 1
}

function findBalanced(text, start, open, close) {
  let depth = 0
  for (let index = start; index < text.length; index += 1) {
    const character = text[index]
    if (character === '\\') {
      index += 1
      continue
    }
    if (character === open) depth += 1
    else if (character === close) {
      depth -= 1
      if (depth === 0) return index
    }
  }
  return -1
}

function rewriteInternalHref(value, targetLocale) {
  if (targetLocale === null || targetLocale === false) return value
  if (targetLocale === 'canonical') return canonicalInternalHref(value)
  return localizeInternalHref(value, targetLocale)
}

function localizeDestination(destination, targetLocale) {
  if (destination.startsWith('<') && destination.endsWith('>')) {
    const inner = destination.slice(1, -1)
    return `<${rewriteInternalHref(inner, targetLocale)}>`
  }
  return rewriteInternalHref(destination, targetLocale)
}

function localizeLinkTail(tail, targetLocale) {
  if (!tail.startsWith('(') || !tail.endsWith(')')) return tail
  const inner = tail.slice(1, -1)
  const leading = inner.match(/^\s*/)?.[0] ?? ''
  const afterLeading = inner.slice(leading.length)
  const match = afterLeading.match(/^(<[^>\r\n]*>|[^\s)]+)([\s\S]*)$/)
  if (!match) return tail
  return `(${leading}${localizeDestination(match[1], targetLocale)}${match[2]})`
}

function localizeHtmlTag(tag, targetLocale) {
  return tag.replace(
    /(\b(?:href|src)\s*=\s*)(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi,
    (match, prefix, doubleQuoted, singleQuoted, bare) => {
      if (typeof doubleQuoted === 'string') {
        return `${prefix}"${rewriteInternalHref(doubleQuoted, targetLocale)}"`
      }
      if (typeof singleQuoted === 'string') {
        return `${prefix}'${rewriteInternalHref(singleQuoted, targetLocale)}'`
      }
      if (typeof bare === 'string') {
        return `${prefix}${rewriteInternalHref(bare, targetLocale)}`
      }
      return match
    }
  )
}

function htmlTagEndAt(text, start) {
  if (text[start] !== '<') return -1
  let position = start + 1
  if (text[position] === '/') position += 1
  if (!/[A-Za-z]/.test(text[position] ?? '')) return -1
  let quote = null
  for (; position < text.length; position += 1) {
    const character = text[position]
    if (quote) {
      if (character === quote) quote = null
      continue
    }
    if (character === '"' || character === "'") {
      quote = character
      continue
    }
    if (character === '>') return position + 1
  }
  return -1
}

function localizeReferenceDefinition(line, targetLocale) {
  return line.replace(
    /^(\s*\[[^\]]+\]:[ \t]*)(<[^>\r\n]*>|[^\s]+)([\s\S]*)$/,
    (match, prefix, destination, suffix) =>
      `${prefix}${localizeDestination(destination, targetLocale)}${suffix}`
  )
}

function tokenPrefixFor(text) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const prefix = `OMP_${randomBytes(8).toString('hex')}`
    if (!text.includes(prefix)) return prefix
  }
  throw new Error('Unable to create collision-free Markdown placeholder tokens')
}

// Masks syntax that must survive translation byte-for-byte: fenced code,
// inline code, math, link/image destinations, reference definitions, raw HTML
// tags, and autolinks. Labels and prose stay translatable. Internal locale
// targets are rewritten before they are stored, so restoring the placeholders
// produces navigation targets for the requested locale without ever parsing
// model output as Markdown. Pass targetLocale: null to preserve destinations,
// or 'canonical' to strip locale prefixes for comparison.
export function maskMarkdown(body, options = {}) {
  if (typeof body !== 'string') throw new TypeError('Markdown body must be a string')
  const targetLocale = options.targetLocale === undefined ? englishDirName : options.targetLocale
  const prefix = options.tokenPrefix ?? tokenPrefixFor(body)
  const tokens = []
  const chunks = []
  let last = 0
  let position = 0

  const addToken = (value, kind) => {
    const token = `@@${prefix}_${tokens.length + 1}@@`
    tokens.push({ token, value, kind })
    chunks.push(body.slice(last, position), token)
    return token
  }

  while (position < body.length) {
    const atLineStart = position === 0 || body[position - 1] === '\n'

    if (atLineStart) {
      const lineEnd = protectLineEndAt(body, position)
      const line = body.slice(position, lineEnd)

      const reference = line.match(/^ {0,3}\[[^\]\r\n]+\]:[ \t]*[^\r\n]*(?:\r?\n|$)/)
      if (reference) {
        const value = localizeReferenceDefinition(line, targetLocale)
        addToken(value, 'reference-definition')
        position += line.length
        last = position
        continue
      }

      const opening = line.match(/^ {0,3}(`{3,}|~{3,})[^\r\n]*(?:\r?\n|$)/)
      if (opening) {
        const character = opening[1][0]
        const length = opening[1].length
        let end = lineEnd
        let closed = false
        while (end < body.length) {
          const nextEnd = protectLineEndAt(body, end)
          const nextLine = body.slice(end, nextEnd).replace(/\r?\n$/, '')
          if (new RegExp(`^ {0,3}${character === '`' ? '`' : '~'}{${length},}[ \\t]*$`).test(nextLine)) {
            end = nextEnd
            closed = true
            break
          }
          end = nextEnd
        }
        if (!closed) end = body.length
        const value = body.slice(position, end)
        addToken(value, 'fence')
        position = end
        last = position
        continue
      }
    }

    if (body.startsWith('<!--', position)) {
      throw new PrivacyError('Private HTML comment was not removed before translation')
    }

    if (options.protectPipes && body[position] === '|' && !isEscaped(body, position)) {
      addToken('|', 'pipe')
      position += 1
      last = position
      continue
    }

    if (options.protectBareUrls) {
      const bare = body.slice(position).match(
        /^(?:(?:https?|mailto|tel|javascript|data|vbscript|file|about|blob):|\/\/)[^\s<>"'`]+/
      )
      if (bare) {
        addToken(bare[0], 'url')
        position += bare[0].length
        last = position
        continue
      }
    }

    if (body[position] === '`' && !isEscaped(body, position)) {
      let runLength = 1
      while (body[position + runLength] === '`') runLength += 1
      const marker = '`'.repeat(runLength)
      const closing = body.indexOf(marker, position + runLength)
      if (closing !== -1) {
        addToken(body.slice(position, closing + runLength), 'code')
        position = closing + runLength
        last = position
        continue
      }
      position += runLength
      continue
    }

    if (body.startsWith('$$', position) && !isEscaped(body, position)) {
      const closing = body.indexOf('$$', position + 2)
      if (closing !== -1) {
        addToken(body.slice(position, closing + 2), 'math')
        position = closing + 2
        last = position
        continue
      }
    }

    if (body[position] === '$' && !isEscaped(body, position)) {
      const lineEnd = protectLineEndAt(body, position)
      let closing = -1
      for (let index = position + 1; index < lineEnd; index += 1) {
        if (body[index] === '$' && !isEscaped(body, index)) {
          closing = index
          break
        }
      }
      if (closing !== -1 && closing > position + 1) {
        addToken(body.slice(position, closing + 1), 'math')
        position = closing + 1
        last = position
        continue
      }
    }

    if (
      (body.startsWith('\\(', position) || body.startsWith('\\[', position)) &&
      !isEscaped(body, position)
    ) {
      const closingMarker = body.startsWith('\\(', position) ? '\\)' : '\\]'
      const closing = body.indexOf(closingMarker, position + 2)
      if (closing !== -1) {
        addToken(body.slice(position, closing + 2), 'math')
        position = closing + 2
        last = position
        continue
      }
    }

    const autolink = body.slice(position).match(/^<(?:https?:\/\/|mailto:)[^>\r\n]+>/)
    if (autolink) {
      addToken(autolink[0], 'autolink')
      position += autolink[0].length
      last = position
      continue
    }

    const htmlEnd = htmlTagEndAt(body, position)
    if (htmlEnd !== -1) {
      addToken(localizeHtmlTag(body.slice(position, htmlEnd), targetLocale), 'html')
      position = htmlEnd
      last = position
      continue
    }
    if (options.failOnUnsafeHtml && body[position] === '<' && /^<\/?[A-Za-z]/.test(body.slice(position, position + 3))) {
      throw new PrivacyError('HTML 标签无法安全解析，已拒绝处理')
    }

    const imageStart = body.startsWith('![', position)
    if ((imageStart || body[position] === '[') && !isEscaped(body, position)) {
      const labelStart = position + (imageStart ? 2 : 1)
      const labelEnd = findBalanced(body, labelStart - 1, '[', ']')
      if (labelEnd !== -1) {
        const afterLabel = labelEnd + 1
        if (body[afterLabel] === '(') {
          const tailEnd = findBalanced(body, afterLabel, '(', ')')
          if (tailEnd !== -1) {
            const label = body.slice(labelStart, labelEnd)
            if (/[`$<]/.test(label)) {
              addToken(
                `${body.slice(position, labelEnd + 1)}` +
                localizeLinkTail(body.slice(afterLabel, tailEnd + 1), targetLocale),
                'link-whole'
              )
              position = tailEnd + 1
              last = position
              continue
            }
            // The closing label bracket is appended separately. If it were
            // included in the recursively masked label, the bare-URL matcher
            // could swallow it and restoreMaskedMarkdown would see a link
            // target no longer preceded by "]".
            const labelMasked = options.protectBareUrls
              ? maskMarkdown(body.slice(position, labelEnd), {
                  protectBareUrls: true,
                  protectPipes: true,
                  targetLocale
                })
              : { text: body.slice(position, labelEnd), tokens: [] }
            chunks.push(body.slice(last, position), labelMasked.text, ']')
            tokens.push(...labelMasked.tokens)
            const token = `@@${prefix}_${tokens.length + 1}@@`
            tokens.push({
              token,
              value: localizeLinkTail(body.slice(afterLabel, tailEnd + 1), targetLocale),
              kind: 'link'
            })
            chunks.push(token)
            position = tailEnd + 1
            last = position
            continue
          }
        } else if (body[afterLabel] === '[') {
          const referenceEnd = body.indexOf(']', afterLabel + 1)
          if (referenceEnd !== -1) {
            const label = body.slice(labelStart, labelEnd)
            if (/[`$<]/.test(label)) {
              addToken(body.slice(position, referenceEnd + 1), 'reference-whole')
              position = referenceEnd + 1
              last = position
              continue
            }
            const labelMasked = options.protectBareUrls
              ? maskMarkdown(body.slice(position, labelEnd), {
                  protectBareUrls: true,
                  protectPipes: true,
                  targetLocale
                })
              : { text: body.slice(position, labelEnd), tokens: [] }
            chunks.push(body.slice(last, position), labelMasked.text, ']')
            tokens.push(...labelMasked.tokens)
            const token = `@@${prefix}_${tokens.length + 1}@@`
            tokens.push({
              token,
              value: body.slice(afterLabel, referenceEnd + 1),
              kind: 'reference'
            })
            chunks.push(token)
            position = referenceEnd + 1
            last = position
            continue
          }
        }
      }
    }

    position += 1
  }

  chunks.push(body.slice(last))
  return { text: chunks.join(''), tokens }
}

export function unwrapMarkdownFence(text) {
  const trimmed = String(text ?? '').trim()
  const match = trimmed.match(/^(`{3,}|~{3,})[^\r\n]*\r?\n([\s\S]*?)\r?\n\1[ \t]*$/)
  return match ? match[2] : trimmed
}

// A model may reorder, duplicate, or drop protected syntax. Any of those would
// silently corrupt code, links, or math, so all placeholders must appear exactly
// once and in their original order.
export function restoreMaskedMarkdown(masked, tokens) {
  if (typeof masked !== 'string') throw new TypeError('Masked Markdown must be a string')
  if (!Array.isArray(tokens)) throw new TypeError('Placeholder tokens must be an array')
  let text = masked
  let previousIndex = -1

  for (const entry of tokens) {
    if (!entry || typeof entry.token !== 'string' || typeof entry.value !== 'string') {
      throw new Error('Invalid Markdown placeholder record')
    }
    const first = text.indexOf(entry.token)
    if (first === -1) {
      throw new Error('The model dropped a protected Markdown element')
    }
    if (text.indexOf(entry.token, first + entry.token.length) !== -1) {
      throw new Error('The model duplicated a protected Markdown element')
    }
    if (first < previousIndex) {
      throw new Error('The model reordered protected Markdown elements')
    }
    if (entry.kind === 'link' || entry.kind === 'reference') {
      if (first === 0 || text[first - 1] !== ']') {
        throw new Error('The model broke the Markdown link syntax around a protected target')
      }
    }
    previousIndex = first
  }

  for (const entry of tokens) {
    text = text.split(entry.token).join(entry.value)
  }
  return text
}

// Deterministic post-model validation using the same VitePress Markdown parser
// that renders the site. Code and math tokens are trusted original content;
// text, HTML, links, images, frontmatter, Vue interpolation, and template
// directives are inspected. Parse uncertainty fails closed.

const dangerousTags = new Set([
  'script',
  'iframe',
  'object',
  'embed',
  'form',
  'meta',
  'link',
  'base',
  'style',
  'svg'
])

let defaultParserPromise = null

async function parserFor(options) {
  let candidate
  try {
    if (options.md) candidate = options.md
    else {
      if (!defaultParserPromise) {
        defaultParserPromise = createMarkdownRenderer(process.cwd(), { math: true }, '/')
      }
      candidate = defaultParserPromise
    }
    const md = await candidate
    if (!md || typeof md.parse !== 'function') {
      throw new Error('renderer did not expose parse()')
    }
    return md
  } catch (error) {
    throw new Error(`无法初始化 VitePress Markdown 安全解析器：${error.code ?? error.message}`)
  }
}

function parseSecurityDocument(text, md, context) {
  const env = {}
  let tokens
  try {
    tokens = md.parse(text, env)
  } catch {
    throw new Error(`${context} Markdown 安全解析失败，已拒绝写入`)
  }
  if (!Array.isArray(tokens)) {
    throw new Error(`${context} Markdown 解析结果不确定，已拒绝写入`)
  }
  if (String(text).trim() !== '' && tokens.length === 0) {
    throw new Error(`${context} Markdown 解析结果为空，已拒绝写入`)
  }
  return { tokens, frontmatter: env.frontmatter ?? {} }
}

function decodeEntities(value) {
  let result = value
  for (let pass = 0; pass < 3; pass += 1) {
    result = result
      .replace(/&#x([0-9a-f]+);?/gi, (_, hex) => {
        try {
          return String.fromCodePoint(Number.parseInt(hex, 16))
        } catch {
          return ''
        }
      })
      .replace(/&#([0-9]+);?/g, (_, digits) => {
        try {
          return String.fromCodePoint(Number.parseInt(digits, 10))
        } catch {
          return ''
        }
      })
      .replace(/&colon;/gi, ':')
      .replace(/&sol;/gi, '/')
      .replace(/&amp;/gi, '&')
  }
  return result
}

function normalizeUrl(value) {
  let url = String(value ?? '').trim()
  if (url.startsWith('<') && url.endsWith('>')) url = url.slice(1, -1)
  url = decodeEntities(url).replace(/[\u0000-\u001f\u007f\s]+/g, '')
  return canonicalInternalHref(url)
}

function dangerousUrl(value) {
  const url = normalizeUrl(value).toLowerCase()
  return /^(?:javascript|vbscript|file|about|blob|data):/.test(url)
}

function normalizeTag(tag) {
  return tag.replace(
    /(\b(?:href|src|action|formaction)\s*=\s*)(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi,
    (match, prefix, doubleQuoted, singleQuoted, bare) => {
      const value = doubleQuoted ?? singleQuoted ?? bare ?? ''
      return `${prefix}${normalizeUrl(value)}`
    }
  )
}

function hasEventAttribute(tag) {
  return /[\s/"'`]on[a-z0-9_-]+\s*=/i.test(tag)
}

function tagName(tag) {
  return tag.match(/^<\/?([A-Za-z0-9-]+)/)?.[1]?.toLowerCase() ?? ''
}

function addFeature(map, value) {
  if (!value) return
  map.set(value, (map.get(value) ?? 0) + 1)
}

function fenceLanguage(info) {
  return String(info ?? '').trim().split(/\s+/)[0].replace(/\{.*$/, '').toLowerCase()
}

function addProtected(features, type, info, content) {
  addFeature(features.protected, `${type}\u0000${info}\u0000${String(content ?? '')}`)
}

function newFeature(generated, source, message, context) {
  for (const [value, count] of generated) {
    if (count > (source.get(value) ?? 0)) {
      throw new Error(`${context} 包含模型${message}，已拒绝写入`)
    }
  }
}

function sameFeatureMaps(left, right) {
  if (left.size !== right.size) return false
  for (const [value, count] of left) {
    if ((right.get(value) ?? 0) !== count) return false
  }
  return true
}

function extractTags(text) {
  const tags = []
  const withoutComments = text.replace(/<!--[\s\S]*?-->/g, '')
  const pattern = /<\/?[A-Za-z][^>]*>/g
  let match
  while ((match = pattern.exec(withoutComments)) !== null) tags.push(match[0])
  return tags
}

function extractInterpolations(text) {
  const expressions = []
  const pattern = /\{\{([\s\S]*?)\}\}/g
  let match
  while ((match = pattern.exec(text)) !== null) expressions.push(match[1].trim())
  return expressions
}

function extractDirectives(text) {
  const directives = []
  const longForm = /\b(v-[a-z0-9-]+)\b/gi
  let match
  while ((match = longForm.exec(text)) !== null) directives.push(match[1].toLowerCase())
  const shorthand = /(?:^|[\s])([:@#][a-z0-9_-]+)\s*=/gi
  while ((match = shorthand.exec(text)) !== null) directives.push(match[1].toLowerCase())
  return directives
}

function extractTagDestinations(tag) {
  const destinations = []
  const attrs = /\b(?:href|src|action|formaction)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi
  let match
  while ((match = attrs.exec(tag)) !== null) destinations.push(match[1] ?? match[2] ?? match[3] ?? '')
  const css = /url\(\s*(['"]?)([^)'"]+)\1\s*\)/gi
  while ((match = css.exec(tag)) !== null) destinations.push(match[2])
  return destinations
}

function extractBareUrls(text) {
  const urls = []
  const web = /\bhttps?:\/\/[^\s<>"'`)\]]+/gi
  let match
  while ((match = web.exec(text)) !== null) urls.push(match[0])
  const dangerous = /\b(?:javascript|vbscript|data|file|about|blob):[^\s<>"'`)\]]*/gi
  while ((match = dangerous.exec(text)) !== null) urls.push(match[0])
  const protocolRelative = /(?:^|[\s("'=])(\/\/[^\s<>"'`)\]]+)/g
  while ((match = protocolRelative.exec(text)) !== null) urls.push(match[1])
  return urls
}

function addAttributeExpressions(features, value) {
  if (typeof value !== 'string') return
  for (const expression of extractInterpolations(value)) addFeature(features.interpolations, expression)
  for (const directive of extractDirectives(value)) addFeature(features.directives, directive)
}

function addTag(features, tag) {
  const normalized = normalizeTag(tag)
  addFeature(features.tags, normalized)
  features.rawTags.push(tag)
  addAttributeExpressions(features, tag)
  for (const destination of extractTagDestinations(tag)) addFeature(features.urls, normalizeUrl(destination))
}

function addText(features, text, { directives = false } = {}) {
  for (const tag of extractTags(text)) addTag(features, tag)
  for (const expression of extractInterpolations(text)) addFeature(features.interpolations, expression)
  if (directives) {
    for (const directive of extractDirectives(text)) addFeature(features.directives, directive)
  }
  const decodedText = decodeEntities(text)
  for (const url of extractBareUrls(text)) addFeature(features.urls, normalizeUrl(url))
  for (const url of extractBareUrls(decodedText)) addFeature(features.urls, normalizeUrl(url))
}

function addHtml(features, html) {
  const cleaned = html.replace(/<!--[\s\S]*?-->/g, '')
  for (const expression of extractInterpolations(cleaned)) addFeature(features.interpolations, expression)
  const tags = extractTags(cleaned)
  for (const tag of tags) addTag(features, tag)
  // Bare URLs outside tags still matter as visible text; tags are removed first
  // so attribute URLs are counted once through addTag.
  let text = cleaned
  for (const tag of tags) text = text.replace(tag, ' ')
  addText(features, text)
}

function tokenAttr(token, name) {
  if (typeof token.attrGet === 'function') return token.attrGet(name)
  if (Array.isArray(token.attrs)) {
    const found = token.attrs.find((entry) => Array.isArray(entry) && entry[0] === name)
    return found?.[1]
  }
  return null
}

function collectTokens(features, tokens, context) {
  for (const token of tokens) {
    if (!token || typeof token !== 'object') {
      throw new Error(`${context} Markdown token 不确定，已拒绝写入`)
    }
    switch (token.type) {
      case 'fence':
        // Mermaid labels are translated under a separate, structural validator.
        if (fenceLanguage(token.info) !== 'mermaid') {
          addProtected(features, 'fence', String(token.info ?? ''), token.content)
        }
        break
      case 'code_block':
        addProtected(features, 'code_block', '', token.content)
        break
      case 'code_inline':
        addProtected(features, 'code_inline', '', token.content)
        break
      case 'math_block':
        addProtected(features, 'math_block', '', token.content)
        break
      case 'math_inline':
        addProtected(features, 'math_inline', '', token.content)
        break
      case 'inline':
        if (!Array.isArray(token.children)) {
          throw new Error(`${context} Markdown 行内 token 不确定，已拒绝写入`)
        }
        collectTokens(features, token.children, context)
        break
      case 'text':
        addText(features, String(token.content ?? ''))
        break
      case 'html_inline':
      case 'html_block':
        addHtml(features, String(token.content ?? ''))
        break
      case 'link_open': {
        // VitePress injects a header-anchor link around every heading. Its
        // fragment follows the translated heading text and is not model-authored.
        if (/\bheader-anchor\b/.test(String(tokenAttr(token, 'class') ?? ''))) break
        const href = tokenAttr(token, 'href')
        if (href !== null && href !== undefined) {
          addFeature(features.urls, normalizeUrl(href))
          addAttributeExpressions(features, href)
        }
        break
      }
      case 'image': {
        const src = tokenAttr(token, 'src')
        if (src !== null && src !== undefined) {
          addFeature(features.urls, normalizeUrl(src))
          addAttributeExpressions(features, src)
        }
        addText(features, String(token.content ?? ''))
        break
      }
      default:
        if (typeof token.type === 'string' && token.type.startsWith('math_')) {
          addProtected(features, token.type, '', token.content)
        } else if (Array.isArray(token.children)) collectTokens(features, token.children, context)
        else if (typeof token.content === 'string' && token.content !== '') {
          addText(features, token.content)
        }
    }
  }
}

function collectFrontmatter(features, value, context, seen = new Set()) {
  if (typeof value === 'string') {
    addHtml(features, value)
    for (const directive of extractDirectives(value)) addFeature(features.directives, directive)
    return
  }
  if (value === null || value === undefined || typeof value !== 'object') return
  if (seen.has(value)) throw new Error(`${context} frontmatter 结构不确定，已拒绝写入`)
  seen.add(value)
  if (Array.isArray(value)) {
    for (const entry of value) collectFrontmatter(features, entry, context, seen)
    return
  }
  for (const entry of Object.values(value)) collectFrontmatter(features, entry, context, seen)
}

async function collectFeatures(text, options, context) {
  const md = await parserFor(options)
  const parsed = parseSecurityDocument(text, md, context)
  const features = {
    tags: new Map(),
    interpolations: new Map(),
    directives: new Map(),
    urls: new Map(),
    protected: new Map(),
    rawTags: []
  }
  collectTokens(features, parsed.tokens, context)
  collectFrontmatter(features, parsed.frontmatter, context)
  return features
}

export async function assertSafeGeneratedMarkup(source, generated, context = '生成内容', options = {}) {
  if (typeof source !== 'string' || typeof generated !== 'string') {
    throw new TypeError('安全校验需要源文本和生成文本')
  }
  const sourceFeatures = await collectFeatures(source, options, `${context}（源）`)
  const generatedFeatures = await collectFeatures(generated, options, context)

  for (const url of generatedFeatures.urls.keys()) {
    if (dangerousUrl(url)) {
      throw new Error(`${context} 包含不安全的 URL 协议，已拒绝写入`)
    }
  }

  for (const tag of generatedFeatures.rawTags) {
    if (hasEventAttribute(tag)) {
      throw new Error(`${context} 包含模型新增的事件属性，已拒绝写入`)
    }
    if (dangerousTags.has(tagName(tag))) {
      throw new Error(`${context} 包含不安全的 HTML 标签 <${tagName(tag)}>，已拒绝写入`)
    }
    for (const destination of extractTagDestinations(tag)) {
      if (dangerousUrl(destination)) {
        throw new Error(`${context} 包含不安全的 URL 协议，已拒绝写入`)
      }
    }
  }

  if (!sameFeatureMaps(generatedFeatures.protected, sourceFeatures.protected)) {
    throw new Error(`${context} 的代码/公式 token 与原文不一致，已拒绝写入`)
  }

  newFeature(generatedFeatures.tags, sourceFeatures.tags, '新增的 HTML 标签', context)
  newFeature(generatedFeatures.interpolations, sourceFeatures.interpolations, '新增的 Vue 插值', context)
  newFeature(generatedFeatures.directives, sourceFeatures.directives, '新增的模板指令', context)
  newFeature(generatedFeatures.urls, sourceFeatures.urls, '新增或改写的链接目标', context)
}

const localePattern = /^\/(en|zh-cn|zh-tw)(?=$|[/?#])/i
const assetExtension = /\.(?:avif|bmp|csv|css|eot|gif|ico|jpe?g|js|json|map|mjs|mp[34]|ogg|otf|pdf|png|svg|tar|ttf|txt|wasm|wav|webp|woff2?|xml|zip)(?:[?#]|$)/i
const pathLikeValue = /^(?:[A-Za-z][A-Za-z0-9+.-]*:|\/|\.{1,2}\/|#)/

function destinationFromParentheses(value) {
  const match = String(value).match(/^\(\s*(?:<([^>]*)>|([^\s)]+))/)
  return match ? (match[1] ?? match[2] ?? '') : ''
}

function destinationFromReferenceDefinition(value) {
  const match = String(value).match(/^\s*\[[^\]]+\]:\s*(?:<([^>]*)>|(\S+))/)
  return match ? (match[1] ?? match[2] ?? '') : ''
}

function destinationsFromWholeLink(value) {
  const text = String(value)
  const index = text.lastIndexOf('](')
  if (index === -1) return []
  return [destinationFromParentheses(text.slice(index + 1))]
}
function destinationsFromSrcset(value) {
  const text = String(value)
  const destinations = []
  let index = 0
  while (index < text.length) {
    while (index < text.length && /[\s,]/.test(text[index])) index += 1
    const start = index
    while (index < text.length && !/\s/.test(text[index])) index += 1
    const raw = text.slice(start, index)
    const target = raw.replace(/,+$/, '')
    if (target) destinations.push(target)
    if (target.length !== raw.length) continue
    while (index < text.length && text[index] !== ',') index += 1
    if (index < text.length) index += 1
  }
  return destinations
}


function destinationsFromHtml(tag) {
  const destinations = []
  const attributes = /\b(href|src|srcset|action|formaction)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi
  let match
  while ((match = attributes.exec(tag)) !== null) {
    const value = match[2] ?? match[3] ?? match[4] ?? ''
    if (match[1].toLowerCase() === 'srcset') destinations.push(...destinationsFromSrcset(value))
    else destinations.push(value)
  }
  const css = /url\(\s*(['"]?)([^)'"]+)\1\s*\)/gi
  while ((match = css.exec(tag)) !== null) destinations.push(match[2])
  return destinations
}

function frontmatterDestinations(frontmatter) {
  if (!frontmatter) return []
  const destinations = []
  const { records } = parseFrontmatterScalars(frontmatter)
  for (const record of records) {
    if (record.error || typeof record.value !== 'string') continue
    if (record.key?.toLowerCase() === 'srcset') {
      destinations.push(...destinationsFromSrcset(record.value))
    } else if (pathLikeValue.test(record.value)) {
      destinations.push(record.value)
    }
  }
  return destinations
}

// Collects site-internal destinations from Markdown without executing or
// rendering the page. Code fences, inline code, formulas, and reference labels
// are masked by the same local parser used for translation, so links in code
// examples are never treated as navigation.
export function collectLocaleLinkTargets(text) {
  if (typeof text !== 'string') throw new TypeError('Markdown text must be a string')
  const document = splitMarkdownDocument(text)
  const masked = maskMarkdown(document.body, {
    protectBareUrls: true,
    failOnUnsafeHtml: true,
    targetLocale: null
  })
  const targets = frontmatterDestinations(document.frontmatter)

  for (const entry of masked.tokens) {
    if (entry.kind === 'link') {
      targets.push(destinationFromParentheses(entry.value))
    } else if (entry.kind === 'reference-definition') {
      targets.push(destinationFromReferenceDefinition(entry.value))
    } else if (entry.kind === 'link-whole') {
      targets.push(...destinationsFromWholeLink(entry.value))
    } else if (entry.kind === 'html') {
      targets.push(...destinationsFromHtml(entry.value))
    } else if (entry.kind === 'autolink' || entry.kind === 'url') {
      targets.push(entry.value.replace(/^<|>$/g, ''))
    }
  }

  return targets.filter((target) => typeof target === 'string' && target !== '')
}

export function isAssetTarget(target) {
  const pathPart = String(target).split(/[?#]/, 1)[0]
  return assetExtension.test(pathPart)
}

function checkDestination(target, locale) {
  if (typeof target !== 'string') return null
  const value = target.trim().replace(/^<|>$/g, '')
  if (!value.startsWith('/') || value.startsWith('//')) return null

  const pathPart = value.split(/[?#]/, 1)[0]
  if (pathPart === '' || pathPart === '/') return null

  const match = value.match(localePattern)
  if (match) {
    return isLocalePrefixedHref(value, locale)
      ? null
      : `站内链接 ${value} 的语言前缀与 /${locale}/ 不一致`
  }

  if (isAssetTarget(value)) return null
  return `站内页面链接必须指向 /${locale}/：${value}`
}

export function localeTargetIssue(target, locale) {
  if (!localeNames.includes(locale)) {
    return `不支持的语言 ${JSON.stringify(locale)}`
  }
  return checkDestination(target, locale)
}

export function localeLinkIssues(text, locale, label = 'page') {
  if (!localeNames.includes(locale)) {
    return [`${label}: 不支持的语言 ${JSON.stringify(locale)}`]
  }

  let targets
  try {
    targets = collectLocaleLinkTargets(text)
  } catch (error) {
    return [`${label}: 无法解析站内链接：${error.message}`]
  }

  const issues = []
  for (const target of targets) {
    const issue = checkDestination(target, locale)
    if (issue) issues.push(`${label}: ${issue}`)
  }
  return issues
}
