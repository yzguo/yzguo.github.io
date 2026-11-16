import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import test from 'node:test'
import {
  OMP_MODEL,
  buildGatewayArgs,
  buildGatewayRequest,
  parseGatewayResponse,
  requestModel,
  sanitizeProcessOutput
} from './omp-model.mjs'

class FakeChild extends EventEmitter {
  constructor() {
    super()
    this.stdin = new PassThrough()
    this.stdout = new PassThrough()
    this.stderr = new PassThrough()
    this.killed = false
  }

  kill() {
    this.killed = true
  }
}

function fakeSpawn(handler) {
  const calls = []
  const spawnProcess = (command, args, options) => {
    const child = new FakeChild()
    calls.push({ command, args, options, child })
    setImmediate(() => handler(child, { command, args, options }))
    return child
  }
  return { spawnProcess, calls }
}

function successLine({
  id = 1,
  model = OMP_MODEL,
  content = 'translated text',
  finishReason = 'stop',
  includeReasoning = false
} = {}) {
  return JSON.stringify({
    id,
    status: 200,
    body: {
      id: 'completion-1',
      object: 'chat.completion',
      model,
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content,
          ...(includeReasoning ? { reasoning_content: 'private reasoning must not escape' } : {})
        },
        finish_reason: finishReason
      }]
    }
  })
}

function respond(child, lines) {
  child.stdout.write(`${JSON.stringify({ ready: true, version: 'test' })}\n`)
  for (const line of lines) child.stdout.write(`${line}\n`)
}

async function withRequest(handler, options = {}) {
  const { spawnProcess, calls } = fakeSpawn(handler)
  const result = await requestModel({
    prompt: 'hello',
    timeoutMs: 2_000,
    spawnProcess,
    ...options
  })
  return { result, calls }
}

test('gateway request uses the local stdio gateway and no secret fields', () => {
  assert.deepEqual(buildGatewayArgs(), ['auth-gateway', 'stdio'])
  const request = buildGatewayRequest({
    id: 7,
    model: OMP_MODEL,
    system: 'system text',
    prompt: 'user text'
  })
  assert.equal(request.id, 7)
  assert.equal(request.path, '/v1/chat/completions')
  assert.equal(request.body.model, OMP_MODEL)
  assert.equal(request.body.reasoning_effort, 'none')
  assert.deepEqual(request.body.messages, [
    { role: 'system', content: 'system text' },
    { role: 'user', content: 'user text' }
  ])
  const serialized = JSON.stringify(request)
  assert.doesNotMatch(serialized, /api[_-]?key|authorization|bearer/i)
})

test('requestModel sends the prompt over stdin and validates the response', async () => {
  let stdinText = ''
  const { spawnProcess, calls } = fakeSpawn((child) => {
    child.stdin.on('data', (chunk) => {
      stdinText += chunk
    })
    child.stdin.on('end', () => {
      respond(child, [successLine({ content: 'English result' })])
    })
  })

  const result = await requestModel({
    system: 'translate',
    prompt: '中文内容',
    spawnProcess,
    timeoutMs: 2_000
  })

  assert.equal(result, 'English result')
  assert.equal(calls.length, 1)
  assert.equal(calls[0].command, 'omp')
  assert.deepEqual(calls[0].args, ['auth-gateway', 'stdio'])
  assert.equal(calls[0].options.shell, false)
  assert.equal(calls[0].options.windowsHide, true)

  const request = JSON.parse(stdinText.trim())
  assert.equal(request.body.model, OMP_MODEL)
  assert.deepEqual(request.body.messages, [
    { role: 'system', content: 'translate' },
    { role: 'user', content: '中文内容' }
  ])
  assert.ok(!stdinText.includes('--api-key'))
})

test('reasoning content is never returned as the answer', async () => {
  const { result } = await withRequest((child) => {
    respond(child, [successLine({ content: 'actual answer', includeReasoning: true })])
  })
  assert.equal(result, 'actual answer')

  await assert.rejects(
    withRequest((child) => {
      respond(child, [successLine({ content: null })])
    }),
    /returned no assistant content/
  )
})

test('a reasoning-only response fails instead of leaking reasoning', async () => {
  const line = JSON.stringify({
    id: 1,
    status: 200,
    body: {
      model: OMP_MODEL,
      choices: [{
        message: { role: 'assistant', content: null, reasoning_content: 'secret scratch work' },
        finish_reason: 'stop'
      }]
    }
  })
  await assert.rejects(
    withRequest((child) => respond(child, [line])),
    (error) => {
      assert.match(error.message, /returned no assistant content/)
      assert.doesNotMatch(error.message, /secret scratch work/)
      return true
    }
  )
})

test('a non-200 gateway response fails with a sanitized diagnostic', async () => {
  const sentinel = 'SENTINEL_GATEWAY_MESSAGE_5f8a2c'
  const line = JSON.stringify({
    id: 1,
    status: 500,
    body: {
      error: {
        message: `upstream https://secret.example/v1 failed with Bearer ${sentinel}`,
        api_key: sentinel,
        headers: { authorization: `Bearer ${sentinel}` }
      },
      model: sentinel
    },
    message: sentinel
  })
  await assert.rejects(
    withRequest((child) => respond(child, [line])),
    (error) => {
      assert.match(error.message, /HTTP 500/)
      assert.match(error.message, /upstream server error/i)
      assert.ok(!error.message.includes(sentinel))
      assert.doesNotMatch(error.message, /secret\.example|Bearer|https?:|api[_-]?key/i)
      return true
    }
  )
})

test('authentication, rate limit, and upstream timeout statuses remain distinguishable', async () => {
  const sentinel = 'SENTINEL_STATUS_DETAIL_3d7b9e'
  const cases = [
    [401, /HTTP 401 \(authentication failed\)/i],
    [403, /HTTP 403 \(authentication failed\)/i],
    [408, /HTTP 408 \(upstream timeout\)/i],
    [429, /HTTP 429 \(rate limited\)/i],
    [502, /HTTP 502 \(upstream server error\)/i],
    [504, /HTTP 504 \(upstream timeout\)/i]
  ]
  for (const [status, expected] of cases) {
    const line = JSON.stringify({
      id: 1,
      status,
      body: { message: `upstream error ${sentinel}`, error: { message: sentinel } }
    })
    await assert.rejects(
      withRequest((child) => respond(child, [line])),
      (error) => {
        assert.match(error.message, expected)
        assert.ok(!error.message.includes(sentinel))
        return true
      }
    )
  }
})

test('model mismatch, empty choices, and truncated replies fail', async () => {
  const modelSentinel = 'SENTINEL_MODEL_MISMATCH_6b2e8d'
  await assert.rejects(
    withRequest((child) => respond(child, [successLine({ model: modelSentinel })])),
    (error) => {
      assert.match(error.message, /different model instead of the required/)
      assert.ok(!error.message.includes(modelSentinel))
      return true
    }
  )
  const finishSentinel = 'SENTINEL_FINISH_REASON_8e4a1c'
  const contentSentinel = 'SENTINEL_MODEL_CONTENT_3c9f7a'
  await assert.rejects(
    withRequest((child) => respond(child, [
      successLine({ content: contentSentinel, finishReason: finishSentinel })
    ])),
    (error) => {
      assert.match(error.message, /finish_reason "other"/)
      assert.ok(!error.message.includes(finishSentinel))
      assert.ok(!error.message.includes(contentSentinel))
      return true
    }
  )
  await assert.rejects(
    withRequest((child) => respond(child, [JSON.stringify({
      id: 1,
      status: 200,
      body: { model: OMP_MODEL, choices: [] }
    })])),
    /exactly one choice/
  )
  await assert.rejects(
    withRequest((child) => respond(child, [successLine({ finishReason: 'length' })])),
    /finish_reason "length"/
  )
  await assert.rejects(
    withRequest((child) => respond(child, [successLine({ content: '' })])),
    /no assistant content/
  )
})

test('malformed, premature, duplicated, or mistyped gateway events fail', async () => {
  const sentinel = 'SENTINEL_MALFORMED_LINE_2f7c5a'
  await assert.rejects(
    withRequest((child) => {
      child.stdout.write(`not json ${sentinel} https://gateway.invalid/${sentinel}\n`)
    }),
    (error) => {
      assert.match(error.message, /non-JSON output line/)
      assert.ok(!error.message.includes(sentinel))
      return true
    }
  )
  await assert.rejects(
    withRequest((child) => {
      child.stdout.write(`${successLine()}\n`)
    }),
    /before announcing readiness/
  )
  await assert.rejects(
    withRequest((child) => {
      respond(child, [successLine({ id: 2 })])
    }),
    /unexpected id/
  )
  await assert.rejects(
    withRequest((child) => {
      child.stdout.write(`${JSON.stringify({ ready: false })}\n`)
    }),
    /did not become ready/
  )
  await assert.rejects(
    withRequest((child) => {
      child.stdout.write(`${JSON.stringify({ ready: true })}\n${JSON.stringify({ ready: true })}\n`)
    }),
    /more than once/
  )
})

test('gateway process failures, spawn failures, timeouts, and output limits fail', async () => {
  const stderrSentinel = 'SENTINEL_STDERR_ECHO_4a8c2e'
  await assert.rejects(
    withRequest((child) => {
      child.stderr.write(
        `fatal https://secret.example/v1 Bearer ${stderrSentinel} ` +
        `Authorization: Bearer ${stderrSentinel} {"api_key":"${stderrSentinel}"}`
      )
      child.emit('close', 1, null)
    }),
    (error) => {
      assert.match(error.message, /exit code 1/)
      assert.ok(!error.message.includes(stderrSentinel))
      assert.doesNotMatch(error.message, /secret\.example|Bearer|api[_-]?key/i)
      return true
    }
  )

  const spawnSentinel = 'SENTINEL_SPAWN_ERROR_7b3d1f'
  await assert.rejects(
    withRequest((child) => {
      child.emit('error', new Error(`spawn ENOENT ${spawnSentinel}`))
    }),
    (error) => {
      assert.match(error.message, /Unable to start OMP auth gateway/)
      assert.ok(!error.message.includes(spawnSentinel))
      return true
    }
  )

  await assert.rejects(
    withRequest((child) => {
      child.emit('close', null, `SENTINEL_${stderrSentinel}`)
    }),
    (error) => {
      assert.match(error.message, /signal unknown/)
      assert.ok(!error.message.includes(stderrSentinel))
      return true
    }
  )

  await assert.rejects(
    withRequest(() => {}, { timeoutMs: 10 }),
    /timed out/
  )

  await assert.rejects(
    withRequest((child) => {
      respond(child, [successLine({ content: 'x'.repeat(2_000) })])
    }, { maxOutputBytes: 500 }),
    /more than 500 bytes/
  )

  await assert.rejects(
    withRequest((child) => {
      child.stderr.emit('data', 'x'.repeat(64))
      setImmediate(() => child.emit('close', 1, null))
    }, { maxStderrBytes: 16 }),
    (error) => {
      assert.match(error.message, /more than 16 bytes of stderr output/)
      assert.ok(!error.message.includes('x'))
      return true
    }
  )
})

test('process start, stream, and stdin errors never echo their inputs', async () => {
  const sentinel = 'SENTINEL_PROCESS_INPUT_9d5e3b'

  await assert.rejects(
    requestModel({
      prompt: `secret prompt ${sentinel}`,
      command: `C:/private/${sentinel}`,
      spawnProcess: () => {
        throw new Error(`cannot run ${sentinel} https://gateway.invalid/${sentinel}`)
      }
    }),
    (error) => {
      assert.match(error.message, /Unable to start OMP auth gateway/)
      assert.ok(!error.message.includes(sentinel))
      assert.doesNotMatch(error.message, /private|gateway\.invalid|https?:/i)
      return true
    }
  )

  await assert.rejects(
    withRequest((child) => {
      child.stdout.emit('error', new Error(`read failed ${sentinel}`))
    }),
    (error) => {
      assert.match(error.message, /Unable to read OMP auth gateway stdout/)
      assert.ok(!error.message.includes(sentinel))
      return true
    }
  )

  await assert.rejects(
    requestModel({
      prompt: 'hello',
      spawnProcess: () => {
        const child = new FakeChild()
        child.stdin.end = () => {
          throw new Error(`write failed ${sentinel}`)
        }
        return child
      }
    }),
    (error) => {
      assert.match(error.message, /Unable to send the prompt to OMP auth gateway/)
      assert.ok(!error.message.includes(sentinel))
      return true
    }
  )
})

test('request limits and invalid arguments fail before spawning', async () => {
  const { spawnProcess, calls } = fakeSpawn(() => {})
  await assert.rejects(
    requestModel({ prompt: 'x'.repeat(100), spawnProcess, maxPromptBytes: 10 }),
    /larger than the 10 byte limit/
  )
  await assert.rejects(
    requestModel({ prompt: '', spawnProcess }),
    /non-empty prompt/
  )
  await assert.rejects(
    requestModel({ prompt: 'hello', spawnProcess, timeoutMs: 0 }),
    /positive integer/
  )
  assert.equal(calls.length, 0)
})

test('gateway statuses are bounded and categories never echo upstream details', () => {
  const sentinel = 'SENTINEL_STATUS_FIELD_1a6f4d'
  for (const status of [99, 600, 401.5, '401', null, sentinel]) {
    const line = JSON.stringify({ id: 1, status, body: { message: sentinel } })
    assert.throws(
      () => parseGatewayResponse(line, { id: 1, model: OMP_MODEL }),
      (error) => {
        assert.match(error.message, /invalid HTTP status/)
        assert.ok(!error.message.includes(sentinel))
        return true
      }
    )
  }

  const redirect = JSON.stringify({
    id: 1,
    status: 302,
    body: { error: { message: sentinel } }
  })
  assert.throws(
    () => parseGatewayResponse(redirect, { id: 1, model: OMP_MODEL }),
    (error) => {
      assert.match(error.message, /HTTP 302 \(unexpected redirect\)/)
      assert.ok(!error.message.includes(sentinel))
      return true
    }
  )
})

test('parseGatewayResponse is strict about the requested model and id', () => {
  const content = parseGatewayResponse(successLine({ content: 'ok' }), { id: 1, model: OMP_MODEL })
  assert.equal(content, 'ok')
  assert.throws(
    () => parseGatewayResponse(successLine({ content: 'ok' }), { id: 2, model: OMP_MODEL }),
    /unexpected id/
  )
  assert.throws(
    () => parseGatewayResponse('{"id":1}', { id: 1, model: OMP_MODEL }),
    /missing an HTTP status/
  )
})

test('diagnostics redact endpoints, bearer tokens, and API keys', () => {
  const text = sanitizeProcessOutput(
    'endpoint https://gateway.example/v1 failed; Bearer abc.def; apiKey=sk-secretvalue123'
  )
  assert.doesNotMatch(text, /gateway\.example|abc\.def|secretvalue123/)
  assert.match(text, /url-redacted/)
  assert.match(text, /Bearer <redacted>/)
})

test('diagnostics redact quoted JSON auth fields, headers, URLs, and model fields', () => {
  const secrets = {
    message: 'SENTINEL_MESSAGE_4f2a9c',
    quoted: 'SENTINEL_QUOTED_KEY_9b1c7d',
    header: 'SENTINEL_HEADER_8d3e5a',
    bearer: 'SENTINEL_BEARER_7a5f1b',
    cookie: 'SENTINEL_COOKIE_4c8d2a',
    url: 'SENTINEL_URL_2c6d8e',
    model: 'SENTINEL_MODEL_1e4b6f',
    stderr: 'SENTINEL_STDERR_6a9c3d'
  }
  const raw = [
    JSON.stringify({ error: { message: `upstream failed: ${secrets.message}` } }),
    JSON.stringify({ api_key: secrets.quoted }),
    `X-Api-Key: ${secrets.header}`,
    `Authorization: Bearer ${secrets.bearer}`,
    `Proxy-Authorization: Custom ${secrets.bearer} trailing words`,
    JSON.stringify({ headers: { Cookie: `session=${secrets.cookie}` } }),
    `endpoint https://gateway.invalid/v1/${secrets.url}?token=${secrets.url}`,
    JSON.stringify({ model: secrets.model }),
    `stderr: ${secrets.stderr}`
  ].join('\n')

  const sanitized = sanitizeProcessOutput(raw)
  for (const [label, secret] of Object.entries(secrets)) {
    assert.ok(!sanitized.includes(secret), `diagnostic leaked the ${label} sentinel`)
  }
  assert.match(sanitized, /<url-redacted>/)
  assert.match(sanitized, /<redacted>/)
})

test('an already-aborted signal rejects before spawning', async () => {
  const controller = new AbortController()
  controller.abort()
  const { spawnProcess, calls } = fakeSpawn(() => {})
  await assert.rejects(
    requestModel({ prompt: 'hello', spawnProcess, signal: controller.signal }),
    (error) => {
      assert.equal(error.name, 'AbortError')
      assert.equal(error.code, 'ABORT_ERR')
      assert.match(error.message, /已取消/)
      assert.doesNotMatch(error.message, /gateway|secret/)
      return true
    }
  )
  assert.equal(calls.length, 0)
})

test('aborting a running request kills the gateway process and clears the timer', async () => {
  const controller = new AbortController()
  const { spawnProcess, calls } = fakeSpawn(() => {
    setImmediate(() => controller.abort())
  })
  await assert.rejects(
    requestModel({
      prompt: 'hello',
      spawnProcess,
      signal: controller.signal,
      timeoutMs: 10_000
    }),
    (error) => {
      assert.equal(error.name, 'AbortError')
      return true
    }
  )
  assert.equal(calls.length, 1)
  assert.equal(calls[0].child.killed, true)
})

test('abort after readiness also terminates the child without returning output', async () => {
  const controller = new AbortController()
  const { spawnProcess, calls } = fakeSpawn((child) => {
    child.stdout.write(`${JSON.stringify({ ready: true })}\n`)
    setTimeout(() => controller.abort(), 0)
  })
  await assert.rejects(
    requestModel({ prompt: 'hello', spawnProcess, signal: controller.signal }),
    (error) => {
      assert.equal(error.name, 'AbortError')
      return true
    }
  )
  assert.equal(calls[0].child.killed, true)
})

test('invalid signals are rejected before spawning', async () => {
  const { spawnProcess, calls } = fakeSpawn(() => {})
  await assert.rejects(
    requestModel({ prompt: 'hello', spawnProcess, signal: {} }),
    /AbortSignal/
  )
  assert.equal(calls.length, 0)
})
