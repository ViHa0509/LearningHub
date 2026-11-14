import { useQuery } from '@tanstack/react-query'
import {
  Background,
  Controls,
  Handle,
  Position,
  ReactFlow,
  type Node,
  type NodeProps,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useEffect, useMemo, useRef, useState } from 'react'
import { api, queryKeys, type DomainSummary, type ProposedTopics, type TopicInput } from '../api'
import { useRefreshFields } from '../hooks'
import { navigate } from '../lib/route'
import { ActionMenu } from './ActionMenu'
import { Icon } from './Icon'
import { TopicEditor } from './TopicEditor'
import { NODE_WIDTH, layoutRoadmap, type RoadmapNodeData } from '../lib/layout'
import { DESKTOP_VIEWPORT, startViewport } from '../lib/startViewport'
import { useScreenClass } from '../lib/useScreenClass'

function RoadmapNodeView({ data }: NodeProps<Node<RoadmapNodeData>>) {
  const classes = ['roadmap-node']
  if (data.isTopic) classes.push('topic')
  if (data.count > 0) classes.push('has-notes')
  if (data.selected) classes.push('selected')
  return (
    <div className={classes.join(' ')} data-testid={`node-${data.fullId}`} aria-selected={data.selected}>
      <Handle id="top" type="target" position={Position.Top} isConnectable={false} />
      <Handle id="left" type="target" position={Position.Left} isConnectable={false} />
      <span className="node-title">{data.title}</span>
      {data.count > 0 && (
        <span className="badge" aria-label={`${data.count} notes`}>
          {data.count}
        </span>
      )}
      <Handle id="right" type="source" position={Position.Right} isConnectable={false} />
      <Handle id="bottom" type="source" position={Position.Bottom} isConnectable={false} />
    </div>
  )
}

const nodeTypes = { roadmap: RoadmapNodeView }

interface Props {
  domains: DomainSummary[]
  domainId: string
  selectedNodeId: string | null
  onSelectDomain: (domainId: string) => void
  onSelectNode: (fullId: string) => void
  /** Topics an agent proposed for an area: the editor of that area opens filled with them. */
  proposal?: ProposedTopics | null
  onProposalTaken?: () => void
  /** Asks the outline agent for topics; absent when no provider is configured. */
  onDraft?: () => void
}

export function RoadmapMap({
  domains,
  domainId,
  selectedNodeId,
  onSelectDomain,
  onSelectNode,
  proposal,
  onProposalTaken,
  onDraft,
}: Props) {
  const roadmap = useQuery({ queryKey: queryKeys.roadmap(domainId), queryFn: () => api.roadmap(domainId) })
  const counts = useQuery({ queryKey: queryKeys.counts(domainId), queryFn: () => api.counts(domainId) })

  const flow = useMemo(
    () =>
      roadmap.data ? layoutRoadmap(roadmap.data, counts.data?.counts ?? {}, selectedNodeId) : null,
    [roadmap.data, counts.data, selectedNodeId],
  )

  const domain = domains.find((d) => d.id === domainId)
  const editable = domain?.editable ?? false
  const saved = useMemo<TopicInput[]>(
    () =>
      [...(roadmap.data?.nodes ?? [])]
        .sort((a, b) => a.order - b.order)
        .map((n) => ({ slug: n.id, title: n.title, description: n.description, parent: n.parent })),
    [roadmap.data],
  )
  // The editor: null (closed) or the topics it starts from (the saved ones or an agent's proposal).
  const [editing, setEditing] = useState<{ initial: TopicInput[]; key: number } | null>(null)
  const [areaMode, setAreaMode] = useState<'rename' | 'delete' | null>(null)
  const [areaMenu, setAreaMenu] = useState(false)
  const [areaError, setAreaError] = useState<string | null>(null)
  const refresh = useRefreshFields()
  // A proposal for this area opens the editor once, then is taken (so coming back does not reopen it).
  const mine = proposal && proposal.area === domainId ? proposal : null
  useEffect(() => {
    if (!mine || !roadmap.data || !editable) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setEditing({ initial: mine.topics, key: Date.now() })
    onProposalTaken?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mine, roadmap.data, editable])
  // Another area: its editor and forms are closed.
  const [shownDomain, setShownDomain] = useState(domainId)
  if (shownDomain !== domainId) {
    setShownDomain(domainId)
    setEditing(null)
    setAreaMode(null)
    setAreaMenu(false)
    setAreaError(null)
  }

  const screenClass = useScreenClass()
  const paneRef = useRef<HTMLDivElement>(null)
  const tabsRef = useRef<HTMLDivElement>(null)
  // The domain tabs scroll inside their row on a narrow screen: bring the active one into view.
  useEffect(() => {
    tabsRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView?.({ inline: 'nearest', block: 'nearest' })
  }, [domainId, domains])
  const hasLayout = flow !== null
  // Only the initial view: React Flow reads defaultViewport once per mount (the key is the domain).
  const viewport = useMemo(() => {
    if (!hasLayout) return DESKTOP_VIEWPORT
    if (flow.nodes.length === 0) return DESKTOP_VIEWPORT
    const first = flow.nodes.reduce((top, n) =>
      n.position.y < top.position.y || (n.position.y === top.position.y && n.position.x < top.position.x) ? n : top,
    )
    const measured = paneRef.current?.clientWidth
    const paneWidth = measured ? measured : window.innerWidth
    return startViewport(first.position, NODE_WIDTH, paneWidth, screenClass)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasLayout, domainId, screenClass])

  const empty = roadmap.data !== undefined && roadmap.data.nodes.length === 0
  const closeEditor = () => setEditing(null)
  const runArea = async (change: () => Promise<void>) => {
    setAreaError(null)
    try {
      await change()
    } catch (e) {
      setAreaError(e instanceof Error ? e.message : 'Something went wrong')
    }
  }
  const pickArea = (mode: 'rename' | 'delete') => {
    setAreaMenu(false)
    setAreaError(null)
    setAreaMode(mode)
  }

  return (
    <div className="roadmap-map">
      <div ref={tabsRef} className="domain-tabs" role="tablist" aria-label="Domains">
        {domains.map((d) => (
          <button
            key={d.id}
            type="button"
            role="tab"
            aria-selected={d.id === domainId}
            onClick={() => onSelectDomain(d.id)}
          >
            {d.title}
          </button>
        ))}
      </div>
      {domain && domain.field_id !== null && !editable && (
        <p className="muted area-note">Shared with you. Read only: you can still link notes and write lessons on its topics.</p>
      )}
      {editable && domain && (
        <div className="area-toolbar">
          {!editing && !empty && (
            // Disabled until the map has loaded: an editor opened empty would save an empty list.
            <button type="button" disabled={!roadmap.data} onClick={() => setEditing({ initial: saved, key: Date.now() })}>
              Edit topics
            </button>
          )}
          <div className="field-actions">
            <button
              type="button"
              className="icon area-more"
              aria-label="Area actions"
              aria-haspopup="menu"
              aria-expanded={areaMenu}
              onClick={() => setAreaMenu(!areaMenu)}
            >
              <Icon name="more-vertical" />
            </button>
            {areaMenu && (
              <ActionMenu label="Area actions" onClose={() => setAreaMenu(false)} triggerSelector=".area-more">
                <button type="button" role="menuitem" onClick={() => pickArea('rename')}>
                  <Icon name="edit" />
                  Rename area
                </button>
                <div role="separator" className="menu-divider" />
                <button type="button" role="menuitem" className="danger" onClick={() => pickArea('delete')}>
                  <Icon name="trash" />
                  Delete area
                </button>
              </ActionMenu>
            )}
          </div>
        </div>
      )}
      {editable && domain && areaMode === 'rename' && (
        <AreaDetailsForm
          title={domain.title}
          description={domain.description ?? ''}
          error={areaError}
          onCancel={() => setAreaMode(null)}
          onSave={(change) =>
            void runArea(async () => {
              await api.updateArea(domain.id, change)
              await refresh()
              setAreaMode(null)
            })
          }
        />
      )}
      {editable && domain && areaMode === 'delete' && (
        <p className="note-confirm" role="alertdialog" aria-label="Confirm delete area">
          Delete the area {domain.title} with its topics? Your notes and lessons stay.
          <button
            type="button"
            className="danger"
            onClick={() =>
              void runArea(async () => {
                await api.deleteArea(domain.id)
                await refresh()
                navigate({ page: 'home' })
              })
            }
          >
            Yes, delete
          </button>
          <button type="button" onClick={() => setAreaMode(null)}>
            Cancel
          </button>
          {areaError && (
            <span role="alert" className="error">
              {areaError}
            </span>
          )}
        </p>
      )}
      {editing && roadmap.data && domain ? (
        <div className="topic-editor-wrap">
          <TopicEditor
            key={editing.key}
            area={domainId}
            areaTitle={domain.title}
            saved={saved}
            initial={editing.initial}
            onSaved={async () => {
              await refresh()
              closeEditor()
            }}
            onCancel={closeEditor}
          />
        </div>
      ) : empty ? (
        <section className="empty-area" aria-label={`${roadmap.data?.title ?? domainId} has no topics`}>
          <p className="muted">This area has no topics yet.</p>
          {editable && (
            <div className="dialog-actions">
              <button type="button" onClick={() => setEditing({ initial: [], key: Date.now() })}>
                Add topics
              </button>
              {onDraft && (
                <button type="button" onClick={onDraft}>
                  Draft topics with agent
                </button>
              )}
            </div>
          )}
        </section>
      ) : (
      <div className="flow" ref={paneRef} aria-label={`${roadmap.data?.title ?? domainId} roadmap`}>
        {roadmap.isError && <p className="error">Could not load the roadmap.</p>}
        {flow && (
          <ReactFlow
            key={domainId}
            nodes={flow.nodes}
            edges={flow.edges}
            nodeTypes={nodeTypes}
            nodesDraggable={false}
            nodesConnectable={false}
            // Start readable (top-left on desktop, first node centered on small screens); wheel scrolls,
            // ctrl+wheel and pinch zoom, drag pans.
            defaultViewport={viewport}
            panOnScroll
            minZoom={0.2}
            proOptions={{ hideAttribution: true }}
            onNodeClick={(_, node) => onSelectNode((node.data as RoadmapNodeData).fullId)}
          >
            <Background />
            <Controls position="bottom-right" showInteractive={false} />
          </ReactFlow>
        )}
      </div>
      )}
    </div>
  )
}

interface DetailsProps {
  title: string
  description: string
  error: string | null
  onSave: (change: { title?: string; description?: string }) => void
  onCancel: () => void
}

/** Rename an area (its slug stays): title and description with Save (disabled until changed) and Cancel. */
function AreaDetailsForm({ title, description, error, onSave, onCancel }: DetailsProps) {
  const [name, setName] = useState(title)
  const [text, setText] = useState(description)
  const changed = name.trim() !== title || text.trim() !== description
  return (
    <form
      className="field-form"
      aria-label="Rename area"
      onSubmit={(e) => {
        e.preventDefault()
        if (changed && name.trim()) onSave({ title: name.trim(), description: text.trim() })
      }}
      onKeyDown={(e) => e.key === 'Escape' && onCancel()}
    >
      <label>
        Area title
        <input autoFocus value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
      </label>
      <label>
        Description
        <input value={text} maxLength={200} onChange={(e) => setText(e.target.value)} />
      </label>
      <div className="dialog-actions">
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="primary" disabled={!changed || !name.trim()}>
          Save
        </button>
      </div>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </form>
  )
}
