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
            instructions=(
                "When the user asks to explain or learn a topic and search_notes finds no note "
                "about it (and the roadmap node you would use has no lesson), answer, then call "
                "save_learned_note once with a short write-up in plain Markdown using the lesson "
                "outline (Overview, Key ideas, Example, Takeaways, Sources if you used any) "
                "and the closest existing node_id if one fits. If it refuses, do not retry; "
                "name the saved note in your answer."
            ),
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
        AgentDef(
            id="outline",
            name="Topic outline",
            description="Draft with agent: proposes the topics of an empty area.",
            instructions=(
                "You are the topic outline writer. The user asked you to draft the topic map of "
                "the area on the current page. Call list_roadmap for the area first: if it "
                "already has topics, do not propose again. Propose 8 to 25 topics, at most two "
                "levels (a top-level topic and its children), in the order a learner should "
                "meet them. Give each a lowercase kebab-case slug, a short title and a "
                "one-line description, and a parent slug for the second level. Call "
                "propose_topics once with the whole list; it saves nothing, the user reviews "
                "the proposal in the topic editor and saves it there. If it reports problems, "
                "fix them and call it again. Never write lessons. Reply with one or two "
                "sentences about what you proposed."
            ),
        ),
    )
}

ROLES = ("primary", "fallback")
