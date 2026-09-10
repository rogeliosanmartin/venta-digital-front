import { jsPDF } from 'jspdf';
import { fullName, realContrato, type SaleFormData } from '../types/sale-form';
import {
  formatMoneyDisplay,
  normalizeFrequency,
} from './sale-finance';
import { resolveConvenioLetter } from './convenio-letter';
import { convenioLogoUrl } from './convenio-logo-urls';

const PAGE_W = 612.28;
const PAGE_H = 792;
const ML = 54;
const MR = 54;
const INK: [number, number, number] = [20, 22, 24];
const LINE: [number, number, number] = [40, 42, 46];
const CONTENT_W = PAGE_W - ML - MR;
const COMPANY_LOGO_H = 64;
const SM_LOGO_H = 58;
const SM_FILE = 'sanmartin.png';

type LogoAsset = {
  dataUrl: string;
  width: number;
  height: number;
  format: 'JPEG' | 'PNG';
};
type Doc = jsPDF;
export type ConvenioLetterOpts = { saleId?: number | null; status?: string };

const MONTHS = [
  'ENERO',
  'FEBRERO',
  'MARZO',
  'ABRIL',
  'MAYO',
  'JUNIO',
  'JULIO',
  'AGOSTO',
  'SEPTIEMBRE',
  'OCTUBRE',
  'NOVIEMBRE',
  'DICIEMBRE',
];

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
      month: MONTHS[now.getMonth()] || '',
      year: String(now.getFullYear()),
    };
  }
  return {
    day: String(Number(m[3])),
    month: MONTHS[Number(m[2]) - 1] || '',
    year: m[1],
  };
}

function loadLogo(src: string): Promise<LogoAsset | null> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: LogoAsset | null) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      resolve(value);
    };
    const timer = window.setTimeout(() => finish(null), 8000);
    const img = new Image();
    img.decoding = 'sync';
    img.onload = () => {
      try {
        const width = Math.max(1, img.naturalWidth || 1);
        const height = Math.max(1, img.naturalHeight || 1);
        const maxSide = 720;
        const scale = Math.min(1, maxSide / Math.max(width, height));
        const cw = Math.max(1, Math.round(width * scale));
        const ch = Math.max(1, Math.round(height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = cw;
        canvas.height = ch;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          finish(null);
          return;
        }
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, cw, ch);
        ctx.drawImage(img, 0, 0, cw, ch);
        finish({
          dataUrl: canvas.toDataURL('image/jpeg', 0.9),
          width: cw,
          height: ch,
          format: 'JPEG',
        });
      } catch {
        finish(null);
      }
    };
    img.onerror = () => finish(null);
    img.src = src;
  });
}

async function loadLogoFile(file: string): Promise<LogoAsset | null> {
  const bundled = convenioLogoUrl(file);
  if (bundled) {
    const fromBundle = await loadLogo(bundled);
    if (fromBundle) return fromBundle;
  }
  return loadLogo(`/forms/convenio/${file}`);
}

async function loadCompanyLogos(files?: string[]): Promise<LogoAsset[]> {
  if (!files?.length) return [];
  const loaded = await Promise.all(files.map((file) => loadLogoFile(file)));
  return loaded.filter((item): item is LogoAsset => Boolean(item));
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

function frequencyPhrase(form: SaleFormData, hint?: string) {
  const code = normalizeFrequency(form.pago.frecuencia);
  if (code === 'SEMANAL') return 'SEMANAL';
  if (code === 'QUINCENAL') return 'QUINCENAL';
  if (code === 'MENSUAL') return 'MENSUAL';
  const raw = v(form.pago.frecuencia).toUpperCase();
  if (raw) return raw;
  return hint || 'SEMANAL O QUINCENAL';
}

function contractNumber(form: SaleFormData, opts?: ConvenioLetterOpts) {
  return (
    realContrato(form.meta.contrato) ||
    v(form.meta.folioSolicitud) ||
    (opts?.saleId ? String(opts.saleId) : '')
  );
}

export function isDraftConvenioLetter(
  form: SaleFormData,
  opts?: ConvenioLetterOpts,
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

function drawImageFit(
  doc: Doc,
  logo: LogoAsset,
  x: number,
  y: number,
  maxW: number,
  maxH: number,
) {
  const scale = Math.min(maxW / logo.width, maxH / logo.height);
  const w = Math.max(1, logo.width * scale);
  const h = Math.max(1, logo.height * scale);
  try {
    doc.addImage(
      logo.dataUrl,
      logo.format,
      x,
      y + (maxH - h) / 2,
      w,
      h,
      undefined,
      'NONE',
    );
  } catch {
    /* logo inválido: la carta sigue sin él */
  }
  return w;
}

function drawLetter(
  doc: Doc,
  form: SaleFormData,
  companyLogos: LogoAsset[],
  smLogo: LogoAsset | null,
  opts?: ConvenioLetterOpts,
) {
  const spec = resolveConvenioLetter(form);
  if (!spec) {
    throw new Error('Falta la empresa de convenio');
  }
  const date = parseDate(form.meta.fecha);
  const contrato = contractNumber(form, opts);
  const apoderado =
    v(form.pago.nombreAsesor) || v(form.pago.nombreJefeVentas);
  const plan =
    v(form.ubicacionPlan.nombrePlan) ||
    (form.ubicacionPlan.planKind === 'PARQUE'
      ? 'PLAN PARQUE'
      : 'SERVICIO FUNERARIO');
  const total =
    formatMoneyDisplay(form.pago.precioPlan) ||
    formatMoneyDisplay(form.ubicacionPlan.precioPlan);
  const plazo = v(form.pago.plazo);
  const cuota = formatMoneyDisplay(form.pago.importeCadaPago);
  const freq = frequencyPhrase(form, spec.frequencyHint);
  const otorgante = v(form.pago.nombreEmpleado) || fullName(form.contacto);
  const empleado = v(form.pago.numeroEmpleado);
  const centro = v(form.pago.infoNomina) || spec.addressee;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  setInk(doc);
  doc.text('FO-GEN-SMGF-05', PAGE_W - MR, 16, { align: 'right' });

  const headerTop = 22;
  let x = ML;
  const smReserve = 128;
  const companyMaxW = PAGE_W - ML - MR - smReserve;
  const eachMaxW = companyLogos.length
    ? Math.min(170, (companyMaxW - (companyLogos.length - 1) * 8) / companyLogos.length)
    : 0;
  for (const logo of companyLogos) {
    const w = drawImageFit(doc, logo, x, headerTop, eachMaxW, COMPANY_LOGO_H);
    x += w + 8;
  }
  if (smLogo) {
    drawImageFit(
      doc,
      smLogo,
      PAGE_W - MR - 118,
      headerTop,
      118,
      SM_LOGO_H,
    );
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text('N° CONTRATO:', 360, 98);
  if (contrato) {
    doc.text(contrato, 440, 98, { maxWidth: 118 });
  }

  let y = 122;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.text('CARTA DE CONSENTIMIENTO', PAGE_W / 2, y, { align: 'center' });

  y += 28;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  doc.text(
    `CULIACÁN, SINALOA, A ${date.day} DE ${date.month} DEL ${date.year}.`,
    ML,
    y,
  );

  y += 28;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  y = drawWrapped(doc, spec.addressee.toUpperCase(), ML, y, CONTENT_W, 14);

  if (spec.attention) {
    y += 6;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    y = drawWrapped(
      doc,
      `AT'N: ${spec.attention.toUpperCase()}`,
      ML,
      y,
      CONTENT_W,
      13,
    );
  }

  y += 16;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('P R E S E N T E.-', ML, y);

  y += 22;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10.5);
  const grant = apoderado || '___________________________________';
  const body =
    `POR MEDIO DE LA PRESENTE OTORGO A ${grant} PODER AMPLIO, CUMPLIDO Y BASTANTE ` +
    `PARA QUE A MI NOMBRE Y REPRESENTACIÓN TRAMITE LA CERTIFICACIÓN DE CREDITO Y ` +
    `RECOJA LA DOCUMENTACIÓN NECESARIA ANTE LAS DEPENDENCIAS CORRESPONDIENTES, ` +
    `PARA QUE PIDA A MI NOMBRE UN VALE POR LA ADQUISICIÓN DE ${plan.toUpperCase()} ` +
    `POR LA CANTIDAD DE ${total || '___________________________'} LA CUAL ME SERÁ ` +
    `DESCONTADA EN ${plazo || '_____'} PAGOS DE FORMA ${freq}` +
    `${cuota ? ` DE ${cuota}` : ''}. HAGO ENTREGA DE MI ÚLTIMO COMPROBANTE DE PAGO, ` +
    `MISMOS QUE SERÁN DEVUELTOS AL TÉRMINO DE LAS GESTIONES RESPECTIVAS, EN ` +
    `CONOCIMIENTO QUE AL CUMPLIR CON LO SEÑALADO NO SERÁ DEVUELTO EL IMPORTE.`;
  y = drawWrapped(doc, body, ML, y, CONTENT_W, 14.5);

  y += 36;
  const colW = (CONTENT_W - 24) / 2;
  const leftX = ML;
  const rightX = ML + colW + 24;
  const firma = form.documentos.firmaCliente;
  if (firma?.dataBase64?.trim()) {
    const dataUrl = firma.dataBase64.startsWith('data:')
      ? firma.dataBase64
      : `data:${firma.mime || 'image/png'};base64,${firma.dataBase64}`;
    try {
      doc.addImage(dataUrl, 'PNG', leftX + 24, y - 8, 140, 42);
    } catch {
      /* ignore */
    }
  }

  doc.setDrawColor(...LINE);
  doc.setLineWidth(0.6);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  setInk(doc);
  doc.text('OTORGANTE', leftX + colW / 2, y + 48, { align: 'center' });
  doc.text('ACEPTO EL PODER', rightX + colW / 2, y + 48, { align: 'center' });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  const nameY = y + 78;
  doc.line(leftX, nameY, leftX + colW, nameY);
  doc.line(rightX, nameY, rightX + colW, nameY);
  doc.text(`NOMBRE: ${otorgante || ''}`, leftX, nameY + 14, { maxWidth: colW });
  doc.text(
    `NOMBRE: ${apoderado || ''}`,
    rightX,
    nameY + 14,
    { maxWidth: colW },
  );
  doc.text(`No. EMPLEADO: ${empleado || ''}`, leftX, nameY + 30, {
    maxWidth: colW,
  });
  doc.text(`CENTRO DE TRABAJO: ${centro}`, leftX, nameY + 46, {
    maxWidth: colW,
  });
}

export async function buildConvenioLetterPdf(
  form: SaleFormData,
  opts?: ConvenioLetterOpts,
): Promise<Blob> {
  const doc = new jsPDF({
    unit: 'pt',
    format: 'letter',
    compress: true,
  });
  const spec = resolveConvenioLetter(form);
  if (!spec) {
    throw new Error('Falta la empresa de convenio');
  }
  const companyLogos = await loadCompanyLogos(spec.logoFiles);
  const smLogo = await loadLogoFile(SM_FILE);
  drawLetter(doc, form, companyLogos, smLogo, opts);
  try {
    if (isDraftConvenioLetter(form, opts)) {
      drawDraftWatermark(doc);
    }
  } catch {
    /* la marca de agua no debe bloquear la carta */
  }
  return doc.output('blob');
}

export async function buildConvenioLetterBundle(
  form: SaleFormData,
  opts?: ConvenioLetterOpts,
): Promise<{ blob: Blob; pages: string[] }> {
  const blob = await buildConvenioLetterPdf(form, opts);
  try {
    const { renderPdfToPageImages } = await import('./pdf-page-renderer');
    const pages = await renderPdfToPageImages(blob);
    return { blob, pages };
  } catch {
    return { blob, pages: [] };
  }
}
