import type { Roadmap } from '../api'
import { roadmapOrder } from '../lib/grouping'

interface Props {
  roadmaps: Roadmap[]
  value: string | null
  onChange: (nodeId: string | null) => void
  label: string
  emptyLabel?: string
}

/** Select one roadmap node, grouped by domain; the empty option means "no node". */
export function NodePicker({ roadmaps, value, onChange, label, emptyLabel = 'No node (unsorted)' }: Props) {
  return (
    <select aria-label={label} value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">{emptyLabel}</option>
      {roadmaps.map((roadmap) => (
        <optgroup key={roadmap.id} label={roadmap.title}>
          {roadmapOrder(roadmap).map((node) => (
            <option key={node.full_id} value={node.full_id}>
              {node.parent ? '  ' : ''}
              {node.title}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  )
}
