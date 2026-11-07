// Renders the PNG brand assets from their SVG sources and screenshots the brand sheet.
// Run: node docs/brand/render.mjs   (needs `npm install` in frontend/; uses its Playwright with Edge)
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const { chromium } = await import(
  pathToFileURL(resolve(here, '../../frontend/node_modules/playwright/index.mjs')).href
)
const brand = resolve(here, '../../frontend/public/brand')
const screens = resolve(here, '../../frontend/e2e-results/screens')
const url = (p) => pathToFileURL(p).href

const browser = await chromium.launch({ channel: 'msedge' })

async function png(svg, size, out, background) {
  // Open the SVG itself (an HTML page on about:blank may not load file:// images).
  const page = await browser.newPage({ viewport: { width: size, height: size } })
  await page.goto(url(resolve(brand, svg)))
  await page.evaluate((bg) => {
    const root = document.documentElement
    root.setAttribute('width', '100%')
    root.setAttribute('height', '100%')
    if (bg) root.style.background = bg
  }, background ?? '')
  await page.screenshot({ path: resolve(brand, out), omitBackground: !background })
  await page.close()
}

// Tile with transparent rounded corners for browsers; full-bleed square for iOS, which rounds it itself.
await png('app-icon-small.svg', 32, 'favicon-32.png')
await png('app-icon.svg', 180, 'apple-touch-icon.png', '#1E1B4B')

for (const scheme of ['light', 'dark']) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: scheme })
  await page.goto(url(resolve(here, 'index.html')))
  await page.waitForLoadState('load')
  await page.screenshot({ path: resolve(screens, `brand-${scheme}.png`), fullPage: true })
  await page.close()
}

await browser.close()
