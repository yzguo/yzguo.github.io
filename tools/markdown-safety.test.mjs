import assert from 'node:assert/strict'
import test from 'node:test'
import { parse } from 'yaml'
import {
  PrivacyError,
  assertNoPrivateContent,
  assertSafeGeneratedMarkup,
  collectLocaleLinkTargets,
  findPrivateContent,
  isAssetTarget,
  localeLinkIssues,
  localeTargetIssue,
  maskMarkdown,
  restoreMaskedMarkdown,
  sanitizeMarkdownForModel,
  splitMarkdownDocument,
  unwrapMarkdownFence
} from './markdown-safety.mjs'

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

const prefix = 'TESTTOKEN'

test('masking preserves syntax while leaving visible prose translatable', () => {
  const body = [
    '# 标题',
    '',
    '文字 `行内代码` 和公式 $a+b$ 以及 ![图片](/zh-cn/images/pic.png)。',
    '',
    '```mermaid',
    'flowchart TD',
    '  A[中文] --> B[结束]',
    '```',
    '',
    '链接 [博客](/zh-cn/Notes/) 与 <a href="/zh-cn/About/">关于</a>。',
    '',
    '[ref]: /zh-cn/Projects/ "项目"'
  ].join('\n')

  const masked = maskMarkdown(body, { tokenPrefix: prefix })
  assert.match(masked.text, /# 标题/)
  assert.match(masked.text, /文字 @@TESTTOKEN_\d+@@ 和公式/)
  assert.doesNotMatch(masked.text, /行内代码|a\+b|中文\]|\/zh-cn|flowchart/)
  assert.equal(masked.tokens.length, 8)
  assert.ok(masked.tokens.every((entry) => entry.token.includes(prefix)))

  const translated = masked.text
    .replace('# 标题', '# Title')
    .replace('文字 ', 'Text ')
    .replace('和公式', 'and formula')
    .replace('链接 ', 'Links ')
    .replace('与 ', 'and ')
    .replace('关于', 'About')
    .replace('。', '.')
  const restored = restoreMaskedMarkdown(translated, masked.tokens)
  assert.match(restored, /`行内代码`/)
  assert.match(restored, /\$a\+b\$/)
  assert.match(restored, /!\[图片\]\(\/images\/pic\.png\)/)
  assert.match(restored, /\[博客\]\(\/en\/Notes\/\)/)
  assert.match(restored, /<a href="\/en\/About\/">About<\/a>/)
  assert.match(restored, /```mermaid\nflowchart TD\n  A\[中文\] --> B\[结束\]\n```/)
  assert.match(restored, /\[ref\]: \/en\/Projects\/ "项目"/)
})

test('masking can target Traditional, canonical, or raw destinations', () => {
  const source = '[博客](/zh-cn/Notes/) 与 <a href="/zh-cn/About/">关于</a>'

  const traditional = maskMarkdown(source, { tokenPrefix: prefix, targetLocale: 'zh-tw' })
  assert.ok(traditional.tokens.some((entry) => entry.value === '(/zh-tw/Notes/)'))
  assert.ok(traditional.tokens.some((entry) => entry.value === '<a href="/zh-tw/About/">'))

  const canonical = maskMarkdown(source, { tokenPrefix: prefix, targetLocale: 'canonical' })
  assert.ok(canonical.tokens.some((entry) => entry.value === '(/Notes/)'))
  assert.ok(canonical.tokens.some((entry) => entry.value === '<a href="/About/">'))

  const preserved = maskMarkdown(source, { tokenPrefix: prefix, targetLocale: null })
  assert.ok(preserved.tokens.some((entry) => entry.value === '(/zh-cn/Notes/)'))
  assert.ok(preserved.tokens.some((entry) => entry.value === '<a href="/zh-cn/About/">'))
})

test('whole-link targets are localized without rewriting labels', () => {
  const masked = maskMarkdown('[`代码`](/zh-cn/Notes/)', {
    tokenPrefix: prefix,
    targetLocale: 'zh-tw'
  })
  assert.equal(masked.tokens[0].kind, 'link-whole')
  assert.match(masked.tokens[0].value, /\]\(\/zh-tw\/Notes\/\)$/)
  assert.doesNotMatch(masked.tokens[0].value, /\/zh-cn\//)
})

test('placeholders must appear exactly once and in order', () => {
  const masked = maskMarkdown('A `one` B `two`', { tokenPrefix: prefix })
  const [first, second] = masked.tokens
  assert.throws(
    () => restoreMaskedMarkdown(`A ${first.token} B`, masked.tokens),
    /dropped/
  )
  assert.throws(
    () => restoreMaskedMarkdown(`A ${first.token} ${first.token} B ${second.token}`, masked.tokens),
    /duplicated/
  )
  assert.throws(
    () => restoreMaskedMarkdown(`B ${second.token} A ${first.token}`, masked.tokens),
    /reordered/
  )
})

test('a bare URL as a link label keeps its closing bracket', () => {
  const body = '[https://example.com/label](https://example.com/target)'
  const masked = maskMarkdown(body, {
    tokenPrefix: prefix,
    protectBareUrls: true,
    targetLocale: 'zh-tw'
  })
  assert.match(masked.text, /^\[@@[A-Za-z0-9_]+@@\]@@TESTTOKEN_\d+@@$/)
  assert.equal(restoreMaskedMarkdown(masked.text, masked.tokens), body)
  assert.throws(
    () => restoreMaskedMarkdown(masked.text.replace(']@@', '@@'), masked.tokens),
    /broke the Markdown link syntax/
  )
})

test('a model that separates a link target from its label fails', () => {
  const masked = maskMarkdown('[链接](/zh-cn/x)', { tokenPrefix: prefix })
  const broken = masked.text.replace(']', '] ')
  assert.throws(
    () => restoreMaskedMarkdown(broken, masked.tokens),
    /broke the Markdown link syntax/
  )
})

test('unbalanced or unsupported constructs fail rather than leaking markup', () => {
  const masked = maskMarkdown('Text [link](/zh-cn/x) and `code', { tokenPrefix: prefix })
  assert.equal(masked.tokens.length, 1)
  assert.match(masked.text, /`code/)
})

test('a wrapping Markdown fence is removed once', () => {
  assert.equal(unwrapMarkdownFence('```markdown\n# Title\n```'), '# Title')
  assert.equal(unwrapMarkdownFence('~~~\n# Title\n~~~'), '# Title')
  assert.equal(unwrapMarkdownFence('# Title'), '# Title')
  assert.equal(unwrapMarkdownFence('```\n# Title\n```\ntrailing'), '```\n# Title\n```\ntrailing')
})

test('localized original links and tags remain allowed in every locale', async (t) => {
  await assert.doesNotReject(() => assertSafeGeneratedMarkup(
    '# 标题\n\n[链接](/zh-cn/A) <a href="/zh-cn/A">A</a>',
    '# Title\n\n[Link](/en/A) <a href="/en/A">A</a>',
    'page'
  ))
  await assert.doesNotReject(() => assertSafeGeneratedMarkup(
    '# 标题\n\n[链接](/zh-cn/A) <a href="/zh-cn/A">A</a>',
    '# 標題\n\n[連結](/zh-tw/A) <a href="/zh-tw/A">A</a>',
    'page'
  ))
  await assert.doesNotReject(() =>
    assertSafeGeneratedMarkup('Text <br/> end.', 'Text <br/> end.', 'page')
  )
})

test('new links, bare URLs, and rewritten targets are rejected', async () => {
  await assert.rejects(
    () => assertSafeGeneratedMarkup('[a](/A)', '[a](/A) [new](https://evil.example)', 'page'),
    /新增或改写的链接目标/
  )
  await assert.rejects(
    () => assertSafeGeneratedMarkup('Plain.', 'Added https://evil.example', 'page'),
    /新增或改写的链接目标/
  )
  await assert.rejects(
    () => assertSafeGeneratedMarkup('[a](/A)', '[a](/B)', 'page'),
    /新增或改写的链接目标/
  )
})

test('unsafe URL protocols are rejected even when entity-encoded', async () => {
  for (const url of [
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    'java&#115;cript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox(1)',
    'file:///etc/passwd'
  ]) {
    await assert.rejects(
      () => assertSafeGeneratedMarkup('Plain.', `[x](${url})`, 'page'),
      /不安全的 URL 协议/
    )
  }
})

test('new HTML tags, event attributes, and dangerous tags are rejected', async () => {
  await assert.rejects(
    () => assertSafeGeneratedMarkup('Plain.', 'Plain <span>new</span>', 'page'),
    /新增的 HTML 标签/
  )
  await assert.rejects(
    () => assertSafeGeneratedMarkup('Plain.', 'Plain <img src="/A" onerror="alert(1)">', 'page'),
    /事件属性|新增的 HTML 标签/
  )
  await assert.rejects(
    () => assertSafeGeneratedMarkup('Plain.', 'Plain <script>alert(1)</script>', 'page'),
    /不安全的 HTML 标签/
  )
  await assert.rejects(
    () => assertSafeGeneratedMarkup('Plain.', 'Plain <a href="javascript:alert(1)">x</a>', 'page'),
    /不安全的 URL 协议|新增的 HTML 标签/
  )
})

test('code fences and inline code are not mistaken for active markup', async () => {
  const source = 'Before.\n\n```html\n<script>alert(1)</script>\n```\n\nUse `<img onerror=x>`.'
  const generated = 'Before.\n\n```html\n<script>alert(1)</script>\n```\n\nUse `<img onerror=x>`.'
  await assert.doesNotReject(() => assertSafeGeneratedMarkup(source, generated, 'page'))
})

test('new Vue interpolation and template directives are rejected', async () => {
  await assert.rejects(
    () => assertSafeGeneratedMarkup('Plain.', 'Plain {{ constructor.constructor("alert(1)")() }}', 'page'),
    /Vue 插值/
  )
  await assert.rejects(
    () => assertSafeGeneratedMarkup('Safe.', 'Safe <div v-html="payload">x</div>', 'page'),
    /模板指令|新增的 HTML 标签/
  )
  await assert.rejects(
    () => assertSafeGeneratedMarkup('Safe.', 'Safe <a :href="payload">x</a>', 'page'),
    /模板指令|新增的 HTML 标签/
  )
  await assert.rejects(
    () => assertSafeGeneratedMarkup('Safe.', 'Safe <button @click="payload">x</button>', 'page'),
    /模板指令|新增的 HTML 标签/
  )
})

test('a pseudo fence in a real paragraph cannot hide following active HTML', async () => {
  const source = [
    'Paragraph text.',
    '',
    '    ```',
    '    this is indented code, not a fence',
    '',
    'Safe visible text.',
    ''
  ].join('\n')
  const generated = `${source}<img src=x onerror=alert(1)>\n`
  await assert.rejects(
    () => assertSafeGeneratedMarkup(source, generated, 'page'),
    /事件属性|新增的 HTML 标签/
  )
})

test('Vue interpolation in frontmatter is also treated as active content', async () => {
  const source = '---\ntitle: Safe\n---\n\nPlain.\n'
  const generated = '---\ntitle: "{{ alert(1) }}"\n---\n\nPlain.\n'
  await assert.rejects(
    () => assertSafeGeneratedMarkup(source, generated, 'page'),
    /Vue 插值/
  )
})

test('original code and formulas may contain HTML/interpolation unchanged', async () => {
  const source = [
    'Before.',
    '',
    '```html',
    '<script>{{ payload }}</script>',
    '```',
    '',
    'Formula $a < b$ and `{{ x }}` stay code.'
  ].join('\n')
  await assert.doesNotReject(() => assertSafeGeneratedMarkup(source, source, 'page'))
})

test('new inline code containing Vue interpolation is rejected', async () => {
  await assert.rejects(
    () => assertSafeGeneratedMarkup('Plain `safe`.', 'Plain `{{ alert(1) }}`.', 'page'),
    /代码\/公式 token|代码/
  )
  await assert.rejects(
    () => assertSafeGeneratedMarkup('Plain.', 'Plain `{{ alert(1) }}`.', 'page'),
    /代码\/公式 token|代码/
  )
})

test('parser uncertainty fails closed', async () => {
  const md = {
    parse() {
      throw new Error('synthetic parser failure')
    }
  }
  await assert.rejects(
    () => assertSafeGeneratedMarkup('Safe.', 'Changed.', 'page', { md }),
    /Markdown 安全解析失败/
  )
})

test('Mermaid label values are checked as active label text', async () => {
  await assert.doesNotReject(() =>
    assertSafeGeneratedMarkup('小角度', 'Small angle', 'Mermaid 标签')
  )
  await assert.rejects(
    () => assertSafeGeneratedMarkup('小角度', '<img onerror=x>', 'Mermaid 标签'),
    /事件属性|新增的 HTML 标签/
  )
  await assert.rejects(
    () => assertSafeGeneratedMarkup('小角度', '[x](javascript:alert(1))', 'Mermaid 标签'),
    /不安全的 URL 协议/
  )
})

test('collects Markdown, reference, HTML, and frontmatter destinations', () => {
  const text = [
    '---',
    'hero:',
    '  actions:',
    '    - link: /zh-cn/About/',
    'image:',
    '  src: /images/pic.png',
    '---',
    '',
    '[笔记](/zh-cn/Notes/) 与 ![图](/images/pic.png)',
    '',
    '<a href="/zh-cn/Projects/">项目</a>',
    '',
    '[ref]: /zh-cn/Notes/Courses/',
    ''
  ].join('\n')

  assert.deepEqual(
    collectLocaleLinkTargets(text).filter((target) => target.startsWith('/')).sort(),
    [
      '/images/pic.png',
      '/images/pic.png',
      '/zh-cn/About/',
      '/zh-cn/Notes/',
      '/zh-cn/Notes/Courses/',
      '/zh-cn/Projects/'
    ]
  )
})
test('validates each responsive image destination separately', () => {
  const text = [
    '---',
    'image:',
    '  srcset: /images/small.webp 320w, /images/large.webp 640w',
    '---',
    '<img srcset="/images/small.webp 1x, /zh-cn/Notes/ 2x">'
  ].join('\n')
  assert.deepEqual(collectLocaleLinkTargets(text), [
    '/images/small.webp', '/images/large.webp', '/images/small.webp', '/zh-cn/Notes/'
  ])
  assert.match(localeLinkIssues(text, 'en')[0], /语言前缀与 \/en\/ 不一致/)
  assert.deepEqual(localeLinkIssues(text, 'zh-cn'), [])
})


test('links inside code and formulas are not navigation', () => {
  const text = [
    '```md',
    '[fake](/zh-cn/A)',
    '```',
    '',
    '`[inline](/zh-cn/B)` 和 $[math](/zh-cn/C)$',
    ''
  ].join('\n')
  assert.deepEqual(collectLocaleLinkTargets(text), [])
})

test('locale prefixes must match the page locale', () => {
  assert.deepEqual(localeLinkIssues('[x](/en/A)', 'en', 'p'), [])
  assert.match(
    localeLinkIssues('[x](/zh-cn/A)', 'en', 'p')[0],
    /语言前缀与 \/en\/ 不一致/
  )
  assert.match(
    localeLinkIssues('[x](/en/A)', 'zh-tw', 'p')[0],
    /语言前缀与 \/zh-tw\/ 不一致/
  )
  assert.match(
    localeLinkIssues('[x](/zh-cn/A)', 'zh-tw', 'p')[0],
    /语言前缀与 \/zh-tw\/ 不一致/
  )
  assert.match(localeLinkIssues('[x](/Notes/)', 'en', 'p')[0], /必须指向 \/en\//)
})

test('root chooser, assets, anchors, relative, and external links are allowed', () => {
  const text = [
    '[home](/)',
    '[asset](/favicon.svg)',
    '[image](/images/中文图片.png)',
    '[anchor](#section)',
    '[relative](./demo.md)',
    '[external](https://example.com/en/)',
    '[mail](mailto:a@example.com)',
    '[protocol](//cdn.example.com/x.js)',
    '<img src="/images/pic.png">',
    ''
  ].join('\n')
  assert.deepEqual(localeLinkIssues(text, 'en', 'p'), [])
})

test('assets are identified by extension without hiding page routes', () => {
  assert.equal(isAssetTarget('/images/pic.png'), true)
  assert.equal(isAssetTarget('/styles/site.css?x=1'), true)
  assert.equal(isAssetTarget('/Notes/demo'), false)
  assert.equal(isAssetTarget('/Notes/demo.html'), false)
  assert.equal(localeTargetIssue('/images/pic.png', 'zh-tw'), null)
  assert.match(localeTargetIssue('/Notes/demo', 'zh-tw'), /必须指向 \/zh-tw\//)
})

test('localeLinkIssues rejects unsupported locale names', () => {
  assert.match(localeLinkIssues('[x](/en/A)', 'fr', 'p')[0], /不支持的语言/)
})

test('malformed Markdown fails closed instead of reporting a passing link set', () => {
  const issues = localeLinkIssues('<a href="/en/A"', 'en', 'p')
  assert.equal(issues.length, 1)
  assert.match(issues[0], /无法解析站内链接/)
})
