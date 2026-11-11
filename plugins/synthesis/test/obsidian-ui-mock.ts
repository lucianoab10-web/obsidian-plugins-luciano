/* eslint-disable @typescript-eslint/no-explicit-any */
// Mock de Obsidian para pruebas de interfaz: solo lo que usa Synthesis. Requiere globalThis.document (jsdom).
const doc = (): Document => (globalThis as any).document;

export class TFile {
	path = '';
	name = '';
	basename = '';
	extension = '';
	parent: { path: string } | null = null;
	stat = { mtime: 0, ctime: 0, size: 0 };
}
export class MarkdownView {}
export function normalizePath(p: string): string {
	return p.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\/|\/$/g, '');
}
export function setIcon(el: HTMLElement, name: string): void {
	el.setAttribute('data-icon', name);
}

export class Notice {
	static log: string[] = [];
	noticeEl: HTMLElement;
	constructor(message: string | DocumentFragment) {
		Notice.log.push(typeof message === 'string' ? message : (message.textContent ?? ''));
		this.noticeEl = doc().createElement('div');
	}
	hide(): void {}
}

export class ButtonComponent {
	buttonEl: HTMLButtonElement;
	constructor(container: HTMLElement) {
		this.buttonEl = doc().createElement('button');
		container.appendChild(this.buttonEl);
	}
	setButtonText(t: string) {
		this.buttonEl.textContent = t;
		return this;
	}
	setCta() {
		this.buttonEl.classList.add('mod-cta');
		return this;
	}
	setWarning() {
		this.buttonEl.classList.add('mod-warning');
		return this;
	}
	setDisabled(d: boolean) {
		this.buttonEl.disabled = d;
		return this;
	}
	onClick(cb: (e: MouseEvent) => unknown) {
		this.buttonEl.addEventListener('click', (e) => void cb(e as MouseEvent));
		return this;
	}
}

class TextBase<T extends HTMLInputElement | HTMLTextAreaElement> {
	inputEl: T;
	constructor(container: HTMLElement, tag: string) {
		this.inputEl = doc().createElement(tag) as T;
		container.appendChild(this.inputEl);
	}
	setValue(v: string) {
		this.inputEl.value = v;
		return this;
	}
	setPlaceholder(v: string) {
		this.inputEl.placeholder = v;
		return this;
	}
	onChange(cb: (v: string) => unknown) {
		this.inputEl.addEventListener('input', () => void cb(this.inputEl.value));
		return this;
	}
}
class TextComponent extends TextBase<HTMLInputElement> {
	constructor(c: HTMLElement) {
		super(c, 'input');
	}
}
class TextAreaComponent extends TextBase<HTMLTextAreaElement> {
	constructor(c: HTMLElement) {
		super(c, 'textarea');
	}
}
class DropdownComponent {
	selectEl: HTMLSelectElement;
	constructor(container: HTMLElement) {
		this.selectEl = doc().createElement('select');
		container.appendChild(this.selectEl);
	}
	addOption(value: string, label: string) {
		const o = doc().createElement('option');
		o.value = value;
		o.textContent = label;
		this.selectEl.appendChild(o);
		return this;
	}
	addOptions(rec: Record<string, string>) {
		for (const [k, v] of Object.entries(rec)) this.addOption(k, v);
		return this;
	}
	setValue(v: string) {
		this.selectEl.value = v;
		return this;
	}
	onChange(cb: (v: string) => unknown) {
		this.selectEl.addEventListener('change', () => void cb(this.selectEl.value));
		return this;
	}
}
class ToggleComponent {
	inputEl: HTMLInputElement;
	constructor(container: HTMLElement) {
		this.inputEl = doc().createElement('input');
		this.inputEl.type = 'checkbox';
		container.appendChild(this.inputEl);
	}
	setValue(v: boolean) {
		this.inputEl.checked = v;
		return this;
	}
	onChange(cb: (v: boolean) => unknown) {
		this.inputEl.addEventListener('change', () => void cb(this.inputEl.checked));
		return this;
	}
}
export class SecretComponent {
	value = '';
	cb: ((v: string) => unknown) | null = null;
	constructor(
		public app: unknown,
		el: HTMLElement,
	) {
		el.setAttribute('data-secret', '1');
	}
	setValue(v: string) {
		this.value = v;
		return this;
	}
	onChange(cb: (v: string) => unknown) {
		this.cb = cb;
		return this;
	}
}

export class Setting {
	settingEl: HTMLElement;
	nameEl: HTMLElement;
	descEl: HTMLElement;
	controlEl: HTMLElement;
	constructor(containerEl: HTMLElement) {
		this.settingEl = (containerEl as any).createDiv({ cls: 'setting-item' });
		this.nameEl = (this.settingEl as any).createDiv({ cls: 'setting-item-name' });
		this.descEl = (this.settingEl as any).createDiv({ cls: 'setting-item-description' });
		this.controlEl = (this.settingEl as any).createDiv({ cls: 'setting-item-control' });
	}
	setName(n: string) {
		this.nameEl.textContent = n;
		return this;
	}
	setDesc(d: string) {
		this.descEl.textContent = d;
		return this;
	}
	setHeading() {
		this.settingEl.classList.add('setting-item-heading');
		return this;
	}
	addText(cb: (t: TextComponent) => unknown) {
		cb(new TextComponent(this.controlEl));
		return this;
	}
	addTextArea(cb: (t: TextAreaComponent) => unknown) {
		cb(new TextAreaComponent(this.controlEl));
		return this;
	}
	addDropdown(cb: (d: DropdownComponent) => unknown) {
		cb(new DropdownComponent(this.controlEl));
		return this;
	}
	addToggle(cb: (t: ToggleComponent) => unknown) {
		cb(new ToggleComponent(this.controlEl));
		return this;
	}
	addButton(cb: (b: ButtonComponent) => unknown) {
		cb(new ButtonComponent(this.controlEl));
		return this;
	}
	addComponent(cb: (el: HTMLElement) => unknown) {
		cb(this.controlEl);
		return this;
	}
}

export class PluginSettingTab {
	containerEl: HTMLElement = doc().createElement('div');
	constructor(
		public app: unknown,
		public plugin: unknown,
	) {}
}

export class Modal {
	modalEl: HTMLElement;
	titleEl: HTMLElement;
	contentEl: HTMLElement;
	constructor(public app: unknown) {
		this.modalEl = doc().createElement('div');
		this.titleEl = doc().createElement('div');
		this.contentEl = doc().createElement('div');
		this.modalEl.append(this.titleEl, this.contentEl);
	}
	open(): void {
		doc().body.appendChild(this.modalEl); // como en Obsidian, el modal queda conectado al documento
		(this as any).onOpen?.();
	}
	close(): void {
		(this as any).onClose?.();
		this.modalEl.remove();
	}
}

export class Plugin {
	ribbon: { icon: string; title: string; cb: () => void }[] = [];
	commands: { id: string; name: string; callback: () => void }[] = [];
	tabs: any[] = [];
	statusBar: HTMLElement | null = null;
	private data: unknown = null;
	constructor(
		public app: any,
		public manifest: any,
	) {}
	async loadData(): Promise<unknown> {
		return this.data;
	}
	async saveData(d: unknown): Promise<void> {
		this.data = JSON.parse(JSON.stringify(d));
	}
	addRibbonIcon(icon: string, title: string, cb: () => void): HTMLElement {
		this.ribbon.push({ icon, title, cb });
		return doc().createElement('div');
	}
	addCommand(c: { id: string; name: string; callback: () => void }): void {
		this.commands.push(c);
	}
	addSettingTab(t: unknown): void {
		this.tabs.push(t);
	}
	addStatusBarItem(): HTMLElement {
		this.statusBar = doc().createElement('div');
		return this.statusBar;
	}
}

// Simula requestUrl con el fetch real de Node (las pruebas pueden reemplazar globalThis.fetch por uno que falle).
export function requestUrl(req: { url: string; method?: string; headers?: Record<string, string>; body?: string }) {
	const g = globalThis as any;
	g.__requestUrlCalls = (g.__requestUrlCalls ?? 0) + 1;
	const realFetch: typeof fetch = g.__realFetch ?? g.fetch;
	return realFetch(req.url, { method: req.method, headers: req.headers, body: req.body }).then(async (r) => ({
		status: r.status,
		headers: Object.fromEntries(r.headers.entries()),
		arrayBuffer: await r.arrayBuffer(),
	}));
}
