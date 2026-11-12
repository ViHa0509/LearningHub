## MODIFIED Requirements

### Requirement: Reject unsupported files
The system SHALL reject a file that has no `.html`, `.htm` or `.pdf` extension, is empty, is not decodable as text (HTML), is not a readable PDF or has no text to import (PDF), or is larger than the server's upload limit (10 MB unless `LH_MAX_UPLOAD_BYTES` sets another), and SHALL report the reason per file.

#### Scenario: Wrong file type
- **WHEN** the user imports `notes.docx`
- **THEN** that file is rejected with the reason "not an HTML or PDF file" and no note is created

#### Scenario: File too large
- **WHEN** the user imports an HTML file of 12 MB
- **THEN** that file is rejected with the reason "larger than 10 MB"

#### Scenario: Scanned PDF
- **WHEN** the user imports a PDF without a text layer
- **THEN** that file is rejected with the reason that it has no text to import

#### Scenario: Lower limit on the hosted copy
- **GIVEN** a server with `LH_MAX_UPLOAD_BYTES` set to 4 MB
- **WHEN** the user imports an HTML file of 6 MB
- **THEN** that file is rejected with the reason "larger than 4 MB"

## ADDED Requirements

### Requirement: Upload limit checked in the browser
The app SHALL read the server's upload limit and refuse a larger file before sending it, with the same reason the server gives. It MUST send each imported file in its own request, so that several files together never exceed the platform's request size limit, and one refused file MUST NOT stop the others.

#### Scenario: Too large file is not sent
- **GIVEN** a server whose upload limit is 4 MB
- **WHEN** the user imports one file of 6 MB and one of 1 MB together
- **THEN** the 6 MB file is shown as rejected with "larger than 4 MB" without being sent, and the 1 MB file is imported

#### Scenario: Several files, one request each
- **WHEN** the user imports three files of 3 MB each
- **THEN** three requests are sent and all three notes are created
