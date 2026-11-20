"""Builders for SYNTHETIC test archives.

Everything produced here is fake, clearly labelled test data used only to
exercise the ingestion pipeline. It is not course content and is never shown
in the application.
"""

from __future__ import annotations

import io
import zipfile
from pathlib import Path

import pymupdf
from docx import Document
from pptx import Presentation
from pptx.util import Inches, Pt

MARK = "SYNTHETIC TEST FIXTURE"

OVERVIEW_HTML = """<!doctype html>
<html><head><meta charset="utf-8"><title>Fixture Networks 101</title></head>
<body>
<h1>Fixture Networks 101 (SYNTHETIC TEST FIXTURE)</h1>
<ul class="topics">
 <li class="section main" id="section-0">
  <h3 class="sectionname">General</h3>
  <div class="summary"><p>Welcome to the synthetic fixture course.</p></div>
  <ul><li class="activity"><a href="https://example.org/forum">Announcements forum</a></li></ul>
 </li>
 <li class="section main" id="section-1">
  <h3 class="sectionname">4 August - 10 August</h3>
  <div class="summary">
   <p>Introduction to fixture layer models</p>
   <p>Learning objectives:</p>
   <ul><li>Describe the fixture layer model</li><li>Explain fixture addressing basics</li></ul>
   <p>Reading: Chapter 1, pages 1-12</p>
  </div>
  <ul class="section img-text">
   <li class="activity resource"><a href="Week%201/Lecture01_intro.pptx">Lecture 1 – Fixture Layers</a></li>
  </ul>
 </li>
 <li class="section main" id="section-2">
  <h3 class="sectionname">11 August - 17 August</h3>
  <div class="summary"><p>Fixture addressing and subnet arithmetic</p></div>
  <ul>
   <li><a href="Week%202/old_lecture.ppt">Lecture 2 (legacy format)</a></li>
   <li><a href="missing/handout.pdf">Missing handout</a></li>
  </ul>
 </li>
 <li class="section main" id="section-3">
  <h3 class="sectionname">18 August - 24 August</h3>
  <div class="summary"><p>Fixture transport protocols. See Chapter 2.</p></div>
  <ul><li><a href="Week%203/notes.docx">Week 3 notes</a></li></ul>
 </li>
</ul>
</body></html>
"""


def png_bytes(color: tuple[int, int, int] = (40, 90, 200), size: int = 24) -> bytes:
    pix = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, size, size), False)
    pix.set_rect(pix.irect, color)
    return pix.tobytes("png")


def build_lecture_pptx() -> bytes:
    prs = Presentation()
    logo = io.BytesIO(png_bytes((10, 10, 10), 16))

    def add_logo(slide):
        logo.seek(0)
        slide.shapes.add_picture(logo, Inches(9.2), Inches(0.1), Inches(0.5), Inches(0.5))

    # 1: title slide
    slide = prs.slides.add_slide(prs.slide_layouts[0])
    slide.shapes.title.text = "Fixture Layers"
    slide.placeholders[1].text = f"{MARK} lecture"
    add_logo(slide)

    # 2: bullets with levels + speaker notes
    slide = prs.slides.add_slide(prs.slide_layouts[1])
    slide.shapes.title.text = "The Fixture Model"
    frame = slide.placeholders[1].text_frame
    frame.text = "A fixture protocol is a set of synthetic rules for test data exchange."
    paragraph = frame.add_paragraph()
    paragraph.text = "Layer one carries fixture bits"
    paragraph.level = 1
    paragraph = frame.add_paragraph()
    paragraph.text = "Layer two frames fixture bits"
    paragraph.level = 1
    slide.notes_slide.notes_text_frame.text = "Speaker note: emphasise that this is synthetic."
    add_logo(slide)

    # 3: table
    slide = prs.slides.add_slide(prs.slide_layouts[5])
    slide.shapes.title.text = "Fixture Comparison"
    table = slide.shapes.add_table(2, 2, Inches(1), Inches(2), Inches(6), Inches(1.5)).table
    table.cell(0, 0).text = "Layer"
    table.cell(0, 1).text = "Unit"
    table.cell(1, 0).text = "Fixture link"
    table.cell(1, 1).text = "Fixture frame"
    add_logo(slide)

    # 4: content picture + formula in a group
    slide = prs.slides.add_slide(prs.slide_layouts[5])
    slide.shapes.title.text = "Fixture Throughput"
    slide.shapes.add_picture(io.BytesIO(png_bytes((200, 30, 30), 64)), Inches(1), Inches(2), Inches(3), Inches(3))
    group = slide.shapes.add_group_shape()
    box = group.shapes.add_textbox(Inches(5), Inches(2), Inches(4), Inches(1))
    box.text_frame.text = "Throughput = Window size / Round trip time"
    box.text_frame.paragraphs[0].runs[0].font.size = Pt(20)
    add_logo(slide)

    # 5: slide without a title placeholder
    slide = prs.slides.add_slide(prs.slide_layouts[6])
    box = slide.shapes.add_textbox(Inches(1), Inches(1), Inches(6), Inches(1))
    box.text_frame.text = "Summary without a title placeholder"

    out = io.BytesIO()
    prs.save(out)
    return out.getvalue()


def build_extra_pptx() -> bytes:
    prs = Presentation()
    slide = prs.slides.add_slide(prs.slide_layouts[1])
    slide.shapes.title.text = "Extra Fixture Topic"
    slide.placeholders[1].text_frame.text = "Unlinked extra slide deck for week three."
    out = io.BytesIO()
    prs.save(out)
    return out.getvalue()


def build_textbook_pdf(page_count: int = 45) -> bytes:
    doc = pymupdf.open()
    toc = [
        [1, "Chapter 1 Fixture Layers", 4],
        [2, "1.1 Physical fixtures", 4],
        [2, "1.2 Data link fixtures", 6],
        [1, "Chapter 2 Fixture Transport", 20],
        [2, "2.1 Reliable fixtures", 20],
        [2, "2.2 Datagram fixtures", 25],
        [1, "Chapter 3 Fixture Applications", 35],
    ]
    starts = {entry[2]: entry[1] for entry in toc}
    for index in range(page_count):
        number = index + 1
        page = doc.new_page(width=595, height=842)
        if number == 44:  # image-only "scanned" page
            page.insert_image(page.rect, stream=png_bytes((180, 180, 180), 200))
            continue
        page.insert_text((72, 40), "Fixture Networking Textbook", fontsize=9)  # running header
        printed = ["i", "ii", "iii"][index] if index < 3 else str(index - 2)
        page.insert_text((290, 820), printed, fontsize=9)  # running footer page number
        y = 110
        if number in starts:
            page.insert_text((72, y), starts[number], fontsize=18)
            y += 40
        body = [
            f"This is page {number} of the {MARK.lower()} textbook used for automated tests.",
            "A fixture protocol is a set of synthetic rules that govern test data exchange.",
            "Throughput = Window size / Round trip time",
            "Figure 1.2: Synthetic fixture layer diagram",
            "For example, a fixture frame carries fixture bits between two fixture nodes.",
        ]
        for line in body:
            page.insert_text((72, y), line, fontsize=11)
            y += 22
    doc.set_toc(toc)
    doc.set_page_labels(
        [
            {"startpage": 0, "prefix": "", "style": "r", "firstpagenum": 1},
            {"startpage": 3, "prefix": "", "style": "D", "firstpagenum": 1},
        ]
    )
    doc.set_metadata({"title": "Fixture Networking Textbook", "author": "Test Suite"})
    data = doc.tobytes()
    doc.close()
    return data


def build_notes_docx() -> bytes:
    document = Document()
    document.add_heading("Transport Notes", level=1)
    document.add_paragraph(f"{MARK}: notes about fixture transport.")
    document.add_heading("Ports", level=2)
    document.add_paragraph("A fixture port is a synthetic endpoint number used in tests.")
    table = document.add_table(rows=2, cols=2)
    table.cell(0, 0).text = "Port"
    table.cell(0, 1).text = "Use"
    table.cell(1, 0).text = "8080"
    table.cell(1, 1).text = "Fixture web"
    out = io.BytesIO()
    document.save(out)
    return out.getvalue()


def build_course_archive(path: Path) -> Path:
    lecture = build_lecture_pptx()
    entries: dict[str, bytes] = {
        "index.html": OVERVIEW_HTML.encode("utf-8"),
        "Week 1/Lecture01_intro.pptx": lecture,
        "Week 1/copy_of_intro.pptx": lecture,  # duplicate content
        "Week 2/old_lecture.ppt": b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1" + b"\x00" * 600,  # broken legacy file
        "Week 3/notes.docx": build_notes_docx(),
        "Extra/Week_3_extra.pptx": build_extra_pptx(),
        "Textbook/Fixture_Networking_Textbook.pdf": build_textbook_pdf(),
        "images/logo.png": png_bytes(),
        "readme.txt": f"{MARK}\nThis archive is generated by the test suite.\n".encode(),
        "__MACOSX/._index.html": b"\x00\x05\x16\x07",
        ".DS_Store": b"\x00\x00\x00\x01Bud1",
    }
    with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for name, data in entries.items():
            archive.writestr(name, data)
    return path


def build_malicious_archive(path: Path) -> Path:
    with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("index.html", "<html><body><h2>Week 1</h2><p>ok</p><h2>Week 2</h2></body></html>")
        archive.writestr("../evil.txt", "escape attempt")
        archive.writestr("/abs/evil.txt", "absolute path")
        archive.writestr("C:/windows/evil.txt", "drive path")
        link = zipfile.ZipInfo("link_to_etc")
        link.external_attr = (0o120777 << 16)
        archive.writestr(link, "/etc/passwd")
        archive.writestr("secret.txt", "pretend-encrypted")
        archive.writestr("bomb.bin", b"\x00" * (3 * 1024 * 1024))  # ~1000:1 ratio
        archive.writestr("safe/ok.txt", "fine")
    _set_encrypted_flag(path, "secret.txt")
    return path


def _set_encrypted_flag(path: Path, member: str) -> None:
    """zipfile cannot write encrypted entries, so set the flag bit in the headers."""
    data = bytearray(path.read_bytes())
    name = member.encode()
    for signature, flag_offset, name_len_offset, header_len in ((b"PK\x03\x04", 6, 26, 30), (b"PK\x01\x02", 8, 28, 46)):
        start = 0
        while (pos := data.find(signature, start)) != -1:
            length = int.from_bytes(data[pos + name_len_offset : pos + name_len_offset + 2], "little")
            if data[pos + header_len : pos + header_len + length] == name:
                data[pos + flag_offset] |= 0x01
            start = pos + 4
    path.write_bytes(bytes(data))
