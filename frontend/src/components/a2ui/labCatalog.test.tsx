import { render, screen, waitFor } from '@testing-library/react'
import { act } from 'react'
import { describe, expect, it } from 'vitest'
import { A2uiSurface, MarkdownComponentContext, type ReactCatalogComponent } from '@a2ui/react/v0_9'
import { MessageProcessor } from '@a2ui/web_core/v0_9'
import { basicCatalog } from '@a2ui/web_core/v0_9/basic_catalog'
import { LabMarkdown } from './LabMarkdown'
import { createLabCatalog } from './labCatalog'

function renderSurface(components: Record<string, unknown>[]) {
  const catalog = createLabCatalog()
  const processor = new MessageProcessor<ReactCatalogComponent>([catalog])
  act(() => {
    processor.processMessages([
      { version: 'v0.9', createSurface: { surfaceId: 's', catalogId: basicCatalog.id } },
      { version: 'v0.9', updateComponents: { surfaceId: 's', components } },
    ] as never)
  })
  const surface = processor.model.surfacesMap.get('s')!
  return render(
    <MarkdownComponentContext.Provider value={LabMarkdown}>
      <A2uiSurface surface={surface} />
    </MarkdownComponentContext.Provider>,
  )
}

describe('lab catalog', () => {
  it('keeps the basic catalog id and every basic component', () => {
    const catalog = createLabCatalog()
    expect(catalog.id).toBe(basicCatalog.id)
    expect([...catalog.components.keys()].sort()).toEqual([...basicCatalog.components.keys()].sort())
  })

  it('blocks an external image and shows its URL as text', async () => {
    const url = 'https://tracker.example/p.png?d=secret'
    const { container } = renderSurface([
      { id: 'root', component: 'Column', children: ['img'] },
      { id: 'img', component: 'Image', url },
    ])
    await waitFor(() => expect(screen.getByText('External image blocked')).toBeTruthy())
    expect(screen.getByText(url).tagName).toBe('CODE')
    expect(container.querySelector('img')).toBeNull()
  })

  it('blocks external video and audio', async () => {
    const { container } = renderSurface([
      { id: 'root', component: 'Column', children: ['v', 'a'] },
      { id: 'v', component: 'Video', url: 'https://cdn.example/v.mp4' },
      { id: 'a', component: 'AudioPlayer', url: 'https://cdn.example/a.mp3' },
    ])
    await waitFor(() => expect(screen.getByText('External video blocked')).toBeTruthy())
    expect(screen.getByText('External audio blocked')).toBeTruthy()
    expect(container.querySelector('video, audio')).toBeNull()
  })

  it('shows an image from the app itself', async () => {
    const { container } = renderSurface([
      { id: 'root', component: 'Column', children: ['img'] },
      { id: 'img', component: 'Image', url: '/brand/logo-mark.svg', description: 'Logo' },
    ])
    await waitFor(() => expect(container.querySelector('img')?.getAttribute('src')).toBe('/brand/logo-mark.svg'))
    expect(container.querySelector('img')?.getAttribute('alt')).toBe('Logo')
  })
})

describe('LabMarkdown', () => {
  it('never creates elements from HTML and drops script links', () => {
    const { container } = render(
      <LabMarkdown markdown={'<img src=x onerror=alert(1)> and [x](javascript:alert(1)) and [ok](https://a2ui.org)'} />,
    )
    expect(container.querySelector('img')).toBeNull()
    const links = [...container.querySelectorAll('a')]
    expect(links.some((a) => (a.getAttribute('href') ?? '').startsWith('javascript:'))).toBe(false)
    // The dropped link is text, not an anchor with an empty href (which would open the app).
    expect(links.map((a) => a.textContent)).toEqual(['ok'])
    expect(container.textContent).toContain('x')
    const ok = links.find((a) => a.textContent === 'ok')!
    expect(ok.getAttribute('target')).toBe('_blank')
    expect(ok.getAttribute('rel')).toBe('noopener noreferrer')
  })

  it('shows an outside image as a placeholder, and renders an image of the app', () => {
    const { container } = render(<LabMarkdown markdown={'![pixel](https://evil.example/p.png)'} />)
    expect(container.querySelector('img')).toBeNull()
    const blocked = container.querySelector('.md-blocked-image')
    expect(blocked).toHaveTextContent('pixel')
    expect(blocked).toHaveTextContent('https://evil.example/p.png')

    const ok = render(<LabMarkdown markdown={'![Logo](/brand/logo-mark.svg)'} />)
    expect(ok.container.querySelector('img')?.getAttribute('src')).toBe('/brand/logo-mark.svg')
  })
})
