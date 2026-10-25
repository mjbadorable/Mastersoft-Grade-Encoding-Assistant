// "Upload syllabus": reads a University of San Agustin course syllabus PDF in the browser
// (pdf.js) and builds the class's OBE setup from it. Nothing is uploaded anywhere.
//
// Syllabi are tables, and their plain text comes out scrambled, so the parser works on
// positioned lines: each piece of text keeps its x position, and the columns (module,
// CO links, learning outcomes) are told apart by where they sit on the page.
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { OBE_PASS_RAW_PCT, OBE_TARGET_CLASS_PCT, type AgaCode, type ObeConfig, type Term } from '../engine';

/** What the parser finds in a syllabus, before ids are given. */
export interface SyllabusExtraction {
  collegeName: string;
  programName: string;
  pos: { code: string; description: string }[];
  cos: { code: string; description: string; agaCodes: AgaCode[]; poCodes: string[] }[];
  los: { code: string; moduleCode: string; term: Term; coCodes: string[]; description: string }[];
  passRawPct: number | null;
  targetClassPct: number | null;
  notes: string[];
}

export interface SyllabusSegment {
  x: number;
  text: string;
}
/** One line of a page: the text pieces at the same height, left to right. */
export interface SyllabusLine {
  page: number;
  segs: SyllabusSegment[];
}

export const SYLLABUS_FILE_TYPES = '.pdf';
const MAX_FILE_BYTES = 5 * 1024 * 1024;

/** Pieces of text within this many points of height are on the same line. */
const SAME_LINE = 2;

/** Positioned lines of every page, top to bottom, left to right. */
export async function pdfLines(doc: PDFDocumentProxy): Promise<SyllabusLine[]> {
  const lines: SyllabusLine[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const { items } = await (await doc.getPage(p)).getTextContent();
    const pieces = items
      .flatMap((i) => ('str' in i && i.str.trim() !== '' ? [{ x: i.transform[4] as number, y: i.transform[5] as number, text: i.str.trim() }] : []))
      .sort((a, b) => b.y - a.y || a.x - b.x);
    const rows: { y: number; segs: SyllabusSegment[] }[] = [];
    for (const piece of pieces) {
      const row = rows.find((r) => Math.abs(r.y - piece.y) <= SAME_LINE);
      if (row) row.segs.push({ x: piece.x, text: piece.text });
      else rows.push({ y: piece.y, segs: [{ x: piece.x, text: piece.text }] });
    }
    rows.sort((a, b) => b.y - a.y);
    for (const row of rows) lines.push({ page: p, segs: row.segs.sort((a, b) => a.x - b.x) });
  }
  return lines;
}

/** Reads a syllabus PDF in the browser. pdf.js is loaded only when a teacher uploads one. */
export async function readSyllabusFile(file: File): Promise<SyllabusExtraction> {
  if (!/\.pdf$/i.test(file.name)) throw new Error('Please upload a PDF (.pdf) course syllabus.');
  if (file.size > MAX_FILE_BYTES) throw new Error('The PDF is larger than 5 MB.');
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  try {
    let doc: PDFDocumentProxy;
    try {
      doc = await task.promise;
    } catch {
      throw new Error('This PDF could not be opened. If it is password-protected, save an unprotected copy and try again.');
    }
    return extractSyllabusFromLines(await pdfLines(doc));
  } finally {
    void task.destroy();
  }
}

const lineText = (line: SyllabusLine) => line.segs.map((s) => s.text).join(' ').replace(/\s+/g, ' ').trim();
const join = (parts: string[]) => parts.join(' ').replace(/\s+/g, ' ').trim();
const titleCase = (s: string) => (s === s.toUpperCase() ? s.toLowerCase().replace(/\b(?!of\b|and\b)\w/g, (c) => c.toUpperCase()) : s);

const TERM_HEADING = /^(start of\s+)?(prelim|midterm|finals?|final\s+term)(\s+period)?$/i;
const termOf = (heading: string): Term => (/prelim/i.test(heading) ? 'PRELIM' : /mid/i.test(heading) ? 'MIDTERM' : 'FINAL');

/** Program outcomes: lettered rows under "PROGRAM OUTCOMES (PO)". */
function readPos(lines: SyllabusLine[]) {
  const pos: SyllabusExtraction['pos'] = [];
  const start = lines.findIndex((l) => l.segs.some((s) => /^PROGRAM OUTCOMES/i.test(s.text)));
  if (start < 0) return pos;
  const colX = lines[start]!.segs.find((s) => /^PROGRAM OUTCOMES/i.test(s.text))!.x;
  let page = lines[start]!.page;
  for (const line of lines.slice(start + 1)) {
    if (/Course (Title|Description|Outcomes)/i.test(lineText(line))) break;
    const segs = line.segs.filter((s) => s.x >= colX - 6);
    const first = segs[0];
    if (!first || first.x > colX + 30) continue;
    const text = join(segs.map((s) => s.text));
    const code = /^([A-Za-z])\.\s*(.*)$/.exec(text);
    if (code && first.x <= colX + 6) pos.push({ code: code[1]!, description: code[2]! });
    // A wrapped description continues on the same page; the list itself may carry on to the next.
    else if (pos.length > 0 && line.page === page) pos.at(-1)!.description = join([pos.at(-1)!.description, text]);
    page = line.page;
  }
  return pos;
}

/** Course outcomes: "CO 1:" rows, with descriptions, AGA letters and PO code letters by column. */
function readCos(lines: SyllabusLine[]) {
  const cos: SyllabusExtraction['cos'] = [];
  const h = lines.findIndex((l) => l.segs.some((s) => /^Course Outcomes/i.test(s.text)));
  if (h < 0) return cos;
  const halves = lines[h]!.segs.filter((s) => /^Course Outcomes/i.test(s.text)).map((s) => s.x);
  const near = lines.slice(Math.max(0, h - 2), h + 3).flatMap((l) => (l.page === lines[h]!.page ? l.segs : []));
  let end = h + 1;
  while (end < lines.length && lines[end]!.page === lines[h]!.page && !/^(Mod|Module|Learning Outcomes)/i.test(lineText(lines[end]!))) end++;

  halves.forEach((halfX, half) => {
    const halfEnd = halves[half + 1] ?? Infinity;
    const inHalf = (x: number) => x >= halfX - 10 && x < halfEnd - 10;
    const agaX = near.find((s) => s.text === 'AGA' && inHalf(s.x))?.x;
    const poX = near.find((s) => /^PO Code/i.test(s.text) && inHalf(s.x))?.x;
    const firstColumn = agaX ?? poX ?? halfEnd;
    const markers: { line: number; code: string; x: number }[] = [];
    for (let i = h + 1; i < end; i++) {
      for (const s of lines[i]!.segs) {
        const m = /^CO\s*(\d+)\s*:?\s*(.*)$/i.exec(s.text);
        if (m && inHalf(s.x) && s.x < firstColumn - 20) markers.push({ line: i, code: `CO${m[1]}`, x: s.x });
      }
    }
    const descs = new Map(markers.map((m) => [m.line, [] as string[]]));
    for (let i = h + 1; i < end; i++) {
      const parts = lines[i]!.segs.filter((s) => markers.length > 0 && s.x > markers[0]!.x && s.x < firstColumn - 20);
      const text = join(parts.map((s) => s.text.replace(/^CO\s*\d+\s*:\s*/i, '')));
      if (!text || markers.length === 0) continue;
      const nearest = markers.reduce((best, m) => (Math.abs(m.line - i) < Math.abs(best.line - i) ? m : best));
      descs.get(nearest.line)!.push(text);
    }
    for (const m of markers) {
      const letters = (from: number, to: number) =>
        lines[m.line]!.segs.filter((s) => s.x >= from && s.x < to).flatMap((s) => s.text.split(/[\s,]+/).filter((t) => /^[A-Za-z]$/.test(t)));
      cos.push({
        code: m.code,
        description: join(descs.get(m.line)!),
        agaCodes: agaX === undefined ? [] : (letters(agaX - 20, (poX ?? halfEnd) - 10).filter((t) => /^[ABC]$/.test(t)) as AgaCode[]),
        poCodes: poX === undefined ? [] : letters(poX - 15, halfEnd - 10),
      });
    }
  });
  return cos.sort((a, b) => Number(a.code.slice(2)) - Number(b.code.slice(2)));
}

interface ModuleDraft {
  code: string;
  term: Term;
  first: number;
  last: number;
  coCodes: Set<string>;
}

/**
 * Modules and learning outcomes per grading period. Two USA formats:
 * decimal LOs ("LO 1.1" … "LO 6.6", module from the first number; LO 0.x orientation is skipped)
 * and per-module LOs ("LO1." … restarting in each module, coded "M1-LO1").
 */
function readLos(lines: SyllabusLine[], notes: string[]) {
  const los: (SyllabusExtraction['los'][number] & { line: number })[] = [];
  const modules: ModuleDraft[] = [];
  const markerLines = new Map<string, number>();
  const coMarks: { line: number; code: string }[] = [];
  let term: Term | null = null;
  let loX: number | null = null;
  let open: { x: number; parts: string[] } | null = null;
  let lastNumber = 0;
  let perModuleCount = 0;
  /** Set at the final examination: what follows (grading system, rubrics) is not modules. */
  let done = false;

  const moduleFor = (code: string, line: number): ModuleDraft => {
    let m = modules.find((d) => d.code === code);
    if (!m) {
      m = { code, term: term!, first: markerLines.get(code) ?? line, last: line, coCodes: new Set() };
      modules.push(m);
    }
    m.last = Math.max(m.last, line);
    return m;
  };
  const close = () => {
    if (open && los.length > 0) los.at(-1)!.description = join(open.parts);
    open = null;
  };

  lines.forEach((line, i) => {
    const text = lineText(line);
    if (TERM_HEADING.test(text)) {
      close();
      term = termOf(text);
      return;
    }
    if (!term || done) return;
    if (/^FINALS?( TERM)? EXAMINATION/i.test(text)) {
      close();
      done = true;
      return;
    }
    if (/EXAMINATION/i.test(text) && line.segs[0]!.x < (loX ?? Infinity)) close();
    const marker = /^M(\d+)\b/.exec(line.segs[0]!.text);
    if (marker && line.segs[0]!.x < (loX ?? Infinity) - 20) markerLines.set(`M${marker[1]}`, i);
    for (const s of line.segs) {
      const co = /^CO\s?(\d+)$/i.exec(s.text);
      if (co && (loX === null || s.x < loX - 10)) coMarks.push({ line: i, code: `CO${co[1]}` });
    }

    const loSeg = line.segs.find((s) => /^LO\s?\d+(\.\d+)?\.?(\s|$)/.test(s.text) && (loX === null || Math.abs(s.x - loX) <= 10));
    if (loSeg) {
      close();
      loX ??= loSeg.x;
      const body = join(line.segs.filter((s) => s.x >= loSeg.x && s.x < loSeg.x + 60).map((s) => s.text));
      const decimal = /^LO\s?(\d+)\.(\d+)\.?\s*(.*)$/.exec(body);
      const single = /^LO\s?(\d+)\.?\s*(.*)$/.exec(body);
      let code: string;
      let moduleCode: string;
      let description: string;
      if (decimal) {
        if (decimal[1] === '0') return; // orientation module (M0)
        moduleCode = `M${decimal[1]}`;
        code = `LO ${decimal[1]}.${decimal[2]}`;
        description = decimal[3]!;
      } else {
        const n = Number(single![1]);
        if (n <= lastNumber || perModuleCount === 0) perModuleCount++;
        lastNumber = n;
        moduleCode = `M${perModuleCount}`;
        code = `${moduleCode}-LO${n}`;
        description = single![2]!;
      }
      moduleFor(moduleCode, i);
      los.push({ code, moduleCode, term, coCodes: [], description, line: i });
      open = { x: loSeg.x, parts: [description] };
      return;
    }
    if (!open) return;
    const cont = line.segs.filter((s) => s.x >= open!.x - 3 && s.x < open!.x + 40);
    if (cont.length === 0) return;
    const contText = join(cont.map((s) => s.text));
    if (/^(LEC|LAB)$/i.test(contText) || /at the end of|student shall|be able to:|^Coverage/i.test(contText)) {
      close();
      return;
    }
    open.parts.push(contText);
    const m = modules.find((d) => d.code === los.at(-1)!.moduleCode)!;
    m.last = Math.max(m.last, i);
  });
  close();

  // A module's CO links sit beside its rows, so each link goes to the module whose rows are nearest.
  for (const mark of coMarks) {
    const distance = (m: ModuleDraft) => (mark.line < m.first ? m.first - mark.line : mark.line > m.last ? mark.line - m.last : 0);
    const best = modules.reduce<ModuleDraft | null>((b, m) => (!b || distance(m) <= distance(b) ? m : b), null);
    if (best && distance(best) <= 30) best.coCodes.add(mark.code);
  }
  for (const m of modules) if (m.coCodes.size === 0) notes.push(`No course outcome link was found for module ${m.code}; add its COs in the Learning outcomes table.`);
  return los.map(({ line: _line, ...lo }) => ({ ...lo, coCodes: [...modules.find((m) => m.code === lo.moduleCode)!.coCodes].sort() }));
}

/** Parses a USA syllabus from its positioned lines (see `pdfLines`). */
export function extractSyllabusFromLines(allLines: SyllabusLine[]): SyllabusExtraction {
  const notes: string[] = [];
  // The page header's "Page 4 of 36" sits inside the LO column on some syllabi.
  const lines = allLines.filter((l) => !/\bPage\s*\d+\s*of\s*\d+\b/i.test(lineText(l)));
  const all = lines.map(lineText);
  const college = lines.flatMap((l) => l.segs).find((s) => /^college of\s+\S/i.test(s.text))?.text ?? '';
  const program = /students of the (.+?) program/i.exec(all.join('\n'))?.[1] ?? '';
  const cutoff = /(?:cut\s*-?\s*off score\s*=?\s*|passing rate[^%\n]{0,80}?)(\d{1,3})\s*%/i.exec(all.join('\n'));
  const pos = readPos(lines);
  const cos = readCos(lines);
  const los = readLos(lines, notes);
  if (pos.length === 0) notes.push('No program outcomes were found; add them in the Program outcomes table.');
  if (cos.length === 0) notes.push('No course outcomes were found. This reader knows the University of San Agustin syllabus layout; set up the outcomes by hand.');
  if (los.length === 0) notes.push('No learning outcomes were found; add them in the Learning outcomes table.');
  return {
    collegeName: titleCase(college.trim()),
    programName: program.trim(),
    pos,
    cos,
    los,
    passRawPct: cutoff ? Number(cutoff[1]) : null,
    targetClassPct: null,
    notes,
  };
}

const key = (code: string) => code.replace(/\s+/g, '').toUpperCase();

/** Gives repeated codes a suffix, e.g. a second "LO 2.3" becomes "LO 2.3 (2)". */
function uniqueCodes<T extends { code: string }>(items: T[], kind: string, notes: string[]): T[] {
  const seen = new Map<string, number>();
  return items.map((item) => {
    const n = (seen.get(key(item.code)) ?? 0) + 1;
    seen.set(key(item.code), n);
    if (n === 1) return item;
    notes.push(`The syllabus uses ${kind} code "${item.code}" more than once; the repeat is named "${item.code} (${n})".`);
    return { ...item, code: `${item.code} (${n})` };
  });
}

/** Builds the class's OBE setup from what the parser found; `nid` makes the ids. */
export function obeConfigFromExtraction(x: SyllabusExtraction, nid: () => string): { config: ObeConfig; notes: string[] } {
  const notes = [...x.notes];
  const pos = uniqueCodes(x.pos, 'PO', notes).map((p) => ({ id: nid(), code: p.code.trim(), description: p.description.trim() }));
  const poByKey = new Map(pos.map((p) => [key(p.code), p.code]));
  const cos = uniqueCodes(x.cos, 'CO', notes).map((c) => {
    const poCodes: string[] = [];
    for (const code of c.poCodes) {
      const known = poByKey.get(key(code));
      if (known === undefined) notes.push(`${c.code} links to PO "${code}", which is not in the PO list; the link was left out.`);
      else if (!poCodes.includes(known)) poCodes.push(known);
    }
    return {
      id: nid(),
      code: c.code.trim(),
      description: c.description.trim(),
      agaCodes: [...new Set(c.agaCodes)],
      poCodes,
      passRawPct: x.passRawPct ?? OBE_PASS_RAW_PCT,
      targetClassPct: x.targetClassPct ?? OBE_TARGET_CLASS_PCT,
    };
  });
  const coByKey = new Map(cos.map((c) => [key(c.code), c.id]));
  const los = uniqueCodes(x.los, 'LO', notes).map((l) => {
    const coIds = [...new Set(l.coCodes.map((code) => coByKey.get(key(code))).filter((id) => id !== undefined))];
    if (coIds.length === 0) notes.push(`${l.code} has no course outcome link; add one in the Learning outcomes table.`);
    return { id: nid(), code: l.code.trim(), moduleCode: l.moduleCode.trim(), term: l.term, coIds, description: l.description.trim() };
  });
  return {
    config: {
      collegeName: x.collegeName.trim() || undefined,
      programName: x.programName.trim() || undefined,
      pos,
      cos,
      los,
    },
    notes,
  };
}
