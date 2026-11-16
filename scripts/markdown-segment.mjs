import { maskMarkdown } from './markdown-protect.mjs'

// Splits a Markdown body into bounded, independently translatable segments
// without deleting or normalizing any source text. Blank lines and fenced-code
// blocks are kept as opaque parts. This prevents one long placeholder sequence
// from being reordered by the model as a single response.
function splitLines(text) {
  return text.match(/[^\n]*\n|[^\n]+$/g) ?? []
}

function fenceOpening(text) {
  const match = text.match(/^[ \t]*(`{3,}|~{3,})(.*)$/)
  if (!match) return null
  return { character: match[1][0], length: match[1].length }
}

function isFenceClosing(text, fence) {
  const character = fence.character === '`' ? '`' : '~'
  return new RegExp(`^[ \\t]*${character}{${fence.length},}[ \\t]*$`).test(text)
}

function countTokens(text) {
  return maskMarkdown(text, { protectPipes: true }).tokens.length
}

function splitBlock(lines, options) {
  const parts = []
  const maxChars = options.maxChars
  const maxTokens = options.maxTokens
  const whole = lines.join('')
  if (whole.length <= maxChars && countTokens(whole) <= maxTokens) {
    parts.push({ text: whole, translatable: true, kind: 'block' })
    return parts
  }

  let current = []
  let characters = 0
  let tokens = 0
  const flush = () => {
    if (current.length === 0) return
    parts.push({ text: current.join(''), translatable: true, kind: 'block' })
    current = []
    characters = 0
    tokens = 0
  }

  for (const line of lines) {
    const lineTokens = countTokens(line)
    if (
      current.length > 0 &&
      (characters + line.length > maxChars || tokens + lineTokens > maxTokens)
    ) {
      flush()
    }
    current.push(line)
    characters += line.length
    tokens += lineTokens
  }
  flush()
  return parts
}

export function segmentMarkdown(body, options = {}) {
  if (typeof body !== 'string') throw new TypeError('Markdown body must be a string')
  const maxChars = options.maxChars ?? 2_500
  const maxTokens = options.maxTokens ?? 24
  if (!Number.isSafeInteger(maxChars) || maxChars < 200) {
    throw new TypeError('maxChars must be an integer >= 200')
  }
  if (!Number.isSafeInteger(maxTokens) || maxTokens < 4) {
    throw new TypeError('maxTokens must be an integer >= 4')
  }

  const lines = splitLines(body)
  const parts = []
  let block = []
  let fence = null

  const flushBlock = () => {
    if (block.length === 0) return
    parts.push(...splitBlock(block, { maxChars, maxTokens }))
    block = []
  }

  for (const line of lines) {
    const text = line.replace(/\r?\n$/, '')
    if (fence) {
      block.push(line)
      if (isFenceClosing(text, fence)) {
        parts.push({ text: block.join(''), translatable: false, kind: 'fence' })
        block = []
        fence = null
      }
      continue
    }

    const opening = fenceOpening(text)
    if (opening) {
      flushBlock()
      fence = opening
      block.push(line)
      continue
    }

    if (text.trim() === '') {
      flushBlock()
      parts.push({ text: line, translatable: false, kind: 'blank' })
      continue
    }

    block.push(line)
  }

  if (fence) {
    parts.push({ text: block.join(''), translatable: false, kind: 'fence' })
    block = []
  }
  flushBlock()
  return parts
}
