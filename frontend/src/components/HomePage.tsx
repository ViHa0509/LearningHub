import { useState } from 'react'
import type { DomainSummary } from '../api'
import { routeHash } from '../lib/route'
import { BorderBeam } from './magicui/border-beam'
import { MagicCard } from './magicui/magic-card'
import { NumberTicker } from './magicui/number-ticker'

interface Props {
  domains: DomainSummary[]
}

export function HomePage({ domains }: Props) {
  return (
    <section className="home-page" aria-label="Home">
      <div className="home-intro">
        <h1>What do you want to learn?</h1>
        <p className="muted">Pick a role to see its roadmap, your notes on each topic and the lessons you wrote.</p>
      </div>
      <ul className="domain-cards">
        {domains.map((d) => (
          <li key={d.id}>
            <RoleCard domain={d} />
          </li>
        ))}
      </ul>
    </section>
  )
}

/** One role card: a spotlight follows the pointer, and a border beam runs while it is hovered or keyboard-focused. */
function RoleCard({ domain: d }: { domain: DomainSummary }) {
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const percent = d.node_count ? Math.round((d.learned_nodes / d.node_count) * 100) : 0
  return (
    <MagicCard className="h-full">
      <a
        className="domain-card"
        href={routeHash({ page: 'roadmap', domain: d.id })}
        onPointerEnter={() => setHovered(true)}
        onPointerLeave={() => setHovered(false)}
        onFocus={(e) => setFocused(isFocusVisible(e.currentTarget))}
        onBlur={() => setFocused(false)}
      >
        <h2>{d.title}</h2>
        {d.description && <p className="card-description">{d.description}</p>}
        <div className="progress" aria-label={`${d.learned_nodes} of ${d.node_count} topics with notes`}>
          <div className="progress-bar">
            <span style={{ width: `${percent}%` }} />
          </div>
          <span className="progress-text">
            <NumberTicker value={d.learned_nodes} /> / {d.node_count} topics
          </span>
        </div>
      </a>
      {(hovered || focused) && <BorderBeam />}
    </MagicCard>
  )
}

function isFocusVisible(element: Element): boolean {
  try {
    return element.matches(':focus-visible')
  } catch {
    return true
  }
}
