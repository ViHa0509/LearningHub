## MODIFIED Requirements

### Requirement: Reject unsupported files
The system SHALL reject a file that has no `.html`, `.htm` or `.pdf` extension, is empty, is not decodable as text (HTML), is not a readable PDF or has no text to import (PDF), or is larger than 10 MB, and SHALL report the reason per file.

#### Scenario: Wrong file type
- **WHEN** the user imports `notes.docx`
- **THEN** that file is rejected with the reason "not an HTML or PDF file" and no note is created

#### Scenario: File too large
- **WHEN** the user imports an HTML file of 12 MB
- **THEN** that file is rejected with the reason "larger than 10 MB"

#### Scenario: Scanned PDF
- **WHEN** the user imports a PDF without a text layer
- **THEN** that file is rejected with the reason that it has no text to import

### Requirement: Keep the original file unchanged
The system SHALL store an imported HTML file byte for byte, so that the original page can be shown again exactly as it was. An imported PDF is stored as a generated HTML page holding its text (paragraphs and lists, every character escaped), titled after the PDF's first line or file name.

#### Scenario: Original is preserved
- **WHEN** the user downloads the original of a note imported from HTML
- **THEN** the bytes are identical to the imported file

#### Scenario: PDF becomes a note
- **WHEN** the user imports `docker-basics.pdf` whose text starts with "Docker basics" and has a bullet "• images"
- **THEN** a note titled "Docker basics" is created, its page shows the text with "images" as a list item, and markup characters from the PDF are shown as text
