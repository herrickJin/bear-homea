import { apiRequest } from "./api";
import type { PurchaseRecord } from "../data/mockRecords";
import type { PreparationItem } from "../data/preparation";
export type PreparationState = { records: PurchaseRecord[]; items: PreparationItem[]; skipped: string[]; associations: Record<string, string[]>; appliedImports?: string[] };
export type PreparationResponse = { revision: number; data: PreparationState | null; updatedAt: string | null };
export const fetchPreparation = () => apiRequest<PreparationResponse>("/api/preparation");
export const savePreparation = (revision: number, data: PreparationState) => apiRequest<PreparationResponse>("/api/preparation", { method: "PUT", body: { revision, data } });
