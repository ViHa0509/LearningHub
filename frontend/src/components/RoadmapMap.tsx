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
import { useEffect, useMemo, useRef } from 'react'
import { api, queryKeys, type DomainSummary } from '../api'
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
}

export function RoadmapMap({ domains, domainId, selectedNodeId, onSelectDomain, onSelectNode }: Props) {
  const roadmap = useQuery({ queryKey: queryKeys.roadmap(domainId), queryFn: () => api.roadmap(domainId) })
  const counts = useQuery({ queryKey: queryKeys.counts(domainId), queryFn: () => api.counts(domainId) })

  const flow = useMemo(
    () =>
      roadmap.data ? layoutRoadmap(roadmap.data, counts.data?.counts ?? {}, selectedNodeId) : null,
    [roadmap.data, counts.data, selectedNodeId],
  )

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
    const first = flow.nodes.reduce((top, n) =>
      n.position.y < top.position.y || (n.position.y === top.position.y && n.position.x < top.position.x) ? n : top,
    )
    const measured = paneRef.current?.clientWidth
    const paneWidth = measured ? measured : window.innerWidth
    return startViewport(first.position, NODE_WIDTH, paneWidth, screenClass)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasLayout, domainId, screenClass])

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
    </div>
  )
}
