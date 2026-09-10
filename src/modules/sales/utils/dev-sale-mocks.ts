import {
  createEmptySaleForm,
  DEFAULT_SERVICIO_FUNERARIO,
  mergeSaleForm,
  type SaleAttachment,
  type SaleFormData,
} from '../types/sale-form';

/** PNG 1×1 mínimo para marcar documentos en modo dev. */
const TINY_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function mockDoc(name: string): SaleAttachment {
  return {
    name,
    mime: 'image/png',
    dataBase64: TINY_PNG_B64,
  };
}

/** PDF mínimo para mocks con factura = SI. */
const TINY_PDF_B64 =
  'JVBERi0xLjEKMSAwIG9iajw8L1R5cGUvQ2F0YWxvZz4+ZW5kb2JqCnRyYWlsZXI8PC9Sb290IDEgMCBSPj4KJSVFT0YK';

function mockPdf(name: string): SaleAttachment {
  return {
    name,
    mime: 'application/pdf',
    dataBase64: TINY_PDF_B64,
  };
}

function nextMonthIso(): string {
  const d = new Date();
  d.setMonth(d.getMonth() + 1);
  return d.toISOString().slice(0, 10);
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

type ParkLocationMock = {
  parkId: number;
  parqueFuneral: string;
  sectionId: number;
  seccion: string;
  quadrantId: number;
  cuadrante: string;
  spaceId: number;
  numero: string;
};

/** Plan parque: sin servicio funerario. Parque/sección siempre; espacio solo si hay preasignación. */
function mockPlanParque(opts: {
  nombrePlan: string;
  productId: number;
  productDefaultCode: string;
  precioPlan: string;
  preasignacion?: boolean;
  park?: ParkLocationMock;
}): Partial<SaleFormData['ubicacionPlan']> {
  const preasignacion = opts.preasignacion ?? false;
  const park = opts.park;
  return {
    planKind: 'PARQUE',
    nombrePlan: opts.nombrePlan,
    productId: opts.productId,
    productDefaultCode: opts.productDefaultCode,
    precioPlan: opts.precioPlan,
    servicioFunerario: '',
    preasignacion,
    parqueFuneral: park?.parqueFuneral ?? '',
    seccion: park?.seccion ?? '',
    cuadrante: preasignacion ? (park?.cuadrante ?? '') : '',
    numero: preasignacion ? (park?.numero ?? '') : '',
    parkId: park?.parkId ?? null,
    sectionId: park?.sectionId ?? null,
    quadrantId: preasignacion ? (park?.quadrantId ?? null) : null,
    spaceId: preasignacion ? (park?.spaceId ?? null) : null,
  };
}

/** Plan a futuro: mismo default de captura; sin datos de parque. */
function mockPlanFuturo(opts: {
  nombrePlan: string;
  productId: number;
  productDefaultCode: string;
  precioPlan: string;
  servicioFunerario?: string;
}): Partial<SaleFormData['ubicacionPlan']> {
  return {
    planKind: 'PLAN_FUTURO',
    nombrePlan: opts.nombrePlan,
    productId: opts.productId,
    productDefaultCode: opts.productDefaultCode,
    precioPlan: opts.precioPlan,
    servicioFunerario: DEFAULT_SERVICIO_FUNERARIO,
    preasignacion: false,
    parqueFuneral: '',
    seccion: '',
    cuadrante: '',
    numero: '',
    parkId: null,
    sectionId: null,
    quadrantId: null,
    spaceId: null,
  };
}

function normalizeUbicacionPlan(
  plan: SaleFormData['ubicacionPlan'],
): SaleFormData['ubicacionPlan'] {
  if (plan.planKind === 'PLAN_FUTURO') {
    plan.preasignacion = false;
    plan.parqueFuneral = '';
    plan.seccion = '';
    plan.cuadrante = '';
    plan.numero = '';
    plan.parkId = null;
    plan.sectionId = null;
    plan.quadrantId = null;
    plan.spaceId = null;
    return plan;
  }

  plan.servicioFunerario = '';
  if (!plan.preasignacion) {
    plan.cuadrante = '';
    plan.numero = '';
    plan.quadrantId = null;
    plan.spaceId = null;
  }
  return plan;
}

type InvoiceMock = Pick<
  SaleFormData['contacto'],
  | 'tipoPersona'
  | 'razonSocial'
  | 'rfc'
  | 'facturaCp'
  | 'regimenFiscal'
  | 'regimenFiscalOtro'
  | 'telefonoFactura'
>;

type DevSaleSeed = {
  label: string;
  meta: Partial<SaleFormData['meta']>;
  contacto: Partial<SaleFormData['contacto']>;
  segundoContacto: Partial<SaleFormData['segundoContacto']>;
  titularSustituto: SaleFormData['derechohabientes']['titularSustituto'];
  beneficiarios: SaleFormData['beneficiarios'];
  ubicacionPlan: Partial<SaleFormData['ubicacionPlan']>;
  pago: Partial<SaleFormData['pago']>;
  declaraciones: SaleFormData['declaraciones'];
  /** Datos fiscales para la carta de requerimiento de factura. */
  factura?: Partial<InvoiceMock> & { tipoPersona?: 'FISICA' | 'MORAL' };
};

function fullNameOf(c: Partial<SaleFormData['contacto']>): string {
  return [c.nombres, c.apellidoPaterno, c.apellidoMaterno]
    .map((p) => String(p ?? '').trim())
    .filter(Boolean)
    .join(' ');
}

function seedIsNomina(seed: DevSaleSeed): boolean {
  return seed.contacto.tipoCobranza === 'NOMINA';
}

function seedIsUas(seed: DevSaleSeed): boolean {
  if (Number(seed.pago?.empresaNominaId) === 1) return true;
  return (
    String(seed.pago?.empresaNomina ?? '')
      .trim()
      .toLocaleUpperCase('es-MX') === 'UAS'
  );
}

function seedNeedsCard(seed: DevSaleSeed): boolean {
  return seed.contacto.tipoCobranza === 'DOMICILIADO' || seedIsUas(seed);
}

/** Completa campos que la captura exige según tipo de cobranza. */
function applyMockPagoRules(
  contacto: Partial<SaleFormData['contacto']>,
  pago: SaleFormData['pago'],
): SaleFormData['pago'] {
  if (!pago.diasEspecificosPago.trim()) {
    pago.diasEspecificosPago = '15 de cada mes';
  }
  if (contacto.tipoCobranza === 'DOMICILIADO') {
    if (!pago.cvv.trim()) pago.cvv = '847';
    if (!pago.titularTarjeta.trim()) pago.titularTarjeta = fullNameOf(contacto);
  }
  if (contacto.tipoCobranza === 'NOMINA') {
    if (!pago.nombreEmpleado.trim()) pago.nombreEmpleado = fullNameOf(contacto);
  }
  return pago;
}

/** RFC de prueba (13 física / 12 moral) a partir de CURP o fallback. */
function mockRfc(
  contacto: Partial<SaleFormData['contacto']>,
  tipo: 'FISICA' | 'MORAL',
): string {
  const curp = String(contacto.curp ?? '')
    .trim()
    .toUpperCase();
  if (tipo === 'MORAL') {
    const base = curp.slice(0, 3) || 'SFP';
    const fecha = curp.slice(4, 10) || '850101';
    return `${base}${fecha}AA1`;
  }
  const base = curp.slice(0, 10) || 'XAXX010101';
  return `${base}XX1`;
}

/** Campos de factura listos para precargar en captura (dev). */
export function mockInvoiceContacto(
  contacto: Partial<SaleFormData['contacto']>,
  extra?: DevSaleSeed['factura'],
): Partial<SaleFormData['contacto']> {
  const tipo =
    extra?.tipoPersona === 'MORAL' || extra?.tipoPersona === 'FISICA'
      ? extra.tipoPersona
      : 'FISICA';
  const razon =
    extra?.razonSocial?.trim() ||
    (tipo === 'MORAL'
      ? `${fullNameOf(contacto) || 'Cliente'} SA de CV`
      : fullNameOf(contacto));
  return {
    factura: 'SI',
    tipoPersona: tipo,
    razonSocial: razon,
    rfc: extra?.rfc?.trim() || mockRfc(contacto, tipo),
    facturaCp: extra?.facturaCp?.trim() || contacto.cp || '80000',
    regimenFiscal: extra?.regimenFiscal?.trim() || (tipo === 'MORAL' ? '601' : '612'),
    regimenFiscalOtro: extra?.regimenFiscalOtro ?? '',
    telefonoFactura:
      extra?.telefonoFactura?.trim() || contacto.celular1 || '6671234567',
  };
}

/**
 * 10 ventas/clientes de prueba (CURP válidas).
 * Plan: parque (con/sin preasignación + ids Odoo) o plan a futuro (servicio funerario).
 */
const SEEDS: DevSaleSeed[] = [
  {
    label: 'María Elena García · Parque',
    meta: {
      fecha: todayIso(),
      contrato: '',
      origenVenta: 'field_selling',
      estatus: 'ACTIVO',
      verificacion: 'Pendiente',
    },
    contacto: {
      apellidoPaterno: 'García',
      apellidoMaterno: 'López',
      nombres: 'María Elena',
      sexo: 'F',
      curp: 'GALE850315MSLRPL09',
      fechaNacimiento: '1985-03-15',
      factura: 'NO',
      direccion: 'Calle Hidalgo 245',
      colonia: 'Centro',
      cp: '80000',
      entreCalles: 'Juárez y Morelos',
      senaParticular: 'Portón azul',
      municipio: 'Culiacán',
      estado: 'Sinaloa',
      tipoCobranza: 'VENTANILLA',
      sindicalizado: 'NO',
      celular1: '6671234567',
      celular2: '6679876543',
      correo: 'sistemas@sanmartin.com.mx',
      estadoCivil: 'CASADO',
      domicilioEntregaDocumentacion: 'Mismo domicilio',
      observaciones: 'Prefiere WhatsApp por la tarde',
    },
    segundoContacto: {
      apellidoPaterno: 'García',
      apellidoMaterno: 'Ruiz',
      nombres: 'José Luis',
      celular: '6675551212',
      parentesco: 'Esposo',
      direccion: 'Av. Álvaro Obregón 18',
      colonia: 'Guadalupe',
      cp: '80200',
      entreCalles: 'Reforma y Independencia',
      fechaNacimiento: '1982-07-22',
    },
    titularSustituto: {
      apellidoPaterno: 'López',
      apellidoMaterno: 'Martínez',
      nombres: 'Carlos',
      parentesco: 'Hermano',
      celular: '6673332211',
      fechaNacimiento: '1983-09-21',
    },
    beneficiarios: [
      {
        apellidoPaterno: 'García',
        apellidoMaterno: 'García',
        nombres: 'Ana Sofía',
        parentesco: 'Hija',
        celular: '6674443322',
        fechaNacimiento: '2010-11-08',
      },
    ],
    ubicacionPlan: mockPlanParque({
      nombrePlan: 'Plan Familiar Premium',
      productId: 9001,
      productDefaultCode: 'PFAM-001',
      precioPlan: '45000',
      preasignacion: true,
      park: {
        parkId: 101,
        parqueFuneral: 'Parque San Martín Culiacán',
        sectionId: 201,
        seccion: 'A',
        quadrantId: 301,
        cuadrante: '3',
        spaceId: 401,
        numero: '128',
      },
    }),
    pago: {
      precioPlan: '45000',
      promocionDescuento: '5',
      anticipo: '5000',
      pagoInicial: '4500',
      plazo: '24',
      importeCadaPago: '1666.67',
      saldo: '37750',
      frecuencia: 'MENSUAL',
      fechaProximoPago: nextMonthIso(),
      diasEspecificosPago: '15 de cada mes',
      formaPago: 'TRANSFERENCIA',
      banco: 'BBVA',
      cuenta: '0123456789',
      nombreJefeVentas: 'Carlos Mendoza',
    },
    declaraciones: { aceptaMercadotecnia: 'NO', aceptaPublicidad: 'SI' },
  },
  {
    label: 'Juan Pérez · Plan futuro',
    meta: {
      fecha: todayIso(),
      contrato: '',
      origenVenta: 'social_media',
      estatus: 'ACTIVO',
    },
    contacto: {
      apellidoPaterno: 'Pérez',
      apellidoMaterno: 'Gómez',
      nombres: 'Juan Carlos',
      sexo: 'M',
      curp: 'PEGJ900412HSLRRN09',
      fechaNacimiento: '1990-04-12',
      factura: 'SI',
      direccion: 'Av. Álvaro Obregón 1200',
      colonia: 'Miguel Hidalgo',
      cp: '80090',
      municipio: 'Culiacán',
      estado: 'Sinaloa',
      tipoCobranza: 'DOMICILIADO',
      sindicalizado: 'SI',
      celular1: '6671112233',
      correo: 'sistemas@sanmartin.com.mx',
      estadoCivil: 'SOLTERO',
      domicilioEntregaDocumentacion: 'Oficina',
    },
    segundoContacto: {
      apellidoPaterno: 'Pérez',
      apellidoMaterno: 'Soto',
      nombres: 'Laura',
      celular: '6672223344',
      parentesco: 'Hermana',
      fechaNacimiento: '1992-01-10',
    },
    titularSustituto: {
      apellidoPaterno: 'Pérez',
      apellidoMaterno: 'Díaz',
      nombres: 'Roberto',
      parentesco: 'Padre',
      celular: '6671112244',
      fechaNacimiento: '1964-08-03',
    },
    beneficiarios: [
      {
        apellidoPaterno: 'Pérez',
        apellidoMaterno: 'Núñez',
        nombres: 'Diego',
        parentesco: 'Hijo',
        celular: '6673334455',
        fechaNacimiento: '2015-06-01',
      },
      {
        apellidoPaterno: 'Pérez',
        apellidoMaterno: 'Núñez',
        nombres: 'Valentina',
        parentesco: 'Hija',
        celular: '6673334456',
        fechaNacimiento: '2018-09-20',
      },
    ],
    ubicacionPlan: mockPlanFuturo({
      nombrePlan: 'Plan Futuro Básico',
      productId: 9002,
      productDefaultCode: 'PFUT-010',
      precioPlan: '28000',
      servicioFunerario: 'Servicio estándar',
    }),
    pago: {
      precioPlan: '28000',
      promocionDescuento: '0',
      anticipo: '3000',
      pagoInicial: '2800',
      plazo: '36',
      importeCadaPago: '694.44',
      saldo: '25000',
      frecuencia: 'MENSUAL',
      fechaProximoPago: nextMonthIso(),
      formaPago: 'EFECTIVO',
      banco: 'BBVA',
      cuenta: '4152313498765432',
      vencimientoTarjeta: '11/29',
      titularTarjeta: 'Juan Carlos Pérez Gómez',
      nombreAsesor: 'Ana Ríos',
      nombreJefeVentas: 'Ana Ríos',
    },
    declaraciones: { aceptaMercadotecnia: 'SI', aceptaPublicidad: 'SI' },
    factura: {
      tipoPersona: 'FISICA',
      regimenFiscal: '612',
    },
  },
  {
    label: 'Rosa López · Parque sin preasignación',
    meta: {
      fecha: todayIso(),
      contrato: '',
      origenVenta: 'referral_sales',
      estatus: 'ACTIVO',
    },
    contacto: {
      apellidoPaterno: 'López',
      apellidoMaterno: 'Hernández',
      nombres: 'Rosa María',
      sexo: 'F',
      curp: 'LOHM780222MSLPRS09',
      fechaNacimiento: '1978-02-22',
      factura: 'NO',
      direccion: 'Blvd. Pedro Infante 88',
      colonia: 'Las Quintas',
      cp: '80060',
      municipio: 'Culiacán',
      estado: 'Sinaloa',
      tipoCobranza: 'VENTANILLA',
      sindicalizado: 'NO',
      celular1: '6674445566',
      correo: 'sistemas@sanmartin.com.mx',
      estadoCivil: 'VIUDO',
    },
    segundoContacto: {
      apellidoPaterno: 'López',
      apellidoMaterno: 'Díaz',
      nombres: 'Miguel',
      celular: '6677778899',
      parentesco: 'Hermano',
      fechaNacimiento: '1975-05-05',
    },
    titularSustituto: {
      apellidoPaterno: 'Hernández',
      apellidoMaterno: 'Soto',
      nombres: 'Teresa',
      parentesco: 'Madre',
      celular: '6674445577',
      fechaNacimiento: '1956-11-12',
    },
    beneficiarios: [
      {
        apellidoPaterno: 'López',
        apellidoMaterno: 'Vega',
        nombres: 'Carmen',
        parentesco: 'Hija',
        celular: '6676667788',
        fechaNacimiento: '2000-03-14',
      },
    ],
    ubicacionPlan: mockPlanParque({
      nombrePlan: 'Jardín Familiar',
      productId: 9003,
      productDefaultCode: 'JARD-003',
      precioPlan: '52000',
      preasignacion: false,
      park: {
        parkId: 102,
        parqueFuneral: 'Parque San Martín Culiacán',
        sectionId: 210,
        seccion: 'B',
        quadrantId: 0,
        cuadrante: '',
        spaceId: 0,
        numero: '',
      },
    }),
    pago: {
      precioPlan: '52000',
      promocionDescuento: '10',
      anticipo: '8000',
      pagoInicial: '5000',
      plazo: '48',
      importeCadaPago: '812.50',
      saldo: '38800',
      frecuencia: 'MENSUAL',
      fechaProximoPago: nextMonthIso(),
      diasEspecificosPago: '1 y 15',
      formaPago: 'TRANSFERENCIA',
      banco: 'Banorte',
      cuenta: '9988776655',
      nombreJefeVentas: 'Luis Ortega',
    },
    declaraciones: { aceptaMercadotecnia: 'NO', aceptaPublicidad: 'NO' },
  },
  {
    label: 'Xavier Ramírez · Nómina',
    meta: {
      fecha: todayIso(),
      contrato: '',
      origenVenta: 'telemarketing_sales',
      estatus: 'MEJORA',
    },
    contacto: {
      apellidoPaterno: 'Ramírez',
      apellidoMaterno: 'Xol',
      nombres: 'Xavier',
      sexo: 'M',
      curp: 'RAXL920815HSLMNS08',
      fechaNacimiento: '1992-08-15',
      factura: 'NO',
      direccion: 'Calle Rosales 45',
      colonia: 'Tierra Blanca',
      cp: '80030',
      municipio: 'Culiacán',
      estado: 'Sinaloa',
      tipoCobranza: 'NOMINA',
      sindicalizado: 'NO',
      celular1: '6679988776',
      correo: 'sistemas@sanmartin.com.mx',
      estadoCivil: 'UNION LIBRE',
    },
    segundoContacto: {
      apellidoPaterno: 'Sánchez',
      apellidoMaterno: 'Luna',
      nombres: 'Paola',
      celular: '6671122334',
      parentesco: 'Esposa',
      fechaNacimiento: '1994-12-02',
    },
    titularSustituto: {
      apellidoPaterno: 'Ramírez',
      apellidoMaterno: 'Xol',
      nombres: 'Héctor',
      parentesco: 'Hermano',
      celular: '6679988777',
      fechaNacimiento: '1989-02-17',
    },
    beneficiarios: [
      {
        apellidoPaterno: 'Ramírez',
        apellidoMaterno: 'Sánchez',
        nombres: 'Mateo',
        parentesco: 'Hijo',
        celular: '6670001122',
        fechaNacimiento: '2019-04-18',
      },
    ],
    ubicacionPlan: mockPlanFuturo({
      nombrePlan: 'Plan Futuro Plus',
      productId: 9004,
      productDefaultCode: 'PFUT-020',
      precioPlan: '35000',
      servicioFunerario: 'Servicio intermedio',
    }),
    pago: {
      precioPlan: '35000',
      promocionDescuento: '3',
      anticipo: '4000',
      pagoInicial: '3500',
      plazo: '30',
      importeCadaPago: '1000',
      saldo: '29950',
      frecuencia: 'MENSUAL',
      fechaProximoPago: nextMonthIso(),
      formaPago: 'CHEQUE',
      banco: 'Santander',
      cuenta: '5566778899',
      nombreEmpleado: 'Xavier Ramírez Xol',
      numeroEmpleado: '48291',
      empresaNomina: 'COBAES',
      empresaNominaId: 12,
      infoNomina: 'Quincenal',
      nombreJefeVentas: 'Carlos Mendoza',
    },
    declaraciones: { aceptaMercadotecnia: 'SI', aceptaPublicidad: 'NO' },
  },
  {
    label: 'Claudia Herrera · Parque',
    meta: {
      fecha: todayIso(),
      contrato: '',
      origenVenta: 'exhibition',
      estatus: 'ACTIVO',
    },
    contacto: {
      apellidoPaterno: 'Herrera',
      apellidoMaterno: 'Vega',
      nombres: 'Claudia',
      sexo: 'F',
      curp: 'HEVC880630MSLRRL02',
      fechaNacimiento: '1988-06-30',
      factura: 'SI',
      direccion: 'Privada del Sol 12',
      colonia: 'Stase',
      cp: '80100',
      municipio: 'Culiacán',
      estado: 'Sinaloa',
      tipoCobranza: 'DOMICILIADO',
      sindicalizado: 'SI',
      celular1: '6675556677',
      celular2: '6675556678',
      correo: 'sistemas@sanmartin.com.mx',
      estadoCivil: 'CASADO',
    },
    segundoContacto: {
      apellidoPaterno: 'Herrera',
      apellidoMaterno: 'Mora',
      nombres: 'Roberto',
      celular: '6678889900',
      parentesco: 'Esposo',
      fechaNacimiento: '1986-01-25',
    },
    titularSustituto: {
      apellidoPaterno: 'Vega',
      apellidoMaterno: 'Nava',
      nombres: 'Patricia',
      parentesco: 'Madre',
      celular: '6675556699',
      fechaNacimiento: '1962-04-08',
    },
    beneficiarios: [
      {
        apellidoPaterno: 'Herrera',
        apellidoMaterno: 'Herrera',
        nombres: 'Sofía',
        parentesco: 'Hija',
        celular: '6671212121',
        fechaNacimiento: '2012-08-09',
      },
    ],
    ubicacionPlan: mockPlanParque({
      nombrePlan: 'Capilla Familiar',
      productId: 9005,
      productDefaultCode: 'CAP-005',
      precioPlan: '68000',
      preasignacion: true,
      park: {
        parkId: 102,
        parqueFuneral: 'Parque San Martín Navolato',
        sectionId: 202,
        seccion: 'B',
        quadrantId: 302,
        cuadrante: '1',
        spaceId: 402,
        numero: '45',
      },
    }),
    pago: {
      precioPlan: '68000',
      promocionDescuento: '8',
      anticipo: '10000',
      pagoInicial: '8000',
      plazo: '60',
      importeCadaPago: '875',
      saldo: '52560',
      frecuencia: 'MENSUAL',
      fechaProximoPago: nextMonthIso(),
      formaPago: 'TRANSFERENCIA',
      banco: 'BBVA',
      cuenta: '4152313411223344',
      vencimientoTarjeta: '08/28',
      titularTarjeta: 'Claudia Herrera Vega',
      nombreAsesor: 'Ana Ríos',
      nombreJefeVentas: 'Ana Ríos',
    },
    declaraciones: { aceptaMercadotecnia: 'SI', aceptaPublicidad: 'SI' },
    factura: {
      tipoPersona: 'FISICA',
      regimenFiscal: '626',
    },
  },
  {
    label: 'Carlos Morales · Plan futuro',
    meta: {
      fecha: todayIso(),
      contrato: '',
      origenVenta: 'floor_sales',
      estatus: 'ACTIVO',
    },
    contacto: {
      apellidoPaterno: 'Morales',
      apellidoMaterno: 'Cruz',
      nombres: 'Carlos',
      sexo: 'M',
      curp: 'MORC750101HSLNRR02',
      fechaNacimiento: '1975-01-01',
      factura: 'NO',
      direccion: 'Calle México 300',
      colonia: 'Centro',
      cp: '81200',
      municipio: 'Los Mochis',
      estado: 'Sinaloa',
      tipoCobranza: 'VENTANILLA',
      sindicalizado: 'NO',
      celular1: '6681112233',
      correo: 'sistemas@sanmartin.com.mx',
      estadoCivil: 'DIVORCIADO',
    },
    segundoContacto: {
      apellidoPaterno: 'Morales',
      apellidoMaterno: 'Paz',
      nombres: 'Elena',
      celular: '6682223344',
      parentesco: 'Hermana',
      fechaNacimiento: '1978-11-11',
    },
    titularSustituto: {
      apellidoPaterno: 'Morales',
      apellidoMaterno: 'Cruz',
      nombres: 'Francisco',
      parentesco: 'Hermano',
      celular: '6681112244',
      fechaNacimiento: '1972-06-19',
    },
    beneficiarios: [
      {
        apellidoPaterno: 'Morales',
        apellidoMaterno: 'Ruiz',
        nombres: 'Andrés',
        parentesco: 'Hijo',
        celular: '6683334455',
        fechaNacimiento: '2005-02-28',
      },
    ],
    ubicacionPlan: mockPlanFuturo({
      nombrePlan: 'Plan Futuro Oro',
      productId: 9006,
      productDefaultCode: 'PFUT-030',
      precioPlan: '42000',
      servicioFunerario: 'Servicio completo',
    }),
    pago: {
      precioPlan: '42000',
      promocionDescuento: '0',
      anticipo: '6000',
      pagoInicial: '4200',
      plazo: '24',
      importeCadaPago: '1500',
      saldo: '36000',
      frecuencia: 'MENSUAL',
      fechaProximoPago: nextMonthIso(),
      formaPago: 'EFECTIVO',
      nombreJefeVentas: 'Luis Ortega',
    },
    declaraciones: { aceptaMercadotecnia: 'NO', aceptaPublicidad: 'SI' },
  },
  {
    label: 'Gabriela Santos · Parque',
    meta: {
      fecha: todayIso(),
      contrato: '',
      origenVenta: 'agreement',
      estatus: 'REACTIVACION',
    },
    contacto: {
      apellidoPaterno: 'Santos',
      apellidoMaterno: 'Torres',
      nombres: 'Gabriela',
      sexo: 'F',
      curp: 'SATG950520MSLNRL07',
      fechaNacimiento: '1995-05-20',
      factura: 'NO',
      direccion: 'Calle Reforma 77',
      colonia: 'Guasave Centro',
      cp: '81000',
      municipio: 'Guasave',
      estado: 'Sinaloa',
      tipoCobranza: 'VENTANILLA',
      sindicalizado: 'NO',
      celular1: '6875554411',
      correo: 'sistemas@sanmartin.com.mx',
      estadoCivil: 'SOLTERO',
    },
    segundoContacto: {
      apellidoPaterno: 'Santos',
      apellidoMaterno: 'Lira',
      nombres: 'Iván',
      celular: '6875554422',
      parentesco: 'Hermano',
      fechaNacimiento: '1993-07-07',
    },
    titularSustituto: {
      apellidoPaterno: 'Torres',
      apellidoMaterno: 'Peña',
      nombres: 'Alicia',
      parentesco: 'Madre',
      celular: '6875554444',
      fechaNacimiento: '1971-01-30',
    },
    beneficiarios: [
      {
        apellidoPaterno: 'Santos',
        apellidoMaterno: 'Neri',
        nombres: 'Camila',
        parentesco: 'Hija',
        celular: '6875554433',
        fechaNacimiento: '2020-10-10',
      },
    ],
    ubicacionPlan: mockPlanParque({
      nombrePlan: 'Lote Familiar Guasave',
      productId: 9007,
      productDefaultCode: 'PARQ-GSV',
      precioPlan: '39000',
      preasignacion: true,
      park: {
        parkId: 103,
        parqueFuneral: 'Parque Guasave',
        sectionId: 203,
        seccion: 'C',
        quadrantId: 303,
        cuadrante: '2',
        spaceId: 403,
        numero: '9',
      },
    }),
    pago: {
      precioPlan: '39000',
      promocionDescuento: '5',
      anticipo: '4500',
      pagoInicial: '3900',
      plazo: '36',
      importeCadaPago: '904.17',
      saldo: '32550',
      frecuencia: 'MENSUAL',
      fechaProximoPago: nextMonthIso(),
      formaPago: 'TRANSFERENCIA',
      banco: 'HSBC',
      cuenta: '3344556677',
      nombreJefeVentas: 'Carlos Mendoza',
    },
    declaraciones: { aceptaMercadotecnia: 'SI', aceptaPublicidad: 'SI' },
  },
  {
    label: 'Pedro Castro · Plan futuro',
    meta: {
      fecha: todayIso(),
      contrato: '',
      origenVenta: 'inmediate_need',
      estatus: 'MINORIA',
    },
    contacto: {
      apellidoPaterno: 'Castro',
      apellidoMaterno: 'Ulloa',
      nombres: 'Pedro',
      sexo: 'M',
      curp: 'CULP830914HSLRPS09',
      fechaNacimiento: '1983-09-14',
      factura: 'SI',
      direccion: 'Av. Independencia 501',
      colonia: 'Centro',
      cp: '82000',
      municipio: 'Mazatlán',
      estado: 'Sinaloa',
      tipoCobranza: 'DOMICILIADO',
      sindicalizado: 'SI',
      celular1: '6691002003',
      correo: 'sistemas@sanmartin.com.mx',
      estadoCivil: 'CASADO',
    },
    segundoContacto: {
      apellidoPaterno: 'Castro',
      apellidoMaterno: 'Meza',
      nombres: 'Daniela',
      celular: '6691002004',
      parentesco: 'Esposa',
      fechaNacimiento: '1985-04-04',
    },
    titularSustituto: {
      apellidoPaterno: 'Castro',
      apellidoMaterno: 'Ulloa',
      nombres: 'Ricardo',
      parentesco: 'Hermano',
      celular: '6691002006',
      fechaNacimiento: '1980-05-22',
    },
    beneficiarios: [
      {
        apellidoPaterno: 'Castro',
        apellidoMaterno: 'Castro',
        nombres: 'Emilio',
        parentesco: 'Hijo',
        celular: '6691002005',
        fechaNacimiento: '2011-12-12',
      },
    ],
    ubicacionPlan: mockPlanFuturo({
      nombrePlan: 'Plan Futuro Mazatlán',
      productId: 9008,
      productDefaultCode: 'PFUT-MZT',
      precioPlan: '31000',
      servicioFunerario: 'Servicio estándar',
    }),
    pago: {
      precioPlan: '31000',
      promocionDescuento: '2',
      anticipo: '3500',
      pagoInicial: '3100',
      plazo: '20',
      importeCadaPago: '1350',
      saldo: '26880',
      frecuencia: 'MENSUAL',
      fechaProximoPago: nextMonthIso(),
      formaPago: 'TRANSFERENCIA',
      banco: 'Banamex',
      cuenta: '4152313488990011',
      vencimientoTarjeta: '03/30',
      titularTarjeta: 'Pedro Castro Ulloa',
      nombreAsesor: 'Ana Ríos',
      nombreJefeVentas: 'Ana Ríos',
    },
    declaraciones: { aceptaMercadotecnia: 'NO', aceptaPublicidad: 'NO' },
    factura: {
      tipoPersona: 'MORAL',
      razonSocial: 'Transportes Castro del Pacífico SA de CV',
      rfc: 'TCP830914AA1',
      regimenFiscal: '601',
    },
  },
  {
    label: 'Dolores Vargas · Parque',
    meta: {
      fecha: todayIso(),
      contrato: '',
      origenVenta: 'natural_market_sales',
      estatus: 'ACTIVO',
    },
    contacto: {
      apellidoPaterno: 'Vargas',
      apellidoMaterno: 'Ríos',
      nombres: 'Dolores',
      sexo: 'F',
      curp: 'VARG700308MSLRRD07',
      fechaNacimiento: '1970-03-08',
      factura: 'NO',
      direccion: 'Callejón del Río 3',
      colonia: 'Humaya',
      cp: '80020',
      municipio: 'Culiacán',
      estado: 'Sinaloa',
      tipoCobranza: 'VENTANILLA',
      sindicalizado: 'NO',
      celular1: '6673030404',
      correo: 'sistemas@sanmartin.com.mx',
      estadoCivil: 'VIUDO',
    },
    segundoContacto: {
      apellidoPaterno: 'Vargas',
      apellidoMaterno: 'León',
      nombres: 'Manuel',
      celular: '6673030405',
      parentesco: 'Hijo',
      fechaNacimiento: '1995-09-09',
    },
    titularSustituto: {
      apellidoPaterno: 'Ríos',
      apellidoMaterno: 'Beltrán',
      nombres: 'Josefina',
      parentesco: 'Hermana',
      celular: '6673030406',
      fechaNacimiento: '1973-12-01',
    },
    beneficiarios: [
      {
        apellidoPaterno: 'Vargas',
        apellidoMaterno: 'León',
        nombres: 'Manuel',
        parentesco: 'Hijo',
        celular: '6673030405',
        fechaNacimiento: '1995-09-09',
      },
    ],
    ubicacionPlan: mockPlanParque({
      nombrePlan: 'Nicho Familiar',
      productId: 9009,
      productDefaultCode: 'NICH-009',
      precioPlan: '25000',
      preasignacion: true,
      park: {
        parkId: 101,
        parqueFuneral: 'Parque San Martín Culiacán',
        sectionId: 204,
        seccion: 'D',
        quadrantId: 304,
        cuadrante: '4',
        spaceId: 404,
        numero: '210',
      },
    }),
    pago: {
      precioPlan: '25000',
      promocionDescuento: '0',
      anticipo: '2500',
      pagoInicial: '2500',
      plazo: '18',
      importeCadaPago: '1250',
      saldo: '22500',
      frecuencia: 'MENSUAL',
      fechaProximoPago: nextMonthIso(),
      formaPago: 'EFECTIVO',
      nombreJefeVentas: 'Luis Ortega',
    },
    declaraciones: { aceptaMercadotecnia: 'SI', aceptaPublicidad: 'NO' },
  },
  {
    label: 'Luis Nolasco · Nómina UAS',
    meta: {
      fecha: todayIso(),
      contrato: '',
      origenVenta: 'employee_sales',
      estatus: 'ACTIVO',
    },
    contacto: {
      apellidoPaterno: 'Nolasco',
      apellidoMaterno: 'López',
      nombres: 'Luis Miguel',
      sexo: 'M',
      curp: 'NOLM910227HSLRRR00',
      fechaNacimiento: '1991-02-27',
      factura: 'NO',
      direccion: 'Calle Delicias 19',
      colonia: 'Bachigualato',
      cp: '80140',
      municipio: 'Culiacán',
      estado: 'Sinaloa',
      tipoCobranza: 'NOMINA',
      sindicalizado: 'SI',
      celular1: '6679090807',
      correo: 'sistemas@sanmartin.com.mx',
      estadoCivil: 'SOLTERO',
    },
    segundoContacto: {
      apellidoPaterno: 'Nolasco',
      apellidoMaterno: 'Gil',
      nombres: 'Martha',
      celular: '6679090808',
      parentesco: 'Madre',
      fechaNacimiento: '1968-06-06',
    },
    titularSustituto: {
      apellidoPaterno: 'Nolasco',
      apellidoMaterno: 'López',
      nombres: 'Jorge',
      parentesco: 'Hermano',
      celular: '6679090809',
      fechaNacimiento: '1988-10-14',
    },
    beneficiarios: [
      {
        apellidoPaterno: 'Nolasco',
        apellidoMaterno: 'Gil',
        nombres: 'Martha',
        parentesco: 'Madre',
        celular: '6679090808',
        fechaNacimiento: '1968-06-06',
      },
    ],
    ubicacionPlan: mockPlanFuturo({
      nombrePlan: 'Plan Empleado',
      productId: 9010,
      productDefaultCode: 'PFUT-EMP',
      precioPlan: '22000',
      servicioFunerario: 'Servicio estándar',
    }),
    pago: {
      precioPlan: '22000',
      promocionDescuento: '15',
      anticipo: '2000',
      pagoInicial: '2200',
      plazo: '12',
      importeCadaPago: '1416.67',
      saldo: '16700',
      frecuencia: 'MENSUAL',
      fechaProximoPago: nextMonthIso(),
      formaPago: 'TRANSFERENCIA',
      banco: 'BBVA',
      cuenta: '4455667788',
      nombreEmpleado: 'Luis Miguel Nolasco Gil',
      numeroEmpleado: 'UAS-18402',
      empresaNomina: 'UAS',
      empresaNominaId: 1,
      infoNomina: 'Quincenal',
      nombreJefeVentas: 'Carlos Mendoza',
    },
    declaraciones: { aceptaMercadotecnia: 'NO', aceptaPublicidad: 'SI' },
  },
];

function buildFromSeed(seed: DevSaleSeed): SaleFormData {
  const form = mergeSaleForm({
    ...createEmptySaleForm(),
    meta: { ...createEmptySaleForm().meta, ...seed.meta },
    contacto: { ...createEmptySaleForm().contacto, ...seed.contacto },
    segundoContacto: {
      ...createEmptySaleForm().segundoContacto,
      ...seed.segundoContacto,
    },
    beneficiarios: seed.beneficiarios,
    derechohabientes: {
      titularSustituto: seed.titularSustituto,
      primerBeneficiario: seed.beneficiarios[0],
      segundoBeneficiario: seed.beneficiarios[1],
    },
    ubicacionPlan: normalizeUbicacionPlan({
      ...createEmptySaleForm().ubicacionPlan,
      ...seed.ubicacionPlan,
    }),
    pago: applyMockPagoRules(seed.contacto, {
      ...createEmptySaleForm().pago,
      ...seed.pago,
    }),
    declaraciones: seed.declaraciones,
    documentos: {
      ineFrente: mockDoc('ine-frente-mock.png'),
      ineReverso: mockDoc('ine-reverso-mock.png'),
      inePdf: null,
      comprobanteDomicilio: mockDoc('comprobante-mock.png'),
      constanciaSituacionFiscal:
        seed.contacto.factura === 'SI' || seed.factura
          ? mockPdf('constancia-mock.pdf')
          : null,
      tarjetaFrente: seedNeedsCard(seed)
        ? mockDoc('tarjeta-frente-mock.png')
        : null,
      tarjetaReverso: seedNeedsCard(seed)
        ? mockDoc('tarjeta-reverso-mock.png')
        : null,
      tarjetaPdf: null,
      reciboNomina: seedIsNomina(seed)
        ? mockDoc('recibo-nomina-mock.png')
        : null,
      domiciliacionBanorte: seedIsUas(seed)
        ? mockPdf('domiciliacion-banorte-mock.pdf')
        : null,
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
  });
  return form;
}

export function mockConstanciaAttachment(): SaleAttachment {
  return mockPdf('constancia-mock.pdf');
}

export const DEV_SALE_MOCK_COUNT = SEEDS.length;

export function pickRandomDevSaleMock(): {
  label: string;
  form: SaleFormData;
  invoice: Partial<SaleFormData['contacto']>;
} {
  const idx = Math.floor(Math.random() * SEEDS.length);
  const seed = SEEDS[idx]!;
  const form = buildFromSeed(seed);
  return {
    label: seed.label,
    form,
    invoice: mockInvoiceContacto(form.contacto, seed.factura),
  };
}
