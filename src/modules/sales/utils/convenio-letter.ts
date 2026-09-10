import type { SaleFormData } from '../types/sale-form';

export type ConvenioLetterSpec = {
  /** Destinatario tal como va en FO-GEN-SMGF-05. */
  addressee: string;
  /** Atención en el catálogo Odoo, si existe. */
  attention?: string;
  /** El Drive traía carta para esta empresa (o se comparte con otra). */
  fromDrive: boolean;
  /** TREXNE usa “decenal o quincenal” en el formato original. */
  frequencyHint?: string;
  /** Archivos en `/forms/convenio/` extraídos de cada carta del Drive. */
  logoFiles?: string[];
};

/**
 * Destinatarios tomados de las cartas del Drive.
 * Si la empresa no está aquí, se usa el nombre del catálogo.
 */
const BY_ID: Record<number, ConvenioLetterSpec> = {
  2: {
    addressee: 'CENTRO DE CIENCIAS',
    attention: 'JORGE JAVIER ARENAS SÁNCHEZ',
    fromDrive: true,
    logoFiles: ['2.png'],
  },
  3: {
    addressee: 'SERVICIOS DE SALUD DE SINALOA',
    attention: 'ALMA ALICIA MENDOZA SICAIROS',
    fromDrive: true,
    logoFiles: ['3.png'],
  },
  5: {
    addressee: 'SERVICIOS FUNERARIOS A FUTURO.',
    attention: 'ROSALBA LEON',
    fromDrive: true,
    logoFiles: ['5.png'],
  },
  6: {
    addressee: 'GASPASA',
    attention: 'MARCELINO LEON',
    fromDrive: true,
    logoFiles: ['6.png'],
  },
  7: {
    addressee: 'GRUPO FETASA',
    attention: 'MIRIAM TERAN',
    fromDrive: true,
    logoFiles: ['7.png'],
  },
  8: {
    addressee: 'GRUPO ESCOSERRA',
    attention: 'LIC. LYDBET PEREZ VALLE',
    fromDrive: true,
    logoFiles: ['8.png'],
  },
  10: {
    addressee:
      'FERROXCO SA DE CV, EQUIPOS E INOVACION PARA AGRICULTURA Y CONSTRUCCION SA DE CV, VEHICULOS Y MOTORES SA DE CV, Y CRAZY MOTORES Y VEHICULOS SA DE CV.',
    attention: 'MANUEL FELIX',
    fromDrive: true,
    logoFiles: ['10.png'],
  },
  11: {
    addressee: 'SERDI',
    attention: 'MARITZA GRISELDA BOJORQUEZ ALBA',
    fromDrive: true,
    logoFiles: ['11.png'],
  },
  12: {
    addressee: 'COLEGIO DE BACHILLERES DEL ESTADO DE SINALOA',
    attention: 'JENNIFER OSUNA GUERRERO',
    fromDrive: true,
    logoFiles: ['12.png'],
  },
  13: {
    addressee: 'H. AYUNTAMIENTO DE CULIACAN',
    attention: 'SANDRA IBARRA',
    fromDrive: true,
    logoFiles: ['13.png'],
  },
  14: {
    addressee: 'H. AYUNTAMIENTO DE NAVOLATO',
    attention: 'YESELI LOPEZ DELGADO',
    fromDrive: true,
    logoFiles: ['14.png'],
  },
  15: {
    addressee: 'FERRENOR SA DE CV',
    attention: 'ASHLY CHEYENNE ESCARREGA GONZALEZ',
    fromDrive: true,
    logoFiles: ['15.png'],
  },
  16: {
    addressee: 'FRUTERIA LA TAPATIA',
    attention: 'GUADALUPE OJEDA',
    fromDrive: true,
    logoFiles: ['16.png'],
  },
  19: {
    addressee: 'GRUPO MERCURIO',
    attention: 'PAMELA ISABEL CINCO ROMERO',
    fromDrive: true,
    logoFiles: ['19.png'],
  },
  20: {
    addressee:
      'DIFARMER (DIFARMER, BARANETOS, DABRA) OPEFAR (PHARMACEUTIX, FARMASI).',
    attention: 'NEFERTARI SARAHI ARENAS ROMAN',
    fromDrive: true,
    logoFiles: ['20.png'],
  },
  21: {
    addressee:
      'DIFARMER (DIFARMER, BARANETOS, DABRA) OPEFAR (PHARMACEUTIX, FARMASI).',
    attention: 'DIANA LAURA TIRADO GONZALEZ',
    fromDrive: true,
    logoFiles: ['20.png'],
  },
  22: {
    addressee: 'GOBIERNO DEL ESTADO DE SINALOA',
    fromDrive: true,
    logoFiles: ['22.png'],
  },
  26: {
    addressee: 'AXIOMEX SOLUCIONES INTEGRALES',
    fromDrive: true,
  },
  35: {
    addressee:
      'SERVICIOS DE EDUCACION PUBLICA DESENTRALIZADA DEL ESTADO DE SINALOA',
    fromDrive: true,
    logoFiles: ['35.png', '35-b.png'],
  },
  45: {
    addressee: 'HOSPITAL CIVIL DE CULIACAN',
    fromDrive: true,
    logoFiles: ['45.png'],
  },
  63: {
    addressee:
      'SERVICIOS DE EDUCACION PUBLICA DESENTRALIZADA DEL ESTADO DE SINALOA',
    fromDrive: true,
    logoFiles: ['35.png', '35-b.png'],
  },
  66: {
    addressee: 'STASE CULIACAN',
    fromDrive: true,
    logoFiles: ['66.png'],
  },
  71: {
    addressee:
      'FERROXCO SA DE CV, EQUIPOS E INOVACION PARA AGRICULTURA Y CONSTRUCCION SA DE CV, VEHICULOS Y MOTORES SA DE CV, Y CRAZY MOTORES Y VEHICULOS SA DE CV.',
    fromDrive: true,
    logoFiles: ['10.png'],
  },
  72: {
    addressee: 'PINTURAS Y ACABADOS BASA, S.A. DE C.V.',
    attention: 'KARLA TERESA OCHOA VERDUGO',
    fromDrive: true,
    logoFiles: ['72.png'],
  },
  73: {
    addressee: 'CHAPAS Y HERRAJES BASA, S.A. DE C.V.',
    attention: 'HISSEY JAQUELINE ARMENTA PEREZ',
    fromDrive: true,
    logoFiles: ['73.png'],
  },
  74: {
    addressee: 'DM TECNOLOGIAS',
    attention: 'Danitza de Jesús López Medina',
    fromDrive: true,
    logoFiles: ['74.png'],
  },
  75: {
    addressee: 'NOBIS (LEROYS CONSULTING SC)',
    attention: 'Kevyn Yomar Bustamante Macias',
    fromDrive: true,
    logoFiles: ['75.png'],
  },
  77: {
    addressee: 'GRUPO TREXNE',
    attention: 'DEISY JUDITH VALDEZ BELTRAN',
    fromDrive: true,
    frequencyHint: 'DECENAL O QUINCENAL',
    logoFiles: ['77.png'],
  },
};

const FALLBACK_ATTENTION: Record<number, string> = {
  1: 'VICTORIO ROSALES ESTRADA',
  4: 'MARÍA DEL CARMEN LUNA BELMAR',
};

export const UAS_CONVENIO_ID = 1;

export function convenioLetterEmpresaId(form: SaleFormData): number | null {
  const id = Number(form.pago.empresaNominaId);
  return Number.isFinite(id) && id > 0 ? id : null;
}

/** UAS (catálogo id 1) pide tarjeta y domiciliación Banorte además de nómina. */
export function isUasConvenio(form: SaleFormData): boolean {
  const id = convenioLetterEmpresaId(form);
  if (id === UAS_CONVENIO_ID) return true;
  const name = (form.pago.empresaNomina || '').trim().toLocaleUpperCase('es-MX');
  return name === 'UAS';
}

const CATALOG_IDS: Record<string, number> = {
  UAS: 1,
  'C DE CIENCIAS': 2,
  'SERVICIOS DE SALUD DE SINALOA': 3,
  'SENDA DEL RIO A.C.': 4,
  'SAN MARTIN': 5,
  'PROMOTORA SINALOENSE DE GAS S.A. DE C.V': 6,
  FETASA: 7,
  ESCOSERRA: 8,
  FERROX: 10,
  SERDI: 11,
  COBAES: 12,
  'AYUNTAMIENTO CLN': 13,
  'AYUNTAMIENTO NAV': 14,
  FERRENOR: 15,
  'MAYOREO LA TAPATIA': 16,
  'GRUPO MERCURIO': 19,
  DIFARMER: 20,
  OPEFAR: 21,
  MAGISTERIO: 22,
  'AXIOMEX SOLUCIONES INTEGRALES': 26,
  'S.E.P.D.E.S': 35,
  'H. CIVIL': 45,
  SEPYC: 63,
  STASE: 66,
  FEROX: 71,
  'PINTURAS Y ACABADOS BASA, S.A. DE C.V.': 72,
  'CHAPAS Y HERRAJES BASA, S.A. DE C.V.': 73,
  'DM TECNOLOGIAS': 74,
  'NOBIS (LEROYS CONSULTING SC)': 75,
  'GRUPO TREXNE': 77,
};

export function resolveConvenioLetter(
  form: SaleFormData,
): ConvenioLetterSpec | null {
  const catalogName = (form.pago.empresaNomina || '').trim();
  const id =
    convenioLetterEmpresaId(form) ||
    CATALOG_IDS[catalogName.toLocaleUpperCase('es-MX')] ||
    null;
  if (!id && !catalogName) return null;
  const mapped = id ? BY_ID[id] : undefined;
  const attention =
    mapped?.attention || (id ? FALLBACK_ATTENTION[id] : undefined);
  return {
    addressee: mapped?.addressee || catalogName || 'EMPRESA DE CONVENIO',
    attention,
    fromDrive: Boolean(mapped?.fromDrive),
    frequencyHint: mapped?.frequencyHint,
    logoFiles: mapped?.logoFiles,
  };
}
