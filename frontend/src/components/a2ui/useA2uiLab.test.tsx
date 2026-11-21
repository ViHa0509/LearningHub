import { act, render, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { A2uiSurface, MarkdownComponentContext } from '@a2ui/react/v0_9'
import { ComponentContext } from '@a2ui/web_core/v0_9'
import { basicCatalog } from '@a2ui/web_core/v0_9/basic_catalog'
import { LabMarkdown } from './LabMarkdown'
import { useA2uiLab } from './useA2uiLab'

const V = 'v0.9'
const create = (surfaceId: string) => ({
  version: V,
  createSurface: { surfaceId, catalogId: basicCatalog.id },
})
const components = (surfaceId: string, list: Record<string, unknown>[]) => ({
  version: V,
  updateComponents: { surfaceId, components: list },
})
const data = (surfaceId: string, path: string, value: unknown) => ({
  version: V,
  updateDataModel: { surfaceId, path, value },
})

const helloSteps = [
  create('hello'),
  components('hello', [{ id: 'root', component: 'Text', text: { path: '/title' } }]),
  data('hello', '/title', 'Hello'),
]

describe('useA2uiLab', () => {
  it('logs three messages in order and lists the surface', () => {
    const { result } = renderHook(() => useA2uiLab())
    act(() => result.current.send(helloSteps, 'editor'))
    expect(result.current.errors).toEqual([])
    expect(result.current.log.map((e) => e.message)).toEqual(helloSteps)
    expect(
      result.current.log.every((e) => e.direction === 'agent→renderer' && e.source === 'editor'),
    ).toBe(true)
    expect(result.current.surfaces.map((s) => s.id)).toEqual(['hello'])
    expect(result.current.dataModels.hello).toEqual({ title: 'Hello' })
  })

  it('reports an unknown component with its index and keeps earlier messages', () => {
    const { result } = renderHook(() => useA2uiLab())
    act(() =>
      result.current.send(
        [
          create('form'),
          components('form', [{ id: 'root', component: 'Carousel' }]),
          data('form', '/a', 1),
        ],
        'editor',
      ),
    )
    expect(result.current.errors).toHaveLength(1)
    expect(result.current.errors[0].index).toBe(2)
    expect(result.current.errors[0].message).toContain('Carousel')
    expect(result.current.surfaces.map((s) => s.id)).toEqual(['form'])
    expect(result.current.dataModels.form).toEqual({ a: 1 })
  })

  it('removes a deleted surface and its data model', () => {
    const { result } = renderHook(() => useA2uiLab())
    act(() => result.current.send(helloSteps, 'editor'))
    act(() =>
      result.current.send([{ version: V, deleteSurface: { surfaceId: 'hello' } }], 'editor'),
    )
    expect(result.current.surfaces).toEqual([])
    expect(result.current.dataModels).toEqual({})
  })

  it('reset empties surfaces, log, errors and data models, and still works after', () => {
    const { result } = renderHook(() => useA2uiLab())
    act(() => result.current.send([...helloSteps, { version: V, bogus: {} }], 'editor'))
    expect(result.current.errors.length).toBeGreaterThan(0)
    act(() => result.current.reset())
    expect(result.current.surfaces).toEqual([])
    expect(result.current.log).toEqual([])
    expect(result.current.errors).toEqual([])
    expect(result.current.dataModels).toEqual({})
    act(() => result.current.send(helloSteps, 'sample'))
    expect(result.current.errors).toEqual([])
    expect(result.current.surfaces).toHaveLength(1)
  })

  it('updates the data model live when a bound input changes', () => {
    const { result } = renderHook(() => useA2uiLab())
    act(() => result.current.send([create('f'), data('f', '/user/name', 'Ana')], 'editor'))
    expect(result.current.dataModels.f).toEqual({ user: { name: 'Ana' } })
    act(() => {
      result.current.surfaces[0].dataModel.set('/user/name', 'Bo')
    })
    expect(result.current.dataModels.f).toEqual({ user: { name: 'Bo' } })
  })

  it('logs an action with its resolved context', async () => {
    const { result } = renderHook(() => useA2uiLab())
    act(() =>
      result.current.send(
        [
          create('f'),
          components('f', [
            { id: 'root', component: 'Column', children: ['field', 'btn'] },
            { id: 'field', component: 'TextField', label: 'Name', value: { path: '/user/name' } },
            { id: 'label', component: 'Text', text: 'Go' },
            {
              id: 'btn',
              component: 'Button',
              child: 'label',
              action: { event: { name: 'submit', context: { name: { path: '/user/name' } } } },
            },
          ]),
          data('f', '/user/name', 'Ana'),
        ],
        'editor',
      ),
    )
    expect(result.current.errors).toEqual([])
    const surface = result.current.surfaces[0]
    // The same path a Button click takes (bindings resolved, then dispatched), minus the DOM.
    await act(async () => {
      const ctx = new ComponentContext(surface, 'btn')
      const action = { event: { name: 'submit', context: { name: { path: '/user/name' } } } }
      const resolved = ctx.dataContext.resolveAction(action, { userActivation: true })
      await ctx.dispatchAction(resolved as Record<string, unknown>)
    })
    const entry = result.current.log.at(-1)!
    expect(entry.direction).toBe('renderer→agent')
    expect(entry.source).toBe('user')
    const action = (entry.message as { action: Record<string, unknown> }).action
    expect(action.name).toBe('submit')
    expect(action.surfaceId).toBe('f')
    expect(action.sourceComponentId).toBe('btn')
    expect(typeof action.timestamp).toBe('string')
    expect(action.context).toEqual({ name: 'Ana' })
    expect(result.current.log).toHaveLength(4)
  })

  it('sends a scripted reply after the matching action only', async () => {
    const { result } = renderHook(() => useA2uiLab())
    act(() => {
      result.current.setReplies({ answer: [data('f', '/result', 'Right')] })
      result.current.send([create('f')], 'sample')
    })
    const surface = result.current.surfaces[0]
    await act(async () => {
      await surface.dispatchAction({ event: { name: 'other', context: {} } }, 'b')
    })
    expect(result.current.log).toHaveLength(2)
    expect(result.current.dataModels.f).toEqual({})
    await act(async () => {
      await surface.dispatchAction({ event: { name: 'answer', context: {} } }, 'b')
    })
    const tail = result.current.log.slice(-2)
    expect(tail.map((e) => [e.direction, e.source])).toEqual([
      ['renderer→agent', 'user'],
      ['agent→renderer', 'scripted agent'],
    ])
    expect(result.current.dataModels.f).toEqual({ result: 'Right' })
  })

  it('hands surfaces to A2uiSurface', async () => {
    const { result } = renderHook(() => useA2uiLab())
    act(() => result.current.send(helloSteps, 'editor'))
    const { container } = render(
      <MarkdownComponentContext.Provider value={LabMarkdown}>
        <A2uiSurface surface={result.current.surfaces[0]} />
      </MarkdownComponentContext.Provider>,
    )
    await waitFor(() => expect(container.firstChild).not.toBeNull())
  })
})
