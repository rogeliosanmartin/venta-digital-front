import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { extractApiError, http, tokenStorage } from '../../../shared/api/http';
import {
  clearSellerPrefetch,
  prefetchSellerSession,
} from '../../sales/utils/seller-session-cache';
import type {
  AuthTokensResponse,
  SessionUser,
  UserType,
} from '../../../shared/types/auth';

function readStoredUser(): SessionUser | null {
  const raw = localStorage.getItem('vd_user');
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SessionUser;
  } catch {
    return null;
  }
}

export const useAuthStore = defineStore('auth', () => {
  const user = ref<SessionUser | null>(readStoredUser());
  const expiresAt = ref<string | null>(localStorage.getItem('vd_expires_at'));
  const loading = ref(false);
  const error = ref<string | null>(null);

  const isAuthenticated = computed(() => Boolean(tokenStorage.getAccess() && user.value));
  const userType = computed<UserType | null>(() => user.value?.type ?? null);
  const permissions = computed(() => user.value?.permissions ?? []);

  function persistSession(data: AuthTokensResponse) {
    tokenStorage.setTokens(data.accessToken, data.refreshToken ?? null);
    localStorage.setItem('vd_user', JSON.stringify(data.user));
    localStorage.setItem('vd_expires_at', data.expiresAt);
    user.value = data.user;
    expiresAt.value = data.expiresAt;
  }

  async function loginSellerDev(cellphone: string) {
    loading.value = true;
    error.value = null;
    try {
      const { data } = await http.post<AuthTokensResponse>(
        '/auth/vendedor/login-dev',
        { cellphone },
      );
      persistSession(data);
      if (data.user.type === 'VENDEDOR') {
        void prefetchSellerSession(data.user.id).catch(() => undefined);
      }
      return data;
    } catch (e: unknown) {
      error.value = extractApiError(e, 'No se pudo iniciar sesión');
      throw e;
    } finally {
      loading.value = false;
    }
  }

  async function requestSellerPin(cellphone: string) {
    loading.value = true;
    error.value = null;
    try {
      const { data } = await http.post('/auth/vendedor/solicitar-pin', {
        cellphone,
      });
      return data as { nipId: number | null; message: string };
    } catch (e: unknown) {
      error.value = extractApiError(e, 'No se pudo solicitar el PIN');
      throw e;
    } finally {
      loading.value = false;
    }
  }

  async function verifySellerPin(payload: {
    nipId: number;
    nip: string;
    cellphone: string;
  }) {
    loading.value = true;
    error.value = null;
    try {
      const { data } = await http.post<AuthTokensResponse>(
        '/auth/vendedor/verificar-pin',
        payload,
      );
      persistSession(data);
      if (data.user.type === 'VENDEDOR') {
        void prefetchSellerSession(data.user.id).catch(() => undefined);
      }
      return data;
    } catch (e: unknown) {
      error.value = extractApiError(e, 'PIN inválido');
      throw e;
    } finally {
      loading.value = false;
    }
  }

  async function loginMonitor(username: string, password: string) {
    loading.value = true;
    error.value = null;
    try {
      const { data } = await http.post<AuthTokensResponse>(
        '/auth/monitor/login',
        { username, password },
      );
      persistSession(data);
      return data;
    } catch (e: unknown) {
      error.value = extractApiError(e, 'Credenciales inválidas');
      throw e;
    } finally {
      loading.value = false;
    }
  }

  /** Limpia sesión local sin llamar al API (token vencido / refresh fallido). */
  function clearSession() {
    tokenStorage.clear();
    clearSellerPrefetch();
    user.value = null;
    expiresAt.value = null;
    error.value = null;
  }

  async function logout() {
    const refreshToken = tokenStorage.getRefresh();
    try {
      await http.post('/auth/logout', { refreshToken });
    } catch {
      // ignore network errors on logout
    }
    clearSession();
  }

  function hasPermission(code: string) {
    if (user.value?.type === 'ADMIN') return true;
    return permissions.value.includes(code);
  }

  /** Actualiza el usuario en sesión (p. ej. jefe de ventas del catálogo). */
  async function refreshMe() {
    if (!tokenStorage.getAccess()) return null;
    try {
      const { data } = await http.get<SessionUser>('/auth/me');
      if (!data?.id) return user.value;
      user.value = { ...(user.value ?? data), ...data };
      localStorage.setItem('vd_user', JSON.stringify(user.value));
      return user.value;
    } catch {
      return user.value;
    }
  }

  return {
    user,
    expiresAt,
    loading,
    error,
    isAuthenticated,
    userType,
    permissions,
    requestSellerPin,
    loginSellerDev,
    verifySellerPin,
    loginMonitor,
    logout,
    clearSession,
    hasPermission,
    refreshMe,
  };
});
