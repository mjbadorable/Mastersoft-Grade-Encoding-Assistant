# Zero-Cost Client-Side PDF Syllabus Parser & Browser Storage Prompt for Claude

### Why Claude Mentioned Cost & Firebase Functions (and How We Fix It)
In your screenshot, Claude created a `functions/` backend folder (Firebase Cloud Functions, which requires upgrading Firebase to the paid **Blaze plan**) and wired it to call the paid **Anthropic Claude API** (`$0.25–$0.35` per upload).

We do **not** need Firebase Functions, Firebase Storage, or any paid AI API!
1. **100% Free Client-Side PDF Parsing (`pdfjs-dist`):** Because University of San Agustin syllabi (`HM5`, `CpE122`, etc.) follow standard table structures (`PROGRAM OUTCOMES (PO)`, `Course Outcomes: CO1..CO5`, `AGA Link(s)`, `PO Code Link(s)`, `PRELIM / MIDTERM / FINALS`, `M1..M8`, `LO 1.1..LO 6.6` or `LO1..LO6`), the browser can extract text items and coordinates directly from the `.pdf` using Mozilla's `pdfjs-dist` **100% offline in the browser** with **$0.00 cost**.
2. **PDF-Only Format (`accept=".pdf"`, size cap e.g. `5 MB`):** Restricting uploads to `.pdf` keeps the file compact, predictable, and fast.
3. **100% Local Browser Storage (`Dexie` / `IndexedDB`):** Both the extracted `ObeConfig` (`COs`, `POs`, `LOs`) and the compact syllabus metadata (or PDF blob if desired) are saved directly in the teacher's browser `IndexedDB` (`src/app/db.ts`), and the `PrivacyNotice.tsx` stays 100% local (no data ever leaves the browser!).

---

## Copy-Paste Prompt for Claude

Copy and paste the block below into Claude (or tell Claude: *"Read `docs/07_client_side_pdf_syllabus_prompt.md` and execute it"*):

````markdown
Replace the server-side Firebase Function syllabus reader with a **100% free, client-side PDF-only parser and local browser storage (IndexedDB)**. I do NOT want to pay for Firebase Functions/Storage or Anthropic API calls—everything must run and save locally in the user's browser.

### EXACT CHANGES REQUIRED:

1. **Remove Server / Paid Dependencies (`functions/`, `firebase.json`, `vite.config.ts`, `PrivacyNotice.tsx`):**
   - Delete the entire `functions/` directory.
   - In `firebase.json`: remove the `"functions"` block and remove the `/api/read-syllabus` rewrite so the project remains 100% free static Firebase Hosting (`spark` plan compatible).
   - In `vite.config.ts`: remove any `/api/read-syllabus` proxy if added.
   - In `src/components/PrivacyNotice.tsx`: remove the paragraph `"One exception: reading a syllabus..."` so our privacy guarantee remains 100% strict (*no files or data ever leave this browser*).

2. **PDF-Only Client-Side Syllabus Parser (`src/app/syllabusReader.ts`):**
   - Install `pdfjs-dist` (or use a lightweight local PDF text/layout extractor with `pdfjs-dist`).
   - Change `SYLLABUS_FILE_TYPES` to `'.pdf'` only, with a compact size limit (`MAX_FILE_BYTES = 5 * 1024 * 1024` / 5 MB) so browser storage stays fast and lightweight. Reject non-PDF files with `'Please upload a PDF (.pdf) course syllabus.'`.
   - Extract text lines (ordered by page, Y-coordinate top-to-bottom, X-coordinate left-to-right) in the browser and parse the University of San Agustin syllabus structure deterministically (`extractSyllabusFromText(pages: string[]): SyllabusExtraction`):
     - **College & Program Name:** Match lines after `UNIVERSITY OF SAN AGUSTIN` (`College of ...`, `Department of ...`, or `students of the BS... program`).
     - **Program Outcomes (`pos`):** Extract rows under `PROGRAM OUTCOMES (PO)` matching letter codes (`A.`–`Z.` or `a.`–`n.`) and their descriptions.
     - **Course Outcomes (`cos`), `agaCodes`, and `poCodes`:** Match `CO 1:` / `CO1:` descriptions, `AGA Link(s)` (`A`, `B`, `C`), and `PO Code Link(s)` (`A..H` or `a..n`).
     - **Modules & Learning Outcomes (`los`) per Term (`PRELIM`, `MIDTERM`, `FINAL`):**
       - Track the active term as headings `PRELIM`, `MIDTERM`, `FINALS` / `FINAL TERM` appear.
       - Track module codes (`M1`..`M8` or `Module 1`..`Module 8`) and their linked `CO1, CO2...` codes.
       - Extract Learning Outcomes in both USA syllabus formats:
         - Decimal format: `LO 1.1`, `LO 1.2` ... `LO 6.6` (like the HM5 COB syllabus, skipping `M0` / `LO 0.x` orientation items).
         - Per-module format: `LO1.`, `LO2.` ... under `Module 1`..`Module 8` (like the CpE122 COT syllabus, normalizing code to `M1-LO1`, `M1-LO2` so codes are unique).
     - **Passing Cutoff:** Detect `Passing rate ... is 60%` or `Cut off score = 60%` → `passRawPct = 60`.

3. **Save in Browser IndexedDB (`src/app/types.ts`, `src/app/store.ts`, `src/components/ObeDashboard.tsx`):**
   - Store the parsed `ObeConfig` plus optional syllabus file metadata (`syllabusFileName?: string`, `syllabusUploadedAt?: number`) directly inside `ClassRecord.obe` in IndexedDB (`db.classes` via `setObeConfig`) so it persists automatically in the teacher's browser storage and is included in JSON backups without bloating file size.
   - Update `SyllabusReader` UI copy in `src/components/ObeDashboard.tsx` to say:
     - *"Upload your course syllabus (**PDF format**, max 5 MB). It is read 100% locally in your browser and saved to your browser storage—no server upload or API cost."*

4. **Verify Against Both Real Syllabi (`tests/app/syllabusReader.test.ts`):**
   - Test `readSyllabusFile` / `extractSyllabusFromText` against the actual `HM5` and `CpE122` PDFs in `C:\Users\Marvin\Downloads\Course Syllabus\` (or their extracted text fixtures) to verify that all POs, COs, AGA/PO links, Modules, Terms, and LOs parse accurately.
   - Run `npx.cmd vitest run` and `npm.cmd run build`.
````
