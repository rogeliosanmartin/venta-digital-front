import { jsPDF } from 'jspdf';
import { formatDigitalFolio, fullName, type SaleFormData } from '../types/sale-form';
import {
  paymentDueAmount,
  paymentDueConcepts,
  formatMoneyDisplay,
} from './sale-finance';

const PAGE_W = 226;
const PAGE_H = 520;
const M = 14;
const INK: [number, number, number] = [20, 24, 28];
const MUTED: [number, number, number] = [90, 96, 102];

function v(t: string | null | undefined) {
  return (t ?? '').trim();
}

function money(raw: string) {
  return formatMoneyDisplay(raw) || '—';
}

function dashLine(doc: jsPDF, y: number) {
  doc.setDrawColor(...MUTED);
  doc.setLineWidth(0.6);
  doc.setLineDashPattern([1.2, 1.4], 0);
  doc.line(M, y, PAGE_W - M, y);
  doc.setLineDashPattern([], 0);
}

function starLine(doc: jsPDF, y: number) {
  doc.setFont('courier', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(...MUTED);
  doc.text('*'.repeat(34), PAGE_W / 2, y, { align: 'center' });
}

function kv(doc: jsPDF, label: string, value: string, y: number): number {
  const maxW = PAGE_W - M * 2;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(...MUTED);
  doc.text(label.toUpperCase(), M, y);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...INK);
  const lines = doc.splitTextToSize(v(value) || '—', maxW);
  doc.text(lines, M, y + 11);
  return y + 11 + Math.max(1, lines.length) * 10 + 4;
}

function kvInline(doc: jsPDF, label: string, value: string, y: number): number {
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(...MUTED);
  doc.text(label, M, y);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...INK);
  doc.text(v(value) || '—', PAGE_W - M, y, { align: 'right' });
  return y + 13;
}

/** Carga SVG/PNG y lo convierte a PNG data URL para jsPDF. */
function loadImageAsPng(
  src: string,
): Promise<{ dataUrl: string; width: number; height: number } | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const w = img.naturalWidth || 228;
      const h = img.naturalHeight || 104;
      const canvas = document.createElement('canvas');
      const scale = 2;
      canvas.width = w * scale;
      canvas.height = h * scale;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(null);
        return;
      }
      ctx.scale(scale, scale);
      // Un poco menos opaco para que no se vea tan fuerte en el ticket
      ctx.globalAlpha = 0.82;
      ctx.drawImage(img, 0, 0, w, h);
      resolve({
        dataUrl: canvas.toDataURL('image/png'),
        width: w,
        height: h,
      });
    };
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/**
 * Ticket de pago: logo, cliente, asesor y datos del modal de pago.
 */
export async function buildPaymentTicketPdf(
  form: SaleFormData,
  opts: { saleId: number; sellerName?: string },
): Promise<Blob> {
  const doc = new jsPDF({
    unit: 'pt',
    format: [PAGE_W, PAGE_H],
    compress: true,
  });

  const p = form.pago;
  const c = form.contacto;
  const cliente = fullName(c) || '—';
  const celular = v(c.celular1) || v(c.celular2) || '—';
  const folio =
    formatDigitalFolio(form.meta.folioSolicitud || opts.saleId);
  const asesor = v(p.nombreAsesor) || v(opts.sellerName) || '—';
  const now = new Date();
  const emitted = `${String(now.getDate()).padStart(2, '0')}/${String(
    now.getMonth() + 1,
  ).padStart(2, '0')}/${now.getFullYear()} ${String(now.getHours()).padStart(
    2,
    '0',
  )}:${String(now.getMinutes()).padStart(2, '0')}`;

  let y = 16;

  const logo = await loadImageAsPng('/logo-gsm-azul.svg');
  if (logo) {
    const logoH = 36;
    const logoW = Math.min(
      PAGE_W - M * 2,
      (logo.width / logo.height) * logoH,
    );
    doc.addImage(
      logo.dataUrl,
      'PNG',
      (PAGE_W - logoW) / 2,
      y,
      logoW,
      logoH,
    );
    y += logoH + 10;
  } else {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(...INK);
    doc.text('GRUPO SAN MARTÍN', PAGE_W / 2, y + 10, { align: 'center' });
    y += 22;
  }

  starLine(doc, y);
  y += 14;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(...INK);
  doc.text('TICKET DE PAGO', PAGE_W / 2, y, { align: 'center' });
  y += 12;
  doc.setFont('courier', 'bold');
  doc.setFontSize(10);
  doc.text(`FOLIO ${folio}`, PAGE_W / 2, y, { align: 'center' });
  y += 10;
  dashLine(doc, y);
  y += 16;

  y = kv(doc, 'Cliente', cliente, y);
  y = kvInline(doc, 'Celular', celular, y);

  y += 2;
  dashLine(doc, y);
  y += 14;

  const concepts = paymentDueConcepts(p);
  const due = paymentDueAmount(p);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(...MUTED);
  doc.text('CONCEPTOS', PAGE_W / 2, y, { align: 'center' });
  y += 14;

  if (!concepts.length) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.setTextColor(...INK);
    doc.text(money(String(due)), PAGE_W / 2, y, { align: 'center' });
    y += 14;
  } else {
    for (const item of concepts) {
      y = kvInline(doc, item.label, money(String(item.amount)), y);
    }
    if (concepts.length > 1) {
      y += 2;
      dashLine(doc, y);
      y += 14;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(...MUTED);
      doc.text('TOTAL', M, y);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(12);
      doc.setTextColor(...INK);
      doc.text(money(String(due)), PAGE_W - M, y, { align: 'right' });
      y += 14;
    }
  }
  dashLine(doc, y);
  y += 14;

  const forma = v(p.formaPago).toUpperCase();
  const formaLabel =
    forma === 'TARJETA DEBITO'
      ? 'TARJETA DÉBITO'
      : forma === 'TARJETA CREDITO'
        ? 'TARJETA CRÉDITO'
        : p.formaPago || '—';
  y = kvInline(doc, 'Forma de pago', formaLabel, y);
  const isCash = forma === 'EFECTIVO';
  if (isCash) {
    y = kvInline(doc, 'Recibido', money(p.montoRecibido), y);
    y = kvInline(doc, 'Cambio', money(p.cambio), y);
  } else {
    y = kvInline(doc, 'Cuenta', p.cuentaPago || p.cuenta || '—', y);
    y = kvInline(doc, 'Banco', p.bancoPago || p.banco || '—', y);
  }

  y += 2;
  dashLine(doc, y);
  y += 14;

  y = kv(doc, 'Asesor', asesor, y);
  y = kv(doc, 'Jefe de ventas', p.nombreJefeVentas || '—', y);

  y += 4;
  starLine(doc, y);
  y += 14;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(...MUTED);
  doc.text('Comprobante interno de pago', PAGE_W / 2, y, { align: 'center' });
  y += 10;
  doc.text(`Venta #${opts.saleId} · ${emitted}`, PAGE_W / 2, y, {
    align: 'center',
  });
  y += 14;
  starLine(doc, y);

  return doc.output('blob');
}
