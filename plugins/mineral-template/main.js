const {
  Plugin, PluginSettingTab, Setting, FuzzySuggestModal,
  MarkdownView, Notice, TFile, getAllTags, normalizePath,
} = require('obsidian');

const DEFAULT_PATHS = [
  'Templates/minerales-plantilla.md',
  'Templates/minerales-platilla.md',
];

function tagKey(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  return text ? (text.startsWith('#') ? text : '#' + text).toLowerCase() : '';
}

function validTag(value) {
  const tag = tagKey(value).slice(1);
  return /^[\p{L}\p{M}\p{N}_/-]+$/u.test(tag) && /[\p{L}_-]/u.test(tag);
}

function templatePath(value) {
  if (typeof value !== 'string') return '';
  const path = value.trim().replace(/\\/g, '/');
  if (!path || path.startsWith('/') || path.includes(':') || path.split('/').includes('..')) return '';
  return normalizePath(path);
}

function cacheTags(cache) {
  return new Set(cache ? (getAllTags(cache) || []).map(tagKey) : []);
}

module.exports = class MineralTemplatePlugin extends Plugin {
  async onload() {
    const saved = await this.loadData();
    const defaultPath = DEFAULT_PATHS.find(path => this.app.vault.getAbstractFileByPath(path) instanceof TFile)
      || DEFAULT_PATHS[0];
    this.settings = {
      enabled: saved?.enabled !== false,
      mode: saved?.mode === 'append' ? 'append' : 'replace',
      rules: Array.isArray(saved?.rules) ? saved.rules.filter(rule => rule && typeof rule === 'object').map(rule => ({
        tag: typeof rule.tag === 'string' ? rule.tag : '',
        templatePath: typeof rule.templatePath === 'string' ? rule.templatePath : '',
        enabled: rule.enabled !== false,
      })) : [{ tag: '#minerales', templatePath: defaultPath, enabled: true }],
    };
    this.seenTags = new Map();
    this.pending = new Map();
    this.generated = new Map();
    this.revision = 0;
    this.ready = false;
    this.stopped = false;
    this.saveQueue = Promise.resolve();
    this.addSettingTab(new TemplateSettingsTab(this.app, this));

    this.app.workspace.onLayoutReady(() => {
      if (this.stopped) return;
      this.resetBaseline();
      this.ready = true;
    });
    this.registerEvent(this.app.metadataCache.on('changed', (file, data, cache) => {
      this.onMetadataChanged(file, data, cache);
    }));
    this.registerEvent(this.app.vault.on('create', file => {
      if (this.ready && file instanceof TFile && file.extension === 'md') {
        this.seenTags.set(file.path, new Set());
      }
    }));
    this.registerEvent(this.app.vault.on('rename', (file, oldPath) => {
      const previous = this.seenTags.get(oldPath);
      this.seenTags.delete(oldPath);
      this.seenTags.set(file.path, previous ?? null);
      this.pending.delete(oldPath);
      this.generated.delete(oldPath);
      let changed = false;
      for (const rule of this.settings.rules) {
        const path = templatePath(rule.templatePath);
        if (path === oldPath || path.startsWith(oldPath + '/')) {
          rule.templatePath = file.path + path.slice(oldPath.length);
          changed = true;
        }
      }
      if (changed) void this.saveSettings();
    }));
    this.registerEvent(this.app.vault.on('delete', file => {
      this.seenTags.delete(file.path);
      this.pending.delete(file.path);
      this.generated.delete(file.path);
    }));
  }

  onunload() {
    this.stopped = true;
    this.ready = false;
    this.revision++;
    this.pending.clear();
    this.generated.clear();
  }

  resetBaseline() {
    this.seenTags.clear();
    for (const file of this.app.vault.getMarkdownFiles()) {
      const cache = this.app.metadataCache.getFileCache(file);
      // La primera indexación de una nota antigua nunca dispara una regla.
      this.seenTags.set(file.path, cache ? cacheTags(cache) : null);
    }
  }

  saveSettings() {
    this.revision++;
    this.pending.clear();
    if (this.ready) this.resetBaseline();
    const snapshot = JSON.parse(JSON.stringify(this.settings));
    this.saveQueue = this.saveQueue.then(() => this.saveData(snapshot)).catch(error => {
      this.reportError('No se pudieron guardar los ajustes', error);
    });
    return this.saveQueue;
  }

  ruleProblem(rule, index) {
    if (!validTag(rule.tag)) return 'Escribe una etiqueta válida, por ejemplo #minerales o #clase/geología.';
    const duplicate = this.settings.rules.some((other, otherIndex) => otherIndex !== index
      && other.enabled && rule.enabled && tagKey(other.tag) === tagKey(rule.tag));
    if (duplicate) return 'Esta etiqueta está repetida. Deja una sola regla activa por etiqueta.';
    const path = templatePath(rule.templatePath);
    const file = path && this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile) || file.extension !== 'md') return 'Elige un archivo .md existente dentro de esta bóveda.';
    return '';
  }

  onMetadataChanged(file, data, cache) {
    if (!this.ready || this.stopped || !(file instanceof TFile) || file.extension !== 'md') return;
    const tags = cacheTags(cache);
    const previous = this.seenTags.get(file.path);
    this.seenTags.set(file.path, tags);
    // Adopta como base la primera indexación de nuestra copia, incluso si el
    // usuario ya la editó. Sus etiquetas no deben disparar otras plantillas.
    if (this.generated.has(file.path)) {
      this.generated.delete(file.path);
      return;
    }
    // Los archivos elegidos como plantilla nunca se transforman a sí mismos.
    if (this.settings.rules.some(rule => templatePath(rule.templatePath) === file.path)) return;
    const inProgress = this.pending.get(file.path);
    if (inProgress) {
      inProgress.data = data;
      inProgress.tags = tags;
      return;
    }
    if (!this.settings.enabled || !previous) return;
    const rule = this.settings.rules.find((candidate, index) => candidate.enabled
      && !this.ruleProblem(candidate, index)
      && tags.has(tagKey(candidate.tag)) && !previous.has(tagKey(candidate.tag)));
    if (!rule) return;
    const job = { data, tags, rule: { ...rule }, revision: this.revision };
    this.pending.set(file.path, job);
    void this.applyTemplate(file, job).catch(error => {
      this.reportError('No se pudo aplicar la plantilla', error);
    }).finally(() => {
      if (this.pending.get(file.path) === job) this.pending.delete(file.path);
    });
  }

  findEditor(file) {
    for (const leaf of this.app.workspace.getLeavesOfType('markdown')) {
      const view = leaf.view;
      if (view instanceof MarkdownView && view.file === file && view.getMode() === 'source') {
        return view.editor;
      }
    }
    return null;
  }

  async applyTemplate(file, job) {
    const path = templatePath(job.rule.templatePath);
    const source = this.app.vault.getAbstractFileByPath(path);
    if (!(source instanceof TFile) || source.extension !== 'md' || source === file) return;
    const sourceEditor = this.findEditor(source);
    const sourceText = sourceEditor ? sourceEditor.getValue() : await this.app.vault.read(source);
    if (!sourceText.trim()) throw new Error('La plantilla está vacía: ' + path);
    if (this.stopped || job.revision !== this.revision || this.pending.get(file.path) !== job
      || !job.tags.has(tagKey(job.rule.tag))) return;

    // Se copia el archivo completo; la etiqueta activadora se conserva al final.
    const trigger = tagKey(job.rule.tag);
    const content = sourceText.replace(/\s+$/, '') + '\n\n' + trigger + '\n';
    const expectedData = job.data;
    const replacement = this.settings.mode === 'append'
      ? expectedData.replace(/\s+$/, '') + '\n\n' + content
      : content;
    if (replacement === expectedData) return;
    const resultTags = new Set([trigger,
      ...(this.settings.mode === 'append' ? job.tags : [])]);
    let written = false;
    const markGenerated = () => {
      this.generated.set(file.path, replacement);
      this.seenTags.set(file.path, resultTags);
      written = true;
    };
    const editor = this.findEditor(file);
    if (editor) {
      if (editor.getValue() !== expectedData) {
        new Notice('La nota cambió mientras se leía la plantilla. Quita y vuelve a añadir la etiqueta para aplicarla.');
        return;
      }
      markGenerated();
      // replaceRange conserva el historial para poder usar Deshacer.
      editor.replaceRange(replacement, { line: 0, ch: 0 }, editor.offsetToPos(expectedData.length));
    } else {
      await this.app.vault.process(file, current => {
        if (this.stopped || job.revision !== this.revision || this.pending.get(file.path) !== job
          || !job.tags.has(trigger) || current !== expectedData) return current;
        markGenerated();
        return replacement;
      });
      if (!written) new Notice('La nota cambió antes de aplicar la plantilla. Quita y vuelve a añadir la etiqueta para reintentarlo.');
    }
    if (written) new Notice('Plantilla aplicada: ' + source.path);
  }

  reportError(message, error) {
    console.error('[Mineral Template] ' + message, error);
    new Notice(message + ': ' + (error?.message || String(error)));
  }
};

class MarkdownFilePicker extends FuzzySuggestModal {
  constructor(app, onSelect) {
    super(app);
    this.onSelect = onSelect;
    this.setPlaceholder('Buscar cualquier archivo .md de la bóveda…');
  }
  getItems() { return this.app.vault.getMarkdownFiles(); }
  getItemText(file) { return file.path; }
  onChooseItem(file) { this.onSelect(file.path); }
}

class TemplateSettingsTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    const plugin = this.plugin;
    const statusRefreshers = [];
    const refreshAllStatuses = () => statusRefreshers.forEach(refresh => refresh());
    containerEl.empty();
    containerEl.createEl('h2', { text: 'Plantillas por etiqueta' });
    containerEl.createEl('p', {
      text: 'Asocia etiquetas con archivos .md de cualquier carpeta de esta bóveda. Los cambios se guardan automáticamente.',
    });
    new Setting(containerEl).setName('Activar plantillas por etiqueta')
      .setDesc('Se aplican al añadir una etiqueta al texto o a la propiedad tags de una nota.')
      .addToggle(toggle => toggle.setValue(plugin.settings.enabled).onChange(value => {
        plugin.settings.enabled = value;
        void plugin.saveSettings();
      }));
    new Setting(containerEl).setName('Qué hacer con el contenido de la nota')
      .setDesc('Reemplazar copia el archivo completo, incluidas sus propiedades. La etiqueta activadora se conserva al final.')
      .addDropdown(dropdown => dropdown.addOption('replace', 'Reemplazar el contenido')
        .addOption('append', 'Añadir al final').setValue(plugin.settings.mode).onChange(value => {
          plugin.settings.mode = value;
          void plugin.saveSettings();
        }));
    containerEl.createEl('p', {
      text: 'Las notas que ya tienen la etiqueta no cambian al iniciar Obsidian ni al editar estos ajustes. Para volver a aplicar una plantilla, quita la etiqueta, espera a que se guarde la nota y vuelve a añadirla. Si añades varias etiquetas a la vez, se usa la primera regla que coincida.',
    });

    plugin.settings.rules.forEach((rule, index) => {
      const section = containerEl.createDiv();
      section.createEl('h3', { text: 'Regla ' + (index + 1) });
      new Setting(section).setName('Regla activa').addToggle(toggle => toggle
        .setValue(rule.enabled).onChange(value => {
          rule.enabled = value;
          void plugin.saveSettings();
          this.display();
        }));
      let refreshStatus = () => {};
      new Setting(section).setName('Etiqueta').setDesc('Puedes escribirla con o sin #.')
        .addText(text => text.setPlaceholder('#minerales').setValue(rule.tag).onChange(value => {
          rule.tag = value;
          void plugin.saveSettings();
          refreshAllStatuses();
        }));
      let pathInput;
      new Setting(section).setName('Archivo de plantilla')
        .setDesc('Ruta desde la raíz de la bóveda, incluida la extensión .md.')
        .addText(text => {
          pathInput = text;
          text.setPlaceholder('Templates/mi-plantilla.md').setValue(rule.templatePath).onChange(value => {
            rule.templatePath = value;
            void plugin.saveSettings();
            refreshAllStatuses();
          });
        }).addButton(button => button.setButtonText('Elegir archivo').onClick(() => {
          new MarkdownFilePicker(this.app, path => {
            rule.templatePath = path;
            pathInput.setValue(path);
            void plugin.saveSettings();
            refreshAllStatuses();
          }).open();
        }));
      const status = section.createEl('p', { cls: 'setting-item-description' });
      refreshStatus = () => {
        const problem = plugin.ruleProblem(rule, index);
        status.setText(!rule.enabled ? 'Regla desactivada.' : problem || 'Lista: ' + tagKey(rule.tag) + ' → ' + templatePath(rule.templatePath));
      };
      statusRefreshers.push(refreshStatus);
      refreshStatus();
      new Setting(section).addButton(button => button.setButtonText('Eliminar regla').onClick(() => {
        plugin.settings.rules.splice(index, 1);
        void plugin.saveSettings();
        this.display();
      }));
    });
    new Setting(containerEl).addButton(button => button.setButtonText('Añadir regla').setCta().onClick(() => {
      plugin.settings.rules.push({ tag: '', templatePath: '', enabled: true });
      void plugin.saveSettings();
      this.display();
    }));
  }
}
