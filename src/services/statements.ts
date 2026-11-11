import { supabase } from '../lib/supabase';

export type StatementStatus = 'GENERADA' | 'ENVIADA' | 'PAGADA' | 'ANULADA';
export interface StatementHeader { issuer_name: string; issuer_nit: string; client_name: string; city: string; service_name: string }
export interface StatementLine {
  operation_id: number; date: string; kind: 'TURNO' | 'DESCARGUE'; unit: string; auxiliaries: number;
  quantity: number; unit_price: number; extra_hours: number; extra_price: number; total: number; observations: string;
}
export interface StatementPreview {
  header: StatementHeader; lines: StatementLine[]; subtotal: number; vat: number; total: number; preview_hash: string;
  excluded: { operation_id: number; date: string; statement_id: number; number: number }[];
}
export interface Statement extends Omit<StatementPreview, 'preview_hash' | 'excluded'> {
  id: number; client_id: number; area_id: number; number: number; start_date: string; end_date: string;
  status: StatementStatus; sent_date: string | null; paid_date: string | null; invoice_number: string | null;
  cancellation_reason: string | null; updated_at: string; days_since_sent: number | null;
  audit: { action: string; at: string; actor: string; before: unknown; after: unknown }[];
}
export interface StatementSettings {
  issuer: { legal_name: string; nit: string; manager_name: string | null; signature_path: string | null } | null;
  clients: { id: number; name: string; city: string | null; next_number: number }[];
  areas: { id: number; name: string; client_id: number }[];
}
export interface StatementRange { clientId: number; areaId: number; startDate: string; endDate: string }
async function rpc<T>(name: string, args = {}): Promise<T> {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw new Error(error.message);
  return data as T;
}
export const loadStatementSettings = () => rpc<StatementSettings>('statement_settings');
export const saveStatementSettings = (legalName: string, nit: string, managerName: string, signaturePath: string | null, clientId: number | null, city: string, nextNumber: number) =>
  rpc<void>('save_statement_settings_v2', { p_legal_name: legalName, p_nit: nit, p_manager_name: managerName, p_signature_path: signaturePath,
    p_client_id: clientId, p_city: city, p_next_number: nextNumber });
export async function uploadStatementSignature(uri: string): Promise<string> {
  const content = await (await fetch(uri)).arrayBuffer();
  const bytes = new Uint8Array(content);
  if (!bytes.length || bytes.length > 524288) throw new Error('La firma debe pesar máximo 512 KB.');
  const png = bytes.length >= 8 && [137,80,78,71,13,10,26,10].every((value,index)=>bytes[index]===value);
  const jpg = bytes.length >= 3 && bytes[0]===255 && bytes[1]===216 && bytes[2]===255;
  if (!png && !jpg) throw new Error('Adjunta una firma en PNG o JPG.');
  const path = `manager/${Date.now()}-${Math.random().toString(36).slice(2)}.${png?'png':'jpg'}`;
  const { error } = await supabase.storage.from('statement-signatures').upload(path, content, { contentType: png?'image/png':'image/jpeg', upsert: false });
  if (error) throw new Error(error.message);
  return path;
}
export async function statementSignatureUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from('statement-signatures').createSignedUrl(path, 300);
  if (error || !data?.signedUrl) throw new Error(error?.message || 'No fue posible abrir la firma del gerente.');
  return data.signedUrl;
}
const rangeArgs = (r: StatementRange) => ({ p_client_id: r.clientId, p_area_id: r.areaId, p_start_date: r.startDate, p_end_date: r.endDate });
export const previewStatement = (r: StatementRange, id: number | null) => rpc<StatementPreview>('preview_statement', { ...rangeArgs(r), p_statement_id: id });
export const saveStatement = (r: StatementRange, hash: string, key: string, previous: Statement | null) => rpc<Statement>('save_statement', {
  ...rangeArgs(r), p_preview_hash: hash, p_request_key: key, p_id: previous?.id ?? null, p_version: previous?.updated_at ?? null,
});
export const getStatement = (id: number) => rpc<Statement>('get_statement', { p_id: id });
export const transitionStatement = (s: Statement, action: string, date: string, invoice: string, reason: string) => rpc<Statement>('transition_statement', {
  p_id: s.id, p_version: s.updated_at, p_action: action, p_date: date || null, p_invoice: invoice || null, p_reason: reason || null,
});
export const listStatements = (r: StatementRange, status: string, beforeId: number | null) => rpc<Statement[]>('list_statements', {
  p_client_id: r.clientId || null, p_area_id: r.areaId || null, p_start_date: r.startDate || null, p_end_date: r.endDate || null,
  p_status: status || null, p_before_id: beforeId,
});
