import type { MediaKind } from './mediaUrl'

/** Shown in place of media the lab will not load: the URL as plain text, never requested. */
export function BlockedMedia({ kind, url }: { kind: MediaKind; url: unknown }) {
  return (
    <div className="a2ui-blocked" role="note">
      <strong>External {kind} blocked</strong>
      <code>{typeof url === 'string' ? url : String(url ?? '')}</code>
    </div>
  )
}
