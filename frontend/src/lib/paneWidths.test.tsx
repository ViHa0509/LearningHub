import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PaneHandle } from '../components/PaneHandle'
import { clampWidth, defaultWidth, keyWidth, loadWidths, maxWidth, STORAGE_KEY } from './paneWidths'

beforeEach(() => localStorage.clear())

describe('clamping', () => {
  it('keeps the side limits', () => {
    expect(clampWidth('left', 50, 1440, 44)).toBe(200)
    expect(clampWidth('left', 900, 1440, 44)).toBe(480)
    expect(clampWidth('right', 900, 2000, 44)).toBe(640)
    expect(clampWidth('right', 100, 2000, 44)).toBe(280)
  })

  it('keeps the center at 360 px', () => {
    // 1000 - 360 - 300 (the other panel) = 340
    expect(maxWidth('right', 1000, 300)).toBe(340)
    expect(clampWidth('right', 600, 1000, 300)).toBe(340)
  })

  it('defaults to the minmax values', () => {
    expect(defaultWidth('left', 1440)).toBeCloseTo(316.8)
    expect(defaultWidth('left', 800)).toBe(240)
    expect(defaultWidth('right', 1440)).toBe(432)
    expect(defaultWidth('right', 800)).toBe(300)
  })
})

describe('keys', () => {
  it('moves by 16 px toward the center side, and jumps to the limits', () => {
    expect(keyWidth('ArrowRight', 'left', 300, 480)).toBe(316)
    expect(keyWidth('ArrowLeft', 'left', 300, 480)).toBe(284)
    expect(keyWidth('ArrowLeft', 'right', 300, 640)).toBe(316)
    expect(keyWidth('Home', 'left', 300, 480)).toBe(200)
    expect(keyWidth('End', 'right', 300, 500)).toBe(500)
    expect(keyWidth('a', 'left', 300, 480)).toBeNull()
  })
})

describe('saved widths', () => {
  it('reads valid values', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ left: 300, right: 400 }))
    expect(loadWidths()).toEqual({ left: 300, right: 400 })
  })

  it('ignores a broken or out-of-range value', () => {
    localStorage.setItem(STORAGE_KEY, '{not json')
    expect(loadWidths()).toEqual({ left: null, right: null })
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ left: 'wide', right: 9999 }))
    expect(loadWidths()).toEqual({ left: null, right: null })
    localStorage.setItem(STORAGE_KEY, 'null')
    expect(loadWidths()).toEqual({ left: null, right: null })
  })

  it('survives a store that throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied')
    })
    expect(loadWidths()).toEqual({ left: null, right: null })
    vi.restoreAllMocks()
  })
})

describe('PaneHandle', () => {
  const setup = (side: 'left' | 'right' = 'left') => {
    const onChange = vi.fn()
    const onReset = vi.fn()
    const onDragging = vi.fn()
    render(<PaneHandle side={side} value={300} max={480} onChange={onChange} onReset={onReset} onDragging={onDragging} />)
    return { onChange, onReset, onDragging, handle: screen.getByRole('separator') }
  }

  it('exposes its value and limits', () => {
    const { handle } = setup()
    expect(handle).toHaveAttribute('aria-label', 'Resize Learned list')
    expect(handle).toHaveAttribute('aria-orientation', 'vertical')
    expect(handle).toHaveAttribute('aria-valuenow', '300')
    expect(handle).toHaveAttribute('aria-valuemin', '200')
    expect(handle).toHaveAttribute('aria-valuemax', '480')
    expect(handle).toHaveAttribute('tabindex', '0')
  })

  it('resizes by key and resets on double-click', () => {
    const { handle, onChange, onReset } = setup()
    fireEvent.keyDown(handle, { key: 'ArrowRight' })
    fireEvent.keyDown(handle, { key: 'End' })
    expect(onChange).toHaveBeenNthCalledWith(1, 316)
    expect(onChange).toHaveBeenNthCalledWith(2, 480)
    fireEvent.doubleClick(handle)
    expect(onReset).toHaveBeenCalled()
  })

  it('drags with the pointer', () => {
    const { handle, onChange, onDragging } = setup('right')
    fireEvent.pointerDown(handle, { button: 0, clientX: 500, pointerId: 1 })
    fireEvent.pointerMove(handle, { clientX: 400, pointerId: 1 })
    expect(onChange).toHaveBeenLastCalledWith(400) // right panel: moving left grows it
    fireEvent.pointerUp(handle, { pointerId: 1 })
    expect(onDragging.mock.calls).toEqual([[true], [false]])
  })
})
