# Evidence: chat-session-history

## Accepted cosmetic

- chat-history-rename.png: the Save button looks faded although the title is changed. The screenshot is taken right after `fill`, while the opacity transition (`--chat-ease`, `.agent-pane button:disabled` at 0.4) is still running. The e2e test then clicks Save and the rename persists, so the button is enabled. Minor, accepted.
- chat-history-phone-dark.png: the active History toggle is a grey-teal square with a cyan icon. The icon is visible; it is less saturated than on desktop dark. Minor, accepted.
