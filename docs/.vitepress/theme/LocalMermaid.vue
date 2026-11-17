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
// stack into the generated SVG, so Latin labels use the local Noto Sans SC
// Latin faces, CJK uses the local Noto Sans SC CJK faces, and emoji/PUA icons
// keep the same locally hosted faces as the surrounding page.
const diagramFont = '"Noto Sans SC Latin", "Symbols Nerd Font", "Noto Emoji", "Twemoji Mozilla", "Noto Sans SC"'

const iconPattern = /[\uE000-\uF8FF\u{F0000}-\u{FFFFD}\u{100000}-\u{10FFFD}]/gu
const emojiPattern = /[\p{Extended_Pictographic}\p{Emoji_Modifier}\p{Regional_Indicator}]/gu
const vs16Pattern = /\p{Extended_Pictographic}\uFE0F/gu

/**
 * Wait for the exact font faces Mermaid is about to measure, including the
 * unicode-range slices needed by this diagram's labels. Without this step
 * Mermaid can measure fallback metrics and then lay the SVG out incorrectly.
 */
async function ensureDiagramFonts(text: string) {
    if (typeof document === 'undefined' || !document.fonts) return

    const sample = text || 'Mermaid'
    const loads = [
        document.fonts.load('16px "Noto Sans SC Latin"', sample),
        document.fonts.load('700 16px "Noto Sans SC Latin"', sample),
        document.fonts.load('16px "Noto Sans SC"', sample),
        document.fonts.load('700 16px "Noto Sans SC"', sample)
    ]
    const icons = text.match(iconPattern)?.join('')
    const emoji = text.match(emojiPattern)?.join('')
        ?.replace(/[\u00A9\u00AE\u2122]/g, '')
    const keycaps = text.match(/[#*0-9]\uFE0F?\u20E3/gu)?.join('') ?? ''
    const vs16 = text.match(vs16Pattern)?.join('') ?? ''

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
            mermaid.initialize({
                startOnLoad: false,
                securityLevel: 'strict',
                theme: isDark.value ? 'dark' : 'default',
                fontFamily: diagramFont,
                themeVariables: { fontFamily: diagramFont }
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
