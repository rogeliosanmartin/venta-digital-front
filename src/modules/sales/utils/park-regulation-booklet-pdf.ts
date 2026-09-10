import { jsPDF } from 'jspdf';
import { fullName, realContrato, type SaleFormData } from '../types/sale-form';
import {
  isDraftParkRegulation,
  type ParkRegulationOpts,
} from './park-regulation-pdf';

/**
 * Interior: 4 páginas carta vertical (márgenes del Anexo A).
 * Salida: 2 hojas carta apaisadas, 2 páginas por hoja (folleto).
 */
const LETTER_W = 612;
const LETTER_H = 792;
const SHEET_W = 792;
const SHEET_H = 612;
const SLOT_W = SHEET_W / 2;
/** 7 mm del paperformat de anexo. */
const PAPER_M = 20;
/** Bloque al 90% del ancho útil, como el QWeb. */
const CONTENT_W = (LETTER_W - PAPER_M * 2) * 0.9;
const CONTENT_X = (LETTER_W - CONTENT_W) / 2;
const INK: [number, number, number] = [20, 22, 24];
const TEAL: [number, number, number] = [52, 101, 127];
const GOLD: [number, number, number] = [212, 179, 138];
const LOGO: [number, number, number] = [74, 84, 94];

type Doc = jsPDF;
type LogoAsset = { dataUrl: string; width: number; height: number };

const ARTICLES_P1 = [
  'Artículo 1.- Las disposiciones contenidas en este reglamento son de observancia general para todos los usuarios de los Parques Funerales San Martín. La vigilancia de su cumplimiento queda a cargo de la administración de la empresa, siendo los titulares de derechos de uso perpetuo de criptas, nichos para urnas, gavetas y osarios o fosas para inhumación, sus familiares y visitantes en general, quienes se someten libre y voluntariamente al presente documento.',
  'Artículo 2.- San Martín Grupo Desarrollador Inmobiliario S.A. de C.V., en su carácter de titular de la concesión para la explotación del Parque Funeral, será la encargada de la administración del Parque Funeral San Martín.',
  'Artículo 3.- La concesionaria será la única encargada y responsable de prestar, por sí o por terceras personas, bajo su responsabilidad, todos los servicios inherentes a la inhumación, exhumación y cremación de cadáveres humanos y al depósito de restos humanos en el Parque Funeral concesionado, así como los servicios complementarios de preparación del funeral, sepelio y de prestar los elementos o accesorios necesarios, de acuerdo al contrato celebrado con el titular de los derechos de uso o sus beneficiarios, y en todo caso con cargo por cuenta de éstos.',
  'Artículo 4.- La concesionaria, además, prestará todos los servicios de mantenimiento del perímetro del Parque Funeral San Martín, incluyendo el cuidado, la conservación y aseo de fosas, criptas, osarios, nichos, edificios, caminos, jardines y parques, así como la vigilancia de todo el parque funerario bajo su responsabilidad y con cargo a las cuotas de mantenimiento que deben pagar los titulares de derechos de uso, de acuerdo al contrato correspondiente.',
  'Artículo 5.- La concesionaria se responsabiliza de todas las actividades y servicios a que se refiere el artículo anterior, que preste directamente o por mediación de las compañías y personas con las que se contrate una o más de estas actividades y servicios.',
  'Artículo 6.- La administración del Parque Funeral San Martín cuenta con los recursos humanos y materiales necesarios para la eficiente prestación de los servicios a que se halla obligada.',
  'Artículo 7.- La administración del Parque Funeral San Martín deberá de mantener un mínimo de 10 fosas preparadas y disponibles para la inhumación de cadáveres humanos. En caso de fuerza mayor, el H. Ayuntamiento o las autoridades de salud podrán ordenar la preparación del número de fosas necesarias.',
  'Artículo 8.- La inhumación de cadáveres humanos y el depósito de restos humanos deberán realizarse precisamente dentro del área o sección del Parque Funeral San Martín que se señale en el contrato respectivo. Cuando esto no sea posible por caso fortuito o fuerza mayor, la administración del Parque Funeral San Martín proporcionará al titular de derechos de uso o a sus beneficiarios otro lugar de las mismas características, dentro de la misma área o sección.',
  'Artículo 9.- La concesionaria es la única autorizada para fabricar placas y accesorios que, dentro de los 20 días siguientes al servicio y de acuerdo al contrato respectivo, dotará una placa de mármol a cada fosa, cripta, osario o nicho. Además, colocará en cada lugar un recipiente movible para la colocación de flores. La placa y los floreros no deberán ser obstáculo para el cuidado y la conservación de los parques y jardines.',
  'Artículo 10.- El Parque Funeral San Martín permanecerá abierto diariamente al público de las 8:00 a las 18:00 horas y dentro de este horario se iniciarán y terminarán todos los servicios programados, por lo que los visitantes deberán desalojar las instalaciones a más tardar a las 18:00 horas.',
];

const ARTICLES_P2 = [
  'Artículo 11.- Los vehículos de motor cuya entrada al Parque Funeral San Martín sea permitida por la administración deberán circular a una velocidad máxima de 10 km/h. La empresa no se hace responsable por accidentes, daños y robos totales o parciales en los que dichos vehículos se involucren; así como tampoco por objetos de valor dejados en su interior.',
  'Artículo 12.- Los vehículos de motor únicamente deberán ser estacionados en los lugares destinados específicamente para ello y sus conductores deberán sujetarse estrictamente a los señalamientos interiores de tránsito; siendo además responsables por daños ocasionados a las instalaciones del parque funerario y por tanto deberán pagar por los desperfectos que llegaran a provocar.',
  'Artículo 13.- Se prohíbe la introducción y consumo de bebidas embriagantes y sustancias tóxicas o enervantes. La administración podrá impedir la entrada o estancia en Parque Funeral San Martín, a las personas que se presenten en estado inconveniente y se procederá a llamar al orden a quienes causen desórdenes en el lugar.',
  'Artículo 14.- Se prohíbe sin excepción la entrada al Parque Funeral San Martín de cualquier tipo de música, orquestas, bandas, grupos musicales, radiodifusores, altoparlantes, amplificadores o equipos de sonido dentro y fuera de los vehículos.',
  'Artículo 15.- La administración deberá llevar los libros de registro de usuarios, titulares de derechos de uso perpetuo o temporal, beneficiarios o cesionarios con la información completa y actualizada, conforme a las normas establecidas y a los acuerdos a cumplir, así como los registros de sepulturas auxiliares que estime convenientes.',
  'Artículo 16.- La concesionaria, queda obligada a cumplir estrictamente con las disposiciones consignadas en el presente documento de acuerdo al reglamento Municipal de Panteones y a la legislación Sanitaria de la Federación y del Estado.',
  'Artículo 17.- Para proceder a la inhumación de cadáveres humanos, los titulares de los derechos de uso perpetuo o sus beneficiarios deberán entregar a la administración, la documentación contractual y el pago de impuestos y derechos correspondientes.',
  'Artículo 18.- Las criptas, nichos para urnas, gavetas, osarios o fosas para inhumación, se construirán de acuerdo con el diseño del Parque Funeral San Martín y aprobadas por las autoridades correspondientes.',
  'Artículo 19.- La fosa destinada a la inhumación de un cadáver humano deberá estar preparada a más tardar el día y hora fijada para el sepelio, bajo la responsabilidad de la administración.',
  'Artículo 20.- La exhumación de cadáveres humanos sólo podrá solicitarse en caso de justificación demostrada.',
  'Artículo 21.- Para proceder a la exhumación, se hará con la autorización de la administración del Parque Funeral San Martín o en su caso, por disposición de autoridad competente.',
];

const ARTICLES_P3 = [
  'Artículo 22.- Cuando se trate de la cremación de cadáveres humanos, el interesado deberá cumplir con los requisitos legales que se refieren a la ley y se realizará de acuerdo a las disposiciones legales.',
  'Artículo 23.- Los trabajos que se realicen en las inhumaciones, exhumaciones y cremaciones de cadáveres y en depósito de restos humanos, los realizará la administración de Parque Funeral San Martín.',
  'Artículo 24.- El depósito de restos humanos en Mausoleo deberá hacerse después de haber sido embalsamado el cuerpo con las técnicas de conservación aprobadas por la secretaría de salud del gobierno federal.',
  'Artículo 25.- El cuidado, conservación, aseo, mantenimiento y vigilancia en general del Parque Funeral San Martín estará bajo la responsabilidad de la administración, con cargo a las cuotas de mantenimiento que los usuarios paguen de acuerdo al contrato respectivo.',
  'Artículo 26.- Se hará una limpieza general en períodos semestrales a los días festivos de 28 de abril y 2 de noviembre, para lo cual los titulares de los derechos de uso perpetuo, titulares sustitutos, beneficiarios o cesionarios, deberán recoger todas las flores a más tardar los días 28 de abril y 15 de octubre de cada año. Al tercer día posterior a estas fechas, se podrán colocar flores nuevas.',
];

const ARTICLES_P4_PROHIB = [
  'Artículo 27.- No podrán ser inhumados cadáveres humanos en lugares y áreas comunes de circulación dentro del Parque Funeral San Martín.',
  'Artículo 28.- Queda estrictamente prohibido la construcción y/o levantamiento de mausoleos, capillas y túmulos, así como la colocación de placas y recipientes distintos a los autorizados por la administración.',
  'Artículo 29.- Queda prohibido el establecimiento de toda clase de comercios dentro de los límites del Parque Funeral San Martín.',
  'Artículo 30.- Se prohíbe plantar, destruir o arrancar árboles y plantas de las áreas del Parque Funeral San Martín, así como cortar flores.',
];

const ARTICLES_P4_SANC = [
  'Artículo 31.- Se prohíbe la fijación de avisos, leyendas, anuncios o cualquier otra forma de propaganda, política o religiosa dentro de Parque Funeral San Martín.',
  'Artículo 32.- La violación a cualquiera de las reglas contenidas en el presente reglamento por el titular de los derechos de uso mortuorio perpetuo o temporal será motivo de la conclusión del contrato.',
];

function v(text?: string | null) {
  return (text ?? '').trim();
}

function parsePrintDate(iso: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
  if (!m) {
    const now = new Date();
    const dd = String(now.getDate()).padStart(2, '0');
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    return `${dd}-${mm}-${now.getFullYear()}`;
  }
  return `${m[3]}-${m[2]}-${m[1]}`;
}

function contractNumber(form: SaleFormData, opts?: ParkRegulationOpts) {
  return (
    realContrato(form.meta.contrato) ||
    v(form.meta.folioSolicitud) ||
    (opts?.saleId ? String(opts.saleId) : '')
  );
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

function drawOfficeHeader(doc: Doc, logo: LogoAsset | null, printDate: string) {
  const hx = PAPER_M;
  if (logo) {
    const logoH = 60;
    const logoW = (logo.width / logo.height) * logoH;
    doc.addImage(
      logo.dataUrl,
      'PNG',
      LETTER_W - PAPER_M - logoW,
      18,
      logoW,
      logoH,
    );
  }
  let y = 28;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.25);
  doc.setTextColor(...INK);
  doc.text(`FECHA IMPRESIÓN: ${printDate}`, hx, y);
  y += 11;
  doc.text('SOLICITUD DE SERVICIOS', hx, y);
  y += 11;
  doc.setFont('helvetica', 'normal');
  doc.text('ANEXO "A" DEL CONTRATO', hx, y);
  y += 11;
  doc.setFont('helvetica', 'bold');
  doc.text('TELEFONOS: 667 716 5939', hx, y);
  y += 11;
  const addr = doc.splitTextToSize(
    'OFICINAS CORPORATIVAS: DOMINGO RUBI # 836 COL. GUADALUPE, CULIACÁN, SINALOA CP:80220',
    CONTENT_W * 0.72,
  ) as string[];
  doc.text(addr, hx, y);
  return y + addr.length * 10 + 18;
}

function drawGoldTitle(doc: Doc, y: number) {
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(...GOLD);
  const label = 'REGLAMENTO PARQUE FUNERAL';
  const right = CONTENT_X + CONTENT_W;
  doc.text(label, right, y, { align: 'right' });
  const tw = doc.getTextWidth(label);
  doc.setDrawColor(...GOLD);
  doc.setLineWidth(1.5);
  doc.line(right - tw, y + 3, right, y + 3);
  return y + 18;
}

function drawArticles(doc: Doc, y: number, articles: string[]) {
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10.5);
  doc.setTextColor(...TEAL);
  for (const art of articles) {
    y = drawWrapped(doc, art, CONTENT_X, y, CONTENT_W, 13.4);
    y += 8;
  }
  return y;
}

function drawDraftWatermark(doc: Doc) {
  doc.saveGraphicsState();
  doc.setGState(new doc.GState({ opacity: 0.1 }));
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(72);
  doc.setTextColor(130, 138, 146);
  doc.text('BORRADOR', LETTER_W / 2, LETTER_H * 0.45, {
    align: 'center',
    baseline: 'middle',
    angle: 32,
  });
  doc.restoreGraphicsState();
}

function drawSectionTitle(doc: Doc, y: number, text: string) {
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(...GOLD);
  doc.text(text, CONTENT_X, y);
  return y + 16;
}

function drawPanel1(
  doc: Doc,
  form: SaleFormData,
  opts: ParkRegulationOpts | undefined,
  logo: LogoAsset | null,
  printDate: string,
) {
  let y = drawOfficeHeader(doc, logo, printDate);
  y = drawGoldTitle(doc, y);
  y += 8;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10.5);
  doc.setTextColor(...TEAL);
  const contrato = contractNumber(form, opts);
  doc.text('N° Contrato:', CONTENT_X, y);
  const labelW = doc.getTextWidth('N° Contrato: ');
  const fecha = `Fecha: ${printDate}`;
  const fechaW = doc.getTextWidth(fecha);
  const lineStart = CONTENT_X + labelW + 4;
  const lineEnd = CONTENT_X + CONTENT_W - fechaW - 10;
  doc.setDrawColor(...TEAL);
  doc.setLineWidth(0.7);
  doc.line(lineStart, y + 1, lineEnd, y + 1);
  if (contrato) {
    doc.setFont('helvetica', 'bold');
    doc.text(contrato, lineStart + 4, y);
  }
  doc.setFont('helvetica', 'normal');
  doc.text(fecha, CONTENT_X + CONTENT_W, y, { align: 'right' });
  y += 18;
  drawArticles(doc, y, ARTICLES_P1);
}

function drawLaterPageTitle(doc: Doc) {
  return drawGoldTitle(doc, 118);
}

function drawPanel2(doc: Doc) {
  const y = drawLaterPageTitle(doc);
  drawArticles(doc, y + 12, ARTICLES_P2);
}

function drawPanel3(doc: Doc) {
  const y = drawLaterPageTitle(doc);
  drawArticles(doc, y + 12, ARTICLES_P3);
}

function drawPanel4(doc: Doc, form: SaleFormData) {
  let y = drawLaterPageTitle(doc);
  y = drawSectionTitle(doc, y + 10, 'PROHIBICIONES');
  y = drawArticles(doc, y, ARTICLES_P4_PROHIB);
  y = drawSectionTitle(doc, y + 4, 'SANCIONES');
  y = drawArticles(doc, y, ARTICLES_P4_SANC);

  y = Math.max(y + 36, 560);
  const cx = LETTER_W / 2;
  doc.setDrawColor(...TEAL);
  doc.setLineWidth(0.8);
  const company = 'SAN MARTÍN GRUPO DESARROLLADOR INMOBILIARIO S.A. DE C.V.';
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10.5);
  doc.setTextColor(...TEAL);
  const companyW = Math.min(CONTENT_W * 0.7, doc.getTextWidth(company) + 8);
  doc.line(cx - companyW / 2, y, cx + companyW / 2, y);
  doc.text(company, cx, y + 14, { align: 'center' });

  const signY = y + 92;
  const firma = form.documentos.firmaCliente;
  if (firma?.dataBase64?.trim()) {
    const dataUrl = firma.dataBase64.startsWith('data:')
      ? firma.dataBase64
      : `data:${firma.mime || 'image/png'};base64,${firma.dataBase64}`;
    try {
      doc.addImage(dataUrl, 'PNG', cx - 70, signY - 50, 140, 44);
    } catch {
      /* ignore */
    }
  }
  doc.setDrawColor(...TEAL);
  doc.line(cx - 140, signY, cx + 140, signY);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10.5);
  doc.setTextColor(...TEAL);
  const cliente = fullName(form.contacto);
  if (cliente) doc.text(cliente, cx, signY - 6, { align: 'center' });
  doc.text('CLIENTE', cx, signY + 14, { align: 'center' });
}

function drawFoldLine(doc: Doc) {
  doc.setDrawColor(210, 210, 214);
  doc.setLineWidth(0.6);
  doc.setLineDashPattern([4, 4], 0);
  doc.line(SLOT_W, 18, SLOT_W, SHEET_H - 18);
  doc.setLineDashPattern([], 0);
}

function composeLandscapeBooklet(pageUrls: string[]): jsPDF {
  const doc = new jsPDF({
    unit: 'pt',
    orientation: 'landscape',
    format: 'letter',
    compress: true,
  });
  const scale = Math.min(SLOT_W / LETTER_W, SHEET_H / LETTER_H);
  const w = LETTER_W * scale;
  const h = LETTER_H * scale;
  const y = (SHEET_H - h) / 2;
  const padX = (SLOT_W - w) / 2;

  const place = (index: number, col: 0 | 1) => {
    const src = pageUrls[index];
    if (!src) return;
    const fmt = src.startsWith('data:image/png') ? 'PNG' : 'JPEG';
    doc.addImage(src, fmt, col * SLOT_W + padX, y, w, h, undefined, 'FAST');
  };

  place(0, 0);
  place(1, 1);
  drawFoldLine(doc);
  doc.addPage('letter', 'landscape');
  place(2, 0);
  place(3, 1);
  drawFoldLine(doc);
  return doc;
}

async function buildPortraitPages(
  form: SaleFormData,
  opts?: ParkRegulationOpts,
): Promise<Blob> {
  const doc = new jsPDF({
    unit: 'pt',
    orientation: 'portrait',
    format: 'letter',
    compress: true,
  });
  const logo = await loadHeaderLogo();
  const printDate = parsePrintDate(form.meta.fecha);
  const draft = isDraftParkRegulation(form, opts);

  drawPanel1(doc, form, opts, logo, printDate);
  if (draft) drawDraftWatermark(doc);

  doc.addPage('letter', 'portrait');
  drawPanel2(doc);
  if (draft) drawDraftWatermark(doc);

  doc.addPage('letter', 'portrait');
  drawPanel3(doc);
  if (draft) drawDraftWatermark(doc);

  doc.addPage('letter', 'portrait');
  drawPanel4(doc, form);
  if (draft) drawDraftWatermark(doc);

  return doc.output('blob');
}

export async function buildParkRegulationBookletPdf(
  form: SaleFormData,
  opts?: ParkRegulationOpts,
): Promise<Blob> {
  const portrait = await buildPortraitPages(form, opts);
  const { renderPdfToPageImages } = await import('./pdf-page-renderer');
  const faces = await renderPdfToPageImages(portrait, { scale: 2 });
  if (faces.length < 4) return portrait;
  return composeLandscapeBooklet(faces).output('blob');
}

export async function buildParkRegulationBookletBundle(
  form: SaleFormData,
  opts?: ParkRegulationOpts,
): Promise<{ blob: Blob; pages: string[] }> {
  const blob = await buildParkRegulationBookletPdf(form, opts);
  const { renderPdfToPageImages } = await import('./pdf-page-renderer');
  try {
    const pages = await renderPdfToPageImages(blob);
    return { blob, pages };
  } catch {
    return { blob, pages: [] };
  }
}
