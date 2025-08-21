const {useState,useMemo,useEffect,useRef} = React;

/* ========= Utils ========= */
const fmtDay = new Intl.DateTimeFormat("es-AR", { day:"2-digit" });
const fmtMonth = new Intl.DateTimeFormat("es-AR", { month:"long", year:"numeric" });
const fmtFull = new Intl.DateTimeFormat("es-AR", { weekday:"long", year:"numeric", month:"long", day:"numeric" });

const ymd = d => { const x=new Date(d); x.setHours(0,0,0,0); return x.toISOString().slice(0,10); };
const parseYMD = s => { const [Y,m,d]=s.split('-').map(Number); const x=new Date(Y,m-1,d); x.setHours(0,0,0,0); return x; };
const addDays = (d,n)=>{ const x=new Date(d); x.setDate(x.getDate()+n); return x; };
const startOfMonth = d => { const x=new Date(d.getFullYear(), d.getMonth(),1); x.setHours(0,0,0,0); return x; };
const isWeekend = d => [0,6].includes(new Date(d).getDay()); // dom=0, sab=6
const nowTimeHHMM = () => new Date().toTimeString().slice(0,5);

/* ========= Persistencia ========= */
const LS_KEY = "guardias.pwa.v3";
const IDB_NAME = 'guardias-db';
const IDB_STORE = 'state';
function idbOpen(){ return new Promise((res,rej)=>{ const r=indexedDB.open(IDB_NAME,1); r.onupgradeneeded=()=>r.result.createObjectStore(IDB_STORE); r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error); }); }
async function idbGet(key='singleton'){ try{ const db=await idbOpen(); return await new Promise((res,rej)=>{ const tx=db.transaction(IDB_STORE,'readonly'); const st=tx.objectStore(IDB_STORE); const g=st.get(key); g.onsuccess=()=>res(g.result||null); g.onerror=()=>rej(g.error); }); }catch{ return null; } }
async function idbSet(val,key='singleton'){ try{ const db=await idbOpen(); await new Promise((res,rej)=>{ const tx=db.transaction(IDB_STORE,'readwrite'); const st=tx.objectStore(IDB_STORE); const p=st.put(val,key); p.onsuccess=()=>res(); p.onerror=()=>rej(p.error); }); }catch{} }

/* ========= Estado inicial ========= */
function defaultState(){
  return {
    days: {},                                   // { 'YYYY-MM-DD': DayData }
    pattern: { enabled:false, start:"", turno:"B" },
    colors: {                                    // Colores configurables por estado
      guardia: "#0ea5e9",                        // azul
      recargo: "#eab308",                        // amarillo
      art: "#ef4444",                            // rojo
      licencia: "#60a5fa",                       // celeste
      patternGuardiaBg: "rgba(16,185,129,0.25)", // verde translúcido
      selected: "#22c55e",                       // selección
      today: "#34d399"                           // hoy (borde)
    },
    holidays: [],                                // Lista de feriados 'YYYY-MM-DD' (vacío para que vos la cargues)
    notes: [],                                   // Notas sueltas (sueldo, ART nº, etc.)
    objectSuggestions: []                        // Sugerencias personalizadas para "Objeto" (empieza vacío)
  };
}

function useStore(){
  const [state,setState] = useState(()=>{
    try{ return JSON.parse(localStorage.getItem(LS_KEY)||"null") || defaultState(); }
    catch{ return defaultState(); }
  });
  useEffect(()=>{ (async()=>{ const from = await idbGet(); if(from){ setState(from); }})(); },[]);
  useEffect(()=>{ localStorage.setItem(LS_KEY, JSON.stringify(state)); idbSet(state); },[state]);
  return [state,setState];
}

/* ========= Modelos ========= */
function emptyDay(key){
  return {
    key,
    pabellon:"",
    poblacion:{ total:"", condenados:"", procesados:"", presentes:"", hospitalizados:"" },
    role:"", // Celador/Auxiliar SOLO dentro de Guardia
    companeros:"",
    notas:"",
    // Estado EXCLUSIVO. Solo 1 por día:
    // 'guardia' | 'recargo' | 'cubro_guardia' | 'me_cubre_guardia' | 'cubro_recargo' | 'me_cubre_recargo' | 'art' | 'licencia'
    estado: null,
    // flags auxiliares: una fecha NO puede ser 💲 y 🔄 a la vez
    pago:false,  // 💲
    swap:false,  // 🔄
    linkedDate:"", // si es swap con devolución, fecha espejo
    linkedType:"", // tipo espejo sugerido
    movimientos:[],            // [{objeto,entrada,salida,movimiento,a_cargo}]
    poblacionListado:[]        // [{matricula, cp:'C'|'P', nombre}]
  };
}

/* ========= Cálculos licencia ========= */
function expandLicenseByDates(startStr, endStr){
  const start = parseYMD(startStr), end = parseYMD(endStr);
  const out=[];
  for(let d=new Date(start); d<=end; d=addDays(d,1)) out.push(ymd(d));
  return out;
}
function expandLicenseByWorkingDays(startStr, count, holidaysSet, skipWeekends=true){
  const out=[]; let d=parseYMD(startStr);
  while(out.length < count){
    const key=ymd(d);
    const weekend = skipWeekends && isWeekend(d);
    const holiday = holidaysSet.has(key);
    if(!(weekend || holiday)){ out.push(key); }
    d = addDays(d,1);
  }
  return out;
}
function expandLicenseByCalendarDays(startStr, count){
  const out=[]; let d=parseYMD(startStr);
  for(let i=0;i<count;i++){ out.push(ymd(addDays(d,i))); }
  return out;
}

/* ========= Componentes ========= */
function App(){
  const [store,setStore] = useStore();
  const today = new Date();
  const [cursor,setCursor] = useState(new Date(today.getFullYear(), today.getMonth(), 1));
  const [selectedKey,setSelectedKey] = useState(null);
  const [screen,setScreen] = useState('month'); // 'month' | 'day' | 'notes'
  const [quickKey,setQuickKey] = useState(null);
  const [showSettings,setShowSettings] = useState(false);
  const [showLicense,setShowLicense] = useState(null); // { date:'YYYY-MM-DD' } | null

  // Celdas del mes
  const cells = useMemo(()=>{
    const start = startOfMonth(cursor);
    const startWeekDay = (start.getDay()+6)%7; // Lunes=0
    const first = addDays(start,-startWeekDay);
    return Array.from({length:42},(_,i)=> addDays(first,i));
  },[cursor]);

  // Patrón 24x48 (arranca guardia y luego 2 francos) según fecha de inicio (infinito)
  const isPatternGuardia = useMemo(()=>{
    const p=store.pattern; if(!p.enabled||!p.start) return ()=>false;
    const anchor=parseYMD(p.start);
    return d=>{ const diff = Math.floor((parseYMD(ymd(d)) - anchor)/86400000); return (diff%3===0); };
  },[store.pattern]);

  // Helpers day
  function dayData(k){ return store.days[k] || emptyDay(k); }
  function saveDay(k,patch){ setStore(s=> ({...s, days:{...s.days, [k]:{...dayData(k), ...patch}} })); }

  // Estado exclusivo por día (con regla: pago XOR swap)
  function setDayEstado(k, {estado=null, pago=false, swap=false, linkedDate="", linkedType="", quien=""}){
    // En este diseño, 💲 y 🔄 no pueden coexistir:
    if(pago && swap){ // fuerza regla
      // preferimos lo último que el usuario marcó: si vino swap=true, pago=false
      pago = false;
    }
    const d = dayData(k);
    // auto espejo para swaps con fecha
    if(swap && linkedDate){
      const mirror = dayData(linkedDate);
      let tipoEsp = "";
      if(estado==='cubro_guardia') tipoEsp='me_cubre_guardia';
      else if(estado==='me_cubre_guardia') tipoEsp='cubro_guardia';
      else if(estado==='cubro_recargo') tipoEsp='me_cubre_recargo';
      else if(estado==='me_cubre_recargo') tipoEsp='cubro_recargo';
      if(tipoEsp){
        saveDay(linkedDate, { estado: tipoEsp, pago, swap:true, linkedDate:k, linkedType:estado });
      }
    }
    saveDay(k,{ estado, pago, swap, linkedDate, linkedType });
  }

  // Abrir/entrar a día
  const lastTapRef = useRef(0);
  function onTapDay(d){
    // 1 tap: seleccionar; doble tap: abrir
    const t=Date.now();
    if(t - lastTapRef.current < 350){ openDay(d); }
    else { setSelectedKey(ymd(d)); }
    lastTapRef.current = t;
  }
  function openDay(d){ const k=ymd(d); setSelectedKey(k); setScreen('day'); }

  // Swipe para cambiar a Población dentro del día
  const swipeStartX = useRef(null);
  function attachSwipe(el, onRight){ if(!el) return;
    el.addEventListener('touchstart', e=>{ swipeStartX.current = e.touches[0].clientX; }, {passive:true});
    el.addEventListener('touchend', e=>{
      if(swipeStartX.current==null) return;
      const dx = e.changedTouches[0].clientX - swipeStartX.current;
      if(dx > 60) onRight?.();
      swipeStartX.current=null;
    }, {passive:true});
  }

  // Resumen del día seleccionado para mostrar arriba del calendario
  const summary = useMemo(()=>{
    if(!selectedKey) return null;
    const d = dayData(selectedKey);
    const base = [];
    if(d.estado) base.push(d.estado.toUpperCase());
    if(d.pabellon) base.push(`Pab: ${d.pabellon}`);
    const P=d.poblacion||{};
    if(P.total) base.push(`Pob: ${P.total}`);
    if(P.condenados) base.push(`Cond: ${P.condenados}`);
    if(P.procesados) base.push(`Proc: ${P.procesados}`);
    if(d.companeros) base.push(`Comp: ${d.companeros}`);
    return base.join(" · ");
  },[selectedKey, store.days]);

  return (
    <div className="h-full flex flex-col">
      <TopBar
        screen={screen} cursor={cursor}
        onPrev={()=> setCursor(d=> new Date(d.getFullYear(), d.getMonth()-1,1))}
        onNext={()=> setCursor(d=> new Date(d.getFullYear(), d.getMonth()+1,1))}
        onBack={()=> setScreen('month')}
        onSettings={()=> setShowSettings(true)}
        onNotes={()=> setScreen('notes')}
      />

      {screen==='month' && (
        <>
          {selectedKey && summary && (
            <div className="px-3 pt-2">
              <div className="bg-slate-800/70 border border-slate-700 rounded-xl px-3 py-2 text-sm">{selectedKey} — {summary}</div>
            </div>
          )}
          <MonthGrid
            cells={cells}
            cursor={cursor}
            selectedKey={selectedKey}
            onTap={onTapDay}
            onOpen={openDay}
            isPattern={d=> isPatternGuardia(d)}
            colors={store.colors}
            getDay={k=>dayData(k)}
            onLong={(d)=> setQuickKey(ymd(d))}
          />
        </>
      )}

      {screen==='day' && selectedKey && (
        <DayScreen
          ymdKey={selectedKey}
          data={dayData(selectedKey)}
          setData={(patch)=> saveDay(selectedKey, patch)}
          setEstado={(payload)=> setDayEstado(selectedKey, payload)}
          colors={store.colors}
          attachSwipe={attachSwipe}
        />
      )}

      {screen==='notes' && (
        <NotesScreen store={store} setStore={setStore}/>
      )}

      {quickKey && (
        <QuickModal
          ymdKey={quickKey}
          data={dayData(quickKey)}
          colors={store.colors}
          onClose={()=>setQuickKey(null)}
          onPick={(payload)=>{ setQuickKey(null); setDayEstado(quickKey, payload); }}
          onOpenLicencia={()=>{ setQuickKey(null); setShowLicense({date:quickKey}); }}
        />
      )}

      {showSettings && (
        <SettingsModal
          store={store}
          onClose={()=>setShowSettings(false)}
          onSave={setStore}
        />
      )}

      {showLicense && (
        <LicenseModal
          date={showLicense.date}
          holidays={new Set(store.holidays)}
          onClose={()=>setShowLicense(null)}
          onApply={({mode, until, corridos, habiles, excluirFeriados})=>{
            // Aplica licencia al rango calculado
            let keys=[];
            if(mode==='rango' && until){
              keys = expandLicenseByDates(showLicense.date, until);
            }else{
              if(corridos>0) keys = keys.concat(expandLicenseByCalendarDays(showLicense.date, Number(corridos)));
              if(habiles>0){
                const add = expandLicenseByWorkingDays(showLicense.date, Number(habiles), new Set(excluirFeriados? store.holidays: []), true);
                keys = keys.concat(add);
              }
            }
            // Marcar todas como licencia
            const patchDays={...store.days};
            keys.forEach(k=>{ patchDays[k] = {...(patchDays[k]||emptyDay(k)), estado:'licencia', pago:false, swap:false, linkedDate:"", linkedType:""}; });
            setStore(s=> ({...s, days: patchDays}));
            setShowLicense(null);
          }}
        />
      )}
    </div>
  );
}

/* ===== Topbar ===== */
function TopBar({screen,cursor,onPrev,onNext,onBack,onSettings,onNotes}){
  return (
    <header className="px-3 py-2 bg-slate-950 border-b border-slate-800 flex items-center gap-2">
      {screen!=='month'
        ? <button onClick={onBack} className="btn bg-slate-800">←</button>
        : <button onClick={onPrev} className="btn bg-slate-800">◀</button>}
      <div className="text-lg font-medium flex-1 text-center select-none capitalize">{fmtMonth.format(cursor)}</div>
      {screen==='month'
        ? <button onClick={onNext} className="btn bg-slate-800">▶</button>
        : <div className="w-[40px]"/>}
      <button onClick={onNotes} className="btn bg-sky-600">Notas</button>
      <button onClick={onSettings} className="btn bg-emerald-600">Ajustes</button>
    </header>
  );
}

/* ===== Calendario (mes) ===== */
function MonthGrid({cells,cursor,selectedKey,onTap,onOpen,isPattern,colors,getDay,onLong}){
  const todayKey = ymd(new Date());
  const weekdays = ["Lun","Mar","Mié","Jue","Vie","Sáb","Dom"];
  return (
    <div className="flex-1 overflow-y-auto px-2 pb-2">
      <div className="grid grid-cols-7 text-center text-xs text-slate-400 mb-1 select-none">
        {weekdays.map(w=> <div key={w} className="py-1">{w}</div>)}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((d,i)=>{
          const inMonth = d.getMonth()===cursor.getMonth();
          const k = ymd(d);
          const info = getDay(k);
          const pattern = isPattern(d);
          const isToday = todayKey===k;
          const isSel = selectedKey===k;
          return (
            <MonthCell key={i}
              date={d}
              inMonth={inMonth}
              info={info}
              pattern={pattern}
              isToday={isToday}
              isSel={isSel}
              colors={colors}
              onTap={()=>onTap(d)}
              onOpen={()=>onOpen(d)}
              onLong={()=>onLong?.(d)}
            />
          );
        })}
      </div>
    </div>
  );
}

function MonthCell({date,inMonth,info,pattern,isToday,isSel,colors,onTap,onOpen,onLong}){
  // Gestos: tap, double tap (se maneja en App), long press (aquí)
  const holdRef = useRef(null);
  const onTouchStart = ()=>{ holdRef.current = setTimeout(()=> onLong?.(), 550); };
  const onTouchEnd = ()=>{ if(holdRef.current){ clearTimeout(holdRef.current); holdRef.current=null; } };

  // Colores
  let bg = inMonth? 'bg-slate-800' : 'bg-slate-800/30';
  if(pattern && !info?.estado) bg += ' pattern-bg';
  let style = {};
  if(pattern && !info?.estado){ style.background = colors.patternGuardiaBg; }
  if(info?.estado){
    const mapCol = {
      guardia: colors.guardia,
      recargo: colors.recargo,
      art: colors.art,
      licencia: colors.licencia,
      cubro_guardia: colors.guardia,
      me_cubre_guardia: colors.guardia,
      cubro_recargo: colors.recargo,
      me_cubre_recargo: colors.recargo
    };
    style.background = mapCol[info.estado] || 'transparent';
  }
  if(isSel){ style.outline = `2px solid ${colors.selected}`; }
  if(isToday){ style.boxShadow = `inset 0 0 0 2px ${colors.today}`; }

  return (
    <button
      onClick={onTap}
      onDoubleClick={onOpen}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
      onContextMenu={(e)=>{ e.preventDefault(); onLong?.(); }}
      className={`aspect-square rounded-xl p-1 flex flex-col items-start justify-between ${bg}`}
      style={style}
    >
      <div className="text-[11px] opacity-90">{fmtDay.format(date)}</div>
      <div className="w-full flex gap-1 flex-wrap justify-end">
        {info?.pago && <span className="badge">💲</span>}
        {info?.swap && <span className="badge">🔄</span>}
      </div>
    </button>
  );
}

/* ===== Quick modal (long press) ===== */
function QuickModal({ymdKey,data,colors,onClose,onPick,onOpenLicencia}){
  // Un solo estado por día + pago XOR swap
  const [estado,setEstado]=useState(data.estado||"");
  const [pago,setPago]=useState(!!data.pago);
  const [swap,setSwap]=useState(!!data.swap);
  const [linked,setLinked]=useState(data.linkedDate||"");

  useEffect(()=>{ if(pago && swap){ setPago(false); } },[pago,swap]);

  function go(){
    if(estado==='licencia'){ onOpenLicencia(); return; }
    onPick({estado: estado||null, pago, swap, linkedDate: swap? linked:"", linkedType:""});
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={e=>e.stopPropagation()}>
        <div className="text-sm opacity-80 mb-2">{ymdKey}</div>
        <div className="grid gap-2">
          <select value={estado} onChange={e=>setEstado(e.target.value)} className="bg-slate-900 border border-slate-700 rounded-xl px-2 py-2">
            <option value="">(sin estado)</option>
            <option value="guardia">Guardia</option>
            <option value="recargo">Recargo</option>
            <option value="cubro_guardia">Cubro guardia a…</option>
            <option value="me_cubre_guardia">Me cubre guardia…</option>
            <option value="cubro_recargo">Cubro recargo a…</option>
            <option value="me_cubre_recargo">Me cubre recargo…</option>
            <option value="art">ART Nº…</option>
            <option value="licencia">Licencia…</option>
          </select>
          {estado && estado!=='recargo' && estado!=='guardia' && estado!=='art' && estado!=='licencia' && (
            <input placeholder="Apellido/Nombre" className="bg-slate-900 border border-slate-700 rounded-xl px-3 py-2"/>
          )}
          {/* Pago XOR swap */}
          <label className="text-sm flex items-center gap-2">
            <input type="checkbox" checked={pago} onChange={e=>{ setPago(e.target.checked); if(e.target.checked) setSwap(false); }}/> 💲
          </label>
          <label className="text-sm flex items-center gap-2">
            <input type="checkbox" checked={swap} onChange={e=>{ setSwap(e.target.checked); if(e.target.checked) setPago(false); }}/> 🔄
          </label>
          {swap && (
            <input type="date" value={linked} onChange={e=>setLinked(e.target.value)} className="bg-slate-900 border border-slate-700 rounded-xl px-3 py-2"/>
          )}
        </div>
        <div className="mt-3 flex justify-end gap-2">
          <button className="btn bg-slate-700" onClick={onClose}>Cancelar</button>
          <button className="btn bg-emerald-600" onClick={go}>{estado==='licencia'?'Licencia…':'Guardar'}</button>
        </div>
      </div>
    </div>
  );
}

/* ===== Modal Licencia ===== */
function LicenseModal({date,holidays,onClose,onApply}){
  const [mode,setMode]=useState('rango'); // 'rango' | 'calculo'
  const [hasta,setHasta]=useState("");
  const [corridos,setCorridos]=useState("");
  const [habiles,setHabiles]=useState("");
  const [excluirFeriados,setExcluirFeriados]=useState(true);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={e=>e.stopPropagation()}>
        <div className="text-sm mb-2">Licencia desde <strong>{date}</strong></div>
        <div className="mb-2">
          <label className="mr-3"><input type="radio" name="m" checked={mode==='rango'} onChange={()=>setMode('rango')}/> Por rango</label>
          <label><input type="radio" name="m" checked={mode==='calculo'} onChange={()=>setMode('calculo')}/> Por días</label>
        </div>
        {mode==='rango' ? (
          <div className="grid gap-2">
            <label>Hasta: <input type="date" value={hasta} onChange={e=>setHasta(e.target.value)} className="bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 w-full"/></label>
          </div>
        ) : (
          <div className="grid gap-2">
            <label>Días corridos: <input type="number" min="0" value={corridos} onChange={e=>setCorridos(e.target.value)} className="bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 w-full"/></label>
            <label>Días hábiles: <input type="number" min="0" value={habiles} onChange={e=>setHabiles(e.target.value)} className="bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 w-full"/></label>
            <label className="text-sm flex items-center gap-2"><input type="checkbox" checked={excluirFeriados} onChange={e=>setExcluirFeriados(e.target.checked)}/> Excluir feriados</label>
          </div>
        )}
        <div className="mt-3 flex justify-end gap-2">
          <button className="btn bg-slate-700" onClick={onClose}>Cancelar</button>
          <button className="btn bg-emerald-600" onClick={()=> onApply({mode, until:hasta, corridos, habiles, excluirFeriados})}>Aplicar</button>
        </div>
      </div>
    </div>
  );
}

/* ===== Vista del Día ===== */
function DayScreen({ymdKey,data,setData,setEstado,colors,attachSwipe}){
  const [tab,setTab]=useState("guardia"); // guardia | poblacion
  const wrapRef = useRef(null);
  useEffect(()=> setTab("guardia"), [ymdKey]);
  useEffect(()=> attachSwipe(wrapRef.current, ()=> setTab(t=> t==='guardia'?'poblacion':'poblacion')), [wrapRef.current]);

  const P = data.poblacion||{};
  const collapsedSummary = [`Pab: ${data.pabellon||'-'}`, `Pob: ${P.total||'-'}`, `Cond: ${P.condenados||'-'}`, `Proc: ${P.procesados||'-'}`].join(' · ');

  return (
    <div className="flex-1 flex flex-col h-full swipe-zone" ref={wrapRef}>
      {/* Header fijo */}
      <div className="px-3 py-2 border-b border-slate-800 bg-slate-950 sticky top-0 z-10">
        <div className="text-base">{fmtFull.format(parseYMD(ymdKey))}</div>
      </div>

      <div className="flex gap-2 px-3 py-2">
        <button onClick={()=>setTab('guardia')} className={`px-4 py-2 rounded-full text-base ${tab==='guardia'?'bg-sky-600':'bg-slate-800'}`}>Guardia</button>
        <button onClick={()=>setTab('poblacion')} className={`px-4 py-2 rounded-full text-base ${tab==='poblacion'?'bg-sky-600':'bg-slate-800'}`}>Población</button>
      </div>

      <div className="px-3">
        <DetailsPanel
          collapsedText={collapsedSummary}
          body={<GuardHeader data={data} setData={setData}/>}
        />
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        {tab==='guardia'
          ? <MovimientosTable data={data} setData={setData}/>
          : <PoblacionTable data={data} setData={setData}/>
        }
      </div>
    </div>
  );
}

/* Panel plegable */
function DetailsPanel({collapsedText, body}){
  const [open,setOpen]=useState(true);
  return (
    <div className="rounded-xl border border-slate-800 overflow-hidden">
      <button className="w-full text-left px-3 py-2 bg-slate-800/60" onClick={()=>setOpen(o=>!o)}>
        {open ? '▼ Ocultar' : '► Mostrar'} — {collapsedText}
      </button>
      {open && <div className="p-3 bg-slate-900">{body}</div>}
    </div>
  );
}

/* Header de Guardia (solo aquí va el Rol) */
function GuardHeader({data,setData}){
  const P = data.poblacion||{};
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
      <Field label="Pabellón" value={data.pabellon} onChange={e=>setData({pabellon:e.target.value})}/>
      <Field label="Población total" type="number" value={P.total} onChange={e=>setData({poblacion:{...P,total:e.target.value}})}/>
      <Field label="Presentes" type="number" value={P.presentes} onChange={e=>setData({poblacion:{...P,presentes:e.target.value}})}/>
      <Field label="Condenados"