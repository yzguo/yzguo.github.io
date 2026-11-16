import { spawn } from 'node:child_process'

// Local-only model access for this site's tooling. The request is sent through
// `omp auth-gateway stdio`, which uses the credentials and custom provider
// configuration already stored by Oh My Pi on this machine. No token, endpoint,
// or provider configuration is read, copied, or written by this module.
export const OMP_MODEL = 'ustc/deepseek-flash'
export const DEFAULT_TIMEOUT_MS = 180_000

const defaultMaxPromptBytes = 4 * 1024 * 1024
const defaultMaxOutputBytes = 16 * 1024 * 1024
const defaultMaxStderrBytes = 64 * 1024
const gatewayPath = '/v1/chat/completions'

function truncate(value, maxLength) {
  const text = String(value ?? '')
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text
}

// Last-resort display sanitizer for local diagnostics. It is defense in depth,
// not a boundary for provider errors: gateway diagnostics never pass upstream
// stderr, messages, model names, endpoints, or request bodies through it.
// Header and credential fields are matched both as prose and as quoted JSON
// keys, and control/ANSI sequences are stripped so terminal output stays inert.
const sensitiveAssignmentPattern =
  /((?:"|')?(?:authorization[_-]?code|authorization|proxy[_-]?authorization|authentication|auth|api[_-]?key|x[_-]?api[_-]?key|x[_-]?auth[_-]?token|access[_-]?token|refresh[_-]?token|id[_-]?token|session[_-]?token|session[_-]?id|access[_-]?key(?:[_-]?id)?|secret[_-]?key|signing[_-]?key|token|secret|client[_-]?secret|password|passwd|credential|credentials|cookie|set[_-]?cookie|private[_-]?key|base[_-]?url|base[_-]?uri|endpoint[_-]?url|endpoint|url|uri|hostname|host|proxy|gateway|model[_-]?name|model|message|error|errors|detail|details|reason|stack|stderr|stdout|body|response|request|headers|bearer|jwt|session|csrf|xsrf|nonce|signature|code)(?:"|')?\s*[:=]\s*)(?:"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|[^\s,;&{}\[\]\r\n]+)/gi

export function sanitizeProcessOutput(value, maxLength = 2_000) {
  const text = String(value ?? '')
    .replace(/\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g, ' ')
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, ' ')
    .replace(/\u001b[@-_]/g, ' ')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, ' ')
    .replace(/\b(?:https?|wss?|ftp|file):(?:\/\/)?[^\s"'<>`]+/gi, '<url-redacted>')
    .replace(/(^|[\s("'=])\/\/[^\s"'<>`]+/g, '$1<url-redacted>')
    .replace(/\b(Bearer|Basic|Digest|Token)\s+[^\s,;"'<>`]+/gi, '$1 <redacted>')
    .replace(
      /(\b(?:authorization|proxy[_-]?authorization|api[_-]?key|x[_-]?api[_-]?key|x[_-]?auth[_-]?token|auth[_-]?token|access[_-]?token|refresh[_-]?token|token|cookie|set[_-]?cookie)\b["']?\s*[:=]\s*)(?!["'])[^\r\n]+/gi,
      '$1<redacted>'
    )
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, 'sk-<redacted>')
    .replace(/\bgh[pousr]_[A-Za-z0-9_]{8,}\b/g, '<redacted>')
    .replace(/\bgithub_pat_[A-Za-z0-9_]{8,}\b/g, '<redacted>')
    .replace(/\bxox[abprs]-[A-Za-z0-9-]{8,}\b/gi, '<redacted>')
    .replace(/\bAKIA[0-9A-Z]{12,}\b/g, '<redacted>')
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}\b/g, '<redacted>')
    .replace(sensitiveAssignmentPattern, '$1<redacted>')
    .trim()
  return truncate(text, maxLength)
}

export function buildGatewayArgs() {
  return ['auth-gateway', 'stdio']
}

export function buildGatewayRequest({ id, model = OMP_MODEL, system = '', prompt }) {
  if (!Number.isSafeInteger(id) || id < 1) {
    throw new TypeError('The gateway request id must be a positive integer')
  }
  if (typeof model !== 'string' || model.trim() === '') {
    throw new TypeError('A model name is required')
  }
  if (system !== undefined && typeof system !== 'string') {
    throw new TypeError('The system prompt must be a string')
  }
  if (typeof prompt !== 'string' || prompt.trim() === '') {
    throw new TypeError('A non-empty prompt is required')
  }

  const messages = []
  if (system.trim()) messages.push({ role: 'system', content: system })
  messages.push({ role: 'user', content: prompt })

  return {
    id,
    path: gatewayPath,
    body: {
      model,
      messages,
      // A provider default can silently truncate a long page translation. This
      // is still well below the model's configured maximum output.
      max_tokens: 16_384,
      // `ustc/deepseek-flash` otherwise spends the completion budget on hidden
      // reasoning and can return null content. Reasoning must never be exposed
      // as the result.
      reasoning_effort: 'none'
    }
  }
}

const knownFinishReasons = new Set(['length', 'content_filter', 'tool_calls', 'function_call'])

function finishReasonCategory(value) {
  if (value === null || value === undefined) return 'missing'
  if (typeof value !== 'string') return 'invalid'
  return knownFinishReasons.has(value) ? value : 'other'
}

function httpStatusCategory(status) {
  if (status === 401 || status === 403 || status === 407) return 'authentication failed'
  if (status === 408 || status === 504) return 'upstream timeout'
  if (status === 429) return 'rate limited'
  if (status >= 500) return 'upstream server error'
  if (status >= 400) return 'request rejected'
  if (status >= 300) return 'unexpected redirect'
  if (status >= 200) return 'unexpected success status'
  return 'unexpected informational status'
}

export function parseGatewayResponse(line, { id, model = OMP_MODEL } = {}) {
  let response
  try {
    response = JSON.parse(line)
  } catch {
    throw new Error('OMP auth gateway returned malformed JSON')
  }
  if (!response || typeof response !== 'object' || Array.isArray(response)) {
    throw new Error('OMP auth gateway returned a non-object response')
  }
  if (response.id !== id) {
    throw new Error('OMP auth gateway returned a response with an unexpected id')
  }
  if (!Object.hasOwn(response, 'status') || response.status === undefined) {
    throw new Error('OMP auth gateway response is missing an HTTP status')
  }
  if (
    !Number.isInteger(response.status) ||
    response.status < 100 ||
    response.status > 599
  ) {
    throw new Error('OMP auth gateway response has an invalid HTTP status')
  }
  if (response.status !== 200) {
    throw new Error(
      `OMP auth gateway request failed with HTTP ${response.status} ` +
      `(${httpStatusCategory(response.status)})`
    )
  }

  const body = response.body
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new Error('OMP auth gateway response is missing a JSON body')
  }
  if (body.model !== model) {
    throw new Error('OMP auth gateway used a different model instead of the required model')
  }
  if (!Array.isArray(body.choices) || body.choices.length !== 1) {
    throw new Error('OMP auth gateway response must contain exactly one choice')
  }

  const choice = body.choices[0]
  const finishReason = choice?.finish_reason
  if (finishReason !== 'stop') {
    throw new Error(
      `OMP auth gateway stopped with finish_reason "${finishReasonCategory(finishReason)}" ` +
      'instead of completing the response'
    )
  }

  const message = choice?.message
  if (!message || message.role !== 'assistant') {
    throw new Error('OMP auth gateway response is missing the assistant message')
  }
  if (typeof message.content !== 'string' || message.content.trim() === '') {
    // Never fall back to reasoning_content: it is private model scratch work,
    // not the requested answer.
    throw new Error('OMP auth gateway returned no assistant content')
  }

  return message.content
}

function asPositiveInteger(value, fallback, label) {
  const resolved = value ?? fallback
  if (!Number.isSafeInteger(resolved) || resolved < 1) {
    throw new TypeError(`${label} must be a positive integer`)
  }
  return resolved
}

function abortError() {
  const error = new Error('OMP 模型请求已取消')
  error.name = 'AbortError'
  error.code = 'ABORT_ERR'
  return error
}

function safeExitCode(code) {
  return Number.isInteger(code) && code >= 0 && code <= 255 ? String(code) : 'unknown'
}

function safeExitSignal(signal) {
  return typeof signal === 'string' && /^SIG[A-Z0-9]{1,15}$/.test(signal) ? signal : 'unknown'
}

export async function requestModel(options = {}) {
  // options.signal is an optional AbortSignal. An aborted request is rejected
  // immediately; an abort during execution kills the local gateway process and
  // clears the timeout/listeners. No credential or gateway configuration is
  // read or logged here.
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('requestModel expects an options object')
  }

  const {
    system = '',
    prompt,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    model = OMP_MODEL,
    command = process.env.OMP_BIN ?? 'omp',
    spawnProcess = spawn,
    signal,
    maxPromptBytes = defaultMaxPromptBytes,
    maxOutputBytes = defaultMaxOutputBytes,
    maxStderrBytes = defaultMaxStderrBytes
  } = options

  if (typeof system !== 'string') throw new TypeError('The system prompt must be a string')
  if (typeof prompt !== 'string' || prompt.trim() === '') {
    throw new TypeError('A non-empty prompt is required')
  }
  if (typeof model !== 'string' || model.trim() === '') {
    throw new TypeError('A model name is required')
  }
  if (typeof command !== 'string' || command.trim() === '') {
    throw new TypeError('An OMP executable is required')
  }
  if (typeof spawnProcess !== 'function') {
    throw new TypeError('spawnProcess must be a function')
  }
  if (signal !== undefined) {
    if (
      signal === null ||
      typeof signal !== 'object' ||
      typeof signal.aborted !== 'boolean' ||
      typeof signal.addEventListener !== 'function' ||
      typeof signal.removeEventListener !== 'function'
    ) {
      throw new TypeError('signal must be an AbortSignal')
    }
    if (signal.aborted) throw abortError()
  }

  const timeout = asPositiveInteger(timeoutMs, DEFAULT_TIMEOUT_MS, 'timeoutMs')
  const promptLimit = asPositiveInteger(maxPromptBytes, defaultMaxPromptBytes, 'maxPromptBytes')
  const outputLimit = asPositiveInteger(maxOutputBytes, defaultMaxOutputBytes, 'maxOutputBytes')
  const stderrLimit = asPositiveInteger(maxStderrBytes, defaultMaxStderrBytes, 'maxStderrBytes')

  const requestBytes = Buffer.byteLength(system, 'utf8') + Buffer.byteLength(prompt, 'utf8')
  if (requestBytes > promptLimit) {
    throw new Error(`The model request is larger than the ${promptLimit} byte limit`)
  }

  const request = buildGatewayRequest({ id: 1, model, system, prompt })
  const requestLine = `${JSON.stringify(request)}\n`

  return new Promise((resolve, reject) => {
    let child
    try {
      child = spawnProcess(command, buildGatewayArgs(), {
        shell: false,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe']
      })
    } catch {
      reject(new Error('Unable to start OMP auth gateway'))
      return
    }

    let settled = false
    let sawReady = false
    let stdoutBuffer = ''
    let stdoutBytes = 0
    let stderrBytes = 0
    let timer
    let abortHandler
    const listeners = {}

    const cleanup = () => {
      clearTimeout(timer)
      if (abortHandler && signal) signal.removeEventListener('abort', abortHandler)
      abortHandler = undefined
      for (const [emitter, event, handler] of [
        [child.stdout, 'data', listeners.stdoutData],
        [child.stderr, 'data', listeners.stderrData]
      ]) {
        if (handler) emitter?.removeListener?.(event, handler)
      }
    }

    const finish = (callback, value) => {
      if (settled) return
      settled = true
      cleanup()
      callback(value)
    }

    const fail = (error) => {
      if (settled) return
      settled = true
      cleanup()
      try {
        child.kill()
      } catch {
        // The process may already have exited.
      }
      reject(error)
    }

    const handleLine = (rawLine) => {
      if (settled) return
      const line = rawLine.trim()
      if (!line) return

      let event
      try {
        event = JSON.parse(line)
      } catch {
        fail(new Error('OMP auth gateway returned a non-JSON output line'))
        return
      }
      if (!event || typeof event !== 'object' || Array.isArray(event)) {
        fail(new Error('OMP auth gateway returned a non-object output line'))
        return
      }

      if (Object.hasOwn(event, 'ready')) {
        if (sawReady) {
          fail(new Error('OMP auth gateway announced readiness more than once'))
          return
        }
        if (event.ready !== true) {
          fail(new Error('OMP auth gateway did not become ready'))
          return
        }
        sawReady = true
        return
      }

      if (!sawReady) {
        fail(new Error('OMP auth gateway responded before announcing readiness'))
        return
      }
      if (event.id !== 1) {
        fail(new Error('OMP auth gateway returned a response with an unexpected id'))
        return
      }

      let content
      try {
        content = parseGatewayResponse(line, { id: 1, model })
      } catch (error) {
        fail(error)
        return
      }
      finish(resolve, content)
    }

    const consume = (chunk) => {
      stdoutBytes += Buffer.byteLength(chunk)
      if (stdoutBytes > outputLimit) {
        fail(new Error(`OMP auth gateway produced more than ${outputLimit} bytes of output`))
        return
      }
      stdoutBuffer += chunk
      let newlineIndex
      while (!settled && (newlineIndex = stdoutBuffer.indexOf('\n')) !== -1) {
        const line = stdoutBuffer.slice(0, newlineIndex)
        stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1)
        handleLine(line)
      }
    }

    listeners.stdoutData = (chunk) => consume(String(chunk))
    listeners.stdoutError = () => {
      fail(new Error('Unable to read OMP auth gateway stdout'))
    }
    listeners.stderrData = (chunk) => {
      // stderr may echo endpoints, credentials, or provider diagnostics. Keep
      // only a bounded byte count and never retain or display its contents.
      stderrBytes += Buffer.byteLength(chunk)
      if (stderrBytes > stderrLimit) {
        fail(new Error(`OMP auth gateway produced more than ${stderrLimit} bytes of stderr output`))
      }
    }
    listeners.stderrError = () => {
      // The close/error handlers report the real process failure.
    }

    child.stdout?.setEncoding?.('utf8')
    child.stderr?.setEncoding?.('utf8')
    child.stdout?.on('data', listeners.stdoutData)
    child.stdout?.on('error', listeners.stdoutError)
    child.stderr?.on('data', listeners.stderrData)
    child.stderr?.on('error', listeners.stderrError)
    child.once('error', () => {
      fail(new Error('Unable to start OMP auth gateway'))
    })
    child.once('close', (code, exitSignal) => {
      if (settled) return
      if (stdoutBuffer.trim()) handleLine(stdoutBuffer)
      if (settled) return
      const reason = code === null
        ? `signal ${safeExitSignal(exitSignal)}`
        : `exit code ${safeExitCode(code)}`
      fail(new Error(
        `OMP auth gateway exited with ${reason} before returning a response`
      ))
    })

    child.stdin?.on('error', () => {
      // A failed write normally surfaces through the child's close event.
    })

    timer = setTimeout(() => {
      fail(new Error(`OMP model request timed out after ${timeout} ms`))
    }, timeout)

    if (signal) {
      if (signal.aborted) {
        fail(abortError())
        return
      }
      abortHandler = () => fail(abortError())
      signal.addEventListener('abort', abortHandler, { once: true })
    }

    if (settled) return
    try {
      child.stdin.end(requestLine)
    } catch {
      fail(new Error('Unable to send the prompt to OMP auth gateway'))
    }
  })
}
