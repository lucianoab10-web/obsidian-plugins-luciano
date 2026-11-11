import {
	App,
	Editor,
	Menu,
	Modal,
	Notice,
	Plugin,
	PluginSettingTab,
	requestUrl,
	Setting,
} from "obsidian";

/* -------------------------------------------------------------------------- */
/*  Ajustes                                                                    */
/* -------------------------------------------------------------------------- */

interface DeepLTranslateSettings {
	apiKey: string;
	apiPlan: "free" | "pro";
	targetLang: string;
	sourceLang: string; // "" = detección automática
}

const DEFAULT_SETTINGS: DeepLTranslateSettings = {
	apiKey: "",
	apiPlan: "free",
	targetLang: "ES",
	sourceLang: "",
};

// Idiomas de destino soportados por DeepL (subconjunto habitual)
const TARGET_LANGS: Record<string, string> = {
	ES: "Español",
	"EN-US": "Inglés (EE.UU.)",
	"EN-GB": "Inglés (Reino Unido)",
	"PT-BR": "Portugués (Brasil)",
	"PT-PT": "Portugués (Portugal)",
	FR: "Francés",
	DE: "Alemán",
	IT: "Italiano",
	NL: "Neerlandés",
	PL: "Polaco",
	RU: "Ruso",
	JA: "Japonés",
	ZH: "Chino",
};

const SOURCE_LANGS: Record<string, string> = {
	"": "Detección automática",
	ES: "Español",
	EN: "Inglés",
	PT: "Portugués",
	FR: "Francés",
	DE: "Alemán",
	IT: "Italiano",
	NL: "Neerlandés",
	PL: "Polaco",
	RU: "Ruso",
	JA: "Japonés",
	ZH: "Chino",
};

/* -------------------------------------------------------------------------- */
/*  Plugin principal                                                          */
/* -------------------------------------------------------------------------- */

export default class DeepLTranslatePlugin extends Plugin {
	settings: DeepLTranslateSettings;

	async onload() {
		await this.loadSettings();

		// Ítem en el menú contextual (clic derecho) del editor
		this.registerEvent(
			this.app.workspace.on("editor-menu", (menu: Menu, editor: Editor) => {
				const selection = editor.getSelection();
				if (!selection || selection.trim().length === 0) return;

				menu.addItem((item) => {
					item
						.setTitle("Traducir con DeepL")
						.setIcon("languages")
						.onClick(() => this.translateSelection(editor));
				});
			})
		);

		// Comando accesible desde la paleta de comandos / atajo de teclado
		this.addCommand({
			id: "deepl-translate-selection",
			name: "Traducir selección con DeepL",
			editorCallback: (editor: Editor) => this.translateSelection(editor),
		});

		this.addSettingTab(new DeepLTranslateSettingTab(this.app, this));
	}

	onunload() {}

	/* ---------------------------------------------------------------------- */

	async translateSelection(editor: Editor) {
		const selection = editor.getSelection();

		if (!selection || selection.trim().length === 0) {
			new Notice("Selecciona texto antes de traducir.");
			return;
		}

		if (!this.settings.apiKey) {
			new Notice(
				"Configura tu API key de DeepL en Ajustes → DeepL Translate."
			);
			return;
		}

		const loadingNotice = new Notice("Traduciendo con DeepL…", 0);

		try {
			const translated = await this.callDeepL(selection);
			loadingNotice.hide();

			new TranslationPreviewModal(
				this.app,
				selection,
				translated,
				(finalText: string) => {
					editor.replaceSelection(finalText);
					new Notice("Texto reemplazado.");
				}
			).open();
		} catch (err) {
			loadingNotice.hide();
			console.error("DeepL Translate:", err);
			new Notice(
				`Error al traducir con DeepL: ${
					err instanceof Error ? err.message : String(err)
				}`
			);
		}
	}

	async callDeepL(text: string): Promise<string> {
		const baseUrl =
			this.settings.apiPlan === "pro"
				? "https://api.deepl.com/v2/translate"
				: "https://api-free.deepl.com/v2/translate";

		const body: Record<string, unknown> = {
			text: [text],
			target_lang: this.settings.targetLang,
		};

		if (this.settings.sourceLang) {
			body.source_lang = this.settings.sourceLang;
		}

		// Se usa requestUrl (en vez de fetch) para evitar problemas de CORS
		// dentro del entorno Electron de Obsidian.
		const response = await requestUrl({
			url: baseUrl,
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `DeepL-Auth-Key ${this.settings.apiKey}`,
			},
			body: JSON.stringify(body),
			throw: false,
		});

		if (response.status < 200 || response.status >= 300) {
			const msg =
				response.json?.message ||
				`código de estado HTTP ${response.status}`;
			throw new Error(msg);
		}

		const translations = response.json?.translations;
		if (!translations || translations.length === 0) {
			throw new Error("Respuesta vacía de la API de DeepL.");
		}

		return translations[0].text as string;
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

/* -------------------------------------------------------------------------- */
/*  Modal de vista previa                                                     */
/* -------------------------------------------------------------------------- */

class TranslationPreviewModal extends Modal {
	private originalText: string;
	private translatedText: string;
	private onReplace: (finalText: string) => void;
	private textarea: HTMLTextAreaElement;

	constructor(
		app: App,
		originalText: string,
		translatedText: string,
		onReplace: (finalText: string) => void
	) {
		super(app);
		this.originalText = originalText;
		this.translatedText = translatedText;
		this.onReplace = onReplace;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.addClass("deepl-translate-modal");

		contentEl.createEl("h2", { text: "Vista previa de la traducción" });

		contentEl.createEl("p", {
			text: "Texto original",
			cls: "deepl-translate-label",
		});
		const originalBox = contentEl.createEl("div", {
			cls: "deepl-translate-original",
			text: this.originalText,
		});
		originalBox.setAttr("aria-readonly", "true");

		contentEl.createEl("p", {
			text: "Traducción (puedes editarla antes de reemplazar)",
			cls: "deepl-translate-label",
		});
		this.textarea = contentEl.createEl("textarea", {
			cls: "deepl-translate-translated",
		});
		this.textarea.value = this.translatedText;

		const buttonRow = contentEl.createEl("div", {
			cls: "deepl-translate-buttons",
		});

		const replaceBtn = buttonRow.createEl("button", {
			text: "Reemplazar texto",
			cls: "mod-cta",
		});
		replaceBtn.addEventListener("click", () => {
			this.onReplace(this.textarea.value);
			this.close();
		});

		const copyBtn = buttonRow.createEl("button", { text: "Copiar" });
		copyBtn.addEventListener("click", async () => {
			await navigator.clipboard.writeText(this.textarea.value);
			new Notice("Traducción copiada al portapapeles.");
		});

		const cancelBtn = buttonRow.createEl("button", { text: "Cancelar" });
		cancelBtn.addEventListener("click", () => this.close());
	}

	onClose() {
		this.contentEl.empty();
	}
}

/* -------------------------------------------------------------------------- */
/*  Pestaña de ajustes                                                        */
/* -------------------------------------------------------------------------- */

class DeepLTranslateSettingTab extends PluginSettingTab {
	plugin: DeepLTranslatePlugin;

	constructor(app: App, plugin: DeepLTranslatePlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		containerEl.createEl("h2", { text: "Ajustes de DeepL Translate" });

		new Setting(containerEl)
			.setName("API key de DeepL")
			.setDesc(
				"Tu clave de autenticación de DeepL (la encuentras en tu cuenta de DeepL Developer)."
			)
			.addText((text) => {
				text.inputEl.type = "password";
				text
					.setPlaceholder("xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx:fx")
					.setValue(this.plugin.settings.apiKey)
					.onChange(async (value) => {
						this.plugin.settings.apiKey = value.trim();
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName("Plan de DeepL")
			.setDesc(
				"Selecciona 'Free' si tu API key termina en ':fx', o 'Pro' si usas una cuenta paga."
			)
			.addDropdown((dropdown) => {
				dropdown
					.addOption("free", "Free")
					.addOption("pro", "Pro")
					.setValue(this.plugin.settings.apiPlan)
					.onChange(async (value) => {
						this.plugin.settings.apiPlan = value as "free" | "pro";
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName("Idioma de destino")
			.setDesc("Idioma al que se traducirá el texto seleccionado.")
			.addDropdown((dropdown) => {
				Object.entries(TARGET_LANGS).forEach(([code, label]) => {
					dropdown.addOption(code, label);
				});
				dropdown.setValue(this.plugin.settings.targetLang).onChange(
					async (value) => {
						this.plugin.settings.targetLang = value;
						await this.plugin.saveSettings();
					}
				);
			});

		new Setting(containerEl)
			.setName("Idioma de origen")
			.setDesc(
				"Opcional. Déjalo en 'Detección automática' salvo que quieras forzar un idioma de origen."
			)
			.addDropdown((dropdown) => {
				Object.entries(SOURCE_LANGS).forEach(([code, label]) => {
					dropdown.addOption(code, label);
				});
				dropdown.setValue(this.plugin.settings.sourceLang).onChange(
					async (value) => {
						this.plugin.settings.sourceLang = value;
						await this.plugin.saveSettings();
					}
				);
			});
	}
}
