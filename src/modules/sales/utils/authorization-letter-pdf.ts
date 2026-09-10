import { jsPDF } from 'jspdf';
import { saleCompanyLetter } from '../constants/sale-companies';
import { fullName, hasIneDocumentos, realContrato, type SaleFormData } from '../types/sale-form';
import { formatMoneyDisplay, normalizeFrequency } from './sale-finance';

const PAGE_W = 612;
const PAGE_H = 792;
const BLUE: [number, number, number] = [7, 88, 118];
const LOGO: [number, number, number] = [48, 97, 123];
const M = 46;

const MONTHS = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
];

type Doc = jsPDF;
export type AuthorizationLetterOpts = { saleId?: number | null; status?: string };
type LogoAsset = { dataUrl: string; width: number; height: number };

function v(text?: string | null) {
  return (text ?? '').trim();
}

function digits(raw?: string | null) {
  return String(raw ?? '').replace(/\D/g, '');
}

function setBlue(doc: Doc) {
  doc.setTextColor(...BLUE);
  doc.setDrawColor(...BLUE);
}

function formatLongDate(iso: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
  if (!m) return '';
  return `${Number(m[3])} de ${MONTHS[Number(m[2]) - 1] || ''} de ${m[1]}`;
}

function formatShortDate(iso: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
  if (!m) return '';
  return `${m[3]}/${m[2]}/${m[1]}`;
}

function frequencyLabel(raw: string) {
  const code = normalizeFrequency(raw);
  if (code === 'MENSUAL') return 'MENSUAL';
  if (code === 'QUINCENAL') return 'QUINCENAL';
  if (code === 'SEMANAL') return 'SEMANAL';
  if (code === 'CONTADO') return 'CONTADO';
  return v(raw).toUpperCase();
}

function loadHeaderLogo(): Promise<LogoAsset | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const width = img.naturalWidth || 114;
      const height = img.naturalHeight || 52;
      const scale = 3;
      const canvas = document.createElement('canvas');
      canvas.width = width * scale;
      canvas.height = height * scale;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(null);
        return;
      }
      ctx.scale(scale, scale);
      ctx.drawImage(img, 0, 0, width, height);
      ctx.globalCompositeOperation = 'source-in';
      ctx.fillStyle = `rgb(${LOGO.join(',')})`;
      ctx.fillRect(0, 0, width, height);
      resolve({ dataUrl: canvas.toDataURL('image/png'), width, height });
    };
    img.onerror = () => resolve(null);
    img.src = '/logo-sanmartin.svg';
  });
}

export function isDraftAuthorizationLetter(
  form: SaleFormData,
  opts?: AuthorizationLetterOpts,
): boolean {
  const status = String(opts?.status || '').toUpperCase();
  if (status === 'COMPLETED' || status === 'SUBMITTED') return false;
  return !form.documentos?.firmaCliente?.dataBase64?.trim();
}

function drawDraftWatermark(doc: Doc) {
  const ys = [PAGE_H * 0.3, PAGE_H * 0.55, PAGE_H * 0.78];
  doc.saveGraphicsState();
  doc.setGState(new doc.GState({ opacity: 0.1 }));
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(68);
  doc.setTextColor(140, 148, 156);
  for (const y of ys) {
    doc.text('BORRADOR', PAGE_W / 2, y, {
      align: 'center',
      baseline: 'middle',
      angle: 32,
    });
  }
  doc.restoreGraphicsState();
}

function strokeRect(doc: Doc, x: number, y: number, w: number, h: number) {
  setBlue(doc);
  doc.setLineWidth(1.05);
  doc.rect(x, y, w, h);
}

function underline(doc: Doc, x1: number, x2: number, y: number) {
  setBlue(doc);
  doc.setLineWidth(0.75);
  doc.line(x1, y, x2, y);
}

function fieldLine(
  doc: Doc,
  label: string,
  value: string,
  lx: number,
  ly: number,
  lineX: number,
  lineTo: number,
) {
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  setBlue(doc);
  doc.text(label, lx, ly);
  underline(doc, lineX, lineTo, ly + 1.4);
  if (!value) return;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.text(value, lineX + 2, ly - 1.6, {
    maxWidth: Math.max(12, lineTo - lineX - 4),
  });
}

function checkBox(doc: Doc, on: boolean, x: number, y: number) {
  strokeRect(doc, x, y, 13.2, 11.4);
  if (!on) return;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  setBlue(doc);
  doc.text('X', x + 3.2, y + 8.6);
}

function drawParagraph(
  doc: Doc,
  text: string,
  boldParts: string[],
  x: number,
  y: number,
  maxW: number,
  lineH: number,
) {
  const parts: { text: string; bold: boolean }[] = [];
  let rest = text;
  while (rest) {
    let next = rest.length;
    let bold = '';
    for (const phrase of boldParts) {
      const idx = rest.toUpperCase().indexOf(phrase.toUpperCase());
      if (idx >= 0 && idx < next) {
        next = idx;
        bold = rest.slice(idx, idx + phrase.length);
      }
    }
    if (next > 0) parts.push({ text: rest.slice(0, next), bold: false });
    if (bold) {
      parts.push({ text: bold, bold: true });
      rest = rest.slice(next + bold.length);
    } else {
      rest = rest.slice(next);
    }
  }

  let cx = x;
  let cy = y;
  const words = parts.flatMap((p) => {
    const tokens = p.text.split(/(\s+)/).filter(Boolean);
    return tokens.map((t) => ({ text: t, bold: p.bold }));
  });

  for (const word of words) {
    doc.setFont('helvetica', word.bold ? 'bold' : 'normal');
    doc.setFontSize(7.35);
    const w = doc.getTextWidth(word.text);
    if (cx > x && cx + w > x + maxW && !/^\s+$/.test(word.text)) {
      cx = x;
      cy += lineH;
    }
    setBlue(doc);
    doc.text(word.text, cx, cy);
    cx += w;
  }
  return cy + lineH;
}

function drawLetter(
  doc: Doc,
  form: SaleFormData,
  logo: LogoAsset | null,
  opts?: AuthorizationLetterOpts,
) {
  const c = form.contacto;
  const p = form.pago;
  const company = saleCompanyLetter(form.ubicacionPlan.planKind);
  const contrato =
    realContrato(form.meta.contrato) ||
    v(form.meta.folioSolicitud) ||
    (opts?.saleId ? String(opts.saleId) : '');
  const fecha = formatLongDate(form.meta.fecha);
  const lugarFecha = fecha
    ? `Culiacán, Sinaloa a ${fecha}`
    : 'Culiacán, Sinaloa';
  const nombre = v(p.titularTarjeta) || fullName(c);
  const card = digits(p.cuenta).slice(0, 16);
  const venc = v(p.vencimientoTarjeta);
  const inicio = formatShortDate(form.meta.fecha);
  const hasIne = hasIneDocumentos(form.documentos);

  if (logo) {
    const logoH = 68;
    const logoW = (logo.width / logo.height) * logoH;
    doc.addImage(logo.dataUrl, 'PNG', M, 28, Math.min(logoW, 210), logoH);
  } else {
    doc.setFont('times', 'bold');
    doc.setFontSize(16);
    doc.setTextColor(...LOGO);
    doc.text('SAN MARTÍN', M + 4, 62);
    doc.setFont('times', 'normal');
    doc.setFontSize(6.5);
    doc.text('TU VIDA, UN LEGADO', M + 4, 74);
  }

  const titleX = 438;
  setBlue(doc);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16.5);
  doc.text('CARTA DE AUTORIZACIÓN', titleX, 50, { align: 'center' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  doc.text('Servicio Cargo Automático', titleX, 68, { align: 'center' });
  doc.text('Cargos Recurrentes', titleX, 83, { align: 'center' });

  strokeRect(doc, 312, 98, 254, 22);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.text('No. de contrato:', 318, 112.5);
  if (contrato) {
    doc.setFont('helvetica', 'bold');
    doc.text(contrato, 382, 112.5, { maxWidth: 176 });
  }

  strokeRect(doc, 312, 126, 254, 22);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.text('Lugar y fecha:', 318, 140.5);
  if (lugarFecha) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.text(lugarFecha, 376, 140.5, { maxWidth: 182 });
  }

  const boxY = 158;
  const boxH = 198;
  const boxW = 254;
  strokeRect(doc, M, boxY, boxW, boxH);
  strokeRect(doc, 312, boxY, boxW, boxH);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  setBlue(doc);
  doc.text('DATOS DEL TARJETAHABIENTE', M + 10, boxY + 16);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.text('Número de Tarjeta', M + 10, boxY + 30);

  const cellW = 14.2;
  const cellH = 16.8;
  const cellsX = M + 10;
  const cellsY = boxY + 34;
  for (let i = 0; i < 16; i += 1) {
    const x = cellsX + i * cellW;
    strokeRect(doc, x, cellsY, cellW, cellH);
    const d = card[i];
    if (!d) continue;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    setBlue(doc);
    doc.text(d, x + cellW / 2, cellsY + 12, { align: 'center' });
  }

  const row1 = boxY + 68;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  setBlue(doc);
  doc.text('Fecha de:', M + 10, row1);
  doc.text('Inicio', M + 58, row1);
  underline(doc, M + 82, M + 128, row1 + 1.4);
  if (inicio) {
    doc.setFont('helvetica', 'bold');
    doc.text(inicio, M + 84, row1 - 1.4);
  }
  doc.setFont('helvetica', 'normal');
  doc.text('Vencimiento', M + 136, row1);
  underline(doc, M + 188, M + boxW - 10, row1 + 1.4);
  if (venc) {
    doc.setFont('helvetica', 'bold');
    doc.text(venc, M + 190, row1 - 1.4);
  }

  const lineTo = M + boxW - 10;
  fieldLine(doc, 'Nombre:', nombre, M + 10, boxY + 86, M + 46, lineTo);
  fieldLine(doc, 'RFC:', v(c.rfc).toUpperCase(), M + 10, boxY + 102, M + 32, lineTo);
  fieldLine(doc, 'Domicilio:', v(c.direccion), M + 10, boxY + 118, M + 52, lineTo);
  fieldLine(doc, 'Colonia:', v(c.colonia), M + 10, boxY + 134, M + 44, lineTo);
  fieldLine(doc, 'C.P.', v(c.cp), M + 10, boxY + 150, M + 30, M + 88);
  fieldLine(doc, 'Tel.', v(c.celular1), M + 96, boxY + 150, M + 114, lineTo);
  fieldLine(doc, 'Correo:', v(c.correo), M + 10, boxY + 166, M + 42, lineTo);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  setBlue(doc);
  doc.text('Identificación:', M + 10, boxY + 184);
  checkBox(doc, hasIne, M + 72, boxY + 175);
  doc.text('Credencial de elector', M + 88, boxY + 184);
  checkBox(doc, false, M + 178, boxY + 175);
  doc.text('Pasaporte', M + 194, boxY + 184);

  const cx = 439;
  const companyLines = [
    ...company.boxTitle,
    '',
    ...company.address,
    company.phone,
    company.rfcDisplay,
  ];
  const companyBlockH = companyLines.reduce(
    (h, line) => h + (line ? 13 : 8),
    0,
  );
  let cy = boxY + (boxH - companyBlockH) / 2 + 10;
  for (const line of companyLines) {
    if (!line) {
      cy += 8;
      continue;
    }
    const title = company.boxTitle.includes(line);
    doc.setFont('helvetica', title ? 'bold' : 'normal');
    doc.setFontSize(title ? 11 : 8.1);
    setBlue(doc);
    doc.text(line, cx, cy, { align: 'center', maxWidth: 230 });
    cy += title ? 15 : 13;
  }

  const legalY = 368;
  const legalH = 138;
  strokeRect(doc, M, legalY, 520, legalH);
  const legal = [
    `Por medio de la presente, solicito y autorizo expresamente a ${company.legalName} (RFC: ${company.legalRfc}), así como a la institución bancaria o pasarela de pagos que esta designe para el procesamiento de transacciones, para que realicen los cargos correspondientes a mi Tarjeta (Crédito/Débito) cuyos datos se detallan en este formato.`,
    `Esta autorización faculta a la institución emisora de mi tarjeta para pagar por mi cuenta a ${company.legalName} los cargos por los conceptos, periodicidad y montos que se detallan a continuación.`,
    `${company.legalName} se obliga y es responsable de cumplir con: (i) la información generada correcta y oportuna de los cargos al Tarjetahabiente, y (ii) la calidad y entrega de los productos y servicios ofrecidos, liberando a la institución bancaria procesadora de toda reclamación comercial que se generara por parte del Tarjetahabiente.`,
    `El Tarjetahabiente podrá revocar esta Carta Autorización mediante comunicado por escrito con quince (15) días naturales de anticipación entregado a ${company.legalName}, quien acusará de recibo anotando la fecha. En este caso, la empresa deberá informar al Tarjetahabiente la fecha en que dejará de surtir efecto la presente autorización.`,
  ];
  let ly = legalY + 16;
  for (const para of legal) {
    ly = drawParagraph(
      doc,
      para,
      [company.legalName, `RFC: ${company.legalRfc}`],
      M + 8,
      ly,
      504,
      9.1,
    );
    ly += 3.2;
  }

  const tableY = 516;
  const tableH = 92;
  strokeRect(doc, M, tableY, 520, tableH);
  doc.setLineWidth(0.75);
  doc.line(228, tableY, 228, tableY + tableH);
  doc.line(398, tableY, 398, tableY + tableH);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  setBlue(doc);
  doc.text('CONCEPTO', 137, tableY + 16, { align: 'center' });
  doc.text('PERIODICIDAD', 313, tableY + 16, { align: 'center' });
  doc.text('MONTO (M.N.)', 482, tableY + 16, { align: 'center' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  const concepto =
    v(form.ubicacionPlan.nombrePlan) ||
    (form.ubicacionPlan.planKind === 'PARQUE' ? 'PLAN PARQUE' : 'PLAN A FUTURO');
  const conceptoLines = doc.splitTextToSize(concepto.toUpperCase(), 168) as string[];
  doc.text(conceptoLines, M + 8, tableY + 36);
  doc.text(frequencyLabel(p.frecuencia) || '', 313, tableY + 36, {
    align: 'center',
  });
  doc.text(formatMoneyDisplay(p.importeCadaPago) || '', 482, tableY + 36, {
    align: 'center',
  });
  doc.setFontSize(6.2);
  doc.text(
    'La periodicidad y el monto pueden ser variables o fijos y deberá especificarse claramente',
    458,
    tableY + tableH - 10,
    { align: 'center', maxWidth: 230 },
  );

  const signY = 618;
  const signH = 148;
  strokeRect(doc, M, signY, 520, signH);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  setBlue(doc);
  doc.text('Firma del Tarjetahabiente', M + 12, signY + 18);

  const firma = form.documentos.firmaCliente;
  if (firma?.dataBase64?.trim()) {
    const dataUrl = firma.dataBase64.startsWith('data:')
      ? firma.dataBase64
      : `data:${firma.mime || 'image/png'};base64,${firma.dataBase64}`;
    try {
      doc.addImage(dataUrl, 'PNG', M + 36, signY + 28, 150, 48);
    } catch {
      /* ignore */
    }
  }

  underline(doc, M + 18, 250, signY + 118);
  underline(doc, 338, M + 508, signY + 118);
  const responsable = v(p.nombreAsesor) || v(p.nombreJefeVentas);
  if (responsable) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.text(responsable, 423, signY + 114, { align: 'center', maxWidth: 180 });
  }
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.text('Acepto el Servicio Cargo Automático', 134, signY + 132, {
    align: 'center',
  });
  doc.text('Nombre y firma del responsable', 423, signY + 132, {
    align: 'center',
  });
}

export async function buildAuthorizationLetterPdf(
  form: SaleFormData,
  opts?: AuthorizationLetterOpts,
): Promise<Blob> {
  const doc = new jsPDF({
    unit: 'pt',
    format: [PAGE_W, PAGE_H],
    compress: true,
  });
  const logo = await loadHeaderLogo();
  drawLetter(doc, form, logo, opts);
  if (isDraftAuthorizationLetter(form, opts)) {
    drawDraftWatermark(doc);
  }
  return doc.output('blob');
}

export async function buildAuthorizationLetterBundle(
  form: SaleFormData,
  opts?: AuthorizationLetterOpts,
): Promise<{ blob: Blob; pages: string[] }> {
  const blob = await buildAuthorizationLetterPdf(form, opts);
  const { renderPdfToPageImages } = await import('./pdf-page-renderer');
  try {
    const pages = await renderPdfToPageImages(blob);
    return { blob, pages };
  } catch {
    return { blob, pages: [] };
  }
}
