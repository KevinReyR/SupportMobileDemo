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
function Select({label,value,options,onChange,disabled=false}: {label:string;value:string;options:{id:string;name:string}[];onChange:(v:string)=>void;disabled?:boolean}) {
  const [open,setOpen]=useState(false),[search,setSearch]=useState('');
  return <View style={s.field}><Text style={s.label}>{label}</Text><Button disabled={disabled} label={options.find(x=>x.id===value)?.name || 'Selecciona'} onPress={()=>{setSearch('');setOpen(true);}} />
    <Modal visible={open} transparent onRequestClose={()=>setOpen(false)}><View style={s.overlay}><View style={s.dialog}>
      <Text style={s.title}>{label}</Text><TextInput accessibilityLabel="Buscar opcion" placeholder="Buscar" value={search} onChangeText={setSearch} style={s.input}/>
      <ScrollView style={{maxHeight:360}}>{options.filter(x=>x.name.toLocaleLowerCase().includes(search.toLocaleLowerCase())).map(x=><Button key={x.id} label={x.name} onPress={()=>{onChange(x.id);setOpen(false);}} />)}</ScrollView>
      <Button label="Cerrar" onPress={()=>setOpen(false)}/></View></View></Modal></View>;
}
function DateField({label,value,onChange,Calendar,disabled=false}: {label:string;value:string;onChange:(v:string)=>void;Calendar:Calendar;disabled?:boolean}) {
  const [open,setOpen]=useState(false);
  return <View style={s.field}><Text style={s.label}>{label}</Text><Button disabled={disabled} label={dateLabel(value)} onPress={()=>setOpen(true)}/><Calendar visible={open} selectedDate={value || null} title={label} onClose={()=>setOpen(false)} onSelect={v=>{onChange(v);setOpen(false);}}/></View>;
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
  const open=(id:number)=>run(async()=>{const v=await getStatement(id);setSelected(v);setInvoice(v.invoice_number||'');setDate(today());setReason('');setMode('detail');});
  const alter=(action:string)=>setConfirm({text:action==='ANULAR'?'Anular conserva historial y libera operaciones. No se reutilizara el numero.':`Confirmar ${action.toLowerCase()} acta #${selected?.number} por ${money(selected?.total||0)}${action==='PAGAR'?' con factura '+invoice:''}, fecha ${dateLabel(date)}.`,run:async()=>{
    if(!selected)return;const v=await transitionStatement(selected,action,date,invoice,reason);setSelected(v);setInvoice(v.invoice_number||'');
  }});
  function filters(value:StatementRange,set:(r:StatementRange)=>void,editing=false){return <View style={s.wrap}>
    <Select disabled={busy||(editing&&!!selected)} label="Cliente" value={String(value.clientId||'')} options={[{id:'',name:editing?'Selecciona cliente':'Todos los clientes'},...(settings?.clients||[]).map(c=>({id:String(c.id),name:c.name}))]} onChange={v=>set({...value,clientId:Number(v),areaId:0})}/>
    <Select disabled={busy||!value.clientId||(editing&&!!selected)} label="Servicio (Area)" value={String(value.areaId||'')} options={[{id:'',name:editing?'Selecciona servicio':'Todos los servicios'},...(settings?.areas||[]).filter(a=>a.client_id===value.clientId).map(a=>({id:String(a.id),name:a.name}))]} onChange={v=>set({...value,areaId:Number(v)})}/>
    <DateField disabled={busy} label="Fecha inicial" value={value.startDate} Calendar={Calendar} onChange={v=>set({...value,startDate:v})}/>
    <DateField disabled={busy} label="Fecha final" value={value.endDate} Calendar={Calendar} onChange={v=>set({...value,endDate:v})}/>
  </View>;}
  return <ScrollView contentContainerStyle={s.container}><Text style={s.title}>Actas y pagos</Text>
    {error && <Text style={s.error} accessibilityRole="alert">{error}</Text>}{busy && <ActivityIndicator/>}
    {!settings && <Button label="Reintentar configuracion" onPress={()=>void run(async()=>setSettings(await loadStatementSettings()))}/>}
    {mode==='list' && <>
      {filters(filter,setFilter)}<Select label="Estado" value={status} options={['','GENERADA','ENVIADA','PAGADA','ANULADA'].map(id=>({id,name:id||'Todos'}))} onChange={setStatus}/>
      <TextInput accessibilityLabel="Buscar por cliente o número de acta" placeholder="Buscar cliente o número de acta" value={search} onChangeText={setSearch} style={s.input}/>
      <View style={s.wrap}><Button label="Limpiar filtros" onPress={()=>{setFilter({clientId:0,areaId:0,startDate:'',endDate:''});setStatus('');}}/><Button label="Recargar" disabled={busy} onPress={()=>void run(()=>loadList())}/>
      <Button label="Generar acta" disabled={!settings||busy} onPress={()=>{setSelected(null);setPreview(null);setRange({clientId:0,areaId:0,startDate:today().slice(0,8)+'01',endDate:today()});key.current=newKey();setError('');setCreateOpen(true);}}/></View>
      {!visibleItems.length && <Text>{search.trim()?'No hay actas coincidentes entre las cargadas.':'No hay actas para los filtros seleccionados.'}</Text>}
      {visibleItems.map(a=><Pressable key={a.id} accessibilityRole="button" style={s.statementItem} disabled={busy} onPress={()=>void open(a.id)}><View style={s.statementTop}><Text numberOfLines={1} style={s.statementName}>#{a.number} · {a.header.client_name}</Text><Text style={s.statementStatus}>{a.status}</Text></View><Text numberOfLines={1} style={s.statementMeta}>{a.header.service_name} · {dateLabel(a.start_date)}–{dateLabel(a.end_date)}</Text><View style={s.statementTop}><Text style={s.statementTotal}>{money(a.total)}</Text><Text numberOfLines={1} style={s.statementMeta}>Factura: {a.invoice_number||'Sin registrar'}</Text></View></Pressable>)}
      {more&&<Button label="Cargar mas actas" disabled={busy} onPress={()=>void run(()=>loadList(true))}/>}
    </>}
    <Modal visible={createOpen} transparent onRequestClose={()=>setCreateOpen(false)}><View style={s.overlay}><View style={s.dialog}><Text style={s.title}>Generar acta</Text>{!!error&&<Text accessibilityRole="alert" style={s.error}>{error}</Text>}
      <ScrollView style={s.createScroll} keyboardShouldPersistTaps="handled">{filters(range,r=>{setRange(r);setPreview(null);key.current=newKey();},true)}</ScrollView>
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
      <Table data={selected}/><View style={s.wrap}>{(['pdf','xlsx'] as const).map(f=><Button key={f} label={'Descargar '+f.toUpperCase()} disabled={busy} onPress={()=>void run(async()=>{const current=await getStatement(selected.id);setSelected(current);await exportStatement(current,f);})}/>)}</View>
      {selected.status==='GENERADA'&&<Button label="Modificar rango" disabled={busy} onPress={()=>{setRange({clientId:selected.client_id,areaId:selected.area_id,startDate:selected.start_date,endDate:selected.end_date});setPreview(null);key.current=newKey();setMode('edit');}}/>}
      {['GENERADA','ENVIADA'].includes(selected.status)&&<View style={s.card}>
        <Field label="Numero de factura" value={invoice} onChangeText={setInvoice}/><Button label="Guardar factura" disabled={busy} onPress={()=>alter('FACTURA')}/>
        <DateField label={selected.status==='GENERADA'?'Fecha de envio':'Fecha de pago completo'} value={date} onChange={setDate} Calendar={Calendar}/>
        <Button label={selected.status==='GENERADA'?'Registrar envio manual':'Registrar pago completo'} disabled={busy} onPress={()=>alter(selected.status==='GENERADA'?'ENVIAR':'PAGAR')}/>
        <Field label="Motivo de anulacion" value={reason} onChangeText={setReason}/><Button label="Anular acta" disabled={busy} onPress={()=>alter('ANULAR')}/>
      </View>}
      <View style={s.card}><Text style={s.title}>Historial</Text>{selected.audit?.map((a,i)=><Text key={i}>{new Date(a.at).toLocaleString('es-CO',{timeZone:'America/Bogota'})} · {a.actor} · {a.action}</Text>)}</View>
    </>}
    <Modal visible={!!confirm} transparent onRequestClose={()=>{if(!busy)setConfirm(null);}}><View style={s.overlay}><View style={s.dialog}><Text style={s.title}>Confirmar</Text><Text>{confirm?.text}</Text><Button label="Cancelar" disabled={busy} onPress={()=>setConfirm(null)}/><Button label="Confirmar" disabled={busy} onPress={()=>{const action=confirm;setConfirm(null);if(action)void run(action.run);}}/></View></View></Modal>
  </ScrollView>;
}
const s=StyleSheet.create({container:{padding:18,gap:14,paddingBottom:40},card:{padding:16,borderRadius:16,backgroundColor:'#fff',borderWidth:1,borderColor:'#e4e8f0',gap:10},statementItem:{paddingHorizontal:14,paddingVertical:10,borderRadius:12,backgroundColor:'#fff',borderWidth:1,borderColor:'#e4e8f0',gap:3},statementTop:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:8},statementName:{fontSize:15,fontWeight:'800',color:'#15285a',flex:1},statementStatus:{fontSize:10,fontWeight:'700',color:'#15285a'},statementMeta:{fontSize:12,color:'#677187',flexShrink:1},statementTotal:{fontSize:14,fontWeight:'800',color:'#17213a'},createScroll:{maxHeight:420},title:{fontSize:19,fontWeight:'800',color:'#15285a'},label:{fontSize:13,fontWeight:'700',color:'#17213a'},field:{minWidth:180,flexGrow:1,gap:6},input:{borderWidth:1,borderColor:'#ccd3df',borderRadius:10,padding:12,minHeight:46,color:'#17213a'},button:{padding:12,borderRadius:10,backgroundColor:'#15285a',minHeight:44,justifyContent:'center'},buttonText:{color:'#fff',fontWeight:'700',textAlign:'center'},wrap:{flexDirection:'row',flexWrap:'wrap',gap:10},error:{color:'#ab2020',backgroundColor:'#fff0f0',padding:12},row:{flexDirection:'row',borderBottomWidth:1,borderColor:'#e4e8f0'},cell:{padding:8,fontSize:12},overlay:{flex:1,justifyContent:'center',backgroundColor:'#0007',padding:20},dialog:{width:'100%',maxWidth:600,alignSelf:'center',backgroundColor:'#fff',borderRadius:18,padding:20,gap:14}});
