import { readFile, realpath } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse as parseYaml } from 'yaml'

// Direct, local-only access to an OpenAI-compatible chat completions endpoint.
// The provider secret is read from an ignored private file and never leaves
// this process except in the Authorization header of the request itself.
// No Oh My Pi executable, gateway, login state, or environment is consulted.
const here = path.dirname(fileURLToPath(import.meta.url))
const repositoryRoot = path.resolve(here, '..')
const repositoryDocsPath = path.join(repositoryRoot, 'docs')

export const AI_MODEL_CONFIG_PATH = path.join(here, 'model-config.yaml')
export const DEFAULT_TIMEOUT_MS = 300_000
export const DEFAULT_MAX_OUTPUT_TOKENS = 16_384

const DOCS_CONFIG_ERROR = '模型配置文件不能位于站点的 docs 目录'
const UNSAFE_REPOSITORY_CONFIG_ERROR =
  '模型配置文件必须位于仓库外，或使用仓库内已忽略的 tools/model-config.yaml、tools/model-config.yml、tools/model-config.json、tools/*.key、tools/*.pem、tools/*.secret.*、tools/*.private.*、tools/*.local.*、tools/.env*，或根目录 .env/.env.*（.env.example 除外）'

const MAX_TIMEOUT_MS = 2_147_483_647
const MAX_CONFIG_BYTES = 1024 * 1024
// Conservative transport guard. It is deliberately independent of any
// tokenizer: UTF-8 bytes are an upper bound on token count, so a prompt below
// this limit cannot exceed the context budget even in the worst case. The
// configured contextWindow and maxTokens still cap each individual request.
const DEFAULT_MAX_PROMPT_BYTES = 512 * 1024
const DEFAULT_MAX_RESPONSE_BYTES = 16 * 1024 * 1024
const DEFAULT_REASONING_EFFORT = 'none'
const acceptedApis = new Set(['openai-completions', 'openai-compatible'])
const acceptedReasoningEfforts = new Set(['none', 'low', 'medium', 'high', 'max'])

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function modelError(message, code) {
  const error = new Error(message)
  error.code = code
  return error
}

function configError(message) {
  return modelError(message, 'MODEL_CONFIG_ERROR')
}

function responseError(message) {
  return modelError(message, 'MODEL_RESPONSE_ERROR')
}

function requestError(message) {
  return modelError(message, 'MODEL_REQUEST_ERROR')
}

function abortError() {
  const error = new Error('模型请求已取消')
  error.name = 'AbortError'
  error.code = 'ABORT_ERR'
  return error
}

function timeoutError(timeoutMs) {
  const error = new Error(`模型请求超时（${timeoutMs} 毫秒）`)
  error.name = 'TimeoutError'
  error.code = 'MODEL_TIMEOUT'
  error.timeoutMs = timeoutMs
  return error
}

function requirePositiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`${label} 必须是正整数`)
  }
  return value
}

function optionalPositiveInteger(value, label) {
  if (value === undefined || value === null) return null
  if (!Number.isSafeInteger(value) || value < 1) {
    throw configError(`${label} 必须是正整数`)
  }
  return value
}

function configString(value, label) {
  if (typeof value !== 'string') throw configError(`${label} 必须是字符串`)
  const trimmed = value.trim()
  if (!trimmed) throw configError(`${label} 不能为空`)
  if (trimmed.length > 256) throw configError(`${label} 过长`)
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) {
    throw configError(`${label} 含有控制字符`)
  }
  return trimmed
}

function envValue(name) {
  const value = process.env[name]
  if (value === undefined) return undefined
  const trimmed = value.trim()
  return trimmed ? trimmed : undefined
}

function normalizePathForComparison(value) {
  const absolute = path.resolve(value)
  return process.platform === 'win32' ? absolute.toLowerCase() : absolute
}

function relativePathWithin(parent, child) {
  const relative = path.relative(
    normalizePathForComparison(parent),
    normalizePathForComparison(child)
  )
  return (
    path.isAbsolute(relative) ||
    relative === '..' ||
    relative.startsWith(`..${path.sep}`)
  ) ? null : relative
}

// Keep this list aligned with .gitignore. Only direct children of tools/ that
// Git already ignores may hold a repository-internal configuration; everything
// else must live outside the repository.
function isAllowedRepositoryConfigRelative(relative) {
  const normalizedPath = relative.split(path.sep).join('/')
  const normalized = process.platform === 'win32'
    ? normalizedPath.toLowerCase()
    : normalizedPath
  if (!normalized.includes('/') && (
    normalized === '.env' ||
    (normalized.startsWith('.env.') && normalized !== '.env.example')
  )) {
    return true
  }
  if (!normalized.startsWith('tools/')) return false

  const fileName = normalized.slice('tools/'.length)
  if (!fileName || fileName.includes('/')) return false
  return fileName === '.env'
    || fileName.startsWith('.env.')
    || fileName === 'model-config.yaml'
    || fileName === 'model-config.yml'
    || fileName === 'model-config.json'
    || fileName.endsWith('.key')
    || fileName.endsWith('.pem')
    || /^.+\.secret\..+$/.test(fileName)
    || /^.+\.private\..+$/.test(fileName)
    || /^.+\.local\..+$/.test(fileName)
}

function assertConfigNotInDocs(candidate, docsPaths) {
  for (const docsPath of docsPaths) {
    if (relativePathWithin(docsPath, candidate) !== null) {
      throw configError(DOCS_CONFIG_ERROR)
    }
  }
}

function assertRepositoryConfigAllowed(candidate, repositoryRoots) {
  for (const root of repositoryRoots) {
    const relative = relativePathWithin(root, candidate)
    if (relative !== null && !isAllowedRepositoryConfigRelative(relative)) {
      throw configError(UNSAFE_REPOSITORY_CONFIG_ERROR)
    }
  }
}

async function canonicalizeConfigPath(absolutePath) {
  try {
    return await realpath(absolutePath)
  } catch (error) {
    // Only a missing file is safe to resolve through its parent. Any other
    // resolution failure fails closed instead of reading an unresolved path.
    if (error?.code !== 'ENOENT') {
      throw configError(`无法读取模型配置文件${readErrorLabel(error?.code)}`)
    }
    const parent = path.dirname(absolutePath)
    let realParent
    try {
      realParent = await realpath(parent)
    } catch (parentError) {
      if (parentError?.code !== 'ENOENT') {
        throw configError(`无法读取模型配置文件${readErrorLabel(parentError?.code)}`)
      }
      realParent = parent
    }
    return path.join(realParent, path.basename(absolutePath))
  }
}

async function resolveConfigPath(configPath) {
  const requested = path.resolve(
    configPath ?? envValue('AI_MODEL_CONFIG') ?? AI_MODEL_CONFIG_PATH
  )
  const repositoryRoots = [repositoryRoot]
  const docsPaths = [repositoryDocsPath]

  const realRepositoryRoot = await realpath(repositoryRoot).catch(() => null)
  if (realRepositoryRoot) {
    repositoryRoots.push(realRepositoryRoot)
    const realRepositoryDocs = path.join(realRepositoryRoot, 'docs')
    docsPaths.push(realRepositoryDocs)
    const resolvedDocs = await realpath(realRepositoryDocs).catch(() => null)
    if (resolvedDocs) docsPaths.push(resolvedDocs)
  }
  const resolvedLexicalDocs = await realpath(repositoryDocsPath).catch(() => null)
  if (resolvedLexicalDocs) docsPaths.push(resolvedLexicalDocs)

  assertConfigNotInDocs(requested, docsPaths)
  const canonical = await canonicalizeConfigPath(requested)
  assertConfigNotInDocs(canonical, docsPaths)
  assertRepositoryConfigAllowed(requested, repositoryRoots)
  assertRepositoryConfigAllowed(canonical, repositoryRoots)
  return canonical
}

function readErrorLabel(code) {
  return typeof code === 'string' && /^[A-Z0-9_]{1,32}$/.test(code) ? `（${code}）` : ''
}

async function readConfigText(configPath) {
  let text
  try {
    text = await readFile(configPath, 'utf8')
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw configError('模型配置文件不存在')
    }
    if (error?.code === 'EACCES' || error?.code === 'EPERM') {
      throw configError('无法读取模型配置文件（权限不足）')
    }
    // Report only a fixed category and an optional error code, never a path.
    throw configError(`无法读取模型配置文件${readErrorLabel(error?.code)}`)
  }
  if (Buffer.byteLength(text, 'utf8') > MAX_CONFIG_BYTES) {
    throw configError('模型配置文件过大')
  }
  return text
}

function parseConfigText(text, configPath) {
  const trimmed = text.trim()
  if (!trimmed) throw configError('模型配置文件为空')

  const looksLikeJson = /\.json$/i.test(configPath) || trimmed.startsWith('{')
  let parsed
  if (looksLikeJson) {
    try {
      parsed = JSON.parse(trimmed)
    } catch {
      // Never include the parser's excerpt: it can contain the private key.
      throw configError('模型配置文件不是有效的 JSON')
    }
  } else {
    try {
      parsed = parseYaml(trimmed)
    } catch (error) {
      const line = Array.isArray(error?.linePos) && Number.isInteger(error.linePos[0]?.line)
        ? `（第 ${error.linePos[0].line} 行）`
        : ''
      // Never include the parser's source excerpt: it can contain the key.
      throw configError(`模型配置文件不是有效的 YAML${line}`)
    }
  }
  if (!isPlainObject(parsed)) throw configError('模型配置必须是对象')
  return parsed
}

function selectProvider(config, requestedProvider) {
  const providers = config.providers
  if (!isPlainObject(providers) || Object.keys(providers).length === 0) {
    throw configError('模型配置缺少 providers')
  }
  const names = Object.keys(providers)
  let name
  if (requestedProvider !== undefined) {
    name = names.find((candidate) => candidate === requestedProvider)
      ?? names.find((candidate) => candidate.toLowerCase() === requestedProvider.toLowerCase())
    if (!name) throw configError('未找到指定的模型提供方')
  } else {
    name = names.includes('ustc') ? 'ustc' : names[0]
  }
  const provider = providers[name]
  if (!isPlainObject(provider)) throw configError('模型提供方配置必须是对象')
  return { name, provider }
}

function normalizeBaseUrl(value) {
  const raw = configString(value, 'baseUrl')
  let url
  try {
    url = new URL(raw)
  } catch {
    throw configError('baseUrl 不是有效的 URL')
  }
  const loopbackHosts = new Set(['localhost', '127.0.0.1', '[::1]', '::1'])
  const isLoopback = loopbackHosts.has(url.hostname.toLowerCase())
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopback)) {
    throw configError('baseUrl 必须使用 HTTPS（本机回环地址可使用 HTTP）')
  }
  if (url.username || url.password) throw configError('baseUrl 不能包含凭据')
  if (raw.includes('?') || raw.includes('#') || url.search || url.hash) {
    throw configError('baseUrl 不能包含查询参数或片段')
  }
  return raw.replace(/\/+$/, '')
}

function buildEndpoint(baseUrl) {
  return baseUrl.endsWith('/chat/completions')
    ? baseUrl
    : `${baseUrl}/chat/completions`
}

function normalizeReasoningEffort(value) {
  if (value === undefined) return DEFAULT_REASONING_EFFORT
  if (value === null || value === false || value === 'off') return null
  if (typeof value !== 'string') throw configError('reasoningEffort 配置无效')
  const normalized = value.trim().toLowerCase()
  if (!acceptedReasoningEfforts.has(normalized)) {
    throw configError('reasoningEffort 必须是 none、low、medium、high、max 或 null')
  }
  return normalized
}

function normalizeModel(entry, index, provider) {
  if (!isPlainObject(entry)) throw configError(`models[${index}] 必须是对象`)
  const id = configString(entry.id, `models[${index}].id`)
  const name = entry.name === undefined
    ? id
    : configString(entry.name, `models[${index}].name`)
  const contextWindow = optionalPositiveInteger(
    entry.contextWindow,
    `models[${index}].contextWindow`
  )
  const maxTokens = optionalPositiveInteger(entry.maxTokens, `models[${index}].maxTokens`)
  if (contextWindow !== null && maxTokens !== null && maxTokens > contextWindow) {
    throw configError(`models[${index}] 的 maxTokens 不能大于 contextWindow`)
  }

  let input = []
  if (entry.input !== undefined) {
    if (
      !Array.isArray(entry.input) ||
      entry.input.length === 0 ||
      entry.input.some((value) => typeof value !== 'string' || !value.trim())
    ) {
      throw configError(`models[${index}].input 必须是非空字符串数组`)
    }
    input = entry.input.map((value) => value.trim())
  }

  const reasoningEffort = normalizeReasoningEffort(
    entry.reasoningEffort !== undefined
      ? entry.reasoningEffort
      : provider.reasoningEffort
  )

  return Object.freeze({
    id,
    name,
    contextWindow,
    maxTokens,
    input: Object.freeze(input),
    reasoningEffort
  })
}

function selectModel(models, requestedModel) {
  if (requestedModel === undefined || requestedModel === null) return models[0]
  const value = String(requestedModel).trim()
  if (!value) throw configError('模型名称不能为空')
  const found = models.find((model) => model.id === value)
    ?? models.find((model) => model.name === value)
    ?? models.find((model) =>
      model.id.toLowerCase() === value.toLowerCase() ||
      model.name.toLowerCase() === value.toLowerCase()
    )
  if (!found) {
    const ids = models.map((model) => model.id).join(', ')
    throw configError(`未找到指定的模型；可用模型 ID：${ids}`)
  }
  return found
}

async function loadModelConfig(options = {}) {
  const configPath = await resolveConfigPath(options.configPath)
  const config = parseConfigText(await readConfigText(configPath), configPath)
  const { name: providerName, provider } = selectProvider(
    config,
    options.provider ?? envValue('AI_MODEL_PROVIDER')
  )

  if (!acceptedApis.has(provider.api)) {
    throw configError('仅支持 openai-completions 模型接口')
  }

  const apiKey = provider.apiKey
  if (typeof apiKey !== 'string' || !apiKey.trim()) {
    throw configError('模型配置缺少 apiKey')
  }
  if (apiKey.length > 8192 || /[\r\n]/.test(apiKey)) {
    throw configError('模型配置中的 apiKey 无效')
  }

  if (!Array.isArray(provider.models) || provider.models.length === 0) {
    throw configError('模型配置缺少 models')
  }
  const seenIds = new Set()
  const models = provider.models.map((entry, index) => {
    const model = normalizeModel(entry, index, provider)
    if (seenIds.has(model.id)) throw configError('模型配置包含重复的 id')
    seenIds.add(model.id)
    return model
  })

  const baseUrl = normalizeBaseUrl(provider.baseUrl)
  const model = selectModel(models, options.model ?? envValue('AI_MODEL'))

  return {
    provider: providerName,
    api: provider.api,
    baseUrl,
    endpoint: buildEndpoint(baseUrl),
    apiKey: apiKey.trim(),
    model,
    models
  }
}

function publicModel(model) {
  return {
    id: model.id,
    name: model.name,
    contextWindow: model.contextWindow,
    maxTokens: model.maxTokens,
    input: [...model.input],
    reasoningEffort: model.reasoningEffort
  }
}

/**
 * Returns non-sensitive provider/model metadata for CLIs and local UI code.
 * The API key is never part of the returned object.
 */
export async function getModelInfo(options = {}) {
  if (!isPlainObject(options)) throw new TypeError('getModelInfo 需要一个选项对象')
  if (options.configPath !== undefined && typeof options.configPath !== 'string') {
    throw new TypeError('configPath 必须是字符串')
  }
  if (options.provider !== undefined && typeof options.provider !== 'string') {
    throw new TypeError('provider 必须是字符串')
  }
  if (options.model !== undefined && typeof options.model !== 'string') {
    throw new TypeError('model 必须是字符串')
  }
  const loaded = await loadModelConfig(options)
  return {
    provider: loaded.provider,
    api: loaded.api,
    endpoint: loaded.endpoint,
    model: publicModel(loaded.model),
    models: loaded.models.map(publicModel)
  }
}

function safeHttpCategory(status) {
  if (status === 401 || status === 403 || status === 407) {
    return '鉴权失败，请检查本地模型配置'
  }
  if (status === 408 || status === 504) return '上游超时'
  if (status === 429) return '请求频率受限'
  if (status >= 500) return '模型服务错误'
  if (status >= 400) return '请求被拒绝'
  if (status >= 300) return '意外的重定向'
  if (status >= 200) return '意外的成功状态'
  return '意外的响应状态'
}

const knownFinishReasons = new Set([
  'length',
  'content_filter',
  'tool_calls',
  'function_call'
])

function finishReasonCategory(value) {
  if (value === undefined || value === null) return '缺失'
  if (typeof value !== 'string') return '无效'
  // Never echo an arbitrary upstream string: it may be a credential or other
  // sensitive value even when it looks like a short lowercase identifier.
  return knownFinishReasons.has(value) ? value : 'other'
}

function validateCompletion(body, requestedModelId) {
  if (!isPlainObject(body)) throw responseError('模型响应必须是 JSON 对象')
  if (body.model !== requestedModelId) {
    throw responseError('模型服务返回了不同的模型')
  }
  if (!Array.isArray(body.choices) || body.choices.length !== 1) {
    throw responseError('模型响应必须恰好包含一个选择')
  }

  const choice = body.choices[0]
  if (!isPlainObject(choice)) throw responseError('模型响应缺少选择对象')
  if (choice.finish_reason !== 'stop') {
    throw responseError(
      `模型响应未正常完成（finish_reason：${finishReasonCategory(choice.finish_reason)}）`
    )
  }

  const message = choice.message
  if (!isPlainObject(message) || message.role !== 'assistant') {
    throw responseError('模型响应缺少助手消息')
  }
  if (typeof message.content !== 'string' || message.content.trim() === '') {
    // Reasoning content is private scratch work, never a fallback answer.
    throw responseError('模型响应没有助手内容')
  }
  return message.content
}

function cancelQuietly(target) {
  try {
    const result = target?.cancel?.()
    if (result && typeof result.catch === 'function') result.catch(() => {})
  } catch {
    // The body or reader may already be closed, errored, or absent.
  }
}

function isPassThroughModelError(error) {
  return Boolean(error?.__aiModelAbort) ||
    error?.code === 'MODEL_TIMEOUT' ||
    error?.code === 'ABORT_ERR' ||
    error?.code === 'MODEL_RESPONSE_ERROR'
}

async function readStreamText(reader, maxBytes, waitWithAbort) {
  const decoder = new TextDecoder('utf-8', { fatal: true })
  const parts = []
  let bytes = 0

  try {
    while (true) {
      const result = await waitWithAbort(Promise.resolve().then(() => reader.read()))
      if (result?.done) break
      const value = result?.value
      if (!(value instanceof Uint8Array)) {
        throw responseError('模型响应不是字节流')
      }
      bytes += value.byteLength
      if (bytes > maxBytes) {
        throw responseError('模型响应过大')
      }
      try {
        const decoded = decoder.decode(value, { stream: true })
        if (decoded) parts.push(decoded)
      } catch {
        throw responseError('模型响应不是有效的 UTF-8')
      }
    }

    try {
      const decoded = decoder.decode()
      if (decoded) parts.push(decoded)
    } catch {
      throw responseError('模型响应不是有效的 UTF-8')
    }
    return parts.join('')
  } catch (error) {
    if (isPassThroughModelError(error)) throw error
    throw responseError('无法读取模型响应')
  }
}

async function readResponseText(response, maxBytes, waitWithAbort) {
  const contentType = response.headers?.get?.('content-type')
  if (contentType && !/\b(?:application|text)\/json\b/i.test(contentType)) {
    cancelQuietly(response?.body)
    throw responseError('模型服务返回了非 JSON 响应')
  }

  const contentLength = response.headers?.get?.('content-length')
  if (typeof contentLength === 'string' && /^\d+$/.test(contentLength)) {
    if (Number(contentLength) > maxBytes) {
      cancelQuietly(response?.body)
      throw responseError('模型响应过大')
    }
  }

  const body = response?.body
  if (body && typeof body.getReader === 'function') {
    let reader
    try {
      reader = body.getReader()
    } catch {
      throw responseError('无法读取模型响应')
    }
    try {
      return await readStreamText(reader, maxBytes, waitWithAbort)
    } catch (error) {
      cancelQuietly(reader)
      throw error
    } finally {
      try {
        reader.releaseLock()
      } catch {
        // A pending read or cancellation may keep the lock until it settles.
      }
    }
  }

  // Body-less custom responses and test doubles may only expose text().
  let text
  try {
    text = await waitWithAbort(Promise.resolve().then(() => response.text()))
  } catch (error) {
    if (isPassThroughModelError(error)) throw error
    throw responseError('无法读取模型响应')
  }
  if (typeof text !== 'string') throw responseError('模型响应不是文本')
  if (Buffer.byteLength(text, 'utf8') > maxBytes) {
    throw responseError('模型响应过大')
  }
  return text
}

function promptByteLimit(model, maxOutputTokens) {
  if (Number.isSafeInteger(model.contextWindow) && model.contextWindow > 0) {
    const outputBudget = model.maxTokens === null
      ? maxOutputTokens
      : Math.min(maxOutputTokens, model.maxTokens)
    const inputBudget = model.contextWindow - outputBudget
    if (inputBudget > 0) return Math.min(DEFAULT_MAX_PROMPT_BYTES, inputBudget)
  }
  return DEFAULT_MAX_PROMPT_BYTES
}

function assertSignal(signal) {
  if (signal === undefined) return
  if (
    signal === null ||
    typeof signal !== 'object' ||
    typeof signal.aborted !== 'boolean' ||
    typeof signal.addEventListener !== 'function' ||
    typeof signal.removeEventListener !== 'function'
  ) {
    throw new TypeError('signal 必须是 AbortSignal')
  }
}

function resolveTimeoutMs(value) {
  let resolved = value
  if (resolved === undefined) {
    const raw = process.env.AI_REQUEST_TIMEOUT_MS
    if (raw !== undefined && raw !== '') {
      if (!/^\d+$/.test(raw)) {
        throw new TypeError('AI_REQUEST_TIMEOUT_MS 必须是正整数')
      }
      resolved = Number(raw)
    }
  }
  if (resolved === undefined) resolved = DEFAULT_TIMEOUT_MS
  if (!Number.isSafeInteger(resolved) || resolved < 1 || resolved > MAX_TIMEOUT_MS) {
    throw new TypeError('timeoutMs 必须是 1 到 2147483647 之间的整数')
  }
  return resolved
}

/**
 * Requests one assistant reply from the configured OpenAI-compatible endpoint.
 *
 * @param {object} options
 * @param {string} [options.system]
 * @param {string} options.prompt
 * @param {number} [options.timeoutMs]
 * @param {AbortSignal} [options.signal]
 * @param {string} [options.model]
 * @param {string} [options.provider]
 * @param {string} [options.configPath]
 * @param {number} [options.maxOutputTokens]
 * @returns {Promise<string>} the assistant message content, never reasoning text
 */
export async function requestModel(options = {}) {
  if (!isPlainObject(options)) throw new TypeError('requestModel 需要一个选项对象')

  const {
    system = '',
    prompt,
    timeoutMs,
    signal,
    model: requestedModel,
    provider: requestedProvider,
    configPath,
    maxOutputTokens = DEFAULT_MAX_OUTPUT_TOKENS,
    maxPromptBytes,
    maxResponseBytes = DEFAULT_MAX_RESPONSE_BYTES,
    fetchImpl = globalThis.fetch
  } = options

  if (typeof system !== 'string') throw new TypeError('system 必须是字符串')
  if (typeof prompt !== 'string' || prompt.trim() === '') {
    throw new TypeError('prompt 必须是非空字符串')
  }
  for (const [label, value] of [
    ['model', requestedModel],
    ['provider', requestedProvider],
    ['configPath', configPath]
  ]) {
    if (value !== undefined && (typeof value !== 'string' || value.trim() === '')) {
      throw new TypeError(`${label} 必须是非空字符串`)
    }
  }
  if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl 必须是函数')
  requirePositiveInteger(maxOutputTokens, 'maxOutputTokens')
  const responseLimit = requirePositiveInteger(maxResponseBytes, 'maxResponseBytes')
  if (maxPromptBytes !== undefined) requirePositiveInteger(maxPromptBytes, 'maxPromptBytes')
  const timeout = resolveTimeoutMs(timeoutMs)
  assertSignal(signal)
  if (signal?.aborted) throw abortError()

  const loaded = await loadModelConfig({ configPath, provider: requestedProvider, model: requestedModel })
  if (signal?.aborted) throw abortError()

  const effectiveOutputTokens = loaded.model.maxTokens === null
    ? maxOutputTokens
    : Math.min(maxOutputTokens, loaded.model.maxTokens)
  if (
    loaded.model.contextWindow !== null &&
    effectiveOutputTokens >= loaded.model.contextWindow
  ) {
    throw requestError('maxOutputTokens 必须小于模型的上下文窗口')
  }
  const promptLimit = maxPromptBytes ?? promptByteLimit(loaded.model, effectiveOutputTokens)
  const requestBytes = Buffer.byteLength(system, 'utf8') + Buffer.byteLength(prompt, 'utf8')
  if (requestBytes > promptLimit) {
    throw requestError(`模型请求过大：超过安全上限 ${promptLimit} 字节`)
  }

  const messages = []
  if (system.trim()) messages.push({ role: 'system', content: system })
  messages.push({ role: 'user', content: prompt })

  const payload = {
    model: loaded.model.id,
    messages,
    max_tokens: effectiveOutputTokens
  }
  if (loaded.model.reasoningEffort) {
    payload.reasoning_effort = loaded.model.reasoningEffort
  }

  const controller = new AbortController()
  let timedOut = false

  const onExternalAbort = () => controller.abort()
  signal?.addEventListener('abort', onExternalAbort, { once: true })
  if (signal?.aborted) controller.abort()

  let rejectAbort
  const abortPromise = new Promise((_, reject) => {
    rejectAbort = reject
  })
  abortPromise.catch(() => {})
  controller.signal.addEventListener('abort', () => {
    const error = new Error('aborted')
    error.__aiModelAbort = true
    rejectAbort(error)
  }, { once: true })

  const timer = setTimeout(() => {
    if (controller.signal.aborted) return
    timedOut = true
    controller.abort()
  }, timeout)

  const rethrowAbort = () => {
    if (timedOut) return timeoutError(timeout)
    return abortError()
  }

  const waitWithAbort = async (promise) => {
    promise.catch?.(() => {})
    try {
      return await Promise.race([promise, abortPromise])
    } catch (error) {
      if (error?.__aiModelAbort) throw rethrowAbort()
      throw error
    }
  }

  try {
    if (signal?.aborted) throw abortError()

    let response
    try {
      response = await waitWithAbort(
        Promise.resolve().then(() => fetchImpl(loaded.endpoint, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${loaded.apiKey}`,
            'content-type': 'application/json',
            accept: 'application/json'
          },
          body: JSON.stringify(payload),
          signal: controller.signal,
          redirect: 'error'
        }))
      )
    } catch (error) {
      if (error?.name === 'AbortError' || error?.__aiModelAbort) throw rethrowAbort()
      if (signal?.aborted) throw abortError()
      if (timedOut) throw timeoutError(timeout)
      throw modelError('模型请求失败：无法连接模型服务', 'MODEL_NETWORK_ERROR')
    }

    const status = response?.status
    if (!Number.isInteger(status) || status < 100 || status > 599) {
      cancelQuietly(response?.body)
      throw responseError('模型服务返回了无效的 HTTP 状态')
    }
    if (status !== 200) {
      cancelQuietly(response?.body)
      const error = modelError(
        `模型请求失败：HTTP ${status}（${safeHttpCategory(status)}）`,
        'MODEL_HTTP_ERROR'
      )
      error.status = status
      throw error
    }

    const text = await readResponseText(response, responseLimit, waitWithAbort)
    let body
    try {
      body = JSON.parse(text)
    } catch {
      throw responseError('模型响应不是有效的 JSON')
    }
    return validateCompletion(body, loaded.model.id)
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onExternalAbort)
  }
}

// Defense-in-depth display sanitizer for diagnostics that may include model
// output or local error text. Request credentials, request bodies, endpoints,
// and upstream response bodies never reach this function from requestModel.
const sensitiveAssignmentPattern =
  /((?:"|')?(?:authorization[_-]?code|authorization|proxy[_-]?authorization|authentication|auth|api[_-]?key|x[_-]?api[_-]?key|x[_-]?auth[_-]?token|access[_-]?token|refresh[_-]?token|id[_-]?token|session[_-]?token|session[_-]?id|access[_-]?key(?:[_-]?id)?|secret[_-]?key|signing[_-]?key|token|secret|client[_-]?secret|password|passwd|credential|credentials|cookie|set[_-]?cookie|private[_-]?key|base[_-]?url|base[_-]?uri|endpoint[_-]?url|endpoint|url|uri|hostname|host|proxy|gateway|model[_-]?name|model|message|error|errors|detail|details|reason|stack|stderr|stdout|body|response|request|headers|bearer|jwt|session|csrf|xsrf|nonce|signature|code)(?:"|')?\s*[:=]\s*)(?:"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|[^\s,;&{}\[\]\r\n]+)/gi

/**
 * Redacts URLs, bearer credentials, API keys, and assignment-style secret
 * fields from local diagnostic text without ever printing a secret.
 */
export function sanitizeModelError(value, maxLength = 2_000) {
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
  const limit = Number.isSafeInteger(maxLength) && maxLength > 0 ? maxLength : 2_000
  return text.length > limit ? `${text.slice(0, limit)}…` : text
}
