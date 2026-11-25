# Format guide

Your resumes and cover letters are generated from two small settings files in this folder:

- `resume-format.json`: the resume look.
- `cover-letter-format.json`: the cover-letter look.

Change a number or a font name there, then ask your assistant to "refresh my templates". It runs the `docs.refresh-templates` operation and every new document uses the new look. Content and format are separate: the same content can be re-rendered in a new style at any time.

## Resume style (default)

A clean, two-page-friendly research and program style. It suits academic-to-industry, research development, operations and most professional roles.

| Element | Setting |
|---|---|
| Page | US Letter, one column. Margins: 0.40" top, 0.35" bottom, 0.55" left and right |
| Font | Times New Roman throughout, black text, 1.05 line spacing |
| Name | Centred, uppercase, 18 pt bold |
| Contact line | Centred, 10.5 pt, items separated by " \| " |
| Under the contact line | Full-width dark rule (2.5 pt, #1D1D1F) |
| Summary | Unlabelled 11 pt paragraph (1.1 spacing), with an optional italic tagline on the first line and a light rule under it (0.5 pt, #E5E5E7) |
| Section headings | Uppercase, bold, 11 pt, with a grey rule under each (1.5 pt, #D1D1D6) |
| Role line | **Title** \| *Organization* \| *Unit*, with the dates right-aligned on the same line |
| Bullets | Round bullets indented 0.40" (0.15" hanging), 11 pt. An optional **bold lead-in** can start a bullet. A light rule (0.5 pt, #EBEBED) follows each role's last bullet |
| Education | **Degree** \| Institution, with the date right-aligned |
| Skills / honours | Short paragraphs, optionally starting with a **bold label:** |

### Layout rules

- **Pagination:** headings and role lines stay attached to the text below them, and no paragraph splits across pages. If a section starts awkwardly near the bottom of page 1, set `"pageBreakBefore": true` on that section.
- **Never shrink the type to force a page count.** Cut or tighten content instead.
- **Sections follow the job:** headings are free text. Order and name them for the role (for example *Grant Development*, *Research Experience*, *Partnerships and Program Operations*, *Education*, *Digital Skills*).
- **Formatting inside text:** `**bold**` and `*italic*` work in any field.

## Cover-letter style (default)

| Element | Setting |
|---|---|
| Page | US Letter, one page. Margins: 0.68" top, 0.62" bottom, 0.78" left and right |
| Font | Arial 11 pt, 1.06 line spacing, 8 pt after each paragraph |
| Title line | "Application for {role}" in Calibri, 17 pt bold, left-aligned |
| Contact line | Your name \| city \| phone \| email, 10 pt |
| Then | Date, recipient block, salutation, 4–5 short paragraphs (about 280–380 words in total), closing, typed name |

## Content files

The assistant writes a small JSON file with the content and renders it. You can open `Resume master.docx` and `Cover letter master.docx` in Word to see every slot. The `Examples/` folder shows a fully filled-in fictional resume and letter.

Resume content looks like this:

```json
{
  "name": "Alex Rivera",
  "contact": ["Springfield", "(555) 010-0199", "alex@example.com"],
  "tagline": "Research development and scientific operations",
  "summary": "Two or three sentences for this role.",
  "sections": [
    { "heading": "Research and Field Experience",
      "intro": "**Publication record:** 9 articles in *Journal A* and *Journal B*.",
      "entries": [ { "title": "Research Associate", "organization": "Springfield University", "unit": "Environmental Science", "dates": "2025 – present",
                     "bullets": ["**Lead-in.** What you did and the result."] } ] },
    { "heading": "Education", "type": "education",
      "entries": [ { "title": "PhD, Environmental Science", "organization": "Springfield University", "dates": "2025" } ] },
    { "heading": "Digital Skills", "paragraphs": ["**Data:** R, Python, SQL"] }
  ]
}
```

## Before a document is ready

The assistant exports a PDF and looks at every page: no leftover `{{placeholders}}`, no stranded headings, no clipped dates, and the fonts as set here. The full list is in `Review Checklist.md`.
