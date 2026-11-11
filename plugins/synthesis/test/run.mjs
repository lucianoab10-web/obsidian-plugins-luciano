// Empaqueta las suites con esbuild (sustituyendo "obsidian" por mocks) y las ejecuta en Node.
//   1) test/suite.ts → lógica: notas, imágenes, API simulada, errores, PDF
//   2) test/ui.ts    → interfaz con jsdom: ajustes, modal, progreso, segundo plano, cancelación
import esbuild from "esbuild";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

const suites = [
	{ entry: "test/suite.ts", out: "test/.suite.bundle.cjs", mock: "./test/obsidian-mock.ts", external: [] },
	{ entry: "test/ui.ts", out: "test/.ui.bundle.cjs", mock: "./test/obsidian-ui-mock.ts", external: ["jsdom"] },
];
let status = 0;
for (const s of suites) {
	await esbuild.build({
		entryPoints: [s.entry],
		bundle: true,
		platform: "node",
		format: "cjs",
		outfile: s.out,
		alias: { obsidian: s.mock },
		external: s.external,
		logLevel: "error",
	});
	const r = spawnSync(process.execPath, [s.out], { stdio: "inherit" });
	if (r.status !== 0) status = r.status ?? 1;
}

// 3) El main.js de producción (compilado para navegador) con el mismo recorrido de interfaz.
if (existsSync("main.js")) {
	console.log("\n══ Bundle de producción (main.js) ══");
	await esbuild.build({ entryPoints: ["test/obsidian-ui-mock.ts"], bundle: true, platform: "node", format: "cjs", outfile: "test/.obsidian-ui-mock.cjs", logLevel: "error" });
	await esbuild.build({ entryPoints: ["test/ui.ts"], bundle: true, platform: "node", format: "cjs", outfile: "test/.ui-prod.bundle.cjs", external: ["jsdom", "obsidian"], logLevel: "error" });
	const prod = spawnSync(process.execPath, ["-e", [
		"const Module = require('node:module'); const path = require('node:path');",
		"const mock = require(path.resolve('test/.obsidian-ui-mock.cjs'));",
		"const orig = Module._load;",
		"Module._load = function (request, ...rest) { return request === 'obsidian' ? mock : orig.call(this, request, ...rest); };",
		"process.env.SYNTH_PROD_BUNDLE = path.resolve('main.js');",
		"require(path.resolve('test/.ui-prod.bundle.cjs'));",
	].join("\n")], { stdio: "inherit" });
	if (prod.status !== 0) status = prod.status ?? 1;
}
process.exit(status);
