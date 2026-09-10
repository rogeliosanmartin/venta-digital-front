<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue';
import VdModal from '../../../shared/ui/modal/VdModal.vue';
import { pdfBlobViewUrl } from '../utils/pdf-page-renderer';
import {
  buildAuthorizationLetterBundle,
  isDraftAuthorizationLetter,
} from '../utils/authorization-letter-pdf';
import {
  buildConvenioLetterBundle,
  isDraftConvenioLetter,
} from '../utils/convenio-letter-pdf';
import {
  buildExclusionesLetterBundle,
  isDraftExclusionesLetter,
} from '../utils/exclusiones-letter-pdf';
import {
  buildInvoiceLetterBundle,
  isDraftInvoiceLetter,
} from '../utils/invoice-letter-pdf';
import {
  buildNoInvoiceConsentBundle,
  isDraftNoInvoiceConsent,
} from '../utils/no-invoice-consent-pdf';
import {
  buildParkRegulationBundle,
  isDraftParkRegulation,
} from '../utils/park-regulation-pdf';
import { buildParkRegulationBookletBundle } from '../utils/park-regulation-booklet-pdf';
import { buildSalePreviewBundle, isDraftCaratula } from '../utils/sale-pdf';
import { buildCardSidesBundle, buildIneSidesBundle } from '../utils/card-sides-pdf';
import type { SaleFormData } from '../types/sale-form';

const props = withDefaults(
  defineProps<{
    open: boolean;
    form: SaleFormData;
    saleId?: number | null;
    status?: string;
    kind?:
      | 'caratula'
      | 'cartaFactura'
      | 'cartaNoFactura'
      | 'cartaExclusiones'
      | 'reglamentoParque'
      | 'reglamentoParqueFolleto'
      | 'cartaAutorizacion'
      | 'cartaNomina'
      | 'tarjeta'
      | 'ine';
  }>(),
  { kind: 'caratula' },
);

const emit = defineEmits<{ close: [] }>();

const loading = ref(false);
const error = ref<string | null>(null);
const pageImages = ref<string[]>([]);
const downloadUrl = ref<string | null>(null);
const embedUrl = ref<string | null>(null);

const useEmbedFallback = computed(
  () => !loading.value && !error.value && pageImages.value.length === 0 && Boolean(embedUrl.value),
);

const isCarta = computed(() => props.kind === 'cartaFactura');
const isNoFactura = computed(() => props.kind === 'cartaNoFactura');
const isExclusiones = computed(() => props.kind === 'cartaExclusiones');
const isReglamento = computed(() => props.kind === 'reglamentoParque');
const isReglamentoFolleto = computed(
  () => props.kind === 'reglamentoParqueFolleto',
);
const isAuth = computed(() => props.kind === 'cartaAutorizacion');
const isNomina = computed(() => props.kind === 'cartaNomina');
const isTarjeta = computed(() => props.kind === 'tarjeta');
const isIne = computed(() => props.kind === 'ine');
const isDraft = computed(() => {
  if (isTarjeta.value || isIne.value) return false;
  const opts = { saleId: props.saleId, status: props.status };
  if (isAuth.value) return isDraftAuthorizationLetter(props.form, opts);
  if (isNomina.value) return isDraftConvenioLetter(props.form, opts);
  if (isReglamento.value || isReglamentoFolleto.value) {
    return isDraftParkRegulation(props.form, opts);
  }
  if (isExclusiones.value) return isDraftExclusionesLetter(props.form, opts);
  if (isNoFactura.value) return isDraftNoInvoiceConsent(props.form, opts);
  if (isCarta.value) return isDraftInvoiceLetter(props.form, opts);
  return isDraftCaratula(props.form, opts);
});
const modalTitle = computed(() => {
  if (isTarjeta.value) return 'Tarjeta (ambos lados)';
  if (isIne.value) return 'INE (ambos lados)';
  if (isAuth.value) {
    return isDraft.value
      ? 'Carta de autorización (borrador)'
      : 'Carta de autorización';
  }
  if (isNomina.value) {
    const empresa = (props.form.pago.empresaNomina || '').trim();
    const title = empresa
      ? `Carta de consentimiento · ${empresa}`
      : 'Carta de consentimiento (nómina)';
    return isDraft.value ? `${title} (borrador)` : title;
  }
  if (isReglamentoFolleto.value) {
    return isDraft.value
      ? 'Reglamento de parque (artículos, borrador)'
      : 'Reglamento de parque (artículos)';
  }
  if (isReglamento.value) {
    return isDraft.value
      ? 'Reglamento de parque (borrador)'
      : 'Reglamento de parque';
  }
  if (isExclusiones.value) {
    return isDraft.value
      ? 'Carta de aceptación de exclusiones (borrador)'
      : 'Carta de aceptación de exclusiones';
  }
  if (isNoFactura.value) {
    return isDraft.value
      ? 'Consentimiento de no factura (borrador)'
      : 'Consentimiento de no factura';
  }
  if (isCarta.value) {
    return isDraft.value
      ? 'Carta de requerimiento de factura (borrador)'
      : 'Carta de requerimiento de factura';
  }
  return isDraft.value
    ? 'Carátula del contrato (borrador)'
    : 'Carátula del contrato';
});
const downloadName = computed(() => {
  if (isTarjeta.value) return 'tarjeta-ambos-lados.pdf';
  if (isIne.value) return 'ine-ambos-lados.pdf';
  if (isAuth.value) {
    return isDraft.value
      ? 'carta-autorizacion-borrador.pdf'
      : 'carta-autorizacion.pdf';
  }
  if (isNomina.value) {
    return isDraft.value
      ? 'carta-consentimiento-nomina-borrador.pdf'
      : 'carta-consentimiento-nomina.pdf';
  }
  if (isReglamentoFolleto.value) {
    return isDraft.value
      ? 'reglamento-parque-articulos-borrador.pdf'
      : 'reglamento-parque-articulos.pdf';
  }
  if (isReglamento.value) {
    return isDraft.value
      ? 'reglamento-parque-borrador.pdf'
      : 'reglamento-parque.pdf';
  }
  if (isExclusiones.value) {
    return isDraft.value
      ? 'carta-aceptacion-exclusiones-borrador.pdf'
      : 'carta-aceptacion-exclusiones.pdf';
  }
  if (isNoFactura.value) {
    return isDraft.value
      ? 'consentimiento-no-factura-borrador.pdf'
      : 'consentimiento-no-factura.pdf';
  }
  if (isCarta.value) {
    return isDraft.value
      ? 'carta-requerimiento-factura-borrador.pdf'
      : 'carta-requerimiento-factura.pdf';
  }
  return isDraft.value ? 'caratula-contrato-borrador.pdf' : 'caratula-contrato.pdf';
});
const generatingLabel = computed(() => {
  if (isTarjeta.value) return 'Armando PDF de la tarjeta…';
  if (isIne.value) return 'Armando PDF de la INE…';
  if (isReglamentoFolleto.value) return 'Generando folleto…';
  if (isAuth.value || isNomina.value || isCarta.value || isNoFactura.value || isReglamento.value || isExclusiones.value) {
    return 'Generando carta…';
  }
  return 'Generando carátula…';
});

async function render() {
  loading.value = true;
  error.value = null;
  pageImages.value = [];
  if (downloadUrl.value) {
    URL.revokeObjectURL(downloadUrl.value);
    downloadUrl.value = null;
  }
  if (embedUrl.value) {
    embedUrl.value = null;
  }

  try {
    const opts = { saleId: props.saleId, status: props.status };
    if (isTarjeta.value) {
      const frente = props.form.documentos.tarjetaFrente;
      const reverso = props.form.documentos.tarjetaReverso;
      if (!frente || !reverso) {
        throw new Error('Faltan las fotos de la tarjeta');
      }
    }
    if (isIne.value) {
      const frente = props.form.documentos.ineFrente;
      const reverso = props.form.documentos.ineReverso;
      if (!frente || !reverso) {
        throw new Error('Faltan las fotos de la INE');
      }
    }
    const { blob, pages } = isTarjeta.value
      ? await buildCardSidesBundle(
          props.form.documentos.tarjetaFrente!,
          props.form.documentos.tarjetaReverso!,
        )
      : isIne.value
        ? await buildIneSidesBundle(
            props.form.documentos.ineFrente!,
            props.form.documentos.ineReverso!,
          )
        : isAuth.value
        ? await buildAuthorizationLetterBundle(props.form, opts)
        : isNomina.value
          ? await buildConvenioLetterBundle(props.form, opts)
        : isReglamentoFolleto.value
          ? await buildParkRegulationBookletBundle(props.form, opts)
        : isReglamento.value
          ? await buildParkRegulationBundle(props.form, opts)
          : isExclusiones.value
            ? await buildExclusionesLetterBundle(props.form, opts)
            : isNoFactura.value
              ? await buildNoInvoiceConsentBundle(props.form, opts)
              : isCarta.value
                ? await buildInvoiceLetterBundle(props.form, opts)
                : await buildSalePreviewBundle(props.form, opts);
    downloadUrl.value = URL.createObjectURL(blob);
    if (pages.length) {
      pageImages.value = pages;
    } else {
      embedUrl.value = pdfBlobViewUrl(downloadUrl.value);
    }
  } catch {
    error.value = isTarjeta.value
      ? 'No se pudo armar el PDF con ambos lados de la tarjeta.'
      : isIne.value
        ? 'No se pudo armar el PDF con ambos lados de la INE.'
        : isAuth.value
        ? 'No se pudo generar la carta de autorización.'
        : isNomina.value
          ? 'No se pudo generar la carta de consentimiento de nómina.'
        : isReglamentoFolleto.value
          ? 'No se pudo generar el folleto del reglamento de parque.'
        : isReglamento.value
          ? 'No se pudo generar el reglamento de parque.'
          : isExclusiones.value
            ? 'No se pudo generar la carta de aceptación de exclusiones.'
            : isNoFactura.value
            ? 'No se pudo generar el consentimiento de no factura.'
            : isCarta.value
              ? 'No se pudo generar la carta de requerimiento de factura.'
              : 'No se pudo generar la carátula. Intenta de nuevo.';
  } finally {
    loading.value = false;
  }
}

watch(
  () =>
    [
      props.open,
      props.kind,
      props.form.pago.empresaNominaId,
      props.form.pago.empresaNomina,
    ] as const,
  ([open]) => {
    if (open) void render();
  },
);

onUnmounted(() => {
  if (downloadUrl.value) URL.revokeObjectURL(downloadUrl.value);
});
</script>

<template>
  <VdModal
    :open="open"
    :title="modalTitle"
    xlarge
    @close="emit('close')"
  >
    <div class="preview">
      <div v-if="loading" class="preview__state">
        <span class="spinner" />
        {{ generatingLabel }}
      </div>
      <p v-else-if="error" class="error-text">{{ error }}</p>
      <div
        v-else-if="pageImages.length"
        class="preview__pages"
        :class="{ 'preview__pages--booklet': isReglamentoFolleto }"
      >
        <img
          v-for="(src, i) in pageImages"
          :key="i"
          :src="src"
          class="preview__page"
          :class="{ 'preview__page--booklet': isReglamentoFolleto }"
          :alt="`Hoja ${i + 1}`"
        />
      </div>
      <div v-else-if="useEmbedFallback" class="preview__embed">
        <iframe :src="embedUrl!" :title="modalTitle" />
      </div>
    </div>

    <template #footer>
      <a
        v-if="downloadUrl"
        class="btn btn-accent"
        :href="downloadUrl"
        :download="downloadName"
      >
        Descargar PDF
      </a>
      <button type="button" class="btn btn-ghost" @click="emit('close')">
        Cerrar
      </button>
    </template>
  </VdModal>
</template>

<style scoped>
.preview {
  min-height: 40vh;
  height: 100%;
  background: #dfe6eb;
  border-radius: 8px;
  padding: 0.65rem;
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.preview__state {
  display: flex;
  align-items: center;
  gap: 0.65rem;
  color: var(--vd-muted);
  min-height: 40vh;
  justify-content: center;
  flex: 1;
}

.preview__pages {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
  max-height: min(72vh, 800px);
  overflow: auto;
  overscroll-behavior: contain;
  -webkit-overflow-scrolling: touch;
  touch-action: pan-y;
}

.preview__page {
  width: 100%;
  height: auto;
  display: block;
  background: #fff;
  border-radius: 2px;
  box-shadow: 0 2px 12px rgba(28, 42, 51, 0.14);
}

.preview__pages--booklet {
  gap: 1rem;
}

.preview__page--booklet {
  width: 100%;
  max-width: none;
}

.preview__embed {
  flex: 1;
  min-height: min(68vh, 720px);
  border-radius: 6px;
  overflow: hidden;
  background: #fff;
}

.preview__embed iframe {
  width: 100%;
  height: 100%;
  min-height: min(68vh, 720px);
  border: 0;
}

@media (max-width: 1024px) {
  .preview {
    min-height: 0;
    flex: 1;
    padding: 0.5rem;
  }

  .preview__pages {
    flex: 1;
    max-height: none;
    min-height: 0;
  }

  .preview__embed {
    min-height: 0;
  }

  .preview__embed iframe {
    min-height: 100%;
  }
}

@media (max-width: 600px) {
  .preview__pages {
    gap: 0.65rem;
  }
}
</style>
