## ADDED Requirements

### Requirement: Animated decoration with Magic UI
The app SHALL use Magic UI components on the sign-in, create-admin and invitation pages (animated background, shimmer main button), the home role cards (spotlight and border beam), counts (number ticker), the news page (items fade in, sources marquee) and the agent panel ("Thinking…" shiny text while waiting). Decorative layers MUST be hidden from assistive tech and take no pointer events, and the names, roles and focus order of controls MUST stay as before.

#### Scenario: Login page
- **WHEN** a signed-out user opens the login page
- **THEN** an animated background is shown behind the card and the "Log in" button keeps its name and works by keyboard

#### Scenario: Thinking indicator
- **WHEN** the user sends a chat message and the answer is pending
- **THEN** the panel shows "Thinking…" with a shimmer until the answer arrives

### Requirement: Reduced motion and themes
Every animation SHALL stop when the system asks for reduced motion (`prefers-reduced-motion: reduce`): backgrounds become static, number tickers show the final value at once and items appear without fading. Colors MUST come from the app's theme tokens so light and dark themes both read well. Reading and editing areas (note view, lesson editor, forms) MUST NOT animate.

#### Scenario: Reduced motion
- **GIVEN** the system asks for reduced motion
- **WHEN** the home page loads
- **THEN** counts show their final value immediately and no element animates

#### Scenario: Dark theme
- **WHEN** the user switches to the dark theme
- **THEN** the animated backgrounds and card effects use the dark theme's colors
