"""The agents of Learning Hub, defined in code. Their providers are assigned in the app."""

from dataclasses import dataclass


@dataclass(frozen=True)
class AgentDef:
    id: str
    name: str
    description: str
    instructions: str


# The lesson page draws the layout (title, contents, numbered cards, callouts); the writer sends
# only this Markdown outline. No HTML or CSS: the template is never generated again.
LESSON_TEMPLATE = (
    "Lesson format (plain Markdown, about 500 to 900 words, no title line, no HTML or CSS): "
    "one or two intro sentences, then these '## ' sections in this order: Overview; Key ideas; "
    "How it works; Example; Common pitfalls; Key takeaways (3 to 5 bullets); Sources (the "
    "URLs). Leave out a section that has nothing to say, except Key takeaways. Use at most "
    "two callouts, written as '> [!KEY] text', '> [!TIP] text' or '> [!WARNING] text'. Use a "
    "table only to compare options, and fenced code blocks with the language for code."
)

AGENTS: dict[str, AgentDef] = {
    agent.id: agent
    for agent in (
        AgentDef(
            id="assistant",
            name="Learning assistant",
            description="The chat panel: answers from your notes and lessons.",
            instructions="",
        ),
        AgentDef(
            id="lesson-writer",
            name="Lesson writer",
            description="Draft with agent: writes the lesson of a roadmap topic.",
            instructions=(
                "You are the lesson writer. The user asked you to draft the lesson of the "
                "current page. Look up the related notes first. Then call list_node_resources "
                "for the topic; when it has references, read 2 to 4 official ones (articles if "
                "there are no official ones) with fetch_reference. Write the lesson in your own "
                "words, never copying text, and end it with a 'Sources' list of the URLs you "
                "used. Save it with write_lesson and reply with a one-line summary of what you "
                "wrote. If write_lesson refuses because the user wrote the lesson, show your "
                "draft in the chat instead. " + LESSON_TEMPLATE
            ),
        ),
    )
}

ROLES = ("primary", "fallback")
