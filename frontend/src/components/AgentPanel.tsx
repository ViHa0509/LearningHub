interface Props {
  open: boolean
  onToggle: () => void
}

/** Reserved for the agent chat (a later slice). */
export function AgentPanel({ open, onToggle }: Props) {
  return (
    <aside className="pane right" aria-label="Agent" data-collapsed={!open}>
      <div className="pane-header">
        <button
          type="button"
          className="icon"
          aria-expanded={open}
          aria-label={open ? 'Collapse agent panel' : 'Expand agent panel'}
          onClick={onToggle}
        >
          {open ? '»' : '«'}
        </button>
        {open && <h2>Agent</h2>}
      </div>
      {open && (
        <div className="agent-placeholder">
          <p>The agent is not available yet.</p>
          <p className="muted">
            A later version will answer questions from your notes and suggest what to learn next.
          </p>
        </div>
      )}
    </aside>
  )
}
