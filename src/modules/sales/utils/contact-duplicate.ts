import type { SalePersonName } from '../types/sale-form';

export type ContactAddress = {
  direccion?: string | null;
  colonia?: string | null;
  cp?: string | null;
};

function normalizeText(value?: string | null): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9Ññ]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleUpperCase('es-MX');
}

export function sameContactName(
  a: SalePersonName,
  b: SalePersonName,
): boolean {
  const nombresA = normalizeText(a.nombres);
  const nombresB = normalizeText(b.nombres);
  const paternoA = normalizeText(a.apellidoPaterno);
  const paternoB = normalizeText(b.apellidoPaterno);
  if (!nombresA || !nombresB || !paternoA || !paternoB) return false;
  return (
    nombresA === nombresB &&
    paternoA === paternoB &&
    normalizeText(a.apellidoMaterno) === normalizeText(b.apellidoMaterno)
  );
}

/** Misma calle; colonia y C.P. no contradicen (si ambos los traen, deben coincidir). */
export function sameContactAddress(
  a: ContactAddress,
  b: ContactAddress,
): boolean {
  const dirA = normalizeText(a.direccion);
  const dirB = normalizeText(b.direccion);
  if (!dirA || !dirB || dirA !== dirB) return false;
  const colA = normalizeText(a.colonia);
  const colB = normalizeText(b.colonia);
  if (colA && colB && colA !== colB) return false;
  const cpA = String(a.cp ?? '').replace(/\D/g, '');
  const cpB = String(b.cp ?? '').replace(/\D/g, '');
  if (cpA && cpB && cpA !== cpB) return false;
  return true;
}

export function titularSegundoDuplicateMessages(
  titular: SalePersonName & ContactAddress,
  segundo: SalePersonName & ContactAddress,
): string[] {
  const messages: string[] = [];
  if (sameContactName(titular, segundo)) {
    messages.push(
      'El nombre del 2.º contacto no puede ser el mismo que el del titular.',
    );
  }
  if (sameContactAddress(titular, segundo)) {
    messages.push(
      'El domicilio del 2.º contacto no puede ser el mismo que el del titular.',
    );
  }
  return messages;
}
