const https = require('https');
const http = require('http');
const fs = require('fs');

// ══════════════════════════════════════
// CONFIG
// ══════════════════════════════════════
const TOKEN = process.env.BOT_TOKEN || '8868834232:AAFS63UfIOVVqWv9IT3tlg3bKL5xUokoxHY';
const API = `https://api.telegram.org/bot${TOKEN}`;
const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycby0RIPOqvAKS-4dKMGo90-0s0XOUNp2vysGDdqCdXHDIRRKE-aDI7XE3rQ6FSFoOtkF/exec';
const ACCESS_KEY = 'Claveincorrecta20!';

const SHEETS = {
  ingresos:  SCRIPT_URL + '?sheet=Ingresos',
  resumen:   SCRIPT_URL + '?sheet=Resumen',
  equipo:    SCRIPT_URL + '?sheet=Equipo',
  nomina:    SCRIPT_URL + '?sheet=Nomina',
  targets:   SCRIPT_URL + '?sheet=Targets',
  dashboard: SCRIPT_URL + '?sheet=Dashboard',
};

const EQUIPOS = ['Aurum House','PE','EC','CR','Corm','Orbex','Seul'];
const EMOJIS  = {'Aurum House':'👑','PE':'💎','EC':'🚀','CR':'💹','Corm':'⚡','Orbex':'🔥','Seul':'💰'};
const MESES   = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];

// ══════════════════════════════════════
// AUTH
// ══════════════════════════════════════
const AUTH_FILE = '/tmp/aurum_auth.json';
let authorizedUsers = new Set();
try { authorizedUsers = new Set(JSON.parse(fs.readFileSync(AUTH_FILE,'utf8'))); } catch(e) {}
function saveAuth(){ try{ fs.writeFileSync(AUTH_FILE, JSON.stringify([...authorizedUsers])); }catch(e){} }
function isAuth(id){ return authorizedUsers.has(String(id)); }
function addAuth(id){ authorizedUsers.add(String(id)); saveAuth(); }

// ══════════════════════════════════════
// STATE
// ══════════════════════════════════════
const userState = {};

// ══════════════════════════════════════
// CACHE
// ══════════════════════════════════════
let cache = { data: null, ts: 0 };

// ══════════════════════════════════════
// HELPERS
// ══════════════════════════════════════
function parseMoney(s){
  if(typeof s === 'number') return s;
  if(!s) return 0;
  return parseFloat(String(s).replace(/[$,\s]/g,''))||0;
}
function parseStr(s){
  if(s===null||s===undefined) return '';
  if(s instanceof Date) return s.toLocaleDateString('es-ES');
  return String(s).trim();
}
function fmt(n){
  if(isNaN(n)) return '$0.00';
  const abs = Math.abs(n);
  const str = '$'+abs.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
  return n<0?'-'+str:str;
}
function progBar(pct,len=10){
  const f=Math.round(Math.min(pct,100)/100*len);
  return '█'.repeat(f)+'░'.repeat(len-f);
}
function norm(s){ return (s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim(); }
function normEq(e){
  const map={'aurum house':'Aurum House','pe':'PE','ec':'EC','cr':'CR','corm':'Corm','seul':'Seul','orbex':'Orbex'};
  return map[(e||'').toLowerCase().trim()]||(e||'').trim();
}
function getMesActual(data){
  const mesNombre = MESES[new Date().getMonth()];
  const year = String(new Date().getFullYear());
  const meses = [...new Set(data.map(r=>(r['Mes']||'').toLowerCase().trim()))].filter(Boolean);
  return meses.find(m=>m.includes(mesNombre)&&m.includes(year))
    ||meses.find(m=>m.includes(mesNombre))
    ||meses[meses.length-1]||mesNombre+' '+year;
}

// ══════════════════════════════════════
// FETCH
// ══════════════════════════════════════
async function fetchJSON(url, retries=3){
  for(let i=0; i<retries; i++){
    try{
      const result = await new Promise((resolve,reject)=>{
        https.get(url,(res)=>{
          if(res.statusCode>=300&&res.statusCode<400&&res.headers.location)
            return fetchJSON(res.headers.location,1).then(resolve).catch(reject);
          let data='';
          res.on('data',c=>data+=c);
          res.on('end',()=>{ try{resolve(JSON.parse(data));}catch(e){resolve([]);} });
        }).on('error',reject);
      });
      if(result&&result.length>0) return result;
      if(i<retries-1){ console.log(`Retry ${i+1} for ${url}`); await new Promise(r=>setTimeout(r,2000)); }
    }catch(e){
      console.error(`Fetch error attempt ${i+1}:`,e.message);
      if(i<retries-1) await new Promise(r=>setTimeout(r,2000));
    }
  }
  return [];
}

async function getData(){
  const now=Date.now();
  if(cache.data&&now-cache.ts<3*60*1000) return cache.data;
  try{
    const [ing,res,eq,nom,tgt,dash]=await Promise.all([
      fetchJSON(SHEETS.ingresos),
      fetchJSON(SHEETS.resumen),
      fetchJSON(SHEETS.equipo),
      fetchJSON(SHEETS.nomina),
      fetchJSON(SHEETS.targets),
      fetchJSON(SHEETS.dashboard),
    ]);
    ing.forEach(r=>{
      r._v=parseMoney(r['Valor Neto']);
      r['Equipo']=normEq(parseStr(r['Equipo']));
      r['Agente']=parseStr(r['Agente']);
      r['Team Leader']=parseStr(r['Team Leader']);
      r['Mes']=parseStr(r['Mes']);
    });
    nom.forEach(r=>{
      r._tot=parseMoney(r['Sueldo Total']);
      r._com=parseMoney(r['Comision']);
      r['Equipo']=normEq(parseStr(r['Equipo']));
      r['Nombre']=parseStr(r['Nombre']);
      r['Rol']=parseStr(r['Rol']);
    });
    tgt.forEach(r=>{
      r._tgt=parseMoney(r['Target']);
      r['Equipo']=normEq(parseStr(r['Equipo']));
      r['Nombre']=parseStr(r['Nombre']);
      let m=parseStr(r['Mes']);
      r['Mes']=m.replace(/(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)(\d{2})$/i,(_,mon,yr)=>mon+' 20'+yr);
    });
    res.forEach(r=>{
      r._ing=parseMoney(r['Ingresos mes']);
      r._meta=parseMoney(r['Meta']);
      r['Equipo']=normEq(parseStr(r['Equipo']));
    });
    cache={data:{ing,res,eq,nom,tgt,dash},ts:now};
    return cache.data;
  }catch(e){
    console.error('Error fetching:',e.message);
    return cache.data||{ing:[],res:[],eq:[],nom:[],tgt:[]};
  }
}

// ══════════════════════════════════════
// MENUS
// ══════════════════════════════════════
function getMesLabel(state){
  if(state&&state.mes) return `${state.mes} ${state.mesYear||new Date().getFullYear()}`;
  return `${MESES[new Date().getMonth()]} ${new Date().getFullYear()}`;
}

async function sendMainMenu(chatId){
  const mesLabel = getMesLabel(userState[chatId]);
  const buttons = EQUIPOS.map(eq=>[{text:`${EMOJIS[eq]} ${eq}`,callback_data:`eq:${eq}`}]);
  buttons.push([{text:`⚡ Dashboard Total`,callback_data:`acc:dashboard`}]);
  buttons.push([{text:`📅 Cambiar mes (${mesLabel})`,callback_data:`main:mes`}]);
  return sendMessage(chatId,'🏢 *Selecciona un equipo o acción:*',{reply_markup:{inline_keyboard:buttons}});
}

async function sendAccionMenu(chatId,equipo){
  const mesLabel = getMesLabel(userState[chatId]);
  return sendMessage(chatId,`${EMOJIS[equipo]||'🏢'} *${equipo}*\n📅 _${mesLabel}_\n\n¿Qué información quieres ver?`,{
    reply_markup:{inline_keyboard:[
      [{text:'💰 Ingresos',callback_data:'acc:ingresos'}],
      [{text:'🎯 Targets',callback_data:'acc:targets'}],
      [{text:'💳 Nómina',callback_data:'acc:nomina'}],
      [{text:'📊 Resumen General',callback_data:'acc:resumen'}],
      [{text:'◀️ Volver',callback_data:'main:back'}],
    ]}
  });
}

async function sendMesMenu(chatId,returnTo){
  const year=new Date().getFullYear();
  const mesActual=new Date().getMonth();
  const buttons=[];
  for(let i=0;i<=5;i++){
    let idx=mesActual-i; let yr=year;
    if(idx<0){idx+=12;yr--;}
    buttons.push([{text:`📅 ${MESES[idx]} ${yr}`,callback_data:`mes:${MESES[idx]}:${yr}:${returnTo}`}]);
  }
  buttons.push([{text:'◀️ Volver',callback_data:`main:back`}]);
  return sendMessage(chatId,'📅 *Selecciona el mes:*',{reply_markup:{inline_keyboard:buttons}});
}

// ══════════════════════════════════════
// RESPUESTAS
// ══════════════════════════════════════
function getMesFiltro(state){
  return state&&state.mes ? state.mes : MESES[new Date().getMonth()];
}

async function responderIngresos(equipo,state){
  const {ing}=await getData();
  const mes=getMesFiltro(state);
  // Debug: ver qué meses existen en los datos
  const mesesUnicos=[...new Set(ing.map(r=>(r['Mes']||'').toLowerCase().trim()))].filter(Boolean);
  const equiposUnicos=[...new Set(ing.map(r=>r['Equipo']))].filter(Boolean);
  console.log('Meses en datos:',mesesUnicos);
  console.log('Equipos en datos:',equiposUnicos);
  console.log('Buscando mes:',mes,'equipo:',equipo);
  const data=ing.filter(r=>r['Equipo']===equipo&&(r['Mes']||'').toLowerCase().includes(mes));
  console.log('Filas encontradas:',data.length);
  if(!data.length) return `❌ No hay ingresos para *${equipo}* en ${mes}.

_Debug: meses disponibles: ${mesesUnicos.join(', ')}_`;
  const total=data.reduce((a,r)=>a+r._v,0);
  const byAg={};
  data.forEach(r=>{byAg[r['Agente']]=(byAg[r['Agente']]||0)+r._v;});
  const ranking=Object.entries(byAg).sort((a,b)=>b[1]-a[1]);
  let msg=`${EMOJIS[equipo]||'🏢'} *${equipo} — Ingresos*\n📅 _${mes}_\n━━━━━━━━━━━━━━━━━━━\n`;
  msg+=`💰 *Total: ${fmt(total)}*\n📊 Transacciones: ${data.length}\n📈 Promedio: ${fmt(total/data.length)}\n\n🏆 *Ranking:*\n`;
  ranking.forEach(([name,val],i)=>{
    const medal=i===0?'🥇':i===1?'🥈':i===2?'🥉':`${i+1}.`;
    msg+=`${medal} ${name}: *${fmt(val)}*\n`;
  });
  return msg;
}

async function responderTargets(equipo,state){
  const {tgt,ing}=await getData();
  const mes=getMesFiltro(state);
  const data=tgt.filter(r=>norm(r['Equipo'])===norm(equipo)&&(r['Mes']||'').toLowerCase().includes(mes)&&r._tgt>0);
  if(!data.length) return `❌ No hay targets para *${equipo}* en ${mes}.`;
  const ingByAg={};
  ing.filter(r=>r['Equipo']===equipo&&(r['Mes']||'').toLowerCase().includes(mes))
     .forEach(r=>{const n=norm(r['Agente']);ingByAg[n]=(ingByAg[n]||0)+r._v;});
  const getIng=name=>{
    const k=norm(name);
    if(ingByAg[k]!==undefined) return ingByAg[k];
    const ex=Object.entries(ingByAg).find(([kk])=>norm(kk)===k);
    if(ex) return ex[1];
    const words=k.split(' ').filter(w=>w.length>2);
    if(words.length>=2){
      const f=Object.entries(ingByAg).find(([kk])=>words.every(w=>norm(kk).includes(w)));
      if(f) return f[1];
      const fz=Object.entries(ingByAg).find(([kk])=>{
        const kn=norm(kk).split(' ').filter(w=>w.length>2);
        return kn[0]===words[0]&&words.slice(1).some(w=>kn.some(kw=>kw.startsWith(w.slice(0,4))));
      });
      if(fz) return fz[1];
    }
    return 0;
  };
  let msg=`${EMOJIS[equipo]||'🏢'} *${equipo} — Targets*\n📅 _${mes}_\n━━━━━━━━━━━━━━━━━━━\n`;
  data.forEach(r=>{
    const real=getIng(r['Nombre']);
    const pct=Math.min(200,real/r._tgt*100);
    const estado=pct>=100?'✅':pct>=60?'⚠️':'🔴';
    msg+=`\n${estado} *${r['Nombre']}*\n   Meta: ${fmt(r._tgt)}\n   Logrado: ${fmt(real)}\n   ${progBar(pct)} ${pct.toFixed(0)}%\n`;
  });
  return msg;
}

async function responderNomina(equipo,state){
  const {nom,ing}=await getData();
  const mes=getMesFiltro(state);
  const data=nom.filter(r=>r['Equipo']===equipo&&r['Nombre']);
  if(!data.length) return `❌ No hay datos de nómina para *${equipo}*.`;
  const totalNom=data.reduce((a,r)=>a+r._tot,0);
  const totalIng=ing.filter(r=>r['Equipo']===equipo&&(r['Mes']||'').toLowerCase().includes(mes)).reduce((a,r)=>a+r._v,0);
  const balance=totalIng-totalNom;
  let msg=`${EMOJIS[equipo]||'🏢'} *${equipo} — Nómina*\n━━━━━━━━━━━━━━━━━━━\n`;
  msg+=`💳 *Total nómina: ${fmt(totalNom)}*\n💰 Ingresos: ${fmt(totalIng)}\n${balance>=0?'✅':'🔴'} Balance: *${balance>=0?'+':''}${fmt(balance)}*\n\n👥 *Detalle:*\n`;
  data.sort((a,b)=>b._tot-a._tot).forEach(r=>{
    msg+=`\n👤 *${r['Nombre']}*\n   Rol: ${r['Rol']||'—'}\n   Sueldo: ${fmt(r._tot)}\n`;
    if(r._com>0) msg+=`   Comisión: ${fmt(r._com)}\n`;
  });
  return msg;
}

async function responderResumen(equipo,state){
  const {nom,res}=await getData();
  // Leer directamente de hoja Resumen
  const resRow=res.find(r=>norm(r['Equipo'])===norm(equipo));
  if(!resRow) return `❌ No hay datos de resumen para *${equipo}*.`;
  const totalIng=resRow._ing;
  const meta=resRow._meta;
  const pct=meta>0?(totalIng/meta*100):parseFloat(String(resRow['% De avance']||'0').replace('%',''))||0;
  const nomEq=nom.filter(r=>r['Equipo']===equipo);
  const totalNom=nomEq.reduce((a,r)=>a+r._tot,0);
  const balance=totalIng-totalNom;
  let msg=`${EMOJIS[equipo]||'🏢'} *${equipo} — Resumen*\n━━━━━━━━━━━━━━━━━━━\n`;
  msg+=`💰 *Ingresos: ${fmt(totalIng)}*\n`;
  msg+=`💳 Nómina: ${fmt(totalNom)}\n`;
  msg+=`${balance>=0?'✅':'🔴'} Balance: *${balance>=0?'+':''}${fmt(balance)}*\n`;
  if(meta>0){
    msg+=`\n🎯 *Target: ${fmt(meta)}*\n${progBar(pct)} ${pct.toFixed(1)}%\n`;
    msg+=pct>=100?'✅ Meta cumplida!':pct>=60?'⚠️ En camino':'🔴 Necesita atención';
    msg+='\n';
  }
  if(resRow['Alerta']) msg+=`\n${resRow['Alerta']}\n`;
  return msg;
}

async function responderDashboard(state){
  const {dash}=await getData();
  // Leer directamente de hoja Dashboard: Total ingresos, Total nomina, Balance
  const row=dash&&dash[0];
  if(!row) return '❌ No se pudo leer el Dashboard.';
  const totalIng=parseMoney(row['Total ingresos']||row['Total Ingresos']||Object.values(row)[0]);
  const totalNom=parseMoney(row['Total nomina']||row['Total Nomina']||Object.values(row)[1]);
  const balance=parseMoney(row['Balance']||Object.values(row)[2]);
  let msg=`⚡ *Dashboard General*\n━━━━━━━━━━━━━━━━━━━\n`;
  msg+=`💰 *Total Ingresos: ${fmt(totalIng)}*\n`;
  msg+=`💳 *Total Nómina: ${fmt(totalNom)}*\n`;
  msg+=`${balance>=0?'✅':'🔴'} *Balance: ${balance>=0?'+':''}${fmt(balance)}*\n`;
  return msg;
}

// ══════════════════════════════════════
// TELEGRAM API
// ══════════════════════════════════════
function tgRequest(method,body){
  return new Promise((resolve,reject)=>{
    const data=JSON.stringify(body);
    const options={hostname:'api.telegram.org',path:`/bot${TOKEN}/${method}`,method:'POST',headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(data)}};
    const req=https.request(options,res=>{let d='';res.on('data',c=>d+=c);res.on('end',()=>resolve(JSON.parse(d)));});
    req.on('error',reject);req.write(data);req.end();
  });
}
function sendMessage(chatId,text,extra={}){
  return tgRequest('sendMessage',{chat_id:chatId,text,parse_mode:'Markdown',...extra});
}

// ══════════════════════════════════════
// PROCESS UPDATES
// ══════════════════════════════════════
async function processUpdate(update){
  if(update.message){
    const chatId=update.message.chat.id;
    const text=(update.message.text||'').trim();

    // Waiting for password
    if(userState[chatId]&&userState[chatId].waitingAuth){
      if(text===ACCESS_KEY){
        addAuth(chatId);
        userState[chatId]={};
        await sendMessage(chatId,'✅ *Acceso concedido!*\n\nBienvenido al bot de Aurum Seul.');
        await sendMainMenu(chatId);
      } else {
        await sendMessage(chatId,'❌ *Clave incorrecta.* Intenta de nuevo:');
      }
      return;
    }

    // Check auth
    if(!isAuth(chatId)){
      userState[chatId]={waitingAuth:true};
      await sendMessage(chatId,'🔐 *Bot de Aurum Seul*\n\nIngresa la clave de acceso:');
      return;
    }

    if(text==='/start'||text==='/menu'){
      await sendMainMenu(chatId);
    } else {
      await sendMainMenu(chatId);
    }
  }

  if(update.callback_query){
    const chatId=update.callback_query.message.chat.id;
    const data=update.callback_query.data;
    await tgRequest('answerCallbackQuery',{callback_query_id:update.callback_query.id});

    if(!isAuth(chatId)){
      await sendMessage(chatId,'🔐 Escribe /start e ingresa la clave.');
      return;
    }

    if(data.startsWith('eq:')){
      const equipo=data.replace('eq:','');
      userState[chatId]={...userState[chatId],equipo};
      await sendAccionMenu(chatId,equipo);

    } else if(data.startsWith('main:')){
      const accion=data.replace('main:','');
      if(accion==='back'||accion==='menu') await sendMainMenu(chatId);
      else if(accion==='mes') await sendMesMenu(chatId,'main');

    } else if(data.startsWith('mes:')){
      const parts=data.split(':');
      const mesNombre=parts[1],mesYear=parts[2],returnTo=parts[3];
      userState[chatId]={...userState[chatId],mes:mesNombre,mesYear};
      await sendMessage(chatId,`✅ Mes: *${mesNombre} ${mesYear}*`);
      if(returnTo==='main') await sendMainMenu(chatId);
      else if(userState[chatId]&&userState[chatId].equipo) await sendAccionMenu(chatId,userState[chatId].equipo);
      else await sendMainMenu(chatId);

    } else if(data.startsWith('acc:')){
      const accion=data.replace('acc:','');
      const equipo=(userState[chatId]||{}).equipo;
      const state=userState[chatId]||{};

      if(accion==='back'||!equipo&&accion!=='dashboard'){
        await sendMainMenu(chatId);
        return;
      }

      await sendMessage(chatId,`⏳ Consultando datos...`);
      let respuesta='';
      try{
        if(accion==='ingresos') respuesta=await responderIngresos(equipo,state);
        else if(accion==='targets') respuesta=await responderTargets(equipo,state);
        else if(accion==='nomina') respuesta=await responderNomina(equipo,state);
        else if(accion==='resumen') respuesta=await responderResumen(equipo,state);
        else if(accion==='dashboard') respuesta=await responderDashboard(state);
      }catch(e){
        respuesta='❌ Error al obtener datos. Intenta de nuevo.';
        console.error(e);
      }

      const backButtons=accion==='dashboard'
        ?[[{text:'◀️ Volver al menú',callback_data:'main:back'}]]
        :[[{text:'🔄 Ver otra opción',callback_data:`eq:${equipo}`}],[{text:'◀️ Menú principal',callback_data:'main:back'}]];

      await sendMessage(chatId,respuesta,{reply_markup:{inline_keyboard:backButtons}});
    }
  }
}

// ══════════════════════════════════════
// POLLING
// ══════════════════════════════════════
let offset=0;
async function poll(){
  try{
    const res=await tgRequest('getUpdates',{offset,timeout:30,allowed_updates:['message','callback_query']});
    if(res.ok&&res.result.length){
      for(const update of res.result){
        offset=update.update_id+1;
        processUpdate(update).catch(console.error);
      }
    }
  }catch(e){
    console.error('Poll error:',e.message);
    await new Promise(r=>setTimeout(r,5000));
  }
  setTimeout(poll,1000);
}

const PORT=process.env.PORT||3000;
http.createServer((req,res)=>{res.writeHead(200);res.end('Aurum Seul Bot - Online ✅');}).listen(PORT,()=>console.log(`Server on port ${PORT}`));
console.log('🤖 Aurum Seul Bot iniciado...');
poll();
