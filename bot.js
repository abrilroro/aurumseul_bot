const https = require('https');
const http = require('http');

// ══════════════════════════════════════
// CONFIG
// ══════════════════════════════════════
const TOKEN = process.env.BOT_TOKEN || '8868834232:AAFS63UfIOVVqWv9IT3tlg3bKL5xUokoxHY';
const API = `https://api.telegram.org/bot${TOKEN}`;

const SHEETS = {
  ingresos:  'https://docs.google.com/spreadsheets/d/e/2PACX-1vQXMLvGSvUJNRZ1hDZcLQ3XGSsK2qWad9DrI_VE71C0F4xYHEKde8bQvpizI6Tw63DQwLr-ZB3XhwiR/pub?gid=0&single=true&output=csv',
  resumen:   'https://docs.google.com/spreadsheets/d/e/2PACX-1vQXMLvGSvUJNRZ1hDZcLQ3XGSsK2qWad9DrI_VE71C0F4xYHEKde8bQvpizI6Tw63DQwLr-ZB3XhwiR/pub?gid=1671154283&single=true&output=csv',
  equipo:    'https://docs.google.com/spreadsheets/d/e/2PACX-1vQXMLvGSvUJNRZ1hDZcLQ3XGSsK2qWad9DrI_VE71C0F4xYHEKde8bQvpizI6Tw63DQwLr-ZB3XhwiR/pub?gid=882719008&single=true&output=csv',
  nomina:    'https://docs.google.com/spreadsheets/d/e/2PACX-1vQXMLvGSvUJNRZ1hDZcLQ3XGSsK2qWad9DrI_VE71C0F4xYHEKde8bQvpizI6Tw63DQwLr-ZB3XhwiR/pub?gid=1093401132&single=true&output=csv',
  targets:   'https://docs.google.com/spreadsheets/d/e/2PACX-1vQXMLvGSvUJNRZ1hDZcLQ3XGSsK2qWad9DrI_VE71C0F4xYHEKde8bQvpizI6Tw63DQwLr-ZB3XhwiR/pub?gid=1441875397&single=true&output=csv',
  dashboard: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQXMLvGSvUJNRZ1hDZcLQ3XGSsK2qWad9DrI_VE71C0F4xYHEKde8bQvpizI6Tw63DQwLr-ZB3XhwiR/pub?gid=647688392&single=true&output=csv',
};

const EQUIPOS = ['Aurum House','PE','EC','CR','Corm','Orbex','Seul'];
const EMOJIS  = {'Aurum House':'🥇','PE':'🔵','EC':'🟢','CR':'🟣','Corm':'🩵','Orbex':'🟠','Seul':'🩷'};

// ══════════════════════════════════════
// ESTADO DE CONVERSACION
// ══════════════════════════════════════
const userState = {}; // { chatId: { equipo, step } }

// ══════════════════════════════════════
// HELPERS
// ══════════════════════════════════════
function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

function parseCSV(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (!lines.length) return [];
  const headers = splitLine(lines[0]);
  return lines.slice(1).map(line => {
    const cols = splitLine(line);
    const obj = {};
    headers.forEach((h, i) => obj[h.trim()] = (cols[i] || '').trim());
    return obj;
  }).filter(r => Object.values(r).some(v => v));
}

function splitLine(line) {
  const cols = []; let cur = '', inQ = false;
  for (const c of line) {
    if (c === '"') { inQ = !inQ; }
    else if (c === ',' && !inQ) { cols.push(cur); cur = ''; }
    else cur += c;
  }
  cols.push(cur);
  return cols;
}

function parseMoney(s) {
  return parseFloat((s || '').replace(/[$,\s]/g, '')) || 0;
}

function fmt(n) {
  if (isNaN(n)) return '$0.00';
  return '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function progBar(pct, len = 10) {
  const filled = Math.round(Math.min(pct, 100) / 100 * len);
  return '█'.repeat(filled) + '░'.repeat(len - filled);
}

function getMesActual(data) {
  const MESES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
  const now = new Date();
  const mesActual = MESES[now.getMonth()];
  const year = now.getFullYear();
  const meses = [...new Set(data.map(r => (r['Mes'] || '').toLowerCase().trim()))].filter(Boolean);
  return meses.find(m => m.includes(mesActual)) || meses[meses.length - 1] || '';
}

// ══════════════════════════════════════
// FETCH SHEETS
// ══════════════════════════════════════
let cache = { data: null, ts: 0 };

async function getData() {
  const now = Date.now();
  if (cache.data && now - cache.ts < 5 * 60 * 1000) return cache.data;
  try {
    const [ing, res, eq, nom, tgt] = await Promise.all([
      fetchUrl(SHEETS.ingresos).then(parseCSV),
      fetchUrl(SHEETS.resumen).then(parseCSV),
      fetchUrl(SHEETS.equipo).then(parseCSV),
      fetchUrl(SHEETS.nomina).then(parseCSV),
      fetchUrl(SHEETS.targets).then(parseCSV),
    ]);
    // Normalizar
    const normEq = e => {
      const map = { 'aurum house': 'Aurum House', 'pe': 'PE', 'ec': 'EC', 'cr': 'CR', 'corm': 'Corm', 'seul': 'Seul', 'orbex': 'Orbex' };
      return map[(e || '').toLowerCase().trim()] || (e || '').trim();
    };
    ing.forEach(r => { r._v = parseMoney(r['Valor Neto']); r['Equipo'] = normEq(r['Equipo']); });
    nom.forEach(r => { r._tot = parseMoney(r['Sueldo Total']); r._com = parseMoney(r['Comision']); r['Equipo'] = normEq(r['Equipo']); });
    tgt.forEach(r => { r._tgt = parseMoney(r['Target']); r['Equipo'] = normEq(r['Equipo']); let m = (r['Mes'] || '').trim(); r['Mes'] = m.replace(/(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)(\d{2})$/i, (_, mon, yr) => mon + ' 20' + yr); });
    res.forEach(r => { r._ing = parseMoney(r['Ingresos mes']); r._meta = parseMoney(r['Meta']); r['Equipo'] = normEq(r['Equipo']); });
    cache = { data: { ing, res, eq, nom, tgt }, ts: now };
    return cache.data;
  } catch (e) {
    console.error('Error fetching data:', e.message);
    return cache.data || null;
  }
}

// ══════════════════════════════════════
// RESPUESTAS DEL BOT
// ══════════════════════════════════════
async function responderIngresos(equipo) {
  const { ing } = await getData();
  const mes = getMesActual(ing);
  const data = ing.filter(r => r['Equipo'] === equipo && (!mes || (r['Mes'] || '').toLowerCase() === mes));
  if (!data.length) return `❌ No hay ingresos registrados para *${equipo}* en ${mes || 'este período'}.`;

  const total = data.reduce((a, r) => a + r._v, 0);
  const byAg = {};
  data.forEach(r => { byAg[r['Agente']] = (byAg[r['Agente']] || 0) + r._v; });
  const ranking = Object.entries(byAg).sort((a, b) => b[1] - a[1]);

  let msg = `${EMOJIS[equipo] || '🏢'} *${equipo} — Ingresos*\n`;
  msg += `📅 _${mes || 'Todos los meses'}_\n`;
  msg += `━━━━━━━━━━━━━━━━━━━\n`;
  msg += `💰 *Total: ${fmt(total)}*\n`;
  msg += `📊 Transacciones: ${data.length}\n`;
  msg += `📈 Promedio: ${fmt(total / data.length)}\n\n`;
  msg += `🏆 *Ranking de agentes:*\n`;
  ranking.forEach(([name, val], i) => {
    const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;
    msg += `${medal} ${name}: *${fmt(val)}*\n`;
  });
  return msg;
}

async function responderTargets(equipo) {
  const { tgt, ing } = await getData();
  const mes = getMesActual(ing);
  const data = tgt.filter(r => r['Equipo'] === equipo && r._tgt > 0 && (!mes || (r['Mes'] || '').toLowerCase() === mes));
  if (!data.length) return `❌ No hay targets registrados para *${equipo}* en ${mes || 'este período'}.`;

  const norm = s => (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  const ingByAg = {};
  ing.filter(r => r['Equipo'] === equipo && (!mes || (r['Mes'] || '').toLowerCase() === mes))
     .forEach(r => { const n = norm(r['Agente']); ingByAg[n] = (ingByAg[n] || 0) + r._v; });

  const getIng = name => {
    const k = norm(name);
    if (ingByAg[k] !== undefined) return ingByAg[k];
    const ex = Object.entries(ingByAg).find(([kk]) => norm(kk) === k);
    if (ex) return ex[1];
    const words = k.split(' ').filter(w => w.length > 2);
    if (words.length >= 2) {
      const f = Object.entries(ingByAg).find(([kk]) => words.every(w => norm(kk).includes(w)));
      if (f) return f[1];
    }
    return 0;
  };

  let msg = `${EMOJIS[equipo] || '🏢'} *${equipo} — Targets*\n`;
  msg += `📅 _${mes || 'Todos los meses'}_\n`;
  msg += `━━━━━━━━━━━━━━━━━━━\n`;

  data.sort((a, b) => b._tgt - a._tgt).forEach(r => {
    const real = getIng(r['Nombre']);
    const pct = r._tgt > 0 ? Math.min(200, (real / r._tgt * 100)) : 0;
    const bar = progBar(pct);
    const estado = pct >= 100 ? '✅' : pct >= 60 ? '⚠️' : '🔴';
    msg += `\n${estado} *${r['Nombre']}*\n`;
    msg += `   Meta: ${fmt(r._tgt)}\n`;
    msg += `   Logrado: ${fmt(real)}\n`;
    msg += `   ${bar} ${pct.toFixed(0)}%\n`;
  });
  return msg;
}

async function responderNomina(equipo) {
  const { nom, ing } = await getData();
  const data = nom.filter(r => r['Equipo'] === equipo && r['Nombre']);
  if (!data.length) return `❌ No hay datos de nómina para *${equipo}*.`;

  const totalNom = data.reduce((a, r) => a + r._tot, 0);
  const totalIng = ing.filter(r => r['Equipo'] === equipo).reduce((a, r) => a + r._v, 0);
  const balance = totalIng - totalNom;

  let msg = `${EMOJIS[equipo] || '🏢'} *${equipo} — Nómina*\n`;
  msg += `━━━━━━━━━━━━━━━━━━━\n`;
  msg += `💳 *Total nómina: ${fmt(totalNom)}*\n`;
  msg += `💰 Ingresos equipo: ${fmt(totalIng)}\n`;
  msg += `${balance >= 0 ? '✅' : '🔴'} Balance: *${balance >= 0 ? '+' : ''}${fmt(balance)}*\n\n`;
  msg += `👥 *Detalle por persona:*\n`;

  data.sort((a, b) => b._tot - a._tot).forEach(r => {
    msg += `\n👤 *${r['Nombre']}*\n`;
    msg += `   Rol: ${r['Rol'] || '—'}\n`;
    msg += `   Sueldo: ${fmt(r._tot)}\n`;
    if (r._com > 0) msg += `   Comisión: ${fmt(r._com)}\n`;
  });
  return msg;
}

async function responderResumen(equipo) {
  const { ing, nom, tgt } = await getData();
  const mes = getMesActual(ing);
  const ingEq = ing.filter(r => r['Equipo'] === equipo && (!mes || (r['Mes'] || '').toLowerCase() === mes));
  const nomEq = nom.filter(r => r['Equipo'] === equipo);
  const tgtEq = tgt.filter(r => r['Equipo'] === equipo && (!mes || (r['Mes'] || '').toLowerCase() === mes));

  const totalIng = ingEq.reduce((a, r) => a + r._v, 0);
  const totalNom = nomEq.reduce((a, r) => a + r._tot, 0);
  const totalTgt = tgtEq.reduce((a, r) => a + r._tgt, 0);
  const balance = totalIng - totalNom;
  const pctTarget = totalTgt > 0 ? (totalIng / totalTgt * 100) : 0;

  let msg = `${EMOJIS[equipo] || '🏢'} *${equipo} — Resumen General*\n`;
  msg += `📅 _${mes || 'Todos los meses'}_\n`;
  msg += `━━━━━━━━━━━━━━━━━━━\n`;
  msg += `💰 *Ingresos: ${fmt(totalIng)}*\n`;
  msg += `💳 Nómina: ${fmt(totalNom)}\n`;
  msg += `${balance >= 0 ? '✅' : '🔴'} Balance: *${balance >= 0 ? '+' : ''}${fmt(balance)}*\n`;
  if (totalTgt > 0) {
    msg += `\n🎯 *Target: ${fmt(totalTgt)}*\n`;
    msg += `${progBar(pctTarget)} ${pctTarget.toFixed(1)}%\n`;
    msg += `${pctTarget >= 100 ? '✅ Meta cumplida!' : pctTarget >= 60 ? '⚠️ En camino' : '🔴 Necesita atención'}\n`;
  }
  msg += `\n👥 Agentes activos: ${new Set(ingEq.map(r => r['Agente'])).size}\n`;
  msg += `📊 Transacciones: ${ingEq.length}\n`;
  return msg;
}

// ══════════════════════════════════════
// TELEGRAM API
// ══════════════════════════════════════
function tgRequest(method, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const options = {
      hostname: 'api.telegram.org',
      path: `/bot${TOKEN}/${method}`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
    };
    const req = https.request(options, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve(JSON.parse(d)));
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function sendMessage(chatId, text, extra = {}) {
  return tgRequest('sendMessage', { chat_id: chatId, text, parse_mode: 'Markdown', ...extra });
}

function sendEquipoMenu(chatId) {
  const buttons = EQUIPOS.map(eq => [{ text: `${EMOJIS[eq] || '🏢'} ${eq}`, callback_data: `eq:${eq}` }]);
  return sendMessage(chatId, '🏢 *Selecciona un equipo:*', {
    reply_markup: { inline_keyboard: buttons }
  });
}

function sendAccionMenu(chatId, equipo) {
  return sendMessage(chatId, `${EMOJIS[equipo] || '🏢'} *${equipo}*\n\n¿Qué información quieres ver?`, {
    reply_markup: {
      inline_keyboard: [
        [{ text: '💰 Ingresos', callback_data: `acc:ingresos` }],
        [{ text: '🎯 Targets', callback_data: `acc:targets` }],
        [{ text: '💳 Nómina', callback_data: `acc:nomina` }],
        [{ text: '📊 Resumen General', callback_data: `acc:resumen` }],
        [{ text: '◀️ Cambiar equipo', callback_data: `acc:cambiar` }],
      ]
    }
  });
}

// ══════════════════════════════════════
// PROCESAR UPDATES
// ══════════════════════════════════════
async function processUpdate(update) {
  // Mensajes de texto
  if (update.message) {
    const chatId = update.message.chat.id;
    const text = (update.message.text || '').trim();

    if (text === '/start' || text === '/menu') {
      userState[chatId] = {};
      await sendMessage(chatId, '👋 *Bienvenido al bot de Aurum Seul!*\n\nConsulta ingresos, targets y nómina de cada equipo en tiempo real.');
      await sendEquipoMenu(chatId);
    } else if (text === '/resumen') {
      await sendMessage(chatId, '📊 Selecciona el equipo para ver el resumen:', {
        reply_markup: { inline_keyboard: EQUIPOS.map(eq => [{ text: `${EMOJIS[eq] || '🏢'} ${eq}`, callback_data: `eq_res:${eq}` }]) }
      });
    } else {
      await sendMessage(chatId, '👋 Usa /start para ver el menú principal.');
    }
  }

  // Callbacks de botones
  if (update.callback_query) {
    const chatId = update.callback_query.message.chat.id;
    const msgId = update.callback_query.message.message_id;
    const data = update.callback_query.data;

    // Responder al callback para quitar el loading
    await tgRequest('answerCallbackQuery', { callback_query_id: update.callback_query.id });

    if (data.startsWith('eq:')) {
      const equipo = data.replace('eq:', '');
      userState[chatId] = { equipo };
      await sendAccionMenu(chatId, equipo);

    } else if (data.startsWith('acc:')) {
      const accion = data.replace('acc:', '');
      const equipo = (userState[chatId] || {}).equipo;

      if (accion === 'cambiar' || !equipo) {
        userState[chatId] = {};
        await sendEquipoMenu(chatId);
        return;
      }

      await sendMessage(chatId, `⏳ Consultando datos de *${equipo}*...`);
      let respuesta = '';
      try {
        if (accion === 'ingresos') respuesta = await responderIngresos(equipo);
        else if (accion === 'targets') respuesta = await responderTargets(equipo);
        else if (accion === 'nomina') respuesta = await responderNomina(equipo);
        else if (accion === 'resumen') respuesta = await responderResumen(equipo);
      } catch (e) {
        respuesta = '❌ Error al obtener datos. Intenta de nuevo.';
        console.error(e);
      }

      await sendMessage(chatId, respuesta, {
        reply_markup: {
          inline_keyboard: [
            [{ text: '🔄 Ver otra opción', callback_data: `eq:${equipo}` }],
            [{ text: '🏢 Cambiar equipo', callback_data: `acc:cambiar` }]
          ]
        }
      });
    }
  }
}

// ══════════════════════════════════════
// POLLING
// ══════════════════════════════════════
let offset = 0;

async function poll() {
  try {
    const res = await tgRequest('getUpdates', { offset, timeout: 30, allowed_updates: ['message', 'callback_query'] });
    if (res.ok && res.result.length) {
      for (const update of res.result) {
        offset = update.update_id + 1;
        processUpdate(update).catch(console.error);
      }
    }
  } catch (e) {
    console.error('Poll error:', e.message);
    await new Promise(r => setTimeout(r, 5000));
  }
  setTimeout(poll, 1000);
}

// Keep-alive server para Railway/Render
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
  res.writeHead(200);
  res.end('Aurum Seul Bot - Online ✅');
}).listen(PORT, () => console.log(`Server on port ${PORT}`));

console.log('🤖 Aurum Seul Bot iniciado...');
poll();
