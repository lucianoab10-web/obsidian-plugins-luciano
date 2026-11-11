import { App, ButtonComponent, Modal, Notice, TFile, setIcon } from 'obsidian';
import type SynthesisPlugin from './main';
import { estimateNotes } from './collect';
import type { ActiveRun, RunResult, RunState } from './run';

const MAX_ROWS = 100;
/** Estimación gruesa de tokens por imagen (depende de su tamaño). */
const TOKENS_PER_IMAGE = 1500;
/** Los modelos actuales admiten 1 millón de tokens de contexto. */
const WARN_TOKENS = 800_000;

const fmt = (n: number) => n.toLocaleString('es-CL');

export class SynthesisModal extends Modal {
	private selected = new Map<string, TFile>();
	private query = '';
	private chipsEl!: HTMLElement;
	private listEl!: HTMLElement;
	private statsEl!: HTMLElement;
	private runBtn!: ButtonComponent;
	private unsubscribe: (() => void) | null = null;
	private statsSeq = 0;

	constructor(
		app: App,
		private readonly plugin: SynthesisPlugin,
	) {
		super(app);
	}

	onOpen(): void {
		this.plugin.modal = this;
		this.modalEl.addClass('synthesis-modal');
		const run = this.plugin.activeRun;
		if (run && !run.finished) this.showProgress(run);
		else this.showPicker();
	}

	onClose(): void {
		this.unsubscribe?.();
		this.unsubscribe = null;
		this.statsSeq++;
		this.contentEl.empty();
		if (this.plugin.modal === this) this.plugin.modal = null;
	}

	/* ───────────────────────── Selección de notas ───────────────────────── */

	private showPicker(): void {
		this.unsubscribe?.();
		this.unsubscribe = null;
		const { contentEl } = this;
		contentEl.empty();
		this.titleEl.setText('Synthesis · PDF de estudio');

		contentEl.createEl('p', {
			cls: 'synthesis-intro',
			text: 'Elige las notas que quieres sintetizar. Claude usará únicamente su contenido (texto e imágenes) y no añadirá información externa.',
		});

		// La nota abierta queda preseleccionada.
		const active = this.app.workspace.getActiveFile();
		if (this.selected.size === 0 && active && active.extension === 'md') this.selected.set(active.path, active);

		this.chipsEl = contentEl.createDiv({ cls: 'synthesis-chips' });

		const search = contentEl.createEl('input', {
			cls: 'synthesis-search',
			type: 'text',
			placeholder: 'Buscar notas por nombre o carpeta…',
		});
		search.addEventListener('input', () => {
			this.query = search.value;
			this.renderList();
		});

		const tools = contentEl.createDiv({ cls: 'synthesis-tools' });
		new ButtonComponent(tools).setButtonText('Seleccionar resultados').onClick(() => {
			for (const f of this.matches().slice(0, MAX_ROWS)) this.selected.set(f.path, f);
			this.refresh();
		});
		new ButtonComponent(tools).setButtonText('Limpiar selección').onClick(() => {
			this.selected.clear();
			this.refresh();
		});

		this.listEl = contentEl.createDiv({ cls: 'synthesis-list' });
		this.statsEl = contentEl.createDiv({ cls: 'synthesis-stats' });

		const footer = contentEl.createDiv({ cls: 'modal-button-container' });
		new ButtonComponent(footer).setButtonText('Cancelar').onClick(() => this.close());
		this.runBtn = new ButtonComponent(footer)
			.setButtonText('Generar PDF')
			.setCta()
			.onClick(() => this.start());

		this.refresh();
		window.setTimeout(() => search.focus(), 50);
	}

	private matches(): TFile[] {
		const words = this.query.toLowerCase().split(/\s+/).filter(Boolean);
		return this.app.vault
			.getMarkdownFiles()
			.filter((f) => words.every((w) => f.path.toLowerCase().includes(w)))
			.sort((a, b) => b.stat.mtime - a.stat.mtime);
	}

	private refresh(): void {
		this.renderChips();
		this.renderList();
		void this.updateStats();
	}

	private setSelected(file: TFile, on: boolean): void {
		if (on) this.selected.set(file.path, file);
		else this.selected.delete(file.path);
		this.renderChips();
		void this.updateStats();
	}

	private renderChips(): void {
		this.chipsEl.empty();
		if (!this.selected.size) {
			this.chipsEl.createSpan({ cls: 'synthesis-chips-empty', text: 'Aún no hay notas seleccionadas.' });
			return;
		}
		for (const f of this.selected.values()) {
			const chip = this.chipsEl.createDiv({ cls: 'synthesis-chip' });
			chip.createSpan({ cls: 'synthesis-chip-name', text: f.basename, attr: { title: f.path } });
			const x = chip.createSpan({ cls: 'synthesis-chip-x', attr: { 'aria-label': 'Quitar' } });
			setIcon(x, 'x');
			x.addEventListener('click', () => {
				this.selected.delete(f.path);
				this.refresh();
			});
		}
	}

	private renderList(): void {
		this.listEl.empty();
		const all = this.matches();
		const shown = all.slice(0, MAX_ROWS);
		if (!shown.length) {
			this.listEl.createDiv({ cls: 'synthesis-more', text: 'No hay notas que coincidan.' });
			return;
		}
		for (const f of shown) {
			const row = this.listEl.createDiv({ cls: 'synthesis-row' });
			const cb = row.createEl('input', { type: 'checkbox' });
			cb.checked = this.selected.has(f.path);
			const label = row.createDiv({ cls: 'synthesis-row-label' });
			label.createSpan({ cls: 'synthesis-row-name', text: f.basename });
			if (f.parent && f.parent.path !== '/') label.createSpan({ cls: 'synthesis-row-path', text: f.parent.path });
			cb.addEventListener('change', () => this.setSelected(f, cb.checked));
			row.addEventListener('click', (e) => {
				if (e.target !== cb) cb.click();
			});
		}
		if (all.length > shown.length) {
			this.listEl.createDiv({
				cls: 'synthesis-more',
				text: `Mostrando ${shown.length} de ${fmt(all.length)}. Afina la búsqueda para ver el resto.`,
			});
		}
	}

	private async updateStats(): Promise<void> {
		const seq = ++this.statsSeq;
		const files = [...this.selected.values()];
		this.runBtn?.setDisabled(files.length === 0);
		this.statsEl.removeClass('synthesis-warn');
		if (!files.length) {
			this.statsEl.setText('Selecciona al menos una nota.');
			return;
		}
		this.statsEl.setText('Calculando…');
		const est = await estimateNotes(this.app, files);
		if (seq !== this.statsSeq) return;
		const tokens = est.textTokens + est.images * TOKENS_PER_IMAGE;
		const imgs = est.images ? ` · ${est.images} imagen${est.images === 1 ? '' : 'es'}` : '';
		let text = `${files.length} nota${files.length === 1 ? '' : 's'}${imgs} · ≈ ${fmt(tokens)} tokens de entrada`;
		if (tokens > WARN_TOKENS) {
			text += ' · cerca del límite de contexto (1 millón): considera dividir la selección';
			this.statsEl.addClass('synthesis-warn');
		}
		this.statsEl.setText(text);
	}

	private start(): void {
		const files = [...this.selected.values()];
		if (!files.length) return;
		if (!this.plugin.getApiKey()) {
			new Notice('Synthesis: falta la clave de API. Configúrala en Ajustes → Synthesis.', 8000);
			this.close();
			this.plugin.openSettings();
			return;
		}
		this.showProgress(this.plugin.startRun(files));
	}

	/* ───────────────────────── Progreso y resultado ───────────────────────── */

	private showProgress(run: ActiveRun): void {
		const { contentEl } = this;
		contentEl.empty();
		this.titleEl.setText('Synthesis');
		const body = contentEl.createDiv({ cls: 'synthesis-progress' });
		const footer = contentEl.createDiv({ cls: 'modal-button-container' });

		const render = (s: RunState): void => {
			body.empty();
			footer.empty();
			if (s.stage === 'done' && s.result) this.renderDone(body, footer, s.result);
			else if (s.stage === 'error') this.renderEnd(body, footer, 'No se pudo completar la síntesis', s.error ?? s.message);
			else if (s.stage === 'cancelled') this.renderEnd(body, footer, 'Síntesis cancelada', 'No se generó ningún PDF.');
			else this.renderWorking(body, footer, run, s);
		};

		this.unsubscribe?.();
		this.unsubscribe = run.subscribe(render);
		render(run.state);
	}

	private renderWorking(body: HTMLElement, footer: HTMLElement, run: ActiveRun, s: RunState): void {
		const row = body.createDiv({ cls: 'synthesis-working' });
		row.createDiv({ cls: 'synthesis-spinner' });
		row.createDiv({ cls: 'synthesis-stage', text: s.message });
		if (s.stage === 'claude' && s.approxTokens > 0) {
			body.createDiv({ cls: 'synthesis-detail', text: `≈ ${fmt(s.approxTokens)} tokens redactados` });
		}
		body.createDiv({
			cls: 'synthesis-detail',
			text: 'Puedes ocultar esta ventana: la síntesis sigue en segundo plano y te avisaremos al terminar.',
		});
		new ButtonComponent(footer).setButtonText('Ocultar').onClick(() => this.close());
		new ButtonComponent(footer)
			.setButtonText('Cancelar síntesis')
			.setWarning()
			.onClick(() => run.abort.abort());
	}

	private renderDone(body: HTMLElement, footer: HTMLElement, r: RunResult): void {
		body.createDiv({ cls: 'synthesis-done-title', text: 'Tu PDF está listo' });
		body.createDiv({ cls: 'synthesis-done-path', text: r.pdf.path });
		const imgs = r.images ? ` · ${r.images} imagen${r.images === 1 ? '' : 'es'}` : '';
		body.createDiv({
			cls: 'synthesis-detail',
			text: `${r.notes} nota${r.notes === 1 ? '' : 's'}${imgs} · ${fmt(r.inputTokens)} tokens de entrada · ${fmt(r.outputTokens)} de salida`,
		});
		if (r.warnings.length) {
			const ul = body.createEl('ul', { cls: 'synthesis-warnings' });
			for (const w of r.warnings) ul.createEl('li', { text: w });
		}
		new ButtonComponent(footer).setButtonText('Cerrar').onClick(() => this.close());
		new ButtonComponent(footer)
			.setButtonText('Abrir PDF')
			.setCta()
			.onClick(() => {
				void this.app.workspace.getLeaf('tab').openFile(r.pdf);
				this.close();
			});
	}

	private renderEnd(body: HTMLElement, footer: HTMLElement, title: string, detail: string): void {
		body.createDiv({ cls: 'synthesis-done-title', text: title });
		body.createDiv({ cls: 'synthesis-error', text: detail });
		new ButtonComponent(footer).setButtonText('Cerrar').onClick(() => this.close());
		new ButtonComponent(footer)
			.setButtonText('Volver')
			.setCta()
			.onClick(() => this.showPicker());
	}
}
