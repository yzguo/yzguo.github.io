<script setup lang="ts">
import { onMounted, ref, watch, useId } from 'vue'
import { useData } from 'vitepress'

const props = defineProps<{ source: string }>()
const { isDark } = useData()
const diagram = ref('')
const error = ref('')
const id = 'mermaid-' + useId().replace(/[^a-zA-Z0-9-]/g, '')
let generation = 0

onMounted(() => {
    watch([() => props.source, isDark], async () => {
        const current = ++generation
        error.value = ''
        try {
            // Vite bundles Mermaid and its diagram chunks into same-origin assets.
            const { default: mermaid } = await import('mermaid')
            mermaid.initialize({
                startOnLoad: false,
                securityLevel: 'strict',
                theme: isDark.value ? 'dark' : 'default',
                fontFamily: 'Arial, sans-serif'
            })
            const { svg } = await mermaid.render(id + '-' + current, decodeURIComponent(props.source))
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
.local-mermaid :deep(svg) { max-width: 100%; height: auto; }
.local-mermaid pre { text-align: left; white-space: pre-wrap; }
</style>
