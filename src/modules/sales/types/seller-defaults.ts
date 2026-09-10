export type SaleBranch = {
  id: number;
  name: string;
  attention?: string | null;
};

/** Id en catálogo. Nombre/precio se cachean en sesión para no pedirlos otra vez. */
export type SellerDefaultPlan = {
  id: number;
  name?: string;
  listPrice?: number;
  defaultCode?: string | null;
  withoutInterest?: boolean;
};

export type SellerDefaults = {
  defaultBranchId: number | null;
  defaultBranchName: string | null;
  defaultFuturePlans: SellerDefaultPlan[];
  defaultParkPlans: SellerDefaultPlan[];
};

export const emptySellerDefaults = (): SellerDefaults => ({
  defaultBranchId: null,
  defaultBranchName: null,
  defaultFuturePlans: [],
  defaultParkPlans: [],
});
