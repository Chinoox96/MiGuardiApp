/* main.js — Vanilla JS (sin JSX) */

// --------- Estado y utilidades ----------
const LS_KEY = "guardias.state.v3";

const state = loadState() || {
  settings: {
    patternEnabled: false,
    patternStart: "",     // YYYY-MM-DD (día de Guardia)
    turno: "B",           // A | B | C (referencial)
    colors: {             // Colores por tipo (no repetir)
      patternGuardiaBg: "#14532d",
      selected: "#38bdf8",
      today: "#10b981",
      guardia: "#0ea5e9",
      recargo: "#f59e0b",
      art: "#a855f7",
      licencia: "#ef4444"
    },
    feriados: []          // YYYY-MM-DD (opcional)
  },
  days: {},               // { "YYYY-MM-DD": {estado, pago, swap, quien, ...}
  autoObj: [              // sugerencias iniciales
    "Reclusión","Recuento Físico","Apertura","Patio Externo",
    "Almuerzo","Cena","Servicio Médico","Abogado/Defensor",
    "Cambio de Alojamiento","Libertad","Ingreso","Talleres"
  ],
  lastSelected: null,     // "YYYY-MM-DD"
};

function saveState(){ localStorage.setItem(LS_KEY, JSON.stringify(state)); }
function loadState(){ try{ return JSON.parse(localStorage.getItem(LS_KEY)||"null"); }catch{ return null; } }

const $ = (sel,root=document)=>root.querySelector(sel);
const $$ = (sel,root=document)=>Array.from(root.querySelectorAll(sel));

function ymd(d){
  const x=new Date(d); x.setHours(0,0,0,0);
  return x.toISOString().slice(0,10);
}
function parseYMD(s){ const [Y,m,d]=s.split("-").map(Number); const x=new Date(Y,m-1,d); x.setHours(0,0,0,0); return x; }
function addDays(d,n){ const x=new Date(d); x.setDate(x.getDate()+n); return x; }
function startOfMonth(d){ return new Date(d.getFullYear(), d.getMonth(), 1); }
function endOfMonth(d){ return new Date(d.getFullYear(), d.getMonth()+1, 0); }
const fmtMonth = new Intl.DateTimeFormat("es-AR", { month:"long", year:"numeric" });
const fmtDay = new Intl.DateTimeFormat("es-AR", { weekday:"long", day:"2-digit", month:"2-digit", year:"numeric" });

// Patrón 24×48 infinito (true si ese día es guardia según patrón)
function isPatternGuardia(date){
  const { patternEnabled, patternStart } = state.settings;
  if(!patternEnabled || !patternStart) return false;
  const diff = Math.floor((parseYMD(ymd(date)) - parseYMD(patternStart))/86400000);
  return diff % 3 === 0;
}

// Obtener/crear datos de día
function getDay(key){
  if(!state.days[key]){
    state.days[key] = {
      key,
      // Estado exclusivo:
      // null | 'recargo' | 'cubro_guardia' | 'me_cubre_guardia' | 'cubro_recargo' | 'me_cubre_recargo' | 'art' | 'licencia'
      estado: null,
      pago: false,            // 💲
      swap: false,            // 🔄 (mutuamente excluyente con pago)
      quien: "",              // para cubro/me cubre
      linkedDate: "",         // fecha espejo si swap
      linkedType: "",         // tipo espejo
      licenciaHasta: "",      // si este día inicia una licencia por rango
      pabellon: "",
      role: "Celador",        // rol sólo editable en pestaña guardia
      companeros: "",
      notas: "",
      poblacion: { total:"", condenados:"", procesados:"", presentes:"", hospitalizados:"" },
      movimientos: [],        // {objeto, entrada, salida, movimiento, a_cargo}
      poblacionListado: []    // {matricula, cp:'C'|'P', nombre}
    };
  }
  return state.days[key];
}
function setDay(key, patch){ state.days[key]=Object.assign(getDay(key), patch); saveState(); }

// ---------- Render raíz ----------
const root = document.getElementById("root") || document.getElementById("app");
let currentMonth = startOfMonth(new Date());
renderApp();

function renderApp(){
  root.innerHTML = `
    <div class="app" style="min-height:100vh;background:#0f172a;color:#e5e7eb;font-family:system-ui,sans-serif;">
      ${renderTopBar()}
      <div id="summary" class="summary" style="padding:6px 12px;border-bottom:1px solid #1f2937;display:none"></div>
      <div id="monthView" class="month"></div>
      <div id="dayView" class="day hidden"></div>
      <div id="notesView" class="hidden"></div>
      <div id="settingsModal" class="hidden"></div>
      <div id="quickModal" class="hidden"></div>
    </div>
  `;
  bindTopBar();
  renderMonth();
  if(state.lastSelected){ showSummary(state.lastSelected); }
}

// ---------- TopBar ----------
function renderTopBar(){
  return `
  <header style="display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid #1f2937;background:#0b1223;position:sticky;top:0;z-index:10">
    <button id="prevBtn" class="btn" style="background:#1f2937;border:none;border-radius:10px;color:#e5e7eb;padding:8px 12px">◀</button>
    <div id="monthTitle" style="text-transform:capitalize;font-weight:600;flex:1;text-align:center">${fmtMonth.format(currentMonth)}</div>
    <button id="nextBtn" class="btn" style="background:#1f2937;border:none;border-radius:10px;color:#e5e7eb;padding:8px 12px">▶</button>
    <button id="notesBtn" class="btn" style="background:#0284c7;border:none;border-radius:10px;color:#fff;padding:8px 12px">Notas</button>
    <button id="settingsBtn" class="btn" style="background:#059669;border:none;border-radius:10px;color:#fff;padding:8px 12px">Ajustes</button>
  </header>`;
}
function bindTopBar(){
  $("#prevBtn").onclick = ()=>{ currentMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth()-1, 1); $("#monthTitle").textContent = fmtMonth.format(currentMonth); renderMonth(); };
  $("#nextBtn").onclick = ()=>{ currentMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth()+1, 1); $("#monthTitle").textContent = fmtMonth.format(currentMonth); renderMonth(); };
  $("#notesBtn").onclick = ()=> alert("Notas (puedo activarte la pantalla si querés)");
  $("#settingsBtn").onclick = openSettings;
}

// ---------- Mes ----------
function renderMonth(){
  const monthEl = $("#monthView");
  const start = startOfMonth(currentMonth);
  const end = endOfMonth(currentMonth);
  const startWeekDay = (start.getDay()+6)%7; // Lunes=0
  const first = addDays(start, -startWeekDay);
  const cells = Array.from({length:42}, (_,i)=>addDays(first,i));

  monthEl.innerHTML = `
    <div class="grid" style="display:grid;grid-template-columns:repeat(7,1fr);gap:6px;padding:10px 10px 16px 10px">
      ${["Lun","Mar","Mié","Jue","Vie","Sáb","Dom"].map(w=>`<div style="text-align:center;color:#94a3b8;font-size:12px">${w}</div>`).join("")}
      ${cells.map(d=>renderMonthCell(d)).join("")}
    </div>
  `;

  // Gestos: tap (selección), doble tap (entrar), long-press (marcar)
  $$("[data-day]").forEach(cell=>{
    const date = new Date(cell.dataset.day);
    let lastTap=0, hold=null;

    cell.addEventListener("click", ()=>{
      const now=Date.now();
      if(now-lastTap<350){ openDay(date); }
      else { selectDay(date); }
      lastTap=now;
    });

    // Long press (0.55s)
    cell.addEventListener("touchstart", ()=>{ hold=setTimeout(()=>{ openQuickModal(ymd(date)); }, 550); }, {passive:true});
    ["touchend","touchcancel"].forEach(evt=> cell.addEventListener(evt, ()=>{ if(hold){clearTimeout(hold); hold=null;} }, {passive:true}));
    // Context menu en desktop
    cell.addEventListener("contextmenu", (e)=>{ e.preventDefault(); openQuickModal(ymd(date)); });
  });
}

function renderMonthCell(date){
  const inMonth = date.getMonth()===currentMonth.getMonth();
  const k = ymd(date);
  const info = getDay(k);
  const colors = state.settings.colors;
  const isToday = ymd(new Date())===k;

  // Color de fondo según estado/patrón
  let bg = inMonth ? "#111827" : "rgba(17,24,39,.35)";
  if(isPatternGuardia(date) && !info.estado) bg = state.settings.colors.patternGuardiaBg;
  if(info.estado){
    const mapCol = {
      guardia: colors.guardia, recargo: colors.recargo,
      art: colors.art, licencia: colors.licencia,
      cubro_guardia: colors.guardia, me_cubre_guardia: colors.guardia,
      cubro_recargo: colors.recargo, me_cubre_recargo: colors.recargo
    };
    bg = mapCol[info.estado] || bg;
  }
  const outline = (state.lastSelected===k) ? `2px solid ${colors.selected}` : "none";
  const ring = isToday ? `inset 0 0 0 2px ${colors.today}` : "none";

  // Pills (solo iconos)
  const pills = [];
  if(info.estado){
    const map = {
      recargo:"R", cubro_guardia:"CG", me_cubre_guardia:"MG",
      cubro_recargo:"CR", me_cubre_recargo:"MR", art:"ART", licencia:"LIC"
    };
    if(map[info.estado]) pills.push(map[info.estado]);
  }
  if(info.pago) pills.push("💲");
  if(info.swap) pills.push("🔄");

  return `
  <button data-day="${k}" style="
    aspect-ratio:1/1;border-radius:12px;padding:6px;display:flex;flex-direction:column;justify-content:space-between;align-items:flex-start;
    background:${bg}; border:none; color:#e5e7eb; box-shadow:${ring}; outline:${outline};">
    <div style="font-size:12px;opacity:.85">${date.getDate().toString().padStart(2,"0")}</div>
    <div style="display:flex;gap:4px;flex-wrap:wrap;width:100%">
      ${pills.map(p=>`<span style="font-size:10px;padding:2px 6px;border-radius:9999px;background:#1f2937">${p}</span>`).join("")}
    </div>
  </button>`;
}

function selectDay(d){
  const k = ymd(d);
  state.lastSelected = k; saveState();
  showSummary(k);
  renderMonth(); // para resaltar selección
}

function showSummary(k){
  const s = $("#summary");
  const d = getDay(k);
  const base = [];
  if(d.estado) base.push(d.estado.toUpperCase());
  if(d.pabellon) base.push(`Pab: ${d.pabellon}`);
  const P = d.poblacion||{};
  if(P.total) base.push(`Pob: ${P.total}`);
  if(P.condenados) base.push(`Cond: ${P.condenados}`);
  if(P.procesados) base.push(`Proc: ${P.procesados}`);
  if(d.companeros) base.push(`Comp: ${d.companeros}`);
  s.textContent = `${k} — ${base.join(" · ")}`;
  s.style.display = base.length ? "block" : "block";
}

// ---------- Día ----------
function openDay(date){
  const k = ymd(date);
  state.lastSelected = k; saveState();
  $("#monthView").classList.add("hidden");
  $("#dayView").classList.remove("hidden");
  renderDay(k);
}

function renderDay(k){
  const d = getDay(k);
  const DV = $("#dayView");
  DV.innerHTML = `
    <div style="display:flex;flex-direction:column;height:calc(100vh - 110px)">
      <!-- Header fijo -->
      <div style="position:sticky;top:48px;background:#0b1223;border-bottom:1px solid #1f2937;z-index:5;padding:10px 12px">
        <div style="font-weight:600">${fmtDay.format(parseYMD(k))}</div>
        <div style="margin-top:8px;display:flex;gap:8px">
          <button id="backMonth" class="btn" style="background:#1f2937;color:#e5e7eb;border:none;border-radius:10px;padding:6px 10px">← Mes</button>
          <button id="tabGuardia" class="btn" style="background:#0284c7;color:#fff;border:none;border-radius:10px;padding:6px 10px">Guardia</button>
          <button id="tabPoblacion" class="btn" style="background:#1f2937;color:#e5e7eb;border:none;border-radius:10px;padding:6px 10px">Población</button>
        </div>
      </div>

      <!-- Contenido -->
      <div id="tabsWrap" style="flex:1;overflow:auto;padding:10px 12px"></div>
    </div>
  `;

  $("#backMonth").onclick = ()=>{ $("#dayView").classList.add("hidden"); $("#monthView").classList.remove("hidden"); };
  $("#tabGuardia").onclick = ()=> renderTabGuardia(k);
  $("#tabPoblacion").onclick = ()=> renderTabPoblacion(k);

  // por defecto abre Guardia
  renderTabGuardia(k);
}

function renderTabGuardia(k){
  const d = getDay(k);
  const wrap = $("#tabsWrap");
  // header plegable (población)
  const P = d.poblacion||{};
  const mini = `Pab: ${d.pabellon||"-"} · Pob total: ${P.total||"-"} · Cond: ${P.condenados||"-"} · Proc: ${P.procesados||"-"}`;
  wrap.innerHTML = `
    <details open class="card" style="background:#111827;border:1px solid #1f2937;border-radius:12px;padding:10px;margin-bottom:12px">
      <summary style="cursor:pointer;list-style:none;display:flex;align-items:center;gap:8px">
        <span style="font-weight:600">Datos de guardia</span>
        <span class="badge" style="font-size:12px;color:#94a3b8">${mini}</span>
      </summary>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:10px">
        ${field("Pabellón","pabellon",d.pabellon)}
        ${field("Población total","p_total",P.total)}
        ${field("Presentes","p_presentes",P.presentes)}
        ${field("Condenados","p_condenados",P.condenados)}
        ${field("Procesados","p_procesados",P.procesados)}
        ${field("Hospitalizados","p_hosp",P.hospitalizados)}
      </div>
      <div style="display:grid;grid-template-columns:1fr;gap:8px;margin-top:10px">
        ${field("Rol (Celador/Auxiliar)","role",d.role)}
        ${field("Acompañado por (coma)","companeros",d.companeros)}
        <label style="display:flex;flex-direction:column;gap:6px">
          <span>Notas</span>
          <textarea id="f_notas" rows="3" style="background:#0b1320;border:1px solid #1f2937;color:#e5e7eb;border-radius:8px;padding:8px">${d.notas||""}</textarea>
        </label>
      </div>
    </details>

    <div class="card" style="background:#111827;border:1px solid #1f2937;border-radius:12px;padding:10px">
      <div style="display:flex;align-items:center;gap:8px;justify-content:space-between">
        <div style="font-weight:600">Novedades / Movimientos</div>
        <button id="addMov" class="btn" style="background:#059669;border:none;border-radius:10px;color:#fff;padding:6px 10px">Agregar fila</button>
      </div>
      <div style="display:grid;grid-template-columns:1.3fr .8fr .8fr 1fr 1fr;gap:6px;margin-top:8px;font-size:12px;color:#94a3b8">
        <div>Objeto</div><div>Entrada</div><div>Salida</div><div>Movimiento</div><div>A cargo de</div>
      </div>
      <div id="movBody" style="max-height:35vh;overflow:auto;margin-top:6px"></div>
    </div>
  `;

  // Bind inputs básicos
  bindInput("#f_pabellon", v=> setDay(k,{pabellon:v}));
  bindInput("#f_p_total", v=> setDay(k,{poblacion:{...P, total:v}}));
  bindInput("#f_p_presentes", v=> setDay(k,{poblacion:{...P, presentes:v}}));
  bindInput("#f_p_condenados", v=> setDay(k,{poblacion:{...P, condenados:v}}));
  bindInput("#f_p_procesados", v=> setDay(k,{poblacion:{...P, procesados:v}}));
  bindInput("#f_p_hosp", v=> setDay(k,{poblacion:{...P, hospitalizados:v}}));
  bindInput("#f_role", v=> setDay(k,{role:v}));
  bindInput("#f_companeros", v=> setDay(k,{companeros:v}));
  $("#f_notas").oninput = (e)=> setDay(k,{notas:e.target.value});

  // Movimientos
  renderMovimientos(k);
  $("#addMov").onclick = ()=> {
    const arr = getDay(k).movimientos;
    arr.push({objeto:"", entrada:suggestHour(), salida:"", movimiento:"", a_cargo:""});
    setDay(k,{movimientos:arr}); renderMovimientos(k);
  };
}

function field(label,id,value){
  return `
  <label style="display:flex;flex-direction:column;gap:6px">
    <span>${label}</span>
    <input id="f_${id}" value="${value??""}" style="background:#0b1320;border:1px solid #1f2937;color:#e5e7eb;border-radius:8px;padding:8px"/>
  </label>`;
}
function bindInput(sel, fn){ const el=$(sel); if(el) el.oninput=(e)=>fn(e.target.value); }

function renderMovimientos(k){
  const body = $("#movBody");
  const arr = getDay(k).movimientos;
  body.innerHTML = arr.map((r,i)=> movRow(k,i,r)).join("");
  // bind eventos de cada fila
  arr.forEach((_,i)=> bindMovRow(k,i));
}
function movRow(k,i,r){
  return `
  <div style="display:grid;grid-template-columns:1.3fr .8fr .8fr 1fr 1fr;gap:6px;margin-bottom:6px">
    ${autoInput(`m_obj_${i}`, r.objeto, "Objeto")}
    <input id="m_in_${i}" value="${r.entrada||""}" placeholder="hh:mm" style="background:#0b1320;border:1px solid #1f2937;color:#e5e7eb;border-radius:8px;padding:8px"/>
    <input id="m_out_${i}" value="${r.salida||""}" placeholder="hh:mm" style="background:#0b1320;border:1px solid #1f2937;color:#e5e7eb;border-radius:8px;padding:8px"/>
    <input id="m_mov_${i}" value="${r.movimiento||""}" placeholder="Detalle" style="background:#0b1320;border:1px solid #1f2937;color:#e5e7eb;border-radius:8px;padding:8px"/>
    <div style="display:flex;gap:6px">
      <input id="m_cargo_${i}" value="${r.a_cargo||""}" placeholder="Apellido" style="flex:1;background:#0b1320;border:1px solid #1f2937;color:#e5e7eb;border-radius:8px;padding:8px"/>
      <button id="m_del_${i}" class="btn" style="background:#ef4444;border:none;border-radius:10px;color:#fff;padding:6px 10px">✕</button>
    </div>
  </div>`;
}
function bindMovRow(k,i){
  const d = getDay(k);
  const arr = d.movimientos;

  // Autocomplete objeto
  bindAutocomplete(`#m_obj_${i}`, val=>{
    arr[i].objeto = val;
    // guardar nuevas sugerencias
    if(val && !state.autoObj.includes(val)) state.autoObj.push(val), saveState();
    setDay(k,{movimientos:arr});
  });

  $("#m_in_"+i).onfocus = e=>{ if(!e.target.value) e.target.value = suggestHour(); };
  $("#m_in_"+i).oninput = e=>{ arr[i].entrada = e.target.value; setDay(k,{movimientos:arr}); };
  $("#m_out_"+i).oninput = e=>{ arr[i].salida = e.target.value; setDay(k,{movimientos:arr}); };
  $("#m_mov_"+i).oninput = e=>{ arr[i].movimiento = e.target.value; setDay(k,{movimientos:arr}); };
  $("#m_cargo_"+i).oninput = e=>{ arr[i].a_cargo = e.target.value; setDay(k,{movimientos:arr}); };
  $("#m_del_"+i).onclick = ()=>{ arr.splice(i,1); setDay(k,{movimientos:arr}); renderMovimientos(k); };
}
function autoInput(id, value, ph){
  // caja con lista flotante
  return `
  <div style="position:relative">
    <input id="${id}" value="${value||""}" placeholder="${ph||""}"
      style="background:#0b1320;border:1px solid #1f2937;color:#e5e7eb;border-radius:8px;padding:8px;width:100%"/>
    <div id="${id}_list" style="display:none;position:absolute;top:100%;left:0;right:0;background:#0b1320;border:1px solid #1f2937;border-radius:8px;max-height:200px;overflow:auto;z-index:20"></div>
  </div>`;
}
function bindAutocomplete(sel, onPick){
  const input = $(sel), list = $(sel+"_list");
  input.oninput = ()=>{
    const v = input.value.toLowerCase();
    if(!v){ list.style.display="none"; return; }
    const items = state.autoObj.filter(s=> s.toLowerCase().includes(v));
    list.innerHTML = items.map(s=>`<div data-val="${s}" style="padding:8px;cursor:pointer">${s}</div>`).join("");
    list.style.display = items.length ? "block" : "none";
    list.onclick = (e)=>{ const val=e.target.dataset.val; if(val){ input.value=val; list.style.display="none"; onPick(val); } };
  };
  input.onchange = ()=> onPick(input.value);
}

function suggestHour(){
  const d = new Date();
  const hh = String(d.getHours()).padStart(2,"0");
  const mm = String(d.getMinutes()).padStart(2,"0");
  return `${hh}:${mm}`;
}

// --- Población
function renderTabPoblacion(k){
  const d = getDay(k);
  const wrap = $("#tabsWrap");
  wrap.innerHTML = `
    <div class="card" style="background:#111827;border:1px solid #1f2937;border-radius:12px;padding:10px">
      <div style="display:grid;grid-template-columns:0.9fr 0.6fr 1.6fr;gap:6px;margin-bottom:8px;font-size:12px;color:#94a3b8">
        <div>Matrícula</div><div>C/P</div><div>Apellido y Nombre</div>
      </div>
      <div id="pobBody"></div>
      <div style="display:flex;justify-content:flex-end;margin-top:8px">
        <button id="addPob" class="btn" style="background:#059669;border:none;border-radius:10px;color:#fff;padding:6px 10px">Agregar fila</button>
      </div>
      <div id="pobWarn" style="margin-top:8px;color:#f59e0b;display:none"></div>
    </div>
  `;
  renderPoblacion(k);
  $("#addPob").onclick = ()=>{ const arr=getDay(k).poblacionListado; arr.push({matricula:"", cp:"", nombre:""}); setDay(k,{poblacionListado:arr}); renderPoblacion(k); };
}
function renderPoblacion(k){
  const body = $("#pobBody");
  const d = getDay(k);
  const arr = d.poblacionListado;
  body.innerHTML = arr.map((r,i)=>`
    <div style="display:grid;grid-template-columns:0.9fr 0.6fr 1.6fr;gap:6px;margin-bottom:6px">
      <input id="pb_m_${i}" value="${r.matricula||""}" placeholder="000123" style="background:#0b1320;border:1px solid #1f2937;color:#e5e7eb;border-radius:8px;padding:8px"/>
      <input id="pb_cp_${i}" value="${r.cp||""}" placeholder="C o P" maxlength="1" style="text-transform:uppercase;background:#0b1320;border:1px solid #1f2937;color:#e5e7eb;border-radius:8px;padding:8px"/>
      <div style="display:flex;gap:6px">
        <input id="pb_n_${i}" value="${r.nombre||""}" placeholder="Apellido, Nombre" style="flex:1;background:#0b1320;border:1px solid #1f2937;color:#e5e7eb;border-radius:8px;padding:8px"/>
        <button id="pb_del_${i}" class="btn" style="background:#ef4444;border:none;border-radius:10px;color:#fff;padding:6px 10px">✕</button>
      </div>
    </div>
  `).join("");

  arr.forEach((_,i)=>{
    $("#pb_m_"+i).oninput = e=>{ arr[i].matricula=e.target.value; setDay(k,{poblacionListado:arr}); };
    $("#pb_cp_"+i).oninput = e=>{ arr[i].cp=(e.target.value||"").toUpperCase(); setDay(k,{poblacionListado:arr}); checkPoblacionCounts(k); };
    $("#pb_n_"+i).oninput = e=>{ arr[i].nombre=e.target.value; setDay(k,{poblacionListado:arr}); };
    $("#pb_del_"+i).onclick = ()=>{ arr.splice(i,1); setDay(k,{poblacionListado:arr}); renderPoblacion(k); checkPoblacionCounts(k); };
  });

  checkPoblacionCounts(k);
}
function checkPoblacionCounts(k){
  const d = getDay(k);
  const P = d.poblacion||{};
  const arr = d.poblacionListado;
  const cond = arr.filter(x=>x.cp==="C").length;
  const proc = arr.filter(x=>x.cp==="P").length;
  const warn = $("#pobWarn");
  let msgs = [];
  if(P.condenados && Number(P.condenados)!==cond) msgs.push(`Condenados listados (${cond}) ≠ ${P.condenados}`);
  if(P.procesados && Number(P.procesados)!==proc) msgs.push(`Procesados listados (${proc}) ≠ ${P.procesados}`);
  warn.textContent = msgs.join(" · ");
  warn.style.display = msgs.length? "block": "none";
}

// ---------- Quick Modal (estado del día) ----------
function openQuickModal(k){
  const d = getDay(k);
  const Q = $("#quickModal");
  Q.classList.remove("hidden");
  Q.innerHTML = `
    <div class="modal-backdrop" style="position:fixed;inset:0;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;padding:12px" onclick="this.innerHTML='';this.classList.add('hidden')">
      <div class="modal-card" style="background:#0b1220;border:1px solid #1f2937;border-radius:16px;color:#e5e7eb;padding:14px;max-width:480px;width:100%" onclick="event.stopPropagation()">
        <div style="font-size:13px;opacity:.8;margin-bottom:8px">${k}</div>
        <div style="display:grid;gap:8px">
          ${selectEstado(d.estado)}
          ${d.estado && !["recargo","art","licencia"].includes(d.estado) ? `<input id="q_quien" value="${d.quien||""}" placeholder="Apellido/Nombre" style="background:#0b1320;border:1px solid #1f2937;color:#e5e7eb;border-radius:8px;padding:8px"/>` : ""}
          <div style="display:flex;gap:12px;align-items:center">
            <label style="display:flex;gap:6px;align-items:center"><input id="q_pago" type="checkbox" ${d.pago&& !d.swap?"checked":""}/> 💲</label>
            <label style="display:flex;gap:6px;align-items:center"><input id="q_swap" type="checkbox" ${d.swap&& !d.pago?"checked":""}/> 🔄</label>
            <input id="q_link" type="date" value="${d.linkedDate||""}" style="background:#0b1320;border:1px solid #1f2937;color:#e5e7eb;border-radius:8px;padding:8px;${d.swap?'':'display:none'}"/>
          </div>

          <!-- Licencia: rango -->
          <div id="licBox" style="${d.estado==='licencia'?'':'display:none'};border-top:1px solid #1f2937;padding-top:8px">
            <div style="display:grid;gap:8px">
              <label style="display:flex;gap:6px;align-items:center">Hasta (fecha): <input id="lic_hasta" type="date" value="${d.licenciaHasta||""}" style="background:#0b1320;border:1px solid #1f2937;color:#e5e7eb;border-radius:8px;padding:6px"/></label>
              <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px">
                <input id="lic_corr" type="number" min="0" placeholder="Días corridos" style="background:#0b1320;border:1px solid #1f2937;color:#e5e7eb;border-radius:8px;padding:6px"/>
                <input id="lic_hab" type="number" min="0" placeholder="Días hábiles" style="background:#0b1320;border:1px solid #1f2937;color:#e5e7eb;border-radius:8px;padding:6px"/>
                <label style="display:flex;gap:6px;align-items:center"><input id="lic_excl_fer" type="checkbox"/> Excluir feriados</label>
              </div>
              <div style="font-size:12px;color:#94a3b8">Usá "Hasta" o calculá con corridos/hábiles (desde ${k}). Si marcás hábiles y “Excluir feriados”, no contará sáb-dom ni fechas en Ajustes → Feriados.</div>
            </div>
          </div>

          <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:8px">
            <button id="q_cancel" class="btn" style="background:#1f2937;color:#e5e7eb;border:none;border-radius:10px;padding:6px 10px">Cancelar</button>
            <button id="q_ok" class="btn" style="background:#059669;color:#fff;border:none;border-radius:10px;padding:6px 10px">Guardar</button>
          </div>
        </div>
      </div>
    </div>
  `;

  // lógica de UI
  const tipoSel = $("#q_tipo");
  tipoSel.onchange = ()=>{
    const v = tipoSel.value;
    $("#licBox").style.display = (v==="licencia") ? "block":"none";
    $("#q_quien") && ($("#q_quien").parentElement.style.display = ["recargo","art","licencia"].includes(v) ? "none":"block");
  };

  const pago = $("#q_pago"), swap=$("#q_swap");
  pago.onchange = ()=>{ if(pago.checked) swap.checked=false; };
  swap.onchange = ()=>{ if(swap.checked) pago.checked=false; $("#q_link").style.display = swap.checked? "inline-block":"none"; };

  $("#q_cancel").onclick = ()=>{ Q.classList.add("hidden"); Q.innerHTML=""; };
  $("#q_ok").onclick = ()=>{
    // guardar
    const estado = $("#q_tipo").value || null;
    const quien = $("#q_quien") ? $("#q_quien").value : "";
    const isPago = pago.checked, isSwap = swap.checked && !isPago;
    const link = $("#q_link") ? $("#q_link").value : "";

    // espejo si swap
    if(isSwap && link){
      const tipoEsp = mirrorType(estado);
      if(tipoEsp){
        const od = getDay(link);
        Object.assign(od, { estado: tipoEsp, pago:isPago, swap:true, linkedDate:k, linkedType:estado });
        saveState();
      }
    }

    // Licencia por rango
    if(estado==="licencia"){
      const hasta = $("#lic_hasta").value;
      const corr = Number($("#lic_corr").value||0);
      const hab = Number($("#lic_hab").value||0);
      const exclF = $("#lic_excl_fer").checked;
      aplicarLicenciaRango(k, {hasta,corr,hab,exclF});
    }

    const item = getDay(k);
    Object.assign(item, { estado, quien, pago:isPago, swap:isSwap, linkedDate:link, linkedType:estado, licenciaHasta: (estado==='licencia' ? ($("#lic_hasta").value||"") : "") });
    saveState();
    $("#quickModal").classList.add("hidden"); $("#quickModal").innerHTML="";
    renderMonth(); showSummary(k);
  };
}

function selectEstado(actual){
  // incluye ART y LICENCIA en las opciones exclusivas
  const opts = [
    ["","(sin estado)"],
    ["recargo","Recargo"],
    ["cubro_guardia","Cubro guardia a…"],
    ["me_cubre_guardia","Me cubre guardia…"],
    ["cubro_recargo","Cubro recargo a…"],
    ["me_cubre_recargo","Me cubre recargo…"],
    ["art","ART Nº"],
    ["licencia","Licencia"]
  ];
  return `
  <label style="display:flex;flex-direction:column;gap:6px">
    <span>Estado del día</span>
    <select id="q_tipo" style="background:#0b1320;border:1px solid #1f2937;color:#e5e7eb;border-radius:8px;padding:8px">
      ${opts.map(([v,t])=>`<option value="${v}" ${v===actual?"selected":""}>${t}</option>`).join("")}
    </select>
  </label>`;
}
function mirrorType(t){
  if(t==='cubro_guardia') return 'me_cubre_guardia';
  if(t==='me_cubre_guardia') return 'cubro_guardia';
  if(t==='cubro_recargo') return 'me_cubre_recargo';
  if(t==='me_cubre_recargo') return 'cubro_recargo';
  return null;
}

function aplicarLicenciaRango(desdeKey, {hasta,corr,hab,exclF}){
  const desde = parseYMD(desdeKey);
  let fechas = [];

  if(hasta){
    let d = new Date(desde);
    const end = parseYMD(hasta);
    while(d <= end){ fechas.push(ymd(d)); d = addDays(d,1); }
  }else{
    // corridos primero
    let d = new Date(desde);
    for(let i=0;i<corr;i++){ fechas.push(ymd(d)); d=addDays(d,1); }
    // hábiles
    const feriados = new Set(state.settings.feriados || []);
    for(let i=0,c=0;c<hab;i++){
      const key = ymd(d);
      const isWeekend = [0,6].includes(d.getDay());
      const isHoliday = feriados.has(key);
      if(!(exclF && (isWeekend || isHoliday))){ fechas.push(key); c++; }
      d = addDays(d,1);
    }
  }
  // asignar
  fechas.forEach(fk=>{
    const dd = getDay(fk);
    Object.assign(dd, { estado:"licencia", pago:false, swap:false, quien:"", linkedDate:"", linkedType:"" });
  });
  saveState();
}

// ---------- Ajustes ----------
function openSettings(){
  const S = $("#settingsModal");
  const st = state.settings;
  S.classList.remove("hidden");
  S.innerHTML = `
    <div class="modal-backdrop" style="position:fixed;inset:0;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;padding:12px" onclick="this.innerHTML='';this.classList.add('hidden')">
      <div class="modal-card" style="background:#0b1220;border:1px solid #1f2937;border-radius:16px;color:#e5e7eb;padding:16px;max-width:560px;width:100%" onclick="event.stopPropagation()">
        <div style="font-weight:600;margin-bottom:8px">Ajustes</div>

        <div class="card" style="background:#111827;border:1px solid #1f2937;border-radius:12px;padding:10px;margin-bottom:12px">
          <div style="font-weight:600;margin-bottom:8px">Patrón 24×48</div>
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px">
            <label style="display:flex;flex-direction:column;gap:6px">
              <span>Inicio (día de Guardia)</span>
              <input id="s_start" type="date" value="${st.patternStart||""}" style="background:#0b1320;border:1px solid #1f2937;color:#e5e7eb;border-radius:8px;padding:8px"/>
            </label>
            <label style="display:flex;flex-direction:column;gap:6px">
              <span>Turno</span>
              <select id="s_turno" style="background:#0b1320;border:1px solid #1f2937;color:#e5e7eb;border-radius:8px;padding:8px">
                <option ${st.turno==="A"?"selected":""}>A</option>
                <option ${st.turno==="B"?"selected":""}>B</option>
                <option ${st.turno==="C"?"selected":""}>C</option>
              </select>
            </label>
            <label style="display:flex;flex-direction:column;gap:6px">
              <span>Patrón</span>
              <select id="s_enabled" style="background:#0b1320;border:1px solid #1f2937;color:#e5e7eb;border-radius:8px;padding:8px">
                <option value="true" ${st.patternEnabled?"selected":""}>ON</option>
                <option value="false" ${!st.patternEnabled?"selected":""}>OFF</option>
              </select>
            </label>
          </div>
          <div style="font-size:12px;color:#94a3b8;margin-top:6px">El inicio marca Guardia y luego 2 francos, repetido sin fin.</div>
        </div>

        <div class="card" style="background:#111827;border:1px solid #1f2937;border-radius:12px;padding:10px;margin-bottom:12px">
          <div style="font-weight:600;margin-bottom:8px">Colores (evitar duplicados)</div>
          ${colorField("Días patrón (sin estado)", "patternGuardiaBg", st.colors.patternGuardiaBg)}
          ${colorField("Seleccionado", "selected", st.colors.selected)}
          ${colorField("Hoy", "today", st.colors.today)}
          ${colorField("Guardia/CG/MG", "guardia", st.colors.guardia)}
          ${colorField("Recargo/CR/MR", "recargo", st.colors.recargo)}
          ${colorField("ART", "art", st.colors.art)}
          ${colorField("Licencia", "licencia", st.colors.licencia)}
        </div>

        <div class="card" style="background:#111827;border:1px solid #1f2937;border-radius:12px;padding:10px;margin-bottom:12px">
          <div style="font-weight:600;margin-bottom:8px">Feriados (YYYY-MM-DD)</div>
          <div id="ferWrap"></div>
          <div style="display:flex;gap:8px;margin-top:8px">
            <input id="ferNew" placeholder="2025-12-08" style="flex:1;background:#0b1320;border:1px solid #1f2937;color:#e5e7eb;border-radius:8px;padding:8px"/>
            <button id="ferAdd" class="btn" style="background:#059669;color:#fff;border:none;border-radius:10px;padding:6px 10px">Agregar</button>
          </div>
        </div>

        <div style="display:flex;justify-content:flex-end;gap:8px">
          <button id="s_close" class="btn" style="background:#1f2937;color:#e5e7eb;border:none;border-radius:10px;padding:6px 10px">Cerrar</button>
          <button id="s_save" class="btn" style="background:#059669;color:#fff;border:none;border-radius:10px;padding:6px 10px">Guardar</button>
        </div>
      </div>
    </div>
  `;

  renderFeriadosList();

  $("#ferAdd").onclick = ()=>{
    const v = $("#ferNew").value.trim();
    if(v && !state.settings.feriados.includes(v)){ state.settings.feriados.push(v); saveState(); renderFeriadosList(); $("#ferNew").value=""; }
  };

  $("#s_close").onclick = ()=>{ S.classList.add("hidden"); S.innerHTML=""; };
  $("#s_save").onclick = ()=>{
    const start = $("#s_start").value;
    const turno = $("#s_turno").value;
    const enabled = $("#s_enabled").value==="true";

    // Colores no repetidos (simple check)
    const c = {};
    $$("#settingsModal input[type=color]").forEach(el=>{
      if(Object.values(c).includes(el.value)){ alert("Elegí colores distintos."); return; }
      c[el.dataset.key]=el.value;
    });

    Object.assign(state.settings, {
      patternStart: start, turno, patternEnabled: enabled, colors: {...state.settings.colors, ...c}
    });
    saveState();
    $("#settingsModal").classList.add("hidden"); $("#settingsModal").innerHTML="";
    $("#monthTitle").textContent = fmtMonth.format(currentMonth);
    renderMonth();
  };
}
function colorField(label,key,val){
  return `
  <label style="display:flex;align-items:center;gap:10px;margin:6px 0">
    <span style="width:220px">${label}</span>
    <input type="color" data-key="${key}" value="${val}" />
    <span style="font-size:12px;color:#94a3b8">${val}</span>
  </label>`;
}
function renderFeriadosList(){
  const wrap = $("#ferWrap");
  wrap.innerHTML = (state.settings.feriados||[]).map((f,i)=>`
    <div style="display:flex;align-items:center;gap:8px;margin:4px 0">
      <div style="flex:1">${f}</div>
      <button data-del="${i}" class="btn" style="background:#ef4444;color:#fff;border:none;border-radius:10px;padding:4px 8px">✕</button>
    </div>
  `).join("") || `<div style="font-size:12px;color:#94a3b8">Sin feriados.</div>`;
  $$("[data-del]").forEach(btn=> btn.onclick = ()=>{ const i=Number(btn.dataset.del); state.settings.feriados.splice(i,1); saveState(); renderFeriadosList(); });
}

// ---------- PWA SW ----------
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js")
      .then(reg => console.log("SW registrado", reg.scope))
      .catch(err => console.error("Error SW", err));
  });
}