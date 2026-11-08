## ADDED Requirements

### Requirement: Export a lesson as PDF
The lesson page SHALL offer Export PDF, which opens the browser's print dialog on a layout holding only the lesson (breadcrumb, title, description, rendered lesson, and references as plain links), with the lesson title as the suggested file name. It MUST be disabled while the lesson is empty.

#### Scenario: Export a written lesson
- **GIVEN** the lesson of `devops/docker` has text
- **WHEN** the user clicks Export PDF
- **THEN** the print dialog opens with the document titled after the lesson, and the app panels, buttons and chat are not part of the printed page

#### Scenario: Nothing to export
- **WHEN** the lesson is empty
- **THEN** Export PDF is disabled

### Requirement: Import a PDF into the lesson editor
The lesson page SHALL offer Import PDF. The system extracts the PDF's text (at most 10 MB, 200 pages, 100 000 characters; paragraphs and bullet lists kept) and opens it in the lesson editor without saving; the lesson changes only when the user clicks Save. When the editor already has text, the app MUST ask before replacing it. A file that is not a readable PDF MUST be refused with the reason, and a PDF without a text layer MUST say so. The PDF is not stored.

#### Scenario: Import and save
- **WHEN** the user imports a PDF whose text is "Docker images" and a bullet "• layers"
- **THEN** the editor shows that text with `- layers` as a list item, nothing is saved yet, and after Save the lesson shows it

#### Scenario: Ask before replacing
- **GIVEN** the lesson already has text
- **WHEN** the user imports a PDF
- **THEN** the app asks whether to replace the editor's text, and keeps it when the user declines

#### Scenario: Not a PDF
- **WHEN** the user imports a file that is not a PDF, or an encrypted PDF
- **THEN** the import is refused with the reason and the lesson is unchanged

#### Scenario: Scanned PDF
- **WHEN** the user imports a PDF with no text layer
- **THEN** the app says the PDF has no text to import
