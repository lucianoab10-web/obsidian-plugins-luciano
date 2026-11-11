import { Notice, Plugin, TFile } from 'obsidian';
import { SynthesisModal } from './modal';
import { SynthesisSettingTab } from './settings';
import { ActiveRun, executeRun, type RunResult, type RunState } from './run';
import { DEFAULT_SETTINGS, type SynthesisSettings } from './types';

export default class SynthesisPlugin extends Plugin {
	settings: SynthesisSettings = { ...DEFAULT_SETTINGS };
	activeRun: ActiveRun | null = null;
	modal: SynthesisModal | null = null;
	private statusEl: HTMLElement | null = null;
	private statusTimer: number | null = null;

	async onload(): Promise<void> {
		await this.loadSettings();

		this.addRibbonIcon('graduation-cap', 'Synthesis: crear PDF de estudio', () => this.openModal());
		this.addCommand({
			id: 'crear-pdf-de-estudio',
			name: 'Crear PDF de estudio con Claude',
			callback: () => this.openModal(),
		});
		this.addSettingTab(new SynthesisSettingTab(this.app, this));

		this.statusEl = this.addStatusBarItem();
		this.statusEl.hide();
	}

	onunload(): void {
		this.activeRun?.abort.abort();
		if (this.statusTimer !== null) window.clearTimeout(this.statusTimer);
	}

	async loadSettings(): Promise<void> {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData()) as SynthesisSettings;
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	/** La clave vive en el llavero de Obsidian (SecretStorage); en el vault solo queda el nombre del secreto. */
	getApiKey(): string {
		const id = this.settings.apiKeySecret;
		if (!id) return '';
		try {
			return (this.app.secretStorage.getSecret(id) ?? '').trim();
		} catch {
			return '';
		}
	}

	openSettings(): void {
		// API interna pero estable en la práctica; si cambia, el usuario puede abrir los ajustes a mano.
		const setting = (this.app as unknown as { setting?: { open(): void; openTabById(id: string): void } }).setting;
		try {
			setting?.open();
			setting?.openTabById(this.manifest.id);
		} catch {
			/* sin efecto */
		}
	}

	openModal(): void {
		new SynthesisModal(this.app, this).open();
	}

	/** Inicia una síntesis (o devuelve la que ya está en curso). Sigue corriendo aunque se cierre el modal. */
	startRun(files: TFile[]): ActiveRun {
		if (this.activeRun && !this.activeRun.finished) return this.activeRun;
		const run = new ActiveRun();
		this.activeRun = run;
		run.subscribe((s) => this.onRunUpdate(run, s));
		this.onRunUpdate(run, run.state);
		void executeRun(this.app, { ...this.settings }, this.getApiKey(), files, run);
		return run;
	}

	private onRunUpdate(run: ActiveRun, s: RunState): void {
		if (!this.statusEl) return;
		if (!run.finished) {
			const tokens = s.stage === 'claude' && s.approxTokens ? ` · ≈${s.approxTokens.toLocaleString('es-CL')} tokens` : '';
			this.statusEl.setText(`Synthesis: ${s.message}${tokens}`);
			this.statusEl.show();
			return;
		}

		this.statusEl.setText(
			s.stage === 'done' ? 'Synthesis: PDF listo' : s.stage === 'cancelled' ? 'Synthesis: cancelado' : 'Synthesis: error',
		);
		this.statusEl.show();
		if (this.statusTimer !== null) window.clearTimeout(this.statusTimer);
		this.statusTimer = window.setTimeout(() => this.statusEl?.hide(), 6000);

		if (this.modal) return; // el modal abierto ya muestra el resultado
		if (s.stage === 'done' && s.result) this.notifyDone(s.result);
		else if (s.stage === 'error') new Notice(`Synthesis: ${s.error ?? s.message}`, 12000);
	}

	private notifyDone(r: RunResult): void {
		const frag = document.createDocumentFragment();
		frag.createDiv({ text: `Synthesis: PDF listo (${r.pdf.name})` });
		const btn = frag.createEl('button', { text: 'Abrir PDF' });
		const notice = new Notice(frag, 20000);
		btn.addEventListener('click', () => {
			void this.app.workspace.getLeaf('tab').openFile(r.pdf);
			notice.hide();
		});
	}
}
