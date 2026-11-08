"""Spec: lesson-pages - Import a PDF into the lesson editor (extraction and the API)."""

from fastapi.testclient import TestClient

from app.lesson_pdf import MAX_PAGES, extract_pdf

BULLET = b"\x95"  # the bullet character in WinAnsiEncoding


def make_pdf(pages: list[list[bytes]], *, encrypted: bool = False) -> bytes:
    """A small valid PDF with one Helvetica text line per entry on each page."""
    objects: list[bytes] = []
    page_ids = [3 + 2 * i for i in range(len(pages))]
    font_id = 3 + 2 * len(pages)
    objects.append(b"<< /Type /Catalog /Pages 2 0 R >>")
    kids = b" ".join(b"%d 0 R" % pid for pid in page_ids)
    objects.append(b"<< /Type /Pages /Kids [%s] /Count %d >>" % (kids, len(pages)))
    for i, lines in enumerate(pages):
        content = (
            b"BT /F1 12 Tf 72 720 Td 14 TL "
            + b"".join(b"(" + line + b") Tj T* " for line in lines)
            + b"ET"
        )
        objects.append(
            b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
            b"/Resources << /Font << /F1 %d 0 R >> >> /Contents %d 0 R >>"
            % (font_id, page_ids[i] + 1)
        )
        objects.append(b"<< /Length %d >>\nstream\n%s\nendstream" % (len(content), content))
    objects.append(
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>"
    )
    out = b"%PDF-1.4\n"
    offsets = []
    for number, body in enumerate(objects, start=1):
        offsets.append(len(out))
        out += b"%d 0 obj\n%s\nendobj\n" % (number, body)
    xref = len(out)
    out += b"xref\n0 %d\n0000000000 65535 f \n" % (len(objects) + 1)
    out += b"".join(b"%010d 00000 n \n" % o for o in offsets)
    trailer = b"<< /Size %d /Root 1 0 R" % (len(objects) + 1)
    if encrypted:
        trailer += b" /Encrypt << /Filter /Standard /V 1 /R 2 /O <00> /U <00> /P -4 >>"
    out += b"trailer\n" + trailer + b" >>\nstartxref\n%d\n%%%%EOF\n" % xref
    return out


def upload(client: TestClient, data: bytes, name: str = "lesson.pdf") -> object:
    return client.post("/api/lessons/extract-pdf", files={"file": (name, data, "application/pdf")})


# Scenario: Import and save (the extraction part)
def test_paragraphs_and_bullets_become_markdown() -> None:
    pdf = make_pdf(
        [
            [
                b"Docker images",
                b"are read-only templates.",
                b"",
                BULLET + b" layers",
                BULLET + b" tags",
            ]
        ]
    )
    extracted = extract_pdf(pdf)
    assert extracted.pages == 1
    assert extracted.warning is None
    assert "Docker images are read-only templates." in extracted.markdown
    assert "- layers\n- tags" in extracted.markdown


def test_pages_are_joined_in_order() -> None:
    extracted = extract_pdf(make_pdf([[b"First page"], [b"Second page"]]))
    assert extracted.pages == 2
    assert extracted.markdown.index("First page") < extracted.markdown.index("Second page")


def test_api_returns_the_markdown_and_stores_nothing(client: TestClient) -> None:
    response = upload(client, make_pdf([[b"Helm charts", BULLET + b" values.yaml"]]))
    assert response.status_code == 200, response.text  # type: ignore[attr-defined]
    body = response.json()  # type: ignore[attr-defined]
    assert body["pages"] == 1 and body["truncated"] is False and body["warning"] is None
    assert "Helm charts" in body["markdown"] and "- values.yaml" in body["markdown"]
    assert client.get("/api/lessons/devops/helm").json()["body"] == ""


# Scenario: Not a PDF
def test_not_a_pdf_is_refused(client: TestClient) -> None:
    response = upload(client, b"<html>not a pdf</html>", "page.pdf")
    assert response.status_code == 422  # type: ignore[attr-defined]
    assert response.json()["detail"] == "the file is not a PDF"  # type: ignore[attr-defined]


def test_damaged_pdf_is_refused(client: TestClient) -> None:
    response = upload(client, b"%PDF-1.4\nthis is not really a pdf")
    assert response.status_code == 422  # type: ignore[attr-defined]


def test_encrypted_pdf_is_refused(client: TestClient) -> None:
    response = upload(client, make_pdf([[b"secret"]], encrypted=True))
    assert response.status_code == 422  # type: ignore[attr-defined]
    assert "password" in response.json()["detail"]  # type: ignore[attr-defined]


# Scenario: Scanned PDF
def test_pdf_without_text_warns(client: TestClient) -> None:
    body = upload(client, make_pdf([[]])).json()  # type: ignore[attr-defined]
    assert body["markdown"] == ""
    assert "no text to import" in body["warning"]


def test_too_many_pages_are_cut(client: TestClient) -> None:
    extracted = extract_pdf(make_pdf([[b"page %d" % i] for i in range(MAX_PAGES + 3)]))
    assert extracted.pages == MAX_PAGES + 3
    assert extracted.truncated is True
    assert "page 199" in extracted.markdown and "page 200" not in extracted.markdown
    assert extracted.warning is not None and "first part" in extracted.warning


def test_oversized_upload_is_refused(client: TestClient) -> None:
    limit = client.app.state.settings.max_upload_bytes  # type: ignore[attr-defined]
    response = upload(client, b"%PDF-1.4\n" + b"0" * limit)
    assert response.status_code == 422  # type: ignore[attr-defined]


def test_import_needs_the_app_header(client: TestClient) -> None:
    response = client.post(
        "/api/lessons/extract-pdf",
        files={"file": ("a.pdf", make_pdf([[b"x"]]), "application/pdf")},
        headers={"X-LearningHub": "0"},
    )
    assert response.status_code == 403


# --- notes (knowledge-import: PDF becomes a note; learning-views: Export a note as PDF) ----------


def import_files(client: TestClient, *files: tuple[str, bytes, str]) -> list[dict]:
    response = client.post("/api/notes/import", files=[("files", f) for f in files])
    assert response.status_code == 200, response.text
    results: list[dict] = response.json()["results"]
    return results


# Scenario: PDF becomes a note
def test_pdf_import_creates_an_escaped_note(client: TestClient) -> None:
    pdf = make_pdf(
        [[b"Docker basics", b"Use <script>alert(1)</script> carefully", BULLET + b" images"]]
    )
    (result,) = import_files(client, ("docker-basics.pdf", pdf, "application/pdf"))
    assert result["outcome"] == "created", result
    note = result["note"]
    assert note["title"] == "Docker basics"
    assert note["original_name"] == "docker-basics.pdf"
    page = client.get(f"/api/notes/{note['id']}/original").text
    assert "<li>images</li>" in page
    assert "&lt;script&gt;alert(1)&lt;/script&gt;" in page
    assert "<script>alert(1)" not in page
    detail = client.get(f"/api/notes/{note['id']}").json()
    assert "carefully" in detail["body_text"]
    # The same PDF again is a duplicate.
    (again,) = import_files(client, ("copy.pdf", pdf, "application/pdf"))
    assert again["outcome"] == "duplicate"


# Scenario: Scanned PDF / Wrong file type
def test_pdf_import_rejections(client: TestClient) -> None:
    scanned, damaged, other = import_files(
        client,
        ("scan.pdf", make_pdf([[]]), "application/pdf"),
        ("broken.pdf", b"not a pdf at all", "application/pdf"),
        ("notes.docx", b"PK..", "application/octet-stream"),
    )
    assert scanned["outcome"] == "rejected" and "no text" in scanned["reason"]
    assert damaged["outcome"] == "rejected" and damaged["reason"] == "the file is not a PDF"
    assert other["outcome"] == "rejected" and other["reason"] == "not an HTML or PDF file"
    assert client.get("/api/notes").json() == []


# Scenario: Export a note / Print view stays isolated
def test_print_view_is_isolated_and_prints(client: TestClient) -> None:
    (result,) = import_files(client, ("page.html", b"<title>Page</title><p>Hello</p>", "text/html"))
    response = client.get(f"/api/notes/{result['note']['id']}/print")
    assert response.status_code == 200
    csp = response.headers["content-security-policy"]
    assert csp == "sandbox allow-scripts allow-modals"
    assert "allow-same-origin" not in csp
    assert response.headers["x-content-type-options"] == "nosniff"
    assert response.text.startswith("<title>Page</title><p>Hello</p>")
    assert "print()" in response.text
    # The stored original is unchanged.
    original = client.get(f"/api/notes/{result['note']['id']}/original")
    assert original.content == b"<title>Page</title><p>Hello</p>"
    assert original.headers["content-security-policy"] == "sandbox allow-scripts"
