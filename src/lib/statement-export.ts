import { Platform } from 'react-native';
import type { Statement } from '../services/statements';

const money = (v: number) => Number(v).toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const statementColumns = ['Fecha', 'Ciudad', 'Cliente', 'Aux.', 'Cantidad', 'Unidad / Turno', 'Valor unitario', 'H. extra', 'V. hora extra', 'Total', 'Observaciones'];
export function statementRows(s: Statement): (string | number)[][] {
  return s.lines.map(l => [l.date, s.header.city, s.header.client_name, l.auxiliaries, l.quantity, l.unit, l.unit_price, l.extra_hours, l.extra_price, l.total, l.observations]);
}
export async function statementPdf(s: Statement): Promise<Uint8Array> {
  // Keep pdf-lib out of the startup bundle evaluation. In some Metro web
  // builds its tslib interop fails before React can render the first screen.
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const widths = [56, 60, 72, 28, 43, 63, 70, 35, 67, 75, 190];
  let page = pdf.addPage([842, 595]), y = 565;
  // Word wrapping preserves complete data, including long invoice/client strings.
  const wrap = (text: string, width: number, size = 8) => {
    const result: string[] = []; let line = '';
    for (const word of text.replace(/\r/g, '').split(/\s+/)) {
      if (line && font.widthOfTextAtSize(line + ' ' + word, size) > width) { result.push(line); line = ''; }
      if (font.widthOfTextAtSize(word, size) <= width) line += (line ? ' ' : '') + word;
      else for (const char of word) {
        if (line && font.widthOfTextAtSize(line + char,size)>width) { result.push(line); line=''; }
        line+=char;
      }
    }
    result.push(line); return result;
  };
  const write = (text: string, size = 10, strong = false) => {
    for (const line of wrap(text, 790, size)) { page.drawText(line, { x: 24, y, size, font: strong ? bold : font }); y -= size + 5; }
  };
  const heading = () => {
    write(s.header.issuer_name, 13, true); write('NIT: ' + s.header.issuer_nit);
    write('PLANILLA DE SERVICIOS - ACTA NRO ' + s.number, 12, true);
    write(s.header.client_name + ' | Servicio: ' + s.header.service_name);
    write(s.start_date + ' al ' + s.end_date + ' | ' + s.status + (s.invoice_number ? ' | Factura: ' + s.invoice_number : ''));
    y -= 6;
  };
  const tableHeader = () => {
    let x = 24; page.drawRectangle({ x, y: y - 26, width: 790, height: 32, color: rgb(.92,.94,.97) });
    statementColumns.forEach((text, i) => { wrap(text, widths[i] - 6).forEach((v, j) => page.drawText(v, { x: x + 2, y: y - j * 10, size: 8, font: bold })); x += widths[i]; }); y -= 38;
  };
  heading(); tableHeader();
  for (const row of statementRows(s)) {
    const cells = row.map((v, i) => wrap([6,8,9].includes(i) ? money(Number(v)) : String(v), widths[i] - 6));
    let offset = 0; const count = Math.max(...cells.map(c => c.length));
    if (count * 11 + 8 > y - 45 && count * 11 + 8 < 350) { page=pdf.addPage([842,595]); y=565; heading(); tableHeader(); }
    while (offset < count) {
      if (y < 55) { page = pdf.addPage([842, 595]); y = 565; heading(); tableHeader(); }
      const available = Math.max(1, Math.floor((y - 45) / 11));
      const slice = Math.min(available, count - offset); let x = 24;
      cells.forEach((c,i) => { c.slice(offset, offset+slice).forEach((v,j) => page.drawText(v, { x: x+2,y:y-j*11,size:8,font })); x += widths[i]; });
      y -= slice * 11 + 8; offset += slice;
    }
  }
  if (y < 100) { page = pdf.addPage([842,595]); y = 565; heading(); }
  write('Subtotal: $' + money(s.subtotal), 11, true); write('IVA 19%: $' + money(s.vat), 11); write('TOTAL: $' + money(s.total), 12, true);
  pdf.getPages().forEach((p,i,all) => p.drawText('Pagina ' + (i+1) + ' de ' + all.length, { x: 730, y: 16, size: 8, font }));
  return pdf.save();
}
export async function exportStatement(s: Statement, format: 'pdf' | 'xlsx') {
  let bytes: Uint8Array;
  if (format === 'pdf') bytes = await statementPdf(s);
  else {
    const ExcelJS = await import('exceljs'); const book = new ExcelJS.Workbook(); const sheet = book.addWorksheet('Planilla');
    for (const v of [s.header.issuer_name,'NIT: '+s.header.issuer_nit,'PLANILLA DE SERVICIOS - ACTA NRO '+s.number,s.header.client_name+' | '+s.header.service_name,s.start_date+' al '+s.end_date,s.status+' | Factura: '+(s.invoice_number || '')]) sheet.addRow([v]);
    const head = sheet.addRow(statementColumns); head.font = { bold: true }; sheet.views = [{ state: 'frozen', ySplit: 7 }];
    statementRows(s).forEach(r => { const row = sheet.addRow(r); [7,9,10].forEach(n => row.getCell(n).numFmt = '#,##0.00'); });
    for (const [label,value] of [['Subtotal',s.subtotal],['IVA 19%',s.vat],['TOTAL',s.total]] as const) { const r=sheet.addRow([label,value]); r.getCell(2).numFmt='#,##0.00'; r.font={bold:true}; }
    sheet.columns.forEach((c,i) => { c.width = i===10 ? 48 : 20; c.alignment = { wrapText:true, vertical:'top' }; });
    bytes = new Uint8Array(await book.xlsx.writeBuffer());
  }
  const fileName = 'Acta-' + s.client_id + '-' + s.number + '.' + format;
  const mimeType = format==='pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  if (Platform.OS === 'web') {
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mimeType }));
    const link = document.createElement('a'); link.href=url; link.download=fileName; link.click(); setTimeout(() => URL.revokeObjectURL(url),30000);
  } else {
    const { File, Paths } = await import('expo-file-system'); const Sharing = await import('expo-sharing');
    if (!(await Sharing.isAvailableAsync())) throw new Error('No hay una aplicacion disponible para compartir este archivo');
    const file = new File(Paths.cache,fileName); file.write(bytes);
    try { await Sharing.shareAsync(file.uri,{mimeType,dialogTitle:'Guardar acta de servicios'}); } finally { if(file.exists) file.delete(); }
  }
}
