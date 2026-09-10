<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { extractApiError, http } from '../../../shared/api/http';
import { useDialog } from '../../../shared/ui/dialog';
import VdModal from '../../../shared/ui/modal/VdModal.vue';
import VdSelect, {
  type VdSelectOption,
} from '../../../shared/ui/select/VdSelect.vue';
import SalePdfPreviewModal from '../components/SalePdfPreviewModal.vue';
import SalePlanSearchModal, {
  type PlanProduct,
} from '../components/SalePlanSearchModal.vue';
import SaleLocationSearchModal, {
  type ParkLocationSelection,
} from '../components/SaleLocationSearchModal.vue';
import SaleKindModal from '../components/SaleKindModal.vue';
import { SALE_ORIGIN_OPTIONS } from '../constants/sale-origins';
import {
  FISCAL_REGIMEN_CARTA,
  FISCAL_REGIMEN_OTRO,
  FISCAL_REGIMEN_OTROS,
  TIPO_PERSONA_OPTIONS,
  isValidRfc,
  regimenSelectValue,
} from '../constants/fiscal-regimes';
import {
  BANK_OPTIONS,
  BANK_OTHER,
  isOtherBank,
} from '../constants/mexican-banks';
import {
  cardExpiryError,
  cobranzaMissing,
  digitsOnly,
  formatCardNumber,
  isLikelyEmail,
  normalizeCardExpiry,
  normalizeTipoCobranza,
  TIPO_COBRANZA_OPTIONS,
} from '../utils/payment-method';
import {
  parseSaleKind,
  saleKindLabel,
  saleKindToEstatus,
  type SaleKind,
} from '../constants/sale-kinds';
import type { SaleBranch, SellerDefaults } from '../types/seller-defaults';
import { emptySellerDefaults } from '../types/seller-defaults';
import {
  createEmptySaleForm,
  DEFAULT_SERVICIO_FUNERARIO,
  emptyBeneficiary,
  formatDigitalFolio,
  mergeSaleForm,
  hasIneDocumentos,
  normalizePagoDefaults,
  syncBeneficiariosToDerechos,
  fullName,
  titularDisplayName,
  type ReuseGroup,
  type SaleFormData,
  type SaleListItem,
  type SaleStatus,
} from '../types/sale-form';
import { isUasConvenio } from '../utils/convenio-letter';
import { CURP_OFFICIAL_URL, isValidCurp } from '../utils/curp';
import {
  sameContactAddress,
  sameContactName,
  titularSegundoDuplicateMessages,
} from '../utils/contact-duplicate';
import {
  isEmptyOrValidMxPhone,
  isValidMxPhone,
  mxPhoneError,
  normalizeMxPhone,
} from '../utils/phone';
import {
  mockConstanciaAttachment,
  pickRandomDevSaleMock,
} from '../utils/dev-sale-mocks';
import {
  applyCatalogClienteToForm,
  clienteDisplayName,
  searchCatalogClientes,
  type CatalogCliente,
} from '../utils/odoo-clientes';
import { takePendingRecognition } from '../utils/pending-recognition';
import {
  patchSellerPrefetch,
  prefetchSellerSession,
  readSellerPrefetch,
} from '../utils/seller-session-cache';
import { fetchPlanesByIds } from '../utils/odoo-plans';
import {
  computeFinancingBreakdown,
  formatMoneyDisplay,
  formatMoneyField,
  normalizeFrequency,
  parseDiscountPct,
  parseMoney,
  totalRecognizedPaid,
} from '../utils/sale-finance';
import {
  fileToAttachment,
  fileToPdfAttachment,
} from '../utils/file-to-attachment';
import {
  buildCardSidesAttachment,
  buildIneSidesAttachment,
} from '../utils/card-sides-pdf';
import { useAuthStore } from '../../auth/stores/auth.store';
import {
  clampIsoDateMin,
  isIsoDateBefore,
  todayIsoDate,
} from '../../../shared/utils/datetime';
import {
  forceCaptureTextUppercase,
  toSaleUppercase,
  uppercaseSaleFormText,
} from '../utils/sale-text';

const isDev = import.meta.env.DEV;
const auth = useAuthStore();
const sellerAsesorName = computed(() => auth.user?.fullName?.trim() || '');
const sellerJefeVentasName = computed(
  () => auth.user?.nombreJefeVentas?.trim() || '',
);

const STEPS = [
  { key: 'meta', title: 'Contrato', short: 'Contrato' },
  { key: 'titular', title: 'Datos de contacto', short: 'Contacto' },
  { key: 'titularSustituto', title: 'Titular sustituto', short: 'Tit. sust.' },
  { key: 'beneficiarios', title: 'Beneficiarios', short: 'Benef.' },
  { key: 'segundo', title: '2.º contacto', short: '2.º cont.' },
  { key: 'plan', title: 'Plan', short: 'Plan' },
  { key: 'docs', title: 'Documentos', short: 'Docs' },
] as const;

/** Mientras sea true, el tipo de servicio queda en Ventas a futuro y no se edita. */
const SERVICE_TYPE_LOCKED = true;

const DEV_PREFILL_EXTRAS = [
  { key: 'factura', title: 'Datos de factura', short: 'Factura' },
] as const;

type StepKey = (typeof STEPS)[number]['key'];
type InnerTab = 'personales' | 'domicilio' | 'factura';
type PlanInnerTab = 'plan' | 'financiamiento' | 'metodoPago';
type DocsInnerTab = 'subir' | 'vista';

const route = useRoute();
const router = useRouter();
const { alert, confirm } = useDialog();

const form = reactive<SaleFormData>(createEmptySaleForm());
const step = ref(0);
const saleId = ref<number | null>(null);
const status = ref<SaleStatus | 'NEW'>('NEW');
const saving = ref(false);
const submitting = ref(false);
const loading = ref(false);
const previewOpen = ref(false);
const cartaPreviewOpen = ref(false);
const cartaNoFacturaPreviewOpen = ref(false);
const cartaExclusionesPreviewOpen = ref(false);
const reglamentoParquePreviewOpen = ref(false);
const reglamentoParqueFolletoPreviewOpen = ref(false);
const cartaAuthPreviewOpen = ref(false);
const cartaNominaPreviewOpen = ref(false);
const tarjetaPreviewOpen = ref(false);
const inePreviewOpen = ref(false);
const reuseOpen = ref(false);
const kindOpen = ref(false);
const missingOpen = ref(false);
const missingTitle = ref('');
const missingItems = ref<string[]>([]);
const devPrefillOpen = ref(false);
const FACTURA_CONTACTO_KEYS = [
  'factura',
  'tipoPersona',
  'razonSocial',
  'rfc',
  'facturaCp',
  'regimenFiscal',
  'regimenFiscalOtro',
  'telefonoFactura',
] as const;

const devPrefillSteps = reactive({
  meta: true,
  titular: true,
  titularSustituto: true,
  beneficiarios: true,
  segundo: true,
  plan: true,
  docs: true,
  factura: true,
});
const references = ref<SaleListItem[]>([]);
const reuseSource = ref<'vd' | 'catalogo'>('vd');
const reuseGroups = reactive<Record<ReuseGroup, boolean>>({
  contacto: true,
  segundoContacto: true,
  titularSustituto: true,
  beneficiarios: true,
});
const selectedRefId = ref<number | null>(null);
const vdQ = ref('');
const vdLoading = ref(false);
const vdError = ref<string | null>(null);
const catalogQ = ref('');
const catalogLoading = ref(false);
const catalogError = ref<string | null>(null);
const catalogResults = ref<CatalogCliente[]>([]);
const selectedCatalogId = ref<number | null>(null);
const canApplyReuse = computed(() =>
  reuseSource.value === 'catalogo'
    ? Boolean(selectedCatalogId.value)
    : Boolean(selectedRefId.value),
);
let vdTimer: ReturnType<typeof setTimeout> | null = null;
let catalogTimer: ReturnType<typeof setTimeout> | null = null;
const draftLimit = ref(3);
const draftTtlHours = ref(24);
const allowedDiscountMax = ref(0);
const maxDiscountAmount = ref(0);
const descuentoEspecial = ref(0);

const titularInnerTab = ref<InnerTab>('personales');
const segundoInnerTab = ref<InnerTab>('personales');
const planInnerTab = ref<PlanInnerTab>('plan');
const docsInnerTab = ref<DocsInnerTab>('subir');
const formOpen = ref(false);

const stepTitle = computed(() => STEPS[step.value]?.title ?? '');
const canEdit = computed(
  () => status.value === 'NEW' || status.value === 'DRAFT',
);
const captureTitle = computed(() => {
  const kind = parseSaleKind(form.meta.tipoVenta) ?? 'NUEVA';
  const kindTitle = saleKindLabel(kind);
  if (!canEdit.value) return kind === 'NUEVA' ? 'Venta' : kindTitle;
  return kind === 'NUEVA' ? 'Nueva venta' : `Nueva venta · ${kindTitle}`;
});
const tipoVentaLabel = computed(() => saleKindLabel(form.meta.tipoVenta));
const showAnterior = computed(() => {
  const kind = parseSaleKind(form.meta.tipoVenta) ?? 'NUEVA';
  return kind !== 'NUEVA';
});

function applySaleKind(kind: SaleKind) {
  form.meta.tipoVenta = kind;
  form.meta.estatus = saleKindToEstatus(kind);
}

function onKindSelect(kind: SaleKind) {
  kindOpen.value = false;
  if (
    kind === 'RECONOCIMIENTO' ||
    kind === 'MEJORA' ||
    kind === 'MINORIA'
  ) {
    void router.replace({
      name: 'vendedor-ventas',
      query: { pick: kind },
    });
    return;
  }
  applySaleKind(kind);
  void router.replace({
    name: route.name ?? 'vendedor-venta-nueva',
    params: route.params,
    query: { ...route.query, tipo: kind },
  });
}

function onKindCancel() {
  kindOpen.value = false;
  if (!saleId.value) {
    void router.replace({ name: 'vendedor-ventas' });
  }
}
const isParque = computed(
  () => form.ubicacionPlan.planKind === 'PARQUE',
);
const isPlanFuturo = computed(
  () => form.ubicacionPlan.planKind === 'PLAN_FUTURO',
);
const planSelected = computed(() => Boolean(form.ubicacionPlan.productId));

const tipoCobranzaNorm = computed(() =>
  normalizeTipoCobranza(form.contacto.tipoCobranza),
);
const isDomiciliado = computed(() => tipoCobranzaNorm.value === 'DOMICILIADO');
const isNomina = computed(() => tipoCobranzaNorm.value === 'NOMINA');
const isUasNomina = computed(() => isNomina.value && isUasConvenio(form));
const needsCardSides = computed(
  () => isDomiciliado.value || isUasNomina.value,
);
const tipoCobranzaOptions = computed(() => TIPO_COBRANZA_OPTIONS);
const empresasConvenio = ref<Array<{ id: number; name: string }>>([]);
const parentescos = ref<SaleBranch[]>([]);
const empresaNominaOptions = computed(() =>
  empresasConvenio.value.map((e) => ({ value: e.id, label: e.name })),
);
const DEFAULT_PARENTESCO_NAMES = [
  'Esposo (A)',
  'Familiar',
  'Amistad',
  'Hermano (A)',
  'Padre',
  'Madre',
  'Hijo (A)',
];

const parentescoOptions = computed<VdSelectOption[]>(() =>
  parentescos.value.map((row) => ({ value: row.id, label: row.name })),
);

const parentescoDefaultOptions = computed<VdSelectOption[]>(() => {
  const byName = new Map(
    parentescos.value.map((row) => [row.name.trim().toLowerCase(), row]),
  );
  const opts: VdSelectOption[] = [];
  for (const name of DEFAULT_PARENTESCO_NAMES) {
    const row = byName.get(name.toLowerCase());
    if (!row) continue;
    opts.push({ value: row.id, label: row.name });
  }
  return opts;
});

function relationSelectValue(person: {
  relationId?: number | null;
  parentesco?: string;
}): number | null {
  if (person.relationId && person.relationId > 0) return person.relationId;
  const name = (person.parentesco || '').trim().toLowerCase();
  if (!name) return null;
  return (
    parentescos.value.find((row) => row.name.trim().toLowerCase() === name)
      ?.id ?? null
  );
}

function onRelationChange(
  person: { relationId: number | null; parentesco: string },
  raw: string | number | null,
) {
  const id = raw == null || raw === '' ? null : Number(raw);
  person.relationId =
    id != null && Number.isFinite(id) && id > 0 ? id : null;
  person.parentesco =
    parentescos.value.find((row) => row.id === person.relationId)?.name ?? '';
}
const empresasConvenioLoaded = ref(false);
const showMetodoBanco = computed(() => isDomiciliado.value);
const metodoBancoChoice = ref('');
const metodoBancoOtro = ref('');
const showMetodoBancoOtro = computed(() =>
  isOtherBank(metodoBancoChoice.value),
);

function syncMetodoBancoFromForm() {
  const bank = (form.pago.banco || '').trim();
  if (!bank) {
    metodoBancoChoice.value = '';
    metodoBancoOtro.value = '';
    return;
  }
  if ((BANK_OPTIONS as readonly string[]).includes(bank)) {
    metodoBancoChoice.value = bank;
    metodoBancoOtro.value = '';
    return;
  }
  metodoBancoChoice.value = BANK_OTHER;
  metodoBancoOtro.value = bank;
}

function applyMetodoBanco() {
  form.pago.banco = isOtherBank(metodoBancoChoice.value)
    ? metodoBancoOtro.value.trim()
    : metodoBancoChoice.value;
}

function onCuentaTarjetaInput(event: Event) {
  const input = event.target as HTMLInputElement;
  const digitsBefore = digitsOnly(
    input.value.slice(0, input.selectionStart ?? input.value.length),
  ).length;
  form.pago.cuenta = digitsOnly(input.value, 16);
  const formatted = formatCardNumber(form.pago.cuenta);
  void nextTick(() => {
    let pos = formatted.length;
    let seen = 0;
    for (let i = 0; i < formatted.length; i += 1) {
      if (formatted[i] === ' ') continue;
      seen += 1;
      if (seen === digitsBefore) {
        pos = i + 1;
        break;
      }
    }
    if (digitsBefore === 0) pos = 0;
    input.setSelectionRange(pos, pos);
  });
}

function onVencimientoInput(event: Event) {
  const input = event.target as HTMLInputElement;
  form.pago.vencimientoTarjeta = normalizeCardExpiry(input.value);
}

function onCvvInput(event: Event) {
  const input = event.target as HTMLInputElement;
  form.pago.cvv = digitsOnly(input.value, 3);
}

const vencimientoError = computed(() => {
  if (form.pago.vencimientoTarjeta.replace(/\D/g, '').length < 4) return '';
  return cardExpiryError(form.pago.vencimientoTarjeta) ?? '';
});

function metodoPagoMissing(): string[] {
  return cobranzaMissing({
    tipoCobranza: form.contacto.tipoCobranza,
    cuenta: form.pago.cuenta,
    vencimientoTarjeta: form.pago.vencimientoTarjeta,
    cvv: form.pago.cvv,
    titularTarjeta: form.pago.titularTarjeta,
    banco: form.pago.banco,
    correo: form.contacto.correo,
    celular1: form.contacto.celular1,
    direccion: form.contacto.direccion,
    empresaNominaId: form.pago.empresaNominaId,
    empresaNomina: form.pago.empresaNomina,
    nombreEmpleado: form.pago.nombreEmpleado,
    numeroEmpleado: form.pago.numeroEmpleado,
  });
}

function prefillNombreEmpleado() {
  if (normalizeTipoCobranza(form.contacto.tipoCobranza) !== 'NOMINA') return;
  if (form.pago.nombreEmpleado.trim()) return;
  const name = fullName(form.contacto);
  if (name) form.pago.nombreEmpleado = name;
}

function onEmpresaNominaChange(raw: string | number | null = form.pago.empresaNominaId) {
  const id = raw == null || raw === '' ? null : Number(raw);
  form.pago.empresaNominaId =
    id != null && Number.isFinite(id) && id > 0 ? id : null;
  const selected = empresasConvenio.value.find(
    (e) => e.id === form.pago.empresaNominaId,
  );
  form.pago.empresaNomina = toSaleUppercase(selected?.name ?? '');
  if (!isUasConvenio(form)) {
    form.documentos.domiciliacionBanorte = null;
  }
}

async function loadEmpresasConvenio() {
  const userId = auth.user?.id;
  const cached = readSellerPrefetch(userId);
  if (cached) {
    empresasConvenio.value = cached.convenioCompanies;
    empresasConvenioLoaded.value = true;
    if (cached.convenioCompanies.length) return;
  }
  if (!userId) {
    empresasConvenioLoaded.value = true;
    return;
  }
  try {
    applySellerPrefetch(await prefetchSellerSession(userId));
  } catch {
    empresasConvenio.value = cached?.convenioCompanies ?? [];
    empresasConvenioLoaded.value = true;
  }
}

const planSearchOpen = ref(false);
const locationSearchOpen = ref(false);
const branches = ref<SaleBranch[]>([]);
const serviceTypes = ref<SaleBranch[]>([]);
const sellerDefaults = ref<SellerDefaults>(emptySellerDefaults());

const favoritePlans = computed(() =>
  form.ubicacionPlan.planKind === 'PARQUE'
    ? sellerDefaults.value.defaultParkPlans
    : sellerDefaults.value.defaultFuturePlans,
);

function applyDefaultBranch() {
  if (form.meta.branchId) return;
  const id = sellerDefaults.value.defaultBranchId;
  if (!id) return;
  form.meta.branchId = id;
  form.meta.branchName = toSaleUppercase(
    sellerDefaults.value.defaultBranchName ||
      branches.value.find((b) => b.id === id)?.name ||
      '',
  );
}

function applyDefaultServiceType() {
  const match = serviceTypes.value.find(
    (t) =>
      t.name.trim().toLocaleLowerCase('es-MX') === 'ventas a futuro',
  );
  if (!match) return;
  if (!SERVICE_TYPE_LOCKED && form.meta.serviceTypeId) return;
  form.meta.serviceTypeId = match.id;
  form.meta.serviceTypeName = toSaleUppercase(match.name);
}

function onBranchChange() {
  const selected = branches.value.find((b) => b.id === form.meta.branchId);
  form.meta.branchName = toSaleUppercase(selected?.name ?? '');
}

function onServiceTypeChange() {
  const selected = serviceTypes.value.find(
    (t) => t.id === form.meta.serviceTypeId,
  );
  form.meta.serviceTypeName = toSaleUppercase(selected?.name ?? '');
}

function applySellerPrefetch(data: {
  defaults: SellerDefaults;
  branches: SaleBranch[];
  serviceTypes: SaleBranch[];
  convenioCompanies?: SaleBranch[];
  parentescos?: SaleBranch[];
}) {
  branches.value = data.branches;
  serviceTypes.value = data.serviceTypes;
  empresasConvenio.value = data.convenioCompanies ?? [];
  empresasConvenioLoaded.value = true;
  parentescos.value = data.parentescos ?? [];
  sellerDefaults.value = { ...emptySellerDefaults(), ...data.defaults };
  if (!saleId.value) applyDefaultBranch();
  applyDefaultServiceType();
}

async function loadSellerDefaults() {
  const userId = auth.user?.id;
  if (!userId) return;
  try {
    applySellerPrefetch(await prefetchSellerSession(userId));
  } catch {
    const cached = readSellerPrefetch(userId);
    if (cached) applySellerPrefetch(cached);
    else {
      branches.value = [];
      serviceTypes.value = [];
      empresasConvenio.value = [];
      parentescos.value = [];
      empresasConvenioLoaded.value = true;
    }
  }
  if (!parentescos.value.length) {
    try {
      const { data } = await http.get<SaleBranch[]>('/odoo/parentescos', {
        skipGlobalLoading: true,
      });
      parentescos.value = Array.isArray(data) ? data : [];
      patchSellerPrefetch({ userId, parentescos: parentescos.value });
    } catch {
      parentescos.value = [];
    }
  }
}

function clearParkLocation() {
  const plan = form.ubicacionPlan;
  plan.parqueFuneral = '';
  plan.seccion = '';
  plan.cuadrante = '';
  plan.numero = '';
  plan.parkId = null;
  plan.sectionId = null;
  plan.quadrantId = null;
  plan.spaceId = null;
}

function clearParkSpaceOnly() {
  const plan = form.ubicacionPlan;
  plan.cuadrante = '';
  plan.numero = '';
  plan.quadrantId = null;
  plan.spaceId = null;
}

/** Al cambiar tipo de plan se limpia el plan Odoo y la ubicación. */
function onPlanKindChange() {
  const plan = form.ubicacionPlan;
  plan.nombrePlan = '';
  plan.productId = null;
  plan.productDefaultCode = '';
  plan.precioPlan = '';
  plan.withoutInterest = false;
  if (plan.planKind !== 'PARQUE') {
    plan.preasignacion = false;
    clearParkLocation();
    if (plan.planKind === 'PLAN_FUTURO' && !plan.servicioFunerario.trim()) {
      plan.servicioFunerario = DEFAULT_SERVICIO_FUNERARIO;
    }
  } else {
    plan.servicioFunerario = '';
  }
  planInnerTab.value = 'plan';
}

function openPlanFinanciamientoTab() {
  if (!planSelected.value) return;
  planInnerTab.value = 'financiamiento';
}

function openPlanMetodoPagoTab() {
  if (!planSelected.value) return;
  planInnerTab.value = 'metodoPago';
}

function onPreasignacionChange() {
  if (!form.ubicacionPlan.preasignacion) clearParkSpaceOnly();
}

async function syncWithoutInterestFromPlan() {
  const id = form.ubicacionPlan.productId;
  const kind = form.ubicacionPlan.planKind;
  if (!id || (kind !== 'PARQUE' && kind !== 'PLAN_FUTURO')) return;
  try {
    const [live] = await fetchPlanesByIds(kind, [id]);
    if (!live) return;
    form.ubicacionPlan.withoutInterest = Boolean(live.withoutInterest);
    recomputeFinancing();
  } catch {
    /* se conserva el valor guardado */
  }
}

function onPlanSelected(plan: PlanProduct) {
  const dest = form.ubicacionPlan;
  dest.nombrePlan = toSaleUppercase(plan.name);
  dest.productId = plan.id;
  dest.productDefaultCode = plan.defaultCode ?? '';
  dest.withoutInterest = Boolean(plan.withoutInterest);
  const price = plan.listPrice > 0 ? String(plan.listPrice) : '';
  dest.precioPlan = price;
  if (price) form.pago.precioPlan = price;
  recomputeSaldo();
  planSearchOpen.value = false;
  void syncWithoutInterestFromPlan();
}

function formatMoneyLabel(raw: string | number) {
  return formatMoneyDisplay(raw) || '—';
}

function planFinancingConfig() {
  return {
    withoutInterest: form.ubicacionPlan.withoutInterest,
  };
}

const recognizedBalance = computed(() =>
  totalRecognizedPaid(form.meta.reconocimientoVentas),
);

function recomputeFinancing() {
  const precio = form.ubicacionPlan.precioPlan || form.pago.precioPlan;
  const breakdown = computeFinancingBreakdown({
    precioPlan: precio,
    descuentoPct: form.pago.promocionDescuento,
    anticipo: form.pago.anticipo,
    frecuencia: form.pago.frecuencia,
    plazo: form.pago.plazo,
    config: planFinancingConfig(),
    recognizedBalance: recognizedBalance.value,
  });
  form.pago.saldo = String(Number(breakdown.saldo.toFixed(2)));
  form.pago.importeCadaPago = formatMoneyField(breakdown.importeCadaPago);
  syncPagoInicialCuota();
}

const pagoInicialActivo = ref(false);

function syncPagoInicialCuota() {
  if (pagoInicialActivo.value) {
    form.pago.pagoInicial = form.pago.importeCadaPago;
  }
}

function restorePagoInicialActivoFromForm() {
  pagoInicialActivo.value = parseMoney(form.pago.pagoInicial) > 0;
  syncPagoInicialCuota();
}

watch(pagoInicialActivo, (active) => {
  if (active) {
    form.pago.pagoInicial = form.pago.importeCadaPago;
  } else {
    form.pago.pagoInicial = '';
  }
});

watch(
  () => form.ubicacionPlan.productId,
  (productId) => {
    if (
      !productId &&
      (planInnerTab.value === 'financiamiento' ||
        planInnerTab.value === 'metodoPago')
    ) {
      planInnerTab.value = 'plan';
    }
  },
);

watch(
  () => form.contacto.tipoCobranza,
  (tipo) => {
    const kind = normalizeTipoCobranza(tipo);
    if (kind === 'DOMICILIADO') {
      if (!form.pago.titularTarjeta.trim()) {
        form.pago.titularTarjeta = fullName(form.contacto);
      }
      form.pago.numeroEmpleado = '';
      form.pago.nombreEmpleado = '';
      form.pago.empresaNomina = '';
      form.pago.empresaNominaId = null;
      form.pago.infoNomina = '';
      form.documentos.reciboNomina = null;
      form.documentos.domiciliacionBanorte = null;
      return;
    }
    form.pago.cuenta = '';
    form.pago.cvv = '';
    form.pago.vencimientoTarjeta = '';
    form.pago.titularTarjeta = '';
    form.pago.banco = '';
    metodoBancoChoice.value = '';
    metodoBancoOtro.value = '';
    if (kind === 'NOMINA') {
      void loadEmpresasConvenio();
      prefillNombreEmpleado();
      return;
    }
    form.documentos.tarjetaFrente = null;
    form.documentos.tarjetaReverso = null;
    form.documentos.tarjetaPdf = null;
    form.documentos.reciboNomina = null;
    form.documentos.domiciliacionBanorte = null;
    form.pago.numeroEmpleado = '';
    form.pago.nombreEmpleado = '';
    form.pago.empresaNomina = '';
    form.pago.empresaNominaId = null;
    form.pago.infoNomina = '';
  },
);

watch(
  () => [
    form.contacto.nombres,
    form.contacto.apellidoPaterno,
    form.contacto.apellidoMaterno,
  ],
  () => {
    prefillNombreEmpleado();
  },
);

watch(metodoBancoChoice, applyMetodoBanco);
watch(metodoBancoOtro, applyMetodoBanco);
watch(() => form.pago.banco, syncMetodoBancoFromForm, { immediate: true });

/** @deprecated alias interno */
function recomputeSaldo() {
  recomputeFinancing();
}

const financingHint = computed(() => {
  const code = normalizeFrequency(form.pago.frecuencia);
  if (!code) return '';
  const n = computeFinancingBreakdown({
    precioPlan: form.ubicacionPlan.precioPlan || form.pago.precioPlan,
    descuentoPct: form.pago.promocionDescuento,
    anticipo: form.pago.anticipo,
    frecuencia: form.pago.frecuencia,
    plazo: form.pago.plazo,
    config: planFinancingConfig(),
    recognizedBalance: recognizedBalance.value,
  }).numberFrequencies;
  if (code === 'CONTADO') {
    return 'Un solo pago por el precio de contado.';
  }
  if (!n) return 'Indica el plazo en meses para calcular la cuota.';
  return `${n} pagos programados`;
});

const financingHintLabel = computed(() =>
  financingHint.value ? `· ${financingHint.value}` : '',
);

const pagoInicialHint = computed(() =>
  pagoInicialActivo.value && form.pago.pagoInicial
    ? `· ${formatMoneyLabel(form.pago.pagoInicial)}`
    : '',
);

const isPagoContado = computed(
  () => normalizeFrequency(form.pago.frecuencia) === 'CONTADO',
);

function onFrecuenciaChange() {
  if (isPagoContado.value) {
    form.pago.plazo = '0';
  }
  recomputeFinancing();
}

function clampDescuento() {
  let pct = parseDiscountPct(form.pago.promocionDescuento);
  if (pct < 0) pct = 0;
  if (pct > 100) pct = 100;
  if (allowedDiscountMax.value > 0 && pct > allowedDiscountMax.value) {
    pct = Math.trunc(allowedDiscountMax.value);
  }
  form.pago.promocionDescuento = String(pct);
  recomputeSaldo();
}

function clampAnticipo() {
  const n = Math.max(0, parseMoney(form.pago.anticipo));
  form.pago.anticipo = n > 0 ? String(Number(n.toFixed(2))) : '0';
  recomputeSaldo();
}

function discountError(): string | null {
  const pct = parseDiscountPct(form.pago.promocionDescuento);
  if (pct < 0) return 'El descuento no puede ser negativo.';
  if (pct > 100) return 'El descuento no puede ser mayor a 100%.';
  if (pct > allowedDiscountMax.value + 0.001) {
    return `El descuento no puede exceder ${allowedDiscountMax.value}%.`;
  }
  return null;
}

watch(
  [
    () => form.ubicacionPlan.precioPlan,
    () => form.pago.precioPlan,
    () => form.pago.promocionDescuento,
    () => form.pago.anticipo,
    () => form.pago.frecuencia,
    () => form.pago.plazo,
    () => form.ubicacionPlan.withoutInterest,
  ],
  () => {
    recomputeFinancing();
  },
);

const pideFactura = computed(() => form.contacto.factura === 'SI');
const rechazaFactura = computed(() => form.contacto.factura === 'NO');

const regimenCartaOptions = FISCAL_REGIMEN_CARTA.map((r) => ({
  value: r.value,
  label: r.label,
}));
const regimenOtroOptions = [
  ...regimenCartaOptions,
  { value: FISCAL_REGIMEN_OTRO, label: 'Otro' },
];
const regimenExtraOptions = FISCAL_REGIMEN_OTROS.map((r) => ({
  value: r.value,
  label: r.label,
}));

function clearFacturaFields() {
  form.contacto.tipoPersona = '';
  form.contacto.razonSocial = '';
  form.contacto.rfc = '';
  form.contacto.facturaCp = '';
  form.contacto.regimenFiscal = '';
  form.contacto.regimenFiscalOtro = '';
  form.contacto.telefonoFactura = '';
}

function prefillFacturaFields() {
  if (!form.contacto.tipoPersona) form.contacto.tipoPersona = 'FISICA';
  if (!form.contacto.razonSocial.trim()) {
    form.contacto.razonSocial = fullName(form.contacto);
  }
  if (!form.contacto.facturaCp.trim()) {
    form.contacto.facturaCp = form.contacto.cp;
  }
  if (!form.contacto.telefonoFactura.trim()) {
    form.contacto.telefonoFactura = form.contacto.celular1;
  }
}

function onRegimenCartaChange(raw: string | number | null) {
  const value = String(raw ?? '');
  if (value === FISCAL_REGIMEN_OTRO) {
    form.contacto.regimenFiscal = FISCAL_REGIMEN_OTRO;
    return;
  }
  form.contacto.regimenFiscal = value;
  form.contacto.regimenFiscalOtro = '';
}

function onRegimenOtroChange(raw: string | number | null) {
  const value = String(raw ?? '');
  form.contacto.regimenFiscalOtro = value;
  if (value) form.contacto.regimenFiscal = FISCAL_REGIMEN_OTRO;
}

watch(
  () => form.contacto.factura,
  (value) => {
    if (value === 'SI') {
      prefillFacturaFields();
      titularInnerTab.value = 'factura';
      return;
    }
    form.documentos.constanciaSituacionFiscal = null;
    clearFacturaFields();
    if (titularInnerTab.value === 'factura') {
      titularInnerTab.value = 'personales';
    }
  },
);

function onLocationSelected(loc: ParkLocationSelection) {
  const dest = form.ubicacionPlan;
  dest.parkId = loc.parkId;
  dest.parqueFuneral = toSaleUppercase(loc.parkName);
  dest.sectionId = loc.sectionId;
  dest.seccion = toSaleUppercase(loc.sectionName);
  dest.quadrantId = loc.quadrantId ?? null;
  dest.cuadrante = toSaleUppercase(loc.quadrantName ?? '');
  dest.spaceId = loc.spaceId ?? null;
  dest.numero = toSaleUppercase(loc.spaceName ?? '');
  locationSearchOpen.value = false;
}

function hasText(v?: string | null) {
  return Boolean(v && String(v).trim());
}

function personHasName(p?: {
  nombres?: string;
  apellidoPaterno?: string;
  apellidoMaterno?: string;
}): boolean {
  if (!p) return false;
  return Boolean(
    p.nombres?.trim() ||
      p.apellidoPaterno?.trim() ||
      p.apellidoMaterno?.trim(),
  );
}

function firstBeneficiaryHasName(): boolean {
  return personHasName(form.beneficiarios[0]);
}

const segundoNombreDuplicado = computed(() =>
  sameContactName(form.contacto, form.segundoContacto),
);
const segundoDomicilioDuplicado = computed(() =>
  sameContactAddress(form.contacto, form.segundoContacto),
);

function parkLocationMissing(plan: SaleFormData['ubicacionPlan']): string[] {
  if (plan.planKind !== 'PARQUE') return [];
  const missing: string[] = [];
  if (!plan.parkId) missing.push('Parque');
  if (!plan.sectionId) missing.push('Sección');
  if (plan.preasignacion) {
    if (!plan.quadrantId) missing.push('Cuadrante');
    if (!plan.spaceId) missing.push('Ubicación');
  }
  return missing;
}

function anyText(...vals: Array<string | null | undefined>) {
  return vals.some((v) => hasText(v));
}

/** Hay captura en la sección (aunque aún no esté completa). */
const stepHasData = computed<Record<StepKey, boolean>>(() => {
  const c = form.contacto;
  const sc = form.segundoContacto;
  const ts = form.derechohabientes.titularSustituto;
  const plan = form.ubicacionPlan;
  const pago = form.pago;
  const docs = form.documentos;
  const decl = form.declaraciones;
  return {
    meta:
      anyText(form.meta.origenVenta, form.meta.fechaServicio, form.meta.anterior) ||
      Boolean(form.meta.branchId) ||
      Boolean(form.meta.serviceTypeId) ||
      form.meta.reconocimientoVentas.length > 0,
    titular:
      personHasName(c) ||
      anyText(
        c.curp,
        c.sexo,
        c.fechaNacimiento,
        c.celular1,
        c.celular2,
        c.correo,
        c.direccion,
        c.colonia,
        c.municipio,
        c.estado,
        c.cp,
        c.razonSocial,
        c.rfc,
      ),
    titularSustituto:
      personHasName(ts) ||
      anyText(ts.celular, ts.parentesco, ts.fechaNacimiento),
    beneficiarios: form.beneficiarios.some(
      (b) =>
        personHasName(b) ||
        anyText(b.celular, b.parentesco, b.fechaNacimiento),
    ),
    segundo:
      personHasName(sc) ||
      anyText(
        sc.celular,
        sc.parentesco,
        sc.direccion,
        sc.colonia,
        sc.cp,
        sc.fechaNacimiento,
      ),
    plan:
      Boolean(plan.productId) ||
      anyText(plan.nombrePlan, plan.precioPlan, plan.parqueFuneral) ||
      Boolean(plan.parkId) ||
      anyText(
        pago.frecuencia,
        pago.plazo,
        pago.importeCadaPago,
        pago.formaPago,
        form.contacto.tipoCobranza,
      ) ||
      (hasText(pago.anticipo) && pago.anticipo.trim() !== '0'),
    docs:
      hasIneDocumentos(docs) ||
      Boolean(docs.comprobanteDomicilio) ||
      Boolean(docs.constanciaSituacionFiscal) ||
      Boolean(docs.tarjetaFrente) ||
      Boolean(docs.tarjetaReverso) ||
      Boolean(docs.tarjetaPdf) ||
      Boolean(docs.reciboNomina) ||
      Boolean(docs.domiciliacionBanorte) ||
      anyText(decl.aceptaMercadotecnia, decl.aceptaPublicidad),
  };
});

/** Completitud por sección (check en el menú de pasos). */
const stepComplete = computed<Record<StepKey, boolean>>(() => {
  const c = form.contacto;
  const sc = form.segundoContacto;
  const plan = form.ubicacionPlan;
  const pago = form.pago;
  const parkMissing = parkLocationMissing(plan);
  const parkOk = parkMissing.length === 0;
  const precioOk = parseMoney(plan.precioPlan || pago.precioPlan) > 0;
  const contado = normalizeFrequency(pago.frecuencia) === 'CONTADO';
  const finOk =
    hasText(pago.frecuencia) &&
    (contado || hasText(pago.plazo)) &&
    hasText(pago.fechaProximoPago) &&
    hasText(pago.diasEspecificosPago) &&
    parseMoney(pago.importeCadaPago) > 0 &&
    (contado || hasText(pago.anticipo));
  const descOk = discountError() === null;
  const metodoOk = metodoPagoMissing().length === 0;

  return {
    meta:
      hasText(form.meta.fecha) &&
      hasText(form.meta.origenVenta) &&
      Boolean(form.meta.branchId) &&
      Boolean(form.meta.serviceTypeId),
    titular:
      hasText(c.nombres) &&
      hasText(c.apellidoPaterno) &&
      isValidCurp(c.curp) &&
      hasText(c.fechaNacimiento) &&
      hasText(c.sexo) &&
      isValidMxPhone(c.celular1) &&
      isEmptyOrValidMxPhone(c.celular2) &&
      (!isDomiciliado.value || isLikelyEmail(c.correo)) &&
      (c.factura !== 'SI' ||
        ((c.tipoPersona === 'FISICA' || c.tipoPersona === 'MORAL') &&
          hasText(c.razonSocial) &&
          isValidRfc(c.rfc) &&
          digitsOnly(c.facturaCp).length === 5 &&
          hasText(c.regimenFiscal) &&
          (c.regimenFiscal !== FISCAL_REGIMEN_OTRO ||
            hasText(c.regimenFiscalOtro)) &&
          isValidMxPhone(c.telefonoFactura))) &&
      hasText(c.direccion) &&
      hasText(c.colonia) &&
      hasText(c.municipio) &&
      hasText(c.estado),
    titularSustituto:
      personHasName(form.derechohabientes.titularSustituto) &&
      isEmptyOrValidMxPhone(form.derechohabientes.titularSustituto.celular),
    beneficiarios:
      firstBeneficiaryHasName() &&
      form.beneficiarios.every((b) => isEmptyOrValidMxPhone(b.celular)),
    segundo:
      hasText(sc.nombres) &&
      hasText(sc.apellidoPaterno) &&
      isValidMxPhone(sc.celular) &&
      !sameContactName(form.contacto, sc) &&
      !sameContactAddress(form.contacto, sc),
    plan:
      Boolean(plan.productId) &&
      parkOk &&
      (plan.planKind !== 'PLAN_FUTURO' || hasText(plan.servicioFunerario)) &&
      precioOk &&
      finOk &&
      descOk &&
      metodoOk,
    docs:
      hasIneDocumentos(form.documentos) &&
      Boolean(form.documentos.comprobanteDomicilio) &&
      (!isNomina.value || Boolean(form.documentos.reciboNomina)) &&
      (!needsCardSides.value ||
        (Boolean(form.documentos.tarjetaFrente) &&
          Boolean(form.documentos.tarjetaReverso))) &&
      (!isUasNomina.value || Boolean(form.documentos.domiciliacionBanorte)) &&
      hasText(form.declaraciones.aceptaMercadotecnia) &&
      hasText(form.declaraciones.aceptaPublicidad),
  };
});

function missingFieldsFor(key: StepKey): string[] {
  const missing: string[] = [];
  const c = form.contacto;
  const sc = form.segundoContacto;
  const ts = form.derechohabientes.titularSustituto;
  const plan = form.ubicacionPlan;
  const pago = form.pago;

  if (key === 'meta') {
    if (!hasText(form.meta.fecha)) missing.push('Fecha');
    if (!hasText(form.meta.origenVenta)) missing.push('Origen de venta');
    if (!form.meta.branchId) missing.push('Sucursal');
    if (!form.meta.serviceTypeId) missing.push('Tipo de servicio');
  }

  if (key === 'titular') {
    if (!hasText(c.nombres)) missing.push('Nombres');
    if (!hasText(c.apellidoPaterno)) missing.push('Apellido paterno');
    if (!hasText(c.curp)) missing.push('CURP');
    else if (!isValidCurp(c.curp)) missing.push('CURP válida');
    if (!hasText(c.fechaNacimiento)) missing.push('Fecha de nacimiento');
    if (!hasText(c.sexo)) missing.push('Sexo');
    if (!hasText(c.celular1)) missing.push('Celular 1');
    else if (!isValidMxPhone(c.celular1)) missing.push('Celular 1 válido');
    if (!isEmptyOrValidMxPhone(c.celular2)) missing.push('Celular 2 válido');
    if (isDomiciliado.value) {
      if (!hasText(c.correo)) missing.push('Correo (domiciliación)');
      else if (!isLikelyEmail(c.correo)) missing.push('Correo válido');
    }
    if (!hasText(c.direccion)) missing.push('Dirección');
    if (!hasText(c.colonia)) missing.push('Colonia');
    if (!hasText(c.municipio)) missing.push('Municipio');
    if (!hasText(c.estado)) missing.push('Estado');
    if (c.factura === 'SI') {
      if (c.tipoPersona !== 'FISICA' && c.tipoPersona !== 'MORAL') {
        missing.push('Tipo de persona');
      }
      if (!hasText(c.razonSocial)) missing.push('Razón social');
      if (!hasText(c.rfc)) missing.push('RFC');
      else if (!isValidRfc(c.rfc)) missing.push('RFC válido');
      if (digitsOnly(c.facturaCp).length !== 5) {
        missing.push('C.P. de factura');
      }
      if (!hasText(c.regimenFiscal)) missing.push('Régimen fiscal');
      else if (
        c.regimenFiscal === FISCAL_REGIMEN_OTRO &&
        !hasText(c.regimenFiscalOtro)
      ) {
        missing.push('Otro régimen fiscal');
      }
      if (!hasText(c.telefonoFactura)) missing.push('Teléfono de factura');
      else if (!isValidMxPhone(c.telefonoFactura)) {
        missing.push('Teléfono de factura válido');
      }
    }
  }

  if (key === 'titularSustituto') {
    if (!personHasName(ts)) missing.push('Nombre del titular sustituto');
    if (!isEmptyOrValidMxPhone(ts.celular)) {
      missing.push('Celular del titular sustituto válido');
    }
  }

  if (key === 'beneficiarios') {
    if (!firstBeneficiaryHasName()) {
      missing.push('Nombre del primer beneficiario');
    }
    form.beneficiarios.forEach((b, i) => {
      if (!isEmptyOrValidMxPhone(b.celular)) {
        missing.push(`Celular del beneficiario ${i + 1} válido`);
      }
    });
  }

  if (key === 'segundo') {
    if (!hasText(sc.nombres)) missing.push('Nombres');
    if (!hasText(sc.apellidoPaterno)) missing.push('Apellido paterno');
    if (!hasText(sc.celular)) missing.push('Celular');
    else if (!isValidMxPhone(sc.celular)) missing.push('Celular válido');
    missing.push(
      ...titularSegundoDuplicateMessages(form.contacto, sc),
    );
  }

  if (key === 'plan') {
    if (!plan.productId) missing.push('Plan');
    missing.push(...parkLocationMissing(plan));
    if (plan.planKind === 'PLAN_FUTURO' && !hasText(plan.servicioFunerario)) {
      missing.push('Servicio funerario');
    }
    if (parseMoney(plan.precioPlan || pago.precioPlan) <= 0) {
      missing.push('Precio del plan');
    }
    if (!hasText(pago.frecuencia)) missing.push('Frecuencia');
    const contado = normalizeFrequency(pago.frecuencia) === 'CONTADO';
    if (!contado && !hasText(pago.plazo)) missing.push('Plazo');
    if (!hasText(pago.fechaProximoPago)) missing.push('Fecha del próximo pago');
    if (!hasText(pago.diasEspecificosPago)) {
      missing.push('Días específicos de pago');
    }
    if (parseMoney(pago.importeCadaPago) <= 0) {
      missing.push('Importe de cada pago');
    }
    if (!contado && !hasText(pago.anticipo)) missing.push('Anticipo');
    const descErr = discountError();
    if (descErr) missing.push(descErr);
    missing.push(...metodoPagoMissing());
  }

  if (key === 'docs') {
    if (!hasIneDocumentos(form.documentos)) {
      if (!form.documentos.ineFrente) missing.push('INE (frente)');
      if (!form.documentos.ineReverso) missing.push('INE (reverso)');
    }
    if (!form.documentos.comprobanteDomicilio) {
      missing.push('Comprobante de domicilio');
    }
    if (isNomina.value && !form.documentos.reciboNomina) {
      missing.push('Recibo de nómina más actual');
    }
    if (needsCardSides.value) {
      if (!form.documentos.tarjetaFrente) missing.push('Tarjeta (frente)');
      if (!form.documentos.tarjetaReverso) missing.push('Tarjeta (reverso)');
    }
    if (isUasNomina.value && !form.documentos.domiciliacionBanorte) {
      missing.push('Documento de domiciliación Banorte');
    }
    if (!hasText(form.declaraciones.aceptaMercadotecnia)) {
      missing.push('Aceptación de mercadotecnia');
    }
    if (!hasText(form.declaraciones.aceptaPublicidad)) {
      missing.push('Aceptación de publicidad');
    }
  }

  return missing;
}

const stepsMenu = computed(() =>
  STEPS.map((s, index) => {
    const complete = stepComplete.value[s.key];
    const hasData = complete || stepHasData.value[s.key];
    return {
      ...s,
      index,
      complete,
      hasData,
      missing: missingFieldsFor(s.key),
      statusLabel: complete ? 'Completo' : hasData ? 'Con datos' : 'Pendiente',
    };
  }),
);

const completedCount = computed(
  () => stepsMenu.value.filter((s) => s.complete).length,
);
const progress = computed(
  () => (completedCount.value / STEPS.length) * 100,
);

function allFilledPhonesValid(): boolean {
  const c = form.contacto;
  const phones = [
    c.celular1,
    c.celular2,
    form.segundoContacto.celular,
    form.derechohabientes.titularSustituto.celular,
    ...form.beneficiarios.map((b) => b.celular),
  ];
  return phones.every((p) => isEmptyOrValidMxPhone(p));
}

function firstPhoneError(
  requireMain = true,
): { message: string; step: number } | null {
  const checks: Array<{
    value: string;
    required: boolean;
    label: string;
    step: number;
  }> = [
    {
      value: form.contacto.celular1,
      required: requireMain,
      label: 'Celular 1 del titular',
      step: 1,
    },
    { value: form.contacto.celular2, required: false, label: 'Celular 2 del titular', step: 1 },
    {
      value: form.derechohabientes.titularSustituto.celular,
      required: false,
      label: 'Celular del titular sustituto',
      step: 2,
    },
    ...form.beneficiarios.map((b, i) => ({
      value: b.celular,
      required: false,
      label: `Celular del beneficiario ${i + 1}`,
      step: 3,
    })),
    {
      value: form.segundoContacto.celular,
      required: requireMain,
      label: 'Celular del segundo contacto',
      step: 4,
    },
  ];
  for (const check of checks) {
    const err = mxPhoneError(check.value, check.required);
    if (err) {
      return { message: `${check.label}: ${err}`, step: check.step };
    }
  }
  return null;
}

function onPhoneInput(
  event: Event,
  assign: (value: string) => void,
) {
  assign(normalizeMxPhone((event.target as HTMLInputElement).value));
}

/** Mínimo para poder guardar borrador. */
const canSaveDraft = computed(() => {
  const c = form.contacto;
  if (!hasText(c.nombres) || !hasText(c.apellidoPaterno)) return false;
  if (hasText(c.curp) && !isValidCurp(c.curp)) return false;
  if (!allFilledPhonesValid()) return false;
  return true;
});

/** Todos los pasos listos → se puede guardar como venta (flujo de pago/firma). */
const allStepsComplete = computed(() =>
  STEPS.every((s) => stepComplete.value[s.key]),
);

const firstIncompleteStep = computed(() =>
  stepsMenu.value.find((s) => !s.complete)?.index ?? null,
);

function openStep(index: number) {
  if (index < 0 || index >= STEPS.length) return;
  step.value = index;
  if (index === 1) titularInnerTab.value = 'personales';
  if (index === 3) segundoInnerTab.value = 'personales';
  if (index === 4) planInnerTab.value = 'plan';
  if (index === 6) docsInnerTab.value = 'subir';
  formOpen.value = true;
}

function closeStepForm() {
  formOpen.value = false;
}

function openMissingInfo(s: { title: string; missing: string[] }) {
  missingTitle.value = s.title;
  missingItems.value = s.missing;
  missingOpen.value = true;
}

function syncNombreAsesor() {
  if (sellerAsesorName.value) {
    form.pago.nombreAsesor = sellerAsesorName.value;
  }
  form.pago.nombreJefeVentas = sellerJefeVentasName.value;
}

function syncFolioFromSaleId() {
  if (saleId.value) {
    form.meta.folioSolicitud = formatDigitalFolio(saleId.value);
  }
}

function payloadMeta() {
  syncNombreAsesor();
  syncFolioFromSaleId();
  normalizeFinancingDefaults();
  syncBeneficiariosToDerechos(form);
  uppercaseSaleFormText(form);
  return {
    payload: {
      meta: form.meta,
      contacto: form.contacto,
      segundoContacto: form.segundoContacto,
      beneficiarios: form.beneficiarios,
      derechohabientes: form.derechohabientes,
      ubicacionPlan: form.ubicacionPlan,
      pago: form.pago,
      declaraciones: form.declaraciones,
      documentos: form.documentos,
    },
    titularName: titularDisplayName(form),
    amount: form.pago.precioPlan || '0',
  };
}

function ensureBeneficiarios() {
  if (!form.beneficiarios.length) {
    form.beneficiarios.push(emptyBeneficiary());
  }
}

function validateCurpIfPresent(): string | null {
  const curp = form.contacto.curp?.trim() ?? '';
  if (!curp) return null;
  if (!isValidCurp(curp)) {
    return 'La CURP no es válida. Verifica el formato de 18 caracteres.';
  }
  return null;
}

const minDateToday = computed(() => todayIsoDate());

function clampScheduleDates() {
  const min = todayIsoDate();
  if (form.meta.fecha) {
    form.meta.fecha = clampIsoDateMin(form.meta.fecha, min);
  }
  if (form.meta.fechaServicio) {
    form.meta.fechaServicio = clampIsoDateMin(form.meta.fechaServicio, min);
  }
  if (!form.pago.fechaProximoPago?.trim()) {
    form.pago.fechaProximoPago = min;
  } else {
    form.pago.fechaProximoPago = clampIsoDateMin(form.pago.fechaProximoPago, min);
  }
}

function normalizeFinancingDefaults() {
  Object.assign(form.pago, normalizePagoDefaults(form.pago));
}

function validateScheduleDates(): string | null {
  const min = todayIsoDate();
  if (isIsoDateBefore(form.meta.fecha, min)) {
    return 'La fecha del contrato no puede ser anterior a hoy.';
  }
  if (form.meta.fechaServicio && isIsoDateBefore(form.meta.fechaServicio, min)) {
    return 'La fecha de servicio no puede ser anterior a hoy.';
  }
  if (!hasText(form.pago.fechaProximoPago)) {
    return 'La fecha del próximo pago es obligatoria.';
  }
  if (isIsoDateBefore(form.pago.fechaProximoPago, min)) {
    return 'La fecha del próximo pago no puede ser anterior a hoy.';
  }
  if (!hasText(form.pago.diasEspecificosPago)) {
    return 'Los días específicos de pago son obligatorios.';
  }
  return null;
}

async function loadDraftPolicy() {
  try {
    const { data } = await http.get<{
      draftLimit: number;
      draftTtlHours: number;
      maxDiscountAmount?: number;
      descuentoEspecial?: number;
      allowedDiscountMax?: number;
    }>('/settings/drafts');
    draftLimit.value = data.draftLimit;
    draftTtlHours.value = data.draftTtlHours;
    maxDiscountAmount.value = Number(data.maxDiscountAmount) || 0;
    descuentoEspecial.value = Number(data.descuentoEspecial) || 0;
    allowedDiscountMax.value =
      Number(data.allowedDiscountMax) ||
      Math.max(maxDiscountAmount.value, descuentoEspecial.value);
    applyDescuentoEspecialDefault();
  } catch {
    if (isDev) allowedDiscountMax.value = 100;
  }
}

/** Si hay descuento especial activo, mostrarlo y prellenar si aún no hay % capturado. */
function applyDescuentoEspecialDefault() {
  if (descuentoEspecial.value <= 0 || !canEdit.value) return;
  const current = parseDiscountPct(form.pago.promocionDescuento);
  if (current > 0) return;
  form.pago.promocionDescuento = String(Math.trunc(descuentoEspecial.value));
  recomputeSaldo();
}

async function loadSale(id: number) {
  loading.value = true;
  try {
    const { data } = await http.get<SaleListItem>(`/sales/${id}`);
    saleId.value = data.id;
    status.value = data.status;
    Object.assign(form, mergeSaleForm(data.payload));
    uppercaseSaleFormText(form);
    syncFolioFromSaleId();
    ensureBeneficiarios();
    clampDescuento();
    clampScheduleDates();
    recomputeSaldo();
    restorePagoInicialActivoFromForm();
    syncNombreAsesor();
    prefillNombreEmpleado();
    await syncWithoutInterestFromPlan();
    await refreshIneSidesPdf();
    await refreshCardSidesPdf();
  } catch (e: unknown) {
    await alert({
      title: 'Venta',
      message: extractApiError(e, 'No se pudo cargar la venta'),
      variant: 'danger',
    });
    router.replace({ name: 'vendedor-ventas' });
  } finally {
    loading.value = false;
  }
}

onMounted(async () => {
  void loadDraftPolicy();
  const idParam = route.params.id;
  if (idParam && idParam !== 'nueva') {
    await loadSale(Number(idParam));
  } else {
    ensureBeneficiarios();
    const kind = parseSaleKind(route.query.tipo);
    if (
      kind === 'RECONOCIMIENTO' ||
      kind === 'MEJORA' ||
      kind === 'MINORIA'
    ) {
      const pending = takePendingRecognition();
      if (!pending) {
        void router.replace({
          name: 'vendedor-ventas',
          query: { pick: kind },
        });
        return;
      }
      applySaleKind(kind);
      applyRecognition(pending);
    } else if (kind) {
      applySaleKind(kind);
    } else {
      kindOpen.value = true;
    }
  }
  await auth.refreshMe();
  syncNombreAsesor();
  await loadSellerDefaults();
  prefillNombreEmpleado();
});

function addBeneficiario() {
  if (!canEdit.value) return;
  if (form.beneficiarios.length >= 2) return;
  form.beneficiarios.push(emptyBeneficiary());
}

function removeBeneficiario(index: number) {
  if (!canEdit.value) return;
  if (index !== 1) return;
  if (form.beneficiarios.length < 2) return;
  form.beneficiarios.splice(1, 1);
}

async function saveDraft() {
  if (!canEdit.value) return;

  if (!canSaveDraft.value) {
    await alert({
      title: 'Datos básicos',
      message:
        'Para guardar el borrador captura al menos nombre y apellido paterno del titular. Si capturas CURP o celular, deben ser válidos.',
      variant: 'warning',
    });
    openStep(1);
    titularInnerTab.value = 'personales';
    return;
  }

  const curpError = validateCurpIfPresent();
  if (curpError) {
    await alert({
      title: 'CURP',
      message: curpError,
      variant: 'warning',
    });
    openStep(1);
    titularInnerTab.value = 'personales';
    return;
  }

  if (!allFilledPhonesValid()) {
    const filledErr = firstPhoneError(false);
    await alert({
      title: 'Celular',
      message: filledErr?.message ?? 'Hay un celular inválido.',
      variant: 'warning',
    });
    openStep(filledErr?.step ?? 1);
    return;
  }

  recomputeSaldo();
  const scheduleErr = validateScheduleDates();
  if (scheduleErr) {
    await alert({
      title: 'Fecha inválida',
      message: scheduleErr,
      variant: 'warning',
    });
    if (scheduleErr.includes('contrato')) openStep(0);
    else if (
      scheduleErr.includes('próximo') ||
      scheduleErr.includes('específicos')
    ) {
      openStep(4);
      planInnerTab.value = planSelected.value ? 'financiamiento' : 'plan';
    } else openStep(0);
    clampScheduleDates();
    return;
  }
  const descErr = discountError();
  if (descErr) {
    await alert({
      title: 'Descuento',
      message: descErr,
      variant: 'warning',
    });
    openStep(4);
    planInnerTab.value = planSelected.value ? 'financiamiento' : 'plan';
    return;
  }

  saving.value = true;
  try {
    await refreshIneSidesPdf();
    await refreshCardSidesPdf();
    const body = payloadMeta();
    if (saleId.value) {
      const { data } = await http.patch<SaleListItem>(
        `/sales/${saleId.value}/draft`,
        body,
      );
      saleId.value = data.id;
      status.value = 'DRAFT';
      syncFolioFromSaleId();
    } else {
      const { data } = await http.post<SaleListItem>('/sales/drafts', body);
      saleId.value = data.id;
      status.value = 'DRAFT';
      syncFolioFromSaleId();
      await router.replace({
        name: 'vendedor-venta-editar',
        params: { id: String(data.id) },
      });
    }
    await alert({
      title: 'Borrador',
      message: `Guardado. Caduca en ${draftTtlHours.value} h (máx. ${draftLimit.value} borradores).`,
      variant: 'success',
    });
  } catch (e: unknown) {
    await alert({
      title: 'Borrador',
      message: extractApiError(e, 'No se pudo guardar el borrador'),
      variant: 'danger',
    });
  } finally {
    saving.value = false;
  }
}

async function finalizeSale() {
  if (!canEdit.value) return;

  const duplicateMessages = titularSegundoDuplicateMessages(
    form.contacto,
    form.segundoContacto,
  );
  if (duplicateMessages.length) {
    await alert({
      title: 'Segundo contacto',
      message: duplicateMessages.join('\n'),
      variant: 'warning',
    });
    openStep(4);
    segundoInnerTab.value = segundoNombreDuplicado.value
      ? 'personales'
      : 'domicilio';
    return;
  }

  if (!allStepsComplete.value) {
    const idx = firstIncompleteStep.value ?? 0;
    await alert({
      title: 'Faltan datos',
      message: `Completa el paso "${STEPS[idx]?.title}" antes de guardar la venta.`,
      variant: 'warning',
    });
    openStep(idx);
    return;
  }

  const curp = form.contacto.curp?.trim() ?? '';
  if (!curp || !isValidCurp(curp)) {
    await alert({
      title: 'CURP',
      message: 'La CURP del titular es obligatoria y debe ser válida.',
      variant: 'warning',
    });
    openStep(1);
    titularInnerTab.value = 'personales';
    return;
  }

  const phoneErr = firstPhoneError();
  if (phoneErr) {
    await alert({
      title: 'Celular',
      message: phoneErr.message,
      variant: 'warning',
    });
    openStep(phoneErr.step);
    if (phoneErr.step === 1) titularInnerTab.value = 'personales';
    if (phoneErr.step === 4) segundoInnerTab.value = 'personales';
    return;
  }

  recomputeSaldo();
  const scheduleErr = validateScheduleDates();
  if (scheduleErr) {
    await alert({
      title: 'Fecha inválida',
      message: scheduleErr,
      variant: 'warning',
    });
    if (scheduleErr.includes('contrato')) openStep(0);
    else if (
      scheduleErr.includes('próximo') ||
      scheduleErr.includes('específicos')
    ) {
      openStep(4);
      planInnerTab.value = planSelected.value ? 'financiamiento' : 'plan';
    } else openStep(0);
    clampScheduleDates();
    return;
  }
  const descErr = discountError();
  if (descErr) {
    await alert({
      title: 'Descuento',
      message: descErr,
      variant: 'warning',
    });
    openStep(4);
    planInnerTab.value = planSelected.value ? 'financiamiento' : 'plan';
    return;
  }

  const ok = await confirm({
    title: 'Generar expediente',
    message:
      '¿Confirmas que todos los datos están correctos? La venta pasará a pendiente de pago.',
    variant: 'warning',
    confirmText: 'Generar expediente',
    cancelText: 'Seguir editando',
  });
  if (!ok) return;

  submitting.value = true;
  try {
    await refreshIneSidesPdf();
    await refreshCardSidesPdf();
    const body = payloadMeta();
    const { data } = saleId.value
      ? await http.post<SaleListItem>(`/sales/${saleId.value}/finalize`, body)
      : await http.post<SaleListItem>('/sales/finalize', body);
    status.value = data.status;
    saleId.value = data.id;
    await alert({
      title: 'Venta guardada',
      message: `Venta #${data.id} lista. Continúa con el pago en Mis ventas.`,
      variant: 'success',
    });
    router.replace({ name: 'vendedor-ventas' });
  } catch (e: unknown) {
    await alert({
      title: 'Generar expediente',
      message: extractApiError(e, 'No se pudo generar el expediente'),
      variant: 'danger',
    });
  } finally {
    submitting.value = false;
  }
}

function resetCatalogSearch() {
  if (catalogTimer) clearTimeout(catalogTimer);
  catalogTimer = null;
  catalogQ.value = '';
  catalogResults.value = [];
  catalogError.value = null;
  catalogLoading.value = false;
  selectedCatalogId.value = null;
}

function resetVdSearch() {
  if (vdTimer) clearTimeout(vdTimer);
  vdTimer = null;
  vdQ.value = '';
  references.value = [];
  vdError.value = null;
  vdLoading.value = false;
  selectedRefId.value = null;
}

function openReuse() {
  reuseSource.value = 'vd';
  resetVdSearch();
  resetCatalogSearch();
  reuseOpen.value = true;
}

async function searchVdSales() {
  const term = vdQ.value.trim();
  selectedRefId.value = null;
  if (term.length < 3) {
    references.value = [];
    vdError.value = term ? 'Escribe al menos 3 caracteres' : null;
    return;
  }
  vdLoading.value = true;
  vdError.value = null;
  try {
    const { data } = await http.get<SaleListItem[]>('/sales/reuse', {
      params: { q: term, limit: 20 },
      skipGlobalLoading: true,
    });
    references.value = Array.isArray(data) ? data : [];
    if (!references.value.length) vdError.value = 'Sin coincidencias';
  } catch (e: unknown) {
    references.value = [];
    vdError.value = extractApiError(e, 'No se pudo buscar la venta');
  } finally {
    vdLoading.value = false;
  }
}

function onVdInput() {
  if (vdTimer) clearTimeout(vdTimer);
  vdTimer = setTimeout(() => {
    void searchVdSales();
  }, 350);
}

async function searchCatalog() {
  const term = catalogQ.value.trim();
  selectedCatalogId.value = null;
  if (term.length < 3) {
    catalogResults.value = [];
    catalogError.value = term
      ? 'Escribe al menos 3 caracteres'
      : null;
    return;
  }
  catalogLoading.value = true;
  catalogError.value = null;
  try {
    catalogResults.value = await searchCatalogClientes(term, 20);
    if (!catalogResults.value.length) {
      catalogError.value = 'Sin coincidencias';
    }
  } catch (e: unknown) {
    catalogResults.value = [];
    catalogError.value = extractApiError(e, 'No se pudo buscar el cliente');
  } finally {
    catalogLoading.value = false;
  }
}

function onCatalogInput() {
  if (catalogTimer) clearTimeout(catalogTimer);
  catalogTimer = setTimeout(() => {
    void searchCatalog();
  }, 350);
}

function applyReuse() {
  if (reuseSource.value === 'catalogo') {
    const cliente = catalogResults.value.find(
      (c) => c.id === Number(selectedCatalogId.value),
    );
    if (!cliente) return;
    applyCatalogClienteToForm(form, cliente, reuseGroups);
    ensureBeneficiarios();
    uppercaseSaleFormText(form);
    reuseOpen.value = false;
    return;
  }

  const ref = references.value.find(
    (r) => r.id === Number(selectedRefId.value),
  );
  if (!ref) return;
  const src = mergeSaleForm(ref.payload);
  if (reuseGroups.contacto) Object.assign(form.contacto, src.contacto);
  if (reuseGroups.segundoContacto) {
    Object.assign(form.segundoContacto, src.segundoContacto);
  }
  if (reuseGroups.titularSustituto) {
    Object.assign(
      form.derechohabientes.titularSustituto,
      src.derechohabientes.titularSustituto,
    );
  }
  if (reuseGroups.beneficiarios) {
    form.beneficiarios.splice(
      0,
      form.beneficiarios.length,
      ...src.beneficiarios.map((b) => ({ ...emptyBeneficiary(), ...b })),
    );
    ensureBeneficiarios();
    syncBeneficiariosToDerechos(form);
  }
  uppercaseSaleFormText(form);
  reuseOpen.value = false;
}

function applyRecognition(payload: {
  cliente: CatalogCliente;
  ventas: typeof form.meta.reconocimientoVentas;
}) {
  applyCatalogClienteToForm(form, payload.cliente);
  form.meta.reconocimientoVentas = payload.ventas;
  recomputeSaldo();
  form.meta.anterior = payload.ventas
    .map((v) => String(v.folio || '').trim())
    .filter(Boolean)
    .join(', ')
    .slice(0, 80);
  ensureBeneficiarios();
  uppercaseSaleFormText(form);
}

function openDevPrefill() {
  if (!isDev || !canEdit.value) return;
  devPrefillOpen.value = true;
}

function toggleAllDevPrefill(on: boolean) {
  for (const key of Object.keys(devPrefillSteps) as Array<
    keyof typeof devPrefillSteps
  >) {
    devPrefillSteps[key] = on;
  }
}

async function applyDevPrefill() {
  if (!isDev || !canEdit.value) return;
  const selected = [
    ...STEPS.filter((s) => devPrefillSteps[s.key]),
    ...DEV_PREFILL_EXTRAS.filter((s) => devPrefillSteps[s.key]),
  ];
  if (!selected.length) {
    await alert({
      title: 'Prellenar (dev)',
      message: 'Marca al menos un paso para rellenar.',
      variant: 'warning',
    });
    return;
  }

  const { label, form: mock, invoice } = pickRandomDevSaleMock();
  if (devPrefillSteps.meta) {
    const contrato = form.meta.contrato;
    Object.assign(form.meta, mock.meta);
    form.meta.contrato = contrato;
    applyDefaultServiceType();
  }
  if (devPrefillSteps.titular) {
    const contacto = { ...mock.contacto };
    if (!devPrefillSteps.factura) {
      for (const key of FACTURA_CONTACTO_KEYS) delete contacto[key];
    }
    Object.assign(form.contacto, contacto);
  }
  if (devPrefillSteps.titularSustituto) {
    Object.assign(
      form.derechohabientes.titularSustituto,
      mock.derechohabientes.titularSustituto,
    );
  }
  if (devPrefillSteps.beneficiarios) {
    form.beneficiarios.splice(
      0,
      form.beneficiarios.length,
      ...mock.beneficiarios.map((b) => ({ ...emptyBeneficiary(), ...b })),
    );
    ensureBeneficiarios();
    syncBeneficiariosToDerechos(form);
  }
  if (devPrefillSteps.segundo) {
    Object.assign(form.segundoContacto, mock.segundoContacto);
  }
  if (devPrefillSteps.plan) {
    Object.assign(form.ubicacionPlan, mock.ubicacionPlan);
    Object.assign(form.pago, mock.pago);
    clampDescuento();
    recomputeSaldo();
    restorePagoInicialActivoFromForm();
    if (isNomina.value) {
      void loadEmpresasConvenio();
      prefillNombreEmpleado();
    }
  }
  if (devPrefillSteps.docs) {
    form.documentos.ineFrente = mock.documentos.ineFrente;
    form.documentos.ineReverso = mock.documentos.ineReverso;
    form.documentos.comprobanteDomicilio = mock.documentos.comprobanteDomicilio;
    form.documentos.tarjetaFrente = mock.documentos.tarjetaFrente;
    form.documentos.tarjetaReverso = mock.documentos.tarjetaReverso;
    form.documentos.reciboNomina = mock.documentos.reciboNomina;
    form.documentos.domiciliacionBanorte =
      mock.documentos.domiciliacionBanorte;
    if (!devPrefillSteps.factura) {
      form.documentos.constanciaSituacionFiscal =
        mock.documentos.constanciaSituacionFiscal;
    }
    Object.assign(form.declaraciones, mock.declaraciones);
    await refreshIneSidesPdf();
    await refreshCardSidesPdf();
  }
  if (devPrefillSteps.factura) {
    Object.assign(form.contacto, invoice);
    form.documentos.constanciaSituacionFiscal =
      mock.documentos.constanciaSituacionFiscal ?? mockConstanciaAttachment();
    titularInnerTab.value = 'factura';
  }

  uppercaseSaleFormText(form);
  devPrefillOpen.value = false;
  await alert({
    title: 'Prellenar (dev)',
    message: `Mock: ${label}. Pasos: ${selected.map((s) => s.short).join(', ')}.`,
    variant: 'success',
  });
}

type CaptureDocKind =
  | 'ineFrente'
  | 'ineReverso'
  | 'comprobanteDomicilio'
  | 'constanciaSituacionFiscal'
  | 'tarjetaFrente'
  | 'tarjetaReverso'
  | 'reciboNomina'
  | 'domiciliacionBanorte';

let inePdfSeq = 0;
let cardPdfSeq = 0;

async function refreshIneSidesPdf() {
  const seq = ++inePdfSeq;
  const frente = form.documentos.ineFrente;
  const reverso = form.documentos.ineReverso;
  if (!frente || !reverso) {
    form.documentos.inePdf = null;
    return;
  }
  try {
    const pdf = await buildIneSidesAttachment(frente, reverso);
    if (seq !== inePdfSeq) return;
    form.documentos.inePdf = pdf;
  } catch (e) {
    if (seq !== inePdfSeq) return;
    form.documentos.inePdf = null;
    console.warn('No se pudo armar el PDF de la INE', e);
  }
}

async function refreshCardSidesPdf() {
  const seq = ++cardPdfSeq;
  const frente = form.documentos.tarjetaFrente;
  const reverso = form.documentos.tarjetaReverso;
  if (!frente || !reverso) {
    form.documentos.tarjetaPdf = null;
    return;
  }
  try {
    const pdf = await buildCardSidesAttachment(frente, reverso);
    if (seq !== cardPdfSeq) return;
    form.documentos.tarjetaPdf = pdf;
  } catch (e) {
    if (seq !== cardPdfSeq) return;
    form.documentos.tarjetaPdf = null;
    console.warn('No se pudo armar el PDF de la tarjeta', e);
  }
}

async function onFile(kind: CaptureDocKind, ev: Event) {
  const input = ev.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  try {
    form.documentos[kind] =
      kind === 'constanciaSituacionFiscal'
        ? await fileToPdfAttachment(file)
        : await fileToAttachment(file);
    if (kind === 'ineFrente' || kind === 'ineReverso') {
      await refreshIneSidesPdf();
    }
    if (kind === 'tarjetaFrente' || kind === 'tarjetaReverso') {
      await refreshCardSidesPdf();
    }
  } catch (e: unknown) {
    await alert({
      title: 'Archivo',
      message: e instanceof Error ? e.message : 'Archivo no válido',
      variant: 'warning',
    });
  } finally {
    input.value = '';
  }
}

function clearFile(kind: CaptureDocKind) {
  if (!canEdit.value) return;
  form.documentos[kind] = null;
  if (kind === 'ineFrente' || kind === 'ineReverso') {
    form.documentos.inePdf = null;
  }
  if (kind === 'tarjetaFrente' || kind === 'tarjetaReverso') {
    form.documentos.tarjetaPdf = null;
  }
}

function fileKindLabel(mime?: string) {
  if (!mime) return 'Archivo';
  if (mime.includes('pdf')) return 'PDF';
  if (mime.startsWith('image/')) return 'Imagen';
  return 'Archivo';
}

async function goBack() {
  if (!canEdit.value) {
    router.push({ name: 'vendedor-ventas' });
    return;
  }
  const ok = await confirm({
    title: 'Salir',
    message: '¿Deseas salir? Puedes guardar borrador antes.',
    variant: 'warning',
    confirmText: 'Salir',
    cancelText: 'Quedarme',
  });
  if (ok) router.push({ name: 'vendedor-ventas' });
}
</script>

<template>
  <section class="capture">
    <header class="capture__head">
      <div class="capture__titles">
        <button type="button" class="link-back" @click="goBack">
          ← Mis ventas
        </button>
        <h1>{{ captureTitle }}</h1>
        <p class="capture__meta">
          {{ stepTitle }} · {{ completedCount }}/{{ STEPS.length }} secciones
          completas
        </p>
      </div>
      <div class="capture__head-actions">
        <div class="capture__head-actions-row">
          <button
            v-if="canEdit"
            type="button"
            class="btn btn-ghost btn-compact"
            @click="openReuse"
          >
            Precargar
          </button>
          <button
            type="button"
            class="btn btn-accent btn-compact"
            @click="previewOpen = true"
          >
            Vista previa
          </button>
        </div>
        <div v-if="isDev" class="capture__head-actions-row">
          <button
            v-if="canEdit"
            type="button"
            class="btn btn-ghost btn-compact"
            title="Elige qué pasos rellenar con un mock al azar"
            @click="openDevPrefill"
          >
            Prellenar (dev)
          </button>
          <button
            type="button"
            class="icon-btn"
            title="Credencial (próximamente)"
            aria-label="Credencial (próximamente)"
            disabled
          >
            <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
              <path
                fill="currentColor"
                d="M4 5.5A1.5 1.5 0 0 1 5.5 4h13A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5v-13zM6 8.5a2.5 2.5 0 1 0 5 0 2.5 2.5 0 0 0-5 0zM6.5 14h4a.75.75 0 0 0 0-1.5h-4a.75.75 0 0 0 0 1.5zm0 2.75h3a.75.75 0 0 0 0-1.5h-3a.75.75 0 0 0 0 1.5zM13 9.25h4.5a.75.75 0 0 0 0-1.5H13a.75.75 0 0 0 0 1.5zm0 3h4.5a.75.75 0 0 0 0-1.5H13a.75.75 0 0 0 0 1.5zm0 3h3a.75.75 0 0 0 0-1.5H13a.75.75 0 0 0 0 1.5z"
              />
            </svg>
          </button>
        </div>
      </div>
    </header>

    <div class="progress" aria-hidden="true">
      <div class="progress__bar" :style="{ width: `${progress}%` }" />
    </div>

    <div v-if="loading" class="panel loading">
      <span class="spinner" />
      Cargando…
    </div>

    <nav v-else class="panel step-list" aria-label="Pasos de la venta">
      <header class="step-list__head">
        <h2>Pasos de la venta</h2>
        <p>Toca un paso para capturar o revisar su información.</p>
      </header>
      <ol class="step-list__items">
        <li v-for="s in stepsMenu" :key="s.key">
          <div
            class="step-row"
            :class="{
              complete: s.complete,
              'has-data': s.hasData && !s.complete,
            }"
          >
            <button
              type="button"
              class="step-row__open"
              @click="openStep(s.index)"
            >
              <span class="step-row__mark" aria-hidden="true">
                <svg v-if="s.complete" viewBox="0 0 24 24" fill="none">
                  <path
                    d="M5 12.5l4.5 4.5L19 7.5"
                    stroke="currentColor"
                    stroke-width="2.4"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  />
                </svg>
                <svg
                  v-else-if="s.hasData"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                >
                  <circle cx="12" cy="12" r="5" />
                </svg>
                <template v-else>{{ s.index + 1 }}</template>
              </span>
              <span class="step-row__body">
                <strong>{{ s.title }}</strong>
                <small>{{ s.statusLabel }}</small>
              </span>
              <span class="step-row__chevron" aria-hidden="true">›</span>
            </button>
            <button
              type="button"
              class="step-row__info"
              :title="`Qué falta en ${s.title}`"
              :aria-label="`Qué falta en ${s.title}`"
              @click="openMissingInfo(s)"
            >
              i
            </button>
          </div>
        </li>
      </ol>
    </nav>

    <VdModal
      :open="missingOpen"
      :title="missingTitle"
      @close="missingOpen = false"
    >
      <p v-if="!missingItems.length" class="missing-ok">
        Esta sección ya está completa.
      </p>
      <template v-else>
        <p class="missing-hint">Falta capturar:</p>
        <ul class="missing-list">
          <li v-for="item in missingItems" :key="item">{{ item }}</li>
        </ul>
      </template>
      <template #footer>
        <button
          type="button"
          class="btn btn-primary"
          @click="missingOpen = false"
        >
          Entendido
        </button>
      </template>
    </VdModal>

    <VdModal
      :open="formOpen"
      :title="stepTitle"
      xlarge
      @close="closeStepForm"
    >
      <form
        class="form-panel form-panel--modal"
        @submit.prevent
        @input.capture="forceCaptureTextUppercase"
      >
      <!-- 0 · Contrato -->
      <div v-show="step === 0" class="fields">
        <label>
          Fecha
          <input
            v-model="form.meta.fecha"
            type="date"
            :min="minDateToday"
            :disabled="!canEdit"
            @change="clampScheduleDates"
          />
        </label>
        <label>
          Origen de venta
          <select v-model="form.meta.origenVenta" :disabled="!canEdit">
            <option value="">Selecciona origen…</option>
            <option
              v-for="opt in SALE_ORIGIN_OPTIONS"
              :key="opt.value"
              :value="opt.value"
            >
              {{ opt.label }}
            </option>
          </select>
        </label>
        <label>
          Sucursal
          <select
            :value="form.meta.branchId ?? ''"
            :disabled="!canEdit"
            @change="
              form.meta.branchId = ($event.target as HTMLSelectElement).value
                ? Number(($event.target as HTMLSelectElement).value)
                : null;
              onBranchChange();
            "
          >
            <option value="">Selecciona sucursal…</option>
            <option v-for="b in branches" :key="b.id" :value="b.id">
              {{ b.name }}
            </option>
          </select>
        </label>
        <label>
          Tipo de servicio
          <select
            :value="form.meta.serviceTypeId ?? ''"
            :disabled="!canEdit || SERVICE_TYPE_LOCKED"
            @change="
              form.meta.serviceTypeId = ($event.target as HTMLSelectElement).value
                ? Number(($event.target as HTMLSelectElement).value)
                : null;
              onServiceTypeChange();
            "
          >
            <option value="">Selecciona tipo de servicio…</option>
            <option v-for="t in serviceTypes" :key="t.id" :value="t.id">
              {{ t.name }}
            </option>
          </select>
        </label>
        <label>
          Fecha de servicio
          <input
            v-model="form.meta.fechaServicio"
            type="date"
            :min="minDateToday"
            :disabled="!canEdit"
            @change="clampScheduleDates"
          />
        </label>
        <label>
          Tipo de venta
          <input :value="tipoVentaLabel" disabled />
        </label>
        <label>
          Estatus
          <select v-model="form.meta.estatus" disabled>
            <option value="ACTIVO">Activo</option>
            <option value="MEJORA">Mejora</option>
            <option value="MINORIA">Minoría</option>
            <option value="REACTIVACION">Reactivación</option>
          </select>
        </label>
        <label v-if="showAnterior">
          Anterior
          <input v-model="form.meta.anterior" disabled />
        </label>
      </div>

      <!-- 1 · Titular -->
      <div v-show="step === 1" class="titular-step">
        <div class="tabs" role="tablist" aria-label="Datos del titular">
          <button
            type="button"
            class="tab"
            :class="{ active: titularInnerTab === 'personales' }"
            @click="titularInnerTab = 'personales'"
          >
            Datos personales
          </button>
          <button
            type="button"
            class="tab"
            :class="{ active: titularInnerTab === 'domicilio' }"
            @click="titularInnerTab = 'domicilio'"
          >
            Domicilio
          </button>
          <button
            v-if="pideFactura"
            type="button"
            class="tab"
            :class="{ active: titularInnerTab === 'factura' }"
            @click="titularInnerTab = 'factura'"
          >
            Factura
          </button>
        </div>

        <div v-show="titularInnerTab === 'personales'" class="fields">
          <p class="hint span-2">Identidad</p>
          <label class="span-2">
            Nombre(s)
            <input v-model="form.contacto.nombres" :disabled="!canEdit" />
          </label>
          <div class="field-row">
            <label>
              Apellido paterno
              <input
                v-model="form.contacto.apellidoPaterno"
                :disabled="!canEdit"
              />
            </label>
            <label>
              Apellido materno
              <input
                v-model="form.contacto.apellidoMaterno"
                :disabled="!canEdit"
              />
            </label>
          </div>
          <label class="span-2 curp-field">
            CURP
            <div class="curp-field__row">
              <input
                v-model="form.contacto.curp"
                maxlength="18"
                autocomplete="off"
                :disabled="!canEdit"
              />
              <a
                :href="CURP_OFFICIAL_URL"
                target="_blank"
                rel="noopener noreferrer"
                class="btn btn-ghost btn-compact curp-field__link"
              >
                Obtener CURP
              </a>
            </div>
          </label>
          <div class="field-row">
            <label>
              Fecha de nacimiento
              <input
                v-model="form.contacto.fechaNacimiento"
                type="date"
                :disabled="!canEdit"
              />
            </label>
            <label>
              Sexo
              <select v-model="form.contacto.sexo" :disabled="!canEdit">
                <option value="">—</option>
                <option value="M">M</option>
                <option value="F">F</option>
              </select>
            </label>
          </div>
          <label class="span-2">
            Estado civil
            <select v-model="form.contacto.estadoCivil" :disabled="!canEdit">
              <option value="">—</option>
              <option>SOLTERO</option>
              <option>CASADO</option>
              <option>VIUDO</option>
              <option>DIVORCIADO</option>
              <option>UNION LIBRE</option>
              <option>CONCUBINATO</option>
            </select>
          </label>

          <p class="hint span-2 section-gap">Contacto</p>
          <div class="field-row">
            <label>
              Celular 1
              <input
                :value="form.contacto.celular1"
                inputmode="numeric"
                maxlength="10"
                autocomplete="tel"
                :disabled="!canEdit"
                @input="onPhoneInput($event, (v) => (form.contacto.celular1 = v))"
              />
              <small
                v-if="mxPhoneError(form.contacto.celular1)"
                class="field-error"
              >
                {{ mxPhoneError(form.contacto.celular1) }}
              </small>
            </label>
            <label>
              Celular 2
              <input
                :value="form.contacto.celular2"
                inputmode="numeric"
                maxlength="10"
                autocomplete="tel"
                :disabled="!canEdit"
                @input="onPhoneInput($event, (v) => (form.contacto.celular2 = v))"
              />
              <small
                v-if="mxPhoneError(form.contacto.celular2)"
                class="field-error"
              >
                {{ mxPhoneError(form.contacto.celular2) }}
              </small>
            </label>
          </div>
          <label class="span-2">
            Correo electrónico
            <span v-if="isDomiciliado" class="field-req">Obligatorio en domiciliación</span>
            <input
              v-model="form.contacto.correo"
              type="email"
              :disabled="!canEdit"
            />
            <small
              v-if="isDomiciliado && form.contacto.correo && !isLikelyEmail(form.contacto.correo)"
              class="field-error"
            >
              Escribe un correo válido
            </small>
          </label>

          <p class="hint span-2 section-gap">Datos adicionales</p>
          <div class="field-row">
            <label>
              Factura
              <select v-model="form.contacto.factura" :disabled="!canEdit">
                <option value="">—</option>
                <option value="SI">Sí</option>
                <option value="NO">No</option>
              </select>
            </label>
            <div class="toggle-field">
              <span class="toggle-field__label">Sindicalizado</span>
              <label
                class="toggle"
                :class="{
                  'toggle--on': form.contacto.sindicalizado === 'SI',
                  'toggle--disabled': !canEdit,
                }"
              >
                <input
                  v-model="form.contacto.sindicalizado"
                  type="checkbox"
                  true-value="SI"
                  false-value="NO"
                  :disabled="!canEdit"
                />
                <span class="toggle__track" aria-hidden="true">
                  <span class="toggle__thumb" />
                </span>
                <span class="toggle__text">
                  {{ form.contacto.sindicalizado === 'SI' ? 'Sí' : 'No' }}
                </span>
              </label>
            </div>
          </div>
          <label class="span-2">
            Observaciones
            <textarea
              v-model="form.contacto.observaciones"
              rows="3"
              :disabled="!canEdit"
            />
          </label>
        </div>

        <div v-show="titularInnerTab === 'domicilio'" class="fields">
          <p class="hint span-2">Domicilio</p>
          <label class="span-2">
            Dirección
            <input v-model="form.contacto.direccion" :disabled="!canEdit" />
          </label>
          <div class="field-row">
            <label>
              Colonia
              <input v-model="form.contacto.colonia" :disabled="!canEdit" />
            </label>
            <label>
              C.P.
              <input
                v-model="form.contacto.cp"
                inputmode="numeric"
                :disabled="!canEdit"
              />
            </label>
          </div>
          <div class="field-row">
            <label>
              Municipio
              <input v-model="form.contacto.municipio" :disabled="!canEdit" />
            </label>
            <label>
              Estado
              <input v-model="form.contacto.estado" :disabled="!canEdit" />
            </label>
          </div>
          <label class="span-2">
            Entre calles
            <input v-model="form.contacto.entreCalles" :disabled="!canEdit" />
          </label>
          <label class="span-2">
            Seña particular
            <input
              v-model="form.contacto.senaParticular"
              :disabled="!canEdit"
            />
          </label>

          <p class="hint span-2 section-gap">Datos adicionales</p>
          <label class="span-2">
            Domicilio entrega documentación
            <input
              v-model="form.contacto.domicilioEntregaDocumentacion"
              :disabled="!canEdit"
            />
          </label>
        </div>

        <div v-show="titularInnerTab === 'factura'" class="fields">
          <p class="hint span-2">
            Carta de requerimiento de factura. Escríbela tal cual estás
            registrado en el SAT.
          </p>
          <label>
            Tipo de persona
            <VdSelect
              :model-value="form.contacto.tipoPersona || null"
              :options="[...TIPO_PERSONA_OPTIONS]"
              placeholder="Selecciona"
              :disabled="!canEdit"
              @update:model-value="
                form.contacto.tipoPersona = String($event ?? '')
              "
            />
          </label>
          <label>
            RFC
            <input
              v-model="form.contacto.rfc"
              maxlength="13"
              :disabled="!canEdit"
              placeholder="12 o 13 caracteres"
            />
            <small
              v-if="form.contacto.rfc && !isValidRfc(form.contacto.rfc)"
              class="field-error"
            >
              RFC inválido
            </small>
          </label>
          <label class="span-2">
            Razón social
            <input
              v-model="form.contacto.razonSocial"
              :disabled="!canEdit"
              placeholder="Como aparece en el SAT, sin régimen de capital"
            />
          </label>
          <div class="field-row">
            <label>
              Código postal
              <input
                v-model="form.contacto.facturaCp"
                inputmode="numeric"
                maxlength="5"
                :disabled="!canEdit"
              />
            </label>
            <label>
              Teléfono de contacto
              <input
                :value="form.contacto.telefonoFactura"
                inputmode="numeric"
                maxlength="10"
                autocomplete="tel"
                :disabled="!canEdit"
                @input="
                  onPhoneInput(
                    $event,
                    (v) => (form.contacto.telefonoFactura = v),
                  )
                "
              />
              <small
                v-if="mxPhoneError(form.contacto.telefonoFactura)"
                class="field-error"
              >
                {{ mxPhoneError(form.contacto.telefonoFactura) }}
              </small>
            </label>
          </div>
          <label class="span-2">
            Régimen fiscal
            <VdSelect
              :model-value="regimenSelectValue(form.contacto.regimenFiscal)"
              :options="regimenOtroOptions"
              placeholder="Selecciona"
              :disabled="!canEdit"
              @update:model-value="onRegimenCartaChange"
            />
          </label>
          <label
            v-if="form.contacto.regimenFiscal === FISCAL_REGIMEN_OTRO"
            class="span-2"
          >
            Otro régimen
            <VdSelect
              :model-value="form.contacto.regimenFiscalOtro || null"
              :options="regimenExtraOptions"
              placeholder="Selecciona el régimen"
              searchable
              :disabled="!canEdit"
              @update:model-value="onRegimenOtroChange"
            />
          </label>
        </div>
      </div>

      <!-- 2 · Titular sustituto -->
      <div v-show="step === 2" class="benef-block">
        <p class="hint">
          Titular sustituto (derechohabiente). Es distinto del titular y de
          los beneficiarios.
        </p>
        <div class="benef-card">
          <div class="fields">
            <label>
              Nombre(s)
              <input
                v-model="form.derechohabientes.titularSustituto.nombres"
                :disabled="!canEdit"
              />
            </label>
            <label>
              Apellido paterno
              <input
                v-model="form.derechohabientes.titularSustituto.apellidoPaterno"
                :disabled="!canEdit"
              />
            </label>
            <label>
              Apellido materno
              <input
                v-model="form.derechohabientes.titularSustituto.apellidoMaterno"
                :disabled="!canEdit"
              />
            </label>
            <label>
              Parentesco
              <VdSelect
                :model-value="
                  relationSelectValue(form.derechohabientes.titularSustituto)
                "
                :options="parentescoOptions"
                :default-options="parentescoDefaultOptions"
                placeholder="Selecciona"
                searchable
                search-placeholder="Buscar relación…"
                :disabled="!canEdit"
                @update:model-value="
                  onRelationChange(
                    form.derechohabientes.titularSustituto,
                    $event,
                  )
                "
              />
            </label>
            <label>
              Celular
              <input
                :value="form.derechohabientes.titularSustituto.celular"
                inputmode="numeric"
                maxlength="10"
                autocomplete="tel"
                :disabled="!canEdit"
                @input="
                  onPhoneInput(
                    $event,
                    (v) => (form.derechohabientes.titularSustituto.celular = v),
                  )
                "
              />
              <small
                v-if="mxPhoneError(form.derechohabientes.titularSustituto.celular)"
                class="field-error"
              >
                {{ mxPhoneError(form.derechohabientes.titularSustituto.celular) }}
              </small>
            </label>
            <label>
              Fecha de nacimiento
              <input
                v-model="form.derechohabientes.titularSustituto.fechaNacimiento"
                type="date"
                :disabled="!canEdit"
              />
            </label>
          </div>
        </div>
      </div>

      <!-- 3 · Beneficiarios -->
      <div v-show="step === 3" class="benef-block">
        <p class="hint">
          El primer beneficiario es obligatorio. Puedes agregar uno más
          (máximo 2).
        </p>

        <div
          v-for="(b, index) in form.beneficiarios"
          :key="index"
          class="benef-card"
        >
          <div class="benef-card__head">
            <h3>
              {{ index === 0 ? 'Beneficiario 1 (obligatorio)' : 'Beneficiario 2' }}
            </h3>
            <button
              v-if="canEdit && index === 1"
              type="button"
              class="btn btn-ghost btn-compact"
              @click="removeBeneficiario(index)"
            >
              Quitar
            </button>
          </div>
          <div class="fields">
            <label>
              Nombre(s)
              <input v-model="b.nombres" :disabled="!canEdit" />
            </label>
            <label>
              Apellido paterno
              <input v-model="b.apellidoPaterno" :disabled="!canEdit" />
            </label>
            <label>
              Apellido materno
              <input v-model="b.apellidoMaterno" :disabled="!canEdit" />
            </label>
            <label>
              Parentesco
              <VdSelect
                :model-value="relationSelectValue(b)"
                :options="parentescoOptions"
                :default-options="parentescoDefaultOptions"
                placeholder="Selecciona"
                searchable
                search-placeholder="Buscar relación…"
                :disabled="!canEdit"
                @update:model-value="onRelationChange(b, $event)"
              />
            </label>
            <label>
              Celular
              <input
                :value="b.celular"
                inputmode="numeric"
                maxlength="10"
                autocomplete="tel"
                :disabled="!canEdit"
                @input="onPhoneInput($event, (v) => (b.celular = v))"
              />
              <small v-if="mxPhoneError(b.celular)" class="field-error">
                {{ mxPhoneError(b.celular) }}
              </small>
            </label>
            <label>
              Fecha de nacimiento
              <input
                v-model="b.fechaNacimiento"
                type="date"
                :disabled="!canEdit"
              />
            </label>
          </div>
        </div>

        <button
          v-if="canEdit && form.beneficiarios.length < 2"
          type="button"
          class="btn btn-ghost"
          @click="addBeneficiario"
        >
          Agregar beneficiario
        </button>
      </div>

      <!-- 4 · Segundo contacto -->
      <div v-show="step === 4" class="titular-step">
        <p class="hint">Segundo contacto del titular (residente local)</p>
        <div class="tabs" role="tablist" aria-label="Datos del segundo contacto">
          <button
            type="button"
            class="tab"
            :class="{ active: segundoInnerTab === 'personales' }"
            @click="segundoInnerTab = 'personales'"
          >
            Datos personales
          </button>
          <button
            type="button"
            class="tab"
            :class="{ active: segundoInnerTab === 'domicilio' }"
            @click="segundoInnerTab = 'domicilio'"
          >
            Dirección
          </button>
        </div>

        <div v-show="segundoInnerTab === 'personales'" class="fields">
          <label class="span-2">
            Nombre(s)
            <input v-model="form.segundoContacto.nombres" :disabled="!canEdit" />
            <small v-if="segundoNombreDuplicado" class="field-error">
              No puede ser la misma persona que el titular.
            </small>
          </label>
          <div class="field-row">
            <label>
              Apellido paterno
              <input
                v-model="form.segundoContacto.apellidoPaterno"
                :disabled="!canEdit"
              />
            </label>
            <label>
              Apellido materno
              <input
                v-model="form.segundoContacto.apellidoMaterno"
                :disabled="!canEdit"
              />
            </label>
          </div>
          <div class="field-row">
            <label>
              Parentesco
              <VdSelect
                :model-value="relationSelectValue(form.segundoContacto)"
                :options="parentescoOptions"
                :default-options="parentescoDefaultOptions"
                placeholder="Selecciona"
                searchable
                search-placeholder="Buscar relación…"
                :disabled="!canEdit"
                @update:model-value="
                  onRelationChange(form.segundoContacto, $event)
                "
              />
            </label>
            <label>
              Fecha de nacimiento
              <input
                v-model="form.segundoContacto.fechaNacimiento"
                type="date"
                :disabled="!canEdit"
              />
            </label>
          </div>
          <label class="span-2">
            Celular
            <input
              :value="form.segundoContacto.celular"
              inputmode="numeric"
              maxlength="10"
              autocomplete="tel"
              :disabled="!canEdit"
              @input="onPhoneInput($event, (v) => (form.segundoContacto.celular = v))"
            />
            <small
              v-if="mxPhoneError(form.segundoContacto.celular)"
              class="field-error"
            >
              {{ mxPhoneError(form.segundoContacto.celular) }}
            </small>
          </label>
        </div>

        <div v-show="segundoInnerTab === 'domicilio'" class="fields">
          <label class="span-2">
            Dirección
            <input
              v-model="form.segundoContacto.direccion"
              :disabled="!canEdit"
            />
            <small v-if="segundoDomicilioDuplicado" class="field-error">
              No puede ser el mismo domicilio que el del titular.
            </small>
          </label>
          <div class="field-row">
            <label>
              Colonia
              <input
                v-model="form.segundoContacto.colonia"
                :disabled="!canEdit"
              />
            </label>
            <label>
              C.P.
              <input
                v-model="form.segundoContacto.cp"
                inputmode="numeric"
                :disabled="!canEdit"
              />
            </label>
          </div>
          <label class="span-2">
            Entre calles
            <input
              v-model="form.segundoContacto.entreCalles"
              :disabled="!canEdit"
            />
          </label>
          <label class="span-2">
            Domicilio entrega documentación
            <input
              v-model="form.segundoContacto.domicilioEntregaDocumentacion"
              :disabled="!canEdit"
            />
          </label>
        </div>
      </div>

      <!-- 5 · Plan -->
      <div v-show="step === 5" class="step-scroll">
        <div class="tabs" role="tablist" aria-label="Plan, financiamiento y método de pago">
          <button
            type="button"
            class="tab"
            :class="{ active: planInnerTab === 'plan' }"
            @click="planInnerTab = 'plan'"
          >
            Plan
          </button>
          <button
            type="button"
            class="tab"
            :class="{
              active: planInnerTab === 'financiamiento',
              'tab--disabled': !planSelected,
            }"
            :disabled="!planSelected"
            :title="
              planSelected
                ? undefined
                : 'Selecciona un plan antes de capturar el financiamiento'
            "
            @click="openPlanFinanciamientoTab"
          >
            Financiamiento
          </button>
          <button
            type="button"
            class="tab"
            :class="{
              active: planInnerTab === 'metodoPago',
              'tab--disabled': !planSelected,
            }"
            :disabled="!planSelected"
            :title="
              planSelected
                ? undefined
                : 'Selecciona un plan antes de capturar el tipo de cobranza'
            "
            @click="openPlanMetodoPagoTab"
          >
            Tipo de cobranza
          </button>
        </div>

        <div class="step-scroll__body">
        <div v-show="planInnerTab === 'plan'" class="fields">
          <label class="span-2">
            Tipo de plan
            <select
              v-model="form.ubicacionPlan.planKind"
              :disabled="!canEdit"
              @change="onPlanKindChange"
            >
              <option value="PLAN_FUTURO">Servicio funerario</option>
              <option value="PARQUE">Parque</option>
            </select>
          </label>
          <div class="span-2 plan-name">
            <label class="plan-name__field">
              Nombre del plan
              <input
                v-model="form.ubicacionPlan.nombrePlan"
                readonly
                :placeholder="
                  canEdit ? 'Selecciona un plan con Buscar plan…' : '—'
                "
                class="plan-name__readonly"
                :class="{ 'plan-name__readonly--pick': canEdit }"
                @click="canEdit && (planSearchOpen = true)"
              />
            </label>
            <button
              type="button"
              class="btn btn-ghost plan-name__search"
              :disabled="!canEdit"
              @click="planSearchOpen = true"
            >
              {{ form.ubicacionPlan.productId ? 'Cambiar plan' : 'Buscar plan' }}
            </button>
          </div>
          <p
            v-if="form.ubicacionPlan.productId"
            class="hint span-2 plan-name__meta"
          >
            Plan #{{ form.ubicacionPlan.productId
            }}<template v-if="form.ubicacionPlan.productDefaultCode">
              · {{ form.ubicacionPlan.productDefaultCode }}</template
            >
          </p>
          <label v-if="isPlanFuturo" class="span-2">
            Servicio funerario
            <input
              v-model="form.ubicacionPlan.servicioFunerario"
              :disabled="!canEdit"
            />
          </label>

          <template v-if="isParque">
            <label class="check span-2">
              <input
                v-model="form.ubicacionPlan.preasignacion"
                type="checkbox"
                :disabled="!canEdit"
                @change="onPreasignacionChange"
              />
              Preasignación de ubicación
            </label>

            <div class="span-2 plan-name">
              <button
                type="button"
                class="btn btn-ghost plan-name__search"
                :disabled="!canEdit"
                @click="locationSearchOpen = true"
              >
                {{
                  form.ubicacionPlan.preasignacion
                    ? 'Buscar ubicación'
                    : 'Buscar parque y sección'
                }}
              </button>
            </div>
            <label>
              Parque *
              <input
                :value="form.ubicacionPlan.parqueFuneral"
                readonly
                class="plan-name__readonly"
                placeholder="—"
              />
            </label>
            <label>
              Sección *
              <input
                :value="form.ubicacionPlan.seccion"
                readonly
                class="plan-name__readonly"
                placeholder="—"
              />
            </label>
            <template v-if="form.ubicacionPlan.preasignacion">
              <label>
                Cuadrante *
                <input
                  :value="form.ubicacionPlan.cuadrante"
                  readonly
                  class="plan-name__readonly"
                  placeholder="—"
                />
              </label>
              <label>
                Ubicación *
                <input
                  :value="form.ubicacionPlan.numero"
                  readonly
                  class="plan-name__readonly"
                  placeholder="—"
                />
              </label>
            </template>
          </template>
        </div>

        <div v-show="planInnerTab === 'financiamiento'" class="fields">
          <div
            class="span-2 plan-readonly"
            :class="{
              'plan-readonly--3col':
                form.ubicacionPlan.productId &&
                form.ubicacionPlan.withoutInterest &&
                recognizedBalance <= 0,
            }"
          >
            <div class="plan-readonly__item">
              <span>Precio del plan</span>
              <strong>{{
                formatMoneyLabel(
                  form.ubicacionPlan.precioPlan || form.pago.precioPlan,
                )
              }}</strong>
            </div>
            <div
              v-if="
                form.meta.tipoVenta === 'RECONOCIMIENTO' || recognizedBalance > 0
              "
              class="plan-readonly__item"
            >
              <span>{{
                form.meta.tipoVenta === 'MEJORA' ||
                form.meta.tipoVenta === 'MINORIA'
                  ? 'Saldo a reconocer (cambio de plan)'
                  : 'Saldo a reconocer'
              }}</span>
              <strong>{{ formatMoneyLabel(recognizedBalance) }}</strong>
            </div>
            <div class="plan-readonly__item">
              <span>Saldo</span>
              <strong>{{ formatMoneyLabel(form.pago.saldo) }}</strong>
            </div>
            <div v-if="form.ubicacionPlan.productId" class="plan-readonly__item">
              <span>Financiamiento</span>
              <strong>{{
                form.ubicacionPlan.withoutInterest
                  ? 'Sin intereses'
                  : 'Con intereses'
              }}</strong>
            </div>
          </div>

          <div v-if="descuentoEspecial > 0" class="span-2 descuento-especial">
            <div class="plan-readonly__item">
              <span>Descuento especial autorizado</span>
              <strong>{{ Math.trunc(descuentoEspecial) }}%</strong>
            </div>
            <p class="field-hint">
              Tope estándar: {{ maxDiscountAmount }}%.
              <template v-if="descuentoEspecial > maxDiscountAmount">
                Se marcará como utilizado al generar la venta.
              </template>
            </p>
          </div>

          <label>
            <span class="field-label">
              <span class="field-label__title">Descuento (%)</span>
              <small class="field-hint"
                >· Máximo permitido: {{ allowedDiscountMax }}%</small
              >
            </span>
            <input
              v-model="form.pago.promocionDescuento"
              inputmode="numeric"
              type="number"
              min="0"
              max="100"
              step="1"
              :disabled="!canEdit"
              placeholder="0"
              @blur="clampDescuento"
            />
          </label>
          <label>
            Anticipo
            <input
              v-model="form.pago.anticipo"
              inputmode="decimal"
              :disabled="!canEdit"
              placeholder="0"
              @blur="clampAnticipo"
            />
          </label>
          <label>
            Frecuencia
            <select
              v-model="form.pago.frecuencia"
              :disabled="!canEdit"
              @change="onFrecuenciaChange"
            >
              <option value="">—</option>
              <option>SEMANAL</option>
              <option>QUINCENAL</option>
              <option>MENSUAL</option>
              <option>CONTADO</option>
            </select>
          </label>
          <label>
            Plazo (meses)
            <input
              v-model="form.pago.plazo"
              inputmode="numeric"
              :disabled="!canEdit || isPagoContado"
              placeholder="Ej. 24"
            />
          </label>
          <label>
            <span class="field-label">
              <span class="field-label__title">Importe de cada pago</span>
              <small class="field-hint">{{ financingHintLabel }}</small>
            </span>
            <input
              :value="formatMoneyLabel(form.pago.importeCadaPago)"
              readonly
              class="plan-name__readonly"
              placeholder="—"
            />
          </label>
          <label class="check">
            <input
              v-model="pagoInicialActivo"
              type="checkbox"
              :disabled="!canEdit || parseMoney(form.pago.importeCadaPago) <= 0"
            />
            <span class="field-label field-label--inline">
              <span class="field-label__title">Pago inicial</span>
              <small class="field-hint">{{ pagoInicialHint }}</small>
            </span>
          </label>
          <label>
            Próximo pago *
            <input
              v-model="form.pago.fechaProximoPago"
              type="date"
              :min="minDateToday"
              :disabled="!canEdit"
              required
              @change="clampScheduleDates"
            />
          </label>
          <label>
            Días específicos *
            <input
              v-model="form.pago.diasEspecificosPago"
              :disabled="!canEdit"
              required
              placeholder="Ej. 15 de cada mes"
            />
          </label>
        </div>

        <div v-show="planInnerTab === 'metodoPago'" class="fields">
          <label class="span-2">
            Tipo de cobranza
            <VdSelect
              v-model="form.contacto.tipoCobranza"
              :options="tipoCobranzaOptions"
              :disabled="!canEdit"
              placeholder="Selecciona"
            />
          </label>
          <p v-if="tipoCobranzaNorm === 'OTRO'" class="hint span-2">
            En Otro no se piden datos extra de cobranza.
          </p>

          <template v-if="isDomiciliado">
            <label class="span-2">
              Número de tarjeta *
              <input
                :value="formatCardNumber(form.pago.cuenta)"
                inputmode="numeric"
                autocomplete="off"
                maxlength="19"
                :disabled="!canEdit"
                placeholder="ACCT-000003"
                @input="onCuentaTarjetaInput"
              />
            </label>
            <label>
              Vencimiento *
              <input
                :value="form.pago.vencimientoTarjeta"
                inputmode="numeric"
                autocomplete="off"
                maxlength="5"
                :disabled="!canEdit"
                placeholder="MM/AA"
                @input="onVencimientoInput"
              />
              <small class="field-hint">Mínimo 6 meses de vigencia</small>
              <small v-if="vencimientoError" class="field-error">
                {{ vencimientoError }}
              </small>
            </label>
            <label>
              Dígitos de seguridad *
              <input
                :value="form.pago.cvv"
                type="password"
                inputmode="numeric"
                autocomplete="off"
                maxlength="3"
                :disabled="!canEdit"
                placeholder="***"
                @input="onCvvInput"
              />
            </label>
            <label class="span-2">
              Titular de la tarjeta *
              <input
                v-model="form.pago.titularTarjeta"
                :disabled="!canEdit"
                placeholder="Nombre como aparece en la tarjeta"
              />
            </label>
            <label>
              Celular *
              <input
                v-model="form.contacto.celular1"
                inputmode="numeric"
                maxlength="10"
                :disabled="!canEdit"
              />
            </label>
            <label>
              Correo *
              <input
                v-model="form.contacto.correo"
                type="email"
                :disabled="!canEdit"
              />
            </label>
            <label class="span-2">
              Dirección de domiciliación *
              <input
                v-model="form.contacto.direccion"
                :disabled="!canEdit"
              />
            </label>
          </template>

          <template v-else-if="isNomina">
            <label class="span-2">
              Empresa de convenio *
              <VdSelect
                :model-value="form.pago.empresaNominaId"
                :options="empresaNominaOptions"
                :disabled="!canEdit"
                searchable
                placeholder="Selecciona empresa"
                search-placeholder="Buscar empresa"
                @update:model-value="onEmpresaNominaChange"
              />
              <span
                v-if="empresasConvenioLoaded && !empresasConvenio.length"
                class="hint"
              >
                No se encontraron empresas de convenio.
              </span>
              <span v-else-if="isUasNomina" class="hint">
                UAS también pide tarjeta (frente y reverso) y el documento de
                domiciliación Banorte en Documentos.
              </span>
            </label>
            <label class="span-2">
              Nombre del empleado *
              <input
                v-model="form.pago.nombreEmpleado"
                :disabled="!canEdit"
              />
            </label>
            <label>
              Número de empleado *
              <input
                v-model="form.pago.numeroEmpleado"
                :disabled="!canEdit"
              />
            </label>
            <label class="span-2">
              Información de nómina
              <input
                v-model="form.pago.infoNomina"
                :disabled="!canEdit"
              />
              <small class="field-hint">Opcional</small>
            </label>
          </template>

          <template v-if="showMetodoBanco">
            <label>
              Banco *
              <select
                v-model="metodoBancoChoice"
                :disabled="!canEdit"
              >
                <option value="">—</option>
                <option v-for="b in BANK_OPTIONS" :key="b" :value="b">
                  {{ b }}
                </option>
              </select>
            </label>
            <label v-if="showMetodoBancoOtro" class="span-2">
              Nombre del banco
              <input
                v-model="metodoBancoOtro"
                :disabled="!canEdit"
                placeholder="Escribe el banco"
              />
            </label>
          </template>
        </div>
        </div>
      </div>

      <!-- 6 · Documentos + declaraciones -->
      <div v-show="step === 6" class="docs-step">
        <div class="tabs" role="tablist" aria-label="Documentos">
          <button
            type="button"
            class="tab"
            :class="{ active: docsInnerTab === 'subir' }"
            @click="docsInnerTab = 'subir'"
          >
            Subir
          </button>
          <button
            type="button"
            class="tab"
            :class="{ active: docsInnerTab === 'vista' }"
            @click="docsInnerTab = 'vista'"
          >
            Vista previa
          </button>
        </div>

        <div v-show="docsInnerTab === 'subir'" class="fields docs">
        <div class="upload-grid span-2">
          <div
            class="upload-card"
            :class="{
              'upload-card--filled': form.documentos.ineFrente,
              'upload-card--disabled': !canEdit,
            }"
          >
            <div class="upload-card__icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none">
                <rect
                  x="3"
                  y="5"
                  width="18"
                  height="14"
                  rx="2"
                  stroke="currentColor"
                  stroke-width="1.7"
                />
                <circle cx="8.5" cy="10" r="1.4" fill="currentColor" />
                <path
                  d="M4.5 16l4.2-4.2a1 1 0 0 1 1.4 0L14 16l2.1-2.1a1 1 0 0 1 1.4 0L19.5 16"
                  stroke="currentColor"
                  stroke-width="1.7"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              </svg>
            </div>
            <div class="upload-card__body">
              <strong>INE (frente)</strong>
              <template v-if="form.documentos.ineFrente">
                <span class="upload-card__name">{{
                  form.documentos.ineFrente.name
                }}</span>
                <span class="upload-card__meta">{{
                  fileKindLabel(form.documentos.ineFrente.mime)
                }}</span>
              </template>
              <span v-else class="upload-card__hint"
                >Imagen o PDF del frente. Se junta con el reverso en un PDF de
                una hoja</span
              >
            </div>
            <div class="upload-card__actions">
              <label class="upload-card__btn">
                <input
                  type="file"
                  accept="image/*,.pdf"
                  :disabled="!canEdit"
                  @change="onFile('ineFrente', $event)"
                />
                <span class="upload-card__btn-ui" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none">
                    <path
                      d="M12 16V5M12 5l-3.5 3.5M12 5l3.5 3.5"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    />
                    <path
                      d="M5 16.5V18a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 19 18v-1.5"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                    />
                  </svg>
                </span>
                <span class="upload-card__btn-text">{{
                  form.documentos.ineFrente ? 'Cambiar' : 'Adjuntar'
                }}</span>
              </label>
              <button
                v-if="form.documentos.ineFrente && canEdit"
                type="button"
                class="upload-card__remove"
                @click="clearFile('ineFrente')"
              >
                Quitar
              </button>
            </div>
          </div>

          <div
            class="upload-card"
            :class="{
              'upload-card--filled': form.documentos.ineReverso,
              'upload-card--disabled': !canEdit,
            }"
          >
            <div class="upload-card__icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none">
                <rect
                  x="3"
                  y="5"
                  width="18"
                  height="14"
                  rx="2"
                  stroke="currentColor"
                  stroke-width="1.7"
                />
                <circle cx="8.5" cy="10" r="1.4" fill="currentColor" />
                <path
                  d="M4.5 16l4.2-4.2a1 1 0 0 1 1.4 0L14 16l2.1-2.1a1 1 0 0 1 1.4 0L19.5 16"
                  stroke="currentColor"
                  stroke-width="1.7"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              </svg>
            </div>
            <div class="upload-card__body">
              <strong>INE (reverso)</strong>
              <template v-if="form.documentos.ineReverso">
                <span class="upload-card__name">{{
                  form.documentos.ineReverso.name
                }}</span>
                <span class="upload-card__meta">{{
                  fileKindLabel(form.documentos.ineReverso.mime)
                }}</span>
              </template>
              <span v-else class="upload-card__hint"
                >Imagen o PDF del reverso</span
              >
            </div>
            <div class="upload-card__actions">
              <label class="upload-card__btn">
                <input
                  type="file"
                  accept="image/*,.pdf"
                  :disabled="!canEdit"
                  @change="onFile('ineReverso', $event)"
                />
                <span class="upload-card__btn-ui" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none">
                    <path
                      d="M12 16V5M12 5l-3.5 3.5M12 5l3.5 3.5"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    />
                    <path
                      d="M5 16.5V18a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 19 18v-1.5"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                    />
                  </svg>
                </span>
                <span class="upload-card__btn-text">{{
                  form.documentos.ineReverso ? 'Cambiar' : 'Adjuntar'
                }}</span>
              </label>
              <button
                v-if="form.documentos.ineReverso && canEdit"
                type="button"
                class="upload-card__remove"
                @click="clearFile('ineReverso')"
              >
                Quitar
              </button>
            </div>
          </div>

          <p
            v-if="form.documentos.inePdf"
            class="upload-card__hint span-2"
          >
            Ya se armó el PDF con ambos lados de la INE en una hoja para el
            expediente.
          </p>

          <div
            class="upload-card"
            :class="{
              'upload-card--filled': form.documentos.comprobanteDomicilio,
              'upload-card--disabled': !canEdit,
            }"
          >
            <div class="upload-card__icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none">
                <path
                  d="M7 3.5h7.2L19 8.3V20a1.5 1.5 0 0 1-1.5 1.5h-10A1.5 1.5 0 0 1 6 20V5a1.5 1.5 0 0 1 1-1.5z"
                  stroke="currentColor"
                  stroke-width="1.7"
                  stroke-linejoin="round"
                />
                <path
                  d="M14 3.5V8h5"
                  stroke="currentColor"
                  stroke-width="1.7"
                  stroke-linejoin="round"
                />
                <path
                  d="M9 13h6M9 16.5h4"
                  stroke="currentColor"
                  stroke-width="1.7"
                  stroke-linecap="round"
                />
              </svg>
            </div>
            <div class="upload-card__body">
              <strong>Comprobante de domicilio</strong>
              <template v-if="form.documentos.comprobanteDomicilio">
                <span class="upload-card__name">{{
                  form.documentos.comprobanteDomicilio.name
                }}</span>
                <span class="upload-card__meta">{{
                  fileKindLabel(form.documentos.comprobanteDomicilio.mime)
                }}</span>
              </template>
              <span v-else class="upload-card__hint"
                >Toca para seleccionar imagen o PDF</span
              >
            </div>
            <div class="upload-card__actions">
              <label class="upload-card__btn">
                <input
                  type="file"
                  accept="image/*,.pdf"
                  :disabled="!canEdit"
                  @change="onFile('comprobanteDomicilio', $event)"
                />
                <span class="upload-card__btn-ui" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none">
                    <path
                      d="M12 16V5M12 5l-3.5 3.5M12 5l3.5 3.5"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    />
                    <path
                      d="M5 16.5V18a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 19 18v-1.5"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                    />
                  </svg>
                </span>
                <span class="upload-card__btn-text">{{
                  form.documentos.comprobanteDomicilio ? 'Cambiar' : 'Adjuntar'
                }}</span>
              </label>
              <button
                v-if="form.documentos.comprobanteDomicilio && canEdit"
                type="button"
                class="upload-card__remove"
                @click="clearFile('comprobanteDomicilio')"
              >
                Quitar
              </button>
            </div>
          </div>

          <div
            v-if="isNomina"
            class="upload-card"
            :class="{
              'upload-card--filled': form.documentos.reciboNomina,
              'upload-card--disabled': !canEdit,
            }"
          >
            <div class="upload-card__icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none">
                <path
                  d="M7 3.5h7.2L19 8.3V20a1.5 1.5 0 0 1-1.5 1.5h-10A1.5 1.5 0 0 1 6 20V5a1.5 1.5 0 0 1 1-1.5z"
                  stroke="currentColor"
                  stroke-width="1.7"
                  stroke-linejoin="round"
                />
                <path
                  d="M14 3.5V8h5"
                  stroke="currentColor"
                  stroke-width="1.7"
                  stroke-linejoin="round"
                />
                <path
                  d="M9 13h6M9 16.5h4"
                  stroke="currentColor"
                  stroke-width="1.7"
                  stroke-linecap="round"
                />
              </svg>
            </div>
            <div class="upload-card__body">
              <strong>Recibo de nómina más actual</strong>
              <template v-if="form.documentos.reciboNomina">
                <span class="upload-card__name">{{
                  form.documentos.reciboNomina.name
                }}</span>
                <span class="upload-card__meta">{{
                  fileKindLabel(form.documentos.reciboNomina.mime)
                }}</span>
              </template>
              <span v-else class="upload-card__hint"
                >Último recibo de nómina del empleado. Imagen o PDF</span
              >
            </div>
            <div class="upload-card__actions">
              <label class="upload-card__btn">
                <input
                  type="file"
                  accept="image/*,.pdf"
                  :disabled="!canEdit"
                  @change="onFile('reciboNomina', $event)"
                />
                <span class="upload-card__btn-ui" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none">
                    <path
                      d="M12 16V5M12 5l-3.5 3.5M12 5l3.5 3.5"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    />
                    <path
                      d="M5 16.5V18a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 19 18v-1.5"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                    />
                  </svg>
                </span>
                <span class="upload-card__btn-text">{{
                  form.documentos.reciboNomina ? 'Cambiar' : 'Adjuntar'
                }}</span>
              </label>
              <button
                v-if="form.documentos.reciboNomina && canEdit"
                type="button"
                class="upload-card__remove"
                @click="clearFile('reciboNomina')"
              >
                Quitar
              </button>
            </div>
          </div>

          <div
            v-if="needsCardSides"
            class="upload-card"
            :class="{
              'upload-card--filled': form.documentos.tarjetaFrente,
              'upload-card--disabled': !canEdit,
            }"
          >
            <div class="upload-card__icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none">
                <rect
                  x="3"
                  y="6"
                  width="18"
                  height="12"
                  rx="2"
                  stroke="currentColor"
                  stroke-width="1.7"
                />
                <path d="M3 10h18" stroke="currentColor" stroke-width="1.7" />
              </svg>
            </div>
            <div class="upload-card__body">
              <strong>Tarjeta (frente)</strong>
              <template v-if="form.documentos.tarjetaFrente">
                <span class="upload-card__name">{{
                  form.documentos.tarjetaFrente.name
                }}</span>
                <span class="upload-card__meta">{{
                  fileKindLabel(form.documentos.tarjetaFrente.mime)
                }}</span>
              </template>
              <span v-else class="upload-card__hint"
                >Imagen o PDF del frente. Se junta con el reverso en un PDF de
                una hoja</span
              >
            </div>
            <div class="upload-card__actions">
              <label class="upload-card__btn">
                <input
                  type="file"
                  accept="image/*,.pdf"
                  :disabled="!canEdit"
                  @change="onFile('tarjetaFrente', $event)"
                />
                <span class="upload-card__btn-ui" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none">
                    <path
                      d="M12 16V5M12 5l-3.5 3.5M12 5l3.5 3.5"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    />
                    <path
                      d="M5 16.5V18a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 19 18v-1.5"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                    />
                  </svg>
                </span>
                <span class="upload-card__btn-text">{{
                  form.documentos.tarjetaFrente ? 'Cambiar' : 'Adjuntar'
                }}</span>
              </label>
              <button
                v-if="form.documentos.tarjetaFrente && canEdit"
                type="button"
                class="upload-card__remove"
                @click="clearFile('tarjetaFrente')"
              >
                Quitar
              </button>
            </div>
          </div>

          <div
            v-if="needsCardSides"
            class="upload-card"
            :class="{
              'upload-card--filled': form.documentos.tarjetaReverso,
              'upload-card--disabled': !canEdit,
            }"
          >
            <div class="upload-card__icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none">
                <rect
                  x="3"
                  y="6"
                  width="18"
                  height="12"
                  rx="2"
                  stroke="currentColor"
                  stroke-width="1.7"
                />
                <path d="M7 14h6" stroke="currentColor" stroke-width="1.7" />
              </svg>
            </div>
            <div class="upload-card__body">
              <strong>Tarjeta (reverso)</strong>
              <template v-if="form.documentos.tarjetaReverso">
                <span class="upload-card__name">{{
                  form.documentos.tarjetaReverso.name
                }}</span>
                <span class="upload-card__meta">{{
                  fileKindLabel(form.documentos.tarjetaReverso.mime)
                }}</span>
              </template>
              <span v-else class="upload-card__hint"
                >Imagen o PDF del reverso. Se junta con el frente en un PDF de
                una hoja</span
              >
            </div>
            <div class="upload-card__actions">
              <label class="upload-card__btn">
                <input
                  type="file"
                  accept="image/*,.pdf"
                  :disabled="!canEdit"
                  @change="onFile('tarjetaReverso', $event)"
                />
                <span class="upload-card__btn-ui" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none">
                    <path
                      d="M12 16V5M12 5l-3.5 3.5M12 5l3.5 3.5"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    />
                    <path
                      d="M5 16.5V18a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 19 18v-1.5"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                    />
                  </svg>
                </span>
                <span class="upload-card__btn-text">{{
                  form.documentos.tarjetaReverso ? 'Cambiar' : 'Adjuntar'
                }}</span>
              </label>
              <button
                v-if="form.documentos.tarjetaReverso && canEdit"
                type="button"
                class="upload-card__remove"
                @click="clearFile('tarjetaReverso')"
              >
                Quitar
              </button>
            </div>
          </div>

          <p
            v-if="needsCardSides && form.documentos.tarjetaPdf"
            class="upload-card__hint span-2"
          >
            Ya se armó el PDF con ambos lados en una hoja para el expediente.
          </p>

          <div
            v-if="isUasNomina"
            class="upload-card"
            :class="{
              'upload-card--filled': form.documentos.domiciliacionBanorte,
              'upload-card--disabled': !canEdit,
            }"
          >
            <div class="upload-card__icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none">
                <path
                  d="M7 3.5h7.2L19 8.3V20a1.5 1.5 0 0 1-1.5 1.5h-10A1.5 1.5 0 0 1 6 20V5a1.5 1.5 0 0 1 1-1.5z"
                  stroke="currentColor"
                  stroke-width="1.7"
                  stroke-linejoin="round"
                />
                <path
                  d="M14 3.5V8h5"
                  stroke="currentColor"
                  stroke-width="1.7"
                  stroke-linejoin="round"
                />
                <path
                  d="M9 13h6M9 16.5h4"
                  stroke="currentColor"
                  stroke-width="1.7"
                  stroke-linecap="round"
                />
              </svg>
            </div>
            <div class="upload-card__body">
              <strong>Documento de domiciliación Banorte</strong>
              <template v-if="form.documentos.domiciliacionBanorte">
                <span class="upload-card__name">{{
                  form.documentos.domiciliacionBanorte.name
                }}</span>
                <span class="upload-card__meta">{{
                  fileKindLabel(form.documentos.domiciliacionBanorte.mime)
                }}</span>
              </template>
              <span v-else class="upload-card__hint"
                >Formato Banorte FO-GEN-SMGF-06. Imagen o PDF</span
              >
            </div>
            <div class="upload-card__actions">
              <label class="upload-card__btn">
                <input
                  type="file"
                  accept="image/*,.pdf"
                  :disabled="!canEdit"
                  @change="onFile('domiciliacionBanorte', $event)"
                />
                <span class="upload-card__btn-ui" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none">
                    <path
                      d="M12 16V5M12 5l-3.5 3.5M12 5l3.5 3.5"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    />
                    <path
                      d="M5 16.5V18a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 19 18v-1.5"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                    />
                  </svg>
                </span>
                <span class="upload-card__btn-text">{{
                  form.documentos.domiciliacionBanorte ? 'Cambiar' : 'Adjuntar'
                }}</span>
              </label>
              <button
                v-if="form.documentos.domiciliacionBanorte && canEdit"
                type="button"
                class="upload-card__remove"
                @click="clearFile('domiciliacionBanorte')"
              >
                Quitar
              </button>
            </div>
          </div>

          <div
            v-if="pideFactura"
            class="upload-card"
            :class="{
              'upload-card--filled': form.documentos.constanciaSituacionFiscal,
              'upload-card--disabled': !canEdit,
            }"
          >
            <div class="upload-card__icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none">
                <path
                  d="M7 3.5h7.2L19 8.3V20a1.5 1.5 0 0 1-1.5 1.5h-10A1.5 1.5 0 0 1 6 20V5a1.5 1.5 0 0 1 1-1.5z"
                  stroke="currentColor"
                  stroke-width="1.7"
                  stroke-linejoin="round"
                />
                <path
                  d="M14 3.5V8h5"
                  stroke="currentColor"
                  stroke-width="1.7"
                  stroke-linejoin="round"
                />
                <path
                  d="M9 13h6M9 16.5h4"
                  stroke="currentColor"
                  stroke-width="1.7"
                  stroke-linecap="round"
                />
              </svg>
            </div>
            <div class="upload-card__body">
              <strong>Constancia de situación fiscal</strong>
              <template v-if="form.documentos.constanciaSituacionFiscal">
                <span class="upload-card__name">{{
                  form.documentos.constanciaSituacionFiscal.name
                }}</span>
                <span class="upload-card__meta">PDF</span>
              </template>
              <span v-else class="upload-card__hint"
                >Solo PDF. No es obligatoria; sirve para corroborar los
                datos</span
              >
            </div>
            <div class="upload-card__actions">
              <label class="upload-card__btn">
                <input
                  type="file"
                  accept="application/pdf,.pdf"
                  :disabled="!canEdit"
                  @change="onFile('constanciaSituacionFiscal', $event)"
                />
                <span class="upload-card__btn-ui" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none">
                    <path
                      d="M12 16V5M12 5l-3.5 3.5M12 5l3.5 3.5"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    />
                    <path
                      d="M5 16.5V18a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 19 18v-1.5"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                    />
                  </svg>
                </span>
                <span class="upload-card__btn-text">{{
                  form.documentos.constanciaSituacionFiscal
                    ? 'Cambiar'
                    : 'Adjuntar'
                }}</span>
              </label>
              <button
                v-if="form.documentos.constanciaSituacionFiscal && canEdit"
                type="button"
                class="upload-card__remove"
                @click="clearFile('constanciaSituacionFiscal')"
              >
                Quitar
              </button>
            </div>
          </div>
        </div>

        <h3 class="span-2">Declaraciones</h3>
        <label>
          ¿Acepta uso mercadotécnico?
          <select
            v-model="form.declaraciones.aceptaMercadotecnia"
            :disabled="!canEdit"
          >
            <option value="">—</option>
            <option value="SI">Sí</option>
            <option value="NO">No</option>
          </select>
        </label>
        <label>
          ¿Acepta recibir publicidad?
          <select
            v-model="form.declaraciones.aceptaPublicidad"
            :disabled="!canEdit"
          >
            <option value="">—</option>
            <option value="SI">Sí</option>
            <option value="NO">No</option>
          </select>
        </label>
        </div>

        <div v-show="docsInnerTab === 'vista'" class="fields docs">
          <div class="upload-grid span-2">
            <div class="upload-card upload-card--filled">
              <div class="upload-card__icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none">
                  <path
                    d="M7 3.5h7.2L19 8.3V20a1.5 1.5 0 0 1-1.5 1.5h-10A1.5 1.5 0 0 1 6 20V5a1.5 1.5 0 0 1 1-1.5z"
                    stroke="currentColor"
                    stroke-width="1.7"
                    stroke-linejoin="round"
                  />
                  <path
                    d="M14 3.5V8h5"
                    stroke="currentColor"
                    stroke-width="1.7"
                    stroke-linejoin="round"
                  />
                  <path
                    d="M9 13h6M9 16.5h4"
                    stroke="currentColor"
                    stroke-width="1.7"
                    stroke-linecap="round"
                  />
                </svg>
              </div>
              <div class="upload-card__body">
                <strong>Carátula del contrato</strong>
                <span class="upload-card__hint"
                  >Se llena con los datos de la venta. Mientras no se firme
                  aparece como borrador</span
                >
              </div>
              <div class="upload-card__actions">
                <button
                  type="button"
                  class="upload-card__btn"
                  @click="previewOpen = true"
                >
                  <span class="upload-card__btn-text">Vista previa</span>
                </button>
              </div>
            </div>

            <div
              v-if="form.documentos.ineFrente && form.documentos.ineReverso"
              class="upload-card upload-card--filled"
            >
              <div class="upload-card__icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none">
                  <rect
                    x="3"
                    y="5"
                    width="18"
                    height="14"
                    rx="2"
                    stroke="currentColor"
                    stroke-width="1.7"
                  />
                  <circle cx="8.5" cy="10" r="1.4" fill="currentColor" />
                </svg>
              </div>
              <div class="upload-card__body">
                <strong>INE (ambos lados)</strong>
                <span class="upload-card__hint"
                  >PDF de una hoja con frente y reverso. Este es el archivo que
                  se guarda en el expediente</span
                >
              </div>
              <div class="upload-card__actions">
                <button
                  type="button"
                  class="upload-card__btn"
                  @click="inePreviewOpen = true"
                >
                  <span class="upload-card__btn-text">Vista previa</span>
                </button>
              </div>
            </div>

            <div class="upload-card upload-card--filled">
              <div class="upload-card__icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none">
                  <path
                    d="M7 3.5h7.2L19 8.3V20a1.5 1.5 0 0 1-1.5 1.5h-10A1.5 1.5 0 0 1 6 20V5a1.5 1.5 0 0 1 1-1.5z"
                    stroke="currentColor"
                    stroke-width="1.7"
                    stroke-linejoin="round"
                  />
                  <path
                    d="M14 3.5V8h5"
                    stroke="currentColor"
                    stroke-width="1.7"
                    stroke-linejoin="round"
                  />
                  <path
                    d="M9 13h6M9 16.5h4"
                    stroke="currentColor"
                    stroke-width="1.7"
                    stroke-linecap="round"
                  />
                </svg>
              </div>
              <div class="upload-card__body">
                <strong>Carta de aceptación de exclusiones</strong>
                <span class="upload-card__hint"
                  >Anexo A del contrato. Se llena con titular, sucursal y fecha.
                  Mientras no se firme aparece como borrador</span
                >
              </div>
              <div class="upload-card__actions">
                <button
                  type="button"
                  class="upload-card__btn"
                  @click="cartaExclusionesPreviewOpen = true"
                >
                  <span class="upload-card__btn-text">Vista previa</span>
                </button>
              </div>
            </div>

            <div
              v-if="isParque"
              class="upload-card upload-card--filled"
            >
              <div class="upload-card__icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none">
                  <path
                    d="M7 3.5h7.2L19 8.3V20a1.5 1.5 0 0 1-1.5 1.5h-10A1.5 1.5 0 0 1 6 20V5a1.5 1.5 0 0 1 1-1.5z"
                    stroke="currentColor"
                    stroke-width="1.7"
                    stroke-linejoin="round"
                  />
                  <path
                    d="M14 3.5V8h5"
                    stroke="currentColor"
                    stroke-width="1.7"
                    stroke-linejoin="round"
                  />
                  <path
                    d="M9 13h6M9 16.5h4"
                    stroke="currentColor"
                    stroke-width="1.7"
                    stroke-linecap="round"
                  />
                </svg>
              </div>
              <div class="upload-card__body">
                <strong>Reglamento de parque</strong>
                <span class="upload-card__hint"
                  >Carta de reglas para el cliente. Mientras no se firme aparece
                  como borrador</span
                >
              </div>
              <div class="upload-card__actions">
                <button
                  type="button"
                  class="upload-card__btn"
                  @click="reglamentoParquePreviewOpen = true"
                >
                  <span class="upload-card__btn-text">Vista previa</span>
                </button>
              </div>
            </div>

            <div
              v-if="isParque"
              class="upload-card upload-card--filled"
            >
              <div class="upload-card__icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none">
                  <path
                    d="M7 3.5h7.2L19 8.3V20a1.5 1.5 0 0 1-1.5 1.5h-10A1.5 1.5 0 0 1 6 20V5a1.5 1.5 0 0 1 1-1.5z"
                    stroke="currentColor"
                    stroke-width="1.7"
                    stroke-linejoin="round"
                  />
                  <path
                    d="M14 3.5V8h5"
                    stroke="currentColor"
                    stroke-width="1.7"
                    stroke-linejoin="round"
                  />
                  <path
                    d="M9 13h6M9 16.5h4"
                    stroke="currentColor"
                    stroke-width="1.7"
                    stroke-linecap="round"
                  />
                </svg>
              </div>
              <div class="upload-card__body">
                <strong>Reglamento de parque (artículos)</strong>
                <span class="upload-card__hint"
                  >Folleto carta apaisada · 2 hojas (artículos 1–32). Cada hoja
                  junta 2 páginas carta. Mientras no se firme aparece como
                  borrador</span
                >
              </div>
              <div class="upload-card__actions">
                <button
                  type="button"
                  class="upload-card__btn"
                  @click="reglamentoParqueFolletoPreviewOpen = true"
                >
                  <span class="upload-card__btn-text">Vista previa</span>
                </button>
              </div>
            </div>

            <div
              v-if="isDomiciliado"
              class="upload-card upload-card--filled"
            >
              <div class="upload-card__icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none">
                  <path
                    d="M7 3.5h7.2L19 8.3V20a1.5 1.5 0 0 1-1.5 1.5h-10A1.5 1.5 0 0 1 6 20V5a1.5 1.5 0 0 1 1-1.5z"
                    stroke="currentColor"
                    stroke-width="1.7"
                    stroke-linejoin="round"
                  />
                  <path
                    d="M14 3.5V8h5"
                    stroke="currentColor"
                    stroke-width="1.7"
                    stroke-linejoin="round"
                  />
                  <path
                    d="M9 13h6M9 16.5h4"
                    stroke="currentColor"
                    stroke-width="1.7"
                    stroke-linecap="round"
                  />
                </svg>
              </div>
              <div class="upload-card__body">
                <strong>Carta de autorización</strong>
                <span class="upload-card__hint">
                  Cargo automático.
                  {{
                    form.ubicacionPlan.planKind === 'PARQUE'
                      ? 'Empresa San Martín (plan parque)'
                      : 'Empresa Inhumaciones (plan a futuro)'
                  }}. Mientras no se firme aparece como borrador
                </span>
              </div>
              <div class="upload-card__actions">
                <button
                  type="button"
                  class="upload-card__btn"
                  @click="cartaAuthPreviewOpen = true"
                >
                  <span class="upload-card__btn-text">Vista previa</span>
                </button>
              </div>
            </div>

            <div
              v-if="isNomina && form.pago.empresaNominaId"
              class="upload-card upload-card--filled"
            >
              <div class="upload-card__icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none">
                  <path
                    d="M7 3.5h7.2L19 8.3V20a1.5 1.5 0 0 1-1.5 1.5h-10A1.5 1.5 0 0 1 6 20V5a1.5 1.5 0 0 1 1-1.5z"
                    stroke="currentColor"
                    stroke-width="1.7"
                    stroke-linejoin="round"
                  />
                  <path
                    d="M14 3.5V8h5"
                    stroke="currentColor"
                    stroke-width="1.7"
                    stroke-linejoin="round"
                  />
                  <path
                    d="M9 13h6M9 16.5h4"
                    stroke="currentColor"
                    stroke-width="1.7"
                    stroke-linecap="round"
                  />
                </svg>
              </div>
              <div class="upload-card__body">
                <strong>Carta de consentimiento (nómina)</strong>
                <span class="upload-card__hint">
                  FO-GEN-SMGF-05 para
                  {{ form.pago.empresaNomina || 'la empresa de convenio' }}.
                  Mientras no se firme aparece como borrador
                </span>
              </div>
              <div class="upload-card__actions">
                <button
                  type="button"
                  class="upload-card__btn"
                  @click="cartaNominaPreviewOpen = true"
                >
                  <span class="upload-card__btn-text">Vista previa</span>
                </button>
              </div>
            </div>

            <div
              v-if="needsCardSides && form.documentos.tarjetaFrente && form.documentos.tarjetaReverso"
              class="upload-card upload-card--filled"
            >
              <div class="upload-card__icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none">
                  <rect
                    x="3"
                    y="6"
                    width="18"
                    height="12"
                    rx="2"
                    stroke="currentColor"
                    stroke-width="1.7"
                  />
                  <path d="M3 10h18" stroke="currentColor" stroke-width="1.7" />
                </svg>
              </div>
              <div class="upload-card__body">
                <strong>Tarjeta (ambos lados)</strong>
                <span class="upload-card__hint"
                  >PDF de una hoja con frente y reverso. Este es el archivo que
                  se guarda en el expediente</span
                >
              </div>
              <div class="upload-card__actions">
                <button
                  type="button"
                  class="upload-card__btn"
                  @click="tarjetaPreviewOpen = true"
                >
                  <span class="upload-card__btn-text">Vista previa</span>
                </button>
              </div>
            </div>

            <div
              v-if="rechazaFactura"
              class="upload-card upload-card--filled"
            >
              <div class="upload-card__icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none">
                  <path
                    d="M7 3.5h7.2L19 8.3V20a1.5 1.5 0 0 1-1.5 1.5h-10A1.5 1.5 0 0 1 6 20V5a1.5 1.5 0 0 1 1-1.5z"
                    stroke="currentColor"
                    stroke-width="1.7"
                    stroke-linejoin="round"
                  />
                  <path
                    d="M14 3.5V8h5"
                    stroke="currentColor"
                    stroke-width="1.7"
                    stroke-linejoin="round"
                  />
                  <path
                    d="M9 13h6M9 16.5h4"
                    stroke="currentColor"
                    stroke-width="1.7"
                    stroke-linecap="round"
                  />
                </svg>
              </div>
              <div class="upload-card__body">
                <strong>Consentimiento de no factura</strong>
                <span class="upload-card__hint"
                  >Se llena con el nombre del titular y la empresa. Mientras no
                  se firme aparece como borrador</span
                >
              </div>
              <div class="upload-card__actions">
                <button
                  type="button"
                  class="upload-card__btn"
                  @click="cartaNoFacturaPreviewOpen = true"
                >
                  <span class="upload-card__btn-text">Vista previa</span>
                </button>
              </div>
            </div>

            <div
              v-if="pideFactura"
              class="upload-card upload-card--filled"
            >
              <div class="upload-card__icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none">
                  <path
                    d="M7 3.5h7.2L19 8.3V20a1.5 1.5 0 0 1-1.5 1.5h-10A1.5 1.5 0 0 1 6 20V5a1.5 1.5 0 0 1 1-1.5z"
                    stroke="currentColor"
                    stroke-width="1.7"
                    stroke-linejoin="round"
                  />
                  <path
                    d="M14 3.5V8h5"
                    stroke="currentColor"
                    stroke-width="1.7"
                    stroke-linejoin="round"
                  />
                  <path
                    d="M9 13h6M9 16.5h4"
                    stroke="currentColor"
                    stroke-width="1.7"
                    stroke-linecap="round"
                  />
                </svg>
              </div>
              <div class="upload-card__body">
                <strong>Carta de requerimiento de factura</strong>
                <span class="upload-card__hint"
                  >Se llena con los datos fiscales. Mientras no se firme aparece
                  como borrador</span
                >
              </div>
              <div class="upload-card__actions">
                <button
                  type="button"
                  class="upload-card__btn"
                  @click="cartaPreviewOpen = true"
                >
                  <span class="upload-card__btn-text">Vista previa</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
      </form>
      <template #footer>
        <button type="button" class="btn btn-primary" @click="closeStepForm">
          Listo
        </button>
      </template>
    </VdModal>

    <footer class="capture__dock">
      <p class="dock-hint">
        <template v-if="!canEdit">Solo consulta</template>
        <template v-else-if="allStepsComplete">
          Todos los pasos listos · se guardará como venta
        </template>
        <template v-else-if="canSaveDraft">
          {{ completedCount }}/{{ STEPS.length }} completos · puedes guardar
          borrador
        </template>
        <template v-else>
          Captura nombre y apellido paterno del titular para guardar borrador
        </template>
      </p>
      <div v-if="canEdit" class="dock-actions">
        <button
          v-if="!allStepsComplete"
          type="button"
          class="btn btn-primary dock-draft"
          :disabled="saving || !canSaveDraft"
          @click="saveDraft"
        >
          {{ saving ? 'Guardando…' : 'Guardar borrador' }}
        </button>
        <template v-else>
          <button
            type="button"
            class="btn btn-ghost dock-draft"
            :disabled="saving || submitting"
            @click="saveDraft"
          >
            {{ saving ? 'Guardando…' : 'Borrador' }}
          </button>
          <button
            type="button"
            class="btn btn-primary dock-draft"
            :disabled="submitting || saving"
            @click="finalizeSale"
          >
            {{ submitting ? 'Generando…' : 'Generar expediente' }}
          </button>
        </template>
      </div>
    </footer>

    <SalePdfPreviewModal
      :open="previewOpen"
      :form="form"
      :sale-id="saleId"
      :status="status === 'NEW' ? undefined : status"
      @close="previewOpen = false"
    />
    <SalePdfPreviewModal
      kind="cartaFactura"
      :open="cartaPreviewOpen"
      :form="form"
      :sale-id="saleId"
      :status="status === 'NEW' ? undefined : status"
      @close="cartaPreviewOpen = false"
    />
    <SalePdfPreviewModal
      kind="cartaNoFactura"
      :open="cartaNoFacturaPreviewOpen"
      :form="form"
      :sale-id="saleId"
      :status="status === 'NEW' ? undefined : status"
      @close="cartaNoFacturaPreviewOpen = false"
    />
    <SalePdfPreviewModal
      kind="cartaExclusiones"
      :open="cartaExclusionesPreviewOpen"
      :form="form"
      :sale-id="saleId"
      :status="status === 'NEW' ? undefined : status"
      @close="cartaExclusionesPreviewOpen = false"
    />
    <SalePdfPreviewModal
      kind="reglamentoParque"
      :open="reglamentoParquePreviewOpen"
      :form="form"
      :sale-id="saleId"
      :status="status === 'NEW' ? undefined : status"
      @close="reglamentoParquePreviewOpen = false"
    />
    <SalePdfPreviewModal
      kind="reglamentoParqueFolleto"
      :open="reglamentoParqueFolletoPreviewOpen"
      :form="form"
      :sale-id="saleId"
      :status="status === 'NEW' ? undefined : status"
      @close="reglamentoParqueFolletoPreviewOpen = false"
    />
    <SalePdfPreviewModal
      kind="cartaAutorizacion"
      :open="cartaAuthPreviewOpen"
      :form="form"
      :sale-id="saleId"
      :status="status === 'NEW' ? undefined : status"
      @close="cartaAuthPreviewOpen = false"
    />
    <SalePdfPreviewModal
      kind="cartaNomina"
      :open="cartaNominaPreviewOpen"
      :form="form"
      :sale-id="saleId"
      :status="status === 'NEW' ? undefined : status"
      @close="cartaNominaPreviewOpen = false"
    />
    <SalePdfPreviewModal
      kind="tarjeta"
      :open="tarjetaPreviewOpen"
      :form="form"
      :sale-id="saleId"
      :status="status === 'NEW' ? undefined : status"
      @close="tarjetaPreviewOpen = false"
    />
    <SalePdfPreviewModal
      kind="ine"
      :open="inePreviewOpen"
      :form="form"
      :sale-id="saleId"
      :status="status === 'NEW' ? undefined : status"
      @close="inePreviewOpen = false"
    />

    <SalePlanSearchModal
      :open="planSearchOpen"
      :plan-kind="form.ubicacionPlan.planKind"
      :favorite-plans="favoritePlans"
      @close="planSearchOpen = false"
      @select="onPlanSelected"
    />

    <SaleLocationSearchModal
      :open="locationSearchOpen"
      :stop-at="form.ubicacionPlan.preasignacion ? 'espacio' : 'seccion'"
      @close="locationSearchOpen = false"
      @select="onLocationSelected"
    />

    <SaleKindModal
      :open="kindOpen"
      @close="onKindCancel"
      @select="onKindSelect"
    />

    <VdModal
      v-if="isDev"
      :open="devPrefillOpen"
      title="Prellenar (dev)"
      @close="devPrefillOpen = false"
    >
      <div class="dev-prefill">
        <p class="hint">
          Marca los pasos a rellenar. Se usará un cliente/venta al azar de los
          10 mocks. Si marcas factura, se llena la carta (tipo, RFC, régimen)
          aunque el mock no pida factura.
        </p>
        <div class="dev-prefill__actions">
          <button
            type="button"
            class="btn btn-ghost btn-compact"
            @click="toggleAllDevPrefill(true)"
          >
            Todos
          </button>
          <button
            type="button"
            class="btn btn-ghost btn-compact"
            @click="toggleAllDevPrefill(false)"
          >
            Ninguno
          </button>
        </div>
        <label v-for="s in STEPS" :key="s.key" class="check">
          <input v-model="devPrefillSteps[s.key]" type="checkbox" />
          {{ s.title }}
        </label>
        <label
          v-for="s in DEV_PREFILL_EXTRAS"
          :key="s.key"
          class="check"
        >
          <input v-model="devPrefillSteps[s.key]" type="checkbox" />
          {{ s.title }}
        </label>
      </div>
      <template #footer>
        <button
          type="button"
          class="btn btn-ghost"
          @click="devPrefillOpen = false"
        >
          Cancelar
        </button>
        <button type="button" class="btn btn-primary" @click="applyDevPrefill">
          Prellenar
        </button>
      </template>
    </VdModal>

    <VdModal
      :open="reuseOpen"
      title="Precargar cotización"
      wide
      @close="reuseOpen = false"
    >
      <div class="reuse">
        <div class="tabs" role="tablist" aria-label="Origen de la cotización">
          <button
            type="button"
            class="tab"
            :class="{ active: reuseSource === 'vd' }"
            @click="reuseSource = 'vd'"
          >
            Cliente de Venta Digital
          </button>
          <button
            type="button"
            class="tab"
            :class="{ active: reuseSource === 'catalogo' }"
            @click="reuseSource = 'catalogo'"
          >
            Por nombre del cliente
          </button>
        </div>

        <template v-if="reuseSource === 'vd'">
          <p class="hint">
            Busca por nombre del cliente en todas las ventas de Venta
            Digital y marca qué datos reutilizar.
          </p>
          <label>
            Nombre del cliente
            <input
              v-model="vdQ"
              type="search"
              placeholder="Escribe para buscar…"
              autocomplete="off"
              @input="onVdInput"
            />
          </label>
          <p v-if="vdLoading" class="hint">Buscando…</p>
          <p v-else-if="vdError" class="reuse__err">{{ vdError }}</p>
          <ul v-if="references.length" class="reuse-list">
            <li v-for="r in references" :key="r.id">
              <button
                type="button"
                class="reuse-item"
                :class="{ 'reuse-item--on': selectedRefId === r.id }"
                @click="selectedRefId = r.id"
              >
                <strong>{{ r.titularName || 'Sin titular' }}</strong>
                <small>
                  #{{ r.id }}
                  · {{ r.status === 'DRAFT' ? 'Borrador' : 'Enviada' }}
                  <template v-if="r.sellerName">
                    · {{ r.sellerName }}
                  </template>
                </small>
              </button>
            </li>
          </ul>
        </template>

        <template v-else>
          <p class="hint">
            Busca al cliente por nombre, CURP o celular. Se cargan titular,
            domicilio, segundo contacto y, si el último contrato los tiene,
            titular sustituto y beneficiarios.
          </p>
          <label>
            Nombre del cliente
            <input
              v-model="catalogQ"
              type="search"
              placeholder="Escribe para buscar…"
              autocomplete="off"
              @input="onCatalogInput"
            />
          </label>
          <p v-if="catalogLoading" class="hint">Buscando…</p>
          <p v-else-if="catalogError" class="reuse__err">{{ catalogError }}</p>
          <ul v-if="catalogResults.length" class="reuse-list">
            <li v-for="c in catalogResults" :key="c.id">
              <button
                type="button"
                class="reuse-item"
                :class="{ 'reuse-item--on': selectedCatalogId === c.id }"
                @click="selectedCatalogId = c.id"
              >
                <strong>{{ clienteDisplayName(c) }}</strong>
                <small>
                  {{ c.contacto.curp || 'Sin CURP' }}
                  <template v-if="c.contacto.celular1">
                    · {{ c.contacto.celular1 }}
                  </template>
                </small>
              </button>
            </li>
          </ul>
        </template>

        <label class="check">
          <input v-model="reuseGroups.contacto" type="checkbox" />
          Datos de contacto del titular
        </label>
        <label class="check">
          <input v-model="reuseGroups.segundoContacto" type="checkbox" />
          Segundo contacto del titular
        </label>
        <label class="check">
          <input v-model="reuseGroups.titularSustituto" type="checkbox" />
          Titular sustituto
        </label>
        <label class="check">
          <input v-model="reuseGroups.beneficiarios" type="checkbox" />
          Beneficiarios
        </label>
      </div>
      <template #footer>
        <button type="button" class="btn btn-ghost" @click="reuseOpen = false">
          Cancelar
        </button>
        <button
          type="button"
          class="btn btn-primary"
          :disabled="!canApplyReuse"
          @click="applyReuse"
        >
          Aplicar
        </button>
      </template>
    </VdModal>
  </section>
</template>

<style scoped>
.capture {
  --dock-h: 7.25rem;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  width: 100%;
  max-width: 920px;
  margin: 0 auto;
  padding-bottom: calc(var(--dock-h) + env(safe-area-inset-bottom, 0px));
  box-sizing: border-box;
}

.capture__head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 0.75rem;
}

.capture__titles {
  min-width: 0;
  flex: 1;
}

.capture__head h1 {
  margin: 0.1rem 0 0.15rem;
  color: var(--gsm-blue);
  font-size: clamp(1.35rem, 4vw, 1.75rem);
  line-height: 1.15;
}

.capture__meta {
  margin: 0;
  color: var(--vd-muted);
  font-size: 0.88rem;
}

.link-back {
  border: 0;
  background: transparent;
  color: var(--gsm-blue);
  padding: 0;
  cursor: pointer;
  font-weight: 600;
  font-size: 0.9rem;
  min-height: 32px;
}

.capture__head-actions {
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  align-items: stretch;
  gap: 0.4rem;
}

.capture__head-actions-row {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 0.4rem;
  flex-wrap: wrap;
}

.btn-compact {
  min-height: 40px;
  padding: 0.4rem 0.7rem;
  font-size: 0.82rem;
  white-space: nowrap;
}

.progress {
  height: 5px;
  background: rgba(53, 100, 125, 0.12);
  border-radius: 999px;
  overflow: hidden;
}

.progress__bar {
  height: 100%;
  background: var(--gsm-blue);
  transition: width 0.2s ease;
}

.step-list {
  margin: 0;
  padding: 0.9rem;
}

.step-list__head {
  margin-bottom: 0.85rem;
}

.step-list__head h2 {
  margin: 0 0 0.2rem;
  font-size: 1.05rem;
  color: var(--gsm-blue);
}

.step-list__head p {
  margin: 0;
  color: var(--vd-muted);
  font-size: 0.88rem;
}

.step-list__items {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
}

.step-row {
  width: 100%;
  display: grid;
  grid-template-columns: 1fr auto;
  align-items: center;
  gap: 0.35rem;
  min-height: 64px;
  padding: 0.35rem 0.45rem 0.35rem 0.15rem;
  border: 1px solid var(--vd-line);
  border-radius: 12px;
  background: #fff;
  color: var(--vd-ink);
  transition:
    border-color 0.15s ease,
    background 0.15s ease,
    box-shadow 0.15s ease;
}

.step-row:hover {
  border-color: rgba(53, 100, 125, 0.4);
  box-shadow: 0 4px 14px rgba(2, 53, 125, 0.06);
}

.step-row__open {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 0.75rem;
  min-height: 56px;
  padding: 0.4rem 0.35rem 0.4rem 0.75rem;
  border: 0;
  background: transparent;
  color: inherit;
  cursor: pointer;
  text-align: left;
}

.step-row__info {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.85rem;
  height: 1.85rem;
  margin-right: 0.25rem;
  border: 1.5px solid var(--gsm-blue);
  border-radius: 50%;
  background: #fff;
  color: var(--gsm-blue);
  font-family: Georgia, 'Times New Roman', serif;
  font-size: 0.95rem;
  font-style: italic;
  font-weight: 700;
  line-height: 1;
  cursor: pointer;
}

.step-row__info:hover {
  background: #e8f0f4;
}

.step-row__mark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2rem;
  height: 2rem;
  border-radius: 50%;
  background: rgba(53, 100, 125, 0.12);
  color: var(--gsm-blue);
  font-size: 0.85rem;
  font-weight: 800;
}

.step-row__mark svg {
  width: 1.05rem;
  height: 1.05rem;
}

.step-row__body {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  min-width: 0;
}

.step-row__body strong {
  font-size: 0.98rem;
  color: var(--gsm-blue);
}

.step-row__body small {
  color: var(--vd-muted);
  font-size: 0.8rem;
  font-weight: 600;
}

.step-row__chevron {
  color: var(--gsm-cafe);
  font-size: 1.5rem;
  line-height: 1;
  font-weight: 400;
}

.step-row.complete {
  border-color: rgba(47, 111, 78, 0.35);
  background: rgba(47, 111, 78, 0.04);
}

.step-row.complete .step-row__mark {
  background: var(--vd-ok);
  color: #fff;
}

.step-row.complete .step-row__body small {
  color: var(--vd-ok);
}

.step-row.has-data {
  border-color: rgba(204, 160, 121, 0.55);
  background: rgba(204, 160, 121, 0.08);
}

.step-row.has-data .step-row__mark {
  background: var(--gsm-cafe);
  color: #fff;
}

.step-row.has-data .step-row__body small {
  color: var(--gsm-cafe);
}

.missing-ok,
.missing-hint {
  margin: 0 0 0.55rem;
  color: var(--vd-muted);
  font-size: 0.9rem;
}

.missing-list {
  margin: 0;
  padding-left: 1.15rem;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  color: var(--vd-ink);
  font-size: 0.92rem;
}

.form-panel--modal {
  margin: 0;
  padding: 0.15rem 0 0.25rem;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.step-scroll {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
  flex: 1;
  min-height: 0;
}

.step-scroll__body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  -webkit-overflow-scrolling: touch;
  padding-right: 0.1rem;
  padding-bottom: 0.15rem;
}

.titular-step,
.docs-step {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
}

.tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
}

.tab {
  border: 1px solid var(--vd-line);
  background: var(--vd-surface, #fff);
  color: var(--vd-muted);
  border-radius: 10px;
  padding: 0.45rem 0.85rem;
  font-size: 0.84rem;
  font-weight: 600;
  min-height: 40px;
  cursor: pointer;
}

.tab.active {
  background: var(--gsm-blue);
  border-color: var(--gsm-blue);
  color: #fff;
}

.tab--disabled,
.tab:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.tab--disabled.active,
.tab:disabled.active {
  background: var(--vd-surface, #fff);
  border-color: var(--vd-line);
  color: var(--vd-muted);
}

.benef-block {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
}

.benef-card {
  border: 1px solid var(--vd-line);
  border-radius: 12px;
  padding: 0.75rem;
  background: var(--vd-surface, #fff);
}

.benef-card__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  margin-bottom: 0.65rem;
}

.benef-card__head h3 {
  margin: 0;
  font-size: 0.95rem;
  color: var(--gsm-blue);
}

.fields {
  display: grid;
  grid-template-columns: 1fr;
  gap: 0.7rem;
}

.fields label {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  font-size: 0.82rem;
  font-weight: 600;
  color: var(--gsm-blue);
  min-width: 0;
}

.fields label.check {
  flex-direction: row;
  align-items: center;
  gap: 0.55rem;
  color: var(--vd-ink);
  font-weight: 500;
}

.fields label.check input[type='checkbox'] {
  width: 1.15rem;
  height: 1.15rem;
  min-height: 0;
  margin: 0;
  accent-color: var(--gsm-blue);
}

.plan-name {
  display: flex;
  align-items: flex-end;
  gap: 0.6rem;
}

.plan-name__field {
  flex: 1;
}

.plan-name__search {
  min-height: 46px;
  white-space: nowrap;
}

.plan-name__readonly {
  cursor: default;
  background: var(--vd-surface, #f4f7f9);
  color: var(--vd-ink);
}

.plan-name__readonly--pick {
  cursor: pointer;
}

.plan-name__readonly:read-only:focus {
  outline: none;
  border-color: var(--vd-line);
}

.plan-name__meta {
  margin-top: -0.35rem;
}

.plan-readonly {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.65rem;
}

.plan-readonly--3col {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.plan-readonly--3col .plan-readonly__item strong {
  font-size: 0.98rem;
}

.plan-readonly__item {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  padding: 0.7rem 0.85rem;
  border: 1px solid var(--vd-line);
  border-radius: 10px;
  background: #f7f9fb;
}

.plan-readonly__item span {
  font-size: 0.82rem;
  font-weight: 600;
  color: var(--gsm-blue);
}

.plan-readonly__item strong {
  font-size: 1.05rem;
  color: var(--vd-ink, #1a2430);
}

.descuento-especial {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.descuento-especial .field-hint {
  margin: 0;
}

.field-hint {
  font-size: 0.78rem;
  font-weight: 500;
  color: var(--vd-muted);
  line-height: 1.35;
}

.field-error {
  display: block;
  margin-top: 0.25rem;
  font-size: 0.78rem;
  font-weight: 600;
  color: #b42318;
}

.field-req {
  display: block;
  margin: 0.15rem 0 0.35rem;
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--vd-muted);
}

.field-label {
  display: flex;
  flex-direction: row;
  flex-wrap: nowrap;
  align-items: baseline;
  gap: 0.35rem;
  width: 100%;
  min-height: 1.25rem;
}

.field-label__title {
  flex-shrink: 0;
}

.field-label--inline {
  flex: 1;
  min-width: 0;
}

.field-label .field-hint {
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-weight: 500;
}

.field-label .field-hint:empty {
  visibility: hidden;
}

.curp-field__row {
  display: flex;
  align-items: stretch;
  gap: 0.5rem;
}

.curp-field__row input {
  flex: 1;
  min-width: 0;
}

.curp-field__link {
  flex-shrink: 0;
  align-self: stretch;
  display: inline-flex;
  align-items: center;
  text-decoration: none;
  white-space: nowrap;
}

@media (max-width: 600px) {
  .plan-readonly,
  .plan-readonly--3col {
    grid-template-columns: 1fr;
  }
}

.fields input,
.fields select,
.fields textarea {
  width: 100%;
  max-width: 100%;
  min-width: 0;
  box-sizing: border-box;
  min-height: 46px;
  border: 1px solid var(--vd-line);
  border-radius: 10px;
  padding: 0.55rem 0.7rem;
  font: inherit;
  font-size: 16px;
  color: var(--vd-ink);
  background: #fff;
}

.fields input:not([type='email']):not([type='date']):not([type='number']):not([type='checkbox']):not([type='file']):not([type='hidden']):not([inputmode='numeric']):not([inputmode='decimal']),
.fields textarea {
  text-transform: uppercase;
}

.fields textarea {
  min-height: 88px;
  resize: vertical;
}

.span-2 {
  grid-column: 1 / -1;
}

.field-row {
  grid-column: 1 / -1;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: inherit;
  align-items: end;
}

.toggle-field {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  min-width: 0;
}

.toggle-field__label {
  font-size: 0.82rem;
  font-weight: 600;
  color: var(--gsm-blue);
}

.toggle {
  position: relative;
  display: flex;
  align-items: center;
  gap: 0.7rem;
  min-height: 46px;
  padding: 0 0.85rem;
  border: 1px solid var(--vd-line);
  border-radius: 10px;
  background: #fff;
  cursor: pointer;
  user-select: none;
  transition:
    border-color 0.18s ease,
    background 0.18s ease,
    box-shadow 0.18s ease;
}

.toggle input {
  position: absolute;
  opacity: 0;
  width: 1px;
  height: 1px;
  margin: 0;
  pointer-events: none;
}

.toggle__track {
  position: relative;
  flex: 0 0 auto;
  width: 2.55rem;
  height: 1.45rem;
  border-radius: 999px;
  background: #cfd8de;
  transition: background 0.2s ease;
}

.toggle__thumb {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 1.2rem;
  height: 1.2rem;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 4px rgba(35, 35, 35, 0.22);
  transition: transform 0.2s ease;
}

.toggle__text {
  font-size: 0.95rem;
  font-weight: 700;
  color: var(--vd-muted);
  letter-spacing: 0.01em;
}

.toggle--on {
  border-color: rgba(53, 100, 125, 0.45);
  background: rgba(53, 100, 125, 0.06);
  box-shadow: inset 0 0 0 1px rgba(53, 100, 125, 0.06);
}

.toggle--on .toggle__track {
  background: var(--gsm-blue);
}

.toggle--on .toggle__thumb {
  transform: translateX(1.1rem);
}

.toggle--on .toggle__text {
  color: var(--gsm-blue);
}

.toggle:hover:not(.toggle--disabled) {
  border-color: rgba(53, 100, 125, 0.4);
}

.toggle--disabled {
  opacity: 0.62;
  cursor: not-allowed;
  background: var(--vd-surface-2);
}

.fields h3 {
  margin: 0.25rem 0 0;
  font-size: 0.98rem;
  color: var(--gsm-blue);
}

.hint {
  margin: 0;
  color: var(--vd-muted);
  font-size: 0.88rem;
  font-weight: 500;
}

.section-gap {
  margin-top: 0.55rem;
  padding-top: 0.55rem;
  border-top: 1px solid var(--vd-line);
  font-weight: 700;
  color: var(--gsm-blue);
  letter-spacing: 0.01em;
}

.upload-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 0.75rem;
}

.upload-card {
  display: grid;
  grid-template-columns: auto 1fr;
  grid-template-areas:
    'icon body'
    'actions actions';
  gap: 0.65rem 0.85rem;
  padding: 0.95rem 1rem;
  border: 1.5px dashed rgba(53, 100, 125, 0.35);
  border-radius: 14px;
  background: linear-gradient(180deg, #f8fbfc 0%, #fff 70%);
  transition:
    border-color 0.15s ease,
    background 0.15s ease,
    box-shadow 0.15s ease;
}

.upload-card__icon {
  grid-area: icon;
  display: grid;
  place-items: center;
  width: 2.6rem;
  height: 2.6rem;
  border-radius: 12px;
  background: rgba(53, 100, 125, 0.1);
  color: var(--gsm-blue);
}

.upload-card__icon svg {
  width: 1.35rem;
  height: 1.35rem;
}

.upload-card__body {
  grid-area: body;
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  min-width: 0;
}

.upload-card__body strong {
  color: var(--gsm-blue);
  font-size: 0.95rem;
}

.upload-card__hint {
  color: var(--vd-muted);
  font-size: 0.82rem;
  font-weight: 500;
}

.upload-card__name {
  color: var(--vd-ink);
  font-size: 0.86rem;
  font-weight: 600;
  word-break: break-word;
}

.upload-card__meta {
  color: var(--vd-ok);
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.02em;
  text-transform: uppercase;
}

.upload-card__actions {
  grid-area: actions;
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem;
}

.upload-card__btn {
  position: relative;
  display: inline-flex !important;
  flex-direction: row !important;
  align-items: center;
  justify-content: center;
  gap: 0.4rem;
  min-height: 40px;
  padding: 0.45rem 1rem;
  border-radius: 999px;
  background: var(--gsm-blue);
  color: #fff !important;
  font-size: 0.82rem;
  font-weight: 700;
  cursor: pointer;
  overflow: hidden;
}

.upload-card__btn input[type='file'] {
  position: absolute !important;
  inset: 0;
  opacity: 0;
  cursor: pointer;
  width: 100% !important;
  height: 100% !important;
  margin: 0 !important;
  padding: 0 !important;
  border: 0 !important;
  min-height: 0 !important;
  background: transparent !important;
  z-index: 2;
}

.upload-card__btn-ui {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1rem;
  height: 1rem;
  flex-shrink: 0;
  pointer-events: none;
  z-index: 1;
}

.upload-card__btn-ui svg {
  width: 1rem;
  height: 1rem;
}

.upload-card__btn-text {
  position: relative;
  z-index: 1;
  pointer-events: none;
  color: #fff;
  font-weight: 700;
}

.upload-card__btn:has(input:disabled) {
  opacity: 0.55;
  cursor: not-allowed;
}

.upload-card__remove {
  min-height: 38px;
  padding: 0.4rem 0.85rem;
  border-radius: 999px;
  border: 1px solid rgba(203, 42, 29, 0.28);
  background: rgba(203, 42, 29, 0.06);
  color: var(--vd-danger);
  font-size: 0.82rem;
  font-weight: 700;
  cursor: pointer;
}

.upload-card--filled {
  border-style: solid;
  border-color: rgba(47, 111, 78, 0.4);
  background: rgba(47, 111, 78, 0.05);
}

.upload-card--filled .upload-card__icon {
  background: rgba(47, 111, 78, 0.14);
  color: var(--vd-ok);
}

.upload-card--disabled {
  opacity: 0.75;
}

@media (min-width: 720px) {
  .upload-grid {
    grid-template-columns: 1fr 1fr;
  }

  .upload-card {
    grid-template-columns: auto 1fr;
    grid-template-areas:
      'icon body'
      'icon actions';
    align-items: start;
  }
}

.capture__dock {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 40;
  display: grid;
  gap: 0.45rem;
  padding: 0.65rem 0.85rem calc(0.65rem + env(safe-area-inset-bottom, 0px));
  background: rgba(244, 247, 249, 0.96);
  border-top: 1px solid var(--vd-line);
  backdrop-filter: blur(8px);
}

.dock-hint {
  margin: 0;
  color: var(--vd-muted);
  font-size: 0.82rem;
  font-weight: 500;
  line-height: 1.3;
}

.dock-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  width: 100%;
}

.dock-draft {
  flex: 1;
  min-width: 8rem;
  min-height: 48px;
}

.dock-draft:disabled {
  opacity: 0.55;
}

.loading {
  display: flex;
  align-items: center;
  gap: 0.65rem;
  color: var(--vd-muted);
}

.reuse {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.reuse label {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  font-weight: 600;
  color: var(--gsm-blue);
  font-size: 0.9rem;
}

.reuse select,
.reuse input[type='search'] {
  min-height: 44px;
  border-radius: 10px;
  border: 1px solid var(--vd-line);
  padding: 0.5rem 0.7rem;
  width: 100%;
  font-size: 16px;
}

.reuse .check {
  flex-direction: row;
  align-items: center;
  gap: 0.55rem;
  color: var(--vd-ink);
  font-weight: 500;
}

.reuse__err {
  margin: 0;
  color: #b42318;
  font-size: 0.88rem;
  font-weight: 600;
}

.reuse-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  max-height: 260px;
  overflow: auto;
}

.reuse-item {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  text-align: left;
  border: 1px solid var(--vd-line);
  background: #fff;
  border-radius: 10px;
  padding: 0.65rem 0.75rem;
  cursor: pointer;
  color: inherit;
}

.reuse-item:hover {
  border-color: var(--gsm-blue);
  background: #f4f8fa;
}

.reuse-item--on {
  border-color: var(--gsm-blue);
  background: #eef5f8;
}

.reuse-item strong {
  font-size: 0.9rem;
}

.reuse-item small {
  color: var(--vd-muted);
  font-size: 0.75rem;
}

.dev-prefill {
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
}

.dev-prefill__actions {
  display: flex;
  gap: 0.4rem;
  flex-wrap: wrap;
}

.dev-prefill .check {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 0.55rem;
  min-height: 44px;
  color: var(--vd-ink);
  font-weight: 500;
  font-size: 0.95rem;
}

.dev-prefill .check input {
  width: 1.15rem;
  height: 1.15rem;
}

@media (min-width: 720px) {
  .capture {
    --dock-h: 5.5rem;
    gap: 0.9rem;
  }

  .fields {
    grid-template-columns: 1fr 1fr;
    gap: 0.75rem 0.9rem;
  }

  .step-list {
    padding: 1.15rem 1.25rem;
  }

  .capture__dock {
    left: 50%;
    transform: translateX(-50%);
    width: min(980px, calc(100% - 2rem));
    border-radius: 14px 14px 0 0;
    align-items: center;
    grid-template-columns: 1fr auto;
  }

  .dock-actions {
    width: auto;
    justify-content: flex-end;
  }

  .dock-draft {
    width: auto;
    flex: 0 1 auto;
    min-width: 10rem;
  }
}

@media (min-width: 960px) {
  .capture__dock {
    position: sticky;
    transform: none;
    left: auto;
    width: 100%;
    border-radius: 12px;
    margin-top: 0.25rem;
  }

  .capture {
    --dock-h: 0px;
    padding-bottom: 1rem;
  }
}
</style>
