/*
 * Browser chrome (toolbar/status bar) colors for the VitePress appearance.
 *
 * The light value keeps the site's existing accent. The dark value matches
 * VitePress's dark page background (`--vp-c-bg` in the default theme), so the
 * toolbar blends with the page instead of staying bright above it.
 *
 * head.ts uses these values for the pre-paint tag and theme/index.ts keeps the
 * tag in sync with the appearance switch. Keep this module dependency-free:
 * it is imported by both the Node config and the browser theme.
 */
export const themeColor = {
    light: '#0078D4',
    dark: '#1b1b1f'
}
