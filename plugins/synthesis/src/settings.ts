import { App, Notice, PluginSettingTab, SecretComponent, Setting } from 'obsidian';
import type SynthesisPlugin from './main';
import { testConnection } from './claude';
import { MODEL_CHOICES, type EffortSetting, type PageSize } from './types';

const CUSTOM = '__custom__';

export class SynthesisSettingTab extends PluginSettingTab {
	/** Mientras se edita un ID de modelo propio, el desplegable debe seguir mostrando «Otro…». */
	private customModel = false;

	constructor(
		app: App,
		private readonly plugin: SynthesisPlugin,
	) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		const s = this.plugin.settings;
		const save = () => this.plugin.saveSettings();

		/* ── Conexión ── */
		new Setting(containerEl).setName('Conexión con Claude').setHeading();

		new Setting(containerEl)
			.setName('Clave de API de Claude')
			.setDesc(
				'Se guarda en el llavero seguro de Obsidian, no dentro del vault: no se sincroniza ni se publica con tus notas. ' +
					'Si usas el vault en varios dispositivos, tendrás que ingresarla en cada uno. ' +
					'Créala en platform.claude.com → Settings → API keys.',
			)
			.addComponent((el) =>
				new SecretComponent(this.app, el).setValue(s.apiKeySecret).onChange(async (value) => {
					s.apiKeySecret = value;
					await save();
				}),
			);

		new Setting(containerEl)
			.setName('Probar conexión')
			.setDesc('Envía una petición mínima para comprobar la clave, el saldo y el modelo (cuesta una fracción de centavo).')
			.addButton((b) =>
				b.setButtonText('Probar').onClick(async () => {
					const key = this.plugin.getApiKey();
					if (!key) {
						new Notice('Synthesis: primero configura la clave de API.');
						return;
					}
					b.setDisabled(true).setButtonText('Probando…');
					try {
						await testConnection(key, s.model);
						new Notice('Synthesis: ¡conexión correcta!');
					} catch (e) {
						new Notice(`Synthesis: ${e instanceof Error ? e.message : String(e)}`, 12000);
					} finally {
						b.setDisabled(false).setButtonText('Probar');
					}
				}),
			);

		const isCustom = this.customModel || !MODEL_CHOICES.some((m) => m.id === s.model);
		new Setting(containerEl)
			.setName('Modelo')
			.setDesc('Sonnet 5.5 equilibra precisión y costo. Opus 5.5 es más capaz; Haiku 5.5, más económico.')
			.addDropdown((d) => {
				for (const m of MODEL_CHOICES) d.addOption(m.id, `${m.name} — ${m.hint}`);
				d.addOption(CUSTOM, 'Otro (escribir el ID)…');
				d.setValue(isCustom ? CUSTOM : s.model).onChange(async (v) => {
					this.customModel = v === CUSTOM;
					if (v !== CUSTOM) {
						s.model = v;
						await save();
					}
					this.display();
				});
			});
		if (isCustom) {
			new Setting(containerEl)
				.setName('ID del modelo')
				.setDesc('Por ejemplo: claude-sonnet-5-5')
				.addText((t) =>
					t.setValue(s.model).onChange(async (v) => {
						s.model = v.trim();
						await save();
					}),
				);
		}

		new Setting(containerEl)
			.setName('Esfuerzo de razonamiento')
			.setDesc('«Predeterminado» usa el valor del modelo. Más esfuerzo = mayor precisión en notas difíciles, pero más lento y caro.')
			.addDropdown((d) =>
				d
					.addOptions({ default: 'Predeterminado del modelo', low: 'Bajo', medium: 'Medio', high: 'Alto' })
					.setValue(s.effort)
					.onChange(async (v) => {
						s.effort = v as EffortSetting;
						await save();
					}),
			);

		new Setting(containerEl)
			.setName('Máximo de tokens de salida')
			.setDesc('Tope de la respuesta (el razonamiento interno también cuenta). El resumen suele usar mucho menos.')
			.addText((t) =>
				t.setValue(String(s.maxOutputTokens)).onChange(async (v) => {
					const n = Math.round(Number(v));
					if (Number.isFinite(n) && n >= 1000 && n <= 128000) {
						s.maxOutputTokens = n;
						await save();
					}
				}),
			);

		/* ── Salida ── */
		new Setting(containerEl).setName('Salida').setHeading();

		new Setting(containerEl)
			.setName('Carpeta de los PDF')
			.setDesc('Carpeta del vault donde se guardan los resúmenes (se crea si no existe).')
			.addText((t) =>
				t.setPlaceholder('Synthesis').setValue(s.outputFolder).onChange(async (v) => {
					s.outputFolder = v.trim();
					await save();
				}),
			);

		new Setting(containerEl)
			.setName('Tamaño de hoja')
			.addDropdown((d) =>
				d
					.addOptions({ LETTER: 'Carta (Letter)', A4: 'A4' })
					.setValue(s.pageSize)
					.onChange(async (v) => {
						s.pageSize = v as PageSize;
						await save();
					}),
			);

		new Setting(containerEl)
			.setName('Guardar también el resumen en Markdown')
			.setDesc('Deja un .md junto al PDF, útil para editarlo o revisar lo que escribió Claude.')
			.addToggle((t) =>
				t.setValue(s.saveMarkdown).onChange(async (v) => {
					s.saveMarkdown = v;
					await save();
				}),
			);

		/* ── Imágenes ── */
		new Setting(containerEl).setName('Imágenes').setHeading();

		new Setting(containerEl)
			.setName('Enviar las imágenes de las notas a Claude')
			.setDesc('Claude las analiza e integra su información. Solo se leen imágenes del vault (no las de internet).')
			.addToggle((t) =>
				t.setValue(s.includeImages).onChange(async (v) => {
					s.includeImages = v;
					await save();
				}),
			);

		new Setting(containerEl)
			.setName('Máximo de imágenes por síntesis')
			.setDesc('Cada imagen consume tokens de entrada (del orden de mil a pocos miles).')
			.addText((t) =>
				t.setValue(String(s.maxImages)).onChange(async (v) => {
					const n = Math.round(Number(v));
					if (Number.isFinite(n) && n >= 0 && n <= 100) {
						s.maxImages = n;
						await save();
					}
				}),
			);

		new Setting(containerEl)
			.setName('Resolución máxima de las imágenes')
			.setDesc('Se reducen a este lado máximo antes de enviarlas. 2000 px conserva el texto de capturas y esquemas.')
			.addDropdown((d) =>
				d
					.addOptions({ '1568': '1568 px (más económico)', '2000': '2000 px (recomendado)' })
					.setValue(String(s.maxImageSide))
					.onChange(async (v) => {
						s.maxImageSide = Number(v);
						await save();
					}),
			);

		/* ── Avanzado ── */
		new Setting(containerEl).setName('Avanzado').setHeading();

		new Setting(containerEl)
			.setName('Instrucciones adicionales')
			.setDesc(
				'Preferencias que se suman al prompt (por ejemplo: «prefiere tablas para las comparaciones»). ' +
					'No pueden anular la regla de usar solo el contenido de las notas.',
			)
			.addTextArea((t) => {
				t.setValue(s.extraInstructions).onChange(async (v) => {
					s.extraInstructions = v;
					await save();
				});
				t.inputEl.rows = 4;
				t.inputEl.addClass('synthesis-textarea');
			});
	}
}
