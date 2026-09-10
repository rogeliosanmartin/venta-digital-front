<script setup lang="ts">
import { computed, nextTick, onUnmounted, reactive, ref, watch } from 'vue';
import VdModal from '../../../shared/ui/modal/VdModal.vue';
import { fullName, type SaleFormData } from '../types/sale-form';
import { pdfBlobViewUrl } from '../utils/pdf-page-renderer';
import {
  buildAuthorizationLetterBundle,
} from '../utils/authorization-letter-pdf';
import { buildConvenioLetterBundle } from '../utils/convenio-letter-pdf';
import { buildExclusionesLetterBundle } from '../utils/exclusiones-letter-pdf';
import { buildInvoiceLetterBundle } from '../utils/invoice-letter-pdf';
import { buildNoInvoiceConsentBundle } from '../utils/no-invoice-consent-pdf';
import { buildParkRegulationBundle } from '../utils/park-regulation-pdf';
import { buildParkRegulationBookletBundle } from '../utils/park-regulation-booklet-pdf';
import { buildSalePreviewBundle } from '../utils/sale-pdf';
import {
  listSignDocuments,
  type SignDocument,
  type SignDocumentKind,
} from '../utils/sign-documents';

const props = defineProps<{
  open: boolean;
  form: SaleFormData;
  saleId?: number | null;
  status?: string;
  submitting?: boolean;
}>();

const emit = defineEmits<{
  close: [];
  confirm: [dataUrl: string];
}>();

type Phase = 'list' | 'read' | 'sign';

const phase = ref<Phase>('list');
const accepted = reactive<Partial<Record<SignDocumentKind, boolean>>>({});
const activeDoc = ref<SignDocument | null>(null);
const reachedEnd = ref(false);
const acceptCurrent = ref(false);
const readerEl = ref<HTMLElement | null>(null);

const loadingDoc = ref(false);
const docError = ref<string | null>(null);
const pageImages = ref<string[]>([]);
const embedUrl = ref<string | null>(null);
const objectUrls = ref<string[]>([]);
const pageCache = new Map<SignDocumentKind, string[]>();

const canvasRef = ref<HTMLCanvasElement | null>(null);
const hasStroke = ref(false);
let drawing = false;
let ctx: CanvasRenderingContext2D | null = null;

const signDocs = computed(() => listSignDocuments(props.form));

const acceptedCount = computed(
  () => signDocs.value.filter((d) => accepted[d.kind]).length,
);

const allAccepted = computed(
  () =>
    signDocs.value.length > 0 &&
    signDocs.value.every((d) => accepted[d.kind]),
);

const modalTitle = computed(() => {
  if (phase.value === 'read') {
    return activeDoc.value?.title || 'Documento';
  }
  if (phase.value === 'sign') return 'Firmar manualmente';
  return 'Documentos a firmar';
});

function resetFlow() {
  phase.value = 'list';
  activeDoc.value = null;
  reachedEnd.value = false;
  acceptCurrent.value = false;
  pageImages.value = [];
  embedUrl.value = null;
  docError.value = null;
  loadingDoc.value = false;
  hasStroke.value = false;
  drawing = false;
  pageCache.clear();
  for (const key of Object.keys(accepted) as SignDocumentKind[]) {
    delete accepted[key];
  }
  revokeObjectUrls();
}

function revokeObjectUrls() {
  for (const url of objectUrls.value) URL.revokeObjectURL(url);
  objectUrls.value = [];
}

async function buildDocBundle(kind: SignDocumentKind) {
  const opts = { saleId: props.saleId, status: props.status };
  switch (kind) {
    case 'cartaFactura':
      return buildInvoiceLetterBundle(props.form, opts);
    case 'cartaExclusiones':
      return buildExclusionesLetterBundle(props.form, opts);
    case 'cartaNoFactura':
      return buildNoInvoiceConsentBundle(props.form, opts);
    case 'reglamentoParque':
      return buildParkRegulationBundle(props.form, opts);
    case 'reglamentoParqueFolleto':
      return buildParkRegulationBookletBundle(props.form, opts);
    case 'cartaAutorizacion':
      return buildAuthorizationLetterBundle(props.form, opts);
    case 'cartaNomina':
      return buildConvenioLetterBundle(props.form, opts);
    default:
      return buildSalePreviewBundle(props.form, opts);
  }
}

function updateReachedEnd() {
  const el = readerEl.value;
  if (!el) return;
  if (el.scrollHeight <= el.clientHeight + 8) {
    reachedEnd.value = true;
    return;
  }
  reachedEnd.value = el.scrollHeight - el.scrollTop - el.clientHeight <= 36;
}

async function openDocument(doc: SignDocument) {
  activeDoc.value = doc;
  phase.value = 'read';
  reachedEnd.value = Boolean(accepted[doc.kind]);
  acceptCurrent.value = Boolean(accepted[doc.kind]);
  pageImages.value = [];
  embedUrl.value = null;
  docError.value = null;

  const cached = pageCache.get(doc.kind);
  if (cached?.length) {
    pageImages.value = cached;
    await nextTick();
    updateReachedEnd();
    return;
  }

  loadingDoc.value = true;
  try {
    const { blob, pages } = await buildDocBundle(doc.kind);
    if (pages.length) {
      pageCache.set(doc.kind, pages);
      pageImages.value = pages;
    } else {
      const url = URL.createObjectURL(blob);
      objectUrls.value.push(url);
      embedUrl.value = pdfBlobViewUrl(url);
    }
    await nextTick();
    updateReachedEnd();
  } catch {
    docError.value = 'No se pudo abrir el documento. Intenta de nuevo.';
  } finally {
    loadingDoc.value = false;
    await nextTick();
    updateReachedEnd();
  }
}

function backToList() {
  phase.value = 'list';
  activeDoc.value = null;
  reachedEnd.value = false;
  acceptCurrent.value = false;
  pageImages.value = [];
  embedUrl.value = null;
  docError.value = null;
}

function onAcceptChange(checked: boolean) {
  if (!activeDoc.value || !reachedEnd.value) return;
  acceptCurrent.value = checked;
  accepted[activeDoc.value.kind] = checked;
}

function goSign() {
  if (!allAccepted.value || props.submitting) return;
  phase.value = 'sign';
  void nextTick().then(setupCanvas);
}

function setupCanvas() {
  const canvas = canvasRef.value;
  if (!canvas) return;
  const parent = canvas.parentElement;
  const cssW = parent?.clientWidth || 320;
  const cssH = 180;
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  canvas.width = Math.floor(cssW * dpr);
  canvas.height = Math.floor(cssH * dpr);
  canvas.style.width = `${cssW}px`;
  canvas.style.height = `${cssH}px`;
  ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, cssW, cssH);
  ctx.strokeStyle = '#1a222a';
  ctx.lineWidth = 2.2;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  hasStroke.value = false;
}

function pos(e: PointerEvent) {
  const canvas = canvasRef.value!;
  const r = canvas.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

function onPointerDown(e: PointerEvent) {
  if (!ctx || props.submitting) return;
  drawing = true;
  canvasRef.value?.setPointerCapture(e.pointerId);
  const p = pos(e);
  ctx.beginPath();
  ctx.moveTo(p.x, p.y);
}

function onPointerMove(e: PointerEvent) {
  if (!drawing || !ctx) return;
  const p = pos(e);
  ctx.lineTo(p.x, p.y);
  ctx.stroke();
  hasStroke.value = true;
}

function onPointerUp() {
  drawing = false;
}

function clearPad() {
  setupCanvas();
}

function confirmSign() {
  const canvas = canvasRef.value;
  if (!canvas || !hasStroke.value || !allAccepted.value) return;
  emit('confirm', canvas.toDataURL('image/png'));
}

watch(
  () => props.open,
  async (open) => {
    if (!open) {
      resetFlow();
      return;
    }
    resetFlow();
  },
);

onUnmounted(() => {
  ctx = null;
  revokeObjectUrls();
});
</script>

<template>
  <VdModal
    :open="open"
    :title="modalTitle"
    :wide="phase !== 'read'"
    :xlarge="phase === 'read'"
    :lock-body="phase === 'read'"
    :close-on-scrim="!submitting"
    @close="emit('close')"
  >
    <div v-if="phase === 'list'" class="docs">
      <p class="docs__hint">
        El titular
        <strong>{{ fullName(form.contacto) || 'del contrato' }}</strong>
        debe leer cada documento y aceptar los términos y condiciones.
        Hasta entonces no se puede firmar.
      </p>
      <ul class="docs__list">
        <li v-for="doc in signDocs" :key="doc.kind">
          <button
            type="button"
            class="docs__item"
            :class="{ 'docs__item--done': accepted[doc.kind] }"
            @click="openDocument(doc)"
          >
            <span class="docs__item-text">
              <strong>{{ doc.title }}</strong>
              <small>{{ doc.hint }}</small>
            </span>
            <span
              class="docs__item-status"
              :class="{ 'docs__item-status--ok': accepted[doc.kind] }"
            >
              {{ accepted[doc.kind] ? 'Aceptado' : 'Leer' }}
            </span>
          </button>
        </li>
      </ul>
      <p class="docs__progress">
        {{ acceptedCount }} de {{ signDocs.length }} documentos aceptados
      </p>
    </div>

    <div v-else-if="phase === 'read'" class="reader">
      <div
        ref="readerEl"
        class="reader__scroll"
        @scroll="updateReachedEnd"
      >
        <div v-if="loadingDoc" class="reader__state">
          <span class="spinner" />
          Abriendo documento…
        </div>
        <p v-else-if="docError" class="error-text">{{ docError }}</p>
        <template v-else>
          <div v-if="pageImages.length" class="reader__pages">
            <img
              v-for="(src, i) in pageImages"
              :key="i"
              :src="src"
              class="reader__page"
              :alt="`Hoja ${i + 1}`"
              @load="updateReachedEnd"
            />
          </div>
          <div v-else-if="embedUrl" class="reader__embed">
            <iframe :src="embedUrl" :title="modalTitle" />
          </div>
          <label
            class="terms"
            :class="{ 'terms--locked': !reachedEnd }"
          >
            <input
              type="checkbox"
              :checked="acceptCurrent"
              :disabled="!reachedEnd"
              @change="
                onAcceptChange(($event.target as HTMLInputElement).checked)
              "
            />
            <span>Acepto términos y condiciones</span>
          </label>
          <p v-if="!reachedEnd" class="reader__need-end">
            Recorre el documento hasta el final para habilitar la casilla.
          </p>
        </template>
      </div>
    </div>

    <div v-else class="sign">
      <p class="sign__hint">
        Pide al titular
        <strong>{{ fullName(form.contacto) || 'del contrato' }}</strong>
        que firme en el recuadro con el dedo o el mouse.
      </p>
      <div class="sign__pad-wrap">
        <canvas
          ref="canvasRef"
          class="sign__pad"
          @pointerdown="onPointerDown"
          @pointermove="onPointerMove"
          @pointerup="onPointerUp"
          @pointercancel="onPointerUp"
          @pointerleave="onPointerUp"
        />
      </div>
      <p v-if="!hasStroke" class="sign__empty">Aún no hay firma</p>
    </div>

    <template #footer>
      <template v-if="phase === 'list'">
        <button
          type="button"
          class="btn btn-ghost"
          :disabled="submitting"
          @click="emit('close')"
        >
          Cancelar
        </button>
        <button
          type="button"
          class="btn btn-primary"
          :disabled="!allAccepted || submitting"
          @click="goSign"
        >
          Firmar
        </button>
      </template>

      <template v-else-if="phase === 'read'">
        <button type="button" class="btn btn-ghost" @click="backToList">
          Volver a la lista
        </button>
      </template>

      <template v-else>
        <button
          type="button"
          class="btn btn-ghost"
          :disabled="submitting"
          @click="backToList"
        >
          Volver
        </button>
        <button
          type="button"
          class="btn btn-ghost"
          :disabled="submitting"
          @click="clearPad"
        >
          Limpiar
        </button>
        <button
          type="button"
          class="btn btn-ghost"
          :disabled="submitting"
          @click="emit('close')"
        >
          Cancelar
        </button>
        <button
          type="button"
          class="btn btn-primary"
          :disabled="!hasStroke || !allAccepted || submitting"
          @click="confirmSign"
        >
          {{ submitting ? 'Enviando…' : 'Confirmar y enviar' }}
        </button>
      </template>
    </template>
  </VdModal>
</template>

<style scoped>
.docs,
.sign {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.docs__hint,
.sign__hint {
  margin: 0;
  color: var(--vd-muted);
  font-size: 0.92rem;
  line-height: 1.4;
}

.docs__hint strong,
.sign__hint strong {
  color: var(--vd-ink);
}

.docs__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
}

.docs__item {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  text-align: left;
  padding: 0.8rem 0.9rem;
  border: 1px solid var(--vd-line);
  border-radius: 10px;
  background: #fff;
  color: inherit;
  font: inherit;
  cursor: pointer;
}

.docs__item:hover {
  border-color: var(--gsm-blue);
  background: rgba(53, 100, 125, 0.05);
}

.docs__item--done {
  border-color: rgba(47, 111, 78, 0.35);
  background: rgba(47, 111, 78, 0.06);
}

.docs__item-text {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  min-width: 0;
}

.docs__item-text strong {
  color: var(--vd-ink);
}

.docs__item-text small {
  color: var(--vd-muted);
  font-size: 0.8rem;
}

.docs__item-status {
  flex-shrink: 0;
  font-size: 0.75rem;
  font-weight: 700;
  color: var(--gsm-blue);
}

.docs__item-status--ok {
  color: var(--vd-ok);
}

.docs__progress {
  margin: 0;
  font-size: 0.82rem;
  color: var(--vd-muted);
}

.reader {
  min-height: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
}

.reader__scroll {
  flex: 1;
  min-height: 0;
  overflow: auto;
  overscroll-behavior: contain;
  -webkit-overflow-scrolling: touch;
  background: #dfe6eb;
  border-radius: 8px;
  padding: 0.65rem;
}

.reader__state {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.65rem;
  color: var(--vd-muted);
  min-height: 40vh;
}

.reader__pages {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
}

.reader__page {
  width: 100%;
  height: auto;
  display: block;
  background: #fff;
  border-radius: 2px;
  box-shadow: 0 2px 12px rgba(28, 42, 51, 0.14);
}

.reader__embed {
  min-height: min(58vh, 640px);
  border-radius: 6px;
  overflow: hidden;
  background: #fff;
}

.reader__embed iframe {
  width: 100%;
  height: min(58vh, 640px);
  border: 0;
}

.terms {
  display: flex;
  align-items: flex-start;
  gap: 0.55rem;
  margin: 0.85rem 0 0;
  padding: 0.85rem 0.9rem;
  border-radius: 10px;
  background: #fff;
  font-weight: 600;
  color: var(--vd-ink);
}

.terms input {
  margin-top: 0.15rem;
  width: 1.1rem;
  height: 1.1rem;
  accent-color: var(--gsm-blue);
}

.terms--locked {
  color: var(--vd-muted);
}

.reader__need-end {
  margin: 0.45rem 0 0;
  font-size: 0.82rem;
  color: var(--vd-muted);
}

.sign__pad-wrap {
  border: 1.5px dashed var(--vd-line);
  border-radius: 8px;
  background:
    linear-gradient(#fff, #fff) padding-box,
    repeating-linear-gradient(
      -45deg,
      #f4f7f9,
      #f4f7f9 8px,
      #eef3f6 8px,
      #eef3f6 16px
    );
  overflow: hidden;
  touch-action: none;
}

.sign__pad {
  display: block;
  width: 100%;
  height: 180px;
  cursor: crosshair;
  touch-action: none;
  background: #fff;
}

.sign__empty {
  margin: 0;
  font-size: 0.82rem;
  color: var(--vd-muted);
  text-align: center;
}

@media (max-width: 1024px) {
  .reader__scroll {
    max-height: none;
    min-height: 0;
    flex: 1;
  }
}
</style>
