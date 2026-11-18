import {
  isAlias,
  isMap,
  isPair,
  isScalar,
  isSeq,
  parseDocument
} from 'yaml'

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
