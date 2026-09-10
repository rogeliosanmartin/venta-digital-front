import { http } from '../../../shared/api/http';
import {
  emptySellerDefaults,
  type SaleBranch,
  type SellerDefaults,
} from '../types/seller-defaults';
import {
  defaultsNeedPlanNames,
  hydrateSellerDefaultPlans,
} from './odoo-plans';

const KEY = 'vd.sellerPrefetch';

export type SellerPrefetch = {
  userId: number;
  defaults: SellerDefaults;
  branches: SaleBranch[];
  serviceTypes: SaleBranch[];
  convenioCompanies: SaleBranch[];
  parentescos: SaleBranch[];
};

function asList(value: unknown): SaleBranch[] {
  return Array.isArray(value) ? value : [];
}

function rawHasConvenio(parsed: unknown): boolean {
  return Boolean(
    parsed &&
      typeof parsed === 'object' &&
      Array.isArray((parsed as { convenioCompanies?: unknown }).convenioCompanies),
  );
}

function rawHasParentescos(parsed: unknown): boolean {
  return Boolean(
    parsed &&
      typeof parsed === 'object' &&
      Array.isArray((parsed as { parentescos?: unknown }).parentescos) &&
      ((parsed as { parentescos: unknown[] }).parentescos.length > 0),
  );
}

function cacheIsReady(parsed: unknown, cached: SellerPrefetch | null): boolean {
  return Boolean(
    cached &&
      rawHasConvenio(parsed) &&
      rawHasParentescos(parsed) &&
      !defaultsNeedPlanNames(cached.defaults),
  );
}

export function readSellerPrefetch(userId?: number | null): SellerPrefetch | null {
  const raw = sessionStorage.getItem(KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as SellerPrefetch;
    if (!parsed?.userId || !parsed.defaults) return null;
    if (userId && parsed.userId !== userId) return null;
    return {
      userId: parsed.userId,
      defaults: { ...emptySellerDefaults(), ...parsed.defaults },
      branches: asList(parsed.branches),
      serviceTypes: asList(parsed.serviceTypes),
      convenioCompanies: asList(parsed.convenioCompanies),
      parentescos: asList(parsed.parentescos),
    };
  } catch {
    return null;
  }
}

export function writeSellerPrefetch(data: SellerPrefetch) {
  sessionStorage.setItem(KEY, JSON.stringify(data));
}

export function patchSellerPrefetch(partial: Partial<SellerPrefetch>) {
  const current = readSellerPrefetch(partial.userId);
  if (!current) return;
  writeSellerPrefetch({
    userId: current.userId,
    defaults: partial.defaults ?? current.defaults,
    branches: partial.branches ?? current.branches,
    serviceTypes: partial.serviceTypes ?? current.serviceTypes,
    convenioCompanies: partial.convenioCompanies ?? current.convenioCompanies,
    parentescos: partial.parentescos ?? current.parentescos,
  });
}

export function clearSellerPrefetch() {
  sessionStorage.removeItem(KEY);
}

let inflight: Promise<SellerPrefetch> | null = null;

async function fetchConvenioCompanies(): Promise<SaleBranch[]> {
  const { data } = await http.get<SaleBranch[]>('/odoo/empresas-convenio', {
    skipGlobalLoading: true,
  });
  return asList(data);
}

async function fetchParentescos(): Promise<SaleBranch[]> {
  const { data } = await http.get<SaleBranch[]>('/odoo/parentescos', {
    skipGlobalLoading: true,
  });
  return asList(data);
}

export async function prefetchSellerSession(
  userId: number,
): Promise<SellerPrefetch> {
  const raw = sessionStorage.getItem(KEY);
  let parsed: unknown = null;
  try {
    parsed = raw ? JSON.parse(raw) : null;
  } catch {
    parsed = null;
  }
  const cached = readSellerPrefetch(userId);
  if (cacheIsReady(parsed, cached)) return cached as SellerPrefetch;
  if (inflight) return inflight;

  inflight = (async () => {
    if (cached) {
      let next = { ...cached };
      if (!rawHasConvenio(parsed)) {
        try {
          next = { ...next, convenioCompanies: await fetchConvenioCompanies() };
        } catch {
          next = { ...next, convenioCompanies: [] };
        }
      }
      if (!rawHasParentescos(parsed)) {
        try {
          next = { ...next, parentescos: await fetchParentescos() };
        } catch {
          next = { ...next, parentescos: [] };
        }
      }
      if (defaultsNeedPlanNames(next.defaults)) {
        next = {
          ...next,
          defaults: await hydrateSellerDefaultPlans(next.defaults),
        };
      }
      writeSellerPrefetch(next);
      return next;
    }

    const [
      { data: branchData },
      { data: typeData },
      { data: defaults },
      convenioCompanies,
      parentescos,
    ] = await Promise.all([
      http.get<SaleBranch[]>('/odoo/sucursales', { skipGlobalLoading: true }),
      http.get<SaleBranch[]>('/odoo/tipos-servicio', {
        skipGlobalLoading: true,
      }),
      http.get<SellerDefaults>('/users/me/defaults', {
        skipGlobalLoading: true,
      }),
      fetchConvenioCompanies().catch(() => [] as SaleBranch[]),
      fetchParentescos().catch(() => [] as SaleBranch[]),
    ]);
    const payload: SellerPrefetch = {
      userId,
      defaults: await hydrateSellerDefaultPlans({
        ...emptySellerDefaults(),
        ...defaults,
      }),
      branches: asList(branchData),
      serviceTypes: asList(typeData),
      convenioCompanies,
      parentescos,
    };
    writeSellerPrefetch(payload);
    return payload;
  })().finally(() => {
    inflight = null;
  });
  return inflight;
}

export function ensureSellerPrefetch(userId?: number | null) {
  if (!userId) return;
  const raw = sessionStorage.getItem(KEY);
  try {
    const parsed = raw ? JSON.parse(raw) : null;
    if (cacheIsReady(parsed, readSellerPrefetch(userId))) return;
  } catch {
    /* prefetch de nuevo */
  }
  void prefetchSellerSession(userId).catch(() => undefined);
}
