import { describe, expect, it } from 'vitest'
import { parseRoute, routeHash } from './route'

describe('a2ui-lab route', () => {
  it('parses #/a2ui-lab and writes it back', () => {
    expect(parseRoute('#/a2ui-lab')).toEqual({ page: 'a2ui-lab' })
    expect(routeHash({ page: 'a2ui-lab' })).toBe('#/a2ui-lab')
  })

  it('does not match a longer path', () => {
    expect(parseRoute('#/a2ui-lab/x')).toEqual({ page: 'home' })
  })
})
