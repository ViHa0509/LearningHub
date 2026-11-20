/** The text shown when the shared provider is gone (spec: agent-providers, withdrawn warning). */
const WITHDRAWN_TEXT =
  'The shared provider is no longer available. Add your own provider to keep using the agents.'

/** A warning icon and the withdrawn text, with a link to the providers page. */
export function WithdrawnWarning() {
  return (
    <p className="shared-warning" role="status">
      <svg className="shared-warning-icon" role="img" aria-label="Warning" viewBox="0 0 24 24" width="18" height="18">
        <path d="M12 3 2 21h20L12 3z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
        <path d="M12 10v5M12 18v.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
      <span>{WITHDRAWN_TEXT}</span>{' '}
      <a href="#/settings">Go to AI providers</a>
    </p>
  )
}
