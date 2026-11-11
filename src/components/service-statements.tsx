import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { exportStatement, statementColumns, statementRows } from '../lib/statement-export';
import { getStatement, listStatements, loadStatementSettings, previewStatement, saveStatement, saveStatementSettings, transitionStatement, Statement, StatementPreview, StatementRange, StatementSettings } from '../services/statements';

type Calendar = React.ComponentType<{ visible: boolean; selectedDate: string | null; title: string; onClose: () => void; onSelect: (date: string) => void }>;
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota', year:'numeric',month:'2-digit',day:'2-digit' }).format(new Date());
const money = (n: number) => '$ ' + Number(n).toLocaleString('es-CO',{minimumFractionDigits:2,maximumFractionDigits:2});
const dateLabel = (date: string) => date ? date.split('-').reverse().join('/') : 'Todas';
const message = (e: unknown) => e instanceof Error ? e.message : 'No fue posible completar la accion';
function Button({ label, onPress, disabled=false }: {label:string;onPress:()=>void;disabled?:boolean}) {
  return <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} style={[s.button,disabled && {opacity:.45}]}><Text style={s.buttonText}>{label}</Text></Pressable>;
}
function Field({ label, value, onChangeText, numeric=false }: {label:string;value:string;onChangeText:(v:string)=>void;numeric?:boolean}) {
  return <View style={s.field}><Text style={s.label}>{label}</Text><TextInput accessibilityLabel={label} style={s.input} value={value} onChangeText={onChangeText} keyboardType={numeric?'number-pad':'default'} /></View>;
}
function Select({label,value,options,onChange,disabled=false,compact=false}: {label:string;value:string;options:{id:string;name:string}[];onChange:(v:string)=>void;disabled?:boolean;compact?:boolean}) {
  const [open,setOpen]=useState(false),[search,setSearch]=useState('');
  return <View style={[s.field,compact&&s.compactField]}><Text style={s.label}>{label}</Text><Pressable accessibilityRole="button" accessibilityLabel={`${label}: ${options.find(x=>x.id===value)?.name || 'Selecciona'}`} disabled={disabled} onPress={()=>{setSearch('');setOpen(true);}} style={[compact?s.filterControl:s.button,disabled&&{opacity:.45}]}><Text numberOfLines={1} style={compact?s.filterControlText:s.buttonText}>{options.find(x=>x.id===value)?.name || 'Selecciona'}{compact?'  ▾':''}</Text></Pressable>
    <Modal visible={open} transparent onRequestClose={()=>setOpen(false)}><View style={s.overlay}><View style={s.dialog}>
      <Text style={s.title}>{label}</Text><TextInput accessibilityLabel="Buscar opcion" placeholder="Buscar" value={search} onChangeText={setSearch} style={s.input}/>
      <ScrollView style={{maxHeight:360}}>{options.filter(x=>x.name.toLocaleLowerCase().includes(search.toLocaleLowerCase())).map(x=><Button key={x.id} label={x.name} onPress={()=>{onChange(x.id);setOpen(false);}} />)}</ScrollView>
      <Button label="Cerrar" onPress={()=>setOpen(false)}/></View></View></Modal></View>;
}
function DateField({label,value,onChange,Calendar,disabled=false,compact=false,emptyLabel='Todas'}: {label:string;value:string;onChange:(v:string)=>void;Calendar:Calendar;disabled?:boolean;compact?:boolean;emptyLabel?:string}) {
  const [open,setOpen]=useState(false);
  const displayValue=value?dateLabel(value):emptyLabel;
  return <View style={[s.field,compact&&s.compactField]}><Text style={s.label}>{label}</Text><Pressable accessibilityRole="button" accessibilityLabel={`${label}: ${displayValue}`} disabled={disabled} onPress={()=>setOpen(true)} style={[compact?s.filterControl:s.button,disabled&&{opacity:.45}]}><Text style={compact?s.filterControlText:s.buttonText}>{displayValue}{compact?'  ▾':''}</Text></Pressable><Calendar visible={open} selectedDate={value || null} title={label} onClose={()=>setOpen(false)} onSelect={v=>{onChange(v);setOpen(false);}}/></View>;
}
function Table({data}: {data: StatementPreview | Statement}) {
  const [expanded,setExpanded]=useState(false);
  const rows=statementRows(data as Statement);
  return <View style={s.card}><Text style={s.title}>PLANILLA DE SERVICIOS</Text>
    <Text>{data.header.issuer_name} · NIT {data.header.issuer_nit}</Text><Text>{data.header.client_name} · {data.header.city} · {data.header.service_name}</Text>
    <Text>Desliza la tabla horizontalmente para ver todos los valores.</Text>
    <ScrollView horizontal><View><View style={s.row}>{statementColumns.map((c,i)=><Text key={c} style={[s.cell,s.label,{width:i===10?240:120}]}>{c}</Text>)}</View>
      {(expanded?rows:rows.slice(0,30)).map((r,index)=><View key={index} style={s.row}>{r.map((v,i)=><Text key={i} style={[s.cell,{width:i===10?240:120}]}>{[6,8,9].includes(i)?money(Number(v)):String(v)}</Text>)}</View>)}</View></ScrollView>
    {rows.length>30 && <Button label={expanded?'Mostrar primeras 30 filas':`Ver las ${rows.length} filas`} onPress={()=>setExpanded(!expanded)}/>}
    <Text>Subtotal: {money(data.subtotal)}</Text><Text>IVA 19%: {money(data.vat)}</Text><Text style={s.title}>Total: {money(data.total)}</Text>
  </View>;
}
export function StatementAdminSettings() {
  const [settings,setSettings]=useState<StatementSettings|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const [name,setName]=useState(''),[nit,setNit]=useState(''),[client,setClient]=useState(''),[city,setCity]=useState(''),[next,setNext]=useState('1');
  const lock=useRef(false);
  async function load(){try{const v=await loadStatementSettings();setSettings(v);setName(v.issuer?.legal_name||'');setNit(v.issuer?.nit||'');setError('');return v;}catch(e){setError(message(e));}}
  useEffect(()=>{void load();},[]);
  return <View style={s.card}><Text style={s.title}>Configuracion de actas</Text><Text>Los cambios aplican a nuevas actas. No modifican documentos existentes.</Text>
    {error && <Text accessibilityRole="alert" style={s.error}>{error}</Text>}
    {!settings ? <Button label="Reintentar carga" onPress={()=>void load()}/> : <>
    <Field label="Razon social emisora" value={name} onChangeText={setName}/><Field label="NIT" value={nit} onChangeText={setNit}/>
    <Select label="Cliente (opcional para guardar solo emisor)" value={client} options={[{id:'',name:'Solo emisor'},...settings.clients.map(x=>({id:String(x.id),name:x.name}))]} onChange={v=>{setClient(v);const c=settings.clients.find(x=>String(x.id)===v);setCity(c?.city||'');setNext(String(c?.next_number||1));}}/>
    {client && <><Field label="Ciudad del cliente" value={city} onChangeText={setCity}/><Field label="Proximo consecutivo" value={next} onChangeText={setNext} numeric/></>}
    <Button label={busy?'Guardando...':'Guardar configuracion'} disabled={busy} onPress={()=>void(async()=>{
      if(lock.current)return;lock.current=true;setBusy(true);setError('');
      try{if(!name.trim()||!nit.trim()||(client&&(!city.trim()||!/^\d+$/.test(next)||Number(next)<1)))throw Error('Completa razon social, NIT, ciudad y consecutivo positivo');
        await saveStatementSettings(name,nit,client?Number(client):null,city,Number(next));const v=await load();setNext(String(v?.clients.find(x=>String(x.id)===client)?.next_number||1));
      }catch(e){setError(message(e));}finally{lock.current=false;setBusy(false);}
    })()}/></>}
  </View>;
}

export default function ServiceStatements({Calendar}: {Calendar:Calendar}) {
  const [settings,setSettings]=useState<StatementSettings|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const [mode,setMode]=useState<'list'|'edit'|'detail'>('list');
  const [createOpen,setCreateOpen]=useState(false),[search,setSearch]=useState('');
  const [manageOpen,setManageOpen]=useState(false);
  const [manageAction,setManageAction]=useState<'pay'|'cancel'>('pay'),[manageError,setManageError]=useState('');
  const [filtersOpen,setFiltersOpen]=useState(false);
  const [filter,setFilter]=useState<StatementRange>({clientId:0,areaId:0,startDate:'',endDate:''}),[status,setStatus]=useState('');
  const [range,setRange]=useState<StatementRange>({clientId:0,areaId:0,startDate:today().slice(0,8)+'01',endDate:today()});
  const [items,setItems]=useState<Statement[]>([]),[more,setMore]=useState(false),[selected,setSelected]=useState<Statement|null>(null),[preview,setPreview]=useState<StatementPreview|null>(null);
  const [invoice,setInvoice]=useState(''),[date,setDate]=useState(today()),[reason,setReason]=useState('');
  const [confirm,setConfirm]=useState<{text:string;run:()=>Promise<void>}|null>(null);
  const key=useRef(''),lock=useRef(false),loadVersion=useRef(0);
  async function run(task:()=>Promise<void>){if(lock.current)return;lock.current=true;setBusy(true);setError('');try{await task();}catch(e){setError(message(e));}finally{lock.current=false;setBusy(false);}}
  async function loadList(append=false){
    const version=++loadVersion.current;
    try{const rows=await listStatements(filter,status,append?items.at(-1)?.id??null:null);if(version!==loadVersion.current)return;
      if(search.trim()&&!append){
        const all=[...rows.slice(0,30)];let page=rows;
        while(page.length>30){
          page=await listStatements(filter,status,page[29].id);
          if(version!==loadVersion.current)return;
          all.push(...page.slice(0,30));
        }
        setItems(all);setMore(false);return;
      }
      setMore(rows.length>30);setItems(old=>append?[...old,...rows.slice(0,30)]:rows.slice(0,30));
    }catch(e){if(version===loadVersion.current)setError(message(e));}
  }
  useEffect(()=>{void loadStatementSettings().then(setSettings).catch(e=>setError(message(e)));},[]);
  useEffect(()=>{const timer=setTimeout(()=>{if(mode==='list'){setError('');void loadList();}},search.trim()?300:0);return()=>{clearTimeout(timer);loadVersion.current++;};},[filter,status,mode,search]);
  const newKey=()=>Date.now().toString(36)+'-'+Math.random().toString(36).slice(2);
  const visibleItems=items.filter(a=>{
    const query=search.trim().toLocaleLowerCase();
    return !query||a.header.client_name.toLocaleLowerCase().includes(query)||String(a.number).includes(query);
  });
  const open=(id:number)=>run(async()=>{const v=await getStatement(id);setSelected(v);setInvoice(v.invoice_number||'');setDate(v.status==='ENVIADA'?'':today());setReason('');setMode('detail');});
  const alter=(action:'ENVIAR'|'PAGAR'|'ANULAR')=>{
    if(action==='ANULAR'&&!reason.trim()){setManageError('Indica el motivo de la anulación.');return;}
    if(action==='PAGAR'&&!invoice.trim()){setManageError('Indica el número de factura.');return;}
    if(action!=='ANULAR'&&(!date||date>today()||(action==='PAGAR'&&!!selected?.sent_date&&date<selected.sent_date))){setManageError('Selecciona una fecha válida, no posterior a hoy.');return;}
    setManageError('');setManageOpen(false);
    const text=action==='ANULAR'?`¿Anular el acta #${selected?.number}? Motivo: ${reason.trim()}. Se liberarán sus operaciones y el número no se reutilizará.`:action==='ENVIAR'?`¿Registrar el envío del acta #${selected?.number} el ${dateLabel(date)}?`:`¿Registrar el pago del acta #${selected?.number} el ${dateLabel(date)} con factura ${invoice.trim()}?`;
    setConfirm({text,run:async()=>{
    if(!selected)return;const v=await transitionStatement(selected,action,date,invoice,reason);setSelected(v);setInvoice(v.invoice_number||'');
    }});
  };
  function filters(value:StatementRange,set:(r:StatementRange)=>void,editing=false,compact=false,datesBelow=false){
    const selectors=<>
    <Select compact={compact} disabled={busy||(editing&&!!selected)} label="Cliente" value={String(value.clientId||'')} options={[{id:'',name:editing?'Selecciona cliente':'Todos los clientes'},...(settings?.clients||[]).map(c=>({id:String(c.id),name:c.name}))]} onChange={v=>set({...value,clientId:Number(v),areaId:0})}/>
    <Select compact={compact} disabled={busy||!value.clientId||(editing&&!!selected)} label="Servicio" value={String(value.areaId||'')} options={[{id:'',name:editing?'Selecciona servicio':'Todos los servicios'},...(settings?.areas||[]).filter(a=>a.client_id===value.clientId).map(a=>({id:String(a.id),name:a.name}))]} onChange={v=>set({...value,areaId:Number(v)})}/>
    </>;
    const dates=<>
    <DateField compact={compact} disabled={busy} label="Desde" value={value.startDate} Calendar={Calendar} onChange={v=>set({...value,startDate:v})}/>
    <DateField compact={compact} disabled={busy} label="Hasta" value={value.endDate} Calendar={Calendar} onChange={v=>set({...value,endDate:v})}/>
    </>;
    return datesBelow?<View style={s.filterRows}><View style={s.wrap}>{selectors}</View><View style={s.wrap}>{dates}</View></View>:<View style={s.wrap}>{selectors}{dates}</View>;
  }
  const activeFilters=Number(!!filter.clientId)+Number(!!filter.areaId)+Number(!!filter.startDate)+Number(!!filter.endDate)+Number(!!status);
  const createAct=()=>{setSelected(null);setPreview(null);setRange({clientId:0,areaId:0,startDate:today().slice(0,8)+'01',endDate:today()});key.current=newKey();setError('');setCreateOpen(true);};
  return <ScrollView contentContainerStyle={s.container}>
    {mode==='list'?<View style={s.pageHeader}><View><Text style={s.title}>Actas y pagos</Text><Text style={s.headerHint}>Consulta y gestiona las actas de servicio</Text></View><Pressable accessibilityRole="button" disabled={!settings||busy} onPress={createAct} style={[s.primaryAction,(!settings||busy)&&{opacity:.45}]}><Text style={s.primaryActionText}>＋  Generar acta</Text></Pressable></View>:<Text style={s.title}>Actas y pagos</Text>}
    {error && <Text style={s.error} accessibilityRole="alert">{error}</Text>}{busy && <ActivityIndicator/>}
    {!settings && <Button label="Reintentar configuracion" onPress={()=>void run(async()=>setSettings(await loadStatementSettings()))}/>}
    {mode==='list' && <>
      <View style={s.toolbar}><TextInput accessibilityLabel="Buscar por cliente o número de acta" placeholder="Buscar cliente o número de acta" value={search} onChangeText={setSearch} style={[s.input,s.searchInput]}/><Pressable accessibilityRole="button" accessibilityState={{expanded:filtersOpen}} onPress={()=>setFiltersOpen(!filtersOpen)} style={[s.toolbarAction,filtersOpen&&s.toolbarActionActive]}><Text style={s.toolbarActionText}>Filtros{activeFilters?` · ${activeFilters}`:''}  {filtersOpen?'▴':'▾'}</Text></Pressable><Pressable accessibilityRole="button" accessibilityLabel="Recargar actas" disabled={busy} onPress={()=>void run(()=>loadList())} style={s.toolbarAction}><Text style={s.toolbarActionText}>↻</Text></Pressable></View>
      {filtersOpen&&<View style={s.filterPanel}><View style={s.filterPanelHeader}><Text style={s.filterPanelTitle}>Filtrar actas</Text>{activeFilters>0&&<Pressable accessibilityRole="button" onPress={()=>{setFilter({clientId:0,areaId:0,startDate:'',endDate:''});setStatus('');}}><Text style={s.clearText}>Limpiar filtros</Text></Pressable>}</View>{filters(filter,setFilter,false,true)}<View style={s.statusField}><Select compact label="Estado" value={status} options={['','GENERADA','ENVIADA','PAGADA','ANULADA'].map(id=>({id,name:id||'Todos los estados'}))} onChange={setStatus}/></View></View>}
      {!visibleItems.length && <Text>{search.trim()?'No hay actas coincidentes entre las cargadas.':'No hay actas para los filtros seleccionados.'}</Text>}
      {visibleItems.map(a=><Pressable key={a.id} accessibilityRole="button" style={s.statementItem} disabled={busy} onPress={()=>void open(a.id)}><View style={s.statementTop}><Text numberOfLines={1} style={s.statementName}>#{a.number} · {a.header.client_name}</Text><Text style={s.statementStatus}>{a.status}</Text></View><Text numberOfLines={1} style={s.statementMeta}>{a.header.service_name} · {dateLabel(a.start_date)}–{dateLabel(a.end_date)}</Text><View style={s.statementTop}><Text style={s.statementTotal}>{money(a.total)}</Text><Text numberOfLines={1} style={s.statementMeta}>Factura: {a.invoice_number||'Sin registrar'}</Text></View></Pressable>)}
      {more&&<Button label="Cargar mas actas" disabled={busy} onPress={()=>void run(()=>loadList(true))}/>}
    </>}
    <Modal visible={createOpen} transparent onRequestClose={()=>setCreateOpen(false)}><View style={s.overlay}><View style={s.dialog}><Text style={s.title}>Generar acta</Text>{!!error&&<Text accessibilityRole="alert" style={s.error}>{error}</Text>}
      <ScrollView style={s.createScroll} keyboardShouldPersistTaps="handled">{filters(range,r=>{setRange(r);setPreview(null);key.current=newKey();},true,false,true)}</ScrollView>
      <View style={s.wrap}><Button label="Cancelar" disabled={busy} onPress={()=>setCreateOpen(false)}/><Button label={busy?'Cargando...':'Vista previa'} disabled={busy} onPress={()=>void run(async()=>{
        if(!range.clientId||!range.areaId||!range.startDate||!range.endDate||range.startDate>range.endDate)throw Error('Selecciona cliente, servicio y rango valido');
        const result=await previewStatement(range,null);setPreview(result);setCreateOpen(false);setMode('edit');
      })}/></View></View></View></Modal>
    {mode==='edit'&&<>
      <Button label="Volver" disabled={busy} onPress={()=>{setPreview(null);setMode(selected?'detail':'list');}}/>
      {selected&&filters(range,r=>{setRange(r);setPreview(null);key.current=newKey();},true)}
      {selected&&<Button label="Vista previa" disabled={busy} onPress={()=>void run(async()=>{
        if(!range.clientId||!range.areaId||!range.startDate||!range.endDate||range.startDate>range.endDate)throw Error('Selecciona cliente, servicio y rango valido');
        setPreview(await previewStatement(range,selected?.id??null));
      })}/>}
      {preview&&<><Table data={preview}/>{preview.excluded.length>0&&<View style={s.card}><Text style={s.label}>Operaciones excluidas: ya reservadas</Text>{preview.excluded.map(x=><Text key={x.operation_id}>Operacion #{x.operation_id} · {dateLabel(x.date)} · Acta #{x.number}</Text>)}</View>}
        <Button label={selected?'Guardar nuevo rango':'Confirmar generacion'} disabled={busy||!preview.lines.length} onPress={()=>setConfirm({text:`${selected?'Actualizar':'Generar'} acta para ${preview.header.client_name}, ${dateLabel(range.startDate)} al ${dateLabel(range.endDate)}. Total ${money(preview.total)}. Se reservaran las operaciones indicadas.`,run:async()=>{
          const v=await saveStatement(range,preview.preview_hash,key.current,selected);setSelected(v);setInvoice(v.invoice_number||'');setDate(today());setReason('');setPreview(null);setMode('detail');
        }})}/></>}
    </>}
    {mode==='detail'&&selected&&<>
      <View style={s.wrap}><Button label="Volver a listado" disabled={busy} onPress={()=>setMode('list')}/><Button label="Recargar acta" disabled={busy} onPress={()=>void open(selected.id)}/></View>
      <Text style={s.title}>Acta #{selected.number} · {selected.status}</Text><Text>{dateLabel(selected.start_date)} - {dateLabel(selected.end_date)}</Text>
      <Text>Factura: {selected.invoice_number||'Sin registrar'} · Envio: {selected.sent_date?dateLabel(selected.sent_date):'Sin registrar'} · Pago: {selected.paid_date?dateLabel(selected.paid_date):'Sin registrar'}</Text>
      {selected.days_since_sent!==null&&<Text>{selected.days_since_sent} dias {selected.paid_date?'entre envio y pago':'desde envio'}</Text>}
      {selected.cancellation_reason&&<Text>Motivo de anulacion: {selected.cancellation_reason}</Text>}
      <View style={s.detailActions}>
        {(['pdf','xlsx'] as const).map(f=><Pressable key={f} accessibilityRole="button" disabled={busy} onPress={()=>void run(async()=>{const current=await getStatement(selected.id);setSelected(current);await exportStatement(current,f);})} style={[s.detailAction,busy&&{opacity:.45}]}><Text style={s.detailActionText}>↓  {f.toUpperCase()}</Text></Pressable>)}
        {selected.status==='GENERADA'&&<Pressable accessibilityRole="button" disabled={busy} onPress={()=>{setRange({clientId:selected.client_id,areaId:selected.area_id,startDate:selected.start_date,endDate:selected.end_date});setPreview(null);key.current=newKey();setMode('edit');}} style={s.detailAction}><Text style={s.detailActionText}>Modificar rango</Text></Pressable>}
        {['GENERADA','ENVIADA'].includes(selected.status)&&<Pressable accessibilityRole="button" disabled={busy} onPress={()=>{setManageAction('pay');setManageError('');setDate(selected.status==='ENVIADA'?'':today());setManageOpen(true);}} style={[s.detailAction,s.manageAction]}><Text style={s.manageActionText}>{selected.status==='GENERADA'?'Registrar envío':'Gestionar acta'}  →</Text></Pressable>}
      </View>
      <Table data={selected}/>
      <View style={s.card}><Text style={s.title}>Historial</Text>{selected.audit?.map((a,i)=><Text key={i}>{new Date(a.at).toLocaleString('es-CO',{timeZone:'America/Bogota'})} · {a.actor} · {a.action}</Text>)}</View>
    </>}
    <Modal visible={manageOpen&&mode==='detail'} transparent onRequestClose={()=>setManageOpen(false)}><View style={s.overlay}><View style={s.dialog}><View style={s.filterPanelHeader}><Text style={s.title}>Gestionar acta #{selected?.number}</Text><Pressable accessibilityRole="button" accessibilityLabel="Cerrar gestión" onPress={()=>setManageOpen(false)}><Text style={s.clearText}>Cerrar</Text></Pressable></View>
      {!!manageError&&<Text accessibilityRole="alert" style={s.error}>{manageError}</Text>}
      {selected?.status==='GENERADA'?<View style={s.manageSections}><Text style={s.statementMeta}>Selecciona la fecha en que se envió el acta.</Text><DateField label="Fecha de envío" value={date} onChange={setDate} Calendar={Calendar}/><Button label="Registrar envío" disabled={busy} onPress={()=>alter('ENVIAR')}/></View>:selected?.status==='ENVIADA'?<View style={s.manageSections}>
        <View style={s.manageChoices}><Pressable accessibilityRole="button" accessibilityState={{selected:manageAction==='pay'}} onPress={()=>{setManageAction('pay');setManageError('');}} style={[s.manageChoice,manageAction==='pay'&&s.manageChoiceActive]}><Text style={manageAction==='pay'?s.manageChoiceTextActive:s.detailActionText}>Registrar pago</Text></Pressable><Pressable accessibilityRole="button" accessibilityState={{selected:manageAction==='cancel'}} onPress={()=>{setManageAction('cancel');setManageError('');}} style={[s.manageChoice,manageAction==='cancel'&&s.manageChoiceActive]}><Text style={manageAction==='cancel'?s.manageChoiceTextActive:s.detailActionText}>Anular acta</Text></Pressable></View>
        {manageAction==='pay'?<View style={s.manageSections}><DateField label="Fecha de pago" value={date} emptyLabel="Seleccione fecha de pago" onChange={setDate} Calendar={Calendar}/><Field label="Número de factura" value={invoice} onChangeText={setInvoice}/><Button label="Registrar pago" disabled={busy} onPress={()=>alter('PAGAR')}/></View>:<View style={s.manageSections}><Field label="Motivo de anulación" value={reason} onChangeText={setReason}/><Button label="Anular acta" disabled={busy} onPress={()=>alter('ANULAR')}/></View>}
      </View>:null}</View></View></Modal>
    <Modal visible={!!confirm} transparent onRequestClose={()=>{if(!busy)setConfirm(null);}}><View style={s.overlay}><View style={s.dialog}><Text style={s.title}>Confirmar</Text><Text>{confirm?.text}</Text><Button label="Cancelar" disabled={busy} onPress={()=>setConfirm(null)}/><Button label="Confirmar" disabled={busy} onPress={()=>{const action=confirm;setConfirm(null);if(action)void run(action.run);}}/></View></View></Modal>
  </ScrollView>;
}
const s=StyleSheet.create({manageChoices:{flexDirection:'row',gap:8},manageChoice:{flex:1,minHeight:44,paddingHorizontal:12,borderWidth:1,borderColor:'#ccd3df',borderRadius:10,justifyContent:'center',alignItems:'center'},manageChoiceActive:{backgroundColor:'#15285a',borderColor:'#15285a'},manageChoiceTextActive:{color:'#fff',fontWeight:'800',fontSize:13},filterRows:{gap:12},detailActions:{flexDirection:'row',flexWrap:'wrap',gap:8,paddingVertical:4},detailAction:{minHeight:42,paddingHorizontal:14,borderRadius:10,borderWidth:1,borderColor:'#ccd3df',backgroundColor:'#fff',justifyContent:'center'},detailActionText:{color:'#15285a',fontWeight:'700',fontSize:13},manageAction:{backgroundColor:'#15285a',borderColor:'#15285a'},manageActionText:{color:'#fff',fontWeight:'800',fontSize:13},manageSections:{gap:16},manageSection:{gap:9,paddingBottom:14,borderBottomWidth:1,borderBottomColor:'#e4e8f0'},pageHeader:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',flexWrap:'wrap',gap:12},headerHint:{fontSize:12,color:'#677187',marginTop:3},primaryAction:{backgroundColor:'#15285a',borderRadius:10,minHeight:44,paddingHorizontal:18,justifyContent:'center',alignItems:'center'},primaryActionText:{color:'#fff',fontSize:14,fontWeight:'800'},toolbar:{flexDirection:'row',alignItems:'center',gap:8,flexWrap:'wrap'},searchInput:{flexGrow:1,flexBasis:240,backgroundColor:'#fff'},toolbarAction:{minHeight:46,paddingHorizontal:14,borderWidth:1,borderColor:'#ccd3df',borderRadius:10,justifyContent:'center',backgroundColor:'#fff'},toolbarActionActive:{borderColor:'#15285a',backgroundColor:'#e9eef9'},toolbarActionText:{color:'#15285a',fontWeight:'700'},filterPanel:{padding:14,borderWidth:1,borderColor:'#dfe5ef',borderRadius:14,backgroundColor:'#fff',gap:12},filterPanelHeader:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:8},filterPanelTitle:{fontSize:14,fontWeight:'800',color:'#15285a'},clearText:{fontSize:12,fontWeight:'700',color:'#365b9c'},compactField:{minWidth:150,flexBasis:180,flexGrow:1},filterControl:{minHeight:42,borderWidth:1,borderColor:'#ccd3df',borderRadius:9,paddingHorizontal:12,justifyContent:'center',backgroundColor:'#f8faff'},filterControlText:{fontSize:13,color:'#17213a',fontWeight:'600'},statusField:{maxWidth:260},container:{padding:18,gap:14,paddingBottom:40},card:{padding:16,borderRadius:16,backgroundColor:'#fff',borderWidth:1,borderColor:'#e4e8f0',gap:10},statementItem:{paddingHorizontal:14,paddingVertical:10,borderRadius:12,backgroundColor:'#fff',borderWidth:1,borderColor:'#e4e8f0',gap:3},statementTop:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:8},statementName:{fontSize:15,fontWeight:'800',color:'#15285a',flex:1},statementStatus:{fontSize:10,fontWeight:'700',color:'#15285a'},statementMeta:{fontSize:12,color:'#677187',flexShrink:1},statementTotal:{fontSize:14,fontWeight:'800',color:'#17213a'},createScroll:{maxHeight:420},title:{fontSize:19,fontWeight:'800',color:'#15285a'},label:{fontSize:13,fontWeight:'700',color:'#17213a'},field:{minWidth:180,flexGrow:1,gap:6},input:{borderWidth:1,borderColor:'#ccd3df',borderRadius:10,padding:12,minHeight:46,color:'#17213a'},button:{padding:12,borderRadius:10,backgroundColor:'#15285a',minHeight:44,justifyContent:'center'},buttonText:{color:'#fff',fontWeight:'700',textAlign:'center'},wrap:{flexDirection:'row',flexWrap:'wrap',gap:10},error:{color:'#ab2020',backgroundColor:'#fff0f0',padding:12},row:{flexDirection:'row',borderBottomWidth:1,borderColor:'#e4e8f0'},cell:{padding:8,fontSize:12},overlay:{flex:1,justifyContent:'center',backgroundColor:'#0007',padding:20},dialog:{width:'100%',maxWidth:600,alignSelf:'center',backgroundColor:'#fff',borderRadius:18,padding:20,gap:14}});
