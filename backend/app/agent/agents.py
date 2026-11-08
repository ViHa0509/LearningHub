"""The agents of Learning Hub, defined in code. Their providers are assigned in the app."""

from dataclasses import dataclass


@dataclass(frozen=True)
class AgentDef:
    id: str
    name: str
    description: str
    instructions: str


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
                "draft in the chat instead."
            ),
        ),
    )
}

ROLES = ("primary", "fallback")
