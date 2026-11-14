/**
 * Spec: home-page - Home page tabs per field; learning-fields - Fields and areas, Published fields.
 */
import { screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { installFakeApi, makeField, OWNER, requireLogin } from '../test/fakeApi'
import { renderAppReady } from '../test/render'

const cloud = () =>
  makeField('Cloud', [
    { slug: 'aws', title: 'AWS', description: 'Amazon Web Services.' },
    { slug: 'azure', title: 'Azure' },
  ])

const tab = (name: string) => screen.findByRole('tab', { name })

describe('home page tabs per field', () => {
  it('shows only the IT tab with the six role cards and New field for a user without fields', async () => {
    installFakeApi()
    await renderAppReady()
    const tabs = await screen.findByRole('tablist', { name: 'Fields' })
    expect(within(tabs).getAllByRole('tab').map((t) => t.textContent)).toEqual(['IT'])
    expect(within(tabs).getByRole('tab', { name: 'IT' })).toHaveAttribute('aria-selected', 'true')
    const home = screen.getByRole('region', { name: 'Home' })
    expect(within(home).getAllByRole('link')).toHaveLength(6)
    expect(within(home).getByRole('button', { name: 'New field' })).toBeInTheDocument()
    // The built-in field has no field menu and no New area.
    expect(screen.queryByRole('button', { name: 'New area' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Field actions' })).not.toBeInTheDocument()
  })

  it('shows the cards of the chosen tab and remembers the tab after a reload', async () => {
    const state = installFakeApi()
    state.fields.push(cloud())
    const first = await renderAppReady()
    await first.user.click(await tab('Cloud'))
    expect(screen.getByRole('tab', { name: 'Cloud' })).toHaveAttribute('aria-selected', 'true')
    const panel = screen.getByRole('tabpanel', { name: 'Cloud' })
    const cards = within(panel).getAllByRole('link')
    expect(cards.map((c) => within(c).getByRole('heading').textContent)).toEqual(['AWS', 'Azure'])
    expect(within(panel).getByText('Amazon Web Services.')).toBeInTheDocument()
    expect(cards[0]).toHaveAttribute('href', '#/roadmap/aws')
    first.unmount()

    await renderAppReady()
    expect(await tab('Cloud')).toHaveAttribute('aria-selected', 'true')
    expect(within(screen.getByRole('tabpanel', { name: 'Cloud' })).getAllByRole('link')).toHaveLength(2)
  })

  it('falls back to IT when the remembered tab is gone, and works with blocked storage', async () => {
    localStorage.setItem('learninghub.homeTab', 'field-gone')
    installFakeApi()
    await renderAppReady()
    expect(await tab('IT')).toHaveAttribute('aria-selected', 'true')
  })

  it('creates a field with Save and shows its tab; Cancel creates nothing', async () => {
    const state = installFakeApi()
    const { user } = await renderAppReady()
    await user.click(await screen.findByRole('button', { name: 'New field' }))
    const form = screen.getByRole('form', { name: 'New field' })
    const save = within(form).getByRole('button', { name: 'Save' })
    expect(save).toBeDisabled()
    await user.click(within(form).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('form', { name: 'New field' })).not.toBeInTheDocument()
    expect(state.calls.some((c) => c.method === 'POST' && c.url === '/api/fields')).toBe(false)

    await user.click(screen.getByRole('button', { name: 'New field' }))
    await user.type(screen.getByRole('textbox', { name: 'Field name' }), 'Cloud{Enter}')
    expect(await tab('Cloud')).toHaveAttribute('aria-selected', 'true')
    expect(state.calls.find((c) => c.method === 'POST' && c.url === '/api/fields')?.body).toEqual({ title: 'Cloud' })
    expect(screen.getByText('No areas yet. Add one with New area.')).toBeInTheDocument()
    expect(localStorage.getItem('learninghub.homeTab')).toBe(state.fields[0].id)
  })

  it('creates an area with a slug made from the title, and its map opens', async () => {
    const state = installFakeApi()
    state.fields.push(makeField('Cloud'))
    const { user } = await renderAppReady()
    await user.click(await tab('Cloud'))
    await user.click(screen.getByRole('button', { name: 'New area' }))
    const form = screen.getByRole('form', { name: 'New area' })
    expect(within(form).getByRole('button', { name: 'Save' })).toBeDisabled()
    await user.type(within(form).getByRole('textbox', { name: 'Area title' }), 'AWS')
    expect(within(form).getByRole('textbox', { name: 'Slug' })).toHaveValue('aws')
    await user.click(within(form).getByRole('button', { name: 'Save' }))

    const card = await screen.findByRole('link', { name: /^AWS/ })
    expect(card).toHaveAttribute('href', '#/roadmap/aws')
    expect(state.calls.find((c) => c.url.endsWith('/areas'))?.body).toEqual({ slug: 'aws', title: 'AWS' })
    await user.click(card)
    expect(window.location.hash).toBe('#/roadmap/aws')
    expect(await screen.findByText('This area has no topics yet.')).toBeInTheDocument()
  })

  it('refuses a slug that a built-in role or another area uses, and says it is taken', async () => {
    const state = installFakeApi()
    state.fields.push(cloud())
    const { user } = await renderAppReady()
    await user.click(await tab('Cloud'))
    for (const slug of ['backend', 'aws']) {
      await user.click(screen.getByRole('button', { name: 'New area' }))
      const form = screen.getByRole('form', { name: 'New area' })
      await user.type(within(form).getByRole('textbox', { name: 'Area title' }), 'Other')
      await user.clear(within(form).getByRole('textbox', { name: 'Slug' }))
      await user.type(within(form).getByRole('textbox', { name: 'Slug' }), slug)
      await user.click(within(form).getByRole('button', { name: 'Save' }))
      expect(await within(form).findByRole('alert')).toHaveTextContent(`The slug '${slug}' is already taken`)
      // The form stays open with what was typed.
      expect(within(form).getByRole('textbox', { name: 'Area title' })).toHaveValue('Other')
      await user.click(within(form).getByRole('button', { name: 'Cancel' }))
    }
    expect(state.fields[0].areas).toHaveLength(2)
  })

  it('renames a field with Save and deletes it only after a confirmation', async () => {
    const state = installFakeApi()
    state.fields.push(cloud())
    const { user } = await renderAppReady()
    await user.click(await tab('Cloud'))

    await user.click(screen.getByRole('button', { name: 'Field actions' }))
    await user.click(screen.getByRole('menuitem', { name: 'Rename' }))
    const form = screen.getByRole('form', { name: 'Rename field' })
    expect(within(form).getByRole('button', { name: 'Save' })).toBeDisabled()
    const input = within(form).getByRole('textbox', { name: 'Field name' })
    await user.clear(input)
    await user.type(input, 'Cloud platforms')
    await user.click(within(form).getByRole('button', { name: 'Save' }))
    expect(await tab('Cloud platforms')).toHaveAttribute('aria-selected', 'true')
    expect(state.fields[0].title).toBe('Cloud platforms')

    await user.click(screen.getByRole('button', { name: 'Field actions' }))
    await user.click(screen.getByRole('menuitem', { name: 'Delete field' }))
    const confirm = screen.getByRole('alertdialog', { name: 'Confirm delete field' })
    await user.click(within(confirm).getByRole('button', { name: 'Cancel' }))
    expect(state.fields).toHaveLength(1)

    await user.click(screen.getByRole('button', { name: 'Field actions' }))
    await user.click(screen.getByRole('menuitem', { name: 'Delete field' }))
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Yes, delete' }))
    await waitFor(() => expect(state.fields).toHaveLength(0))
    await waitFor(() => expect(screen.queryByRole('tab', { name: 'Cloud platforms' })).not.toBeInTheDocument())
    expect(screen.getByRole('tab', { name: 'IT' })).toHaveAttribute('aria-selected', 'true')
  })

  it('offers Publish to the admin only, and Unpublish once published', async () => {
    const admin = installFakeApi()
    admin.fields.push(cloud())
    const first = await renderAppReady()
    await first.user.click(await tab('Cloud'))
    await first.user.click(screen.getByRole('button', { name: 'Field actions' }))
    await first.user.click(screen.getByRole('menuitem', { name: 'Publish' }))
    expect(await screen.findByText('Published')).toBeInTheDocument()
    expect(admin.calls.find((c) => c.method === 'PATCH' && c.url.startsWith('/api/fields/'))?.body).toEqual({
      published: true,
    })
    await first.user.click(screen.getByRole('button', { name: 'Field actions' }))
    expect(screen.getByRole('menuitem', { name: 'Unpublish' })).toBeInTheDocument()
    first.unmount()

    const member = installFakeApi()
    requireLogin(member, { signedIn: true, owner: { ...OWNER, role: 'member' } })
    member.fields.push(cloud())
    const second = await renderAppReady()
    await second.user.click(await tab('Cloud'))
    await second.user.click(screen.getByRole('button', { name: 'Field actions' }))
    expect(screen.getByRole('menuitem', { name: 'Rename' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Delete field' })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Publish' })).not.toBeInTheDocument()
  })

  it('shows a published field of someone else read only, with its map', async () => {
    const state = installFakeApi()
    requireLogin(state, { signedIn: true, owner: { ...OWNER, role: 'member' } })
    state.fields.push(
      makeField(
        'Driving licence',
        [
          {
            slug: 'car',
            title: 'Car',
            topics: [{ slug: 'signs', title: 'Road signs' }],
          },
        ],
        { mine: false, published: true },
      ),
    )
    const { user } = await renderAppReady()
    await user.click(await tab('Driving licence'))
    expect(screen.getByText(/Read only/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'New area' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Field actions' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('link', { name: /^Car/ }))
    expect(await screen.findByTestId('node-car/signs')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Edit topics' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Area actions' })).not.toBeInTheDocument()
  })

  it('does not show another user private field', async () => {
    const state = installFakeApi()
    state.fields.push(makeField('Secret', [{ slug: 'hidden' }], { mine: false, published: false }))
    await renderAppReady()
    await tab('IT')
    expect(screen.queryByRole('tab', { name: 'Secret' })).not.toBeInTheDocument()
  })
})
