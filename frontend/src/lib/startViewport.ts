import type { Viewport } from '@xyflow/react'
import type { ScreenClass } from './useScreenClass'

export const DESKTOP_VIEWPORT: Viewport = { x: 32, y: 24, zoom: 0.9 }
const SMALL_SCREEN_ZOOM = 0.85
const TOP_MARGIN = 24

/**
 * The map's start view. Desktop keeps a fixed top-left view; on phone and tablet the first node
 * (the top node of the layout) is centered horizontally in the pane at a readable zoom, with a small top margin.
 */
export function startViewport(
  firstNode: { x: number; y: number },
  nodeWidth: number,
  paneWidth: number,
  screenClass: ScreenClass,
): Viewport {
  if (screenClass === 'desktop') return DESKTOP_VIEWPORT
  const zoom = SMALL_SCREEN_ZOOM
  return {
    x: paneWidth / 2 - (firstNode.x + nodeWidth / 2) * zoom,
    y: TOP_MARGIN - firstNode.y * zoom,
    zoom,
  }
}
