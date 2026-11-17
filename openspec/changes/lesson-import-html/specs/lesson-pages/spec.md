## MODIFIED Requirements

### Requirement: Import a PDF into the lesson editor
The lesson page SHALL offer Import PDF or HTML. For a PDF the system extracts its text (at most 10 MB, 200 pages, 100 000 characters; paragraphs and bullet lists kept) and opens it in the lesson editor without saving; the lesson changes only when the user clicks Save. When the editor already has text, the app MUST ask before replacing it. A file that is neither an HTML page nor a readable PDF MUST be refused with the reason, and a PDF without a text layer MUST say so. The PDF is not stored.

#### Scenario: Import and save
- **WHEN** the user imports a PDF whose text is "Docker images" and a bullet "• layers"
- **THEN** the editor shows that text with `- layers` as a list item, nothing is saved yet, and after Save the lesson shows it

#### Scenario: Ask before replacing
- **GIVEN** the lesson already has text
- **WHEN** the user imports a PDF
- **THEN** the app asks whether to replace the editor's text, and keeps it when the user declines

#### Scenario: Not a PDF
- **WHEN** the user imports a file that is neither an HTML page nor a PDF, or an encrypted PDF
- **THEN** the import is refused with the reason and the lesson is unchanged

#### Scenario: Scanned PDF
- **WHEN** the user imports a PDF with no text layer
- **THEN** the app says the PDF has no text to import

## ADDED Requirements

### Requirement: Import an HTML page into the lesson editor
The lesson page's import SHALL accept an HTML page (a file named `.html` or `.htm`, within the app's upload limit). The system converts the page to Markdown and opens it in the lesson editor without saving; the lesson changes only when the user clicks Save, and the app MUST ask before replacing existing text. At most 100 000 characters are imported, and the app says when the page was cut. The HTML file is not stored.

#### Scenario: Import an HTML page and save
- **WHEN** the user imports an HTML page with a heading "Kafka", a paragraph, a bullet list and a table
- **THEN** the editor shows a Markdown heading, the paragraph, the list items and a Markdown table, nothing is saved yet, and after Save the lesson shows them

#### Scenario: Ask before replacing with an HTML page
- **GIVEN** the lesson already has text
- **WHEN** the user imports an HTML page
- **THEN** the app asks whether to replace the editor's text, and keeps it when the user declines

#### Scenario: HTML page without text
- **WHEN** the user imports an HTML page that has no text
- **THEN** the app says the page has no text to import and the lesson is unchanged

#### Scenario: Undecodable HTML
- **WHEN** the user imports an `.html` file that is not text in UTF-8 or in its declared charset
- **THEN** the import is refused with the reason and the lesson is unchanged

#### Scenario: Long page
- **WHEN** the user imports an HTML page whose text is longer than 100 000 characters
- **THEN** the editor holds the first part and the app says only the first part was imported

### Requirement: What an imported HTML page keeps
The conversion SHALL keep headings, paragraphs, lists, tables, code and preformatted text, bold and italic, and links to `http`, `https` and `mailto` addresses. Scripts, styles, navigation, forms, images and embedded content MUST be left out, a link to any other kind of address MUST become plain text, and text of the page MUST NOT turn into Markdown structure it did not have.

#### Scenario: Code and diagrams
- **WHEN** the imported page has a `pre` block and inline `code`
- **THEN** the editor shows a fenced code block with the same lines and the inline code as a code span

#### Scenario: Script and style are left out
- **WHEN** the imported page has a `script`, a `style` block and a link whose address starts with `javascript:`
- **THEN** none of the script or style text is in the editor and the link is plain text

#### Scenario: Page text stays text
- **WHEN** the imported page has the paragraph text `*not bold* # not a heading`
- **THEN** the saved lesson shows that text literally, with no emphasis and no heading
