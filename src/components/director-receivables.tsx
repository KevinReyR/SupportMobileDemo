import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { loadAllReceivables, loadReceivablesPage, loadReceivablesSummary, loadStatementCoverage,
  type ReceivableItem, type ReceivablesSummary, type StatementCoverage } from '../services/receivables';

const navy = '#092653';
const red = '#C83C4D';
const muted = '#66758D';
const border = '#DFE6EF';
const money = (n: number) => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(n);
const date = (s: string) => s ? `${s.slice(8,10)}/${s.slice(5,7)}/${s.slice(0,4)}` : '';

function Metric({ label, value, warning = false }: { label: string; value: string; warning?: boolean }) {
  return <View style={styles.metric}><Text style={styles.label}>{label}</Text><Text style={[styles.value, warning && { color: red }]}>{value}</Text></View>;
}

export function ReceivablesSnapshot({ clientId, areaId, compact = false }: {
  clientId: number | null; areaId: number | null; compact?: boolean;
}) {
  const [summary, setSummary] = useState<ReceivablesSummary | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    setError('');
    loadReceivablesSummary(clientId, areaId).then((value) => { if (alive) setSummary(value); })
      .catch((cause) => { if (alive) setError(cause instanceof Error ? cause.message : 'No se pudo cargar la cartera.'); });
    return () => { alive = false; };
  }, [clientId, areaId]);
  return <View style={styles.card}>
    <Text style={styles.title}>Cartera al {date(summary?.as_of ?? '')}</Text>
    <Text style={styles.note}>Saldo actual de actas enviadas sin pago. No depende del rango de fechas del informe.</Text>
    {error ? <Text style={styles.error}>{error}</Text> : !summary ? <ActivityIndicator color={navy} /> :
      <View style={styles.metrics}>
        <Metric label="Cartera total" value={money(summary.portfolio_total)} />
        <Metric label="Por vencer" value={money(summary.due_soon)} />
        <Metric label="Vencida" value={money(summary.overdue)} warning />
        {!compact && <Metric label="Índice de morosidad" value={`${summary.delinquency_percent}%`} warning={summary.overdue > 0} />}
      </View>}
  </View>;
}

async function exportWorkbook(summary: ReceivablesSummary, items: ReceivableItem[]) {
  const ExcelJS = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Cartera');
  sheet.addRow([`Cartera al ${date(summary.as_of)}`]);
  sheet.addRow(['Total', summary.portfolio_total, 'Por vencer', summary.due_soon, 'Vencida', summary.overdue]);
  sheet.addRow(['Índice de morosidad', summary.delinquency_percent]);
  sheet.addRow([]);
  sheet.addRow(['Acta', 'Cliente', 'Área', 'Factura', 'Envío', 'Vencimiento', 'Días en mora', 'Estado', 'Saldo']);
  items.forEach((item) => sheet.addRow([item.number, item.client_name, item.area_name, item.invoice_number ?? '',
    item.sent_date, item.due_date, item.days_overdue, item.status === 'EN_MORA' ? 'En mora' : 'Por vencer', item.total]));
  sheet.columns = [{width:12},{width:28},{width:24},{width:20},{width:16},{width:16},{width:15},{width:15},{width:20}];
  sheet.getColumn(9).numFmt = '"$"#,##0.00';
  sheet.getRow(5).font = { bold: true };
  const buffer = await workbook.xlsx.writeBuffer();
  const url = URL.createObjectURL(new Blob([buffer], {type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = `opera360-cartera-${summary.as_of}.xlsx`; anchor.click();
  URL.revokeObjectURL(url);
}

export function DirectorReceivablesPanel({ clientId, areaId, compact = false }: {
  clientId: number | null; areaId: number | null; compact?: boolean;
}) {
  const [summary, setSummary] = useState<ReceivablesSummary | null>(null);
  const [items, setItems] = useState<ReceivableItem[]>([]);
  const [status, setStatus] = useState<'ENVIADA' | 'EN_MORA' | null>(null);
  const [cursor, setCursor] = useState<number | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const requestId = useRef(0);
  const refresh = useCallback(async () => {
    const currentRequest = ++requestId.current;
    setBusy(true); setError('');
    setSummary(null); setItems([]);
    try {
      const [nextSummary, page] = await Promise.all([
        loadReceivablesSummary(clientId, areaId), loadReceivablesPage(clientId, areaId, status, null, 30),
      ]);
      if (requestId.current === currentRequest) {
        setSummary(nextSummary); setItems(page.items); setCursor(page.next_cursor); setHasMore(page.has_more);
      }
    } catch (cause) { if (requestId.current === currentRequest) setError(cause instanceof Error ? cause.message : 'No se pudo cargar la cartera.'); }
    finally { if (requestId.current === currentRequest) setBusy(false); }
  }, [clientId, areaId, status]);
  useEffect(() => { void refresh(); }, [refresh]);
  const more = async () => {
    if (busy || !hasMore || cursor === null) return;
    const currentRequest = requestId.current;
    setBusy(true);
    try {
      const page = await loadReceivablesPage(clientId, areaId, status, cursor, 30);
      if (requestId.current === currentRequest) {
        setItems((previous) => [...previous, ...page.items]); setCursor(page.next_cursor); setHasMore(page.has_more);
      }
    } catch (cause) { if (requestId.current === currentRequest) setError(cause instanceof Error ? cause.message : 'No se pudo cargar más actas.'); }
    finally { if (requestId.current === currentRequest) setBusy(false); }
  };
  const exportAll = async () => {
    if (!summary) return;
    setBusy(true); setError('');
    try { await exportWorkbook(summary, await loadAllReceivables(clientId, areaId, status)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo generar el Excel.'); }
    finally { setBusy(false); }
  };
  const printAll = async () => {
    setBusy(true); setError('');
    try {
      setItems(await loadAllReceivables(clientId, areaId, status)); setHasMore(false);
      setTimeout(() => window.print(), 100);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo preparar el PDF.'); }
    finally { setBusy(false); }
  };
  return <View style={styles.stack}>
    <View style={styles.card}>
      <Text style={styles.title}>Cartera al {date(summary?.as_of ?? '')}</Text>
      <Text style={styles.note}>Actas enviadas pendientes de pago. Saldo bruto con IVA. El rango de fechas y el filtro de contratista no modifican esta cartera.</Text>
      <Pressable onPress={() => void refresh()} disabled={busy} style={styles.chip}><Text style={styles.chipText}>Recargar cartera</Text></Pressable>
      {summary && <>
        <View style={styles.metrics}>
          <Metric label="Cartera total" value={money(summary.portfolio_total)} />
          <Metric label="Por vencer" value={money(summary.due_soon)} />
          <Metric label="Vencida" value={money(summary.overdue)} warning />
          <Metric label="Morosidad" value={`${summary.delinquency_percent}%`} warning={summary.overdue>0} />
        </View>
        <Text style={styles.note}>{summary.open_count} actas abiertas · {summary.overdue_count} en mora</Text>
      </>}
    </View>
    {summary && <View style={styles.card}>
      <Text style={styles.title}>Antigüedad de cartera vencida</Text>
      {([['1–30 días',summary.age_1_30],['31–60 días',summary.age_31_60],['61–90 días',summary.age_61_90],['Más de 90 días',summary.age_over_90]] as const).map(([label,value]) =>
        <View key={label} style={styles.agingRow}><Text style={styles.agingLabel}>{label}</Text><View style={styles.track}>
          <View style={[styles.fill,{width:`${summary.overdue ? value*100/summary.overdue : 0}%` as `${number}%`}]} /></View><Text style={styles.agingValue}>{money(value)}</Text></View>)}
    </View>}
    {summary && summary.top_clients.length>0 && <View style={styles.card}>
      <Text style={styles.title}>Clientes con mayor mora</Text>
      {summary.top_clients.slice(0,compact?5:10).map((item) => <View key={item.client_id} style={styles.row}>
        <Text style={styles.rowName}>{item.client_name}</Text><Text style={styles.rowValue}>{money(item.overdue_total)}</Text></View>)}
    </View>}
    <View style={styles.card}>
      <Text style={styles.title}>Actas por cobrar</Text>
      <View style={styles.actions}>
        {([['Todas',null],['Por vencer','ENVIADA'],['En mora','EN_MORA']] as const).map(([label,value]) =>
          <Pressable key={label} onPress={() => setStatus(value)} style={[styles.chip,status===value && styles.chipActive]}>
            <Text style={[styles.chipText,status===value && styles.chipTextActive]}>{label}</Text></Pressable>)}
        {!compact && <><Pressable onPress={() => void exportAll()} disabled={busy} style={styles.chip}><Text style={styles.chipText}>Excel completo</Text></Pressable>
          <Pressable onPress={() => void printAll()} disabled={busy} style={styles.chip}><Text style={styles.chipText}>PDF completo</Text></Pressable></>}
      </View>
      {items.length===0 && !busy && <Text style={styles.note}>No hay actas por cobrar con estos filtros.</Text>}
      {items.slice(0,compact?5:undefined).map((item) => <View key={item.id} style={styles.statementRow}>
        <View style={{flex:1}}><Text style={styles.rowName}>Acta #{item.number} · {item.client_name}</Text>
          <Text style={styles.note}>{item.area_name} · Vence {date(item.due_date)}{item.invoice_number ? ` · Factura ${item.invoice_number}` : ''}</Text></View>
        <View><Text style={styles.rowValue}>{money(item.total)}</Text>
          <Text style={[styles.badge,item.days_overdue>0 && {color:red}]}>{item.days_overdue>0 ? `${item.days_overdue} días en mora` : 'Por vencer'}</Text></View>
      </View>)}
      {hasMore && !compact && <Pressable onPress={() => void more()} disabled={busy} style={styles.chip}><Text style={styles.chipText}>Cargar más actas</Text></Pressable>}
      {compact && items.length>5 && <Text style={styles.note}>Mostrando 5 actas. Consulta el detalle completo en Actas y pagos.</Text>}
      {busy && <ActivityIndicator color={navy} />}
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  </View>;
}

export function DirectorStatementCoverage({ startDate, endDate, clientId, areaId, operationType, compact = false }: {
  startDate: string; endDate: string; clientId: number | null; areaId: number | null;
  operationType: string | null; compact?: boolean;
}) {
  const [result, setResult] = useState<StatementCoverage | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    setResult(null); setError('');
    if (startDate>endDate) {
      setError('La fecha inicial no puede ser posterior a la fecha final.');
      return () => { alive=false; };
    }
    loadStatementCoverage(startDate,endDate,clientId,areaId,operationType)
      .then((value) => { if (alive) setResult(value); })
      .catch((cause) => { if (alive) setError(cause instanceof Error ? cause.message : 'No se pudo cargar la cobertura.'); });
    return () => { alive=false; };
  }, [startDate,endDate,clientId,areaId,operationType]);
  const more = async () => {
    if (!result?.has_more || result.next_cursor===null || busy) return;
    setBusy(true);
    try {
      const page = await loadStatementCoverage(startDate,endDate,clientId,areaId,operationType,result.next_cursor);
      setResult({...page,items:[...result.items,...page.items]});
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo cargar más operaciones.'); }
    finally { setBusy(false); }
  };
  return <View style={styles.card}>
    <Text style={styles.title}>Operaciones cerradas y actas</Text>
    <Text style={styles.note}>Cobertura de facturación del {date(startDate)} al {date(endDate)}. Las actas generadas, enviadas o pagadas cuentan; las anuladas no. El filtro de contratista no aplica.</Text>
    {result ? <>
      <View style={styles.metrics}>
        <Metric label="Cerradas" value={String(result.total_closed)} />
        <Metric label="Con acta" value={String(result.assigned)} />
        <Metric label="Sin acta" value={String(result.unassigned)} warning={result.unassigned>0} />
        <Metric label="Sin venta registrada" value={String(result.missing_sales)} warning={result.missing_sales>0} />
        {!compact && <Metric label="Cobertura de actas" value={result.coverage_percent===null ? 'Sin operaciones' : `${result.coverage_percent}%`} />}
      </View>
      {result.items.slice(0,compact?5:undefined).map((item) => <View key={item.id} style={styles.row}>
        <Text style={styles.rowName}>#{item.id} · {date(item.operation_date)} · {item.client_name} · {item.area_name}</Text>
        <Text style={[styles.rowValue,item.missing_sales && {color:red}]}>{item.missing_sales ? 'Sin venta' : 'Sin acta'}</Text>
      </View>)}
      {result.has_more && !compact && <Pressable onPress={() => void more()} disabled={busy} style={styles.chip}><Text style={styles.chipText}>Cargar más operaciones</Text></Pressable>}
    </> : error ? null : <ActivityIndicator color={navy} />}
    {error ? <Text style={styles.error}>{error}</Text> : null}
  </View>;
}

const styles = StyleSheet.create({
  stack:{gap:16}, card:{backgroundColor:'#FFF',borderWidth:1,borderColor:border,borderRadius:16,padding:18,marginBottom:14},
  title:{color:navy,fontSize:17,fontWeight:'800',marginBottom:7}, note:{color:muted,fontSize:12,lineHeight:18},
  metrics:{flexDirection:'row',flexWrap:'wrap',gap:10,marginTop:14,marginBottom:10},
  metric:{minWidth:140,flexGrow:1,backgroundColor:'#F5F8FC',borderRadius:10,padding:12},
  label:{color:muted,fontSize:12},value:{color:navy,fontSize:20,fontWeight:'800',marginTop:4},
  agingRow:{flexDirection:'row',alignItems:'center',gap:10,marginTop:12},agingLabel:{width:100,color:navy,fontSize:12},
  agingValue:{minWidth:100,textAlign:'right',color:navy,fontSize:12,fontWeight:'700'},
  track:{height:10,flex:1,backgroundColor:'#E9EEF5',borderRadius:5,overflow:'hidden'},fill:{height:10,backgroundColor:red},
  row:{flexDirection:'row',justifyContent:'space-between',gap:12,paddingVertical:9,borderBottomWidth:1,borderBottomColor:border},
  rowName:{color:navy,fontWeight:'600',fontSize:13,flex:1},rowValue:{color:navy,fontWeight:'800',fontSize:13},
  actions:{flexDirection:'row',flexWrap:'wrap',gap:8,marginVertical:12},
  chip:{borderWidth:1,borderColor:border,borderRadius:8,paddingHorizontal:12,paddingVertical:8,alignSelf:'flex-start'},
  chipActive:{backgroundColor:navy,borderColor:navy},chipText:{color:navy,fontSize:12,fontWeight:'700'},chipTextActive:{color:'#FFF'},
  statementRow:{flexDirection:'row',gap:14,paddingVertical:12,borderBottomWidth:1,borderBottomColor:border},
  badge:{color:muted,fontSize:11,textAlign:'right',fontWeight:'700'},error:{color:red,fontSize:12,marginTop:10},
});
