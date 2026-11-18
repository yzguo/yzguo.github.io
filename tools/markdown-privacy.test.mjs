import assert from 'node:assert/strict'
import test from 'node:test'
import { parse } from 'yaml'
import {
  PrivacyError,
  findPrivateContent,
  sanitizeMarkdownForModel,
  splitMarkdownDocument
} from './markdown-privacy.mjs'
import { assertNoPrivateContent } from './markdown-privacy.mjs'

function capturedError(callback) {
  try {
    callback()
  } catch (error) {
    return error
  }
  assert.fail('Expected PrivacyError')
}

function frontmatterOf(source) {
  const document = splitMarkdownDocument(source)
  assert.notEqual(document.frontmatter, null)
  return document.frontmatter
}

test('HTML comments and private blocks never reach the model', () => {
  const source = [
    '# Public',
    '',
    'Visible text <!-- private inline note --> stays.',
    '',
    '<!-- private:start -->',
    'SECRET BODY',
    '<!-- private:end -->',
    '',
    'After.'
  ].join('\n')
  const sanitized = sanitizeMarkdownForModel(source)
  assert.doesNotMatch(sanitized, /private inline note|SECRET BODY|private:start|private:end/)
  assert.match(sanitized, /Visible text  stays\./)
  assert.match(sanitized, /# Public/)
  assert.match(sanitized, /After\./)
})

test('comments in fenced code and inline code are data, not private comments', () => {
  const source = [
    '```html',
    '<!-- example -->',
    '```',
    '',
    'Use `<!-- example -->` in HTML.'
  ].join('\n')
  const sanitized = sanitizeMarkdownForModel(source)
  assert.match(sanitized, /<!-- example -->/)
  assert.equal(sanitized, source)
})

test('private markers inside fenced code do not open a private region', () => {
  const source = [
    '```',
    '<!-- private:start -->',
    'example',
    '```',
    '',
    'Public.'
  ].join('\n')
  assert.equal(sanitizeMarkdownForModel(source), source)
})

test('checker mode removes comments from code examples before sending', () => {
  const source = ['```html', '<!-- private example -->', '```'].join('\n')
  const sanitized = sanitizeMarkdownForModel(source, { stripAllComments: true })
  assert.doesNotMatch(sanitized, /private example/)
  assert.match(sanitized, /```html/)
})

test('frontmatter comments and private keys are removed', () => {
  const source = [
    '---',
    'title: 首页',
    '# private note',
    'link: "../x#fragment"',
    'token: super-secret',
    'private_data:',
    '  - hidden',
    'secret: "hidden"',
    'nested:',
    '  secret: hidden-too',
    '  keep: 保留',
    'url: "https://example.com/#fragment"',
    '---',
    '# 正文'
  ].join('\n')
  const sanitized = sanitizeMarkdownForModel(source)
  assert.doesNotMatch(sanitized, /private note|super-secret|hidden|hidden-too/)
  assert.match(sanitized, /title: 首页/)
  assert.match(sanitized, /url: "https:\/\/example\.com\/#fragment"/)
  assert.match(sanitized, /keep: 保留/)
  assert.match(sanitized, /# 正文/)
})

test('unclosed comments and private blocks fail closed', () => {
  assert.throws(
    () => sanitizeMarkdownForModel('# 标题\n<!-- note'),
    PrivacyError
  )
  assert.throws(
    () => sanitizeMarkdownForModel('# 标题\n<!-- private:start -->\n秘密'),
    /Unclosed private block/
  )
  assert.throws(
    () => sanitizeMarkdownForModel('<!-- private:end -->'),
    /without a start marker/
  )
  assert.throws(
    () => sanitizeMarkdownForModel('<!-- private:start -->a<!-- private:start -->b<!-- private:end -->'),
    /Nested private block/
  )
})

test('generated output is rejected if it contains comments or private keys', () => {
  assert.throws(
    () => assertNoPrivateContent('# English\n\n<!-- note -->'),
    /HTML comment in body/
  )
  assert.throws(
    () => assertNoPrivateContent('---\ntoken: abc\n---\n# English'),
    /private frontmatter key "token"/
  )
  assert.deepEqual(findPrivateContent('# English\n\n```\n<!-- code -->\n```\n'), [])
})

test('private regions in frontmatter are removed with their contents', () => {
  const source = [
    '---',
    'title: 标题',
    '<!-- private:start -->',
    'token: should-not-leak',
    '<!-- private:end -->',
    'link: /zh-cn/Notes/',
    '---',
    '# 正文'
  ].join('\n')
  const sanitized = sanitizeMarkdownForModel(source)
  assert.doesNotMatch(sanitized, /should-not-leak|private:start|private:end/)
  assert.match(sanitized, /title: 标题/)
  assert.match(sanitized, /link: \/zh-cn\/Notes\//)
})

test('splitMarkdownDocument preserves delimiters and body', () => {
  const source = '---\ntitle: 标题\n---\n\n# 正文\n'
  const document = splitMarkdownDocument(source)
  assert.equal(document.frontmatter, 'title: 标题\n')
  assert.equal(document.opening, '---\n')
  assert.equal(document.closing, '---\n')
  assert.equal(document.body, '\n# 正文\n')
})

test('unterminated frontmatter fails closed before model input', () => {
  const sources = [
    '---\nprivate: true\n\nbody-marker',
    '---\ntitle: 标题\n\n# 正文',
    '\uFEFF---\r\ndraft: true\r\n\r\nbody-marker'
  ]

  for (const source of sources) {
    assert.throws(() => splitMarkdownDocument(source), PrivacyError)
    const error = capturedError(() => sanitizeMarkdownForModel(source))
    assert.ok(error instanceof PrivacyError)
    assert.match(error.message, /Unclosed frontmatter/)
    assert.doesNotMatch(error.message, /body-marker|标题|draft|private/)
    assert.throws(() => findPrivateContent(source), PrivacyError)
    assert.throws(() => assertNoPrivateContent(source), PrivacyError)
  }
})

test('quoted, escaped, and nested frontmatter keys are removed recursively', () => {
  const source = [
    '---',
    'title: 正常',
    '"secret": quoted-secret',
    "'token': single-secret",
    '"priv\\u0061te_data": escaped-secret',
    '"nested":',
    "  'password': nested-secret",
    '  keep: 保留',
    '---',
    '# 正文'
  ].join('\n')
  const sanitized = sanitizeMarkdownForModel(source)
  assert.doesNotMatch(sanitized, /quoted-secret|single-secret|escaped-secret|nested-secret/)
  assert.deepEqual(parse(frontmatterOf(sanitized)), {
    title: '正常',
    nested: { keep: '保留' }
  })
  assert.match(sanitized, /# 正文/)

  const issues = findPrivateContent(source)
  assert.ok(issues.some((issue) => issue.includes('private frontmatter key "secret"')))
  assert.ok(issues.some((issue) => issue.includes('private frontmatter key "token"')))
  assert.ok(issues.some((issue) => issue.includes('private frontmatter key "private_data"')))
  assert.ok(issues.some((issue) => issue.includes('private frontmatter key "password"')))
  assert.ok(issues.every((issue) => !/quoted-secret|single-secret|escaped-secret|nested-secret/.test(issue)))
})

test('flow mappings and sequences are scrubbed recursively', () => {
  const source = [
    '---',
    'meta: {secret: flow-secret, keep: yes, nested: {token: "flow-token", public: [1, {password: flow-password, safe: ok}]}}',
    'items: [{private: true, label: 公开}, {normal: value}]',
    '---',
    '# 正文'
  ].join('\n')
  const sanitized = sanitizeMarkdownForModel(source)
  assert.doesNotMatch(sanitized, /flow-secret|flow-token|flow-password/)
  assert.deepEqual(parse(frontmatterOf(sanitized)), {
    meta: { keep: 'yes', nested: { public: [1, { safe: 'ok' }] } },
    items: [{ label: '公开' }, { normal: 'value' }]
  })

  const issues = findPrivateContent(source)
  assert.ok(issues.some((issue) => issue.includes('private frontmatter key "secret"')))
  assert.ok(issues.some((issue) => issue.includes('private frontmatter key "token"')))
  assert.ok(issues.some((issue) => issue.includes('private frontmatter key "password"')))
  assert.ok(issues.some((issue) => issue.includes('private frontmatter key "private"')))
  assert.ok(issues.every((issue) => !/flow-secret|flow-token|flow-password/.test(issue)))
})

test('block scalars, multiline values, and CRLF frontmatter are handled safely', () => {
  const source = [
    '---',
    'secret: |',
    '  block-secret-one',
    '  block-secret-two',
    'token: >-',
    '  folded-secret',
    'deep:',
    '  password: "multi',
    '    line-secret"',
    '  keep: 保留',
    'public: |',
    '  # not a comment',
    '  keep: literal text',
    '---',
    '# 正文'
  ].join('\n')
  const sanitized = sanitizeMarkdownForModel(source)
  assert.doesNotMatch(sanitized, /block-secret|folded-secret|line-secret/)
  assert.match(sanitized, /# not a comment/)
  assert.match(sanitized, /keep: literal text/)
  assert.deepEqual(parse(frontmatterOf(sanitized)), {
    deep: { keep: '保留' },
    public: '# not a comment\nkeep: literal text\n'
  })
  assert.ok(findPrivateContent(source).every((issue) => !/block-secret|folded-secret|line-secret/.test(issue)))

  const crlf = [
    '---',
    'title: 标题',
    'secret: hidden-crlf',
    'keep: 保留',
    '---',
    '# 正文',
    ''
  ].join('\r\n')
  const sanitizedCrlf = sanitizeMarkdownForModel(crlf)
  assert.doesNotMatch(sanitizedCrlf, /hidden-crlf/)
  assert.match(sanitizedCrlf, /title: 标题\r\n/)
  assert.match(sanitizedCrlf, /keep: 保留\r\n/)
  assert.match(sanitizedCrlf, /# 正文/)
})

test('documents marked private or draft fail closed before model input', () => {
  for (const flags of [
    'private: true',
    '"private": true',
    "'private': true",
    'private : true',
    'draft: true',
    '"draft": true',
    'draft: !!bool true',
    '"draft": !!bool true',
    'private: !!bool true',
    'private: "yes"',
    'private: 1'
  ]) {
    const source = `---\n${flags}\n---\n# 正文\n\nbody-marker`
    const error = capturedError(() => sanitizeMarkdownForModel(source))
    assert.ok(error instanceof PrivacyError)
    assert.match(error.message, /non-public document flag/)
    assert.doesNotMatch(error.message, /body-marker/)
  }

  for (const flags of [
    'private: 2',
    'private: -1',
    'private: 0.5',
    'private:',
    'private: [hidden]',
    'private: {data: hidden}',
    'private: "plain"',
    '"private": 2',
    'PRIVATE: 2'
  ]) {
    const source = `---\n${flags}\n---\n# 正文\n\nbody-marker`
    const error = capturedError(() => sanitizeMarkdownForModel(source))
    assert.ok(error instanceof PrivacyError)
    assert.match(error.message, /unsupported private flag/)
    assert.doesNotMatch(error.message, /body-marker|hidden|plain/)
    const issues = findPrivateContent(source)
    assert.ok(issues.some((issue) => issue.includes('unsupported private flag')))
    assert.ok(issues.every((issue) => !/body-marker|hidden|plain/.test(issue)))
  }

  const privateFalse = '---\nprivate: false\n---\n# 正文'
  const sanitizedPrivateFalse = sanitizeMarkdownForModel(privateFalse)
  assert.match(sanitizedPrivateFalse, /# 正文/)
  assert.doesNotMatch(sanitizedPrivateFalse, /private/)
  const privateFalseIssues = findPrivateContent(privateFalse)
  assert.ok(privateFalseIssues.some((issue) => issue.includes('private frontmatter key "private"')))
  assert.ok(privateFalseIssues.every((issue) => !issue.includes('non-public document flag')))

  const draftFalse = '---\ndraft: false\n---\n# 正文'
  assert.match(sanitizeMarkdownForModel(draftFalse), /draft: false/)
  assert.deepEqual(findPrivateContent(draftFalse), [])

  const searchFalse = '---\nsearch: false\n---\n# 正文'
  assert.match(sanitizeMarkdownForModel(searchFalse), /search: false/)
  assert.deepEqual(findPrivateContent(searchFalse), [])

  const ambiguousDraft = '---\ndraft: "draft-value-marker"\n---\n# 正文'
  const ambiguousError = capturedError(() => sanitizeMarkdownForModel(ambiguousDraft))
  assert.match(ambiguousError.message, /unsupported draft flag/)
  assert.doesNotMatch(ambiguousError.message, /draft-value-marker/)
  assert.ok(
    findPrivateContent(ambiguousDraft).some((issue) => issue.includes('unsupported draft flag'))
  )
})

test('anchors, aliases, and merge keys fail closed without leaking values', () => {
  const anchored = [
    '---',
    'base: &base {secret: anchor-secret, keep: y}',
    'copy: *base',
    '---',
    '# 正文'
  ].join('\n')
  const merged = [
    '---',
    'base: &base {secret: merge-secret, keep: y}',
    'meta:',
    '  <<: *base',
    '  public: z',
    '---',
    '# 正文'
  ].join('\n')
  const inlineMerge = [
    '---',
    'meta:',
    '  <<: {secret: inline-secret, keep: y}',
    '  public: z',
    '---',
    '# 正文'
  ].join('\n')

  for (const source of [anchored, merged, inlineMerge]) {
    const error = capturedError(() => sanitizeMarkdownForModel(source))
    assert.ok(error instanceof PrivacyError)
    assert.doesNotMatch(error.message, /anchor-secret|merge-secret|inline-secret/)
    const issues = findPrivateContent(source)
    assert.ok(issues.length > 0)
    assert.ok(issues.every((issue) => !/anchor-secret|merge-secret|inline-secret/.test(issue)))
  }

  assert.match(findPrivateContent(anchored).join(' '), /YAML anchor|YAML alias/)
  assert.match(findPrivateContent(inlineMerge).join(' '), /YAML merge key/)
})

test('malformed YAML, unknown tags, duplicate keys, and directives fail closed', () => {
  const cases = [
    ['title: "unterminated malformed-secret', /invalid YAML/],
    ['title: a\n  bad: malformed-secret', /invalid YAML/],
    ['custom: !unknown unknown-secret', /unsupported YAML feature/],
    ['title: a\ntitle: b', /invalid YAML/],
    ['%TAG !e! tag:example.com,2000:\ntitle: x', /invalid YAML|YAML directives/]
  ]

  for (const [frontmatter, expected] of cases) {
    const source = `---\n${frontmatter}\n---\n# 正文`
    const error = capturedError(() => sanitizeMarkdownForModel(source))
    assert.ok(error instanceof PrivacyError)
    assert.match(error.message, expected)
    assert.doesNotMatch(error.message, /malformed-secret|unknown-secret/)
    const issues = findPrivateContent(source)
    assert.ok(issues.length > 0)
    assert.ok(issues.every((issue) => !/malformed-secret|unknown-secret/.test(issue)))
  }
})

test('non-private HTML comments in frontmatter are still removed and checked', () => {
  const source = [
    '---',
    'title: x',
    '<!-- note with html-secret -->',
    'keep: y',
    '---',
    '# 正文'
  ].join('\n')
  const sanitized = sanitizeMarkdownForModel(source)
  assert.doesNotMatch(sanitized, /html-secret|<!--/)
  assert.match(sanitized, /title: x/)
  assert.match(sanitized, /keep: y/)
  const issues = findPrivateContent(source)
  assert.ok(issues.some((issue) => issue.includes('HTML comment in frontmatter')))
  assert.ok(issues.every((issue) => !issue.includes('html-secret')))
})

test('generated output is checked recursively for quoted, flow, comment, and flag content', () => {
  const cases = [
    [
      '---\nmeta: {"token": generated-secret, keep: y}\n---\n# English',
      /private frontmatter key "token"/
    ],
    [
      '---\ntitle: English # generated-comment\n---\n# English',
      /YAML comment in frontmatter/
    ],
    [
      '---\n<!-- generated-html -->\ntitle: English\n---\n# English',
      /HTML comment in frontmatter/
    ],
    ['---\n"private": true\n---\n# English', /non-public document flag "private"/],
    ['---\ndraft: !!bool true\n---\n# English', /non-public document flag "draft"/],
    [
      '---\nbase: &base {secret: generated-anchor}\n---\n# English',
      /YAML anchor/
    ]
  ]

  for (const [source, expected] of cases) {
    const error = capturedError(() => assertNoPrivateContent(source))
    assert.ok(error instanceof PrivacyError)
    assert.match(error.message, expected)
    assert.doesNotMatch(
      error.message,
      /generated-secret|generated-comment|generated-html|generated-anchor/
    )
  }

  assert.deepEqual(findPrivateContent('---\ntitle: English\n---\n# body\n'), [])
  assert.deepEqual(
    findPrivateContent('---\ndescription: |\n  # literal hash\n  text\n---\n'),
    []
  )
  assert.deepEqual(findPrivateContent('---\nsearch: false\n---\n'), [])
  assert.deepEqual(findPrivateContent('---\ndraft: false\n---\n'), [])
})

test('valid public frontmatter keeps its parsed structure', () => {
  const source = [
    '---',
    'layout: home',
    'hero:',
    '  name: "郭彦禛"',
    '  text: 个人网站',
    '  image:',
    '    src: /images/pic.png',
    '    alt: 郭彦禛的头像',
    '  actions:',
    '    - theme: brand',
    '      text: 笔记',
    '      link: /zh-cn/Notes/',
    'features:',
    '  - title: 项目',
    '    details: 说明',
    '    link: /zh-cn/Projects/',
    '---',
    '# 正文',
    ''
  ].join('\n')
  const sanitized = sanitizeMarkdownForModel(source)
  assert.deepEqual(parse(frontmatterOf(sanitized)), parse(frontmatterOf(source)))
  assert.match(sanitized, /# 正文/)
  assert.deepEqual(findPrivateContent(source), [])
})
