import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ComponentContext } from '@a2ui/web_core/v0_9'
import { basicCatalog } from '@a2ui/web_core/v0_9/basic_catalog'
import { parseLabInput } from './parseLabInput'
import { LAB_SAMPLES, type LabSample } from './samples'
import { useA2uiLab } from './useA2uiLab'

const sample = (id: string): LabSample => LAB_SAMPLES.find((s) => s.id === id)!

describe('lab samples', () => {
  it('has the five samples, hello with 3 steps', () => {
    expect(LAB_SAMPLES.map((s) => s.id)).toEqual(['hello', 'form', 'list', 'quiz', 'invalid'])
    expect(sample('hello').steps).toHaveLength(3)
    for (const s of LAB_SAMPLES) {
      expect(s.title).toBeTruthy()
      expect(s.description).toBeTruthy()
    }
  })

  it('every step is accepted by the lab input parser and uses the basic catalog id', () => {
    for (const s of LAB_SAMPLES) {
      for (const step of s.steps) {
        const parsed = parseLabInput(JSON.stringify(step, null, 2))
        expect(parsed.ok).toBe(true)
        for (const m of step) {
          const create = m.createSurface as { catalogId: string } | undefined
          if (create) expect(create.catalogId).toBe(basicCatalog.id)
        }
      }
    }
  })

  it.each(['hello', 'form', 'list', 'quiz'])('%s: every step processes with no error', (id) => {
    const { result } = renderHook(() => useA2uiLab())
    for (const step of sample(id).steps) {
      act(() => result.current.send(step, 'sample'))
    }
    expect(result.current.errors).toEqual([])
    expect(result.current.surfaces).toHaveLength(1)
  })

  it('hello: the first step only creates the surface, the last fills the title', () => {
    const { result } = renderHook(() => useA2uiLab())
    const { steps } = sample('hello')
    act(() => result.current.send(steps[0], 'sample'))
    expect(result.current.log).toHaveLength(1)
    expect(result.current.dataModels.hello).toEqual({})
    act(() => result.current.send(steps[1], 'sample'))
    act(() => result.current.send(steps[2], 'sample'))
    expect(result.current.dataModels.hello).toEqual({ title: 'Hello' })
  })

  it('form: the submit action carries the typed name as context', async () => {
    const { result } = renderHook(() => useA2uiLab())
    act(() => result.current.send(sample('form').steps[0], 'sample'))
    const surface = result.current.surfaces[0]
    act(() => {
      surface.dataModel.set('/user/name', 'Ana')
    })
    expect(result.current.dataModels.form).toEqual({ user: { name: 'Ana' } })
    await act(async () => {
      const ctx = new ComponentContext(surface, 'submit')
      const raw = surface.componentsModel.get('submit')!.properties.action
      const resolved = ctx.dataContext.resolveAction(raw, { userActivation: true })
      await ctx.dispatchAction(resolved as Record<string, unknown>)
    })
    const entry = result.current.log.at(-1)!
    expect(entry.direction).toBe('renderer→agent')
    expect((entry.message as { action: { name: string; context: unknown } }).action).toMatchObject({
      name: 'submit',
      context: { name: 'Ana' },
    })
  })

  it('list: the template children come from /items', () => {
    const { result } = renderHook(() => useA2uiLab())
    act(() => result.current.send(sample('list').steps[0], 'sample'))
    expect((result.current.dataModels.list as { items: unknown[] }).items).toHaveLength(3)
  })

  it('invalid: reports the unknown component and the missing root with message numbers', () => {
    const { result } = renderHook(() => useA2uiLab())
    for (const step of sample('invalid').steps) {
      act(() => result.current.send(step, 'sample'))
    }
    const { errors } = result.current
    expect(errors).toHaveLength(2)
    expect(errors[0].index).toBe(2)
    expect(errors[0].message).toContain('Carousel')
    expect(errors[1].index).toBe(3)
    expect(errors[1].message).toContain('root')
    expect(result.current.surfaces.map((s) => s.id)).toEqual(['broken'])
  })

  it('quiz: the scripted reply runs after the answer action', async () => {
    const quiz = sample('quiz')
    const { result } = renderHook(() => useA2uiLab())
    act(() => {
      result.current.setReplies(quiz.replies ?? null)
      result.current.send(quiz.steps[0], 'sample')
    })
    const surface = result.current.surfaces[0]
    act(() => {
      surface.dataModel.set('/answer', ['createSurface'])
    })
    await act(async () => {
      const ctx = new ComponentContext(surface, 'check')
      const raw = surface.componentsModel.get('check')!.properties.action
      const resolved = ctx.dataContext.resolveAction(raw, { userActivation: true })
      await ctx.dispatchAction(resolved as Record<string, unknown>)
    })
    const tail = result.current.log.slice(-2)
    expect(tail.map((e) => [e.direction, e.source])).toEqual([
      ['renderer→agent', 'user'],
      ['agent→renderer', 'scripted agent'],
    ])
    expect((tail[0].message as { action: unknown }).action).toMatchObject({
      name: 'answer',
      context: { choice: ['createSurface'] },
    })
    expect(result.current.errors).toEqual([])
    expect((result.current.dataModels.quiz as { result: string }).result).toContain('scripted agent')
  })
})
