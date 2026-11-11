/** Spec: visual-polish - Animated decoration with Magic UI; Reduced motion and themes. */
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AnimatedShinyText } from './animated-shiny-text'
import { BlurFade } from './blur-fade'
import { BorderBeam } from './border-beam'
import { DotPattern } from './dot-pattern'
import { MagicCard } from './magic-card'
import { Marquee } from './marquee'
import { NumberTicker } from './number-ticker'
import { ShimmerButton } from './shimmer-button'

/** An IntersectionObserver that never reports the element as visible, so a ticker stays at its start. */
class NeverVisible {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return []
  }
}

describe('Magic UI components', () => {
  it('DotPattern is decoration: hidden from assistive tech and takes no pointer events', () => {
    const { container } = render(<DotPattern glow />)
    const svg = container.querySelector('svg')!
    expect(svg).toHaveAttribute('aria-hidden', 'true')
    expect(svg.getAttribute('class')).toContain('pointer-events-none')
  })

  it('ShimmerButton keeps its name, type and disabled state; the sparkle layers are hidden', () => {
    render(
      <ShimmerButton type="submit" disabled>
        Log in
      </ShimmerButton>,
    )
    const button = screen.getByRole('button', { name: 'Log in' })
    expect(button).toHaveAttribute('type', 'submit')
    expect(button).toBeDisabled()
    for (const layer of button.querySelectorAll(':scope > span')) expect(layer).toHaveAttribute('aria-hidden', 'true')
  })

  it('MagicCard keeps the link inside it; the spotlight is hidden and takes no pointer events', () => {
    const { container } = render(
      <MagicCard>
        <a href="#/roadmap/backend">Backend</a>
      </MagicCard>,
    )
    expect(screen.getByRole('link', { name: 'Backend' })).toBeInTheDocument()
    const spotlight = container.querySelector('.mu-spotlight')!
    expect(spotlight).toHaveAttribute('aria-hidden', 'true')
    expect(spotlight.getAttribute('class')).toContain('pointer-events-none')
  })

  it('BorderBeam is hidden decoration', () => {
    const { container } = render(<BorderBeam />)
    const beam = container.querySelector('.mu-beam')!
    expect(beam).toHaveAttribute('aria-hidden', 'true')
    expect(beam.getAttribute('class')).toContain('pointer-events-none')
  })

  it('NumberTicker exposes the final number through aria-label while it counts up', () => {
    vi.stubGlobal('IntersectionObserver', NeverVisible)
    render(<NumberTicker value={1234} />)
    const ticker = screen.getByLabelText('1,234')
    expect(ticker).toHaveTextContent('0')
  })

  it('NumberTicker shows the final value at once when the page cannot observe visibility', () => {
    render(<NumberTicker value={7} />)
    expect(screen.getByLabelText('7')).toHaveTextContent('7')
  })

  it('BlurFade renders its children', () => {
    render(
      <BlurFade delay={0.1}>
        <p>Headline</p>
      </BlurFade>,
    )
    expect(screen.getByText('Headline')).toBeInTheDocument()
  })

  it('Marquee reads its content once; the repeated copies are hidden', () => {
    render(
      <Marquee repeat={3}>
        <span>Lab</span>
      </Marquee>,
    )
    expect(screen.getAllByText('Lab')).toHaveLength(3)
    expect(screen.getAllByText('Lab', { ignore: '[aria-hidden=true] *' })).toHaveLength(1)
  })

  it('AnimatedShinyText keeps its text', () => {
    render(<AnimatedShinyText>Thinking…</AnimatedShinyText>)
    expect(screen.getByText('Thinking…')).toBeInTheDocument()
  })
})

describe('Magic UI components under prefers-reduced-motion', () => {
  beforeEach(() => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query.includes('prefers-reduced-motion'),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      onchange: null,
      dispatchEvent: () => false,
    }))
    // Even where visibility can be observed, reduced motion must win.
    vi.stubGlobal('IntersectionObserver', NeverVisible)
  })

  it('NumberTicker renders the final value immediately', () => {
    render(<NumberTicker value={42} />)
    expect(screen.getByLabelText('42')).toHaveTextContent('42')
  })

  it('Marquee is static: one copy, no animation class', () => {
    const { container } = render(
      <Marquee repeat={4}>
        <span>Lab</span>
      </Marquee>,
    )
    expect(screen.getAllByText('Lab')).toHaveLength(1)
    expect(container.querySelector('.mu-marquee')).toBeNull()
  })

  it('BorderBeam renders nothing and BlurFade shows its children at once', () => {
    const beam = render(<BorderBeam />)
    expect(beam.container.querySelector('.mu-beam')).toBeNull()
    render(
      <BlurFade>
        <p>Headline</p>
      </BlurFade>,
    )
    expect(screen.getByText('Headline')).toBeVisible()
  })

  it('ShimmerButton drops the moving spark, AnimatedShinyText the shine, DotPattern the glow', () => {
    const { container } = render(
      <>
        <ShimmerButton>Go</ShimmerButton>
        <AnimatedShinyText>Thinking…</AnimatedShinyText>
        <DotPattern glow />
      </>,
    )
    expect(container.querySelector('.mu-shimmer')).toBeNull()
    expect(container.querySelector('.mu-shiny')).toBeNull()
    expect(container.querySelector('.mu-glow')).toBeNull()
  })

  it('MagicCard has no spotlight', () => {
    const { container } = render(<MagicCard>Card</MagicCard>)
    expect(container.querySelector('.mu-spotlight')).toBeNull()
  })
})
