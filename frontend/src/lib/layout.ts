import type { Edge, Node } from '@xyflow/react'
import type { Roadmap, RoadmapNode } from '../api'

export const NODE_WIDTH = 190
export const NODE_HEIGHT = 46
const COLUMN = NODE_WIDTH + 70
const ROW = NODE_HEIGHT + 14
const TOPIC_GAP = 0.6

export interface RoadmapNodeData extends Record<string, unknown> {
  title: string
  fullId: string
  count: number
  selected: boolean
  isTopic: boolean
}

/**
 * Roadmap-style layout: top-level topics form a vertical spine in the first column,
 * and each topic's subtopics branch to the right, one column per depth.
 */
export function layoutRoadmap(
  roadmap: Roadmap,
  counts: Record<string, number>,
  selectedNode: string | null,
): { nodes: Node<RoadmapNodeData>[]; edges: Edge[] } {
  const children = new Map<string | null, RoadmapNode[]>()
  for (const node of roadmap.nodes) {
    const list = children.get(node.parent) ?? []
    list.push(node)
    children.set(node.parent, list)
  }
  for (const list of children.values()) list.sort((a, b) => a.order - b.order)

  const cells = new Map<string, { column: number; row: number }>()
  const place = (node: RoadmapNode, column: number, row: number): number => {
    cells.set(node.id, { column, row })
    let next = row
    for (const child of children.get(node.id) ?? []) next += place(child, column + 1, next)
    return Math.max(1, next - row)
  }

  const topics = children.get(null) ?? []
  let cursor = 0
  for (const topic of topics) cursor += place(topic, 0, cursor) + TOPIC_GAP

  const edges: Edge[] = []
  topics.forEach((topic, index) => {
    if (index > 0) {
      const previous = topics[index - 1]
      edges.push({
        id: `spine:${previous.id}->${topic.id}`,
        source: previous.id,
        target: topic.id,
        sourceHandle: 'bottom',
        targetHandle: 'top',
        className: 'spine-edge',
      })
    }
  })
  for (const node of roadmap.nodes) {
    if (node.parent) {
      edges.push({
        id: `${node.parent}->${node.id}`,
        source: node.parent,
        target: node.id,
        sourceHandle: 'right',
        targetHandle: 'left',
        type: 'smoothstep',
      })
    }
  }

  const nodes = roadmap.nodes.map((node) => {
    const cell = cells.get(node.id) ?? { column: 0, row: 0 }
    return {
      id: node.id,
      type: 'roadmap',
      position: { x: cell.column * COLUMN, y: cell.row * ROW },
      data: {
        title: node.title,
        fullId: node.full_id,
        count: counts[node.id] ?? 0,
        selected: node.full_id === selectedNode,
        isTopic: node.parent === null,
      },
    }
  })
  return { nodes, edges }
}
