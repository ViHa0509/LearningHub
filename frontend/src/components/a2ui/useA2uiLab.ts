import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactCatalogComponent } from '@a2ui/react/v0_9'
import { MessageProcessor } from '@a2ui/web_core/v0_9'
import { createLabCatalog } from './labCatalog'

type Processor = MessageProcessor<ReactCatalogComponent>
export type LabSurface = NonNullable<ReturnType<Processor['getSurface']>>
type ActionPayload = Parameters<NonNullable<ConstructorParameters<typeof MessageProcessor>[1]>>[0]

export type LabSource = 'editor' | 'sample' | 'scripted agent' | 'user'
export type LabDirection = 'agent→renderer' | 'renderer→agent'
export type LabMessage = Record<string, unknown>
export type LabReplies = Record<string, LabMessage[]>

export interface LabLogEntry {
  id: number
  direction: LabDirection
  source: LabSource
  time: string
  message: unknown
}

export interface LabError {
  /** 1-based number of the message in its Send; absent for errors outside a Send. */
  index?: number
  message: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** The processor accepts any component name; the lab refuses names the catalog does not have. */
function unknownComponent(message: LabMessage, known: ReadonlySet<string>): string | undefined {
  const update = message.updateComponents
  if (!isRecord(update) || !Array.isArray(update.components)) return undefined
  for (const comp of update.components) {
    if (!isRecord(comp)) continue
    const type = comp.component
    if (typeof type === 'string' && !known.has(type)) {
      return `Unknown component "${type}" (component id "${String(comp.id)}").`
    }
  }
  return undefined
}

function snapshot(value: unknown): unknown {
  try {
    return JSON.parse(JSON.stringify(value ?? {}))
  } catch {
    return {}
  }
}

export function useA2uiLab() {
  const [surfaces, setSurfaces] = useState<LabSurface[]>([])
  const [log, setLog] = useState<LabLogEntry[]>([])
  const [errors, setErrors] = useState<LabError[]>([])
  const [dataModels, setDataModels] = useState<Record<string, unknown>>({})

  const processorRef = useRef<Processor | null>(null)
  const knownRef = useRef<ReadonlySet<string>>(new Set())
  const cleanupRef = useRef<(() => void) | null>(null)
  const nextId = useRef(1)
  const currentIndex = useRef<number | undefined>(undefined)
  const repliesRef = useRef<LabReplies | null>(null)
  const sendRef = useRef<(messages: LabMessage[], source: LabSource) => void>(() => {})

  const addLog = useCallback((direction: LabDirection, source: LabSource, message: unknown) => {
    const entry: LabLogEntry = {
      id: nextId.current++,
      direction,
      source,
      time: new Date().toISOString(),
      message,
    }
    setLog((prev) => [...prev, entry])
  }, [])

  const teardown = useCallback(() => {
    cleanupRef.current?.()
    cleanupRef.current = null
    processorRef.current?.dispose()
    processorRef.current = null
  }, [])

  const create = useCallback((): Processor => {
    const unsubs: Array<() => void> = []
    const dataSubs = new Map<string, () => void>()

    const onAction = (action: ActionPayload) => {
      addLog('renderer→agent', 'user', {
        version: 'v0.9',
        action: {
          name: action.name,
          surfaceId: action.surfaceId,
          sourceComponentId: action.sourceComponentId,
          timestamp: action.timestamp,
          context: snapshot(action.context),
        },
      })
      const reply = repliesRef.current?.[action.name]
      if (reply && reply.length > 0) sendRef.current(reply, 'scripted agent')
    }

    const catalog = createLabCatalog()
    knownRef.current = new Set(catalog.components.keys())
    const processor = new MessageProcessor<ReactCatalogComponent>([catalog], onAction, {
      errorHandler: (err) => {
        const message = err.error.message
        setErrors((prev) => [...prev, { index: currentIndex.current, message }])
      },
      reportErrorsOnly: true,
    })

    const syncSurfaces = () => setSurfaces(Array.from(processor.model.surfacesMap.values()))

    const created = processor.onSurfaceCreated((surface) => {
      const model = surface.dataModel
      const update = () =>
        setDataModels((prev) => ({ ...prev, [surface.id]: snapshot(model.get('/')) }))
      update()
      const sub = model.subscribe('/', update)
      dataSubs.set(surface.id, () => sub.unsubscribe())
      syncSurfaces()
    })
    const deleted = processor.onSurfaceDeleted((id) => {
      dataSubs.get(id)?.()
      dataSubs.delete(id)
      setDataModels((prev) => {
        const next = { ...prev }
        delete next[id]
        return next
      })
      syncSurfaces()
    })
    unsubs.push(
      () => created.unsubscribe(),
      () => deleted.unsubscribe(),
      () => dataSubs.forEach((off) => off()),
    )

    cleanupRef.current = () => unsubs.forEach((off) => off())
    processorRef.current = processor
    return processor
  }, [addLog])

  useEffect(() => {
    if (!processorRef.current) create()
    return teardown
  }, [create, teardown])

  const send = useCallback(
    (messages: LabMessage[], source: LabSource) => {
      const processor = processorRef.current ?? create()
      const rootChecks = new Map<string, number>()
      messages.forEach((message, i) => {
        addLog('agent→renderer', source, message)
        currentIndex.current = i + 1
        try {
          const unknown = unknownComponent(message, knownRef.current)
          if (unknown) {
            setErrors((prev) => [...prev, { index: i + 1, message: unknown }])
            return
          }
          processor.processMessages(message as never)
          const update = message.updateComponents
          if (isRecord(update) && typeof update.surfaceId === 'string') {
            rootChecks.set(update.surfaceId, i + 1)
          }
        } catch (err) {
          const text = err instanceof Error ? err.message : String(err)
          setErrors((prev) => [...prev, { index: i + 1, message: text }])
        } finally {
          currentIndex.current = undefined
        }
      })
      // A surface needs a component with the root id; report it once the whole Send is applied.
      rootChecks.forEach((index, surfaceId) => {
        const surface = processor.getSurface(surfaceId)
        if (surface && !surface.componentsModel.get(surface.rootId)) {
          const text = `Surface "${surfaceId}" has no root component (a component with id "${surface.rootId}").`
          setErrors((prev) => [...prev, { index, message: text }])
        }
      })
    },
    [addLog, create],
  )
  useEffect(() => {
    sendRef.current = send
  }, [send])

  const reset = useCallback(() => {
    teardown()
    setSurfaces([])
    setLog([])
    setErrors([])
    setDataModels({})
    create()
  }, [teardown, create])

  const setReplies = useCallback((replies: LabReplies | null) => {
    repliesRef.current = replies
  }, [])

  return { surfaces, log, errors, dataModels, send, reset, setReplies }
}
