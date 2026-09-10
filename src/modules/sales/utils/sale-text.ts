/** Texto de captura: mayúsculas es-MX, sin alterar correos, fechas ni montos. */

const SKIP_KEYS = new Set([
  'correo',
  'fecha',
  'fechaServicio',
  'fechaNacimiento',
  'fechaProximoPago',
  'celular',
  'celular1',
  'celular2',
  'cp',
  'precioPlan',
  'promocionDescuento',
  'anticipo',
  'pagoInicial',
  'plazo',
  'importeCadaPago',
  'saldo',
  'montoRecibido',
  'cambio',
  'dataBase64',
  'mime',
  'driveFileId',
  'driveFileUrl',
  'productDefaultCode',
  'folioSolicitud',
  'planKind',
  'origenVenta',
  'tipoVenta',
  'estatus',
  'matchType',
  'cuenta',
  'cuentaPago',
  'cvv',
  'vencimientoTarjeta',
  'parentesco',
]);

const SKIP_INPUT_TYPES = new Set([
  'email',
  'date',
  'number',
  'checkbox',
  'radio',
  'file',
  'hidden',
  'password',
  'tel',
]);

export function toSaleUppercase(value: string): string {
  return value.toLocaleUpperCase('es-MX');
}

export function isUppercaseCaptureControl(
  el: EventTarget | null,
): el is HTMLInputElement | HTMLTextAreaElement {
  if (!(el instanceof HTMLInputElement) && !(el instanceof HTMLTextAreaElement)) {
    return false;
  }
  if (el instanceof HTMLInputElement) {
    const type = (el.type || 'text').toLowerCase();
    if (SKIP_INPUT_TYPES.has(type)) return false;
    const mode = (el.inputMode || '').toLowerCase();
    if (mode === 'numeric' || mode === 'decimal' || mode === 'tel') return false;
  }
  return true;
}

/** Pasa a mayúsculas el valor del input antes de que Vue lo escriba en el modelo. */
export function forceCaptureTextUppercase(event: Event) {
  const el = event.target;
  if (!isUppercaseCaptureControl(el)) return;
  const next = toSaleUppercase(el.value);
  if (el.value === next) return;
  const start = el.selectionStart;
  const end = el.selectionEnd;
  el.value = next;
  if (start == null || end == null) return;
  try {
    el.setSelectionRange(start, end);
  } catch {
    /* algunos tipos de input no permiten selección */
  }
}

export function uppercaseSaleFormText<T>(value: T): T {
  uppercaseDeep(value, '');
  return value;
}

function uppercaseDeep(value: unknown, key: string): void {
  if (!value || typeof value !== 'object') return;
  if (key === 'documentos') return;
  if (Array.isArray(value)) {
    for (const item of value) uppercaseDeep(item, key);
    return;
  }
  const rec = value as Record<string, unknown>;
  for (const [childKey, child] of Object.entries(rec)) {
    if (typeof child === 'string') {
      if (!SKIP_KEYS.has(childKey) && child) {
        rec[childKey] = toSaleUppercase(child);
      }
      continue;
    }
    uppercaseDeep(child, childKey);
  }
}
