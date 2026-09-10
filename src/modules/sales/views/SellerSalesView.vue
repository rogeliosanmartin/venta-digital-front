<script setup lang="ts">
import { computed, onActivated, onMounted, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { extractApiError, http } from '../../../shared/api/http';
import { formatUtcToLocal } from '../../../shared/utils/datetime';
import { useDialog } from '../../../shared/ui/dialog';
import SaleAttachmentsModal from '../components/SaleAttachmentsModal.vue';
import SaleFilePreviewModal from '../components/SaleFilePreviewModal.vue';
import SalePdfPreviewModal from '../components/SalePdfPreviewModal.vue';
import SalePaymentModal from '../components/SalePaymentModal.vue';
import SaleManualSignModal from '../components/SaleManualSignModal.vue';
import SellerDefaultsModal from '../components/SellerDefaultsModal.vue';
import SaleKindModal from '../components/SaleKindModal.vue';
import SaleRecognitionModal from '../components/SaleRecognitionModal.vue';
import type { SaleKind } from '../constants/sale-kinds';
import { setPendingRecognition } from '../utils/pending-recognition';
import { ensureSellerPrefetch } from '../utils/seller-session-cache';
import { useAuthStore } from '../../auth/stores/auth.store';
import {
  mergeSaleForm,
  type SaleAttachment,
  type SaleFormData,
  type SaleListItem,
  type SaleStatus,
} from '../types/sale-form';
import {
  listSaleAttachments,
  type AttachmentListItem,
} from '../utils/attachment-preview';
import { buildPaymentTicketPdf } from '../utils/payment-ticket-pdf';
import { buildAuthorizationLetterPdf } from '../utils/authorization-letter-pdf';
import { isUasConvenio } from '../utils/convenio-letter';
import { buildConvenioLetterPdf } from '../utils/convenio-letter-pdf';
import {
  buildCardSidesAttachment,
  buildIneSidesAttachment,
} from '../utils/card-sides-pdf';
import { buildExclusionesLetterPdf } from '../utils/exclusiones-letter-pdf';
import { buildInvoiceLetterPdf } from '../utils/invoice-letter-pdf';
import { buildNoInvoiceConsentPdf } from '../utils/no-invoice-consent-pdf';
import { buildParkRegulationPdf } from '../utils/park-regulation-pdf';
import { buildParkRegulationBookletPdf } from '../utils/park-regulation-booklet-pdf';
import { buildSalePreviewPdf } from '../utils/sale-pdf';
import { normalizeTipoCobranza } from '../utils/payment-method';
import {
  matchesDateRange,
  textEqualsNormalized,
  textIncludesNormalized,
} from '../utils/sales-list-filters';

async function blobToBase64(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

interface SalesResponse {
  items: SaleListItem[];
  drafts: SaleListItem[];
  submitted: SaleListItem[];
  draftCount: number;
  draftLimit: number;
  draftTtlHours?: number;
  total: number;
  message: string;
}

const router = useRouter();
const route = useRoute();
const auth = useAuthStore();
const { alert, confirm } = useDialog();

const loading = ref(true);
const data = ref<SalesResponse | null>(null);
const error = ref<string | null>(null);

const filters = reactive({
  dateFrom: '',
  dateTo: '',
  client: '',
});
const clientQuery = ref('');
const clientMenuOpen = ref(false);

const allItems = computed(() => [
  ...(data.value?.drafts ?? []),
  ...(data.value?.submitted ?? []),
]);

const clientOptions = computed(() => {
  const names = new Set<string>();
  for (const item of allItems.value) {
    const name = (item.titularName || '').trim();
    if (name) names.add(name);
  }
  return [...names].sort((a, b) => a.localeCompare(b, 'es'));
});

const filteredClientOptions = computed(() => {
  const q = clientQuery.value.trim();
  if (!q) return clientOptions.value.slice(0, 12);
  return clientOptions.value
    .filter((name) => textIncludesNormalized(name, q))
    .slice(0, 12);
});

function matchesClient(titularName: string | null | undefined): boolean {
  if (filters.client) {
    return textEqualsNormalized(titularName, filters.client);
  }
  return textIncludesNormalized(titularName, clientQuery.value);
}

function matchesSaleFilters(item: SaleListItem): boolean {
  if (!matchesDateRange(item.createdAt, filters.dateFrom, filters.dateTo)) {
    return false;
  }
  return matchesClient(item.titularName);
}

const filteredDrafts = computed(() =>
  (data.value?.drafts ?? []).filter(matchesSaleFilters),
);

const filteredSubmitted = computed(() =>
  (data.value?.submitted ?? []).filter(matchesSaleFilters),
);

type ProcessStageKey = 'payment' | 'sign' | 'done' | 'rejected';

type ProcessStage = {
  key: ProcessStageKey;
  title: string;
  empty: string;
  tone: ProcessStageKey;
  items: SaleListItem[];
  total: number;
};

function isCompletedStatus(status: SaleStatus | string): boolean {
  return status === 'COMPLETED' || status === 'SUBMITTED';
}

function byCreatedDesc(a: SaleListItem, b: SaleListItem): number {
  return String(b.createdAt).localeCompare(String(a.createdAt));
}

const processStages = computed<ProcessStage[]>(() => {
  const all = data.value?.submitted ?? [];
  const filtered = filteredSubmitted.value;
  const stages: ProcessStage[] = [
    {
      key: 'payment',
      title: 'Pendiente de pago',
      empty: 'No hay ventas esperando pago con los filtros actuales.',
      tone: 'payment',
      items: filtered
        .filter((s) => s.status === 'PENDING_PAYMENT')
        .slice()
        .sort(byCreatedDesc),
      total: all.filter((s) => s.status === 'PENDING_PAYMENT').length,
    },
    {
      key: 'sign',
      title: 'Pendiente de firma',
      empty: 'No hay ventas esperando firma con los filtros actuales.',
      tone: 'sign',
      items: filtered
        .filter((s) => s.status === 'PENDING_SIGNATURE')
        .slice()
        .sort(byCreatedDesc),
      total: all.filter((s) => s.status === 'PENDING_SIGNATURE').length,
    },
    {
      key: 'done',
      title: 'Completadas',
      empty: 'No hay ventas completadas con los filtros actuales.',
      tone: 'done',
      items: filtered
        .filter((s) => isCompletedStatus(s.status))
        .slice()
        .sort(byCreatedDesc),
      total: all.filter((s) => isCompletedStatus(s.status)).length,
    },
  ];

  const rejectedTotal = all.filter((s) => s.status === 'REJECTED').length;
  if (rejectedTotal) {
    stages.push({
      key: 'rejected',
      title: 'Rechazadas',
      empty: 'No hay ventas rechazadas con los filtros actuales.',
      tone: 'rejected',
      items: filtered
        .filter((s) => s.status === 'REJECTED')
        .slice()
        .sort(byCreatedDesc),
      total: rejectedTotal,
    });
  }

  return stages;
});

const visibleStages = computed(() =>
  processStages.value.filter((stage) => stage.total > 0 || stage.items.length > 0),
);

type StageId = 'draft' | ProcessStageKey;

const expandedStages = reactive<Record<StageId, boolean>>({
  draft: true,
  payment: true,
  sign: true,
  done: false,
  rejected: false,
});

function isStageOpen(key: StageId): boolean {
  return expandedStages[key] !== false;
}

function toggleStage(key: StageId) {
  expandedStages[key] = !isStageOpen(key);
}

function stageToggleLabel(key: StageId, title: string): string {
  return isStageOpen(key) ? `Ocultar ${title}` : `Mostrar ${title}`;
}

const hasAnySales = computed(
  () =>
    (data.value?.drafts?.length ?? 0) + (data.value?.submitted?.length ?? 0) > 0,
);

const hasAnyFilteredSales = computed(
  () => filteredDrafts.value.length + filteredSubmitted.value.length > 0,
);

const hasActiveFilters = computed(
  () =>
    !!filters.client.trim() ||
    !!clientQuery.value.trim() ||
    !!filters.dateFrom ||
    !!filters.dateTo,
);

function onClientInput() {
  filters.client = '';
  clientMenuOpen.value = true;
}

function selectClient(name: string) {
  filters.client = name;
  clientQuery.value = name;
  clientMenuOpen.value = false;
}

function clearClient() {
  filters.client = '';
  clientQuery.value = '';
  clientMenuOpen.value = true;
}

function clearFilters() {
  filters.dateFrom = '';
  filters.dateTo = '';
  filters.client = '';
  clientQuery.value = '';
  clientMenuOpen.value = false;
}

const previewOpen = ref(false);
const previewForm = ref<SaleFormData>(mergeSaleForm({}));
const previewId = ref<number | null>(null);
const previewStatus = ref<string | undefined>();

const actionForm = ref<SaleFormData>(mergeSaleForm({}));
const actionSaleId = ref<number | null>(null);
const actionStatus = ref<string | undefined>();

const paymentOpen = ref(false);
const paymentSaving = ref(false);

const signOpen = ref(false);
const signSubmitting = ref(false);
const defaultsOpen = ref(false);
const kindOpen = ref(false);
const recognitionOpen = ref(false);
const originKind = ref<SaleKind>('RECONOCIMIENTO');

const attachmentsOpen = ref(false);
const attachmentsLoading = ref(false);
const attachmentItems = ref<AttachmentListItem[]>([]);
const filePreviewOpen = ref(false);
const filePreviewTitle = ref('Archivo');
const filePreviewAttachment = ref<SaleAttachment | null>(null);

async function load() {
  loading.value = true;
  error.value = null;
  try {
    const res = await http.get<SalesResponse>('/sales');
    data.value = res.data;
  } catch (e: unknown) {
    error.value = extractApiError(e, 'No se pudieron cargar las ventas');
  } finally {
    loading.value = false;
  }
}

function maybeOpenRecognition() {
  const pick = String(route.query.pick || '').toUpperCase();
  if (pick === 'MEJORA' || pick === 'MINORIA' || pick === 'RECONOCIMIENTO') {
    originKind.value = pick;
    recognitionOpen.value = true;
    const query = { ...route.query };
    delete query.pick;
    delete query.reconocer;
    void router.replace({ query });
    return;
  }
  if (String(route.query.reconocer || '') !== '1') return;
  originKind.value = 'RECONOCIMIENTO';
  recognitionOpen.value = true;
  const query = { ...route.query };
  delete query.reconocer;
  void router.replace({ query });
}

onMounted(() => {
  ensureSellerPrefetch(auth.user?.id);
  void auth.refreshMe();
  load();
  maybeOpenRecognition();
});
onActivated(() => {
  load();
  maybeOpenRecognition();
});

function goNew() {
  if ((data.value?.draftCount ?? 0) >= (data.value?.draftLimit ?? 3)) {
    void alert({
      title: 'Borradores',
      message: `Ya tienes ${data.value?.draftLimit ?? 3} borradores. Elimina o envía uno para crear otra venta.`,
      variant: 'warning',
    });
    return;
  }
  kindOpen.value = true;
}

function startSale(kind: SaleKind) {
  kindOpen.value = false;
  if (
    kind === 'RECONOCIMIENTO' ||
    kind === 'MEJORA' ||
    kind === 'MINORIA'
  ) {
    originKind.value = kind;
    recognitionOpen.value = true;
    return;
  }
  router.push({
    name: 'vendedor-venta-nueva',
    query: { tipo: kind },
  });
}

function onRecognitionBack() {
  recognitionOpen.value = false;
  kindOpen.value = true;
}

function onRecognitionApply(payload: Parameters<
  typeof setPendingRecognition
>[0]) {
  setPendingRecognition(payload);
  recognitionOpen.value = false;
  router.push({
    name: 'vendedor-venta-nueva',
    query: { tipo: originKind.value },
  });
}

function editDraft(id: number) {
  router.push({ name: 'vendedor-venta-editar', params: { id: String(id) } });
}

function statusLabel(status: SaleStatus | string): string {
  switch (status) {
    case 'PENDING_PAYMENT':
      return 'Pendiente de pago';
    case 'PENDING_SIGNATURE':
      return 'Pendiente de firma';
    case 'COMPLETED':
    case 'SUBMITTED':
      return 'Completada';
    case 'REJECTED':
      return 'Rechazada';
    case 'DRAFT':
      return 'Borrador';
    default:
      return status;
  }
}

function statusBadgeClass(status: SaleStatus | string): string {
  switch (status) {
    case 'PENDING_PAYMENT':
      return 'status-badge status-badge--payment';
    case 'PENDING_SIGNATURE':
      return 'status-badge status-badge--sign';
    case 'COMPLETED':
    case 'SUBMITTED':
      return 'status-badge status-badge--done';
    case 'REJECTED':
      return 'status-badge status-badge--rejected';
    default:
      return 'status-badge';
  }
}

async function fetchSaleForm(item: SaleListItem): Promise<SaleListItem> {
  const { data: sale } = await http.get<SaleListItem>(`/sales/${item.id}`);
  return sale;
}

async function openPreview(item: SaleListItem) {
  try {
    const sale = await fetchSaleForm(item);
    previewForm.value = mergeSaleForm(sale.payload);
    previewId.value = sale.id;
    previewStatus.value = sale.status;
    previewOpen.value = true;
  } catch (e: unknown) {
    await alert({
      title: 'Vista previa',
      message: extractApiError(e, 'No se pudo abrir la venta'),
      variant: 'danger',
    });
  }
}

async function openAttachments(item: SaleListItem) {
  attachmentsOpen.value = true;
  attachmentsLoading.value = true;
  attachmentItems.value = [];
  try {
    const sale = await fetchSaleForm(item);
    const form = mergeSaleForm(sale.payload);
    attachmentItems.value = listSaleAttachments(form);
  } catch (e: unknown) {
    attachmentsOpen.value = false;
    await alert({
      title: 'Anexos',
      message: extractApiError(e, 'No se pudieron cargar los archivos'),
      variant: 'danger',
    });
  } finally {
    attachmentsLoading.value = false;
  }
}

function onSelectAttachment(item: AttachmentListItem) {
  attachmentsOpen.value = false;
  filePreviewTitle.value = item.label;
  filePreviewAttachment.value = item.attachment;
  filePreviewOpen.value = true;
}

async function openPayment(item: SaleListItem) {
  try {
    const sale = await fetchSaleForm(item);
    actionForm.value = mergeSaleForm(sale.payload);
    actionForm.value.pago.nombreJefeVentas =
      auth.user?.nombreJefeVentas?.trim() ||
      actionForm.value.pago.nombreJefeVentas;
    actionSaleId.value = sale.id;
    paymentOpen.value = true;
  } catch (e: unknown) {
    await alert({
      title: 'Pago',
      message: extractApiError(e, 'No se pudo abrir la venta'),
      variant: 'danger',
    });
  }
}

async function savePayment(
  pago: SaleFormData['pago'],
  comprobanteTransferencia?: SaleAttachment | null,
) {
  if (!actionSaleId.value) return;
  paymentSaving.value = true;
  try {
    const formForTicket = mergeSaleForm({
      ...actionForm.value,
      pago: {
        ...pago,
        nombreAsesor:
          pago.nombreAsesor?.trim() ||
          auth.user?.fullName ||
          actionForm.value.pago.nombreAsesor,
        nombreJefeVentas:
          auth.user?.nombreJefeVentas?.trim() ||
          pago.nombreJefeVentas ||
          actionForm.value.pago.nombreJefeVentas,
      },
      documentos: {
        ...actionForm.value.documentos,
        ...(comprobanteTransferencia
          ? { comprobanteTransferencia }
          : {}),
      },
    });

    let ticketPdf:
      | { name: string; mime: string; dataBase64: string }
      | undefined;
    try {
      const blob = await buildPaymentTicketPdf(formForTicket, {
        saleId: actionSaleId.value,
        sellerName: auth.user?.fullName,
      });
      ticketPdf = {
        name: `ticket-pago_${actionSaleId.value}.pdf`,
        mime: 'application/pdf',
        dataBase64: await blobToBase64(blob),
      };
    } catch (pdfErr) {
      console.warn('No se pudo generar ticket de pago', pdfErr);
    }

    await http.patch<SaleListItem>(
      `/sales/${actionSaleId.value}/payment`,
      {
        pago,
        ...(ticketPdf ? { ticketPdf } : {}),
        ...(comprobanteTransferencia?.dataBase64
          ? { comprobanteTransferencia }
          : {}),
      },
    );
    paymentOpen.value = false;
    await alert({
      title: 'Pago registrado',
      message: comprobanteTransferencia?.dataBase64
        ? 'El pago, el ticket y el comprobante de transferencia se guardaron.'
        : ticketPdf
          ? 'El pago y el ticket se guardaron.'
          : 'El pago se guardó.',
      variant: 'success',
    });
    await load();
  } catch (e: unknown) {
    await alert({
      title: 'Pago',
      message: extractApiError(e, 'No se pudo guardar el pago'),
      variant: 'danger',
    });
  } finally {
    paymentSaving.value = false;
  }
}

async function openSign(item: SaleListItem) {
  try {
    const sale = await fetchSaleForm(item);
    actionForm.value = mergeSaleForm(sale.payload);
    actionSaleId.value = sale.id;
    actionStatus.value = sale.status;
    signOpen.value = true;
  } catch (e: unknown) {
    await alert({
      title: 'Firma',
      message: extractApiError(e, 'No se pudo abrir la venta'),
      variant: 'danger',
    });
  }
}

async function confirmSign(dataUrl: string) {
  if (!actionSaleId.value) return;
  const base64 = dataUrl.includes(',') ? dataUrl.split(',')[1]! : dataUrl;
  signSubmitting.value = true;
  let hasCaratula = false;
  try {
    const firmaCliente = {
      name: 'firma-cliente.png',
      mime: 'image/png',
      dataBase64: base64,
    };

    // PDF con firma incluida → se sube a Drive junto con los demás docs.
    const formForPdf = mergeSaleForm({
      ...actionForm.value,
      documentos: {
        ...actionForm.value.documentos,
        firmaCliente,
      },
    });
    let caratulaPdf:
      | { name: string; mime: string; dataBase64: string }
      | undefined;
    let cartaFacturaPdf:
      | { name: string; mime: string; dataBase64: string }
      | undefined;
    let cartaNoFacturaPdf:
      | { name: string; mime: string; dataBase64: string }
      | undefined;
    let cartaExclusionesPdf:
      | { name: string; mime: string; dataBase64: string }
      | undefined;
    let reglamentoParquePdf:
      | { name: string; mime: string; dataBase64: string }
      | undefined;
    let reglamentoParqueFolletoPdf:
      | { name: string; mime: string; dataBase64: string }
      | undefined;
    let cartaAutorizacionPdf:
      | { name: string; mime: string; dataBase64: string }
      | undefined;
    let cartaNominaPdf:
      | { name: string; mime: string; dataBase64: string }
      | undefined;
    let tarjetaPdf:
      | { name: string; mime: string; dataBase64: string }
      | undefined;
    let inePdf:
      | { name: string; mime: string; dataBase64: string }
      | undefined;
    try {
      const blob = await buildSalePreviewPdf(formForPdf, {
        saleId: actionSaleId.value,
        status: 'COMPLETED',
      });
      caratulaPdf = {
        name: `caratula-contrato_venta-${actionSaleId.value}.pdf`,
        mime: 'application/pdf',
        dataBase64: await blobToBase64(blob),
      };
    } catch (pdfErr) {
      console.warn('No se pudo generar carátula para Drive', pdfErr);
    }
    if (formForPdf.contacto.factura === 'SI') {
      try {
        const letter = await buildInvoiceLetterPdf(formForPdf, {
          saleId: actionSaleId.value,
          status: 'COMPLETED',
        });
        cartaFacturaPdf = {
          name: `carta-requerimiento-factura_venta-${actionSaleId.value}.pdf`,
          mime: 'application/pdf',
          dataBase64: await blobToBase64(letter),
        };
      } catch (pdfErr) {
        console.warn('No se pudo generar carta de factura para Drive', pdfErr);
      }
    }
    if (formForPdf.contacto.factura === 'NO') {
      try {
        const letter = await buildNoInvoiceConsentPdf(formForPdf, {
          saleId: actionSaleId.value,
          status: 'COMPLETED',
        });
        cartaNoFacturaPdf = {
          name: `consentimiento-no-factura_venta-${actionSaleId.value}.pdf`,
          mime: 'application/pdf',
          dataBase64: await blobToBase64(letter),
        };
      } catch (pdfErr) {
        console.warn('No se pudo generar consentimiento de no factura', pdfErr);
      }
    }
    try {
      const letter = await buildExclusionesLetterPdf(formForPdf, {
        saleId: actionSaleId.value,
        status: 'COMPLETED',
      });
      cartaExclusionesPdf = {
        name: `carta-aceptacion-exclusiones_venta-${actionSaleId.value}.pdf`,
        mime: 'application/pdf',
        dataBase64: await blobToBase64(letter),
      };
    } catch (pdfErr) {
      console.warn('No se pudo generar carta de exclusiones', pdfErr);
    }
    if (formForPdf.ubicacionPlan.planKind === 'PARQUE') {
      try {
        const letter = await buildParkRegulationPdf(formForPdf, {
          saleId: actionSaleId.value,
          status: 'COMPLETED',
        });
        reglamentoParquePdf = {
          name: `reglamento-parque_venta-${actionSaleId.value}.pdf`,
          mime: 'application/pdf',
          dataBase64: await blobToBase64(letter),
        };
      } catch (pdfErr) {
        console.warn('No se pudo generar reglamento de parque', pdfErr);
      }
      try {
        const booklet = await buildParkRegulationBookletPdf(formForPdf, {
          saleId: actionSaleId.value,
          status: 'COMPLETED',
        });
        reglamentoParqueFolletoPdf = {
          name: `reglamento-parque-articulos_venta-${actionSaleId.value}.pdf`,
          mime: 'application/pdf',
          dataBase64: await blobToBase64(booklet),
        };
      } catch (pdfErr) {
        console.warn('No se pudo generar folleto del reglamento', pdfErr);
      }
    }
    if (
      normalizeTipoCobranza(formForPdf.contacto.tipoCobranza) === 'NOMINA' &&
      formForPdf.pago.empresaNominaId
    ) {
      try {
        const nominaLetter = await buildConvenioLetterPdf(formForPdf, {
          saleId: actionSaleId.value,
          status: 'COMPLETED',
        });
        cartaNominaPdf = {
          name: `carta-consentimiento-nomina_venta-${actionSaleId.value}.pdf`,
          mime: 'application/pdf',
          dataBase64: await blobToBase64(nominaLetter),
        };
      } catch (pdfErr) {
        console.warn('No se pudo generar carta de nómina para Drive', pdfErr);
      }
    }

    if (normalizeTipoCobranza(formForPdf.contacto.tipoCobranza) === 'DOMICILIADO') {
      try {
        const authLetter = await buildAuthorizationLetterPdf(formForPdf, {
          saleId: actionSaleId.value,
          status: 'COMPLETED',
        });
        cartaAutorizacionPdf = {
          name: `carta-autorizacion_venta-${actionSaleId.value}.pdf`,
          mime: 'application/pdf',
          dataBase64: await blobToBase64(authLetter),
        };
      } catch (pdfErr) {
        console.warn('No se pudo generar carta de autorización para Drive', pdfErr);
      }
    }

    if (
      normalizeTipoCobranza(formForPdf.contacto.tipoCobranza) === 'DOMICILIADO' ||
      isUasConvenio(formForPdf)
    ) {
      const frente = formForPdf.documentos.tarjetaFrente;
      const reverso = formForPdf.documentos.tarjetaReverso;
      if (frente && reverso) {
        try {
          const cardPdf = await buildCardSidesAttachment(
            frente,
            reverso,
            `tarjeta-ambos-lados_venta-${actionSaleId.value}.pdf`,
          );
          tarjetaPdf = cardPdf;
          formForPdf.documentos.tarjetaPdf = cardPdf;
        } catch (pdfErr) {
          console.warn('No se pudo armar el PDF de la tarjeta', pdfErr);
        }
      }
    }

    const ineFrente = formForPdf.documentos.ineFrente;
    const ineReverso = formForPdf.documentos.ineReverso;
    if (ineFrente && ineReverso) {
      try {
        const combined = await buildIneSidesAttachment(
          ineFrente,
          ineReverso,
          `ine-ambos-lados_venta-${actionSaleId.value}.pdf`,
        );
        inePdf = {
          name: combined.name,
          mime: combined.mime,
          dataBase64: combined.dataBase64!,
        };
        formForPdf.documentos.inePdf = combined;
      } catch (pdfErr) {
        console.warn('No se pudo armar el PDF de la INE', pdfErr);
      }
    }

    hasCaratula = Boolean(caratulaPdf);
    await http.post<SaleListItem>(
      `/sales/${actionSaleId.value}/sign`,
      {
        firmaCliente,
        ...(caratulaPdf ? { caratulaPdf } : {}),
        ...(cartaFacturaPdf ? { cartaFacturaPdf } : {}),
        ...(cartaNoFacturaPdf ? { cartaNoFacturaPdf } : {}),
        ...(cartaExclusionesPdf ? { cartaExclusionesPdf } : {}),
        ...(reglamentoParquePdf ? { reglamentoParquePdf } : {}),
        ...(reglamentoParqueFolletoPdf ? { reglamentoParqueFolletoPdf } : {}),
        ...(cartaAutorizacionPdf ? { cartaAutorizacionPdf } : {}),
        ...(cartaNominaPdf ? { cartaNominaPdf } : {}),
        ...(tarjetaPdf ? { tarjetaPdf } : {}),
        ...(inePdf ? { inePdf } : {}),
      },
      // Drive + PDFs + expediente suelen pasar de 30s; el API igual termina y guarda.
      { timeout: 180000 },
    );
    await finishSignSuccess(hasCaratula);
  } catch (e: unknown) {
    const alreadySigned = await saleAlreadySigned(actionSaleId.value);
    if (alreadySigned) {
      await finishSignSuccess(hasCaratula);
      return;
    }
    await alert({
      title: 'Firma',
      message: extractApiError(e, 'No se pudo registrar la firma'),
      variant: 'danger',
    });
  } finally {
    signSubmitting.value = false;
  }
}

async function saleAlreadySigned(id: number | null): Promise<boolean> {
  if (!id) return false;
  try {
    const { data: sale } = await http.get<SaleListItem>(`/sales/${id}`, {
      timeout: 15000,
    });
    return sale.status === 'COMPLETED';
  } catch {
    return false;
  }
}

async function finishSignSuccess(hasCaratula: boolean) {
  signOpen.value = false;
  await alert({
    title: 'Firma registrada',
    message: hasCaratula
      ? 'La firma y el contrato se guardaron.'
      : 'La firma se guardó.',
    variant: 'success',
  });
  try {
    await load();
  } catch {
    /* la firma ya quedó; el listado se actualiza al recargar */
  }
}

async function removeDraft(id: number) {
  const ok = await confirm({
    title: 'Eliminar borrador',
    message: '¿Seguro que deseas eliminar este borrador?',
    variant: 'danger',
    confirmText: 'Eliminar',
    cancelText: 'Cancelar',
  });
  if (!ok) return;
  try {
    await http.delete(`/sales/${id}`);
    await load();
  } catch (e: unknown) {
    await alert({
      title: 'Borrador',
      message: extractApiError(e, 'No se pudo eliminar'),
      variant: 'danger',
    });
  }
}
</script>

<template>
  <section class="sales-page">
    <header class="page-head head-row">
      <div>
        <h1>Mis ventas</h1>
        <p>Agrupadas por etapa: borrador, pago, firma y completada.</p>
      </div>
      <div class="head-actions">
        <button type="button" class="btn btn-secondary" @click="defaultsOpen = true">
          Valores predeterminados
        </button>
        <button type="button" class="btn btn-primary" @click="goNew">
          Nueva venta
        </button>
      </div>
    </header>

    <div class="panel filters">
      <div class="field">
        <label for="seller-filter-from">Desde</label>
        <input
          id="seller-filter-from"
          v-model="filters.dateFrom"
          type="date"
          title="Vacío: todas las ventas"
        />
      </div>
      <div class="field">
        <label for="seller-filter-to">Hasta</label>
        <input id="seller-filter-to" v-model="filters.dateTo" type="date" />
      </div>
      <div class="field field--wide client-ac">
        <label for="seller-filter-client">Cliente</label>
        <div class="client-ac__row">
          <input
            id="seller-filter-client"
            v-model="clientQuery"
            type="search"
            autocomplete="off"
            placeholder="Buscar o seleccionar cliente…"
            @input="onClientInput"
            @focus="clientMenuOpen = true"
            @blur="clientMenuOpen = false"
          />
          <button
            v-if="filters.client || clientQuery"
            type="button"
            class="btn btn-sm btn-ghost"
            @mousedown.prevent="clearClient"
          >
            Limpiar
          </button>
        </div>
        <ul
          v-if="clientMenuOpen && filteredClientOptions.length"
          class="client-ac__list"
          role="listbox"
        >
          <li v-for="name in filteredClientOptions" :key="name">
            <button
              type="button"
              class="client-ac__item"
              :class="{ active: name === filters.client }"
              @mousedown.prevent="selectClient(name)"
            >
              {{ name }}
            </button>
          </li>
        </ul>
        <p
          v-else-if="clientMenuOpen && clientQuery.trim()"
          class="client-ac__empty"
        >
          Sin coincidencias
        </p>
      </div>
      <div class="filter-actions">
        <button
          type="button"
          class="btn btn-ghost"
          :disabled="!hasActiveFilters"
          @click="clearFilters"
        >
          Restablecer filtros
        </button>
      </div>
    </div>

    <div v-if="loading" class="panel loading">
      <span class="spinner" />
      Cargando…
    </div>

    <div v-else-if="error" class="panel">
      <p class="error-text">{{ error }}</p>
    </div>

    <template v-else>
      <div v-if="!hasAnySales" class="panel">
        <div class="empty-state">
          <strong>Aún no hay ventas</strong>
          Usa <em>Nueva venta</em> para capturar la carátula.
        </div>
      </div>

      <div v-else-if="!hasAnyFilteredSales" class="panel">
        <div class="empty-state">
          <strong>Sin resultados</strong>
          No hay ventas con los filtros actuales.
        </div>
      </div>

      <template v-else>
        <div
          v-if="filteredDrafts.length"
          class="panel stage-panel stage-panel--draft"
          :class="{ 'stage-panel--collapsed': !isStageOpen('draft') }"
        >
          <button
            type="button"
            class="stage-toggle"
            :aria-expanded="isStageOpen('draft')"
            aria-controls="stage-draft"
            :title="stageToggleLabel('draft', 'borradores')"
            @click="toggleStage('draft')"
          >
            <span class="stage-toggle__title">
              <svg
                class="stage-chevron"
                viewBox="0 0 24 24"
                width="18"
                height="18"
                aria-hidden="true"
              >
                <path
                  fill="currentColor"
                  d="M8.1 9.3 12 13.2l3.9-3.9 1.4 1.4L12 16 6.7 10.7z"
                />
              </svg>
              <h2>Borradores</h2>
            </span>
            <span class="muted">
              {{ filteredDrafts.length }}
              <template v-if="(data?.drafts?.length ?? 0) !== filteredDrafts.length">
                de {{ data?.drafts?.length }}
              </template>
              · {{ data?.draftCount }} / {{ data?.draftLimit }}
            </span>
          </button>
          <ul v-show="isStageOpen('draft')" id="stage-draft" class="card-list">
            <li v-for="d in filteredDrafts" :key="d.id" class="sale-card">
              <div class="sale-card__main">
                <strong>{{ d.titularName || 'Sin titular' }}</strong>
                <span class="muted">
                  Caduca {{ formatUtcToLocal(d.draftExpiresAt) }}
                </span>
              </div>
              <div class="sale-card__actions">
                <button
                  type="button"
                  class="icon-btn"
                  title="Archivos anexados"
                  aria-label="Archivos anexados"
                  @click="openAttachments(d)"
                >
                  <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
                    <path
                      fill="currentColor"
                      d="M16.5 6.5v10.25a4.25 4.25 0 1 1-8.5 0V5.75a2.75 2.75 0 1 1 5.5 0v10.5a1.25 1.25 0 1 1-2.5 0V7.25h-1.5v9a2.75 2.75 0 1 0 5.5 0V5.75a4.25 4.25 0 1 0-8.5 0v11a5.75 5.75 0 1 0 11.5 0V6.5h-1.5z"
                    />
                  </svg>
                </button>
                <button
                  type="button"
                  class="icon-btn"
                  title="Vista previa carátula"
                  aria-label="Vista previa carátula"
                  @click="openPreview(d)"
                >
                  <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
                    <path
                      fill="currentColor"
                      d="M12 5c-5 0-9.27 3.11-11 7 1.73 3.89 6 7 11 7s9.27-3.11 11-7c-1.73-3.89-6-7-11-7Zm0 12a5 5 0 1 1 0-10 5 5 0 0 1 0 10Zm0-2.5A2.5 2.5 0 1 0 12 9a2.5 2.5 0 0 0 0 5Z"
                    />
                  </svg>
                </button>
                <button type="button" class="btn btn-ghost btn-sm" @click="editDraft(d.id)">
                  Continuar
                </button>
                <button type="button" class="btn btn-ghost btn-sm" @click="removeDraft(d.id)">
                  Eliminar
                </button>
              </div>
            </li>
          </ul>
        </div>

        <div
          v-for="stage in visibleStages"
          :key="stage.key"
          class="panel stage-panel"
          :class="[
            `stage-panel--${stage.tone}`,
            { 'stage-panel--collapsed': !isStageOpen(stage.key) },
          ]"
        >
          <button
            type="button"
            class="stage-toggle"
            :aria-expanded="isStageOpen(stage.key)"
            :aria-controls="`stage-${stage.key}`"
            :title="stageToggleLabel(stage.key, stage.title)"
            @click="toggleStage(stage.key)"
          >
            <span class="stage-toggle__title">
              <svg
                class="stage-chevron"
                viewBox="0 0 24 24"
                width="18"
                height="18"
                aria-hidden="true"
              >
                <path
                  fill="currentColor"
                  d="M8.1 9.3 12 13.2l3.9-3.9 1.4 1.4L12 16 6.7 10.7z"
                />
              </svg>
              <h2>{{ stage.title }}</h2>
            </span>
            <span class="muted">
              {{ stage.items.length }}
              <template v-if="stage.total !== stage.items.length">
                de {{ stage.total }}
              </template>
            </span>
          </button>

          <div
            v-if="!stage.items.length"
            v-show="isStageOpen(stage.key)"
            :id="`stage-${stage.key}`"
            class="empty-state"
          >
            <strong>Sin resultados</strong>
            {{ stage.empty }}
          </div>

          <ul
            v-else
            v-show="isStageOpen(stage.key)"
            :id="`stage-${stage.key}`"
            class="card-list"
          >
            <li v-for="item in stage.items" :key="item.id" class="sale-card">
              <div class="sale-card__main">
                <div class="sale-card__title">
                  <strong>#{{ item.id }} · {{ item.titularName || 'Sin titular' }}</strong>
                  <span :class="statusBadgeClass(item.status)">
                    <svg
                      v-if="isCompletedStatus(item.status)"
                      class="status-badge__icon"
                      viewBox="0 0 24 24"
                      width="12"
                      height="12"
                      aria-hidden="true"
                    >
                      <path
                        fill="currentColor"
                        d="M9.5 16.2 5.3 12l-1.4 1.4 5.6 5.6L20.5 8l-1.4-1.4z"
                      />
                    </svg>
                    {{ statusLabel(item.status) }}
                  </span>
                </div>
                <span class="muted">
                  {{ formatUtcToLocal(item.createdAt) }}
                  <template v-if="item.amount">
                    · ${{ item.amount.toLocaleString('es-MX') }}
                  </template>
                </span>
              </div>
              <div class="sale-card__actions">
                <button
                  type="button"
                  class="icon-btn"
                  title="Archivos anexados"
                  aria-label="Archivos anexados"
                  @click="openAttachments(item)"
                >
                  <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
                    <path
                      fill="currentColor"
                      d="M16.5 6.5v10.25a4.25 4.25 0 1 1-8.5 0V5.75a2.75 2.75 0 1 1 5.5 0v10.5a1.25 1.25 0 1 1-2.5 0V7.25h-1.5v9a2.75 2.75 0 1 0 5.5 0V5.75a4.25 4.25 0 1 0-8.5 0v11a5.75 5.75 0 1 0 11.5 0V6.5h-1.5z"
                    />
                  </svg>
                </button>
                <button
                  v-if="item.status === 'PENDING_PAYMENT'"
                  type="button"
                  class="icon-btn icon-btn--payment"
                  title="Registrar pago"
                  aria-label="Registrar pago"
                  @click="openPayment(item)"
                >
                  <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
                    <path
                      fill="currentColor"
                      d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1.41 16.09V20h-2.67v-1.93c-1.71-.36-3.16-1.46-3.27-3.4h1.96c.1 1.05.82 1.87 2.65 1.87 1.96 0 2.4-.98 2.4-1.59 0-.83-.44-1.61-2.67-2.14-2.48-.6-4.18-1.62-4.18-3.67 0-1.72 1.39-2.84 3.11-3.21V4h2.67v1.95c1.86.45 2.79 1.86 2.85 3.39H15.3c-.05-1.11-.64-1.87-2.22-1.87-1.5 0-2.4.68-2.4 1.64 0 .84.65 1.39 2.8 1.95 2.37.62 4.05 1.67 4.05 3.83 0 1.84-1.38 2.94-3.12 3.3z"
                    />
                  </svg>
                </button>
                <button
                  v-if="item.status === 'PENDING_SIGNATURE'"
                  type="button"
                  class="icon-btn icon-btn--sign"
                  title="Firmar"
                  aria-label="Firmar"
                  @click="openSign(item)"
                >
                  <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
                    <path
                      fill="currentColor"
                      d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1.003 1.003 0 0 0 0-1.42l-2.34-2.34a1.003 1.003 0 0 0-1.42 0l-1.83 1.83 3.75 3.75 1.84-1.82z"
                    />
                  </svg>
                </button>
                <button
                  type="button"
                  class="icon-btn"
                  title="Vista previa carátula"
                  aria-label="Vista previa carátula"
                  @click="openPreview(item)"
                >
                  <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
                    <path
                      fill="currentColor"
                      d="M12 5c-5 0-9.27 3.11-11 7 1.73 3.89 6 7 11 7s9.27-3.11 11-7c-1.73-3.89-6-7-11-7Zm0 12a5 5 0 1 1 0-10 5 5 0 0 1 0 10Zm0-2.5A2.5 2.5 0 1 0 12 9a2.5 2.5 0 0 0 0 5Z"
                    />
                  </svg>
                </button>
              </div>
            </li>
          </ul>
        </div>
      </template>
    </template>

    <SaleAttachmentsModal
      :open="attachmentsOpen"
      :items="attachmentItems"
      :loading="attachmentsLoading"
      @close="attachmentsOpen = false"
      @select="onSelectAttachment"
    />

    <SaleFilePreviewModal
      :open="filePreviewOpen"
      :title="filePreviewTitle"
      :attachment="filePreviewAttachment"
      @close="filePreviewOpen = false"
    />

    <SalePdfPreviewModal
      :open="previewOpen"
      :form="previewForm"
      :sale-id="previewId"
      :status="previewStatus"
      @close="previewOpen = false"
    />

    <SalePaymentModal
      :open="paymentOpen"
      :form="actionForm"
      :saving="paymentSaving"
      @close="paymentOpen = false"
      @save="savePayment"
    />

    <SaleManualSignModal
      :open="signOpen"
      :form="actionForm"
      :sale-id="actionSaleId"
      :status="actionStatus"
      :submitting="signSubmitting"
      @close="signOpen = false"
      @confirm="confirmSign"
    />

    <SellerDefaultsModal :open="defaultsOpen" @close="defaultsOpen = false" />
    <SaleKindModal
      :open="kindOpen"
      @close="kindOpen = false"
      @select="startSale"
    />
    <SaleRecognitionModal
      :open="recognitionOpen"
      :kind="originKind"
      @close="recognitionOpen = false"
      @back="onRecognitionBack"
      @apply="onRecognitionApply"
    />
  </section>
</template>

<style scoped>
.sales-page {
  width: 100%;
  max-width: 920px;
  margin: 0 auto;
}

.head-row {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 0.75rem;
  flex-wrap: wrap;
}

.head-row .btn {
  flex-shrink: 0;
}

.head-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.filters {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.75rem;
  align-items: end;
  margin-bottom: 0.85rem;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  min-width: 0;
}

.field label {
  font-size: 0.82rem;
  font-weight: 600;
  color: var(--vd-muted);
}

.field--wide {
  grid-column: 1 / -1;
}

.field input[type='date'],
.client-ac__row input {
  min-height: 44px;
  border: 1px solid var(--vd-line);
  border-radius: 8px;
  padding: 0.5rem 0.7rem;
  font: inherit;
  width: 100%;
  box-sizing: border-box;
}

.client-ac {
  position: relative;
}

.client-ac__row {
  display: flex;
  gap: 0.4rem;
  align-items: center;
}

.client-ac__row input {
  flex: 1;
  min-width: 0;
}

.client-ac__list {
  list-style: none;
  margin: 0.3rem 0 0;
  padding: 0.25rem;
  border: 1px solid var(--vd-line);
  border-radius: 8px;
  max-height: 220px;
  overflow: auto;
  background: #fff;
  position: absolute;
  z-index: 20;
  left: 0;
  right: 0;
  box-shadow: 0 8px 20px rgba(0, 0, 0, 0.08);
}

.client-ac__item {
  width: 100%;
  text-align: left;
  border: 0;
  background: transparent;
  padding: 0.55rem 0.65rem;
  border-radius: 6px;
  font: inherit;
  cursor: pointer;
}

.client-ac__item:hover,
.client-ac__item.active {
  background: #f0f5f8;
  color: var(--gsm-blue);
}

.client-ac__empty {
  margin: 0.3rem 0 0;
  font-size: 0.82rem;
  color: var(--vd-muted);
}

.filter-actions {
  grid-column: 1 / -1;
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.loading {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  color: var(--vd-muted);
}

.section-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin-bottom: 0.75rem;
}

.section-head h2,
.stage-toggle h2 {
  margin: 0;
  font-size: 1.15rem;
  color: var(--gsm-blue);
}

.stage-panel {
  border-left: 4px solid var(--vd-line);
  margin-top: 0.85rem;
}

.stage-panel--collapsed {
  padding-top: 0.85rem;
  padding-bottom: 0.85rem;
}

.stage-toggle {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.75rem;
  width: 100%;
  margin: 0 0 0.75rem;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.stage-panel--collapsed .stage-toggle {
  margin-bottom: 0;
}

.stage-toggle__title {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  min-width: 0;
}

.stage-chevron {
  flex-shrink: 0;
  color: var(--vd-muted);
  transition: transform 0.16s ease;
}

.stage-panel--collapsed .stage-chevron {
  transform: rotate(-90deg);
}

.stage-toggle:hover h2,
.stage-toggle:focus-visible h2 {
  text-decoration: underline;
  text-underline-offset: 3px;
}

.stage-toggle:focus-visible {
  outline: 2px solid var(--gsm-blue);
  outline-offset: 4px;
  border-radius: 6px;
}

.stage-panel--draft {
  border-left-color: rgba(53, 100, 125, 0.35);
}

.stage-panel--payment {
  border-left-color: #c48a22;
}

.stage-panel--sign {
  border-left-color: var(--gsm-blue);
}

.stage-panel--done {
  border-left-color: var(--vd-ok);
}

.stage-panel--rejected {
  border-left-color: var(--vd-danger);
}

.muted {
  color: var(--vd-muted);
  font-size: 0.88rem;
}

.card-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
}

.sale-card {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.75rem;
  padding: 0.85rem 0.95rem;
  border: 1px solid var(--vd-line);
  border-radius: 12px;
  background: var(--vd-surface-2);
}

.sale-card__main {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  min-width: 0;
}

.sale-card__main strong {
  color: var(--vd-ink);
}

.sale-card__title {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.45rem;
}

.sale-card__actions {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  flex-shrink: 0;
}

.status-badge {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.18rem 0.55rem;
  border-radius: 999px;
  font-size: 0.72rem;
  font-weight: 700;
  line-height: 1.2;
  white-space: nowrap;
  background: rgba(53, 100, 125, 0.1);
  color: var(--gsm-blue);
}

.status-badge__icon {
  flex-shrink: 0;
}

.status-badge--payment {
  background: rgba(180, 120, 20, 0.12);
  color: #9a6410;
}

.status-badge--sign {
  background: rgba(53, 100, 125, 0.12);
  color: var(--gsm-blue);
}

.status-badge--done {
  background: rgba(47, 111, 78, 0.12);
  color: var(--vd-ok);
}

.status-badge--rejected {
  background: rgba(196, 40, 28, 0.1);
  color: var(--vd-danger);
}

.icon-btn {
  border: 1px solid var(--vd-line);
  background: #fff;
  color: var(--gsm-blue);
  width: 44px;
  height: 44px;
  border-radius: 10px;
  display: grid;
  place-items: center;
  cursor: pointer;
}

.icon-btn:hover {
  border-color: var(--gsm-blue);
  background: rgba(53, 100, 125, 0.06);
}

.icon-btn--payment {
  color: #9a6410;
}

.icon-btn--payment:hover {
  border-color: #9a6410;
  background: rgba(180, 120, 20, 0.08);
}

.icon-btn--sign {
  color: var(--gsm-blue);
}

.btn-sm {
  min-height: 40px;
  padding: 0.35rem 0.7rem;
  font-size: 0.85rem;
}

@media (max-width: 600px) {
  .head-row {
    flex-direction: column;
    align-items: stretch;
  }

  .head-row .btn {
    width: 100%;
    min-height: 48px;
  }

  .sale-card {
    flex-direction: column;
    align-items: stretch;
  }

  .sale-card__actions {
    justify-content: flex-end;
    flex-wrap: wrap;
  }

  .sale-card__actions .btn {
    flex: 1;
    min-height: 44px;
  }
}
</style>
