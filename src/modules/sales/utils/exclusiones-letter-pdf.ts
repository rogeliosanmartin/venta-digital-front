import { jsPDF } from 'jspdf';
import { fullName, realContrato, type SaleFormData } from '../types/sale-form';

const PAGE_W = 612.28;
const PAGE_H = 792;
const ML = 54;
const MR = 54;
const INK: [number, number, number] = [20, 22, 24];
const LINE: [number, number, number] = [40, 42, 46];
const LOGO: [number, number, number] = [74, 84, 94];
const GOLD: [number, number, number] = [212, 179, 138];
const CONTENT_W = PAGE_W - ML - MR;

type LogoAsset = { dataUrl: string; width: number; height: number };
type Doc = jsPDF;
export type ExclusionesLetterOpts = { saleId?: number | null; status?: string };

function v(text?: string | null) {
  return (text ?? '').trim();
}

function setInk(doc: Doc, rgb = INK) {
  doc.setTextColor(...rgb);
}

function parseDate(iso: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
  if (!m) {
    const now = new Date();
    return {
      day: String(now.getDate()),
      month: String(now.getMonth() + 1).padStart(2, '0'),
      year: String(now.getFullYear()),
      short: `${String(now.getDate()).padStart(2, '0')}-${String(now.getMonth() + 1).padStart(2, '0')}-${now.getFullYear()}`,
    };
  }
  return {
    day: String(Number(m[3])),
    month: m[2],
    year: m[1],
    short: `${m[3]}-${m[2]}-${m[1]}`,
  };
}

function officeByPlan(planKind: string) {
  if (String(planKind || '').toUpperCase() === 'PARQUE') {
    return {
      phone: '667 716 5939',
      address:
        'DOMINGO RUBI # 836 COL. GUADALUPE, CULIACÁN, SINALOA CP: 80220',
    };
  }
  return {
    phone: '667 716 5930',
    address:
      'BLVD. EMILIANO ZAPATA PTE #145 COL. GUADALUPE CULIACÁN, SINALOA CP: 80220',
  };
}

function cityLine(form: SaleFormData) {
  const branch = v(form.meta.branchName);
  if (!branch) return 'Culiacán, Sinaloa';
  if (/sinaloa/i.test(branch)) return branch;
  return `${branch}, Sinaloa`;
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

function drawWrapped(
  doc: Doc,
  text: string,
  x: number,
  y: number,
  maxW: number,
  lineH: number,
) {
  const lines = doc.splitTextToSize(text, maxW) as string[];
  doc.text(lines, x, y);
  return y + lines.length * lineH;
}

export function isDraftExclusionesLetter(
  form: SaleFormData,
  opts?: ExclusionesLetterOpts,
): boolean {
  const status = String(opts?.status || '').toUpperCase();
  if (status === 'COMPLETED' || status === 'SUBMITTED') return false;
  return !form.documentos?.firmaCliente?.dataBase64?.trim();
}

function drawDraftWatermark(doc: Doc) {
  const ys = [PAGE_H * 0.28, PAGE_H * 0.52, PAGE_H * 0.76];
  doc.saveGraphicsState();
  doc.setGState(new doc.GState({ opacity: 0.11 }));
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(72);
  doc.setTextColor(130, 138, 146);
  for (const y of ys) {
    doc.text('BORRADOR', PAGE_W / 2, y, {
      align: 'center',
      baseline: 'middle',
      angle: 32,
    });
  }
  doc.restoreGraphicsState();
}

function contractNumber(form: SaleFormData, opts?: ExclusionesLetterOpts) {
  return (
    realContrato(form.meta.contrato) ||
    v(form.meta.folioSolicitud) ||
    (opts?.saleId ? String(opts.saleId) : '')
  );
}

function drawLetter(
  doc: Doc,
  form: SaleFormData,
  logo: LogoAsset | null,
  opts?: ExclusionesLetterOpts,
) {
  const date = parseDate(form.meta.fecha);
  const office = officeByPlan(form.ubicacionPlan.planKind);
  const cliente = fullName(form.contacto);
  const contrato = contractNumber(form, opts);

  if (logo) {
    const logoH = 42;
    const logoW = (logo.width / logo.height) * logoH;
    doc.addImage(logo.dataUrl, 'PNG', PAGE_W - MR - logoW, 16, logoW, logoH);
  }

  let y = 26;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  setInk(doc);
  doc.text(`FECHA IMPRESIÓN: ${date.short}`, ML, y);
  y += 12;
  doc.text('SOLICITUD DE SERVICIOS', ML, y);
  y += 12;
  doc.setFont('helvetica', 'normal');
  doc.text('ANEXO "A" DEL CONTRATO', ML, y);
  y += 12;
  doc.setFont('helvetica', 'bold');
  doc.text(`TELEFONOS: ${office.phone}`, ML, y);
  doc.setFont('helvetica', 'normal');
  doc.text('N° CONTRATO:', 360, y);
  if (contrato) {
    doc.setFont('helvetica', 'bold');
    doc.text(contrato, 440, y, { maxWidth: 118 });
  }
  y += 12;
  const addr = doc.splitTextToSize(
    `OFICINAS CORPORATIVAS: ${office.address}`,
    CONTENT_W - 130,
  ) as string[];
  doc.text(addr, ML, y);
  y += addr.length * 11 + 10;

  doc.setDrawColor(...GOLD);
  doc.setLineWidth(1.4);
  doc.line(ML, y, PAGE_W - MR, y);

  y += 36;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  setInk(doc);
  doc.text('GRUPO SAN MARTÍN', PAGE_W / 2, y, { align: 'center' });
  y += 18;
  doc.text('CARTA DE ACEPTACIÓN DE EXCLUSIONES', PAGE_W / 2, y, {
    align: 'center',
  });
  y += 18;
  doc.text('CONTRATO DE PLAN DE PREVISIÓN', PAGE_W / 2, y, {
    align: 'center',
  });

  y += 16;
  doc.setDrawColor(...LINE);
  doc.setLineWidth(0.7);
  doc.line(ML + 40, y, PAGE_W - MR - 40, y);

  y += 28;
  doc.setFontSize(12);
  doc.text('EXCLUSIONES CONTRACTUALES', PAGE_W / 2, y, { align: 'center' });

  y += 24;
  doc.setFontSize(10.5);
  doc.text('1. Fallecimiento por suicidio.', ML, y);
  y += 16;
  doc.setFont('helvetica', 'normal');
  y = drawWrapped(
    doc,
    'En caso de que el fallecimiento del titular ocurra por suicidio, dentro de los primeros dos años contados desde la fecha de vigencia del contrato, Grupo San Martín devolverá únicamente el valor de los pagos realizados hasta la fecha del fallecimiento. En consecuencia, quedará liberada de cualquier otra obligación relacionada con este contrato.',
    ML,
    y,
    CONTENT_W,
    14.5,
  );

  y += 16;
  doc.setFont('helvetica', 'bold');
  doc.text('2. Utilización anticipada del plan.', ML, y);
  y += 16;
  doc.setFont('helvetica', 'normal');
  y = drawWrapped(
    doc,
    'Si el beneficiario requiere utilizar los servicios contratados dentro de los primeros 90 (noventa) días naturales desde la fecha de contratación, deberá liquidar el importe total del plan contratado al precio vigente en el esquema de Necesidad Inmediata.',
    ML,
    y,
    CONTENT_W,
    14.5,
  );

  y += 16;
  doc.setFont('helvetica', 'bold');
  doc.text('3. Cobertura en caso de accidente o infarto.', ML, y);
  y += 16;
  doc.setFont('helvetica', 'normal');
  y = drawWrapped(
    doc,
    'Para efectos de la cobertura por muerte accidental, se entenderá como accidente cualquier evento externo, súbito, violento y fortuito que ocasione la muerte del beneficiario. En estos casos, no aplicarán las exclusiones previamente mencionadas, y será necesario únicamente liquidar el saldo pendiente del plan contratado al precio de contado.',
    ML,
    y,
    CONTENT_W,
    14.5,
  );

  y += 18;
  doc.setDrawColor(...LINE);
  doc.setLineWidth(0.7);
  doc.line(ML + 40, y, PAGE_W - MR - 40, y);
  y += 22;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  setInk(doc);
  doc.text('CONDICIONES GENERALES.', PAGE_W / 2, y, { align: 'center' });
  y += 18;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10.5);
  y = drawWrapped(
    doc,
    'Al firmar este documento, acepto los términos y exclusiones señalados, entendiendo plenamente mis derechos y obligaciones derivados del contrato. Asimismo, me comprometo a firmar la documentación pertinente una vez que finalice la contingencia actual.',
    ML,
    y,
    CONTENT_W,
    14.5,
  );

  y += 18;
  doc.setDrawColor(...LINE);
  doc.line(ML + 40, y, PAGE_W - MR - 40, y);

  y += 28;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  setInk(doc);
  doc.text(`Ciudad: ${cityLine(form)}`, PAGE_W / 2, y, { align: 'center' });
  y += 18;
  doc.text(
    `Fecha: ${date.day} de ${date.month} del año ${date.year}`,
    PAGE_W / 2,
    y,
    { align: 'center' },
  );

  y += 36;
  const firma = form.documentos.firmaCliente;
  if (firma?.dataBase64?.trim()) {
    const dataUrl = firma.dataBase64.startsWith('data:')
      ? firma.dataBase64
      : `data:${firma.mime || 'image/png'};base64,${firma.dataBase64}`;
    try {
      doc.addImage(dataUrl, 'PNG', PAGE_W / 2 - 70, y - 8, 140, 42);
    } catch {
      /* ignore */
    }
    y += 38;
  }

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10.5);
  const nameLabel = cliente
    ? `Nombre y firma del cliente: ${cliente}`
    : 'Nombre y firma del cliente: ____________________________________________';
  doc.text(nameLabel, PAGE_W / 2, y, { align: 'center' });
  if (cliente) {
    const nw = Math.min(doc.getTextWidth(nameLabel), CONTENT_W);
    doc.setDrawColor(...LINE);
    doc.setLineWidth(0.5);
    doc.line(PAGE_W / 2 - nw / 2, y + 4, PAGE_W / 2 + nw / 2, y + 4);
  }
}

export async function buildExclusionesLetterPdf(
  form: SaleFormData,
  opts?: ExclusionesLetterOpts,
): Promise<Blob> {
  const doc = new jsPDF({
    unit: 'pt',
    format: 'letter',
    compress: true,
  });
  const logo = await loadHeaderLogo();
  drawLetter(doc, form, logo, opts);
  if (isDraftExclusionesLetter(form, opts)) {
    drawDraftWatermark(doc);
  }
  return doc.output('blob');
}

export async function buildExclusionesLetterBundle(
  form: SaleFormData,
  opts?: ExclusionesLetterOpts,
): Promise<{ blob: Blob; pages: string[] }> {
  const blob = await buildExclusionesLetterPdf(form, opts);
  const { renderPdfToPageImages } = await import('./pdf-page-renderer');
  try {
    const pages = await renderPdfToPageImages(blob);
    return { blob, pages };
  } catch {
    return { blob, pages: [] };
  }
}
