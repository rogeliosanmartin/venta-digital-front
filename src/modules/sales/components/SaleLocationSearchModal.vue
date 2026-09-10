<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { extractApiError, http } from '../../../shared/api/http';
import VdModal from '../../../shared/ui/modal/VdModal.vue';

export type UbicacionOption = {
  id: number;
  name: string;
  code?: string | null;
  status?: string | null;
};

export type ParkLocationSelection = {
  parkId: number;
  parkName: string;
  sectionId: number;
  sectionName: string;
  quadrantId: number | null;
  quadrantName: string;
  spaceId: number | null;
  spaceName: string;
  spaceCode?: string | null;
};

type Step = 'parque' | 'seccion' | 'cuadrante' | 'espacio';

const ALL_STEPS: Step[] = ['parque', 'seccion', 'cuadrante', 'espacio'];
const PARK_SECTION_STEPS: Step[] = ['parque', 'seccion'];

const props = defineProps<{
  open: boolean;
  /** Sin preasignación: solo parque y sección. */
  stopAt?: 'seccion' | 'espacio';
}>();

const emit = defineEmits<{
  close: [];
  select: [location: ParkLocationSelection];
}>();

const step = ref<Step>('parque');
const q = ref('');
const loading = ref(false);
const error = ref<string | null>(null);
const results = ref<UbicacionOption[]>([]);

const selected = ref<Partial<ParkLocationSelection>>({});

let timer: ReturnType<typeof setTimeout> | null = null;

const flowSteps = computed(() =>
  props.stopAt === 'seccion' ? PARK_SECTION_STEPS : ALL_STEPS,
);

const stepIndex = computed(() => flowSteps.value.indexOf(step.value));
const totalSteps = computed(() => flowSteps.value.length);
const stepTitle = computed(() => {
  const titles: Record<Step, string> = {
    parque: 'Parque',
    seccion: 'Sección',
    cuadrante: 'Cuadrante',
    espacio: 'Ubicación',
  };
  return titles[step.value];
});

const breadcrumb = computed(() => {
  const parts: string[] = [];
  if (selected.value.parkName) parts.push(selected.value.parkName);
  if (selected.value.sectionName) parts.push(selected.value.sectionName);
  if (selected.value.quadrantName) parts.push(selected.value.quadrantName);
  return parts.join(' › ');
});

function resetModal() {
  step.value = 'parque';
  q.value = '';
  results.value = [];
  error.value = null;
  selected.value = {};
}

async function fetchResults() {
  loading.value = true;
  error.value = null;
  try {
    const term = q.value.trim();
    const limit = 30;
    let data: UbicacionOption[] = [];

    if (step.value === 'parque') {
      const res = await http.get<UbicacionOption[]>('/odoo/ubicaciones/parques', {
        params: { q: term || undefined, limit },
      });
      data = res.data || [];
    } else if (step.value === 'seccion') {
      const res = await http.get<UbicacionOption[]>(
        '/odoo/ubicaciones/secciones',
        {
          params: {
            parkId: selected.value.parkId,
            q: term || undefined,
            limit,
          },
        },
      );
      data = res.data || [];
    } else if (step.value === 'cuadrante') {
      const res = await http.get<UbicacionOption[]>(
        '/odoo/ubicaciones/cuadrantes',
        {
          params: {
            parkId: selected.value.parkId,
            sectionId: selected.value.sectionId,
            q: term || undefined,
            limit,
          },
        },
      );
      data = res.data || [];
    } else {
      const res = await http.get<UbicacionOption[]>(
        '/odoo/ubicaciones/espacios',
        {
          params: {
            parkId: selected.value.parkId,
            sectionId: selected.value.sectionId,
            quadrantId: selected.value.quadrantId,
            q: term || undefined,
            limit,
          },
        },
      );
      data = res.data || [];
    }

    results.value = data;
    if (!data.length) error.value = 'Sin coincidencias';
  } catch (e: unknown) {
    results.value = [];
    error.value = extractApiError(e, 'No se pudo buscar ubicaciones');
  } finally {
    loading.value = false;
  }
}

function onInput() {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    void fetchResults();
  }, 300);
}

function emitParkSection(extra?: {
  quadrantId?: number | null;
  quadrantName?: string;
  spaceId?: number | null;
  spaceName?: string;
  spaceCode?: string | null;
}) {
  emit('select', {
    parkId: selected.value.parkId!,
    parkName: selected.value.parkName!,
    sectionId: selected.value.sectionId!,
    sectionName: selected.value.sectionName!,
    quadrantId: extra?.quadrantId ?? null,
    quadrantName: extra?.quadrantName ?? '',
    spaceId: extra?.spaceId ?? null,
    spaceName: extra?.spaceName ?? '',
    spaceCode: extra?.spaceCode ?? null,
  });
}

function goBack() {
  if (stepIndex.value <= 0) return;
  step.value = flowSteps.value[stepIndex.value - 1];
  q.value = '';
  results.value = [];
  error.value = null;
  void fetchResults();
}

function pick(item: UbicacionOption) {
  if (step.value === 'parque') {
    selected.value = {
      parkId: item.id,
      parkName: item.name,
    };
    step.value = 'seccion';
  } else if (step.value === 'seccion') {
    selected.value = {
      ...selected.value,
      sectionId: item.id,
      sectionName: item.name,
    };
    if (props.stopAt === 'seccion') {
      emitParkSection();
      return;
    }
    step.value = 'cuadrante';
  } else if (step.value === 'cuadrante') {
    selected.value = {
      ...selected.value,
      quadrantId: item.id,
      quadrantName: item.name,
    };
    step.value = 'espacio';
  } else {
    emitParkSection({
      quadrantId: selected.value.quadrantId ?? null,
      quadrantName: selected.value.quadrantName ?? '',
      spaceId: item.id,
      spaceName: item.name,
      spaceCode: item.code ?? null,
    });
    return;
  }

  q.value = '';
  results.value = [];
  error.value = null;
  void fetchResults();
}

watch(
  () => props.open,
  (open) => {
    if (open) {
      resetModal();
      void fetchResults();
    }
  },
);
</script>

<template>
  <VdModal
    :open="open"
    :title="stopAt === 'seccion' ? 'Buscar parque y sección' : 'Buscar ubicación'"
    wide
    @close="emit('close')"
  >
    <div class="loc-search">
      <div class="loc-search__head">
        <button
          v-if="stepIndex > 0"
          type="button"
          class="btn btn-sm btn-ghost"
          @click="goBack"
        >
          ← Atrás
        </button>
        <p class="loc-search__step">
          Paso {{ stepIndex + 1 }} de {{ totalSteps }} ·
          <strong>{{ stepTitle }}</strong>
        </p>
        <p v-if="breadcrumb" class="loc-search__crumb">{{ breadcrumb }}</p>
      </div>

      <label>
        Buscar {{ stepTitle.toLowerCase() }}
        <input
          v-model="q"
          type="search"
          autocomplete="off"
          placeholder="Escribe para filtrar…"
          @input="onInput"
        />
      </label>

      <p v-if="loading" class="muted">Buscando…</p>
      <p v-else-if="error" class="err">{{ error }}</p>

      <ul v-if="results.length" class="loc-list">
        <li v-for="item in results" :key="item.id">
          <button type="button" class="loc-item" @click="pick(item)">
            <strong>{{ item.name }}</strong>
            <small v-if="item.code">Código: {{ item.code }}</small>
            <small v-else-if="item.status">Estatus: {{ item.status }}</small>
          </button>
        </li>
      </ul>
    </div>
  </VdModal>
</template>

<style scoped>
.loc-search {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.loc-search__head {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.loc-search__step {
  margin: 0;
  font-size: 0.88rem;
  color: var(--vd-muted);
}

.loc-search__crumb {
  margin: 0;
  font-size: 0.82rem;
  color: var(--gsm-blue);
  font-weight: 600;
}

.loc-search label {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--gsm-blue);
}

.loc-search input {
  min-height: 46px;
  border: 1px solid var(--vd-line);
  border-radius: 10px;
  padding: 0.55rem 0.7rem;
  font: inherit;
  font-size: 16px;
}

.muted {
  margin: 0;
  color: var(--vd-muted);
}

.err {
  margin: 0;
  color: #b42318;
  font-weight: 600;
}

.loc-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  max-height: 360px;
  overflow: auto;
}

.loc-item {
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.15rem;
  text-align: left;
  border: 1px solid var(--vd-line);
  background: #fff;
  border-radius: 10px;
  padding: 0.7rem 0.8rem;
  cursor: pointer;
  color: inherit;
}

.loc-item:hover {
  border-color: var(--gsm-blue);
  background: #f4f8fa;
}

.loc-item strong {
  font-size: 0.9rem;
}

.loc-item small {
  color: var(--vd-muted);
  font-size: 0.75rem;
}
</style>
