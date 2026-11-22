import { useMemo, useState } from 'react'
import { A2uiSurface, MarkdownComponentContext, type ReactCatalogComponent } from '@a2ui/react/v0_9'
import { MessageProcessor } from '@a2ui/web_core/v0_9'
import { api, type SurfaceOut } from '../../api'
import { LabMarkdown } from '../a2ui/LabMarkdown'
import { createLabCatalog } from '../a2ui/labCatalog'
import '../a2ui/a2ui-theme.css'

type Processor = MessageProcessor<ReactCatalogComponent>
type ShownSurface = NonNullable<ReturnType<Processor['getSurface']>>
type ActionPayload = Parameters<NonNullable<ConstructorParameters<typeof MessageProcessor>[1]>>[0]

function snapshot(value: unknown): unknown {
  try {
    return JSON.parse(JSON.stringify(value ?? {}))
  } catch {
    return {}
  }
}

/**
 * One A2UI surface of an answer (quiz, practice, lesson). The processor is made once per surface
 * and replays the stored messages on mount. An action goes to the grading route and the returned
 * messages are applied; an error is shown under the surface. A surface that cannot be processed is
 * replaced by a short note; the answer text around it stays.
 */
export default function ChatSurface({ surface }: { surface: SurfaceOut }) {
  const [error, setError] = useState<string | null>(null)

  // The processor is made once per surface and fills synchronously, so nothing is set in an effect.
  // It is not disposed: it holds no timers or listeners outside this component and is collected with it.
  const { shown, broken } = useMemo(() => {
    const status = { failed: false }
    const processor: Processor = new MessageProcessor<ReactCatalogComponent>(
      [createLabCatalog()],
      (action: ActionPayload) => {
        setError(null)
        api
          .a2uiAction(surface.id, {
            version: 'v0.9',
            action: {
              name: action.name,
              surfaceId: action.surfaceId,
              sourceComponentId: action.sourceComponentId,
              timestamp: action.timestamp,
              context: snapshot(action.context),
            },
          })
          .then((reply) => processor.processMessages(reply.messages as never))
          .catch((err: unknown) => setError(err instanceof Error ? err.message : 'The action failed.'))
      },
      {
        errorHandler: () => {
          status.failed = true
        },
        reportErrorsOnly: true,
      },
    )
    try {
      processor.processMessages(surface.messages as never)
    } catch {
      status.failed = true
    }
    const first: ShownSurface | undefined = Array.from(processor.model.surfacesMap.values())[0]
    const ok = !status.failed && first !== undefined && Boolean(first.componentsModel.get(first.rootId))
    return { shown: ok ? first : null, broken: !ok }
  }, [surface])

  if (broken || !shown) {
    return <p className="chat-surface-error muted">This interactive part could not be shown.</p>
  }
  return (
    <div className="a2ui-theme chat-surface">
      <MarkdownComponentContext.Provider value={LabMarkdown}>
        <A2uiSurface surface={shown} />
      </MarkdownComponentContext.Provider>
      {error && (
        <p className="chat-surface-error" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
