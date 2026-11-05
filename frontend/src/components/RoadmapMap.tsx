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
import { useMemo } from 'react'
import { api, queryKeys, type DomainSummary } from '../api'
import { layoutRoadmap, type RoadmapNodeData } from '../lib/layout'

function RoadmapNodeView({ data }: NodeProps<Node<RoadmapNodeData>>) {
  const classes = ['roadmap-node']
  if (data.count > 0) classes.push('has-notes')
  if (data.selected) classes.push('selected')
  return (
    <div className={classes.join(' ')} data-testid={`node-${data.fullId}`} aria-selected={data.selected}>
      <Handle type="target" position={Position.Top} isConnectable={false} />
      <span className="node-title">{data.title}</span>
      {data.count > 0 && (
        <span className="badge" aria-label={`${data.count} notes`}>
          {data.count}
        </span>
      )}
      <Handle type="source" position={Position.Bottom} isConnectable={false} />
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

  return (
    <div className="roadmap-map">
      <div className="domain-tabs" role="tablist" aria-label="Domains">
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
      <div className="flow" aria-label={`${roadmap.data?.title ?? domainId} roadmap`}>
        {roadmap.isError && <p className="error">Could not load the roadmap.</p>}
        {flow && (
          <ReactFlow
            key={domainId}
            nodes={flow.nodes}
            edges={flow.edges}
            nodeTypes={nodeTypes}
            nodesDraggable={false}
            nodesConnectable={false}
            fitView
            minZoom={0.2}
            proOptions={{ hideAttribution: true }}
            onNodeClick={(_, node) => onSelectNode((node.data as RoadmapNodeData).fullId)}
          >
            <Background />
            <Controls showInteractive={false} />
          </ReactFlow>
        )}
      </div>
    </div>
  )
}
