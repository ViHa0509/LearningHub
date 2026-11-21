import { createComponentImplementation, type ReactCatalogComponent } from '@a2ui/react/v0_9'
import { Catalog } from '@a2ui/web_core/v0_9'
import { A2uiAudioPlayer, A2uiImage, A2uiVideo, basicCatalog } from '@a2ui/web_core/v0_9/basic_catalog'
import { BlockedMedia } from './BlockedMedia'
import { isAllowedMediaUrl } from './mediaUrl'

const label = (value: unknown) => (typeof value === 'string' && value ? value : undefined)

const labImage = createComponentImplementation(A2uiImage, ({ props }) => {
  if (!isAllowedMediaUrl(props.url, 'image')) return <BlockedMedia kind="image" url={props.url} />
  return (
    <img
      className={`a2ui-image a2ui-image-${props.variant ?? 'mediumFeature'}`}
      src={props.url}
      alt={label(props.description) ?? label(props.accessibility?.label) ?? ''}
      style={{ objectFit: props.fit === 'scaleDown' ? 'scale-down' : (props.fit ?? 'fill') }}
    />
  )
})

const labVideo = createComponentImplementation(A2uiVideo, ({ props }) => {
  if (!isAllowedMediaUrl(props.url, 'video')) return <BlockedMedia kind="video" url={props.url} />
  return <video className="a2ui-video" src={props.url} controls aria-label={label(props.accessibility?.label)} />
})

const labAudio = createComponentImplementation(A2uiAudioPlayer, ({ props }) => {
  if (!isAllowedMediaUrl(props.url, 'audio')) return <BlockedMedia kind="audio" url={props.url} />
  return (
    <figure className="a2ui-audio">
      {label(props.description) && <figcaption>{props.description}</figcaption>}
      <audio src={props.url} controls aria-label={label(props.accessibility?.label) ?? label(props.description)} />
    </figure>
  )
})

const GUARDED = new Map<string, ReactCatalogComponent>([
  ['Image', labImage],
  ['Video', labVideo],
  ['AudioPlayer', labAudio],
])

export type LabCatalog = Catalog<ReactCatalogComponent>

/**
 * The basic catalog (same id, so payloads use the standard `catalogId`) with Image, Video and
 * AudioPlayer replaced by versions that load only the app's own or `data:` media (design 6).
 */
export function createLabCatalog(): LabCatalog {
  const components: ReactCatalogComponent[] = [...basicCatalog.components.values()].map(
    (c) => GUARDED.get(c.name) ?? c,
  )
  return new Catalog<ReactCatalogComponent>(basicCatalog.id, basicCatalog.protocolVersion, components, [
    ...basicCatalog.functions.values(),
  ])
}
