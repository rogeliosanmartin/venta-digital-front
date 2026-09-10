import type { SaleAttachment, SaleFormData } from '../types/sale-form';

export type AttachmentKind =
  | 'ineFrente'
  | 'ineReverso'
  | 'inePdf'
  | 'comprobanteDomicilio'
  | 'constanciaSituacionFiscal'
  | 'tarjetaFrente'
  | 'tarjetaReverso'
  | 'tarjetaPdf'
  | 'reciboNomina'
  | 'domiciliacionBanorte'
  | 'ticketPago'
  | 'comprobanteTransferencia'
  | 'firmaCliente'
  | 'caratulaPdf'
  | 'cartaFacturaPdf'
  | 'cartaNoFacturaPdf'
  | 'cartaExclusionesPdf'
  | 'reglamentoParquePdf'
  | 'reglamentoParqueFolletoPdf'
  | 'cartaAutorizacionPdf'
  | 'cartaNominaPdf';

export type AttachmentListItem = {
  kind: AttachmentKind;
  label: string;
  attachment: SaleAttachment;
};

const LABELS: Record<AttachmentKind, string> = {
  ineFrente: 'INE (frente)',
  ineReverso: 'INE (reverso)',
  inePdf: 'INE (ambos lados)',
  comprobanteDomicilio: 'Comprobante de domicilio',
  constanciaSituacionFiscal: 'Constancia de situación fiscal',
  tarjetaFrente: 'Tarjeta (frente)',
  tarjetaReverso: 'Tarjeta (reverso)',
  tarjetaPdf: 'Tarjeta (ambos lados)',
  reciboNomina: 'Recibo de nómina más actual',
  domiciliacionBanorte: 'Documento de domiciliación Banorte',
  ticketPago: 'Ticket de pago',
  comprobanteTransferencia: 'Comprobante de transferencia',
  firmaCliente: 'Firma del cliente',
  caratulaPdf: 'Carátula del contrato',
  cartaFacturaPdf: 'Carta de requerimiento de factura',
  cartaNoFacturaPdf: 'Consentimiento de no factura',
  cartaExclusionesPdf: 'Carta de aceptación de exclusiones',
  reglamentoParquePdf: 'Reglamento de parque',
  reglamentoParqueFolletoPdf: 'Reglamento de parque (artículos)',
  cartaAutorizacionPdf: 'Carta de autorización (cargo automático)',
  cartaNominaPdf: 'Carta de consentimiento (nómina)',
};

export function isAllowedUploadFile(file: File): boolean {
  const mime = (file.type || '').toLowerCase();
  if (mime.startsWith('image/')) return true;
  if (mime === 'application/pdf') return true;
  const name = file.name.toLowerCase();
  return /\.(jpe?g|png|gif|webp|bmp|pdf)$/.test(name);
}

export function attachmentPreviewSrc(att: SaleAttachment): string | null {
  const raw = att.dataBase64?.trim();
  if (raw) {
    if (raw.startsWith('data:')) return raw;
    const mime = att.mime || 'application/octet-stream';
    return `data:${mime};base64,${raw}`;
  }
  if (att.driveFileUrl?.trim()) return att.driveFileUrl.trim();
  return null;
}

export function isPdfAttachment(att: SaleAttachment): boolean {
  const mime = (att.mime || '').toLowerCase();
  if (mime.includes('pdf')) return true;
  return att.name.toLowerCase().endsWith('.pdf');
}

export function isImageAttachment(att: SaleAttachment): boolean {
  const mime = (att.mime || '').toLowerCase();
  if (mime.startsWith('image/')) return true;
  return /\.(jpe?g|png|gif|webp|bmp)$/i.test(att.name);
}

export function listSaleAttachments(form: SaleFormData): AttachmentListItem[] {
  const docs = form.documentos;
  const keys: AttachmentKind[] = [
    'caratulaPdf',
    'cartaFacturaPdf',
    'cartaNoFacturaPdf',
    'cartaExclusionesPdf',
    'reglamentoParquePdf',
    'reglamentoParqueFolletoPdf',
    'cartaAutorizacionPdf',
    'cartaNominaPdf',
    'inePdf',
    'tarjetaPdf',
    'reciboNomina',
    'domiciliacionBanorte',
    'comprobanteDomicilio',
    'constanciaSituacionFiscal',
    'ineFrente',
    'ineReverso',
    'tarjetaFrente',
    'tarjetaReverso',
    'ticketPago',
    'comprobanteTransferencia',
    'firmaCliente',
  ];
  const items: AttachmentListItem[] = [];
  for (const kind of keys) {
    const attachment = docs[kind];
    if (!attachment) continue;
    if (!attachment.dataBase64?.trim() && !attachment.driveFileUrl?.trim()) {
      continue;
    }
    items.push({
      kind,
      label: LABELS[kind],
      attachment,
    });
  }
  return items;
}
