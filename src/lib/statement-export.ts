import { Platform } from 'react-native';
import type { Statement } from '../services/statements';

const money = (v: number) => Number(v).toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const statementColumns = ['Fecha', 'Ciudad', 'Cliente', 'Aux.', 'Cantidad', 'Unidad / Turno', 'Valor unitario', 'H. extra', 'V. hora extra', 'Total', 'Observaciones'];
export function statementRows(s: Statement): (string | number)[][] {
  return s.lines.map(l => [l.date, s.header.city, s.header.client_name, l.auxiliaries, l.quantity, l.unit, l.unit_price, l.extra_hours, l.extra_price, l.total, l.observations]);
}
export async function statementPdf(s: Statement): Promise<Uint8Array> {
  // The web UMD bundle includes its helpers; Metro's ESM/tslib interop breaks
  // when the regular package is loaded for PDF downloads.
  const { PDFDocument, StandardFonts, rgb } = Platform.OS === 'web'
    ? require('pdf-lib/dist/pdf-lib.min.js') as typeof import('pdf-lib')
    : await import('pdf-lib');
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const pageWidth = 595.28, pageHeight = 841.89; // A4 portrait, in points.
  const margin = 28, tableWidth = pageWidth - margin * 2;
  const widths = [48, 48, 58, 23, 34, 58, 57, 29, 54, 58, 72.28];
  const ink = rgb(.09, .16, .34), muted = rgb(.34, .4, .51);
  const grid = rgb(.76, .81, .88), headerFill = rgb(.09, .17, .36);
  const alternateFill = rgb(.96, .97, .99);
  let page = pdf.addPage([pageWidth, pageHeight]), y = 0;

  const wrap = (text: string, width: number, size = 8, face = font): string[] => {
    const lines: string[] = [];
    let current = '';
    for (const word of text.replace(/\r/g, '').split(/\s+/)) {
      if (!word) continue;
      const proposed = current ? current + ' ' + word : word;
      if (face.widthOfTextAtSize(proposed, size) <= width) { current = proposed; continue; }
      if (current) { lines.push(current); current = ''; }
      for (const char of word) {
        if (current && face.widthOfTextAtSize(current + char, size) > width) {
          lines.push(current); current = '';
        }
        current += char;
      }
    }
    lines.push(current);
    return lines;
  };
  const centered = (text: string, top: number, size: number, face = font, color = ink) => {
    const width = face.widthOfTextAtSize(text, size);
    page.drawText(text, { x: (pageWidth - width) / 2, y: top, size, font: face, color });
  };
  const heading = () => {
    y = pageHeight - margin - 9;
    centered(s.header.issuer_name, y, 14, bold); y -= 18;
    centered('NIT: ' + s.header.issuer_nit, y, 9, font, muted); y -= 25;
    centered('ACTA DE SERVICIOS NRO ' + s.number, y, 13, bold); y -= 26;
    const client = wrap('Cliente: ' + s.header.client_name, tableWidth / 2 - 10, 9, bold);
    const service = wrap('Servicios: ' + s.header.service_name, tableWidth / 2 - 10, 9, bold);
    const rows = Math.max(client.length, service.length);
    client.forEach((line, index) => page.drawText(line, { x: margin, y: y - index * 12, size: 9, font: bold, color: ink }));
    service.forEach((line, index) => page.drawText(line, { x: pageWidth - margin - bold.widthOfTextAtSize(line, 9), y: y - index * 12, size: 9, font: bold, color: ink }));
    y -= rows * 12 + 14;
    centered('PLANILLA DE SERVICIOS', y, 11, bold); y -= 17;
    const dateLabel = (date: string) => date.split('-').reverse().join('/');
    centered('DEL ' + dateLabel(s.start_date) + ' AL ' + dateLabel(s.end_date), y, 9, font, muted); y -= 16;
  };
  const tableHeader = () => {
    const height = 32;
    page.drawRectangle({ x: margin, y: y - height, width: tableWidth, height, color: headerFill, borderColor: grid, borderWidth: .7 });
    let x = margin;
    statementColumns.forEach((label, index) => {
      const lines = wrap(label, widths[index] - 6, 6.1, bold);
      lines.forEach((line, lineIndex) => page.drawText(line, { x: x + 3, y: y - 11 - lineIndex * 8, size: 6.1, font: bold, color: rgb(1, 1, 1) }));
      x += widths[index];
      if (index < widths.length - 1) page.drawLine({ start: { x, y }, end: { x, y: y - height }, thickness: .5, color: rgb(.48, .56, .7) });
    });
    y -= height;
  };
  const nextPage = (withTableHeader: boolean) => {
    page = pdf.addPage([pageWidth, pageHeight]);
    y = pageHeight - margin - 8;
    if (withTableHeader) tableHeader();
  };
  heading(); tableHeader();
  const rows = statementRows(s);
  rows.forEach((row, rowIndex) => {
    const cells = row.map((value, index) => wrap([6, 8, 9].includes(index) ? money(Number(value)) : String(value), widths[index] - 6, 6.4));
    const lineCount = Math.max(...cells.map(cell => cell.length));
    const fullHeight = Math.max(18, lineCount * 8.5 + 6);
    const freshPageCapacity = pageHeight - margin * 2 - 8 - 32 - 16;
    if (fullHeight <= freshPageCapacity) {
      const reserve = rowIndex === rows.length - 1 ? 91 : 16;
      if (y - fullHeight < margin + reserve) nextPage(true);
    }
    let offset = 0;
    do {
      if (y < margin + 34) nextPage(true);
      const capacity = Math.max(1, Math.floor((y - margin - 22) / 8.5));
      const count = Math.min(capacity, lineCount - offset);
      const height = Math.max(18, count * 8.5 + 6);
      if (y - height < margin + 15) { nextPage(true); continue; }
      let x = margin;
      cells.forEach((cell, index) => {
        page.drawRectangle({ x, y: y - height, width: widths[index], height,
          color: rowIndex % 2 ? alternateFill : rgb(1, 1, 1), borderColor: grid, borderWidth: .55 });
        cell.slice(offset, offset + count).forEach((line, lineIndex) =>
          page.drawText(line, { x: x + 3, y: y - 9 - lineIndex * 8.5, size: 6.4, font, color: ink }));
        x += widths[index];
      });
      y -= height;
      offset += count;
    } while (offset < lineCount);
  });
  if (y < margin + 91) nextPage(false);
  y -= 14;
  const totalsX = pageWidth - margin - 245;
  const totals = [
    ['Subtotal', s.subtotal],
    ['IVA 19%', s.vat],
    ['VALOR TOTAL', s.total],
  ] as const;
  totals.forEach(([label, amount], index) => {
    const height = index === 2 ? 27 : 23;
    page.drawRectangle({ x: totalsX, y: y - height, width: 245, height,
      color: index === 2 ? headerFill : alternateFill, borderColor: grid, borderWidth: .7 });
    const face = index === 2 ? bold : font;
    const color = index === 2 ? rgb(1, 1, 1) : ink;
    const value = '$ ' + money(amount);
    page.drawText(label, { x: totalsX + 9, y: y - 15, size: 9, font: face, color });
    page.drawText(value, { x: pageWidth - margin - 9 - face.widthOfTextAtSize(value, 9), y: y - 15, size: 9, font: face, color });
    y -= height;
  });
  pdf.getPages().forEach((p, index, all) => {
    const text = 'Página ' + (index + 1) + ' de ' + all.length;
    p.drawText(text, { x: (pageWidth - font.widthOfTextAtSize(text, 8)) / 2, y: 17, size: 8, font, color: muted });
  });
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
    const link = document.createElement('a'); link.href=url; link.download=fileName; document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url),30000);
  } else {
    const { File, Paths } = await import('expo-file-system'); const Sharing = await import('expo-sharing');
    if (!(await Sharing.isAvailableAsync())) throw new Error('No hay una aplicacion disponible para compartir este archivo');
    const file = new File(Paths.cache,fileName); file.write(bytes);
    try { await Sharing.shareAsync(file.uri,{mimeType,dialogTitle:'Guardar acta de servicios'}); } finally { if(file.exists) file.delete(); }
  }
}
