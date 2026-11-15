import { useState } from 'react'
import type { Bank } from '../api'

/**
 * The banks that lack pictures. A bank stays listed once it has shown up, so the result of the
 * last upload is still readable when nothing is missing any more.
 */
export function useBanksLackingPictures(banks: Bank[] | undefined): Bank[] {
  const [seen, setSeen] = useState<string[]>([])
  const lacking = (banks ?? []).filter((b) => b.images_missing > 0).map((b) => b.id)
  if (lacking.some((id) => !seen.includes(id))) setSeen([...new Set([...seen, ...lacking])])
  return (banks ?? []).filter((b) => b.images_missing > 0 || seen.includes(b.id))
}

/** The most bytes of pictures sent in one request (the host's body limit is 4 MB). */
export const PICTURE_BATCH_BYTES = 3.5 * 1024 * 1024

/** Splits files into batches of at most `limit` bytes; a file over the limit goes alone. */
export function batchFiles(files: File[], limit = PICTURE_BATCH_BYTES): File[][] {
  const batches: File[][] = []
  let current: File[] = []
  let size = 0
  for (const file of files) {
    if (current.length > 0 && size + file.size > limit) {
      batches.push(current)
      current = []
      size = 0
    }
    current.push(file)
    size += file.size
    if (file.size > limit) {
      batches.push(current)
      current = []
      size = 0
    }
  }
  if (current.length > 0) batches.push(current)
  return batches
}
