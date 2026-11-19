<script setup lang="ts">
import { onMounted, ref, watch, useId } from 'vue'
import { useData } from 'vitepress'

const props = defineProps<{ source: string }>()
const { isDark } = useData()
const diagram = ref('')
const error = ref('')
const id = 'mermaid-' + useId().replace(/[^a-zA-Z0-9-]/g, '')
let generation = 0

// Must stay in sync with the base stack in ../style.css. Mermaid writes this
// stack into the generated SVG, so Latin labels use the consolidated Noto
// Sans SC Latin face, CJK uses the one consolidated CN or TW face bound to the
// page locale, and emoji/PUA icons keep the same locally hosted faces as the
// surrounding page.
function diagramFont() {
    const lang =
        typeof document === 'undefined' ? '' : document.documentElement.lang
    const cjk =
        lang === 'zh-CN'
            ? '"Noto Sans SC CN", "Noto Sans SC"'
            : lang === 'zh-TW'
              ? '"Noto Sans SC TW", "Noto Sans SC"'
              : '"Noto Sans SC"'
    return `"Noto Sans SC Latin", "Symbols Nerd Font", "Noto Emoji", "Twemoji Mozilla", ${cjk}`
}

const iconPattern = /[\uE000-\uF8FF\u{F0000}-\u{FFFFD}\u{100000}-\u{10FFFD}]/gu
const emojiPattern = /[\p{Extended_Pictographic}\p{Emoji_Modifier}\p{Regional_Indicator}]/gu
const vs16Pattern = /\p{Extended_Pictographic}\uFE0F/gu

/*
 * Coverage check for the consolidated faces.
 *
 * fonts/noto-sans-sc.css declares exact unicode-ranges for the common and
 * locale faces, generated from their WOFF2 cmaps. Reading those ranges lets us
 * load the fine-grained local fallback only for diagram characters that the
 * consolidated files cannot render; ordinary labels therefore never pull the
 * fallback slices. FontFace.unicodeRange is the primary source; a same-origin
 * stylesheet scan is the fallback for engines that do not expose it. If both
 * fail, the caller loads the local fallback for the whole label set: correct
 * layout, at the cost of extra fallback requests.
 */
const FONT_FACE_RULE = 5
const FAMILY_QUOTES = /^["']|["']$/g
const coveredRangeCache = new Map<string, Array<[number, number]>>()

function normalizeFamily(value: string): string {
    return String(value || '')
        .trim()
        .replace(FAMILY_QUOTES, '')
        .toLowerCase()
}

function parseUnicodeRange(value: string): Array<[number, number]> {
    const ranges: Array<[number, number]> = []
    for (const part of value.split(',')) {
        const token = part.replace(/\s+/g, '')
        if (!token) continue
        const body = token.replace(/^U\+/i, '')
        const pieces = body.split('-')
        if (pieces.length > 2) continue
        const startText = pieces[0]
        const endText = pieces[1]
        if (startText.includes('?')) {
            const start = Number.parseInt(startText.replace(/\?/g, '0'), 16)
            const end = Number.parseInt(
                (endText ?? startText).replace(/\?/g, 'F'),
                16
            )
            if (Number.isFinite(start) && Number.isFinite(end)) {
                ranges.push([start, end])
            }
            continue
        }
        const start = Number.parseInt(startText, 16)
        const end =
            endText === undefined ? start : Number.parseInt(endText, 16)
        if (Number.isFinite(start) && Number.isFinite(end)) {
            ranges.push([start, end])
        }
    }
    return ranges
}

function rangesFromFontSet(
    families: string[]
): Array<[number, number]> | null {
    if (typeof document === 'undefined' || !document.fonts) return null
    const wanted = new Set(families.map(normalizeFamily))
    const found = new Set<string>()
    const ranges: Array<[number, number]> = []
    try {
        for (const face of document.fonts) {
            const family = normalizeFamily(face.family)
            if (!wanted.has(family)) continue
            const descriptor = (face as FontFace & { unicodeRange?: string })
                .unicodeRange
            if (typeof descriptor !== 'string' || !descriptor.trim()) {
                return null
            }
            // A default full range means the engine did not expose the
            // declared descriptor. Treat it as unknown so the stylesheet
            // reader or the conservative fallback path takes over.
            if (/^U\+0-10FFFF$/i.test(descriptor.trim())) return null
            const parsed = parseUnicodeRange(descriptor)
            if (!parsed.length) return null
            if (
                parsed.length === 1 &&
                parsed[0][0] === 0 &&
                parsed[0][1] === 0x10ffff
            ) {
                return null
            }
            ranges.push(...parsed)
            found.add(family)
        }
    } catch {
        return null
    }
    for (const family of wanted) if (!found.has(family)) return null
    return ranges
}

function rangesFromStyleSheets(
    families: string[]
): Array<[number, number]> | null {
    if (typeof document === 'undefined') return null
    const wanted = new Set(families.map(normalizeFamily))
    const found = new Set<string>()
    const ranges: Array<[number, number]> = []
    let readable = false
    for (const sheet of Array.from(document.styleSheets)) {
        let rules: CSSRuleList
        try {
            rules = sheet.cssRules
        } catch {
            continue
        }
        if (!rules) continue
        readable = true
        for (const rule of Array.from(rules)) {
            if (rule.type !== FONT_FACE_RULE) continue
            const style = (rule as CSSFontFaceRule).style
            if (!style) continue
            const family = normalizeFamily(
                style.getPropertyValue('font-family')
            )
            if (!wanted.has(family)) continue
            const descriptor = style.getPropertyValue('unicode-range')
            if (!descriptor.trim()) return null
            if (/^U\+0-10FFFF$/i.test(descriptor.trim())) return null
            const parsed = parseUnicodeRange(descriptor)
            if (!parsed.length) return null
            if (
                parsed.length === 1 &&
                parsed[0][0] === 0 &&
                parsed[0][1] === 0x10ffff
            ) {
                return null
            }
            ranges.push(...parsed)
            found.add(family)
        }
    }
    if (!readable) return null
    for (const family of wanted) if (!found.has(family)) return null
    return ranges
}

function coveredRanges(families: string[]): Array<[number, number]> | null {
    const key = families.join('|')
    const cached = coveredRangeCache.get(key)
    if (cached) return cached
    const ranges =
        rangesFromFontSet(families) ?? rangesFromStyleSheets(families)
    if (ranges) coveredRangeCache.set(key, ranges)
    return ranges
}

function isCovered(cp: number, ranges: Array<[number, number]>): boolean {
    for (const [start, end] of ranges) {
        if (cp >= start && cp <= end) return true
    }
    return false
}

/**
 * Characters in the diagram label that the consolidated faces cannot render.
 * Emoji, PUA icons, keycap bases and format/control characters are handled by
 * their own faces or need no glyph, so they are excluded here.
 */
function fallbackTextFor(
    sample: string,
    covered: Array<[number, number]> | null,
    excludedText: string
): string {
    const excluded = new Set<number>()
    for (const ch of excludedText) excluded.add(ch.codePointAt(0)!)
    const seen = new Set<number>()
    let fallback = ''
    for (const ch of sample) {
        const cp = ch.codePointAt(0)!
        if (seen.has(cp) || excluded.has(cp)) continue
        seen.add(cp)
        if (
            (cp >= 0xfe00 && cp <= 0xfe0f) ||
            (cp >= 0xe0100 && cp <= 0xe01ef)
        ) {
            continue
        }
        if (/\p{Cf}|\p{Cc}|\p{Zl}|\p{Zp}/u.test(ch)) continue
        if (covered && isCovered(cp, covered)) continue
        fallback += ch
    }
    return fallback
}

/**
 * Wait for the exact font faces Mermaid is about to measure. Consolidated
 * faces are loaded for the whole label; the fine-grained "Noto Sans SC"
 * fallback is loaded only for the characters they do not cover. Without this
 * step Mermaid can measure fallback metrics and lay the SVG out incorrectly.
 */
async function ensureDiagramFonts(text: string) {
    if (typeof document === 'undefined' || !document.fonts) return

    const sample = text || 'Mermaid'
    const lang = document.documentElement.lang
    const localeFamily =
        lang === 'zh-CN'
            ? 'Noto Sans SC CN'
            : lang === 'zh-TW'
              ? 'Noto Sans SC TW'
              : null

    const icons = text.match(iconPattern)?.join('')
    const emoji = text.match(emojiPattern)?.join('')
        ?.replace(/[\u00A9\u00AE\u2122]/g, '')
    const keycaps = text.match(/[#*0-9]\uFE0F?\u20E3/gu)?.join('') ?? ''
    const vs16 = text.match(vs16Pattern)?.join('') ?? ''

    const loads = [
        document.fonts.load('16px "Noto Sans SC Latin"', sample),
        document.fonts.load('700 16px "Noto Sans SC Latin"', sample)
    ]
    if (localeFamily) {
        loads.push(
            document.fonts.load(`16px "${localeFamily}"`, sample),
            document.fonts.load(`700 16px "${localeFamily}"`, sample)
        )
    }

    let covered: Array<[number, number]> | null = null
    try {
        covered = coveredRanges([
            'Noto Sans SC Latin',
            ...(localeFamily ? [localeFamily] : [])
        ])
    } catch {
        covered = null
    }
    const fallbackText = fallbackTextFor(
        sample,
        covered,
        `${icons ?? ''}${emoji ?? ''}${keycaps}${vs16}`
    )
    if (fallbackText) {
        loads.push(
            document.fonts.load('16px "Noto Sans SC"', fallbackText),
            document.fonts.load('700 16px "Noto Sans SC"', fallbackText)
        )
    }

    if (icons) loads.push(document.fonts.load('16px "Symbols Nerd Font"', icons))
    if (emoji) {
        // Only request joiners/presentation selectors that are actually in the
        // diagram. Appending them unconditionally would match the emoji face for
        // text pictographs such as ©, which the emoji unicode-range excludes.
        const emojiSample = emoji
            + (text.includes('\u200D') ? '\u200D' : '')
            + (text.includes('\uFE0F') ? '\uFE0F' : '')
        loads.push(document.fonts.load('16px "Noto Emoji"', emojiSample))
    }
    if (keycaps || vs16) {
        // Chromium renders VS16 sequences and keycaps with the local color
        // Twemoji face, not the monochrome Noto Emoji face.
        loads.push(document.fonts.load('16px "Twemoji Mozilla"', keycaps + vs16))
    }

    await Promise.all(loads)
    await document.fonts.ready
}

onMounted(() => {
    watch([() => props.source, isDark], async () => {
        const current = ++generation
        error.value = ''
        try {
            const source = decodeURIComponent(props.source)
            await ensureDiagramFonts(source)

            // Vite bundles Mermaid and its diagram chunks into same-origin assets.
            const { default: mermaid } = await import('mermaid')
            const fontFamily = diagramFont()
            mermaid.initialize({
                startOnLoad: false,
                securityLevel: 'strict',
                theme: isDark.value ? 'dark' : 'default',
                fontFamily,
                themeVariables: { fontFamily }
            })
            const { svg } = await mermaid.render(id + '-' + current, source)
            if (current === generation) diagram.value = svg
        } catch (cause) {
            if (current === generation) {
                diagram.value = ''
                error.value = cause instanceof Error ? cause.message : String(cause)
            }
        }
    }, { immediate: true })
})
</script>

<template>
    <div class="local-mermaid">
        <pre v-if="error" role="alert">{{ error }}</pre>
        <div v-else-if="diagram" v-html="diagram" />
        <pre v-else>{{ decodeURIComponent(source) }}</pre>
    </div>
</template>

<style scoped>
.local-mermaid { margin: 24px 0; overflow-x: auto; text-align: center; }
.local-mermaid :deep(svg),
.local-mermaid :deep(svg text),
.local-mermaid :deep(svg foreignObject div),
.local-mermaid :deep(svg .label) {
    /* Some Mermaid diagram types hard-code their default font stack in the
       generated SVG. The local stack is authoritative for rendered diagrams. */
    font-family: var(--vp-font-family-base) !important;
}
.local-mermaid :deep(svg) {
    max-width: 100%;
    height: auto;
}
.local-mermaid pre { text-align: left; white-space: pre-wrap; }
</style>
