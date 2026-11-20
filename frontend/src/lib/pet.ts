import { useEffect, useEffectEvent, useRef, useState } from 'react'

export type PetPose = 'idle' | 'thinking' | 'done' | 'error'

/** The only lines the pet ever says. Nothing from an answer, a note or an error message goes in. */
export const PET_LINES = {
  greeting: 'Hi! What are we learning today?',
  thinking: 'Thinking…',
  done: 'Done!',
  error: "That didn't work. Try again?",
} as const

export const GREETING_MS = 6000
export const DONE_MS = 4000
export const ERROR_MS = 6000

export interface PetState {
  pose: PetPose
  /** The bubble line; null when there is no bubble. */
  line: string | null
}

/** Only the question "did the newest entry fail?" is asked of the chat; its text is never read. */
interface ChatEntryLike {
  error?: unknown
}

/**
 * The pet's state from the chat. Thinking while a request runs; when it ends, done (4 s) or error
 * (6 s) when the newest entry failed, then idle. A greeting shows for 6 s at first mount.
 * Opening a past chat or clearing the chat does not change the pose.
 */
export function usePetState({ busy, entries }: { busy: boolean; entries: readonly ChatEntryLike[] }): PetState {
  const [state, setState] = useState<PetState>(
    busy ? { pose: 'thinking', line: PET_LINES.thinking } : { pose: 'idle', line: PET_LINES.greeting },
  )
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const was = useRef(busy)
  const newestFailed = entries.length > 0 && Boolean(entries[entries.length - 1].error)
  const failed = useEffectEvent(() => newestFailed)

  const clear = () => {
    if (timer.current !== null) clearTimeout(timer.current)
    timer.current = null
  }
  const later = (ms: number) => {
    clear()
    timer.current = setTimeout(() => {
      timer.current = null
      setState({ pose: 'idle', line: null })
    }, ms)
  }

  // The greeting at first mount.
  useEffect(() => {
    if (!busy) later(GREETING_MS)
    return clear
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, at mount
  }, [])

  useEffect(() => {
    const before = was.current
    was.current = busy
    if (busy) {
      clear()
      setState({ pose: 'thinking', line: PET_LINES.thinking })
    } else if (before) {
      if (failed()) {
        setState({ pose: 'error', line: PET_LINES.error })
        later(ERROR_MS)
      } else {
        setState({ pose: 'done', line: PET_LINES.done })
        later(DONE_MS)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only a change of busy moves the pet
  }, [busy])

  return state
}

/** The pet's pixel drawing: 16x16, one letter per pixel. o outline, b body, l leaf, t eyes and mouth. */
const BODY = [
  '................',
  '................',
  '................',
  '................',
  '................',
  '....oooooooo....',
  '...obbbbbbbbo...',
  '..obbbbbbbbbbo..',
  '..obbbbbbbbbbo..',
  '..obbbbbbbbbbo..',
  '..obbbbbbbbbbo..',
  '..obbbbbbbbbbo..',
  '...obbbbbbbbo...',
  '....oooooooo....',
  '.....oo..oo.....',
  '................',
]

const LEAF_UP = [
  '................',
  '..........ll....',
  '.........llll...',
  '.......oolll....',
  '.......o........',
]

const LEAF_DOWN = [
  '................',
  '................',
  '................',
  '................',
  '....llllo.......',
  '...ll...........',
]

const FACES: Record<PetPose, string[]> = {
  idle: [
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '.....t....t.....',
    '.....t....t.....',
    '................',
    '.......tt.......',
  ],
  thinking: [
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '.....t....t.....',
    '.....t....t.....',
    '................',
    '................',
    '................',
  ],
  done: [
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '.....t....t.....',
    '....t.t..t.t....',
    '......t..t......',
    '.......tt.......',
  ],
  error: [
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '.....t....t.....',
    '.....t....t.....',
    '................',
    '......tttt......',
  ],
}

export interface Pixel {
  x: number
  y: number
  /** o, b, l or t. */
  kind: string
}

function pixelsOf(rows: readonly string[]): Pixel[] {
  const out: Pixel[] = []
  rows.forEach((row, y) =>
    [...row].forEach((kind, x) => {
      if (kind !== '.') out.push({ x, y, kind })
    }),
  )
  return out
}

const BODY_PIXELS = pixelsOf(BODY)
const LEAF_PIXELS = { up: pixelsOf(LEAF_UP), down: pixelsOf(LEAF_DOWN) }
const FACE_PIXELS = {
  idle: pixelsOf(FACES.idle),
  thinking: pixelsOf(FACES.thinking),
  done: pixelsOf(FACES.done),
  error: pixelsOf(FACES.error),
}
/** The three dots of the thinking pose, above the pet's head to the right. */
export const THINKING_DOTS: Pixel[] = [
  { x: 6, y: 10, kind: 't' },
  { x: 8, y: 10, kind: 't' },
  { x: 10, y: 10, kind: 't' },
]

/** The pixel groups of one pose. */
export function pixelsFor(pose: PetPose): { body: Pixel[]; leaf: Pixel[]; face: Pixel[] } {
  return {
    body: BODY_PIXELS,
    leaf: pose === 'error' ? LEAF_PIXELS.down : LEAF_PIXELS.up,
    face: FACE_PIXELS[pose],
  }
}
