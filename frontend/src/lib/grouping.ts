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

export type ListGroup =
  | ({ kind: 'domain' } & DomainGroup)
  | { kind: 'category'; category: string; notes: Note[] }
  | { kind: 'unsorted'; notes: Note[] }

export interface GroupedNotes {
  /** Domain and category groups by their newest note, then Unsorted (no category) last. */
  groups: ListGroup[]
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
 * keep roadmap order); categories of unlinked notes are groups beside the domains; Unsorted is last.
 */
export function groupNotes(
  notes: Note[],
  roadmaps: Roadmap[],
  filter = '',
  options: { allTopics?: boolean } = {},
): GroupedNotes {
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

  const groups: ListGroup[] = []
  for (const roadmap of roadmaps) {
    const nodes = roadmapOrder(roadmap)
      .filter((node) => byNode.has(node.full_id))
      .map((node) => ({ node, notes: newestFirst(byNode.get(node.full_id) ?? []) }))
      // Array.sort is stable: equal times keep the roadmap order.
      .sort((a, b) => updated(b.notes[0]) - updated(a.notes[0]))
    if (nodes.length === 0) continue
    if (options.allTopics) {
      // Drop targets: the topics without a visible note go after the others, in roadmap order, so
      // nothing above the pointer moves when a drag starts. Domains without a note stay out.
      for (const node of roadmapOrder(roadmap)) {
        if (!byNode.has(node.full_id)) nodes.push({ node, notes: [] })
      }
    }
    groups.push({ kind: 'domain', domainId: roadmap.id, title: roadmap.title, nodes })
  }
  const byCategory = new Map<string, Note[]>()
  const other: Note[] = []
  for (const note of unsorted) {
    if (note.category === null) {
      other.push(note)
      continue
    }
    const list = byCategory.get(note.category) ?? []
    list.push(note)
    byCategory.set(note.category, list)
  }
  for (const [category, list] of byCategory) groups.push({ kind: 'category', category, notes: newestFirst(list) })
  // Stable: ties keep domains first, in roadmap order.
  const newest = (g: ListGroup) => (g.kind === 'domain' ? latest(g.nodes.flatMap((n) => n.notes)) : latest(g.notes))
  groups.sort((a, b) => newest(b) - newest(a))
  if (other.length > 0 || options.allTopics) groups.push({ kind: 'unsorted', notes: newestFirst(other) })
  return { groups }
}

export function domainOf(nodeId: string): string {
  return nodeId.split('/')[0]
}
