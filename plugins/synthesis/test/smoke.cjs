const fs = require('fs');
const pdfMake = require('pdfmake/build/pdfmake');
const vfs = require('pdfmake/build/vfs_fonts');
console.log('keys:', Object.keys(pdfMake).join(','));
console.log('fonts por defecto:', Object.keys(pdfMake.fonts || {}));
const sym = fs.readFileSync('tools/Symbols.ttf').toString('base64');
pdfMake.addVirtualFileSystem({ ...vfs, 'Symbols.ttf': sym });
pdfMake.addFonts({ Symbols: { normal: 'Symbols.ttf', bold: 'Symbols.ttf', italics: 'Symbols.ttf', bolditalics: 'Symbols.ttf' } });
const doc = {
  defaultStyle: { font: 'Roboto', fontSize: 11 },
  content: [
    { text: 'Prueba: ácidos, señal, Δ, α, H₂O, x², CO₃²⁻ ' },
    { text: ['Reacción: A ', { text: '⇌', font: 'Symbols' }, ' B  y  C ', { text: '→', font: 'Symbols' }, ' D  ', { text: '∈ ∪ ∀', font: 'Symbols' }] },
  ],
};
(async () => {
  const buf = await pdfMake.createPdf(doc).getBuffer();
  fs.writeFileSync('/tmp/smoke.pdf', Buffer.from(buf));
  console.log('PDF ok, bytes:', buf.length ?? buf.byteLength);
})().catch(e => { console.error('ERROR', e); process.exit(1); });
