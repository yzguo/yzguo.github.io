import { randomBytes } from 'node:crypto'
import {
  canonicalInternalHref,
  englishDirName,
  localizeInternalHref
} from './document-mapping.mjs'
import { PrivacyError } from './markdown-privacy.mjs'

function lineEndAt(text, start) {
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
      const lineEnd = lineEndAt(body, position)
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
          const nextEnd = lineEndAt(body, end)
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
      const lineEnd = lineEndAt(body, position)
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
