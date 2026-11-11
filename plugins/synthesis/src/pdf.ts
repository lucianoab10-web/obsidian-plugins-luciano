import { marked, type Token, type Tokens } from 'marked';
import * as pdfMake from 'pdfmake/build/pdfmake';
import vfsFonts from 'pdfmake/build/vfs_fonts';
import { SYMBOLS_REGEX, SYMBOLS_TTF_BASE64 } from './symbols-font';

export interface PdfImage {
	id: number;
	dataUrl: string;
	width: number;
	height: number;
	name: string;
}

export interface PdfOptions {
	fallbackTitle: string;
	/** Títulos de las notas fuente (se listan bajo el título). */
	sources: string[];
	images: Map<number, PdfImage>;
	pageSize: 'LETTER' | 'A4';
	modelLabel: string;
	generatedAt?: Date;
}

export interface PdfResult {
	buffer: ArrayBuffer;
	title: string;
}

// Los nodos de pdfmake son objetos literales con muchas formas posibles.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PNode = any;

const PAGE = { LETTER: { w: 612, h: 792 }, A4: { w: 595.28, h: 841.89 } } as const;
const MX = 54;
const MT = 52;
const MB = 60;

const C = {
	text: '#1f2937',
	muted: '#6b7280',
	primary: '#1e3a8a',
	rule: '#cbd5e1',
	th: '#e0e7ff',
	zebra: '#f8fafc',
	code: '#f1f5f9',
	codeText: '#9a3412',
};

/* ───────────── Recuadros de color (citas Markdown que empiezan con una etiqueta en negrita) ───────────── */

interface Callout {
	label: string;
	color: string;
	bg: string;
}

const NEUTRAL: Callout = { label: '', color: '#94a3b8', bg: '#f8fafc' };
const CALLOUTS: Record<string, Callout> = {
	definicion: { label: 'Definición', color: '#1d4ed8', bg: '#eff6ff' },
	'idea clave': { label: 'Idea clave', color: '#6d28d9', bg: '#f5f3ff' },
	proceso: { label: 'Proceso', color: '#047857', bg: '#ecfdf5' },
	relacion: { label: 'Relación', color: '#0e7490', bg: '#ecfeff' },
	dato: { label: 'Dato', color: '#b45309', bg: '#fffbeb' },
	formula: { label: 'Fórmula', color: '#4338ca', bg: '#eef2ff' },
	ojo: { label: 'Ojo', color: '#b91c1c', bg: '#fef2f2' },
};
const ALIASES: Record<string, string> = {
	definiciones: 'definicion',
	concepto: 'definicion',
	'ideas clave': 'idea clave',
	procesos: 'proceso',
	relaciones: 'relacion',
	datos: 'dato',
	fecha: 'dato',
	fechas: 'dato',
	formulas: 'formula',
	discrepancia: 'ojo',
	advertencia: 'ojo',
	atencion: 'ojo',
	'no especificado': 'ojo',
};

function lookupCallout(raw: string): Callout | undefined {
	const key = raw
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLowerCase()
		.replace(/[:：.\s]+$/, '')
		.trim();
	return CALLOUTS[ALIASES[key] ?? key];
}

/* ───────────── Utilidades ───────────── */

function decodeEntities(s: string): string {
	return s.replace(/&(#x?[0-9a-fA-F]+|amp|lt|gt|quot|apos|nbsp);/g, (m: string, g: string) => {
		switch (g) {
			case 'amp':
				return '&';
			case 'lt':
				return '<';
			case 'gt':
				return '>';
			case 'quot':
				return '"';
			case 'apos':
				return "'";
			case 'nbsp':
				return '\u00A0';
		}
		const code = g[1] === 'x' || g[1] === 'X' ? parseInt(g.slice(2), 16) : parseInt(g.slice(1), 10);
		return Number.isFinite(code) ? String.fromCodePoint(code) : m;
	});
}

function plain(tokens: Token[] | undefined): string {
	if (!tokens) return '';
	return tokens
		.map((t) => {
			const x = t as { tokens?: Token[]; text?: string };
			if (x.tokens) return plain(x.tokens);
			return typeof x.text === 'string' ? decodeEntities(x.text) : '';
		})
		.join('');
}

const FIGURE_RE = /^(?:imagen|image|img)[:\s]*(\d+)$/i;

/* ───────────── Conversión Markdown → nodos de pdfmake ───────────── */

class Builder {
	title = '';
	private depth = 0;

	constructor(
		private readonly opt: PdfOptions,
		private readonly cw: number,
	) {}

	blocks(tokens: Token[]): PNode[] {
		const out: PNode[] = [];
		for (const t of tokens) {
			if (t.type === 'heading' && (t as Tokens.Heading).depth === 1 && !this.title) {
				this.title = plain((t as Tokens.Heading).tokens).trim();
				continue; // el primer H1 es el título del documento (se dibuja aparte)
			}
			out.push(...this.block(t));
		}
		return out;
	}

	private block(t: Token): PNode[] {
		switch (t.type) {
			case 'heading':
				return this.heading(t as Tokens.Heading);
			case 'paragraph':
				return this.paragraph(t as Tokens.Paragraph);
			case 'text': {
				const tt = t as Tokens.Text;
				const runs = this.inline(tt.tokens ?? [tt]);
				return runs.length ? [{ text: runs, margin: [0, 0, 0, 4] }] : [];
			}
			case 'list':
				return [this.list(t as Tokens.List)];
			case 'table':
				return [this.table(t as Tokens.Table)];
			case 'blockquote':
				return [this.quote(t as Tokens.Blockquote)];
			case 'code':
				return [this.code(t as Tokens.Code)];
			case 'hr':
				return [
					{
						canvas: [{ type: 'line', x1: 0, y1: 0, x2: this.cw, y2: 0, lineWidth: 0.6, lineColor: C.rule }],
						margin: [0, 6, 0, 8],
					},
				];
			default:
				return []; // space, html, etc.
		}
	}

	private heading(t: Tokens.Heading): PNode[] {
		const runs = this.inline(t.tokens);
		if (t.depth <= 2) {
			return [
				{ text: runs, style: 'h2', headlineLevel: 2 },
				{
					canvas: [{ type: 'line', x1: 0, y1: 0, x2: this.cw, y2: 0, lineWidth: 0.9, lineColor: C.rule }],
					margin: [0, 1, 0, 7],
				},
			];
		}
		if (t.depth === 3) return [{ text: runs, style: 'h3', headlineLevel: 3 }];
		return [{ text: runs, style: 'h4', headlineLevel: 4 }];
	}

	private paragraph(t: Tokens.Paragraph): PNode[] {
		const out: PNode[] = [];
		let buf: Token[] = [];
		const flush = () => {
			if (!buf.length) return;
			const runs = this.inline(buf);
			if (runs.some((r) => String(r.text).trim())) out.push({ text: runs, margin: [0, 0, 0, 5] });
			buf = [];
		};
		for (const tok of t.tokens) {
			if (tok.type === 'image') {
				flush();
				const img = tok as Tokens.Image;
				const m = FIGURE_RE.exec(img.href.trim());
				if (m) out.push(...this.figure(Number(m[1]), decodeEntities(img.text ?? '').trim()));
			} else {
				buf.push(tok);
			}
		}
		flush();
		return out;
	}

	private figure(n: number, caption: string): PNode[] {
		const img = this.opt.images.get(n);
		if (!img) return [];
		const k = Math.min(0.75, (this.cw * 0.92) / img.width, 300 / img.height);
		const stack: PNode[] = [{ image: img.dataUrl, width: img.width * k, height: img.height * k, alignment: 'center' }];
		if (caption) stack.push({ text: caption, style: 'caption', alignment: 'center', margin: [0, 3, 0, 0] });
		return [{ stack, margin: [0, 6, 0, 10], unbreakable: true }];
	}

	private list(t: Tokens.List): PNode {
		this.depth++;
		const items = t.items.map((it) => this.listItem(it));
		this.depth--;
		const base = { margin: this.depth === 0 ? [0, 1, 0, 7] : [0, 1, 0, 1], markerColor: '#2563eb' };
		return t.ordered
			? { ol: items, start: typeof t.start === 'number' ? t.start : 1, ...base }
			: { ul: items, ...base };
	}

	private listItem(it: Tokens.ListItem): PNode {
		const parts: PNode[] = [];
		for (const sub of it.tokens) {
			if (sub.type === 'text') {
				const st = sub as Tokens.Text;
				const runs = this.inline(st.tokens ?? [st]);
				if (runs.length) parts.push({ text: runs, margin: [0, 0, 0, 2] });
			} else {
				parts.push(...this.block(sub));
			}
		}
		if (!parts.length) return { text: '' };
		return parts.length === 1 ? parts[0] : { stack: parts };
	}

	private table(t: Tokens.Table): PNode {
		const cols = t.header.length;
		const cell = (c: Tokens.TableCell, header: boolean, i: number): PNode => ({
			text: this.inline(c.tokens, header ? { bold: true, color: C.primary } : {}),
			style: 'td',
			alignment: t.align[i] ?? 'left',
		});
		const body: PNode[][] = [
			t.header.map((c, i) => cell(c, true, i)),
			...t.rows.map((r) => r.map((c, i) => cell(c, false, i))),
		];

		// Anchos proporcionales al largo del texto de cada columna (con mínimos y máximos razonables).
		const weights = Array.from({ length: cols }, (_, i) => {
			const lens = [plain(t.header[i]?.tokens).length, ...t.rows.map((r) => plain(r[i]?.tokens).length)];
			return Math.min(Math.max(...lens, 6), 70);
		});
		const sum = weights.reduce((a, b) => a + b, 0);
		// Los anchos numéricos de pdfmake excluyen el relleno de las celdas (6 pt a cada lado).
		const avail = this.cw - cols * 12;
		let widths = weights.map((w) => Math.max(40, (w / sum) * avail));
		const total = widths.reduce((a, b) => a + b, 0);
		widths = widths.map((w) => (w * avail) / total);

		return {
			table: { headerRows: 1, keepWithHeaderRows: 1, dontBreakRows: true, widths, body },
			layout: {
				hLineWidth: (i: number, node: PNode) => (i === 0 || i === node.table.body.length ? 0.9 : 0.4),
				vLineWidth: () => 0,
				hLineColor: () => C.rule,
				paddingLeft: () => 6,
				paddingRight: () => 6,
				paddingTop: () => 3.5,
				paddingBottom: () => 3.5,
				fillColor: (i: number) => (i === 0 ? C.th : i % 2 === 0 ? C.zebra : null),
			},
			margin: [0, 3, 0, 10],
		};
	}

	private quote(t: Tokens.Blockquote): PNode {
		const children = [...t.tokens];
		let style = NEUTRAL;
		let firstRuns: PNode[] | null = null;

		const first = children[0];
		if (first && first.type === 'paragraph') {
			const inl = (first as Tokens.Paragraph).tokens;
			const head = inl[0];
			if (head && head.type === 'strong') {
				const found = lookupCallout(plain((head as Tokens.Strong).tokens));
				if (found) {
					style = found;
					let rest = inl.slice(1);
					const r0 = rest[0];
					if (r0 && r0.type === 'text') {
						// Quita los ":" que quedaron fuera de la negrita.
						const t0 = r0 as Tokens.Text;
						rest = [{ ...t0, text: t0.text.replace(/^\s*[:：]?\s*/, '') } as Tokens.Text, ...rest.slice(1)];
					}
					firstRuns = this.inline(rest);
					children.shift();
				}
			}
		}

		const stack: PNode[] = [];
		if (style.label) {
			stack.push({
				text: style.label.toUpperCase(),
				bold: true,
				fontSize: 7.8,
				color: style.color,
				characterSpacing: 0.7,
				margin: [0, 0, 0, 2],
			});
		}
		if (firstRuns && firstRuns.length) stack.push({ text: firstRuns, margin: [0, 0, 0, 3] });
		for (const c of children) stack.push(...this.block(c));

		const size = plain(t.tokens).length;
		return {
			table: { widths: ['*'], dontBreakRows: size < 700, body: [[{ stack, margin: [9, 6, 9, 3] }]] },
			layout: {
				hLineWidth: () => 0,
				vLineWidth: (i: number) => (i === 0 ? 3 : 0),
				vLineColor: () => style.color,
				paddingLeft: () => 0,
				paddingRight: () => 0,
				paddingTop: () => 0,
				paddingBottom: () => 0,
				fillColor: () => style.bg,
			},
			margin: [0, 3, 0, 9],
		};
	}

	private code(t: Tokens.Code): PNode {
		return {
			table: {
				widths: ['*'],
				body: [[{ text: t.text, style: 'code', preserveLeadingSpaces: true, margin: [7, 5, 7, 5] }]],
			},
			layout: { hLineWidth: () => 0, vLineWidth: () => 0, fillColor: () => C.code },
			margin: [0, 3, 0, 9],
		};
	}

	/** Texto en línea → "runs" de pdfmake. Los símbolos que Roboto no tiene (flechas, ∈, ∪…) usan otra fuente. */
	private runs(raw: string, style: PNode, decode = true): PNode[] {
		const text = decode ? decodeEntities(raw) : raw;
		if (!text) return [];
		const out: PNode[] = [];
		let last = 0;
		for (const m of text.matchAll(SYMBOLS_REGEX)) {
			const idx = m.index ?? 0;
			if (idx > last) out.push({ ...style, text: text.slice(last, idx) });
			out.push({ ...style, text: m[0], font: 'Symbols' });
			last = idx + m[0].length;
		}
		if (last < text.length) out.push({ ...style, text: text.slice(last) });
		return out;
	}

	private inline(tokens: Token[] | undefined, style: PNode = {}): PNode[] {
		const out: PNode[] = [];
		for (const t of tokens ?? []) {
			switch (t.type) {
				case 'text': {
					const tt = t as Tokens.Text;
					if (tt.tokens && tt.tokens.length) out.push(...this.inline(tt.tokens, style));
					else out.push(...this.runs(tt.text, style));
					break;
				}
				case 'escape':
					out.push(...this.runs((t as Tokens.Escape).text, style));
					break;
				case 'strong':
					out.push(...this.inline((t as Tokens.Strong).tokens, { ...style, bold: true }));
					break;
				case 'em':
					out.push(...this.inline((t as Tokens.Em).tokens, { ...style, italics: true }));
					break;
				case 'del':
					out.push(...this.inline((t as Tokens.Del).tokens, { ...style, decoration: 'lineThrough' }));
					break;
				case 'codespan':
					out.push(
						...this.runs(
							(t as Tokens.Codespan).text,
							{ ...style, background: C.code, color: C.codeText, fontSize: 9.2 },
							false, // el código en línea es literal: no se decodifican entidades
						),
					);
					break;
				case 'link': {
					const l = t as Tokens.Link;
					const linkStyle = /^https?:/i.test(l.href)
						? { ...style, color: '#2563eb', decoration: 'underline', link: l.href }
						: style;
					out.push(...this.inline(l.tokens, linkStyle));
					break;
				}
				case 'br':
					out.push({ text: '\n' });
					break;
				case 'image':
					out.push(...this.runs((t as Tokens.Image).text ?? '', { ...style, italics: true }));
					break;
				case 'html':
					if (/^<br\s*\/?>$/i.test((t as Tokens.HTML).text.trim())) out.push({ text: '\n' });
					break;
				default: {
					const raw = (t as { raw?: string }).raw;
					if (raw) out.push(...this.runs(raw, style));
				}
			}
		}
		return out;
	}
}

/* ───────────── Documento completo ───────────── */

/** El objeto real de pdfmake (con el empaquetador, el espacio de nombres solo tiene getters y no sirve para `this`). */
function engine(): PNode {
	return (pdfMake as PNode).default ?? pdfMake;
}

let fontsReady = false;
function initFonts(): void {
	if (fontsReady) return;
	const pm = engine();
	pm.addVirtualFileSystem({ ...(vfsFonts as PNode), 'Symbols.ttf': SYMBOLS_TTF_BASE64 });
	pm.addFonts({
		Symbols: { normal: 'Symbols.ttf', bold: 'Symbols.ttf', italics: 'Symbols.ttf', bolditalics: 'Symbols.ttf' },
	});
	fontsReady = true;
}

export async function markdownToPdf(md: string, opt: PdfOptions): Promise<PdfResult> {
	initFonts();
	const page = PAGE[opt.pageSize];
	const cw = page.w - MX * 2;

	const builder = new Builder(opt, cw);
	const body = builder.blocks(marked.lexer(md));
	const title = builder.title || opt.fallbackTitle;

	const date = (opt.generatedAt ?? new Date()).toLocaleDateString('es-CL', {
		day: 'numeric',
		month: 'long',
		year: 'numeric',
	});
	const shown = opt.sources.slice(0, 8).join(' · ');
	const more = opt.sources.length > 8 ? ` · y ${opt.sources.length - 8} más` : '';

	const header: PNode[] = [{ text: title, style: 'title' }];
	if (opt.sources.length) header.push({ text: [{ text: 'Fuentes: ', bold: true }, shown + more], style: 'meta' });
	header.push({
		text: `Elaborado con ${opt.modelLabel} únicamente a partir del contenido de las notas · ${date}`,
		style: 'meta',
	});
	header.push({
		canvas: [{ type: 'line', x1: 0, y1: 0, x2: cw, y2: 0, lineWidth: 1.6, lineColor: C.primary }],
		margin: [0, 7, 0, 11],
	});

	const footerLeft = `Synthesis · ${title.length > 72 ? title.slice(0, 71) + '…' : title}`;

	const docDefinition: PNode = {
		pageSize: opt.pageSize,
		pageMargins: [MX, MT, MX, MB],
		info: { title, subject: 'Síntesis de estudio', creator: 'Synthesis (Obsidian)' },
		defaultStyle: { font: 'Roboto', fontSize: 10, lineHeight: 1.25, color: C.text },
		styles: {
			title: { fontSize: 20, bold: true, color: C.primary, lineHeight: 1.15, margin: [0, 0, 0, 4] },
			meta: { fontSize: 8.5, color: C.muted, lineHeight: 1.3, margin: [0, 0, 0, 1] },
			h2: { fontSize: 13.5, bold: true, color: C.primary, margin: [0, 12, 0, 0] },
			h3: { fontSize: 11, bold: true, color: '#334155', margin: [0, 8, 0, 3] },
			h4: { fontSize: 10, bold: true, color: '#475569', margin: [0, 6, 0, 2] },
			td: { fontSize: 9.3, lineHeight: 1.2 },
			code: { fontSize: 8.8, lineHeight: 1.15 },
			caption: { fontSize: 8.5, italics: true, color: C.muted },
			footer: { fontSize: 8, color: C.muted },
		},
		content: [...header, ...body],
		footer: (current: number, total: number) => ({
			columns: [
				{ text: footerLeft, style: 'footer', width: '*' },
				{ text: `${current} / ${total}`, style: 'footer', alignment: 'right', width: 'auto' },
			],
			margin: [MX, 20, MX, 0],
		}),
		// Evita títulos huérfanos: si en la página solo le siguen reglas decorativas u otros títulos
		// (es decir, ningún contenido), el título pasa a la página siguiente.
		// (pdfmake 0.3 entrega funciones getFollowingNodesOnPage(), no un arreglo.)
		pageBreakBefore: (node: PNode, ctx: PNode) => {
			if (!node.headlineLevel) return false;
			// La lista incluye el pie de página de la hoja (nodo `columns` y textos con estilo "footer").
			const following = (ctx.getFollowingNodesOnPage() as PNode[]).filter(
				(n) => n.columns === undefined && n.style !== 'footer',
			);
			return following.every((n) => n.canvas !== undefined || n.headlineLevel !== undefined);
		},
	};

	const raw = (await engine().createPdf(docDefinition).getBuffer()) as Uint8Array;
	const buffer = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer;
	return { buffer, title };
}
