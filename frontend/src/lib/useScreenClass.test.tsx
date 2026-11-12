import { act, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { resetScreenClass, setScreenClass } from '../test/screenClass'
import { useScreenClass } from './useScreenClass'

function Probe() {
  const screenClass = useScreenClass()
  return <p data-testid="class">{screenClass}</p>
}

describe('useScreenClass', () => {
  afterEach(() => {
    resetScreenClass()
  })

  it.each(['phone', 'tablet', 'desktop'] as const)('answers %s', (screenClass) => {
    setScreenClass(screenClass)
    render(<Probe />)
    expect(screen.getByTestId('class')).toHaveTextContent(screenClass)
  })

  it('re-renders with the new class without remounting', () => {
    setScreenClass('desktop')
    const { rerender } = render(<Probe />)
    const node = screen.getByTestId('class')
    expect(node).toHaveTextContent('desktop')
    act(() => setScreenClass('phone'))
    expect(screen.getByTestId('class')).toBe(node)
    expect(node).toHaveTextContent('phone')
    act(() => setScreenClass('tablet'))
    expect(node).toHaveTextContent('tablet')
    act(() => setScreenClass('desktop'))
    expect(node).toHaveTextContent('desktop')
    rerender(<Probe />)
    expect(screen.getByTestId('class')).toBe(node)
  })

  it('keeps other media queries answering false', () => {
    setScreenClass('phone')
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    expect(query.matches).toBe(false)
    const listener = vi.fn()
    query.addEventListener('change', listener)
    query.removeEventListener('change', listener)
  })

  it("answers 'desktop' without matchMedia", () => {
    vi.stubGlobal('matchMedia', undefined)
    render(<Probe />)
    expect(screen.getByTestId('class')).toHaveTextContent('desktop')
  })
})
