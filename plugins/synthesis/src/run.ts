import { App, TFile, normalizePath } from 'obsidian';
import { collectNotes, type CollectDeps, type ContentBlock } from './collect';
import { CancelledError, generateSummary } from './claude';
import { FINAL_INSTRUCTION, buildSystemPrompt, introText } from './prompt';
import { markdownToPdf, type PdfImage } from './pdf';
import { DEFAULT_SETTINGS, modelLabel, type SynthesisSettings } from './types';

export type RunStage = 'collect' | 'claude' | 'pdf' | 'save' | 'done' | 'error' | 'cancelled';

export interface RunResult {
	pdf: TFile;
	markdown: TFile | null;
	title: string;
	notes: number;
	images: number;
	inputTokens: number;
	outputTokens: number;
	truncated: boolean;
	warnings: string[];
}

export interface RunState {
	stage: RunStage;
	message: string;
	/** Tokens aproximados generados hasta ahora (solo en la etapa de Claude). */
	approxTokens: number;
	startedAt: number;
	result?: RunResult;
	error?: string;
}

/** Una síntesis en curso. La interfaz se suscribe a su estado; sigue viva aunque se cierre el modal. */
export class ActiveRun {
	state: RunState = { stage: 'collect', message: 'Leyendo notas…', approxTokens: 0, startedAt: Date.now() };
	readonly abort = new AbortController();
	private readonly listeners = new Set<(s: RunState) => void>();

	get finished(): boolean {
		const s = this.state.stage;
		return s === 'done' || s === 'error' || s === 'cancelled';
	}

	subscribe(fn: (s: RunState) => void): () => void {
		this.listeners.add(fn);
		return () => {
			this.listeners.delete(fn);
		};
	}

	update(patch: Partial<RunState>): void {
		this.state = { ...this.state, ...patch };
		for (const l of [...this.listeners]) l(this.state);
	}
}

export interface RunEnv extends CollectDeps {
	/** Solo para pruebas con un servidor simulado. */
	baseURL?: string;
	now?: Date;
}

/* ───────────── Utilidades ───────────── */

function dateStamp(d: Date): string {
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function safeName(s: string): string {
	const clean = s
		.replace(/[\\/:*?"<>|#^[\]]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim()
		.slice(0, 80)
		.trim();
	return clean || 'resumen';
}

function uniquePath(app: App, folder: string, base: string, ext: string): string {
	let n = 1;
	let path: string;
	do {
		path = normalizePath(`${folder}/${base}${n > 1 ? ` (${n})` : ''}.${ext}`);
		n++;
	} while (app.vault.getAbstractFileByPath(path));
	return path;
}

async function ensureFolder(app: App, folder: string): Promise<void> {
	if (!folder || folder === '/') return;
	if (app.vault.getAbstractFileByPath(folder)) return;
	try {
		await app.vault.createFolder(folder);
	} catch {
		/* ya existe (carrera con otro proceso o sincronización) */
	}
}

/** Quita un bloque de código envolvente o un preámbulo en prosa, por si Claude no obedece el formato. */
export function cleanModelOutput(text: string): string {
	let t = text.trim();
	const fenced = t.match(/^```(?:markdown|md)?[ \t]*\n([\s\S]*?)\n```$/i);
	if (fenced?.[1]) t = fenced[1].trim();
	const h = t.search(/^# /m);
	if (h > 0) {
		const pre = t.slice(0, h);
		if (pre.length <= 300 && !/^\s*(?:[#>|*-]|\d+\.)/m.test(pre)) t = t.slice(h);
	}
	return t;
}

/* ───────────── Ejecución ───────────── */

export async function executeRun(
	app: App,
	settings: SynthesisSettings,
	apiKey: string,
	files: TFile[],
	run: ActiveRun,
	env: RunEnv = {},
): Promise<void> {
	const signal = run.abort.signal;
	const guard = () => {
		if (signal.aborted) throw new CancelledError();
	};

	try {
		/* 1. Leer notas e imágenes */
		run.update({ stage: 'collect', message: 'Leyendo notas…' });
		const collected = await collectNotes(
			app,
			files,
			{
				includeImages: settings.includeImages,
				maxImages: settings.maxImages,
				maxImageSide: settings.maxImageSide,
			},
			(message) => run.update({ stage: 'collect', message }),
			env.prepareImage ? { prepareImage: env.prepareImage } : {},
		);
		guard();

		/* 2. Pedir la síntesis a Claude (sin herramientas: solo ve las notas) */
		const content: ContentBlock[] = [
			{ type: 'text', text: introText(files.length) },
			...collected.content,
			{ type: 'text', text: FINAL_INSTRUCTION },
		];
		run.update({ stage: 'claude', message: 'Claude está analizando las notas…', approxTokens: 0 });

		let lastTick = 0;
		let lastTokens = 0;
		const result = await generateSummary({
			apiKey,
			baseURL: env.baseURL,
			model: settings.model.trim() || DEFAULT_SETTINGS.model,
			maxTokens: settings.maxOutputTokens,
			effort: settings.effort,
			system: buildSystemPrompt(settings.extraInstructions),
			content,
			signal,
			onText: (chars) => {
				const tokens = Math.round(chars / 3.5);
				const now = Date.now();
				if (now - lastTick < 250 && tokens - lastTokens < 40) return;
				lastTick = now;
				lastTokens = tokens;
				run.update({ message: 'Claude está redactando la síntesis…', approxTokens: tokens });
			},
		});
		guard();

		/* 3. Maquetar el PDF */
		run.update({ stage: 'pdf', message: 'Maquetando el PDF…' });
		const md = cleanModelOutput(result.text);
		const images = new Map<number, PdfImage>(
			collected.images.map((i) => [
				i.n,
				{ id: i.n, dataUrl: i.prepared.dataUrl, width: i.prepared.width, height: i.prepared.height, name: i.name },
			]),
		);
		const first = collected.noteTitles[0] ?? 'Síntesis';
		const fallbackTitle = collected.noteTitles.length > 1 ? `${first} y ${collected.noteTitles.length - 1} más` : first;
		const now = env.now ?? new Date();
		const { buffer, title } = await markdownToPdf(md, {
			fallbackTitle,
			sources: collected.noteTitles,
			images,
			pageSize: settings.pageSize,
			modelLabel: modelLabel(settings.model),
			generatedAt: now,
		});
		guard();

		/* 4. Guardar en el vault */
		run.update({ stage: 'save', message: 'Guardando en el vault…' });
		const folder = normalizePath(settings.outputFolder.trim() || 'Synthesis');
		await ensureFolder(app, folder);
		const base = `Síntesis - ${safeName(title)} (${dateStamp(now)})`;
		const pdf = await app.vault.createBinary(uniquePath(app, folder, base, 'pdf'), buffer);
		const markdown = settings.saveMarkdown ? await app.vault.create(uniquePath(app, folder, base, 'md'), md + '\n') : null;

		const warnings = [...collected.warnings];
		const truncated = result.stopReason === 'max_tokens';
		if (truncated) {
			warnings.push(
				'La respuesta llegó al máximo de tokens y puede estar incompleta. Sube «Máximo de tokens de salida» en los ajustes.',
			);
		}
		run.update({
			stage: 'done',
			message: 'Listo',
			result: {
				pdf,
				markdown,
				title,
				notes: files.length,
				images: collected.images.length,
				inputTokens: result.inputTokens,
				outputTokens: result.outputTokens,
				truncated,
				warnings,
			},
		});
	} catch (e) {
		if (e instanceof CancelledError || signal.aborted) {
			run.update({ stage: 'cancelled', message: 'Síntesis cancelada.' });
		} else {
			const msg = e instanceof Error ? e.message : String(e);
			run.update({ stage: 'error', message: msg, error: msg });
		}
	}
}
