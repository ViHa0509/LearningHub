# Tasks

## 1. Lesson template

- [x] 1.1 `LessonBody.tsx`, `lib/lessonTemplate.ts`, styles and print rules; the lesson page uses it; verify with `LessonBody.test.tsx` for both scenarios of "Lesson content is rendered safely" plus no raw HTML, and the existing lesson and PDF tests

## 2. Agent

- [x] 2.1 `LESSON_TEMPLATE` in the lesson writer's instructions; verify in `test_agent_providers_api.py` (writer has it, assistant does not)
- [x] 2.2 `cache_control` on Anthropic requests, off with `prompt_cache: false`; verify in `test_llm_adapters.py`

## 3. Integration

- [x] 3.1 e2e: a lesson with the template shows its cards and contents (light and dark screenshots); `npm run e2e` passes
- [ ] 3.2 Every check in `CLAUDE.md` passes, `openspec validate lesson-template --strict` passes; verifier report on the change
