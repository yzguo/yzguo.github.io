import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import {
    buildRootLanguageRedirectScript,
    injectRootLanguageRedirect,
    resolveRootRedirect
} from './language-preference.mjs'

function rootTarget(languages, extra = {}) {
    return resolveRootRedirect({
        pathname: '/',
        search: '',
        hash: '',
        languages,
        base: '/',
        ...extra
    })
}

function executeRedirect({
    pathname = '/',
    search = '',
    hash = '',
    languages,
    language,
    base = '/',
    replaceThrows = false
} = {}) {
    const replacements = []
    const navigator = {}
    if (languages !== undefined) navigator.languages = languages
    if (language !== undefined) navigator.language = language

    const window = {
        location: {
            pathname,
            search,
            hash,
            replace(target) {
                replacements.push(target)
                if (replaceThrows) throw new Error('navigation failed')
            }
        },
        navigator
    }

    vm.runInNewContext(buildRootLanguageRedirectScript(base), { window })
    return replacements
}

test('resolveRootRedirect maps Traditional Chinese variants to zh-tw', () => {
    for (const tag of [
        'zh-Hant',
        'zh-Hant-TW',
        'zh-Hant-HK',
        'zh-Hant-CN',
        'zh-TW',
        'zh-HK',
        'zh-MO',
        'ZH-HANT',
        'zh-tw'
    ]) {
        assert.equal(rootTarget([tag]), '/zh-tw/', tag)
    }
})

test('resolveRootRedirect maps other Chinese variants to zh-cn', () => {
    for (const tag of [
        'zh',
        'zh-CN',
        'zh-Hans',
        'zh-Hans-CN',
        'zh-SG',
        'zh-yue',
        'ZH-CN'
    ]) {
        assert.equal(rootTarget([tag]), '/zh-cn/', tag)
    }
})

test('resolveRootRedirect maps non-Chinese and unknown tags to English', () => {
    for (const tag of ['en-US', 'en-GB', 'fr-FR', 'ja-JP', 'xx', '']) {
        assert.equal(rootTarget([tag]), '/en/', tag)
    }
    assert.equal(rootTarget([]), '/en/')
    assert.equal(rootTarget(undefined), '/en/')
    assert.equal(rootTarget(null), '/en/')
})

test('resolveRootRedirect uses the first usable language preference', () => {
    assert.equal(rootTarget(['zh-TW', 'en-US']), '/zh-tw/')
    assert.equal(rootTarget(['en-US', 'zh-TW']), '/en/')
    assert.equal(rootTarget(['', 'zh-HK']), '/zh-tw/')
    assert.equal(rootTarget(['zh-CN']), '/zh-cn/')
    // navigator.languages can be an array-like DOMStringList instead of Array.
    assert.equal(rootTarget({ 0: 'zh-Hant', 1: 'en', length: 2 }), '/zh-tw/')
    // A single tag is accepted as well.
    assert.equal(rootTarget('zh-Hant'), '/zh-tw/')
})

test('resolveRootRedirect preserves query strings and hashes', () => {
    assert.equal(
        resolveRootRedirect({
            pathname: '/',
            search: '?from=home',
            hash: '#welcome',
            languages: ['zh-TW'],
            base: '/'
        }),
        '/zh-tw/?from=home#welcome'
    )
    assert.equal(
        resolveRootRedirect({
            pathname: '/index.html',
            search: 'from=home',
            hash: 'welcome',
            languages: ['zh-CN'],
            base: '/'
        }),
        '/zh-cn/?from=home#welcome'
    )
})

test('resolveRootRedirect honours a configured base path', () => {
    assert.equal(
        resolveRootRedirect({
            pathname: '/repo/',
            search: '',
            hash: '',
            languages: ['zh-CN'],
            base: '/repo/'
        }),
        '/repo/zh-cn/'
    )
    assert.equal(
        resolveRootRedirect({
            pathname: '/repo/index.html',
            search: '?a=1',
            hash: '',
            languages: ['en-GB'],
            base: '/repo'
        }),
        '/repo/en/?a=1'
    )
    assert.equal(
        resolveRootRedirect({
            pathname: '/repo',
            languages: ['zh-CN'],
            base: '/repo/'
        }),
        null
    )
})

test('resolveRootRedirect never redirects explicit locale pages', () => {
    for (const pathname of [
        '/en/',
        '/en/index.html',
        '/zh-cn/',
        '/zh-cn/About/',
        '/zh-tw/Notes/',
        '/repository/'
    ]) {
        assert.equal(
            resolveRootRedirect({
                pathname,
                search: '?from=menu',
                hash: '#top',
                languages: ['zh-TW'],
                base: '/'
            }),
            null,
            pathname
        )
    }
})

test('resolveRootRedirect never returns the current URL', () => {
    assert.equal(
        resolveRootRedirect({
            pathname: '/en/',
            languages: ['en-US'],
            base: '/'
        }),
        null
    )
    assert.equal(
        resolveRootRedirect({
            pathname: '/zh-cn/',
            search: '?a=1',
            languages: ['zh-CN'],
            base: '/'
        }),
        null
    )
})

test('inline script source cannot close its containing script tag', () => {
    const script = buildRootLanguageRedirectScript(
        '</script><script>alert(1)</script>'
    )
    assert.doesNotMatch(script, /<\/script/i)
})

test('inline script redirects with navigator.languages', () => {
    assert.deepEqual(
        executeRedirect({ languages: ['zh-Hant-HK'], search: '?a=1', hash: '#b' }),
        ['/zh-tw/?a=1#b']
    )
    assert.deepEqual(executeRedirect({ languages: ['en-US'] }), ['/en/'])
    assert.deepEqual(executeRedirect({ languages: ['zh-CN'] }), ['/zh-cn/'])
})

test('inline script falls back to navigator.language', () => {
    assert.deepEqual(executeRedirect({ language: 'zh-TW' }), ['/zh-tw/'])
    assert.deepEqual(executeRedirect({ language: 'fr-FR' }), ['/en/'])
})

test('inline script handles an array-like languages list', () => {
    assert.deepEqual(
        executeRedirect({
            languages: { 0: 'zh-MO', 1: 'en-US', length: 2 }
        }),
        ['/zh-tw/']
    )
})

test('inline script respects base and index.html entry URLs', () => {
    assert.deepEqual(
        executeRedirect({
            pathname: '/repo/index.html',
            languages: ['zh-CN'],
            base: '/repo/'
        }),
        ['/repo/zh-cn/']
    )
})

test('inline script does nothing on explicit locale pages', () => {
    for (const pathname of ['/en/', '/zh-cn/About/', '/zh-tw/Notes/']) {
        assert.deepEqual(
            executeRedirect({
                pathname,
                languages: ['zh-TW'],
                search: '?x=1',
                hash: '#y'
            }),
            [],
            pathname
        )
    }
})

test('inline script falls back to English when detection fails', () => {
    const replacements = []
    const window = {
        location: {
            pathname: '/',
            search: '?a=1',
            hash: '#b',
            replace(target) {
                replacements.push(target)
            }
        },
        get navigator() {
            throw new Error('navigator blocked')
        }
    }

    assert.doesNotThrow(() => {
        vm.runInNewContext(buildRootLanguageRedirectScript('/'), { window })
    })
    assert.deepEqual(replacements, ['/en/?a=1#b'])
})

test('detection fallback respects base and never redirects locale pages', () => {
    const fallbackAtBase = []
    vm.runInNewContext(buildRootLanguageRedirectScript('/repo/'), {
        window: {
            location: {
                pathname: '/repo/',
                search: '?x=1',
                hash: '#y',
                replace(target) {
                    fallbackAtBase.push(target)
                }
            },
            get navigator() {
                throw new Error('navigator blocked')
            }
        }
    })
    assert.deepEqual(fallbackAtBase, ['/repo/en/?x=1#y'])

    for (const pathname of ['/en/', '/zh-cn/About/', '/zh-tw/Notes/']) {
        const replacements = []
        vm.runInNewContext(buildRootLanguageRedirectScript('/'), {
            window: {
                location: {
                    pathname,
                    search: '',
                    hash: '',
                    replace(target) {
                        replacements.push(target)
                    }
                },
                get navigator() {
                    throw new Error('navigator blocked')
                }
            }
        })
        assert.deepEqual(replacements, [], pathname)
    }
})

test('inline script retries English when navigation fails', () => {
    const replacements = executeRedirect({
        languages: ['zh-TW'],
        replaceThrows: true
    })
    assert.deepEqual(replacements, ['/zh-tw/', '/en/'])
})

test('injected root entry runs before stylesheets and module scripts', () => {
    const page =
        '<!DOCTYPE html><html lang="en-US"><head><meta charset="utf-8">' +
        '<link rel="preload stylesheet" href="/assets/style.css" as="style">' +
        '<script type="module" src="/assets/app.js"></script>' +
        '</head><body><div id="app"></div></body></html>'
    const injected = injectRootLanguageRedirect(page, {
        relativePath: 'index.md',
        base: '/repo/'
    })
    const headEnd = injected.indexOf('<head>') + '<head>'.length
    const noscriptStart = injected.indexOf('<noscript>')
    const scriptStart = injected.indexOf('<script>', headEnd)
    const scriptEnd = injected.indexOf('</script>', scriptStart)

    assert.ok(scriptStart >= headEnd)
    // The charset meta stays first; the no-JS refresh and the language script
    // both precede everything that fetches a resource.
    assert.ok(noscriptStart > injected.indexOf('<meta charset'))
    assert.ok(noscriptStart < scriptStart)
    assert.ok(scriptStart > injected.indexOf('<meta charset'))
    assert.ok(scriptStart < injected.indexOf('<link rel="preload stylesheet"'))
    assert.ok(scriptStart < injected.indexOf('<script type="module"'))
    assert.ok(
        injected.includes(
            '<noscript><meta http-equiv="refresh" content="0;url=/repo/en/"></noscript>'
        )
    )
    assert.notEqual(injected, page)

    // Execute the exact bytes that the build injects into the root document.
    const script = injected.slice(scriptStart + '<script>'.length, scriptEnd)
    const replacements = []
    vm.runInNewContext(script, {
        window: {
            location: {
                pathname: '/repo/',
                search: '?from=root',
                hash: '#welcome',
                replace(target) {
                    replacements.push(target)
                }
            },
            navigator: { languages: ['zh-HK', 'en-US'] }
        }
    })
    assert.deepEqual(replacements, ['/repo/zh-tw/?from=root#welcome'])
})

test('no-JavaScript refresh honours the site base', () => {
    const page =
        '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body></body></html>'
    assert.ok(
        injectRootLanguageRedirect(page, {
            relativePath: 'index.md',
            base: '/'
        }).includes('content="0;url=/en/"')
    )
    assert.ok(
        injectRootLanguageRedirect(page, {
            relativePath: 'index.md',
            base: '/docs/'
        }).includes('content="0;url=/docs/en/"')
    )
})

test('injection leaves non-root pages and pages without head unchanged', () => {
    const page = '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body></body></html>'
    assert.equal(
        injectRootLanguageRedirect(page, {
            relativePath: 'en/index.md',
            base: '/'
        }),
        page
    )
    assert.equal(
        injectRootLanguageRedirect('<html><body></body></html>', {
            relativePath: 'index.md',
            base: '/'
        }),
        '<html><body></body></html>'
    )
})

test('root page is a minimal English entry without JavaScript', () => {
    const rootPage = readFileSync(
        new URL('../../index.md', import.meta.url),
        'utf8'
    )
    assert.match(rootPage, /^---[\s\S]*?\blayout: page\b/)
    assert.match(rootPage, /<a href="en\/"/)
    assert.doesNotMatch(rootPage, /hero:/)
    assert.doesNotMatch(rootPage, /images\/pic\.png/)
    assert.doesNotMatch(rootPage, /## Welcome/)
    assert.doesNotMatch(rootPage, /Choose a language/i)
    assert.doesNotMatch(rootPage, /BrowserLanguageRedirect/)
})
