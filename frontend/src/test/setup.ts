import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, vi } from 'vitest'

// jsdom lacks the layout APIs React Flow measures with; give it fixed sizes.
class ResizeObserverMock {
  callback: ResizeObserverCallback
  constructor(callback: ResizeObserverCallback) {
    this.callback = callback
  }
  observe(target: Element) {
    this.callback([{ target } as ResizeObserverEntry], this as unknown as ResizeObserver)
  }
  unobserve() {}
  disconnect() {}
}

class DOMMatrixReadOnlyMock {
  m22: number
  constructor(transform?: string) {
    const scale = transform?.match(/scale\(([1-9.]+)\)/)?.[1]
    this.m22 = scale !== undefined ? Number(scale) : 1
  }
}

globalThis.ResizeObserver = ResizeObserverMock as unknown as typeof ResizeObserver
globalThis.DOMMatrixReadOnly = DOMMatrixReadOnlyMock as unknown as typeof DOMMatrixReadOnly
Object.defineProperties(HTMLElement.prototype, {
  offsetHeight: { get: () => 600, configurable: true },
  offsetWidth: { get: () => 800, configurable: true },
})
Object.defineProperty(SVGElement.prototype, "getBBox", { value: () => ({ x: 0, y: 0, width: 0, height: 0 }), configurable: true })

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  window.history.replaceState(null, '', '#/')
  localStorage.clear()
  document.documentElement.removeAttribute('data-theme')
})
