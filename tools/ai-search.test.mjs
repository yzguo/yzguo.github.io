import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { fileURLToPath } from 'node:url'

import {
    AI_SEARCH_PATH,
    MAX_BODY_BYTES,
    MODEL_TIMEOUT_MS,
    attachLocalAiSearch,
    buildDocsIndex,
    createAiSearchService,
    createFileAccessGuard,
    parseAllowedHost,
    parseMarkdownPage,
    resolveModelTimeoutMs,
    sanitizeSourcePath,
    searchDocs,
    stripScriptStyleBlocks,
    tokenize,
} from './ai-search.mjs'
import {
    AI_SEARCH_CONFIG_PATH,
    DEFAULT_AI_SEARCH_CONFIG,
    DEFAULT_FILE_SYSTEM_OPS,
    assertPrivateModelConfigPlacement,
    parseAiSearchConfig,
    pathKey,
    readAiSearchConfig,
    resolveAiSearchEnabled,
    scanPublishableResources,
} from './ai-search-config.mjs'

let docsRoot

async function writeDoc(relativePath, contents) {
    const file = path.join(docsRoot, relativePath)
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, contents, 'utf8')
}

before(async () => {
    docsRoot = await mkdtemp(path.join(tmpdir(), 'local-ai-search-'))
    await Promise.all([
        writeDoc(
            'physics.md',
            [
                '---',
                'title: "Private frontmatter title"',
                '---',
                '# Pendulum physics',
                '',
                '## Period',
                '',
                'The period of a small-angle pendulum is determined by its length and gravity.',
                '',
                '<!-- private-comment-marker -->',
                '',
            ].join('\n')
        ),
        writeDoc(
            'private-search.md',
            '---\nsearch: false\n---\n# Private search page\n\nprivate-search-marker\n'
        ),
        writeDoc(
            'draft.md',
            '---\ndraft: true\n---\n# Draft page\n\ndraft-marker\n'
        ),
        writeDoc(
            'private-flag.md',
            '---\nprivate: true\n---\n# Private page\n\nprivate-flag-marker\n'
        ),
        writeDoc(
            'quoted-private.md',
            '---\n"private": true\n---\n# Quoted private\n\nquoted-private-marker\n'
        ),
        writeDoc(
            'tagged-draft.md',
            '---\ndraft: !!bool true\n---\n# Tagged draft\n\ntagged-draft-marker\n'
        ),
        writeDoc(
            'invalid-yaml.md',
            '---\ntitle: [unclosed\n---\n# Invalid YAML\n\ninvalid-yaml-marker\n'
        ),
        writeDoc(
            'privacy.md',
            [
                '# Privacy fixture',
                '',
                'Visible public text for the privacy fixture.',
                '',
                '<!-- private:start -->',
                'private-block-marker',
                '<!-- private:end -->',
                '',
                '<!-- ordinary-comment-marker -->',
                '',
            ].join('\n')
        ),
        writeDoc(
            'unclosed-private.md',
            [
                '# Unclosed private',
                '',
                'unclosed-private-marker',
                '',
                '<!-- private:start -->',
                'secret',
                '',
            ].join('\n')
        ),
        writeDoc(
            'stray-private.md',
            [
                '# Stray private',
                '',
                'stray-private-marker',
                '',
                '<!-- private:end -->',
                '',
            ].join('\n')
        ),
        writeDoc(
            'nested-private.md',
            [
                '# Nested private',
                '',
                'nested-private-marker',
                '',
                '<!-- private:start -->',
                'a',
                '<!-- private:start -->',
                'b',
                '<!-- private:end -->',
                '',
            ].join('\n')
        ),
        writeDoc(
            'script-privacy.md',
            [
                '# Script fixture',
                '',
                'Visible before script.',
                '',
                '<script type="text/javascript">',
                'secret-script-marker',
                '</script>',
                '',
                '<style media="screen">',
                '.secret { color: secret-style-marker; }',
                '</style>',
                '',
                'Visible after script.',
                '',
            ].join('\n')
        ),
        writeDoc(
            'script-attribute.md',
            [
                '# Attribute script',
                '',
                'attribute-before',
                '',
                '<SCRIPT',
                '  data-value="a>b"',
                '  type="text/javascript">',
                'secret-attribute-marker',
                '</SCRIPT',
                '>',
                '',
                'attribute-after',
                '',
            ].join('\n')
        ),
        writeDoc(
            'unclosed-script.md',
            [
                '# Unclosed script',
                '',
                'unclosed-script-marker',
                '',
                '<script>',
                'secret',
                '',
            ].join('\n')
        ),
        writeDoc(
            'unclosed-style.md',
            [
                '# Unclosed style',
                '',
                'unclosed-style-marker',
                '',
                '<style>',
                '.secret {}',
                '',
            ].join('\n')
        ),
        writeDoc(
            'fenced-code.md',
            [
                '# Fenced script examples',
                '',
                'visible-before-fence',
                '',
                '```html',
                '<script>',
                'const marker = "</script>";',
                'fenced-string-secret',
                '</script>',
                '```',
                '',
                'visible-between-fences',
                '',
                '```html',
                '<!-- </script> -->',
                'fenced-comment-secret',
                '```',
                '',
                '```html',
                '<style><![CDATA[ </style> ]]></style>',
                'fenced-cdata-secret',
                '```',
                '',
                'visible-after-fence',
                '',
            ].join('\n')
        ),
        writeDoc(
            'fenced-unclosed.md',
            [
                '# Unclosed fence',
                '',
                'unclosed-fence-before',
                '',
                '```html',
                '<script>',
                'const marker = "</script>";',
                'unclosed-fence-secret',
                '',
            ].join('\n')
        ),
        writeDoc(
            'ambiguous-script.md',
            [
                '# Ambiguous script',
                '',
                'ambiguous-script-before',
                '',
                '<script>',
                'const marker = "</script>";',
                'ambiguous-script-after',
                '</script>',
                '',
                'ambiguous-script-visible',
                '',
            ].join('\n')
        ),
        writeDoc(
            'ambiguous-style.md',
            [
                '# Ambiguous style',
                '',
                'ambiguous-style-before',
                '',
                '<style>',
                '.x { content: "</style>"; }',
                '</style>',
                '',
                'ambiguous-style-visible',
                '',
            ].join('\n')
        ),
        writeDoc(
            'ambiguous-comment.md',
            [
                '# Ambiguous comment',
                '',
                '<script>',
                '// </script>',
                'ambiguous-comment-visible',
                '</script>',
                '',
            ].join('\n')
        ),
        writeDoc(
            'ambiguous-cdata.md',
            [
                '# Ambiguous CDATA',
                '',
                '<script><![CDATA[ </script> ]]></script>',
                'ambiguous-cdata-visible',
                '',
            ].join('\n')
        ),
        writeDoc(
            '.hidden/secret.md',
            '# Hidden directory\n\nhidden-directory-marker\n'
        ),
        writeDoc(
            'dist/generated.md',
            '# Generated directory\n\ngenerated-directory-marker\n'
        ),
        writeDoc(
            '.vitepress/generated.md',
            '# VitePress cache\n\nvitepress-marker\n'
        ),
        writeDoc(
            'public/asset.md',
            '# Public asset\n\npublic-marker\n'
        ),
        writeDoc(
            'zh-cn/pendulum.md',
            [
                '# 单摆物理',
                '',
                '## 周期',
                '',
                '小角度单摆的周期由摆长和重力决定。',
                '',
                '<!-- 中文私有注释 -->',
                '',
            ].join('\n')
        ),
    ])
})

after(async () => {
    if (docsRoot) {
        await rm(docsRoot, { recursive: true, force: true })
    }
})

function createModel(answer = 'A useful answer') {
    const calls = []
    const requestModel = async (args) => {
        calls.push(args)
        if (typeof answer === 'function') return answer(args)
        return answer
    }
    return { calls, requestModel }
}

/** Most retrieval tests exercise the enabled path explicitly. */
function createService(options = {}) {
    return createAiSearchService({
        docsRoot,
        enabled: true,
        ...options,
    })
}

class MockResponse extends EventEmitter {
    constructor() {
        super()
        this.statusCode = 200
        this.headersSent = false
        this.writableEnded = false
        this.headers = new Map()
        this._body = ''
    }

    setHeader(name, value) {
        this.headers.set(String(name).toLowerCase(), String(value))
        return this
    }

    getHeader(name) {
        return this.headers.get(String(name).toLowerCase())
    }

    end(chunk) {
        if (chunk !== undefined) {
            this._body += Buffer.isBuffer(chunk)
                ? chunk.toString('utf8')
                : String(chunk)
        }
        this.writableEnded = true
        this.headersSent = true
        return this
    }

    get body() {
        return this._body
    }
}

function createRequest({
    method = 'POST',
    url = AI_SEARCH_PATH,
    headers = {},
    body = '',
    remoteAddress = '127.0.0.1',
    encrypted = false,
} = {}) {
    const bytes = Buffer.isBuffer(body)
        ? body
        : Buffer.from(String(body), 'utf8')
    const request = Readable.from(bytes.length > 0 ? [bytes] : [])
    request.method = method
    request.url = url
    request.headers = {
        host: 'localhost:5173',
        origin: 'http://localhost:5173',
        'content-type': 'application/json',
        'sec-fetch-site': 'same-origin',
        ...headers,
    }
    request.socket = { remoteAddress, encrypted }
    return request
}

function startServiceCall(service, options = {}) {
    const request = createRequest(options)
    const response = new MockResponse()
    const state = {
        request,
        response,
        nextCalled: false,
        promise: null,
    }
    state.promise = service.handle(request, response, () => {
        state.nextCalled = true
    })
    return state
}

async function callService(service, options = {}) {
    const started = startServiceCall(service, options)
    await started.promise

    let json = null
    if (started.response.body) {
        try {
            json = JSON.parse(started.response.body)
        } catch {
            json = null
        }
    }

    return {
        status: started.response.statusCode,
        headers: started.response.headers,
        rawBody: started.response.body,
        json,
        nextCalled: started.nextCalled,
    }
}

function queryBody(query, lang, extra = {}) {
    return JSON.stringify({ query, lang, ...extra })
}

function fsUrl(filePath) {
    const normalized = path.resolve(filePath).replace(/\\/gu, '/')
    return '/@fs/' + encodeURI(normalized)
}

async function fileAccess(guard, url) {
    const request = { method: 'GET', url }
    const response = new MockResponse()
    let nextCalled = false
    guard(request, response, () => {
        nextCalled = true
    })
    return {
        nextCalled,
        status: response.statusCode,
        body: response.body,
        headers: response.headers,
    }
}

test('removes script/style blocks completely and fails closed when unclosed', () => {
    assert.equal(
        stripScriptStyleBlocks('a<script>secret</script>b'),
        'a b'
    )
    assert.equal(
        stripScriptStyleBlocks(
            'a<STYLE\n media="a>b">.secret{}</STYLE >b'
        ),
        'a b'
    )
    assert.equal(
        stripScriptStyleBlocks(
            'a<SCRIPT data-x=">">secret</SCRIPT\n>b'
        ),
        'a b'
    )
    assert.equal(
        stripScriptStyleBlocks(
            'a<script>s</script>middle<style>t</style>b'
        ),
        'a middle b'
    )
    assert.equal(
        stripScriptStyleBlocks('a <scripture>x</scripture> b'),
        'a <scripture>x</scripture> b'
    )

    for (const unsafe of [
        'a<script>secret',
        'a<script',
        'a<script type="x"',
        'a<script>secret</script',
        'a<style>secret',
        'a<script/>',
    ]) {
        assert.throws(() => stripScriptStyleBlocks(unsafe))
    }

    for (const ambiguous of [
        'a<script>const x = "</script>"; rest</script>',
        "a<script>const x = '</script>'; rest</script>",
        'a<script>// </script>\nrest</script>',
        'a<script><![CDATA[ </script> ]]></script>',
        'a<style>.x { content: "</style>"; }</style>',
        'a<style>/* </style> */</style>',
        'a<script>secret</script></script>',
    ]) {
        assert.throws(() => stripScriptStyleBlocks(ambiguous))
    }
})

test('excludes Markdown code blocks before raw HTML inspection', async () => {
    const page = await parseMarkdownPage(
        [
            '# Fenced examples',
            '',
            'visible-before-fence',
            '',
            '```html',
            '<script>',
            'const marker = "</script>";',
            'fenced-string-secret',
            '</script>',
            '```',
            '',
            'visible-between-fences',
            '',
            '```html',
            '<!-- </script> -->',
            'fenced-comment-secret',
            '```',
            '',
            '```html',
            '<style><![CDATA[ </style> ]]></style>',
            'fenced-cdata-secret',
            '```',
            '',
            'visible-after-fence',
            '',
        ].join('\n'),
        'page.md',
        docsRoot
    )
    assert.ok(page)
    const text = page.sections.map((section) => section.text).join('\n')
    assert.match(text, /visible-before-fence/)
    assert.match(text, /visible-between-fences/)
    assert.match(text, /visible-after-fence/)
    assert.doesNotMatch(text, /fenced-string-secret/)
    assert.doesNotMatch(text, /fenced-comment-secret/)
    assert.doesNotMatch(text, /fenced-cdata-secret/)

    const unclosedFence = await parseMarkdownPage(
        [
            '# Unclosed fence',
            '',
            'unclosed-fence-before',
            '',
            '```html',
            '<script>',
            'const marker = "</script>";',
            'unclosed-fence-secret',
            '',
        ].join('\n'),
        'page.md',
        docsRoot
    )
    assert.ok(unclosedFence)
    const unclosedText = unclosedFence.sections
        .map((section) => section.text)
        .join('\n')
    assert.match(unclosedText, /unclosed-fence-before/)
    assert.doesNotMatch(unclosedText, /unclosed-fence-secret/)

    assert.equal(
        await parseMarkdownPage(
            [
                '# Ambiguous raw script',
                '',
                '<script>',
                'const marker = "</script>";',
                'ambiguous-raw-visible',
                '</script>',
                '',
            ].join('\n'),
            'page.md',
            docsRoot
        ),
        null
    )
})

test('uses VitePress YAML and the shared private-content sanitizer', async () => {
    for (const flags of [
        'search: false',
        'draft: true',
        'private: true',
        '"private": true',
        'draft: !!bool true',
    ]) {
        assert.equal(
            await parseMarkdownPage(
                `---\n${flags}\n---\n# Should not be indexed\n`,
                'page.md',
                docsRoot
            ),
            null
        )
    }

    assert.equal(
        await parseMarkdownPage(
            '---\ntitle: [unclosed\n---\n# Invalid YAML\n',
            'page.md',
            docsRoot
        ),
        null
    )
    assert.equal(
        await parseMarkdownPage(
            '# Unclosed\n\n<!-- private:start -->\nsecret\n',
            'page.md',
            docsRoot
        ),
        null
    )
    assert.equal(
        await parseMarkdownPage(
            '# Stray end\n\n<!-- private:end -->\n',
            'page.md',
            docsRoot
        ),
        null
    )
    assert.equal(
        await parseMarkdownPage(
            [
                '# Nested',
                '',
                '<!-- private:start -->',
                'a',
                '<!-- private:start -->',
                'b',
                '<!-- private:end -->',
                '',
            ].join('\n'),
            'page.md',
            docsRoot
        ),
        null
    )

    const page = await parseMarkdownPage(
        '---\ntitle: "Not the source title"\n---\n# Public page\n\nBody text.\n',
        'page.md',
        docsRoot
    )
    assert.equal(page.title, 'Public page')
    assert.equal(page.sections[0].heading, 'Public page')

    const privatePage = await parseMarkdownPage(
        [
            '# Visible page',
            '',
            'visible public text',
            '',
            '<!-- private:start -->',
            'private block text',
            '<!-- private:end -->',
            '',
            '<!-- ordinary comment -->',
            '',
        ].join('\n'),
        'page.md',
        docsRoot
    )
    const indexedText = privatePage.sections
        .map((section) => section.text)
        .join('\n')
    assert.match(indexedText, /visible public text/)
    assert.doesNotMatch(indexedText, /private block text/)
    assert.doesNotMatch(indexedText, /ordinary comment/)

    const scriptPage = await parseMarkdownPage(
        [
            '# Visible script page',
            '',
            'before script',
            '',
            '<script type="text/javascript">',
            'secret-script-marker',
            '</script>',
            '',
            '<style>',
            'secret-style-marker',
            '</style>',
            '',
            'after script',
            '',
        ].join('\n'),
        'page.md',
        docsRoot
    )
    const scriptText = scriptPage.sections
        .map((section) => section.text)
        .join('\n')
    assert.match(scriptText, /before script/)
    assert.match(scriptText, /after script/)
    assert.doesNotMatch(scriptText, /secret-script-marker/)
    assert.doesNotMatch(scriptText, /secret-style-marker/)

    for (const unclosed of [
        '# Unclosed\n\n<script>\nsecret\n',
        '# Unclosed\n\n<style>\nsecret\n',
        '# Unclosed\n\n<script',
    ]) {
        assert.equal(
            await parseMarkdownPage(unclosed, 'page.md', docsRoot),
            null
        )
    }
})

test('indexes only public pages from public directories', async () => {
    const index = await buildDocsIndex(docsRoot)
    const indexedText = index.chunks
        .map((chunk) => `${chunk.title}\n${chunk.heading}\n${chunk.text}`)
        .join('\n')

    assert.match(indexedText, /pendulum/i)
    assert.doesNotMatch(indexedText, /private-comment-marker/)
    assert.doesNotMatch(indexedText, /Private frontmatter title/)
    for (const marker of [
        'private-search-marker',
        'draft-marker',
        'private-flag-marker',
        'quoted-private-marker',
        'tagged-draft-marker',
        'invalid-yaml-marker',
        'private-block-marker',
        'ordinary-comment-marker',
        'unclosed-private-marker',
        'stray-private-marker',
        'nested-private-marker',
        'secret-script-marker',
        'secret-style-marker',
        'secret-attribute-marker',
        'unclosed-script-marker',
        'unclosed-style-marker',
        'fenced-string-secret',
        'fenced-comment-secret',
        'fenced-cdata-secret',
        'unclosed-fence-secret',
        'ambiguous-script-before',
        'ambiguous-script-after',
        'ambiguous-script-visible',
        'ambiguous-style-before',
        'ambiguous-style-visible',
        'ambiguous-comment-visible',
        'ambiguous-cdata-visible',
        'hidden-directory-marker',
        'generated-directory-marker',
        'vitepress-marker',
        'public-marker',
    ]) {
        assert.doesNotMatch(indexedText, new RegExp(marker))
    }
    assert.match(indexedText, /Visible public text for the privacy fixture/)
    assert.match(indexedText, /Visible before script/)
    assert.match(indexedText, /Visible after script/)
    assert.match(indexedText, /attribute-before/)
    assert.match(indexedText, /attribute-after/)
    assert.match(indexedText, /visible-before-fence/)
    assert.match(indexedText, /visible-between-fences/)
    assert.match(indexedText, /visible-after-fence/)
    assert.match(indexedText, /unclosed-fence-before/)
})

test('retrieves relevant sections without mixing languages', async () => {
    const index = await buildDocsIndex(docsRoot)

    const english = searchDocs(index, 'pendulum period', 'en')
    assert.ok(english.length > 0)
    assert.equal(english[0].url, '/physics')
    assert.ok(
        english.some(
            (match) => match.url === '/physics' && /period/i.test(match.text)
        )
    )

    const chinese = searchDocs(index, '单摆 周期', 'zh-CN')
    assert.ok(chinese.length > 0)
    assert.equal(chinese[0].url, '/zh-cn/pendulum')

    assert.deepEqual(searchDocs(index, 'pendulum period', 'zh'), [])
    assert.deepEqual(searchDocs(index, '单摆 周期', 'en'), [])
    assert.deepEqual(searchDocs(index, 'unfindable-term-xyz', 'en'), [])
    assert.deepEqual(searchDocs(index, 'what is the', 'en'), [])
})

test('does not call the model when retrieval has no results', async () => {
    const model = createModel('should never be called')
    const service = createService({
        docsRoot,
        requestModel: model.requestModel,
    })

    const direct = await service.search('unfindable-term-xyz', 'en')
    assert.equal(direct.status, 'no_results')
    assert.equal(model.calls.length, 0)

    const response = await callService(service, {
        body: queryBody('unfindable-term-xyz', 'en'),
    })
    assert.equal(response.status, 200)
    assert.equal(response.json.ok, false)
    assert.equal(response.json.code, 'no_results')
    assert.equal(model.calls.length, 0)
})

test('answers from public retrieval context and returns safe sources', async () => {
    const model = createModel('The period depends on length and gravity.')
    const service = createService({
        docsRoot,
        requestModel: model.requestModel,
    })

    const response = await callService(service, {
        body: queryBody('What is the pendulum period?', 'en'),
    })

    assert.equal(response.status, 200)
    assert.equal(response.json.ok, true)
    assert.match(response.json.answer, /period/i)
    assert.ok(Array.isArray(response.json.sources))
    assert.ok(response.json.sources.length > 0)
    for (const source of response.json.sources) {
        assert.ok(source.url.startsWith('/'))
        assert.ok(!source.url.startsWith('//'))
        assert.ok(!source.url.includes('\\'))
        assert.equal(sanitizeSourcePath(source.url), source.url)
    }

    assert.equal(model.calls.length, 1)
    const call = model.calls[0]
    assert.equal(call.timeoutMs, MODEL_TIMEOUT_MS)
    assert.match(call.system, /untrusted/i)
    assert.match(call.prompt, /pendulum/i)
    assert.doesNotMatch(call.prompt, /private-comment-marker/)
    assert.doesNotMatch(call.prompt, /Private frontmatter title/)
    assert.doesNotMatch(call.prompt, /private-search-marker/)
    assert.doesNotMatch(call.prompt, /draft-marker/)
})

test('Chinese retrieval uses Chinese context and sources', async () => {
    const model = createModel('周期由摆长和重力决定。')
    const service = createService({
        docsRoot,
        requestModel: model.requestModel,
    })

    const response = await callService(service, {
        body: queryBody('单摆 周期', 'zh-CN'),
    })

    assert.equal(response.status, 200)
    assert.equal(response.json.ok, true)
    assert.equal(model.calls.length, 1)
    assert.match(model.calls[0].system, /简体中文/)
    assert.equal(model.calls[0].prompt.includes('单摆'), true)
    assert.ok(
        response.json.sources.some(
            (source) => source.url === '/zh-cn/pendulum'
        )
    )
})

test('distinguishes model failure from no results and redacts errors', async () => {
    const secret = 'sk-test-secret-1234567890'
    const model = createModel(() => {
        throw new Error(
            `provider failed at https://example.invalid config ${secret}`
        )
    })
    const service = createService({
        docsRoot,
        requestModel: model.requestModel,
    })

    const response = await callService(service, {
        body: queryBody('pendulum period', 'en'),
    })

    assert.equal(response.status, 502)
    assert.equal(response.json.ok, false)
    assert.equal(response.json.code, 'model_error')
    assert.doesNotMatch(
        response.rawBody,
        /sk-test|example\.invalid|provider failed/
    )
    assert.equal(model.calls.length, 1)

    const emptyModel = createModel('   ')
    const emptyService = createService({
        docsRoot,
        requestModel: emptyModel.requestModel,
    })
    const emptyResponse = await callService(emptyService, {
        body: queryBody('pendulum period', 'en'),
    })
    assert.equal(emptyResponse.status, 502)
    assert.equal(emptyResponse.json.code, 'model_error')
})

test('never sends private blocks or comments to the model', async () => {
    const model = createModel('Visible answer.')
    const service = createService({
        docsRoot,
        requestModel: model.requestModel,
    })

    const response = await callService(service, {
        body: queryBody('Visible privacy fixture', 'en'),
    })

    assert.equal(response.status, 200)
    assert.equal(model.calls.length, 1)
    assert.match(model.calls[0].prompt, /visible public text/i)
    assert.doesNotMatch(model.calls[0].prompt, /private-block-marker/)
    assert.doesNotMatch(model.calls[0].prompt, /ordinary-comment-marker/)
    assert.doesNotMatch(model.calls[0].prompt, /unclosed-private-marker/)
    assert.doesNotMatch(model.calls[0].prompt, /stray-private-marker/)
    assert.doesNotMatch(model.calls[0].prompt, /nested-private-marker/)
    assert.doesNotMatch(model.calls[0].prompt, /invalid-yaml-marker/)
    assert.doesNotMatch(model.calls[0].prompt, /quoted-private-marker/)
    assert.doesNotMatch(model.calls[0].prompt, /tagged-draft-marker/)

    const scriptResponse = await callService(service, {
        body: queryBody('Script fixture', 'en'),
    })
    assert.equal(scriptResponse.status, 200)
    assert.equal(model.calls.length, 2)
    const scriptPrompt = model.calls[1].prompt
    assert.match(scriptPrompt, /Visible before script/i)
    assert.match(scriptPrompt, /Visible after script/i)
    for (const marker of [
        'secret-script-marker',
        'secret-style-marker',
        'secret-attribute-marker',
        'unclosed-script-marker',
        'unclosed-style-marker',
    ]) {
        assert.doesNotMatch(scriptPrompt, new RegExp(marker))
    }

    const fencedResponse = await callService(service, {
        body: queryBody('Fenced script examples', 'en'),
    })
    assert.equal(fencedResponse.status, 200)
    assert.equal(model.calls.length, 3)
    const fencedPrompt = model.calls[2].prompt
    assert.match(fencedPrompt, /visible-before-fence/i)
    assert.match(fencedPrompt, /visible-after-fence/i)
    for (const marker of [
        'fenced-string-secret',
        'fenced-comment-secret',
        'fenced-cdata-secret',
        'unclosed-fence-secret',
    ]) {
        assert.doesNotMatch(fencedPrompt, new RegExp(marker))
    }
})

test('limits concurrent model requests and returns an explicit busy response', async () => {
    let releaseFirst
    let startedResolve
    const started = new Promise((resolve) => {
        startedResolve = resolve
    })
    let calls = 0
    const requestModel = async () => {
        calls += 1
        if (calls === 1) {
            startedResolve()
            return new Promise((resolve) => {
                releaseFirst = resolve
            })
        }
        return 'second answer'
    }

    const service = createService({
        docsRoot,
        requestModel,
        maxConcurrentModelRequests: 1,
    })

    const first = service.search('pendulum period', 'en')
    await started
    const busy = await service.search('pendulum period', 'en')
    assert.equal(busy.status, 'busy')
    assert.equal(calls, 1)

    const busyResponse = await callService(service, {
        body: queryBody('pendulum period', 'en'),
    })
    assert.equal(busyResponse.status, 429)
    assert.equal(busyResponse.json.ok, false)
    assert.equal(busyResponse.json.code, 'busy')
    assert.equal(busyResponse.headers.get('retry-after'), '1')
    assert.equal(calls, 1)

    releaseFirst('first answer')
    const firstResult = await first
    assert.equal(firstResult.status, 'ok')
    assert.equal(firstResult.answer, 'first answer')

    const after = await service.search('pendulum period', 'en')
    assert.equal(after.status, 'ok')
    assert.equal(after.answer, 'second answer')
    assert.equal(calls, 2)
})

test('aborts the model request and releases the slot when the client disconnects', async () => {
    let seenSignal
    let startedResolve
    const started = new Promise((resolve) => {
        startedResolve = resolve
    })
    let mode = 'block'
    let calls = 0
    const requestModel = async ({ signal }) => {
        calls += 1
        seenSignal = signal
        if (mode === 'ok') return 'answer after abort'
        startedResolve()
        return new Promise((resolve, reject) => {
            if (signal.aborted) {
                reject(new Error('aborted'))
                return
            }
            signal.addEventListener(
                'abort',
                () => reject(new Error('aborted')),
                { once: true }
            )
        })
    }

    const service = createService({
        docsRoot,
        requestModel,
        maxConcurrentModelRequests: 1,
    })

    const startedCall = startServiceCall(service, {
        body: queryBody('pendulum period', 'en'),
    })
    await started
    assert.ok(seenSignal instanceof AbortSignal)
    assert.equal(seenSignal.aborted, false)

    startedCall.response.emit('close')
    await startedCall.promise
    assert.equal(seenSignal.aborted, true)
    assert.equal(startedCall.response.writableEnded, false)
    assert.equal(startedCall.response.body, '')

    mode = 'ok'
    const after = await service.search('pendulum period', 'en')
    assert.equal(after.status, 'ok')
    assert.equal(after.answer, 'answer after abort')
    assert.equal(calls, 2)
})

test('rejects cross-site, wrong-origin, and DNS-rebinding requests', async () => {
    const model = createModel('must not run')
    const service = createService({
        docsRoot,
        requestModel: model.requestModel,
    })
    const body = queryBody('pendulum period', 'en')

    const crossSite = await callService(service, {
        headers: { origin: 'https://evil.example' },
        body,
    })
    assert.equal(crossSite.status, 403)
    assert.equal(crossSite.json.code, 'forbidden_origin')

    const rebinding = await callService(service, {
        headers: {
            host: 'localhost.evil.example:5173',
            origin: 'http://localhost.evil.example:5173',
        },
        body,
    })
    assert.equal(rebinding.status, 403)
    assert.equal(rebinding.json.code, 'forbidden_host')

    const wrongHost = await callService(service, {
        headers: {
            host: '127.0.0.1.nip.io:5173',
            origin: 'http://127.0.0.1.nip.io:5173',
        },
        body,
    })
    assert.equal(wrongHost.status, 403)
    assert.equal(wrongHost.json.code, 'forbidden_host')

    const missingOrigin = await callService(service, {
        headers: { origin: undefined },
        body,
    })
    assert.equal(missingOrigin.status, 403)
    assert.equal(missingOrigin.json.code, 'forbidden_origin')

    const crossSiteFetch = await callService(service, {
        headers: { 'sec-fetch-site': 'cross-site' },
        body,
    })
    assert.equal(crossSiteFetch.status, 403)
    assert.equal(crossSiteFetch.json.code, 'forbidden_origin')
    assert.equal(model.calls.length, 0)
})

test('accepts only loopback clients', async () => {
    const model = createModel('loopback answer')
    const service = createService({
        docsRoot,
        requestModel: model.requestModel,
    })

    const remote = await callService(service, {
        remoteAddress: '192.168.0.2',
        body: queryBody('pendulum period', 'en'),
    })
    assert.equal(remote.status, 403)
    assert.equal(remote.json.code, 'forbidden_client')

    const ipv6 = await callService(service, {
        remoteAddress: '::1',
        headers: {
            host: '[::1]:5173',
            origin: 'http://[::1]:5173',
        },
        body: queryBody('pendulum period', 'en'),
    })
    assert.equal(ipv6.status, 200)
    assert.equal(ipv6.json.ok, true)
    assert.equal(model.calls.length, 1)
})

test('validates method, content type, body size, encoding, and schema', async () => {
    const model = createModel('valid')
    const service = createService({
        docsRoot,
        requestModel: model.requestModel,
    })

    const get = await callService(service, {
        method: 'GET',
        body: '',
    })
    assert.equal(get.status, 405)
    assert.equal(get.json.code, 'method_not_allowed')
    assert.equal(get.headers.get('allow'), 'POST')

    const options = await callService(service, { method: 'OPTIONS' })
    assert.equal(options.status, 405)

    const plainText = await callService(service, {
        headers: { 'content-type': 'text/plain' },
        body: queryBody('pendulum period', 'en'),
    })
    assert.equal(plainText.status, 415)
    assert.equal(plainText.json.code, 'unsupported_media_type')

    const wrongCharset = await callService(service, {
        headers: {
            'content-type': 'application/json; charset=iso-8859-1',
        },
        body: queryBody('pendulum period', 'en'),
    })
    assert.equal(wrongCharset.status, 415)

    const tooLarge = await callService(service, {
        body: 'x'.repeat(MAX_BODY_BYTES + 1),
    })
    assert.equal(tooLarge.status, 413)
    assert.equal(tooLarge.json.code, 'body_too_large')

    const invalidUtf8 = await callService(service, {
        body: Buffer.from([0xff, 0xfe, 0xfd]),
    })
    assert.equal(invalidUtf8.status, 400)
    assert.equal(invalidUtf8.json.code, 'invalid_encoding')

    const malformedJson = await callService(service, { body: '{' })
    assert.equal(malformedJson.status, 400)
    assert.equal(malformedJson.json.code, 'invalid_json')

    const arrayBody = await callService(service, { body: '[]' })
    assert.equal(arrayBody.status, 400)
    assert.equal(arrayBody.json.code, 'invalid_request')

    const extraField = await callService(service, {
        body: queryBody('pendulum period', 'en', { system: 'override' }),
    })
    assert.equal(extraField.status, 400)
    assert.equal(extraField.json.code, 'invalid_request')

    const badLanguage = await callService(service, {
        body: queryBody('pendulum period', 'fr'),
    })
    assert.equal(badLanguage.status, 400)
    assert.equal(badLanguage.json.code, 'unsupported_language')

    const longQuery = await callService(service, {
        body: queryBody('a'.repeat(201), 'en'),
    })
    assert.equal(longQuery.status, 400)

    const shortQuery = await callService(service, {
        body: queryBody('a', 'en'),
    })
    assert.equal(shortQuery.status, 400)

    const controlQuery = await callService(service, {
        body: queryBody('\u0000abc', 'en'),
    })
    assert.equal(controlQuery.status, 400)

    const bidiQuery = await callService(service, {
        body: queryBody('\u202Eabc', 'en'),
    })
    assert.equal(bidiQuery.status, 400)

    const blankQuery = await callService(service, {
        body: queryBody('   ', 'en'),
    })
    assert.equal(blankQuery.status, 400)

    const missingQuery = await callService(service, {
        body: JSON.stringify({ lang: 'en' }),
    })
    assert.equal(missingQuery.status, 400)

    const missingLanguage = await callService(service, {
        body: JSON.stringify({ query: 'pendulum period' }),
    })
    assert.equal(missingLanguage.status, 400)

    const queryString = await callService(service, {
        url: AI_SEARCH_PATH + '?unexpected=1',
        body: queryBody('pendulum period', 'en'),
    })
    assert.equal(queryString.status, 400)

    const otherPath = await callService(service, {
        url: '/not-the-endpoint',
        body: '',
    })
    assert.equal(otherPath.nextCalled, true)
    assert.equal(otherPath.status, 200)
    assert.equal(otherPath.rawBody, '')
    assert.equal(model.calls.length, 0)
})

test('validates Host headers and source paths', () => {
    assert.equal(parseAllowedHost('localhost'), 'localhost')
    assert.equal(parseAllowedHost('localhost:5173'), 'localhost:5173')
    assert.equal(parseAllowedHost('LOCALHOST:5173'), 'localhost:5173')
    assert.equal(parseAllowedHost('127.0.0.1:5173'), '127.0.0.1:5173')
    assert.equal(parseAllowedHost('[::1]:5173'), '[::1]:5173')
    assert.equal(parseAllowedHost('[::1]:99999'), null)
    assert.equal(parseAllowedHost('localhost.evil.example:5173'), null)
    assert.equal(parseAllowedHost('127.0.0.1.nip.io:5173'), null)
    assert.equal(parseAllowedHost('evil.example'), null)
    assert.equal(parseAllowedHost('localhost:0'), null)

    for (const pathname of ['/', '/About/', '/zh-cn/Notes/demo', '/a%20b']) {
        assert.equal(sanitizeSourcePath(pathname), pathname)
    }
    for (const pathname of [
        '',
        '//evil.example/x',
        'https://evil.example/',
        '/a//b',
        '/a/../b',
        '/a/%2e%2e/b',
        '/a\\b',
        '/a b',
        '/a?b',
        '/a#b',
        '/a\u0000b',
        'javascript:alert(1)',
    ]) {
        assert.equal(sanitizeSourcePath(pathname), null)
    }
})

test('refuses the AI endpoint without touching a model when the switch is off', async () => {
    let calls = 0
    const service = createAiSearchService({
        docsRoot: path.join(docsRoot, 'missing-docs-root'),
        enabled: false,
        requestModel: async () => {
            calls += 1
            return 'should never be called'
        },
    })

    assert.equal(service.enabled, false)
    const direct = await service.search('pendulum period', 'en')
    assert.equal(direct.status, 'disabled')
    assert.deepEqual(direct.sources, [])

    const response = await callService(service, {
        body: queryBody('pendulum period', 'en'),
    })
    assert.equal(response.status, 404)
    assert.equal(response.json.ok, false)
    assert.equal(response.json.code, 'ai_disabled')
    assert.equal(calls, 0)
    assert.doesNotMatch(
        response.rawBody,
        /pendulum|private|api[_-]?key|baseUrl|secret/i
    )
})

test('attaches a disabled endpoint and file guard without watching docs', async () => {
    const watcherEvents = []
    const handlers = []
    const fakeKey = path.join(docsRoot, 'fake-model-config.yaml')
    await writeFile(fakeKey, 'FAKE_KEY_SENTINEL', 'utf8')
    const server = {
        config: { root: docsRoot },
        middlewares: {
            use(handler) {
                handlers.push(handler)
            },
        },
        watcher: {
            on() {
                watcherEvents.push('on')
            },
            off() {},
        },
    }

    const service = attachLocalAiSearch(server, {
        enabled: false,
        aiModelConfig: null,
        repoRoot: docsRoot,
        modelConfigPath: fakeKey,
    })
    assert.equal(service.enabled, false)
    assert.equal(handlers.length, 2)
    assert.equal(handlers[1], service.middleware)
    assert.deepEqual(watcherEvents, [])

    const guarded = await fileAccess(handlers[0], fsUrl(fakeKey))
    assert.equal(guarded.nextCalled, false)
    assert.equal(guarded.status, 403)
    assert.equal(guarded.body, 'Forbidden')
})

test('file access guard blocks private files, encodings, and virtual symlink escapes', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'ai-file-guard-'))
    try {
        const repoRoot = path.join(root, 'repo')
        const docs = path.join(repoRoot, 'docs')
        const publicDir = path.join(docs, 'public')
        const nodeModules = path.join(repoRoot, 'node_modules')
        const tools = path.join(repoRoot, 'tools')
        const privateDir = path.join(root, 'private')
        await Promise.all([
            mkdir(docs, { recursive: true }),
            mkdir(publicDir, { recursive: true }),
            mkdir(nodeModules, { recursive: true }),
            mkdir(tools, { recursive: true }),
            mkdir(privateDir, { recursive: true }),
        ])

        const modelConfigPath = path.join(tools, 'model-config.yaml')
        const envModelConfig = path.join(privateDir, 'private-model.json')
        const publicFile = path.join(publicDir, 'ok.txt')
        const docFile = path.join(docs, 'page.md')
        const dependencyFile = path.join(nodeModules, 'dep.js')
        const outsideFile = path.join(repoRoot, 'README.md')
        const leakLink = path.join(publicDir, 'leak.txt')
        const hardLink = path.join(publicDir, 'hardlink.txt')
        await Promise.all([
            writeFile(modelConfigPath, 'FAKE_KEY_SENTINEL', 'utf8'),
            writeFile(envModelConfig, 'FAKE_CONFIG_SENTINEL', 'utf8'),
            writeFile(publicFile, 'public', 'utf8'),
            writeFile(docFile, '# page', 'utf8'),
            writeFile(dependencyFile, 'export default 1', 'utf8'),
            writeFile(outsideFile, 'outside', 'utf8'),
            writeFile(leakLink, 'pretend symlink', 'utf8'),
            writeFile(hardLink, 'pretend hardlink', 'utf8'),
        ])

        // Inject symlink/junction semantics without requiring OS privileges.
        const keyStats = DEFAULT_FILE_SYSTEM_OPS.statSync(modelConfigPath)
        const fakeFs = {
            ...DEFAULT_FILE_SYSTEM_OPS,
            realpathSync(value) {
                if (pathKey(value) === pathKey(leakLink)) return modelConfigPath
                return DEFAULT_FILE_SYSTEM_OPS.realpathSync(value)
            },
            statSync(value) {
                if (pathKey(value) === pathKey(leakLink)) {
                    return { isDirectory: () => false }
                }
                if (pathKey(value) === pathKey(hardLink)) {
                    return {
                        dev: keyStats.dev,
                        ino: keyStats.ino,
                        isDirectory: () => false,
                        isFile: () => true,
                    }
                }
                return DEFAULT_FILE_SYSTEM_OPS.statSync(value)
            },
            lstatSync(value) {
                if (pathKey(value) === pathKey(leakLink)) {
                    return { isSymbolicLink: () => true }
                }
                return DEFAULT_FILE_SYSTEM_OPS.lstatSync(value)
            },
        }

        const guard = createFileAccessGuard({
            allowedRoots: [docs, publicDir, nodeModules],
            repoRoot,
            aiModelConfig: envModelConfig,
            baseDir: root,
            fs: fakeFs,
        })

        for (const file of [docFile, publicFile, dependencyFile]) {
            const result = await fileAccess(guard, fsUrl(file))
            assert.equal(result.nextCalled, true)
            assert.equal(result.status, 200)
            assert.equal(result.body, '')
        }
        assert.equal((await fileAccess(guard, '/page.md')).nextCalled, true)
        assert.equal((await fileAccess(guard, '/ok.txt')).nextCalled, true)

        const previousConfig = process.env.AI_MODEL_CONFIG
        try {
            process.env.AI_MODEL_CONFIG = envModelConfig
            const envGuard = createFileAccessGuard({
                allowedRoots: [docs, publicDir, nodeModules],
                repoRoot,
                baseDir: root,
            })
            const envResult = await fileAccess(envGuard, fsUrl(envModelConfig))
            assert.equal(envResult.nextCalled, false)
            assert.equal(envResult.status, 403)
        } finally {
            if (previousConfig === undefined) {
                delete process.env.AI_MODEL_CONFIG
            } else {
                process.env.AI_MODEL_CONFIG = previousConfig
            }
        }

        const target = path.resolve(modelConfigPath).replace(/\\/gu, '/')
        const encodedTarget = encodeURIComponent(target)
        const blocked = [
            fsUrl(modelConfigPath),
            fsUrl(modelConfigPath) + '?raw',
            fsUrl(envModelConfig),
            fsUrl(outsideFile),
            fsUrl(leakLink),
            '/leak.txt',
            fsUrl(hardLink),
            '/hardlink.txt',
            '/@fs/' + encodedTarget,
            '/@fs/' + encodeURIComponent(encodedTarget),
            '/' + encodeURIComponent('@fs/' + target),
            '/.env',
            '/.env.local',
            '/.env.',
            '/model-config.yaml',
            '/model-config.json',
            '/model-config.yaml.',
            '/api-key.txt.',
            '/.git/config',
            '/.git./config',
            '/license.key',
            '/bundle.secret.json',
            '/bundle.private.json',
            '/bundle.local.json',
            '/..%2f..%2fREADME.md',
            '/%00',
            '/@fs/%E0%A4%A',
        ]

        for (const url of blocked) {
            const result = await fileAccess(guard, url)
            assert.equal(result.nextCalled, false, url)
            assert.equal(result.status, 403, url)
            assert.equal(result.body, 'Forbidden')
            assert.doesNotMatch(
                result.body,
                /FAKE_KEY_SENTINEL|FAKE_CONFIG_SENTINEL|api-key|model-config|[A-Z]:\\/i
            )
        }

        assert.throws(
            () =>
                createFileAccessGuard({
                    allowedRoots: [docs, publicDir, nodeModules],
                    repoRoot,
                    aiModelConfig: path.join(docs, 'inside.json'),
                    baseDir: root,
                    fs: fakeFs,
                }),
            /must not be inside a served or publishable path/
        )

        const configLink = path.join(root, 'config-link.json')
        await writeFile(configLink, 'pretend config link', 'utf8')
        const configLinkFs = {
            ...fakeFs,
            realpathSync(value) {
                if (pathKey(value) === pathKey(configLink)) {
                    return path.join(publicDir, 'leaked.json')
                }
                return fakeFs.realpathSync(value)
            },
        }
        assert.throws(
            () =>
                createFileAccessGuard({
                    allowedRoots: [docs, publicDir, nodeModules],
                    repoRoot,
                    aiModelConfig: configLink,
                    baseDir: root,
                    fs: configLinkFs,
                }),
            /must not be inside a served or publishable path/
        )

        assert.throws(
            () =>
                createFileAccessGuard({
                    allowedRoots: [docs],
                    repoRoot,
                    aiModelConfig: 'bad\0path',
                    fs: fakeFs,
                }),
            /cannot be resolved safely/
        )
    } finally {
        await rm(root, { recursive: true, force: true })
    }
})

test('file access guard refreshes protected identities per request', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'ai-identity-refresh-'))
    try {
        const repoRoot = path.join(root, 'repo')
        const docs = path.join(repoRoot, 'docs')
        const publicDir = path.join(docs, 'public')
        const nodeModules = path.join(repoRoot, 'node_modules')
        const tools = path.join(repoRoot, 'tools')
        await Promise.all([
            mkdir(publicDir, { recursive: true }),
            mkdir(nodeModules, { recursive: true }),
            mkdir(tools, { recursive: true }),
        ])

        const key = path.join(tools, 'model-config.yaml')
        const publicFile = path.join(publicDir, 'ok.txt')
        const firstLink = path.join(publicDir, 'hard-created.txt')
        const secondLink = path.join(publicDir, 'hard-replaced.txt')
        await Promise.all([
            writeFile(publicFile, 'public', 'utf8'),
            writeFile(firstLink, 'pretend hardlink', 'utf8'),
            writeFile(secondLink, 'pretend hardlink', 'utf8'),
        ])

        let keyExists = false
        let keyError = null
        let keyIdentity = { dev: 7, ino: 100 }
        const targetIdentities = new Map([
            [pathKey(firstLink), null],
            [pathKey(secondLink), null],
        ])

        const fakeFs = {
            ...DEFAULT_FILE_SYSTEM_OPS,
            realpathSync(value) {
                if (pathKey(value) === pathKey(key) && !keyExists) {
                    throw Object.assign(new Error('missing'), {
                        code: 'ENOENT',
                    })
                }
                return DEFAULT_FILE_SYSTEM_OPS.realpathSync(value)
            },
            statSync(value) {
                if (pathKey(value) === pathKey(key)) {
                    if (keyError) {
                        throw Object.assign(new Error('denied'), {
                            code: keyError,
                        })
                    }
                    if (!keyExists) {
                        throw Object.assign(new Error('missing'), {
                            code: 'ENOENT',
                        })
                    }
                    return {
                        dev: keyIdentity.dev,
                        ino: keyIdentity.ino,
                        isDirectory: () => false,
                        isFile: () => true,
                    }
                }
                const identity = targetIdentities.get(pathKey(value))
                if (identity) {
                    return {
                        dev: identity.dev,
                        ino: identity.ino,
                        isDirectory: () => false,
                        isFile: () => true,
                    }
                }
                return DEFAULT_FILE_SYSTEM_OPS.statSync(value)
            },
        }

        const guard = createFileAccessGuard({
            allowedRoots: [docs, publicDir, nodeModules],
            repoRoot,
            aiModelConfig: null,
            baseDir: root,
            fs: fakeFs,
        })

        // No key yet: ordinary static files still work.
        assert.equal((await fileAccess(guard, '/ok.txt')).nextCalled, true)

        // Key created after startup; a hardlink gets its current identity.
        keyExists = true
        targetIdentities.set(pathKey(firstLink), { dev: 7, ino: 100 })
        const created = await fileAccess(guard, fsUrl(firstLink))
        assert.equal(created.nextCalled, false)
        assert.equal(created.status, 403)

        // Key replaced with a new inode; a new hardlink is still rejected.
        keyIdentity = { dev: 7, ino: 200 }
        targetIdentities.set(pathKey(secondLink), { dev: 7, ino: 200 })
        const replaced = await fileAccess(guard, fsUrl(secondLink))
        assert.equal(replaced.nextCalled, false)
        assert.equal(replaced.status, 403)

        // The old identity remains blocked as well.
        const old = await fileAccess(guard, fsUrl(firstLink))
        assert.equal(old.nextCalled, false)
        assert.equal(old.status, 403)

        // Permission/stat failure during refresh fails closed for file access.
        keyError = 'EACCES'
        const denied = await fileAccess(guard, '/ok.txt')
        assert.equal(denied.nextCalled, false)
        assert.equal(denied.status, 403)

        keyError = null
        assert.equal((await fileAccess(guard, '/ok.txt')).nextCalled, true)
    } finally {
        await rm(root, { recursive: true, force: true })
    }
})

test('publish scan rejects private files and virtual symlink escapes', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'ai-publish-scan-'))
    try {
        const repoRoot = path.join(root, 'repo')
        const docs = path.join(repoRoot, 'docs')
        const publicDir = path.join(docs, 'public')
        const tools = path.join(repoRoot, 'tools')
        const privateDir = path.join(root, 'private')
        await Promise.all([
            mkdir(publicDir, { recursive: true }),
            mkdir(tools, { recursive: true }),
            mkdir(privateDir, { recursive: true }),
        ])

        const modelConfigPath = path.join(tools, 'model-config.yaml')
        const envModelConfig = path.join(privateDir, 'private-model.json')
        await Promise.all([
            writeFile(path.join(docs, 'index.md'), '# Home', 'utf8'),
            writeFile(path.join(publicDir, 'ok.css'), 'body{}', 'utf8'),
            writeFile(modelConfigPath, 'FAKE_KEY_SENTINEL', 'utf8'),
            writeFile(envModelConfig, 'FAKE_CONFIG_SENTINEL', 'utf8'),
        ])

        const base = {
            docsRoot: docs,
            publicDir,
            aiModelConfig: envModelConfig,
            repositoryRoot: repoRoot,
            baseDirectory: root,
        }
        scanPublishableResources(base)

        for (const name of [
            '.env',
            'leaked.key',
            'model-config.yaml',
            'model-config.json',
            'api-key.txt',
            'bundle.secret.json',
            'bundle.private.json',
            'bundle.local.json',
        ]) {
            const file = path.join(publicDir, name)
            await writeFile(file, 'FAKE_PRIVATE_SENTINEL', 'utf8')
            assert.throws(
                () => scanPublishableResources(base),
                /Refusing to publish private configuration or symbolic links/
            )
            await rm(file, { force: true })
        }

        const leak = path.join(publicDir, 'leak.txt')
        await writeFile(leak, 'pretend symlink', 'utf8')
        const fakeFs = {
            ...DEFAULT_FILE_SYSTEM_OPS,
            lstatSync(value) {
                if (pathKey(value) === pathKey(leak)) {
                    return {
                        isSymbolicLink: () => true,
                        isDirectory: () => false,
                        isFile: () => false,
                    }
                }
                return DEFAULT_FILE_SYSTEM_OPS.lstatSync(value)
            },
            realpathSync(value) {
                if (pathKey(value) === pathKey(leak)) return modelConfigPath
                return DEFAULT_FILE_SYSTEM_OPS.realpathSync(value)
            },
        }

        assert.throws(
            () => scanPublishableResources({ ...base, fs: fakeFs }),
            (error) => {
                assert.doesNotMatch(
                    error.message,
                    /FAKE_KEY_SENTINEL|FAKE_CONFIG_SENTINEL|api-key|model-config|[A-Z]:\\/i
                )
                assert.match(
                    error.message,
                    /Refusing to publish private configuration or symbolic links/
                )
                return true
            }
        )

        const hardlinkFile = path.join(publicDir, 'hardlink.txt')
        await writeFile(hardlinkFile, 'pretend hardlink', 'utf8')
        const keyStats = DEFAULT_FILE_SYSTEM_OPS.statSync(modelConfigPath)
        const identityFs = {
            ...DEFAULT_FILE_SYSTEM_OPS,
            statSync(value) {
                if (pathKey(value) === pathKey(hardlinkFile)) {
                    return {
                        dev: keyStats.dev,
                        ino: keyStats.ino,
                        isDirectory: () => false,
                        isFile: () => true,
                    }
                }
                return DEFAULT_FILE_SYSTEM_OPS.statSync(value)
            },
        }
        assert.throws(
            () => scanPublishableResources({ ...base, fs: identityFs }),
            /Refusing to publish private configuration or symbolic links/
        )

        const insidePublic = path.join(publicDir, 'private.json')
        await writeFile(insidePublic, 'FAKE_CONFIG_SENTINEL', 'utf8')
        assert.throws(
            () =>
                scanPublishableResources({
                    ...base,
                    aiModelConfig: insidePublic,
                }),
            /must not be inside a served or publishable path/
        )

        const configLink = path.join(root, 'config-link.json')
        await writeFile(configLink, 'pretend config link', 'utf8')
        const configLinkFs = {
            ...DEFAULT_FILE_SYSTEM_OPS,
            realpathSync(value) {
                if (pathKey(value) === pathKey(configLink)) {
                    return insidePublic
                }
                return DEFAULT_FILE_SYSTEM_OPS.realpathSync(value)
            },
        }
        assert.throws(
            () =>
                scanPublishableResources({
                    ...base,
                    aiModelConfig: configLink,
                    fs: configLinkFs,
                }),
            /must not be inside a served or publishable path/
        )

        const cacheDir = path.join(docs, '.vitepress', 'cache')
        await mkdir(cacheDir, { recursive: true })
        const cachedLeak = path.join(cacheDir, 'leak.txt')
        await writeFile(cachedLeak, 'cache', 'utf8')
        const cacheFs = {
            ...DEFAULT_FILE_SYSTEM_OPS,
            lstatSync(value) {
                if (pathKey(value) === pathKey(cachedLeak)) {
                    return {
                        isSymbolicLink: () => true,
                        isDirectory: () => false,
                        isFile: () => false,
                    }
                }
                return DEFAULT_FILE_SYSTEM_OPS.lstatSync(value)
            },
        }
        scanPublishableResources({ ...base, fs: cacheFs })
    } finally {
        await rm(root, { recursive: true, force: true })
    }
})

test('private model configuration uses only ignored repo paths or outside repo', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'ai-config-placement-'))
    try {
        const repoRoot = path.join(root, 'repo')
        const docs = path.join(repoRoot, 'docs')
        const publicDir = path.join(docs, 'public')
        await Promise.all([
            mkdir(path.join(repoRoot, 'tools'), { recursive: true }),
            mkdir(publicDir, { recursive: true }),
        ])

        const common = {
            servedRoots: [docs, publicDir],
            repositoryRoot: repoRoot,
            baseDirectory: root,
        }
        const allowed = [
            path.join(repoRoot, 'tools', 'model-config.yaml'),
            path.join(repoRoot, 'tools', 'model-config.yml'),
            path.join(repoRoot, 'tools', 'model-config.json'),
            path.join(repoRoot, 'tools', 'local.key'),
            path.join(repoRoot, 'tools', 'local.pem'),
            path.join(repoRoot, 'tools', 'model.secret.json'),
            path.join(repoRoot, 'tools', 'model.private.json'),
            path.join(repoRoot, 'tools', 'model.local.json'),
            path.join(repoRoot, 'tools', '.env'),
            path.join(repoRoot, '.env'),
            path.join(repoRoot, '.env.production'),
            path.join(root, 'outside.json'),
        ]
        for (const aiModelConfig of allowed) {
            assert.doesNotThrow(
                () =>
                    assertPrivateModelConfigPlacement({
                        ...common,
                        aiModelConfig,
                    }),
                aiModelConfig
            )
        }

        const rejected = [
            path.join(repoRoot, 'config', 'foo.yaml'),
            path.join(repoRoot, 'tools', 'nested', 'foo.key'),
            path.join(repoRoot, 'tools', 'foo.json'),
            path.join(repoRoot, 'tools', 'api-key.txt'),
            path.join(repoRoot, 'tools', 'api-key.yaml'),
            path.join(repoRoot, 'tools', 'model-config.txt'),
            path.join(repoRoot, 'tools', 'API-KEY.TXT'),
            path.join(repoRoot, '.env.example'),
            path.join(repoRoot, '.ENV'),
            path.join(repoRoot, 'api-key.txt'),
            path.join(repoRoot, 'README.md'),
            path.join(docs, 'model.json'),
            path.join(publicDir, 'model.json'),
        ]
        for (const aiModelConfig of rejected) {
            assert.throws(
                () =>
                    assertPrivateModelConfigPlacement({
                        ...common,
                        aiModelConfig,
                    }),
                /must not be inside a served or publishable path|must be outside the repository|ignored tools/
            )
        }

        const outsideLink = path.join(root, 'outside-link.json')
        const fakeFs = {
            ...DEFAULT_FILE_SYSTEM_OPS,
            realpathSync(value) {
                if (pathKey(value) === pathKey(outsideLink)) {
                    return path.join(publicDir, 'leaked.json')
                }
                return DEFAULT_FILE_SYSTEM_OPS.realpathSync(value)
            },
        }
        assert.throws(
            () =>
                assertPrivateModelConfigPlacement({
                    ...common,
                    aiModelConfig: outsideLink,
                    fs: fakeFs,
                }),
            /must not be inside a served or publishable path/
        )

        const repoLink = path.join(repoRoot, 'tools', 'model-config.yaml')
        const repoLinkFs = {
            ...DEFAULT_FILE_SYSTEM_OPS,
            realpathSync(value) {
                if (pathKey(value) === pathKey(repoLink)) {
                    return path.join(repoRoot, 'config', 'foo.yaml')
                }
                return DEFAULT_FILE_SYSTEM_OPS.realpathSync(value)
            },
        }
        assert.throws(
            () =>
                assertPrivateModelConfigPlacement({
                    ...common,
                    aiModelConfig: repoLink,
                    fs: repoLinkFs,
                }),
            /must be outside the repository|ignored tools/
        )
    } finally {
        await rm(root, { recursive: true, force: true })
    }
})

test('exposes one boolean switch and always disables production builds', async () => {
    assert.deepEqual(parseAiSearchConfig({ enabled: true }), { enabled: true })
    assert.deepEqual(parseAiSearchConfig({ enabled: false }), {
        enabled: false,
    })
    assert.equal(resolveAiSearchEnabled('serve', { enabled: true }), true)
    assert.equal(resolveAiSearchEnabled('serve', { enabled: false }), false)
    assert.equal(resolveAiSearchEnabled('build', { enabled: true }), false)
    assert.equal(resolveAiSearchEnabled('build', { enabled: false }), false)

    assert.equal(DEFAULT_AI_SEARCH_CONFIG.enabled, false)
    assert.equal(MODEL_TIMEOUT_MS, 300_000)
    assert.equal(resolveModelTimeoutMs('12345'), 12_345)
    assert.equal(resolveModelTimeoutMs('not-a-number'), MODEL_TIMEOUT_MS)
    assert.equal(resolveModelTimeoutMs(0), MODEL_TIMEOUT_MS)
    assert.equal(resolveModelTimeoutMs(null), MODEL_TIMEOUT_MS)
    assert.deepEqual(
        readAiSearchConfig(path.join(docsRoot, 'missing-config.json')),
        DEFAULT_AI_SEARCH_CONFIG
    )
    assert.equal(
        typeof readAiSearchConfig(AI_SEARCH_CONFIG_PATH).enabled,
        'boolean'
    )

    for (const invalid of [
        null,
        [],
        'true',
        { enabled: 'true' },
        { enabled: true, apiKey: 'sk-test-secret' },
        { enabled: true, baseUrl: 'https://example.invalid' },
    ]) {
        assert.throws(
            () => parseAiSearchConfig(invalid),
            (error) => {
                assert.doesNotMatch(
                    error.message,
                    /sk-test-secret|example\.invalid|apiKey|baseUrl/
                )
                return true
            }
        )
    }

    const configDir = await mkdtemp(
        path.join(tmpdir(), 'ai-search-config-')
    )
    try {
        const invalidFile = path.join(configDir, 'invalid.json')
        await writeFile(
            invalidFile,
            '{"enabled":true,"apiKey":"sk-config-secret"}',
            'utf8'
        )
        assert.throws(
            () => readAiSearchConfig(invalidFile),
            (error) => {
                assert.doesNotMatch(error.message, /sk-config-secret/)
                return true
            }
        )
    } finally {
        await rm(configDir, { recursive: true, force: true })
    }
})

test('production public define is disabled and carries no private sentinels', async () => {
    const { resolveUserConfig } = await import('vitepress')
    const docsDirectory = path.resolve(
        fileURLToPath(new URL('../docs/', import.meta.url))
    )
    const tempDir = await mkdtemp(
        path.join(tmpdir(), 'ai-public-define-')
    )
    const fakeConfig = path.join(tempDir, 'model.json')
    await writeFile(
        fakeConfig,
        JSON.stringify({
            apiKey: 'FAKE_KEY_SENTINEL',
            baseUrl: 'FAKE_ENDPOINT_SENTINEL',
        }),
        'utf8'
    )

    const previousConfig = process.env.AI_MODEL_CONFIG
    try {
        process.env.AI_MODEL_CONFIG = fakeConfig
        const [config] = await resolveUserConfig(
            docsDirectory,
            'build',
            'production'
        )
        const plugins = (config.vite?.plugins ?? []).flat(Infinity)
        const plugin = plugins.find((entry) => entry?.name === 'ai-search')
        assert.ok(plugin)
        assert.equal(typeof plugin.config, 'function')

        const partial = await plugin.config(
            {},
            { command: 'build', mode: 'production' }
        )
        assert.deepEqual(partial.define, {
            __AI_SEARCH_ENABLED__: 'false',
        })
        assert.equal(Object.keys(partial.define).length, 1)

        const publicDefine = JSON.stringify(partial)
        assert.doesNotMatch(
            publicDefine,
            /FAKE_KEY_SENTINEL|FAKE_ENDPOINT_SENTINEL|AI_MODEL_CONFIG/
        )
        assert.doesNotMatch(publicDefine, /provider|baseUrl|apiKey/i)
    } finally {
        if (previousConfig === undefined) {
            delete process.env.AI_MODEL_CONFIG
        } else {
            process.env.AI_MODEL_CONFIG = previousConfig
        }
        await rm(tempDir, { recursive: true, force: true })
    }
})

test('enforces the configured model timeout and reports it without details', async () => {
    let calls = 0
    const requestModel = ({ signal }) => {
        calls += 1
        return new Promise((resolve, reject) => {
            const abort = () => {
                reject(
                    Object.assign(new Error('aborted'), {
                        code: 'ABORT_ERR',
                    })
                )
            }
            if (signal.aborted) {
                abort()
                return
            }
            signal.addEventListener('abort', abort, { once: true })
        })
    }

    const service = createService({ requestModel, timeoutMs: 20 })
    assert.equal(service.timeoutMs, 20)

    const direct = await service.search('pendulum period', 'en')
    assert.equal(direct.status, 'timeout')
    assert.deepEqual(direct.sources, [])
    assert.equal(calls, 1)

    const response = await callService(service, {
        body: queryBody('pendulum period', 'en'),
    })
    assert.equal(response.status, 504)
    assert.equal(response.json.ok, false)
    assert.equal(response.json.code, 'timeout')
    assert.equal(calls, 2)
    assert.doesNotMatch(
        response.rawBody,
        /sk-|example\.invalid|private|provider|config/i
    )

    const adapterTimeout = createService({
        requestModel: async () => {
            throw Object.assign(
                new Error('provider https://example.invalid sk-leak'),
                { code: 'MODEL_TIMEOUT' }
            )
        },
    })
    const adapterResponse = await callService(adapterTimeout, {
        body: queryBody('pendulum period', 'en'),
    })
    assert.equal(adapterResponse.status, 504)
    assert.equal(adapterResponse.json.code, 'timeout')
    assert.doesNotMatch(
        adapterResponse.rawBody,
        /sk-leak|example\.invalid|provider/
    )
})

test('production config compiles the client switch to false', async () => {
    const { resolveUserConfig } = await import('vitepress')
    const docsDirectory = path.resolve(
        fileURLToPath(new URL('../docs/', import.meta.url))
    )
    const [config, configPath] = await resolveUserConfig(
        docsDirectory,
        'build',
        'production'
    )
    assert.ok(configPath && configPath.endsWith('config.mts'))
    assert.deepEqual(config.vite?.server?.fs?.allow, [
        docsDirectory,
        path.join(docsDirectory, 'public'),
        path.join(docsDirectory, '..', 'node_modules'),
    ])
    assert.equal(config.vite?.server?.fs?.strict, true)
    assert.equal(config.vite?.server?.fs?.deny, undefined)
    assert.ok(
        !config.vite.server.fs.allow.some((entry) =>
            /[\\/](?:tools|README)/u.test(entry)
        )
    )
    const plugins = (config.vite?.plugins ?? []).flat(Infinity)
    const plugin = plugins.find((entry) => entry?.name === 'ai-search')
    assert.ok(plugin)
    assert.equal(typeof plugin.config, 'function')
    assert.equal(typeof plugin.buildStart, 'function')

    const previousConfig = process.env.AI_MODEL_CONFIG
    try {
        process.env.AI_MODEL_CONFIG = path.join(
            docsDirectory,
            'public',
            'private-model.json'
        )
        assert.throws(
            () => plugin.buildStart(),
            /must not be inside a served or publishable path/
        )
    } finally {
        if (previousConfig === undefined) {
            delete process.env.AI_MODEL_CONFIG
        } else {
            process.env.AI_MODEL_CONFIG = previousConfig
        }
    }

    const partial = await plugin.config(
        {},
        { command: 'build', mode: 'production' }
    )
    assert.deepEqual(partial.define, {
        __AI_SEARCH_ENABLED__: 'false',
    })
})

test('uses the expected tokenizer for English and Chinese', () => {
    assert.deepEqual(tokenize('What is the pendulum period?'), [
        'pendulum',
        'period',
    ])
    assert.deepEqual(tokenize('单摆 周期'), ['单摆', '周期'])
    assert.deepEqual(tokenize('the of and'), [])
})
