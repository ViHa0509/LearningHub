import type { Note, Roadmap, RoadmapNode } from '../api'

export interface NodeGroup {
  node: RoadmapNode
  notes: Note[]
}

export interface DomainGroup {
  domainId: string
  title: string
  nodes: NodeGroup[]
}

export interface GroupedNotes {
  domains: DomainGroup[]
  unsorted: Note[]
}

/** Nodes in roadmap order: depth-first, siblings by their order. */
export function roadmapOrder(roadmap: Roadmap): RoadmapNode[] {
  const children = new Map<string | null, RoadmapNode[]>()
  for (const node of roadmap.nodes) {
    const list = children.get(node.parent) ?? []
    list.push(node)
    children.set(node.parent, list)
  }
  for (const list of children.values()) list.sort((a, b) => a.order - b.order)
  const ordered: RoadmapNode[] = []
  const visit = (parent: string | null) => {
    for (const node of children.get(parent) ?? []) {
      ordered.push(node)
      visit(node.id)
    }
  }
  visit(null)
  return ordered
}

export function matchesFilter(note: Note, filter: string): boolean {
  const needle = filter.trim().toLowerCase()
  return needle === '' || note.title.toLowerCase().includes(needle)
}

const updated = (note: Note) => Date.parse(note.updated_at) || 0

/** Newest update first; the list is the caller's (a copy is sorted). */
const newestFirst = (notes: Note[]) => [...notes].sort((a, b) => updated(b) - updated(a))

/** The most recent update among the notes (0 for none). */
const latest = (notes: Note[]) => notes.reduce((max, note) => Math.max(max, updated(note)), 0)

/**
 * Group notes by domain, then node; notes without a valid link are unsorted. Notes in a group are
 * newest first by `updated_at`; nodes and domains follow their most recently updated note (ties
 * keep roadmap order); Unsorted comes last, also newest first.
 */
export function groupNotes(notes: Note[], roadmaps: Roadmap[], filter = ''): GroupedNotes {
  const visible = notes.filter((note) => matchesFilter(note, filter))
  const byNode = new Map<string, Note[]>()
  const known = new Set(roadmaps.flatMap((r) => r.nodes.map((n) => n.full_id)))
  const unsorted: Note[] = []

  for (const note of visible) {
    if (note.node_id === null || note.node_missing || !known.has(note.node_id)) {
      unsorted.push(note)
      continue
    }
    const list = byNode.get(note.node_id) ?? []
    list.push(note)
    byNode.set(note.node_id, list)
  }

  const domains: DomainGroup[] = []
  for (const roadmap of roadmaps) {
    const nodes = roadmapOrder(roadmap)
      .filter((node) => byNode.has(node.full_id))
      .map((node) => ({ node, notes: newestFirst(byNode.get(node.full_id) ?? []) }))
      // Array.sort is stable: equal times keep the roadmap order.
      .sort((a, b) => updated(b.notes[0]) - updated(a.notes[0]))
    if (nodes.length > 0) domains.push({ domainId: roadmap.id, title: roadmap.title, nodes })
  }
  domains.sort(
    (a, b) => latest(b.nodes.flatMap((n) => n.notes)) - latest(a.nodes.flatMap((n) => n.notes)),
  )
  return { domains, unsorted: newestFirst(unsorted) }
}

export function domainOf(nodeId: string): string {
  return nodeId.split('/')[0]
}
