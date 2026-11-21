// Built-in A2UI v0.9 samples for the lab (design 9). Each step is one Send; `replies` are the
// messages a scripted agent sends after an action of that name.

export type LabSampleMessage = Record<string, unknown>

export interface LabSample {
  id: string
  title: string
  description: string
  steps: LabSampleMessage[][]
  replies?: Record<string, LabSampleMessage[]>
}

const V = 'v0.9'
const CATALOG = 'https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json'

const createSurface = (surfaceId: string): LabSampleMessage => ({
  version: V,
  createSurface: { surfaceId, catalogId: CATALOG },
})
const updateComponents = (
  surfaceId: string,
  components: Record<string, unknown>[],
): LabSampleMessage => ({ version: V, updateComponents: { surfaceId, components } })
const updateDataModel = (surfaceId: string, path: string, value: unknown): LabSampleMessage => ({
  version: V,
  updateDataModel: { surfaceId, path, value },
})

export const LAB_SAMPLES: LabSample[] = [
  {
    id: 'hello',
    title: 'Hello surface',
    description: 'Create a surface, give it a Text bound to the data model, then fill the data.',
    steps: [
      [createSurface('hello')],
      [updateComponents('hello', [{ id: 'root', component: 'Text', text: { path: '/title' }, variant: 'h2' }])],
      [updateDataModel('hello', '/title', 'Hello')],
    ],
  },
  {
    id: 'form',
    title: 'Form with two-way binding',
    description:
      'A TextField bound to /user/name and a Button whose action sends the name back as context.',
    steps: [
      [
        createSurface('form'),
        updateComponents('form', [
          { id: 'root', component: 'Card', child: 'body' },
          { id: 'body', component: 'Column', children: ['heading', 'name', 'submit'] },
          { id: 'heading', component: 'Text', text: 'Say hello', variant: 'h3' },
          { id: 'name', component: 'TextField', label: 'Your name', value: { path: '/user/name' } },
          { id: 'submit-label', component: 'Text', text: 'Submit' },
          {
            id: 'submit',
            component: 'Button',
            variant: 'primary',
            child: 'submit-label',
            action: { event: { name: 'submit', context: { name: { path: '/user/name' } } } },
          },
        ]),
        updateDataModel('form', '/user', { name: '' }),
      ],
    ],
  },
  {
    id: 'list',
    title: 'List from a template',
    description: 'A List that repeats one Text per item of /items, with paths relative to the item.',
    steps: [
      [
        createSurface('list'),
        updateComponents('list', [
          { id: 'root', component: 'Column', children: ['heading', 'items'] },
          { id: 'heading', component: 'Text', text: 'Reading list', variant: 'h3' },
          { id: 'items', component: 'List', children: { componentId: 'item', path: '/items' } },
          { id: 'item', component: 'Text', text: { path: 'title' } },
        ]),
        updateDataModel('list', '/items', [
          { title: 'Learn the A2UI protocol' },
          { title: 'Write a catalog' },
          { title: 'Build an agent that renders UI' },
        ]),
      ],
    ],
  },
  {
    id: 'quiz',
    title: 'Quiz card',
    description:
      'Pick a choice and press Check. The action "answer" gets a scripted reply that updates /result.',
    steps: [
      [
        createSurface('quiz'),
        updateComponents('quiz', [
          { id: 'root', component: 'Card', child: 'body' },
          { id: 'body', component: 'Column', children: ['question', 'choice', 'check', 'result'] },
          { id: 'question', component: 'Text', text: 'Which message creates a surface?', variant: 'h4' },
          {
            id: 'choice',
            component: 'ChoicePicker',
            variant: 'mutuallyExclusive',
            options: [
              { label: 'createSurface', value: 'createSurface' },
              { label: 'updateDataModel', value: 'updateDataModel' },
              { label: 'deleteSurface', value: 'deleteSurface' },
            ],
            value: { path: '/answer' },
          },
          { id: 'check-label', component: 'Text', text: 'Check' },
          {
            id: 'check',
            component: 'Button',
            variant: 'primary',
            child: 'check-label',
            action: { event: { name: 'answer', context: { choice: { path: '/answer' } } } },
          },
          { id: 'result', component: 'Text', text: { path: '/result' } },
        ]),
        updateDataModel('quiz', '/', { answer: [], result: '' }),
      ],
    ],
    replies: {
      answer: [updateDataModel('quiz', '/result', 'Thanks. The scripted agent received your answer.')],
    },
  },
  {
    id: 'invalid',
    title: 'Invalid payload',
    description:
      'An unknown component (Carousel) and a surface without a root. The Errors tab names each message.',
    steps: [
      [
        createSurface('broken'),
        updateComponents('broken', [{ id: 'root', component: 'Carousel', children: [] }]),
        updateComponents('broken', [{ id: 'note', component: 'Text', text: 'There is no root' }]),
      ],
    ],
  },
]
