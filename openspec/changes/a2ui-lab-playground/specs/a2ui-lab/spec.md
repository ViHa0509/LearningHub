# Spec Delta

## Purpose

Lets a signed-in user learn the A2UI protocol hands-on: write or step through A2UI v0.9 messages, see the surfaces they render, the data model and the actions a user's clicks send back, all in the browser without an LLM.

## ADDED Requirements

### Requirement: Open the A2UI Lab
The app SHALL have an A2UI Lab page at `#/a2ui-lab`, reached from an "A2UI Lab" link in the top bar, for every signed-in user. The page shows an editor, a preview and an inspector. It MUST NOT call any API other than the app's usual session and health checks.

#### Scenario: Open from the top bar
- **WHEN** a signed-in user clicks "A2UI Lab" in the top bar
- **THEN** the address is `#/a2ui-lab` and the editor, the preview and the inspector are visible

#### Scenario: Not signed in
- **GIVEN** the user is not signed in and sign-in is required
- **WHEN** they open `#/a2ui-lab`
- **THEN** the sign-in page is shown, and after signing in the lab opens

### Requirement: Send messages from the editor
The lab SHALL accept, in the editor, one A2UI v0.9 message, an array of messages, or `{"messages": [...]}`, and process them in order when the user presses **Send**. Nothing is processed while typing. **Send** is disabled while the editor is empty.

#### Scenario: Send a surface
- **GIVEN** the editor holds a `createSurface` for `hello`, an `updateComponents` with a root `Text` bound to `/title`, and an `updateDataModel` setting `/title` to "Hello"
- **WHEN** the user presses Send
- **THEN** the preview shows a surface `hello` with the text "Hello", and the message log lists the three messages in order

#### Scenario: Update an existing surface
- **GIVEN** surface `hello` is shown with the text "Hello"
- **WHEN** the user sends `updateDataModel` for `hello` setting `/title` to "Hi"
- **THEN** the text changes to "Hi" without the surface being recreated

#### Scenario: Delete a surface
- **WHEN** the user sends `deleteSurface` for `hello`
- **THEN** surface `hello` is removed from the preview

### Requirement: Invalid input is reported, not rendered
The lab SHALL report text that is not JSON with its position. It SHALL report a message the renderer rejects (unknown message type or component, missing `root`, a duplicate id, an unknown surface) with the message's index and the reason. Messages before the bad one stay applied. A bad message MUST NOT break the page or other surfaces.

#### Scenario: Not JSON
- **WHEN** the user sends `{"version": "v0.9",`
- **THEN** an error says the JSON is invalid and where, and the preview is unchanged

#### Scenario: Unknown component
- **GIVEN** a surface `form` is shown
- **WHEN** the user sends `updateComponents` for `form` with a component of type `Carousel`
- **THEN** the Errors tab names message 1 and the unknown component `Carousel`, and surface `form` is still shown as before

### Requirement: Input size limit
The lab SHALL refuse to process editor text larger than 256 KB, or more than 200 messages in one Send, with an error that names the limit. Nothing of that input is processed.

#### Scenario: Too large
- **WHEN** the user sends 300 KB of text
- **THEN** an error says the input is over 256 KB, and no message is processed

### Requirement: Reset the lab
The lab SHALL offer **Reset**, which removes every surface and clears the message log, the data model view and the errors. The editor text is kept.

#### Scenario: Reset
- **GIVEN** two surfaces are shown and the log has entries
- **WHEN** the user presses Reset
- **THEN** the preview is empty, the log is empty and the editor text is unchanged

### Requirement: Step through samples
The lab SHALL offer built-in samples: a hello surface, a form with two-way binding, a list, a quiz card that answers an action, and an invalid payload. Loading a sample resets the lab and puts its first step in the editor. **Next step** sends the current step and loads the next. The step counter shows "Step n of m".

#### Scenario: Run a sample step by step
- **GIVEN** the user loads the "Hello surface" sample with 3 steps
- **WHEN** they press Next step once
- **THEN** only `createSurface` has been processed, the counter shows "Step 2 of 3", and the editor holds the second message

#### Scenario: Last step
- **WHEN** the user sends the last step of a sample
- **THEN** Next step is disabled and the counter shows the sample is done

#### Scenario: Load a sample over a changed draft
- **GIVEN** the editor text was changed since it was last sent or loaded
- **WHEN** the user loads a sample
- **THEN** the lab asks before replacing the text, and Cancel keeps it

### Requirement: Render surfaces with the app theme
The preview SHALL render every surface with the A2UI basic catalog (layout, content and input components) in the app's light and dark theme. Text and controls MUST stay readable in both themes.

#### Scenario: Dark theme
- **GIVEN** the app theme is dark
- **WHEN** a surface with a Card, Text, TextField and Button is shown
- **THEN** the surface uses the app's dark colors and its text is readable

### Requirement: Inspect the data model
The inspector SHALL show each surface's current data model as formatted JSON. It MUST update when an `updateDataModel` arrives or when the user changes a bound input.

#### Scenario: Two-way binding
- **GIVEN** the form sample shows a TextField bound to `/user/name`
- **WHEN** the user types "Ana" in the field
- **THEN** the data model view shows `"name": "Ana"` under `user`

### Requirement: Show actions as renderer messages
When a user triggers an action (for example a Button), the lab SHALL add the `action` message the renderer would send to an agent to the log. The entry shows its name, surface id, source component id, timestamp and context with bindings already resolved. The log marks the direction of every entry: agent to renderer, or renderer to agent.

#### Scenario: Click a button
- **GIVEN** the form sample with a Button whose action is `submit` with context `{"name": {"path": "/user/name"}}` and the field holds "Ana"
- **WHEN** the user clicks the button
- **THEN** the log gains a renderer-to-agent entry `action` named `submit` whose context is `{"name": "Ana"}`

### Requirement: Scripted agent replies
A sample MAY script agent replies by action name. When an action of that name is sent, the lab SHALL process the scripted messages as agent messages and log them after the action. An action with no scripted reply is only logged.

#### Scenario: Quiz answer
- **GIVEN** the quiz sample, whose script answers the `answer` action
- **WHEN** the user picks a choice and clicks Check
- **THEN** the log shows the `answer` action and then the scripted `updateDataModel`, and the card shows the result

#### Scenario: No script
- **WHEN** an action with no scripted reply is clicked
- **THEN** it is logged and nothing else changes

### Requirement: Media only from the app or data URLs
Image, Video and AudioPlayer in a surface SHALL load only URLs on the app's own origin or `data:` URLs of their media type. Any other URL MUST NOT be requested. A "blocked" placeholder shows the URL as plain text instead.

#### Scenario: External image
- **WHEN** a surface has an Image with the URL `https://tracker.example/p.png?d=secret`
- **THEN** the browser makes no request to `tracker.example`, and the surface shows a blocked placeholder with that URL as text

#### Scenario: App image
- **WHEN** a surface has an Image with the URL `/brand/logo-mark.svg`
- **THEN** the image is shown

### Requirement: Markdown without HTML
Markdown in a Text component SHALL be rendered by the app's Markdown renderer, which never renders raw HTML or script URLs. Links open in a new tab without access to the app.

#### Scenario: HTML in text
- **WHEN** a Text has `<img src=x onerror=alert(1)>` and `[x](javascript:alert(1))`
- **THEN** no element from that HTML is created, no script runs, and the `javascript:` link is not clickable

### Requirement: Keep the draft in the browser
The lab SHALL keep the editor text in the browser for the signed-in user, so it is still there after leaving and reopening the page or reloading. It is never sent to the server. Surfaces and logs are not kept.

#### Scenario: Reload
- **GIVEN** the user typed a message in the editor
- **WHEN** they reload the page and reopen the lab
- **THEN** the editor holds the same text and the preview is empty

### Requirement: Lab on small screens
On a phone the lab SHALL show the editor, the preview and the inspector one at a time, switched by tabs, with no horizontal page scroll. On a tablet or desktop they are side by side.

#### Scenario: Phone
- **GIVEN** a 390 x 844 viewport
- **WHEN** the user opens the lab
- **THEN** tabs for Editor, Preview and Inspector are shown, one pane is visible, and the page does not scroll sideways
