import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'

import {
    AI_SEARCH_PATH,
    MAX_BODY_BYTES,
    MODEL_TIMEOUT_MS,
    buildDocsIndex,
    createAiSearchService,
    parseAllowedHost,
    parseMarkdownPage,
    sanitizeSourcePath,
    searchDocs,
    stripScriptStyleBlocks,
    tokenize,
} from './ai-search.mjs'

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
    const service = createAiSearchService({
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
    const service = createAiSearchService({
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
    const service = createAiSearchService({
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
    const service = createAiSearchService({
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
    const emptyService = createAiSearchService({
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
    const service = createAiSearchService({
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

    const service = createAiSearchService({
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

    const service = createAiSearchService({
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
    const service = createAiSearchService({
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
    const service = createAiSearchService({
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
    const service = createAiSearchService({
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

    for (const pathname of ['/', '/About/', '/zh-cn/Blogs/demo', '/a%20b']) {
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

test('uses the expected tokenizer for English and Chinese', () => {
    assert.deepEqual(tokenize('What is the pendulum period?'), [
        'pendulum',
        'period',
    ])
    assert.deepEqual(tokenize('单摆 周期'), ['单摆', '周期'])
    assert.deepEqual(tokenize('the of and'), [])
})
