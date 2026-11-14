/**
 * Spec: learning-fields - Topics of an area, Draft topics with the agent.
 */
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { ChatRequest } from '../api'
import { installFakeApi, makeField, twoProviders, type FakeState } from '../test/fakeApi'
import { renderAppReady } from '../test/render'

function setup(topics: { slug: string; title: string; parent?: string | null }[] = []) {
  const state = installFakeApi()
  state.fields.push(makeField('Cloud', [{ slug: 'aws', title: 'AWS', topics }]))
  return state
}

const puts = (state: FakeState) => state.calls.filter((c) => c.method === 'PUT' && c.url === '/api/areas/aws/topics')

describe('topic editor', () => {
  it('adds topics, saves them with Save, and the map shows them with lesson pages', async () => {
    const state = setup()
    const { user } = await renderAppReady('#/roadmap/aws')
    await user.click(await screen.findByRole('button', { name: 'Add topics' }))
    const editor = screen.getByRole('form', { name: 'Topics of AWS' })
    const save = within(editor).getByRole('button', { name: 'Save' })
    expect(save).toBeDisabled()

    await user.click(within(editor).getByRole('button', { name: 'Add topic' }))
    await user.type(within(editor).getByRole('textbox', { name: 'Title of topic 1' }), 'IAM')
    expect(within(editor).getByRole('textbox', { name: 'Slug of topic 1' })).toHaveValue('iam')
    await user.click(within(editor).getByRole('button', { name: 'Add topic' }))
    await user.type(within(editor).getByRole('textbox', { name: 'Title of topic 2' }), 'EC2')
    await user.selectOptions(within(editor).getByRole('combobox', { name: 'Parent of topic 2' }), 'iam')
    expect(save).toBeEnabled()
    expect(puts(state)).toHaveLength(0)
    await user.click(save)

    expect(await screen.findByTestId('node-aws/iam')).toBeInTheDocument()
    expect(screen.getByTestId('node-aws/ec2')).toBeInTheDocument()
    expect(screen.queryByRole('form', { name: 'Topics of AWS' })).not.toBeInTheDocument()
    expect(puts(state)[0].body).toEqual({
      topics: [
        { slug: 'iam', title: 'IAM', description: null, parent: null },
        { slug: 'ec2', title: 'EC2', description: null, parent: 'iam' },
      ],
    })
    fireEvent.click(screen.getByTestId('node-aws/iam'))
    expect(await screen.findByRole('article', { name: 'Lesson: IAM' })).toBeInTheDocument()
    expect(window.location.hash).toBe('#/lesson/aws/iam')
  })

  it('edits saved topics: locked slug, move, remove; Cancel discards without saving', async () => {
    const state = setup([
      { slug: 'iam', title: 'IAM' },
      { slug: 'ec2', title: 'EC2' },
      { slug: 's3', title: 'S3', parent: 'ec2' },
    ])
    const { user } = await renderAppReady('#/roadmap/aws')
    await user.click(await screen.findByRole('button', { name: 'Edit topics' }))
    const editor = screen.getByRole('form', { name: 'Topics of AWS' })
    expect(within(editor).getByRole('textbox', { name: 'Slug of topic 1' })).toHaveAttribute('readonly')

    await user.click(within(editor).getByRole('button', { name: 'Move IAM down' }))
    expect(within(editor).getByRole('textbox', { name: 'Title of topic 2' })).toHaveValue('IAM')
    await user.click(within(editor).getByRole('button', { name: 'Remove EC2' }))
    // S3 lost its parent with EC2.
    expect(within(editor).getByRole('combobox', { name: 'Parent of topic 2' })).toHaveValue('')
    await user.click(within(editor).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('form', { name: 'Topics of AWS' })).not.toBeInTheDocument()
    expect(puts(state)).toHaveLength(0)
    expect(await screen.findByTestId('node-aws/ec2')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Edit topics' }))
    const again = screen.getByRole('form', { name: 'Topics of AWS' })
    await user.click(within(again).getByRole('button', { name: 'Remove EC2' }))
    await user.click(within(again).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(screen.queryByTestId('node-aws/ec2')).not.toBeInTheDocument())
    expect(screen.getByTestId('node-aws/iam')).toBeInTheDocument()
    expect(puts(state)[0].body).toEqual({
      topics: [
        { slug: 'iam', title: 'IAM', description: null, parent: null },
        { slug: 's3', title: 'S3', description: null, parent: null },
      ],
    })
  })

  it('saves nothing and shows what is wrong for a repeated slug', async () => {
    const state = setup()
    const { user } = await renderAppReady('#/roadmap/aws')
    await user.click(await screen.findByRole('button', { name: 'Add topics' }))
    const editor = screen.getByRole('form', { name: 'Topics of AWS' })
    for (const n of [1, 2]) {
      await user.click(within(editor).getByRole('button', { name: 'Add topic' }))
      await user.type(within(editor).getByRole('textbox', { name: `Title of topic ${n}` }), 'IAM')
    }
    await user.click(within(editor).getByRole('button', { name: 'Save' }))
    expect(await within(editor).findByRole('alert')).toHaveTextContent("the slug 'iam' is used twice")
    expect(screen.getByRole('form', { name: 'Topics of AWS' })).toBeInTheDocument()
    expect(state.fields[0].areas[0].topics).toEqual([])
  })

  it('shows the API message for a parent that does not exist', async () => {
    const state = setup()
    const { user } = await renderAppReady('#/roadmap/aws')
    await user.click(await screen.findByRole('button', { name: 'Add topics' }))
    const editor = screen.getByRole('form', { name: 'Topics of AWS' })
    await user.click(within(editor).getByRole('button', { name: 'Add topic' }))
    await user.type(within(editor).getByRole('textbox', { name: 'Title of topic 1' }), 'IAM')
    await user.click(within(editor).getByRole('button', { name: 'Add topic' }))
    await user.type(within(editor).getByRole('textbox', { name: 'Title of topic 2' }), 'EC2')
    await user.selectOptions(within(editor).getByRole('combobox', { name: 'Parent of topic 2' }), 'iam')
    // The parent row gets another slug afterwards: the child now points at a topic that is gone.
    const slug = within(editor).getByRole('textbox', { name: 'Slug of topic 1' })
    await user.clear(slug)
    await user.type(slug, 'identity')
    await user.click(within(editor).getByRole('button', { name: 'Save' }))
    expect(await within(editor).findByRole('alert')).toHaveTextContent("the parent 'iam' of 'ec2' does not exist")
    expect(state.fields[0].areas[0].topics).toEqual([])
  })

  it('renames and deletes an area from the map page, with a confirmation for delete', async () => {
    const state = setup([{ slug: 'iam', title: 'IAM' }])
    const { user } = await renderAppReady('#/roadmap/aws')
    await user.click(await screen.findByRole('button', { name: 'Area actions' }))
    await user.click(screen.getByRole('menuitem', { name: 'Rename area' }))
    const form = screen.getByRole('form', { name: 'Rename area' })
    expect(within(form).getByRole('button', { name: 'Save' })).toBeDisabled()
    const input = within(form).getByRole('textbox', { name: 'Area title' })
    await user.clear(input)
    await user.type(input, 'Amazon')
    await user.click(within(form).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(state.fields[0].areas[0].title).toBe('Amazon'))
    expect(await screen.findByRole('tab', { name: 'Amazon' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Area actions' }))
    await user.click(screen.getByRole('menuitem', { name: 'Delete area' }))
    const confirm = screen.getByRole('alertdialog', { name: 'Confirm delete area' })
    await user.click(within(confirm).getByRole('button', { name: 'Cancel' }))
    expect(state.fields[0].areas).toHaveLength(1)
    await user.click(screen.getByRole('button', { name: 'Area actions' }))
    await user.click(screen.getByRole('menuitem', { name: 'Delete area' }))
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Yes, delete' }))
    await waitFor(() => expect(state.fields[0].areas).toHaveLength(0))
    await waitFor(() => expect(window.location.hash).toBe('#/'))
  })
})

describe('draft topics with the agent', () => {
  const proposal = {
    area: 'aws',
    topics: [
      { slug: 'iam', title: 'IAM', description: 'Who may do what.' },
      { slug: 'iam-policies', title: 'Policies', parent: 'iam' },
    ],
  }

  it('offers Draft topics with agent only when a provider is active', async () => {
    setup()
    await renderAppReady('#/roadmap/aws')
    expect(await screen.findByRole('button', { name: 'Add topics' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Draft topics with agent' })).not.toBeInTheDocument()
  })

  it('asks the outline agent, then Review in editor fills the editor and nothing is saved until Save', async () => {
    const state = setup()
    state.providers = twoProviders()
    let asked: ChatRequest | null = null
    state.chat = (body) => {
      asked = body
      return { reply: 'Here is a draft with 2 topics.', proposed_topics: proposal }
    }
    const { user } = await renderAppReady('#/roadmap/aws')
    await user.click(await screen.findByRole('button', { name: 'Draft topics with agent' }))

    const agent = screen.getByRole('complementary', { name: 'Agent' })
    const review = await within(agent).findByRole('button', { name: 'Review in editor' })
    expect(asked).not.toBeNull()
    expect(asked!.agent_id).toBe('outline')
    expect(asked!.page).toEqual({ kind: 'roadmap', domain: 'aws' })
    expect(puts(state)).toHaveLength(0)

    await user.click(review)
    const editor = await screen.findByRole('form', { name: 'Topics of AWS' })
    expect(within(editor).getByRole('textbox', { name: 'Title of topic 1' })).toHaveValue('IAM')
    expect(within(editor).getByRole('textbox', { name: 'Description of topic 1' })).toHaveValue('Who may do what.')
    expect(within(editor).getByRole('textbox', { name: 'Title of topic 2' })).toHaveValue('Policies')
    expect(within(editor).getByRole('combobox', { name: 'Parent of topic 2' })).toHaveValue('iam')
    // Nothing is saved yet: the area is still empty.
    expect(puts(state)).toHaveLength(0)
    expect(state.fields[0].areas[0].topics).toEqual([])

    await user.click(within(editor).getByRole('button', { name: 'Save' }))
    expect(await screen.findByTestId('node-aws/iam')).toBeInTheDocument()
    expect(screen.getByTestId('node-aws/iam-policies')).toBeInTheDocument()
    expect(puts(state)).toHaveLength(1)
  })

  it('Cancel after Review in editor leaves the area empty', async () => {
    const state = setup()
    state.providers = twoProviders()
    state.chat = () => ({ reply: 'Draft.', proposed_topics: proposal })
    const { user } = await renderAppReady('#/roadmap/aws')
    await user.click(await screen.findByRole('button', { name: 'Draft topics with agent' }))
    await user.click(await screen.findByRole('button', { name: 'Review in editor' }))
    const editor = await screen.findByRole('form', { name: 'Topics of AWS' })
    await user.click(within(editor).getByRole('button', { name: 'Cancel' }))
    expect(await screen.findByText('This area has no topics yet.')).toBeInTheDocument()
    expect(puts(state)).toHaveLength(0)
  })
})
