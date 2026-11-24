import { supabase } from '../lib/supabase';

export interface ReceivablesSummary {
  as_of: string;
  portfolio_total: number;
  due_soon: number;
  overdue: number;
  open_count: number;
  overdue_count: number;
  delinquency_percent: number;
  age_1_30: number;
  age_31_60: number;
  age_61_90: number;
  age_over_90: number;
  top_clients: { client_id: number; client_name: string; overdue_total: number; overdue_count: number }[];
}
export interface ReceivableItem {
  id: number;
  client_id: number;
  client_name: string;
  area_name: string;
  number: number;
  total: number;
  sent_date: string;
  due_date: string;
  credit_days: number;
  days_overdue: number;
  status: 'ENVIADA' | 'EN_MORA';
  invoice_number: string | null;
}
export interface CoverageItem {
  id: number;
  operation_date: string;
  client_id: number;
  client_name: string;
  area_name: string;
  operation_type: string;
  assigned: boolean;
  missing_sales: boolean;
}
export interface StatementCoverage {
  total_closed: number;
  assigned: number;
  unassigned: number;
  missing_sales: number;
  coverage_percent: number | null;
  items: CoverageItem[];
  has_more: boolean;
  next_cursor: number | null;
}
export interface ReceivablesPage {
  items: ReceivableItem[];
  has_more: boolean;
  next_cursor: number | null;
}

async function call<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw new Error(error.message);
  return data as T;
}
export const loadReceivablesSummary = (clientId: number | null, areaId: number | null) =>
  call<ReceivablesSummary>('get_director_receivables_summary', { p_client_id: clientId, p_area_id: areaId });
export const loadReceivablesPage = (clientId: number | null, areaId: number | null,
  status: 'ENVIADA' | 'EN_MORA' | null, beforeId: number | null, limit = 30) =>
  call<ReceivablesPage>('list_director_receivables', { p_client_id: clientId, p_area_id: areaId,
    p_status: status, p_before_id: beforeId, p_limit: limit });
export const loadStatementCoverage = (startDate: string, endDate: string, clientId: number | null,
  areaId: number | null, operationType: string | null, beforeId: number | null = null, limit = 30) =>
  call<StatementCoverage>('get_director_statement_coverage', { p_start_date: startDate, p_end_date: endDate,
    p_client_id: clientId, p_area_id: areaId, p_operation_type: operationType,
    p_before_id: beforeId, p_limit: limit });

export async function loadAllReceivables(clientId: number | null, areaId: number | null,
  status: 'ENVIADA' | 'EN_MORA' | null): Promise<ReceivableItem[]> {
  const items: ReceivableItem[] = [];
  let beforeId: number | null = null;
  do {
    const page = await loadReceivablesPage(clientId, areaId, status, beforeId, 200);
    items.push(...page.items);
    if (!page.has_more || page.next_cursor === null) return items;
    beforeId = page.next_cursor;
  } while (true);
}
