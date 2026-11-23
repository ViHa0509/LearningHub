## Purpose

In-app notifications: what the app tells a user about events they did not watch happen, how they see them, and when each one is made.

## ADDED Requirements

### Requirement: Bell and list
The top bar SHALL show a bell with the number of unread notifications (hidden at zero, "99+" above 99). Opening it SHALL list the user's notifications newest first with text and time in the user's time zone, unread ones marked. Clicking one MUST mark it read and open its page; Mark all read MUST mark every one read.

#### Scenario: Unread count
- **GIVEN** the user has 3 unread notifications
- **WHEN** they look at the top bar
- **THEN** the bell shows 3

#### Scenario: Open a notification
- **WHEN** the user clicks "Lesson ready: backend/graphql"
- **THEN** the lesson page opens and the notification is no longer unread

#### Scenario: Mark all read
- **WHEN** the user clicks Mark all read
- **THEN** the bell shows no count and every item shows as read

### Requirement: Notifications are private and safe
A user SHALL see and change only their own notifications; another user's notification id MUST answer 404. Names, titles and other text from users, imported pages or providers MUST be shown as plain text. A notification's link MUST be an address inside the app. No notification may contain a key, token, password, prompt or answer text.

#### Scenario: Another user's notification
- **WHEN** user B marks user A's notification id as read
- **THEN** the answer is 404 and A's notification stays unread

#### Scenario: Markup in a name
- **WHEN** a member signs up with the display name `<img src=x onerror=alert(1)>`
- **THEN** the admin's notification shows that text literally and no image is loaded

### Requirement: New notifications appear without reload
The app SHALL check the unread count every 60 seconds while the tab is visible and when the tab gets focus again.

#### Scenario: Arrives while open
- **GIVEN** the app is open on the home page
- **WHEN** a notification is made for the user
- **THEN** the bell shows it within about a minute without a reload

### Requirement: Retention
Notifications SHALL be kept 90 days and at most 200 per user; older ones MUST be removed.

#### Scenario: Over 200
- **GIVEN** a user has 200 notifications
- **WHEN** a new one is made
- **THEN** the oldest one is removed and the user has 200

### Requirement: New member notification
When an account is created by open sign-up or an accepted invitation, the admin SHALL get "New member: <name> (<email>) joined", opening Settings > Users.

#### Scenario: Member signs up
- **WHEN** a person creates an account through open sign-up
- **THEN** the admin has an unread notification naming them, and the new member has none about it

### Requirement: Lesson ready notification
When an agent writes or replaces a lesson, its user SHALL get "Lesson ready: <topic>", opening the lesson.

#### Scenario: Lesson writer finishes
- **WHEN** the lesson writer writes the lesson of a topic
- **THEN** the user has a notification that opens that lesson

### Requirement: Shared limit notifications
A member using the shared provider SHALL get one notification when 80% of the daily limit is used and one when the limit is reached, at most once each per day, with the reset time in their time zone. The admin MUST never get them.

#### Scenario: 80 percent
- **GIVEN** the shared daily limit is 20
- **WHEN** a member makes their 16th request of the day
- **THEN** they get a notification saying 16 of 20 are used and when it resets, and the 17th request adds none

#### Scenario: Admin has no limit
- **WHEN** the admin makes many requests on the shared provider
- **THEN** the admin gets no limit notification

### Requirement: Provider problem notification
When a user's provider fails with an invalid key, a quota or a rate limit, or the fallback answers because the primary failed, the user SHALL get one notification per provider per day naming the provider and the error category (never the provider's own message), opening that provider's page.

#### Scenario: Fallback answered
- **GIVEN** the primary provider's key is invalid and a fallback is set
- **WHEN** the user asks two questions
- **THEN** both are answered by the fallback, and the user has exactly one notification about the primary

### Requirement: Knowledge Hub reconnect notification
When the Knowledge Hub connection needs to be connected again, the user SHALL get one notification until they reconnect, opening Settings > Agents.

#### Scenario: Connection expired
- **WHEN** a Knowledge Hub search fails because the connection must be renewed
- **THEN** the user has one notification, and a second failure before reconnecting adds none

### Requirement: Published field notification
When the admin publishes a field, every member SHALL get "New field published: <title>", opening the home page on that field. Unpublishing and publishing again the same day MUST NOT notify twice.

#### Scenario: Publish
- **WHEN** the admin publishes the field Finance
- **THEN** each member has a notification that opens the home page on Finance, and the admin has none

### Requirement: New sign-in notification
When the account is signed in from a device and browser not seen in its sessions of the last 90 days, the user SHALL get "New sign-in: <browser> on <system>, <address>", opening the sessions list.

#### Scenario: New browser
- **GIVEN** the user always signed in with Edge on Windows
- **WHEN** they sign in with Firefox on Linux
- **THEN** they get a new sign-in notification; signing in again with Edge on Windows adds none

### Requirement: Restore notification
When a backup is restored into a user's account by a restore or a sync upload, the user SHALL get "Data restored from a backup" with the numbers of notes and lessons, opening the home page.

#### Scenario: Sync upload restored
- **WHEN** a sync upload is restored into the user's account
- **THEN** the user has a notification with the restored counts
