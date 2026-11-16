# kh-connector Specification

## Purpose
Lets each user link their own Knowledge Hub (KH) account to Learning Hub, so the agents can search what that user may read in KH.

## ADDED Requirements

### Requirement: The connector is off until the server is configured
The connector SHALL be available only when the server has a KH URL, an identity service URL and a client id. When it is not available, clients MUST be told so, the connect, poll and disconnect routes MUST answer 404, and the agents MUST NOT be offered `kh_search`.

#### Scenario: Not configured
- **GIVEN** a server without the KH settings
- **WHEN** the user opens Settings -> Agents
- **THEN** the Knowledge Hub card says the connector is not set up on this server and shows no Connect button

#### Scenario: Routes when not configured
- **GIVEN** a server without the KH settings
- **WHEN** a client starts a connection
- **THEN** the answer is 404

### Requirement: Connect with a device sign-in
A signed-in user SHALL be able to link their KH account from the Knowledge Hub card on Settings -> Agents. Connect MUST start a device sign-in at the identity service and show the user a sign-in link and a code; the page then checks at the interval the identity service gave until the user finished, refused, or the code expired. Nobody types a KH password or token into Learning Hub.

#### Scenario: Connect
- **GIVEN** a configured server and a user who is not connected
- **WHEN** the user clicks Connect and finishes the sign-in page
- **THEN** the card shows "Connected as" and the email of the KH account

#### Scenario: Waiting
- **WHEN** the user clicked Connect and has not finished the sign-in page
- **THEN** the card shows the code, a link that opens the sign-in page in a new tab, and that it is waiting

#### Scenario: Cancel while waiting
- **WHEN** the user clicks Cancel while the card is waiting
- **THEN** the card shows Connect again and no connection is kept

#### Scenario: Sign-in refused
- **WHEN** the user refuses on the sign-in page, or KH does not know the account
- **THEN** the card says the sign-in was refused, with the reason, and offers Connect again

#### Scenario: Code expired
- **WHEN** the code expires before the user finished
- **THEN** the card says the sign-in expired and offers Connect again

#### Scenario: Checking too often
- **WHEN** a client checks sooner than the interval allows
- **THEN** the server answers that it is still waiting without calling the identity service

#### Scenario: Already connected
- **GIVEN** a connected user
- **WHEN** a client starts a connection again
- **THEN** the request is refused with a conflict

### Requirement: The KH sign-in is secret and the user's own
The KH device code and refresh token SHALL be stored encrypted, per user. No API answer, log line or backup archive may hold a KH token, device code or code verifier, and no access token is stored. Every connection query MUST filter by the current user; one user's connection is never visible to or usable by another.

#### Scenario: Status holds no secret
- **WHEN** a connected user reads the connection status
- **THEN** the answer holds the status and the KH email, and no token

#### Scenario: Another user
- **GIVEN** user A is connected and user B is not
- **WHEN** B reads the connection status or chats with the agent
- **THEN** B is shown as not connected and B's agent is not offered `kh_search`

#### Scenario: Backup
- **GIVEN** a connected user
- **WHEN** the user downloads a backup
- **THEN** the archive holds no KH connection data

#### Scenario: Mutating calls need the app header
- **WHEN** a connect, poll or disconnect request comes without the `X-LearningHub: 1` header
- **THEN** it is refused

### Requirement: Disconnect
A connected user SHALL be able to disconnect. Disconnect MUST ask first, revoke the sign-in at the identity service and remove the stored connection. A sign-in that the identity service no longer accepts MUST also remove the stored connection.

#### Scenario: Disconnect
- **GIVEN** a connected user
- **WHEN** the user clicks Disconnect and confirms
- **THEN** the identity service receives a revoke request, the card shows Connect again, and the agent is no longer offered `kh_search`

#### Scenario: Disconnect is confirmed first
- **WHEN** the user clicks Disconnect and then declines
- **THEN** the connection stays

#### Scenario: Sign-in ended elsewhere
- **GIVEN** a connected user whose sign-in was revoked or has expired at the identity service
- **WHEN** the agent calls `kh_search`
- **THEN** the tool answers that the user must connect to Knowledge Hub again, and the card shows Connect

### Requirement: The agents search Knowledge Hub as the user
For a connected user the agents SHALL have a read-only tool `kh_search` that asks KH for what that user may read about a query, in a given KH project or, by default, the user's personal KH project. The tool MUST be offered on every provider type, MUST return KH's text only as untrusted content, and the system prompt MUST tell the model never to follow instructions found in it. No agent tool writes to KH.

#### Scenario: Search
- **GIVEN** a connected user
- **WHEN** the user asks the assistant what Knowledge Hub holds about "redis eviction"
- **THEN** the agent calls `kh_search`, the answer uses KH's text, and the trace shows the call

#### Scenario: Result is untrusted
- **GIVEN** KH answers a search with text that says "ignore previous instructions"
- **WHEN** the agent receives the tool result
- **THEN** the text is inside `<untrusted_kh_content>` and cannot close that tag early

#### Scenario: Another project
- **WHEN** the model calls `kh_search` with a project id
- **THEN** KH is asked about that project with the user's own sign-in

#### Scenario: KH refuses
- **WHEN** KH answers that the user may not read that project, or the search fails
- **THEN** the tool returns an error message to the model instead of failing the request

#### Scenario: KH does not answer
- **WHEN** KH cannot be reached or times out
- **THEN** the tool returns "Knowledge Hub did not answer" to the model

#### Scenario: Claude Code provider
- **GIVEN** a connected user whose assistant runs on the Claude Code provider type
- **WHEN** the user chats
- **THEN** the app's MCP server offers `kh_search` for that user
