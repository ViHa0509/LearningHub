import { pixelsFor, THINKING_DOTS, usePetState, type Pixel } from '../../lib/pet'

interface Props {
  busy: boolean
  /** Read only for "did the newest entry fail?"; the bubble never shows entry text. */
  entries: readonly { error?: unknown }[]
}

const Pixels = ({ list, className }: { list: Pixel[]; className?: string }) => (
  <g className={className}>
    {list.map((p) => (
      <rect key={`${p.x}-${p.y}`} x={p.x} y={p.y} width="1" height="1" className={`pet-${p.kind}`} />
    ))}
  </g>
)

/**
 * A small sprout on the composer that shows the agent's state, with a bubble of fixed lines.
 * Decoration only: hidden from assistive technology, no pointer events, never focusable.
 */
export function ChatPet({ busy, entries }: Props) {
  const { pose, line } = usePetState({ busy, entries })
  const parts = pixelsFor(pose)
  return (
    <div className="chat-pet" data-pose={pose} aria-hidden="true">
      {line && <div className="chat-pet-bubble">{line}</div>}
      <svg className="chat-pet-art" viewBox="0 0 16 16" width="32" height="32" shapeRendering="crispEdges">
        <g className="pet-figure">
          <Pixels list={parts.body} />
          <Pixels list={parts.leaf} className="pet-leaf" />
          <Pixels list={parts.face} className="pet-face" />
          {pose === 'thinking' &&
            THINKING_DOTS.map((p, i) => (
              <rect key={p.x} x={p.x} y={p.y} width="1" height="1" className={`pet-t pet-dot pet-dot-${i + 1}`} />
            ))}
        </g>
      </svg>
    </div>
  )
}
