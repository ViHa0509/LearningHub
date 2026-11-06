import type { DomainSummary } from '../api'
import { routeHash } from '../lib/route'

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
        {domains.map((d) => {
          const percent = d.node_count ? Math.round((d.learned_nodes / d.node_count) * 100) : 0
          return (
            <li key={d.id}>
              <a className="domain-card" href={routeHash({ page: 'roadmap', domain: d.id })}>
                <h2>{d.title}</h2>
                {d.description && <p className="card-description">{d.description}</p>}
                <div className="progress" aria-label={`${d.learned_nodes} of ${d.node_count} topics with notes`}>
                  <div className="progress-bar">
                    <span style={{ width: `${percent}%` }} />
                  </div>
                  <span className="progress-text">
                    {d.learned_nodes} / {d.node_count} topics
                  </span>
                </div>
              </a>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
