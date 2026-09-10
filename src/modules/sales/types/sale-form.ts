import { todayIsoDate } from '../../../shared/utils/datetime';
import {
  parseSaleKind,
  saleKindFromEstatus,
  saleKindToEstatus,
} from '../constants/sale-kinds';

export type SaleStatus =
  | 'DRAFT'
  | 'PENDING_PAYMENT'
  | 'PENDING_SIGNATURE'
  | 'COMPLETED'
  | 'REJECTED'
  | 'SUBMITTED'; // compat

export type PlanKind = 'PARQUE' | 'PLAN_FUTURO';

export type ReconocimientoVenta = {
  id: number;
  folio: string;
  partnerId?: number;
  partnerName: string;
  dateOrder: string;
  amountTotal: number;
  saldo: number;
  matchType: 'titular' | 'beneficiario';
  matchedBeneficiaryName?: string;
};

/** Valor por defecto en captura (plan a futuro). */
export const DEFAULT_SERVICIO_FUNERARIO = 'SERVICIO FUNERAL COMPLETO';

export interface SalePersonName {
  apellidoPaterno: string;
  apellidoMaterno: string;
  nombres: string;
}

export interface SaleBeneficiary extends SalePersonName {
  /** Id Odoo `sale.order.relation` (`sale.order.beneficiary.relation_id`). */
  relationId: number | null;
  parentesco: string;
  celular: string;
  fechaNacimiento: string;
}

export interface SaleAttachment {
  name: string;
  mime: string;
  /** Presente mientras el archivo aún no está en Drive. */
  dataBase64?: string;
  driveFileId?: string | null;
  driveFileUrl?: string | null;
}

export interface SaleFormData {
  meta: {
    fecha: string;
    contrato: string;
    origenVenta: string;
    /** Id sale.order.branch de Odoo */
    branchId: number | null;
    branchName: string;
    /** Id service.type de Odoo (sale.order.service_type_id) */
    serviceTypeId: number | null;
    serviceTypeName: string;
    folioSolicitud: string;
    fechaServicio: string;
    /** NUEVA | RECONOCIMIENTO | MEJORA | MINORIA */
    tipoVenta: string;
    estatus: string;
    anterior: string;
    verificacion: string;
    reconocimientoVentas: ReconocimientoVenta[];
  };
  contacto: SalePersonName & {
    sexo: string;
    curp: string;
    factura: string;
    /** Carta requerimiento de factura (FOR-GSM-CMR-05). */
    tipoPersona: string;
    razonSocial: string;
    rfc: string;
    facturaCp: string;
    regimenFiscal: string;
    regimenFiscalOtro: string;
    telefonoFactura: string;
    direccion: string;
    colonia: string;
    cp: string;
    entreCalles: string;
    senaParticular: string;
    municipio: string;
    estado: string;
    tipoCobranza: string;
    fechaNacimiento: string;
    sindicalizado: string;
    observaciones: string;
    celular1: string;
    celular2: string;
    correo: string;
    estadoCivil: string;
    domicilioEntregaDocumentacion: string;
  };
  segundoContacto: SalePersonName & {
    celular: string;
    /** Id Odoo `sale.order.relation`. */
    relationId: number | null;
    parentesco: string;
    direccion: string;
    colonia: string;
    cp: string;
    entreCalles: string;
    fechaNacimiento: string;
    domicilioEntregaDocumentacion: string;
  };
  /** 1 obligatorio, máx. 2 */
  beneficiarios: SaleBeneficiary[];
  /** Compat PDF */
  derechohabientes: {
    titularSustituto: SaleBeneficiary;
    primerBeneficiario: SaleBeneficiary;
    segundoBeneficiario: SaleBeneficiary;
  };
  ubicacionPlan: {
    planKind: PlanKind;
    nombrePlan: string;
    /** Id product.template Odoo */
    productId: number | null;
    /** Referencia interna Odoo (`default_code`) — informativo */
    productDefaultCode: string;
    /** Precio list_price (también en pago.precioPlan) */
    precioPlan: string;
    seccion: string;
    cuadrante: string;
    numero: string;
    servicioFunerario: string;
    parqueFuneral: string;
    /** Ids Odoo park.park / park.section / park.quadrant / park.space */
    parkId: number | null;
    sectionId: number | null;
    quadrantId: number | null;
    spaceId: number | null;
    /** Bandera: muestra/exige ubicación parque */
    preasignacion: boolean;
    /** product.template.without_interest — define cuota sin/con intereses. */
    withoutInterest: boolean;
  };
  pago: {
    precioPlan: string;
    frecuencia: string;
    /** Porcentaje de descuento (0–100). También alimenta la carátula. */
    promocionDescuento: string;
    anticipo: string;
    pagoInicial: string;
    plazo: string;
    importeCadaPago: string;
    saldo: string;
    fechaProximoPago: string;
    diasEspecificosPago: string;
    formaPago: string;
    /** Tarjeta / banco de domiciliación (Método de pago). */
    cuenta: string;
    banco: string;
    /** Cuenta y banco de este cobro (Registrar pago). */
    cuentaPago: string;
    bancoPago: string;
    vencimientoTarjeta: string;
    titularTarjeta: string;
    cvv: string;
    numeroEmpleado: string;
    nombreEmpleado: string;
    empresaNomina: string;
    empresaNominaId: number | null;
    infoNomina: string;
    /** Pago en efectivo: billetes recibidos y cambio entregado. */
    montoRecibido: string;
    cambio: string;
    nombreJefeVentas: string;
    nombreAsesor: string;
  };
  declaraciones: {
    aceptaMercadotecnia: string;
    aceptaPublicidad: string;
  };
  documentos: {
    ineFrente: SaleAttachment | null;
    ineReverso: SaleAttachment | null;
    /** PDF de una hoja con frente y reverso de la INE. */
    inePdf: SaleAttachment | null;
    comprobanteDomicilio: SaleAttachment | null;
    constanciaSituacionFiscal: SaleAttachment | null;
    tarjetaFrente: SaleAttachment | null;
    tarjetaReverso: SaleAttachment | null;
    tarjetaPdf: SaleAttachment | null;
    reciboNomina: SaleAttachment | null;
    domiciliacionBanorte: SaleAttachment | null;
    firmaCliente: SaleAttachment | null;
    ticketPago: SaleAttachment | null;
    comprobanteTransferencia: SaleAttachment | null;
    caratulaPdf: SaleAttachment | null;
    cartaFacturaPdf: SaleAttachment | null;
    cartaNoFacturaPdf: SaleAttachment | null;
    cartaExclusionesPdf: SaleAttachment | null;
    reglamentoParquePdf: SaleAttachment | null;
    reglamentoParqueFolletoPdf: SaleAttachment | null;
    cartaAutorizacionPdf: SaleAttachment | null;
    cartaNominaPdf: SaleAttachment | null;
  };
}

export type ReuseGroup =
  | 'contacto'
  | 'segundoContacto'
  | 'titularSustituto'
  | 'beneficiarios';

export interface SaleListItem {
  id: number;
  sellerId: number;
  sellerName: string;
  status: SaleStatus;
  amount: number;
  titularName: string | null;
  payload: SaleFormData | Record<string, unknown>;
  draftExpiresAt: string | null;
  createdAt: string;
  updatedAt: string;
  driveFolderUrl?: string | null;
  /** Ruta Drive: AÑO/MES/FOLIO-nombrecliente */
  driveFolderPath?: string | null;
  odooReceptionSynced?: boolean;
  odooSyncError?: string | null;
  precioPlan?: string;
  promocionDescuento?: string;
  anticipo?: string;
  saldo?: string;
}

/** Folio digital: D- + número de venta. */
export function formatDigitalFolio(
  id: number | string | null | undefined,
): string {
  const raw = String(id ?? '').trim();
  if (!raw) return '';
  const digits = raw.replace(/^D-/i, '').replace(/\D/g, '');
  if (!digits) return raw;
  return `D-${Number(digits)}`;
}

/** Folio de cotización Odoo. Ignora placeholders de prefill / mocks. */
export function realContrato(v: string | null | undefined): string {
  const t = String(v ?? '').trim();
  if (!t || /^VD-(MOCK|DEMO)-/i.test(t)) return '';
  return t;
}

export function emptyPerson(): SalePersonName {
  return { apellidoPaterno: '', apellidoMaterno: '', nombres: '' };
}

export function emptyBeneficiary(): SaleBeneficiary {
  return {
    ...emptyPerson(),
    relationId: null,
    parentesco: '',
    celular: '',
    fechaNacimiento: '',
  };
}

function syncDerechos(
  beneficiarios: SaleBeneficiary[],
  titularSustituto?: SaleBeneficiary,
): SaleFormData['derechohabientes'] {
  return {
    titularSustituto: titularSustituto
      ? { ...titularSustituto }
      : emptyBeneficiary(),
    primerBeneficiario: beneficiarios[0]
      ? { ...beneficiarios[0] }
      : emptyBeneficiary(),
    segundoBeneficiario: beneficiarios[1]
      ? { ...beneficiarios[1] }
      : emptyBeneficiary(),
  };
}

export function createEmptySaleForm(): SaleFormData {
  const today = todayIsoDate();
  const beneficiarios = [emptyBeneficiary()];
  return {
    meta: {
      fecha: today,
      contrato: '',
      origenVenta: '',
      branchId: null,
      branchName: '',
      serviceTypeId: null,
      serviceTypeName: '',
      folioSolicitud: '',
      fechaServicio: '',
      tipoVenta: 'NUEVA',
      estatus: 'ACTIVO',
      anterior: '',
      verificacion: '',
      reconocimientoVentas: [],
    },
    contacto: {
      ...emptyPerson(),
      sexo: '',
      curp: '',
      factura: '',
      tipoPersona: '',
      razonSocial: '',
      rfc: '',
      facturaCp: '',
      regimenFiscal: '',
      regimenFiscalOtro: '',
      telefonoFactura: '',
      direccion: '',
      colonia: '',
      cp: '',
      entreCalles: '',
      senaParticular: '',
      municipio: '',
      estado: '',
      tipoCobranza: '',
      fechaNacimiento: '',
      sindicalizado: 'NO',
      observaciones: '',
      celular1: '',
      celular2: '',
      correo: '',
      estadoCivil: '',
      domicilioEntregaDocumentacion: '',
    },
    segundoContacto: {
      ...emptyPerson(),
      celular: '',
      relationId: null,
      parentesco: '',
      direccion: '',
      colonia: '',
      cp: '',
      entreCalles: '',
      fechaNacimiento: '',
      domicilioEntregaDocumentacion: '',
    },
    beneficiarios,
    derechohabientes: syncDerechos(beneficiarios),
    ubicacionPlan: {
      planKind: 'PLAN_FUTURO',
      nombrePlan: '',
      productId: null,
      productDefaultCode: '',
      precioPlan: '',
      seccion: '',
      cuadrante: '',
      numero: '',
      servicioFunerario: DEFAULT_SERVICIO_FUNERARIO,
      parqueFuneral: '',
      parkId: null,
      sectionId: null,
      quadrantId: null,
      spaceId: null,
      preasignacion: false,
      withoutInterest: false,
    },
    pago: {
      precioPlan: '',
      frecuencia: '',
      promocionDescuento: '0',
      anticipo: '0',
      pagoInicial: '',
      plazo: '',
      importeCadaPago: '',
      saldo: '',
      fechaProximoPago: todayIsoDate(),
      diasEspecificosPago: '',
      formaPago: '',
      cuenta: '',
      banco: '',
      cuentaPago: '',
      bancoPago: '',
      vencimientoTarjeta: '',
      titularTarjeta: '',
      cvv: '',
      numeroEmpleado: '',
      nombreEmpleado: '',
      empresaNomina: '',
      empresaNominaId: null,
      infoNomina: '',
      montoRecibido: '',
      cambio: '',
      nombreJefeVentas: '',
      nombreAsesor: '',
    },
    declaraciones: {
      aceptaMercadotecnia: '',
      aceptaPublicidad: '',
    },
    documentos: {
      ineFrente: null,
      ineReverso: null,
      inePdf: null,
      comprobanteDomicilio: null,
      constanciaSituacionFiscal: null,
      tarjetaFrente: null,
      tarjetaReverso: null,
      tarjetaPdf: null,
      reciboNomina: null,
      domiciliacionBanorte: null,
      firmaCliente: null,
      ticketPago: null,
      comprobanteTransferencia: null,
      caratulaPdf: null,
      cartaFacturaPdf: null,
      cartaNoFacturaPdf: null,
      cartaExclusionesPdf: null,
      reglamentoParquePdf: null,
      reglamentoParqueFolletoPdf: null,
      cartaAutorizacionPdf: null,
      cartaNominaPdf: null,
    },
  };
}

/** Datos demo para el modal de pago (si la venta aún no tiene precio). */
export function createPrefillPago(): SaleFormData['pago'] {
  const nextMonth = new Date();
  nextMonth.setMonth(nextMonth.getMonth() + 1);
  const fechaProximo = nextMonth.toISOString().slice(0, 10);

  return {
    precioPlan: '45000',
    frecuencia: 'MENSUAL',
    promocionDescuento: '10',
    anticipo: '5000',
    pagoInicial: '4500',
    plazo: '24',
    importeCadaPago: '1666.67',
    saldo: '35500',
    fechaProximoPago: fechaProximo,
    diasEspecificosPago: '15 de cada mes',
    formaPago: 'TRANSFERENCIA',
    cuenta: '0123456789',
    banco: 'BBVA',
    cuentaPago: '',
    bancoPago: '',
    vencimientoTarjeta: '',
    titularTarjeta: '',
    cvv: '',
    numeroEmpleado: '',
    nombreEmpleado: '',
    empresaNomina: '',
    empresaNominaId: null,
    infoNomina: '',
    montoRecibido: '',
    cambio: '',
    nombreJefeVentas: 'Carlos Mendoza',
    nombreAsesor: '',
  };
}

export function createPrefillSaleForm(): SaleFormData {
  const base = createEmptySaleForm();
  const today = new Date().toISOString().slice(0, 10);
  base.meta = {
    ...base.meta,
    contrato: '',
    origenVenta: 'field_selling',
    folioSolicitud: '',
    verificacion: 'Pendiente',
  };
  base.contacto = {
    ...base.contacto,
    apellidoPaterno: 'García',
    apellidoMaterno: 'López',
    nombres: 'María Elena',
    sexo: 'F',
    // CURP demo válida: María Elena García López · F · 15/03/1985 · Sinaloa
    curp: 'GALE850315MSLRPL09',
    factura: 'NO',
    tipoPersona: '',
    razonSocial: '',
    rfc: '',
    facturaCp: '',
    regimenFiscal: '',
    regimenFiscalOtro: '',
    telefonoFactura: '',
    direccion: 'Calle Hidalgo 245',
    colonia: 'Centro',
    cp: '80000',
    entreCalles: 'Juárez y Morelos',
    senaParticular: 'Portón azul',
    municipio: 'Culiacán',
    estado: 'Sinaloa',
    tipoCobranza: '',
    fechaNacimiento: '1985-03-15',
    sindicalizado: 'NO',
    observaciones: 'Prefiere contacto por WhatsApp por la tarde.',
    celular1: '6671234567',
    celular2: '6679876543',
    correo: 'sistemas@sanmartin.com.mx',
    estadoCivil: 'CASADO',
    domicilioEntregaDocumentacion: 'Mismo domicilio del titular',
  };
  base.segundoContacto = {
    ...base.segundoContacto,
    apellidoPaterno: 'García',
    apellidoMaterno: 'Ruiz',
    nombres: 'José Luis',
    celular: '6675551212',
    relationId: null,
    parentesco: 'Esposo',
    direccion: 'Av. Álvaro Obregón 18',
    colonia: 'Guadalupe',
    cp: '80200',
    entreCalles: 'Reforma y Independencia',
    fechaNacimiento: '1982-07-22',
  };
  base.beneficiarios = [
    {
      apellidoPaterno: 'García',
      apellidoMaterno: 'García',
      nombres: 'Ana Sofía',
      parentesco: 'Hija',
      celular: '6674443322',
      fechaNacimiento: '2010-11-08',
    },
  ];
  base.derechohabientes = syncDerechos(base.beneficiarios, {
    apellidoPaterno: 'López',
    apellidoMaterno: 'Martínez',
    nombres: 'Carlos',
    parentesco: 'Hermano',
    celular: '6673332211',
    fechaNacimiento: '1985-03-15',
  });
  base.ubicacionPlan = {
    planKind: 'PARQUE',
    nombrePlan: 'Plan Familiar Premium',
    productId: 9001,
    productDefaultCode: 'PFAM-001',
    precioPlan: '45000',
    seccion: 'A',
    cuadrante: '3',
    numero: '128',
    servicioFunerario: 'Servicio completo',
    parqueFuneral: 'Parque San Martín Culiacán',
    parkId: null,
    sectionId: null,
    quadrantId: null,
    spaceId: null,
    preasignacion: true,
    withoutInterest: false,
  };
  base.pago = {
    ...createPrefillPago(),
    precioPlan: '45000',
    nombreAsesor: '',
  };
  base.declaraciones = {
    aceptaMercadotecnia: 'NO',
    aceptaPublicidad: 'SI',
  };
  base.meta.fecha = today;
  return base;
}

function asBool(v: unknown, fallback = false): boolean {
  if (typeof v === 'boolean') return v;
  if (v == null || v === '') return fallback;
  const t = String(v).trim().toLowerCase();
  if (['true', '1', 'si', 'sí', 'yes'].includes(t)) return true;
  if (['false', '0', 'no', 'n/a'].includes(t)) return false;
  return fallback;
}

export function fullName(p: SalePersonName): string {
  return [p.apellidoPaterno, p.apellidoMaterno, p.nombres]
    .map((x) => x.trim())
    .filter(Boolean)
    .join(' ');
}

export function titularDisplayName(form: SaleFormData): string {
  return fullName(form.contacto) || 'Sin titular';
}

/** Rellena descuento, anticipo y próximo pago cuando vienen vacíos. */
export function normalizePagoDefaults(
  pago: SaleFormData['pago'],
): SaleFormData['pago'] {
  const descuento = String(pago.promocionDescuento ?? '').trim();
  const anticipo = String(pago.anticipo ?? '').trim();
  const proximoPago = String(pago.fechaProximoPago ?? '').trim();
  const rawId = (pago as { empresaNominaId?: unknown }).empresaNominaId;
  const parsedId = rawId == null || rawId === '' ? null : Number(rawId);
  return {
    ...pago,
    empresaNominaId:
      parsedId != null && Number.isFinite(parsedId) && parsedId > 0
        ? parsedId
        : null,
    promocionDescuento: descuento || '0',
    anticipo: anticipo || '0',
    fechaProximoPago: proximoPago || todayIsoDate(),
  };
}

export function mergeSaleForm(raw: unknown): SaleFormData {
  const base = createEmptySaleForm();
  if (!raw || typeof raw !== 'object') return base;
  const src = raw as Partial<SaleFormData> & {
    derechohabientes?: SaleFormData['derechohabientes'];
  };

  let beneficiarios = Array.isArray(src.beneficiarios)
    ? src.beneficiarios.map((b) => ({ ...emptyBeneficiary(), ...b }))
    : [];
  if (!beneficiarios.length && src.derechohabientes) {
    const d = src.derechohabientes;
    if (d.primerBeneficiario?.nombres || d.primerBeneficiario?.apellidoPaterno) {
      beneficiarios.push({ ...emptyBeneficiary(), ...d.primerBeneficiario });
    }
    if (d.segundoBeneficiario?.nombres || d.segundoBeneficiario?.apellidoPaterno) {
      beneficiarios.push({ ...emptyBeneficiary(), ...d.segundoBeneficiario });
    }
  }
  if (!beneficiarios.length) beneficiarios = [emptyBeneficiary()];
  beneficiarios = beneficiarios.slice(0, 2).map((b) => ({
    ...b,
    relationId:
      b.relationId != null && Number(b.relationId) > 0
        ? Number(b.relationId)
        : null,
  }));

  const titularSustitutoRaw = src.derechohabientes?.titularSustituto
    ? { ...emptyBeneficiary(), ...src.derechohabientes.titularSustituto }
    : emptyBeneficiary();
  const titularSustituto = {
    ...titularSustitutoRaw,
    relationId:
      titularSustitutoRaw.relationId != null &&
      Number(titularSustitutoRaw.relationId) > 0
        ? Number(titularSustitutoRaw.relationId)
        : null,
  };

  return {
    ...base,
    meta: {
      ...base.meta,
      ...(src.meta ?? {}),
      contrato: realContrato(src.meta?.contrato),
      branchId:
        src.meta?.branchId != null && Number(src.meta.branchId) > 0
          ? Number(src.meta.branchId)
          : null,
      serviceTypeId:
        src.meta?.serviceTypeId != null && Number(src.meta.serviceTypeId) > 0
          ? Number(src.meta.serviceTypeId)
          : null,
      tipoVenta: (() => {
        const fromKind = parseSaleKind(src.meta?.tipoVenta);
        return fromKind ?? saleKindFromEstatus(src.meta?.estatus);
      })(),
      estatus: (() => {
        const fromKind = parseSaleKind(src.meta?.tipoVenta);
        return fromKind
          ? saleKindToEstatus(fromKind)
          : String(src.meta?.estatus || base.meta.estatus);
      })(),
      reconocimientoVentas: Array.isArray(src.meta?.reconocimientoVentas)
        ? src.meta.reconocimientoVentas
            .map((item) => ({
              id: Number(item.id) || 0,
              folio: String(item.folio ?? ''),
              partnerName: String(item.partnerName ?? ''),
              dateOrder: String(item.dateOrder ?? ''),
              amountTotal: Number(item.amountTotal) || 0,
              saldo: Number(item.saldo) || 0,
              matchType:
                item.matchType === 'beneficiario' ? 'beneficiario' : 'titular',
              matchedBeneficiaryName: String(item.matchedBeneficiaryName ?? ''),
            }))
            .filter((item) => item.id > 0)
        : [],
    },
    contacto: {
      ...base.contacto,
      ...(src.contacto ?? {}),
      sindicalizado:
        String(src.contacto?.sindicalizado ?? '')
          .trim()
          .toUpperCase() === 'SI'
          ? 'SI'
          : 'NO',
    },
    segundoContacto: {
      ...base.segundoContacto,
      ...(src.segundoContacto ?? {}),
      relationId:
        src.segundoContacto?.relationId != null &&
        Number(src.segundoContacto.relationId) > 0
          ? Number(src.segundoContacto.relationId)
          : null,
    },
    beneficiarios,
    derechohabientes: syncDerechos(beneficiarios, titularSustituto),
    ubicacionPlan: {
      ...base.ubicacionPlan,
      ...(src.ubicacionPlan ?? {}),
      planKind:
        src.ubicacionPlan?.planKind === 'PARQUE' ? 'PARQUE' : 'PLAN_FUTURO',
      servicioFunerario: (() => {
        const kind =
          src.ubicacionPlan?.planKind === 'PARQUE' ? 'PARQUE' : 'PLAN_FUTURO';
        const raw = String(src.ubicacionPlan?.servicioFunerario ?? '').trim();
        if (kind === 'PARQUE') return '';
        return raw || DEFAULT_SERVICIO_FUNERARIO;
      })(),
      productId:
        src.ubicacionPlan?.productId != null
          ? Number(src.ubicacionPlan.productId)
          : (base.ubicacionPlan.productId ?? null),
      productDefaultCode:
        src.ubicacionPlan?.productDefaultCode ??
        base.ubicacionPlan.productDefaultCode,
      precioPlan:
        src.ubicacionPlan?.precioPlan ??
        src.pago?.precioPlan ??
        base.ubicacionPlan.precioPlan,
      preasignacion: asBool(
        src.ubicacionPlan?.preasignacion,
        base.ubicacionPlan.preasignacion,
      ),
      withoutInterest: asBool(
        src.ubicacionPlan?.withoutInterest ??
          (src.ubicacionPlan as { without_interest?: unknown } | undefined)
            ?.without_interest,
        base.ubicacionPlan.withoutInterest,
      ),
      parkId:
        src.ubicacionPlan?.parkId != null
          ? Number(src.ubicacionPlan.parkId)
          : (base.ubicacionPlan.parkId ?? null),
      sectionId:
        src.ubicacionPlan?.sectionId != null
          ? Number(src.ubicacionPlan.sectionId)
          : (base.ubicacionPlan.sectionId ?? null),
      quadrantId:
        src.ubicacionPlan?.quadrantId != null
          ? Number(src.ubicacionPlan.quadrantId)
          : (base.ubicacionPlan.quadrantId ?? null),
      spaceId:
        src.ubicacionPlan?.spaceId != null
          ? Number(src.ubicacionPlan.spaceId)
          : (base.ubicacionPlan.spaceId ?? null),
    },
    pago: normalizePagoDefaults({ ...base.pago, ...(src.pago ?? {}) }),
    declaraciones: { ...base.declaraciones, ...(src.declaraciones ?? {}) },
    documentos: {
      ineFrente: src.documentos?.ineFrente ?? null,
      ineReverso: src.documentos?.ineReverso ?? null,
      inePdf:
        src.documentos?.inePdf ??
        (src.documentos as { ine?: SaleAttachment | null } | undefined)?.ine ??
        null,
      comprobanteDomicilio: src.documentos?.comprobanteDomicilio ?? null,
      constanciaSituacionFiscal:
        src.documentos?.constanciaSituacionFiscal ?? null,
      tarjetaFrente: src.documentos?.tarjetaFrente ?? null,
      tarjetaReverso: src.documentos?.tarjetaReverso ?? null,
      tarjetaPdf: src.documentos?.tarjetaPdf ?? null,
      reciboNomina: src.documentos?.reciboNomina ?? null,
      domiciliacionBanorte: src.documentos?.domiciliacionBanorte ?? null,
      firmaCliente: src.documentos?.firmaCliente ?? null,
      ticketPago: src.documentos?.ticketPago ?? null,
      comprobanteTransferencia: src.documentos?.comprobanteTransferencia ?? null,
      caratulaPdf: src.documentos?.caratulaPdf ?? null,
      cartaFacturaPdf: src.documentos?.cartaFacturaPdf ?? null,
      cartaNoFacturaPdf: src.documentos?.cartaNoFacturaPdf ?? null,
      cartaExclusionesPdf: src.documentos?.cartaExclusionesPdf ?? null,
      reglamentoParquePdf: src.documentos?.reglamentoParquePdf ?? null,
      reglamentoParqueFolletoPdf:
        src.documentos?.reglamentoParqueFolletoPdf ?? null,
      cartaAutorizacionPdf: src.documentos?.cartaAutorizacionPdf ?? null,
      cartaNominaPdf: src.documentos?.cartaNominaPdf ?? null,
    },
  };
}

/** INE completa: ambos lados o PDF combinado (incluye ventas antiguas con un solo archivo). */
export function hasIneDocumentos(docs: SaleFormData['documentos']): boolean {
  if (docs.inePdf?.dataBase64?.trim() || docs.inePdf?.driveFileUrl?.trim()) {
    return true;
  }
  const frente = docs.ineFrente?.dataBase64?.trim() || docs.ineFrente?.driveFileUrl?.trim();
  const reverso = docs.ineReverso?.dataBase64?.trim() || docs.ineReverso?.driveFileUrl?.trim();
  return Boolean(frente && reverso);
}

/** Adjunto principal de INE para PDFs (preferir frente si aún no hay PDF combinado). */
export function primaryIneAttachment(
  docs: SaleFormData['documentos'],
): SaleAttachment | null {
  if (docs.inePdf) return docs.inePdf;
  if (docs.ineFrente && docs.ineReverso) return docs.ineFrente;
  return docs.ineFrente;
}

export function syncBeneficiariosToDerechos(form: SaleFormData) {
  const ts = form.derechohabientes?.titularSustituto ?? emptyBeneficiary();
  form.derechohabientes = syncDerechos(form.beneficiarios, ts);
}
