import assert from 'node:assert/strict'
import { mkdtemp, rmdir, rm, symlink, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { stringify as stringifyYaml } from 'yaml'
import {
  DEFAULT_TIMEOUT_MS,
  getModelInfo,
  requestModel,
  sanitizeModelError
} from './ai-model.mjs'

// This is a test-only sentinel, never a real credential.
const SECRET = 'sk-test-SECRET_SENTINEL_4f8c2d'
const BASE_URL = 'https://model.example/v1'
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const repositoryDocsPath = path.join(repositoryRoot, 'docs')

const MODEL_A = {
  id: 'model-a',
  name: 'Model A',
  contextWindow: 1_000_000,
  maxTokens: 65_536,
  input: ['text']
}
const MODEL_B = {
  id: 'model-b',
  name: 'Model B',
  contextWindow: 32_768,
  maxTokens: 4_096,
  input: ['text', 'image']
}

function makeConfigText(options = {}) {
  const {
    baseUrl = BASE_URL,
    api = 'openai-completions',
    providerName = 'ustc',
    models = [MODEL_A, MODEL_B],
    providerExtra = {}
  } = options
  // Distinguish an omitted option from an explicit `undefined`: callers use
  // `{ apiKey: undefined }` to test a config that genuinely has no key.
  const apiKey = Object.hasOwn(options, 'apiKey') ? options.apiKey : SECRET
  return stringifyYaml({
    providers: {
      [providerName]: {
        baseUrl,
        api,
        ...(apiKey === undefined ? {} : { apiKey }),
        models,
        ...providerExtra
      }
    }
  })
}

async function makeTempDir(t) {
  const dir = await mkdtemp(path.join(tmpdir(), 'ai-model-test-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  return dir
}

async function writeConfig(t, text = makeConfigText(), fileName = 'api-key.yaml') {
  const dir = await makeTempDir(t)
  const configPath = path.join(dir, fileName)
  await writeFile(configPath, text, 'utf8')
  return configPath
}

function completion({
  model = 'model-a',
  content = 'translated text',
  finishReason = 'stop',
  role = 'assistant',
  reasoningContent
} = {}) {
  return {
    id: 'chatcmpl-test',
    object: 'chat.completion',
    model,
    choices: [{
      index: 0,
      message: {
        role,
        content,
        ...(reasoningContent === undefined ? {} : { reasoning_content: reasoningContent })
      },
      finish_reason: finishReason
    }]
  }
}

function jsonResponse(body, { status = 200, headers = {} } = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers }
  })
}

function recordingFetch(respond) {
  const calls = []
  const fetchImpl = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) })
    return respond(calls.length)
  }
  return { fetchImpl, calls }
}

function streamedResponse(text, { chunkSize = 7, headers = {}, onCancel } = {}) {
  const bytes = new TextEncoder().encode(text)
  let offset = 0
  const stream = new ReadableStream({
    pull(controller) {
      if (offset >= bytes.byteLength) {
        controller.close()
        return
      }
      const end = Math.min(offset + chunkSize, bytes.byteLength)
      controller.enqueue(bytes.slice(offset, end))
      offset = end
    },
    cancel() {
      onCancel?.()
    }
  })
  return new Response(stream, {
    status: 200,
    headers: { 'content-type': 'application/json', ...headers }
  })
}

function hangingResponse({ onCancel } = {}) {
  return new Response(new ReadableStream({
    cancel() {
      onCancel?.()
    }
  }), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  })
}

function assertNoSecret(value, extraForbidden = []) {
  const text = String(value)
  assert.ok(!text.includes(SECRET), `secret leaked: ${text}`)
  assert.ok(!text.includes('model.example'), `endpoint leaked: ${text}`)
  for (const forbidden of extraForbidden) {
    assert.ok(!text.includes(forbidden), `sensitive value leaked: ${text}`)
  }
}

test('getModelInfo exposes metadata but never the API key', async (t) => {
  const configPath = await writeConfig(t)
  const info = await getModelInfo({ configPath })

  assert.equal(info.provider, 'ustc')
  assert.equal(info.api, 'openai-completions')
  assert.equal(info.endpoint, `${BASE_URL}/chat/completions`)
  assert.equal(info.model.id, 'model-a')
  assert.equal(info.model.name, 'Model A')
  assert.equal(info.model.contextWindow, 1_000_000)
  assert.equal(info.model.maxTokens, 65_536)
  assert.deepEqual(info.model.input, ['text'])
  assert.equal(info.model.reasoningEffort, 'none')
  assert.equal(info.models.length, 2)
  assert.equal(info.models[1].id, 'model-b')
  assert.ok(!('apiKey' in info))
  assert.ok(!('apiKey' in info.model))
  assert.ok(!JSON.stringify(info).includes(SECRET))
  assert.ok(!JSON.stringify(info).includes('apiKey'))
})

test('model selection accepts an id, a display name, and the default', async (t) => {
  const configPath = await writeConfig(t)

  assert.equal((await getModelInfo({ configPath })).model.id, 'model-a')
  assert.equal((await getModelInfo({ configPath, model: 'model-b' })).model.id, 'model-b')
  assert.equal((await getModelInfo({ configPath, model: 'Model B' })).model.id, 'model-b')
  assert.equal((await getModelInfo({ configPath, model: 'MODEL-B' })).model.id, 'model-b')
  await assert.rejects(
    getModelInfo({ configPath, model: 'missing-model' }),
    (error) => {
      assert.equal(error.code, 'MODEL_CONFIG_ERROR')
      assert.match(error.message, /model-a, model-b/)
      assertNoSecret(error.message)
      return true
    }
  )
})

test('requestModel sends a minimal chat completion request and returns content', async (t) => {
  const configPath = await writeConfig(t)
  const { fetchImpl, calls } = recordingFetch(() =>
    jsonResponse(completion({ content: '译文' }))
  )

  const result = await requestModel({
    configPath,
    system: 'System instruction',
    prompt: 'Translate this',
    fetchImpl
  })

  assert.equal(result, '译文')
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, `${BASE_URL}/chat/completions`)
  assert.equal(calls[0].init.method, 'POST')
  assert.equal(calls[0].init.redirect, 'error')
  assert.equal(calls[0].init.headers.authorization, `Bearer ${SECRET}`)
  assert.equal(calls[0].init.headers['content-type'], 'application/json')
  assert.equal(calls[0].init.headers.accept, 'application/json')
  assert.ok(calls[0].init.signal instanceof AbortSignal)
  assert.deepEqual(calls[0].body, {
    model: 'model-a',
    messages: [
      { role: 'system', content: 'System instruction' },
      { role: 'user', content: 'Translate this' }
    ],
    max_tokens: 16_384,
    reasoning_effort: 'none'
  })
  assert.equal(calls[0].body.apiKey, undefined)
  assert.equal(calls[0].body.key, undefined)
})

test('an empty system prompt is omitted and max_tokens is capped by config', async (t) => {
  const configPath = await writeConfig(t, makeConfigText({
    models: [{ ...MODEL_A, maxTokens: 100 }]
  }))
  const { fetchImpl, calls } = recordingFetch(() => jsonResponse(completion()))

  await requestModel({
    configPath,
    system: '   ',
    prompt: 'hello',
    maxOutputTokens: 200,
    fetchImpl
  })

  assert.deepEqual(calls[0].body.messages, [{ role: 'user', content: 'hello' }])
  assert.equal(calls[0].body.max_tokens, 100)
})

test('reasoningEffort null omits the optional request field', async (t) => {
  const configPath = await writeConfig(t, makeConfigText({
    providerExtra: { reasoningEffort: null }
  }))
  const { fetchImpl, calls } = recordingFetch(() => jsonResponse(completion()))

  await requestModel({ configPath, prompt: 'hello', fetchImpl })
  assert.ok(!Object.hasOwn(calls[0].body, 'reasoning_effort'))
})

test('JSON configuration is accepted and still keeps the key private', async (t) => {
  const configPath = await writeConfig(t, JSON.stringify({
    providers: {
      ustc: {
        baseUrl: BASE_URL,
        api: 'openai-completions',
        apiKey: SECRET,
        models: [MODEL_A]
      }
    }
  }), 'private.json')

  const info = await getModelInfo({ configPath })
  assert.equal(info.model.id, 'model-a')
  assert.ok(!JSON.stringify(info).includes(SECRET))
})

test('HTTP failures are categorized without echoing the upstream body', async (t) => {
  const configPath = await writeConfig(t)
  const cases = [
    [401, /HTTP 401/],
    [403, /HTTP 403/],
    [408, /HTTP 408/],
    [429, /HTTP 429/],
    [500, /HTTP 500/],
    [502, /HTTP 502/]
  ]

  for (const [status, expected] of cases) {
    const { fetchImpl } = recordingFetch(() =>
      jsonResponse({ error: { message: `${SECRET} https://model.example/private` } }, { status })
    )
    await assert.rejects(
      requestModel({ configPath, prompt: 'hello', fetchImpl }),
      (error) => {
        assert.equal(error.code, 'MODEL_HTTP_ERROR')
        assert.equal(error.status, status)
        assert.match(error.message, expected)
        assertNoSecret(error.message, ['private'])
        return true
      }
    )
  }
})

test('malformed or semantically invalid completions fail closed', async (t) => {
  const configPath = await writeConfig(t)
  const bodySentinel = 'RESPONSE_SENTINEL_2a7d'
  const contentSentinel = 'CONTENT_SENTINEL_9b4e'
  const reasoningSentinel = 'REASONING_SENTINEL_7c1f'

  async function expectFailure(response, pattern) {
    const { fetchImpl } = recordingFetch(() => response)
    await assert.rejects(
      requestModel({ configPath, prompt: 'hello', fetchImpl }),
      (error) => {
        assert.equal(error.code, 'MODEL_RESPONSE_ERROR')
        assert.match(error.message, pattern)
        assertNoSecret(error.message, [bodySentinel, contentSentinel, reasoningSentinel])
        return true
      }
    )
  }

  await expectFailure(
    new Response(`not json ${bodySentinel} ${SECRET}`, {
      status: 200,
      headers: { 'content-type': 'application/json' }
    }),
    /不是有效的 JSON/
  )
  await expectFailure(
    new Response(`<html>${bodySentinel}</html>`, {
      status: 200,
      headers: { 'content-type': 'text/html' }
    }),
    /非 JSON/
  )
  await expectFailure(jsonResponse(completion({ model: 'different-model' })), /不同的模型/)
  await expectFailure(jsonResponse({
    ...completion(),
    choices: [completion().choices[0], completion().choices[0]]
  }), /恰好包含一个选择/)
  await expectFailure(
    jsonResponse(completion({ finishReason: 'length', content: contentSentinel })),
    /length/
  )
  await expectFailure(
    jsonResponse(completion({ finishReason: `bad_${bodySentinel}`, content: contentSentinel })),
    /other/
  )
  await expectFailure(
    jsonResponse(completion({ content: '', reasoningContent: reasoningSentinel })),
    /没有助手内容/
  )
  await expectFailure(jsonResponse(completion({ role: 'user' })), /助手消息/)
  await expectFailure(jsonResponse({ model: 'model-a', choices: 'nope' }), /恰好包含一个选择/)
})

test('known finish reasons stay distinguishable while unknown reasons are redacted', async (t) => {
  const configPath = await writeConfig(t)

  for (const reason of ['length', 'content_filter', 'tool_calls', 'function_call']) {
    const { fetchImpl } = recordingFetch(() =>
      jsonResponse(completion({ finishReason: reason }))
    )
    await assert.rejects(
      requestModel({ configPath, prompt: 'hello', fetchImpl }),
      (error) => {
        assert.equal(error.code, 'MODEL_RESPONSE_ERROR')
        assert.match(error.message, new RegExp(`finish_reason：${reason}`))
        assertNoSecret(error.message)
        return true
      }
    )
  }

  // This matches the old short-lowercase pattern and must never be echoed.
  const sentinel = 'sk_live_secret_sentinel_9f3a'
  const { fetchImpl } = recordingFetch(() =>
    jsonResponse(completion({ finishReason: sentinel }))
  )
  await assert.rejects(
    requestModel({ configPath, prompt: 'hello', fetchImpl }),
    (error) => {
      assert.equal(error.code, 'MODEL_RESPONSE_ERROR')
      assert.match(error.message, /finish_reason：other/)
      assert.ok(!error.message.includes(sentinel))
      assertNoSecret(error.message)
      return true
    }
  )

  const missing = recordingFetch(() =>
    jsonResponse(completion({ finishReason: null }))
  )
  await assert.rejects(
    requestModel({ configPath, prompt: 'hello', fetchImpl: missing.fetchImpl }),
    (error) => /finish_reason：缺失/.test(error.message)
  )

  const invalid = recordingFetch(() =>
    jsonResponse(completion({ finishReason: 42 }))
  )
  await assert.rejects(
    requestModel({ configPath, prompt: 'hello', fetchImpl: invalid.fetchImpl }),
    (error) => /finish_reason：无效/.test(error.message)
  )
})

test('missing, unreadable, malformed, and unsafe configuration fails closed', async (t) => {
  const dir = await makeTempDir(t)

  await assert.rejects(
    requestModel({
      configPath: path.join(dir, 'missing.yaml'),
      prompt: 'hello',
      fetchImpl: () => {
        throw new Error('must not fetch')
      }
    }),
    (error) => {
      assert.equal(error.code, 'MODEL_CONFIG_ERROR')
      assertNoSecret(error.message)
      return true
    }
  )

  const emptyPath = path.join(dir, 'empty.yaml')
  await writeFile(emptyPath, '', 'utf8')
  await assert.rejects(
    getModelInfo({ configPath: emptyPath }),
    (error) => error.code === 'MODEL_CONFIG_ERROR' && /为空/.test(error.message)
  )

  const malformedYaml = await writeConfig(
    t,
    `providers:\n  ustc:\n    apiKey: ${SECRET}\n    models: [\n`,
    'malformed.yaml'
  )
  await assert.rejects(
    getModelInfo({ configPath: malformedYaml }),
    (error) => {
      assert.equal(error.code, 'MODEL_CONFIG_ERROR')
      assert.match(error.message, /YAML/)
      assertNoSecret(error.message)
      return true
    }
  )

  const malformedJson = await writeConfig(
    t,
    `{"providers":{"ustc":{"apiKey":"${SECRET}",`,
    'malformed.json'
  )
  await assert.rejects(
    getModelInfo({ configPath: malformedJson }),
    (error) => {
      assert.equal(error.code, 'MODEL_CONFIG_ERROR')
      assert.match(error.message, /JSON/)
      assertNoSecret(error.message)
      return true
    }
  )

  const missingKeyText = makeConfigText({ apiKey: undefined })
  assert.doesNotMatch(missingKeyText, /apiKey/)
  const missingKey = await writeConfig(t, missingKeyText)
  await assert.rejects(
    getModelInfo({ configPath: missingKey }),
    (error) => error.code === 'MODEL_CONFIG_ERROR' && /apiKey/.test(error.message)
  )

  const unsupportedApi = await writeConfig(t, makeConfigText({ api: 'anthropic-messages' }))
  await assert.rejects(
    getModelInfo({ configPath: unsupportedApi }),
    (error) => error.code === 'MODEL_CONFIG_ERROR' && /openai-completions/.test(error.message)
  )

  const credentialsInUrl = await writeConfig(t, makeConfigText({
    baseUrl: `https://user:${SECRET}@model.example/v1`
  }))
  await assert.rejects(
    getModelInfo({ configPath: credentialsInUrl }),
    (error) => {
      assert.equal(error.code, 'MODEL_CONFIG_ERROR')
      assert.match(error.message, /凭据/)
      assertNoSecret(error.message)
      return true
    }
  )

  const queryInUrl = await writeConfig(t, makeConfigText({
    baseUrl: `${BASE_URL}?api_key=${SECRET}`
  }))
  await assert.rejects(
    getModelInfo({ configPath: queryInUrl }),
    (error) => {
      assert.equal(error.code, 'MODEL_CONFIG_ERROR')
      assert.match(error.message, /查询参数/)
      assertNoSecret(error.message)
      return true
    }
  )

  const emptyFragment = await writeConfig(t, makeConfigText({
    baseUrl: `${BASE_URL}#`
  }))
  await assert.rejects(
    getModelInfo({ configPath: emptyFragment }),
    (error) => {
      assert.equal(error.code, 'MODEL_CONFIG_ERROR')
      assert.match(error.message, /查询参数或片段/)
      assertNoSecret(error.message)
      return true
    }
  )

  const insecureRemote = await writeConfig(t, makeConfigText({
    baseUrl: 'http://model.example/v1'
  }))
  await assert.rejects(
    getModelInfo({ configPath: insecureRemote }),
    (error) => error.code === 'MODEL_CONFIG_ERROR' && /HTTPS/.test(error.message)
  )

  const duplicate = await writeConfig(t, makeConfigText({ models: [MODEL_A, MODEL_A] }))
  await assert.rejects(
    getModelInfo({ configPath: duplicate }),
    (error) => error.code === 'MODEL_CONFIG_ERROR' && /重复/.test(error.message)
  )

  const inconsistent = await writeConfig(t, makeConfigText({
    models: [{ ...MODEL_A, contextWindow: 1000, maxTokens: 2000 }]
  }))
  await assert.rejects(
    getModelInfo({ configPath: inconsistent }),
    (error) => error.code === 'MODEL_CONFIG_ERROR' && /contextWindow/.test(error.message)
  )
})

test('repository config paths are limited to ignored safe locations and never docs', async () => {
  const directDocs = path.join(repositoryDocsPath, `.ai-model-test-docs-${process.pid}.yaml`)
  await assert.rejects(
    getModelInfo({ configPath: directDocs }),
    (error) => {
      assert.equal(error.code, 'MODEL_CONFIG_ERROR')
      assert.match(error.message, /docs/)
      assert.ok(!error.message.includes(repositoryDocsPath))
      assert.ok(!error.message.includes(path.basename(directDocs)))
      return true
    }
  )

  const unsafeRepo = path.join(
    repositoryRoot,
    'config',
    `.ai-model-test-config-${process.pid}.yaml`
  )
  await assert.rejects(
    getModelInfo({ configPath: unsafeRepo }),
    (error) => {
      assert.equal(error.code, 'MODEL_CONFIG_ERROR')
      assert.match(error.message, /仓库外/)
      assert.ok(!error.message.includes(repositoryRoot))
      assert.ok(!error.message.includes(path.basename(unsafeRepo)))
      return true
    }
  )

  const allowedMissing = path.join(
    repositoryRoot,
    'tools',
    `.ai-model-test-missing-${process.pid}.private.yaml`
  )
  await assert.rejects(
    getModelInfo({ configPath: allowedMissing }),
    (error) => {
      assert.equal(error.code, 'MODEL_CONFIG_ERROR')
      assert.match(error.message, /不存在/)
      assert.ok(!error.message.includes(repositoryRoot))
      assert.ok(!error.message.includes(path.basename(allowedMissing)))
      return true
    }
  )
})

test('symlink or junction paths resolving into docs are rejected', async (t) => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'ai-model-path-link-'))
  const docsLink = path.join(tempDir, 'docs-link')
  let linkCreated = false
  t.after(async () => {
    if (linkCreated) {
      try {
        if (process.platform === 'win32') await rmdir(docsLink)
        else await unlink(docsLink)
      } catch {
        // Never recurse into a directory that may still contain the docs link.
        return
      }
    }
    await rm(tempDir, { recursive: true, force: true }).catch(() => {})
  })

  try {
    await symlink(
      repositoryDocsPath,
      docsLink,
      process.platform === 'win32' ? 'junction' : 'dir'
    )
    linkCreated = true
  } catch (error) {
    if (error?.code === 'EPERM' || error?.code === 'EACCES') {
      t.skip('symlink or junction creation is unavailable')
      return
    }
    throw error
  }

  await assert.rejects(
    getModelInfo({ configPath: path.join(docsLink, 'private.yaml') }),
    (error) => {
      assert.equal(error.code, 'MODEL_CONFIG_ERROR')
      assert.match(error.message, /docs/)
      assert.ok(!error.message.includes(tempDir))
      assert.ok(!error.message.includes('private.yaml'))
      return true
    }
  )
})

test('loopback HTTP is allowed but remote redirects are disabled', async (t) => {
  const local = await writeConfig(t, makeConfigText({ baseUrl: 'http://127.0.0.1:1234/v1' }))
  const info = await getModelInfo({ configPath: local })
  assert.equal(info.endpoint, 'http://127.0.0.1:1234/v1/chat/completions')

  const configPath = await writeConfig(t)
  const { fetchImpl, calls } = recordingFetch(() =>
    jsonResponse(completion(), { status: 302 })
  )
  await assert.rejects(
    requestModel({ configPath, prompt: 'hello', fetchImpl }),
    (error) => error.code === 'MODEL_HTTP_ERROR' && error.status === 302
  )
  assert.equal(calls[0].init.redirect, 'error')
})

test('network failures never echo their cause, URL, or prompt', async (t) => {
  const configPath = await writeConfig(t)
  const promptSentinel = 'PROMPT_SENTINEL_5d2a'
  for (const fetchImpl of [
    async () => {
      throw new Error(`connect failed ${SECRET} https://model.example/private ${promptSentinel}`)
    },
    () => {
      throw new Error(`sync failure ${SECRET} https://model.example/private`)
    }
  ]) {
    await assert.rejects(
      requestModel({ configPath, prompt: promptSentinel, fetchImpl }),
      (error) => {
        assert.equal(error.code, 'MODEL_NETWORK_ERROR')
        assertNoSecret(error.message, [promptSentinel, 'private'])
        return true
      }
    )
  }
})

test('timeout rejects, aborts in-flight work, and never leaks secrets', async (t) => {
  const configPath = await writeConfig(t)
  const promptSentinel = 'TIMEOUT_PROMPT_SENTINEL_1e4b'

  await assert.rejects(
    requestModel({
      configPath,
      prompt: promptSentinel,
      timeoutMs: 25,
      fetchImpl: () => new Promise(() => {})
    }),
    (error) => {
      assert.equal(error.code, 'MODEL_TIMEOUT')
      assert.equal(error.name, 'TimeoutError')
      assert.match(error.message, /25 毫秒/)
      assertNoSecret(error.message, [promptSentinel])
      return true
    }
  )

  const pendingResponse = {
    status: 200,
    headers: new Headers({ 'content-type': 'application/json' }),
    body: null,
    text: () => new Promise(() => {})
  }
  await assert.rejects(
    requestModel({
      configPath,
      prompt: 'hello',
      timeoutMs: 25,
      fetchImpl: async () => pendingResponse
    }),
    (error) => {
      assert.equal(error.code, 'MODEL_TIMEOUT')
      assertNoSecret(error.message)
      return true
    }
  )

  assert.equal(DEFAULT_TIMEOUT_MS, 300_000)
})

test('AI_REQUEST_TIMEOUT_MS configures the default and rejects invalid values', async (t) => {
  const previous = process.env.AI_REQUEST_TIMEOUT_MS
  t.after(() => {
    if (previous === undefined) delete process.env.AI_REQUEST_TIMEOUT_MS
    else process.env.AI_REQUEST_TIMEOUT_MS = previous
  })
  const configPath = await writeConfig(t)

  process.env.AI_REQUEST_TIMEOUT_MS = '25'
  await assert.rejects(
    requestModel({
      configPath,
      prompt: 'hello',
      fetchImpl: () => new Promise(() => {})
    }),
    (error) => {
      assert.equal(error.code, 'MODEL_TIMEOUT')
      assert.match(error.message, /25 毫秒/)
      assertNoSecret(error.message)
      return true
    }
  )

  process.env.AI_REQUEST_TIMEOUT_MS = 'not-a-number'
  await assert.rejects(
    requestModel({ configPath, prompt: 'hello', fetchImpl: () => new Promise(() => {}) }),
    /AI_REQUEST_TIMEOUT_MS/
  )
})

test('AbortSignal cancels before and during a request', async (t) => {
  const configPath = await writeConfig(t)

  const preAborted = new AbortController()
  preAborted.abort()
  let called = false
  await assert.rejects(
    requestModel({
      configPath,
      prompt: 'hello',
      signal: preAborted.signal,
      fetchImpl: () => {
        called = true
      }
    }),
    (error) => {
      assert.equal(error.name, 'AbortError')
      assert.equal(error.code, 'ABORT_ERR')
      assertNoSecret(error.message)
      return true
    }
  )
  assert.equal(called, false)

  const controller = new AbortController()
  let fetchCalled = false
  const request = requestModel({
    configPath,
    prompt: 'hello',
    signal: controller.signal,
    timeoutMs: 5_000,
    fetchImpl: () => {
      fetchCalled = true
      return new Promise(() => {})
    }
  })
  setTimeout(() => controller.abort(), 10)
  await assert.rejects(
    request,
    (error) => error.name === 'AbortError' && error.code === 'ABORT_ERR'
  )
  assert.equal(fetchCalled, true)

  await assert.rejects(
    requestModel({
      configPath,
      prompt: 'hello',
      signal: {},
      fetchImpl: () => {
        throw new Error('must not fetch')
      }
    }),
    /AbortSignal/
  )
})

test('prompt size and option validation fail before network access', async (t) => {
  const configPath = await writeConfig(t)
  const { fetchImpl, calls } = recordingFetch(() => jsonResponse(completion()))

  await assert.rejects(
    requestModel({
      configPath,
      prompt: 'x'.repeat(20),
      maxPromptBytes: 10,
      fetchImpl
    }),
    (error) => error.code === 'MODEL_REQUEST_ERROR' && /安全上限 10 字节/.test(error.message)
  )
  assert.equal(calls.length, 0)

  await assert.rejects(requestModel({ configPath, prompt: '', fetchImpl }), /非空/)
  await assert.rejects(
    requestModel({ configPath, system: 1, prompt: 'hello', fetchImpl }),
    /system/
  )
  await assert.rejects(
    requestModel({ configPath, prompt: 'hello', timeoutMs: 0, fetchImpl }),
    /timeoutMs/
  )
  await assert.rejects(
    requestModel({ configPath, prompt: 'hello', timeoutMs: 2_147_483_648, fetchImpl }),
    /timeoutMs/
  )
  await assert.rejects(
    requestModel({ configPath, prompt: 'hello', maxOutputTokens: 0, fetchImpl }),
    /maxOutputTokens/
  )
  await assert.rejects(
    requestModel({ configPath, prompt: 'hello', fetchImpl: 'not a function' }),
    /fetchImpl/
  )
  assert.equal(calls.length, 0)
})

test('context metadata conservatively limits prompt bytes', async (t) => {
  const configPath = await writeConfig(t)
  const { fetchImpl, calls } = recordingFetch(() => jsonResponse(completion()))

  // model-b: 32768 context - 4096 output = 28672 bytes of worst-case input.
  await assert.rejects(
    requestModel({
      configPath,
      model: 'model-b',
      prompt: 'x'.repeat(28_673),
      fetchImpl
    }),
    (error) => error.code === 'MODEL_REQUEST_ERROR' && /28672/.test(error.message)
  )
  assert.equal(calls.length, 0)
})

test('streaming responses decode split UTF-8 and reject invalid bytes', async (t) => {
  const configPath = await writeConfig(t)
  const expected = '译文'
  const response = streamedResponse(
    JSON.stringify(completion({ content: expected })),
    { chunkSize: 1 }
  )

  const result = await requestModel({
    configPath,
    prompt: 'hello',
    fetchImpl: async () => response
  })
  assert.equal(result, expected)

  const invalid = new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array([0x7b, 0xff, 0xfe, 0x7d]))
      controller.close()
    }
  }), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  })
  await assert.rejects(
    requestModel({ configPath, prompt: 'hello', fetchImpl: async () => invalid }),
    (error) => {
      assert.equal(error.code, 'MODEL_RESPONSE_ERROR')
      assert.match(error.message, /UTF-8/)
      assertNoSecret(error.message)
      return true
    }
  )
})

test('oversized streams are canceled with missing or lying Content-Length', async (t) => {
  const configPath = await writeConfig(t)
  const sentinel = 'STREAM_SENTINEL_1d8e'

  for (const headers of [{}, { 'content-length': '10' }]) {
    let cancelled = false
    const response = streamedResponse(
      JSON.stringify(completion({ content: `${sentinel}${'x'.repeat(5_000)}` })),
      {
        chunkSize: 64,
        headers,
        onCancel: () => {
          cancelled = true
        }
      }
    )

    await assert.rejects(
      requestModel({
        configPath,
        prompt: 'hello',
        maxResponseBytes: 100,
        fetchImpl: async () => response
      }),
      (error) => {
        assert.equal(error.code, 'MODEL_RESPONSE_ERROR')
        assert.match(error.message, /过大/)
        assertNoSecret(error.message, [sentinel])
        return true
      }
    )
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(cancelled, true)
  }
})

test('streaming reads cancel on timeout and external abort', async (t) => {
  const configPath = await writeConfig(t)

  for (const mode of ['timeout', 'abort']) {
    let cancelled = false
    const response = hangingResponse({
      onCancel: () => {
        cancelled = true
      }
    })
    const controller = new AbortController()
    const request = requestModel({
      configPath,
      prompt: 'hello',
      ...(mode === 'timeout'
        ? { timeoutMs: 25 }
        : { signal: controller.signal, timeoutMs: 5_000 }),
      fetchImpl: async () => response
    })
    if (mode === 'abort') setTimeout(() => controller.abort(), 10)

    await assert.rejects(
      request,
      (error) => {
        assert.equal(error.code, mode === 'timeout' ? 'MODEL_TIMEOUT' : 'ABORT_ERR')
        assertNoSecret(error.message)
        return true
      }
    )
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(cancelled, true)
  }
})

test('response size limits and invalid HTTP objects fail closed', async (t) => {
  const configPath = await writeConfig(t)
  const sentinel = 'OVERSIZE_SENTINEL_6c3a'

  const { fetchImpl } = recordingFetch(() =>
    new Response(JSON.stringify({ ...completion({ content: 'x'.repeat(2_000) }), sentinel }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    })
  )
  await assert.rejects(
    requestModel({ configPath, prompt: 'hello', maxResponseBytes: 100, fetchImpl }),
    (error) => error.code === 'MODEL_RESPONSE_ERROR' && /过大/.test(error.message)
  )

  const { fetchImpl: invalidStatus } = recordingFetch(() => ({
    status: '200',
    headers: new Headers({ 'content-type': 'application/json' }),
    text: async () => JSON.stringify(completion()),
    body: null
  }))
  await assert.rejects(
    requestModel({ configPath, prompt: 'hello', fetchImpl: invalidStatus }),
    (error) => error.code === 'MODEL_RESPONSE_ERROR' && /HTTP 状态/.test(error.message)
  )
})

test('sanitizeModelError redacts URLs, bearer tokens, and assignment secrets', () => {
  const sanitized = sanitizeModelError(
    `apiKey: ${SECRET}\nendpoint ${BASE_URL} Bearer abc.def`
  )
  assert.ok(!sanitized.includes(SECRET))
  assert.ok(!sanitized.includes('model.example'))
  assert.match(sanitized, /<url-redacted>/)
  assert.match(sanitized, /Bearer <redacted>/)
})
