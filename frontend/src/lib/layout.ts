import dagre from '@dagrejs/dagre'
import type { Edge, Node } from '@xyflow/react'
import type { Roadmap } from '../api'

export const NODE_WIDTH = 190
export const NODE_HEIGHT = 46

export interface RoadmapNodeData extends Record<string, unknown> {
  title: string
  fullId: string
  count: number
  selected: boolean
}

/** Positions roadmap nodes top-down with dagre and attaches note counts. */
export function layoutRoadmap(
  roadmap: Roadmap,
  counts: Record<string, number>,
  selectedNode: string | null,
): { nodes: Node<RoadmapNodeData>[]; edges: Edge[] } {
  const graph = new dagre.graphlib.Graph()
  graph.setGraph({ rankdir: 'TB', nodesep: 24, ranksep: 56 })
  graph.setDefaultEdgeLabel(() => ({}))

  for (const node of roadmap.nodes) {
    graph.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT })
  }
  const edges: Edge[] = []
  for (const node of roadmap.nodes) {
    if (node.parent) {
      graph.setEdge(node.parent, node.id)
      edges.push({ id: `${node.parent}->${node.id}`, source: node.parent, target: node.id })
    }
  }
  dagre.layout(graph)

  const nodes = roadmap.nodes.map((node) => {
    const { x, y } = graph.node(node.id)
    return {
      id: node.id,
      type: 'roadmap',
      position: { x: x - NODE_WIDTH / 2, y: y - NODE_HEIGHT / 2 },
      data: {
        title: node.title,
        fullId: node.full_id,
        count: counts[node.id] ?? 0,
        selected: node.full_id === selectedNode,
      },
    }
  })
  return { nodes, edges }
}
