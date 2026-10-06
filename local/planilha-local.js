/**
 * planilha-local.js — simulação do ambiente Google (Node e navegador).
 *
 * Reproduz só o que o sistema usa: SpreadsheetApp, LockService, PropertiesService, CacheService,
 * Utilities, Session, ScriptApp, DriveApp. Serve para rodar os MESMOS arquivos .gs fora do Google.
 *
 * Detalhe importante: nas células que NÃO estão em formato texto ("@"), uma string que parece número
 * ("0453") vira número e uma que parece data ("2026-10-05") vira Date, como no Planilhas de verdade.
 * Assim os testes pegam colunas gravadas sem o formato certo.
 */
(function (raiz) {
  'use strict';

  /* ---------- SHA-256 e HMAC em JS puro (síncrono, funciona no Node e no navegador) ---------- */
  function utf8(s) {
    var out = [];
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (c < 128) out.push(c);
      else if (c < 2048) out.push(192 | (c >> 6), 128 | (c & 63));
      else if (c >= 0xd800 && c < 0xdc00) { var c2 = s.charCodeAt(++i); c = 0x10000 + ((c & 0x3ff) << 10) + (c2 & 0x3ff); out.push(240 | (c >> 18), 128 | ((c >> 12) & 63), 128 | ((c >> 6) & 63), 128 | (c & 63)); }
      else out.push(224 | (c >> 12), 128 | ((c >> 6) & 63), 128 | (c & 63));
    }
    return out;
  }
  var K = [0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2];
  function sha256(bytes) {
    var h = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    var l = bytes.length, b = bytes.slice();
    b.push(0x80);
    while (b.length % 64 !== 56) b.push(0);
    var hi = Math.floor((l * 8) / 4294967296), lo = (l * 8) >>> 0;
    b.push((hi >>> 24) & 255, (hi >>> 16) & 255, (hi >>> 8) & 255, hi & 255, (lo >>> 24) & 255, (lo >>> 16) & 255, (lo >>> 8) & 255, lo & 255);
    function rr(x, n) { return (x >>> n) | (x << (32 - n)); }
    for (var i = 0; i < b.length; i += 64) {
      var w = new Array(64);
      for (var t = 0; t < 16; t++) w[t] = (b[i + 4 * t] << 24) | (b[i + 4 * t + 1] << 16) | (b[i + 4 * t + 2] << 8) | b[i + 4 * t + 3];
      for (t = 16; t < 64; t++) { var s0 = rr(w[t - 15], 7) ^ rr(w[t - 15], 18) ^ (w[t - 15] >>> 3), s1 = rr(w[t - 2], 17) ^ rr(w[t - 2], 19) ^ (w[t - 2] >>> 10); w[t] = (w[t - 16] + s0 + w[t - 7] + s1) | 0; }
      var a = h[0], bb = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], hh = h[7];
      for (t = 0; t < 64; t++) {
        var S1 = rr(e, 6) ^ rr(e, 11) ^ rr(e, 25), ch = (e & f) ^ (~e & g), t1 = (hh + S1 + ch + K[t] + w[t]) | 0;
        var S0 = rr(a, 2) ^ rr(a, 13) ^ rr(a, 22), mj = (a & bb) ^ (a & c) ^ (bb & c), t2 = (S0 + mj) | 0;
        hh = g; g = f; f = e; e = (d + t1) | 0; d = c; c = bb; bb = a; a = (t1 + t2) | 0;
      }
      h[0] = (h[0] + a) | 0; h[1] = (h[1] + bb) | 0; h[2] = (h[2] + c) | 0; h[3] = (h[3] + d) | 0; h[4] = (h[4] + e) | 0; h[5] = (h[5] + f) | 0; h[6] = (h[6] + g) | 0; h[7] = (h[7] + hh) | 0;
    }
    var out = [];
    h.forEach(function (x) { out.push((x >>> 24) & 255, (x >>> 16) & 255, (x >>> 8) & 255, x & 255); });
    return out;
  }
  function hmac(keyBytes, msgBytes) {
    if (keyBytes.length > 64) keyBytes = sha256(keyBytes);
    while (keyBytes.length < 64) keyBytes.push(0);
    var ip = keyBytes.map(function (x) { return x ^ 0x36; }), op = keyBytes.map(function (x) { return x ^ 0x5c; });
    return sha256(op.concat(sha256(ip.concat(msgBytes))));
  }
  function assinados(bytes) { return bytes.map(function (b) { return b > 127 ? b - 256 : b; }); }
  function sem(bytes) { return bytes.map(function (b) { return (b + 256) % 256; }); }
  function b64(bytes, web) {
    var A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789' + (web ? '-_' : '+/'), s = '', b = sem(bytes);
    for (var i = 0; i < b.length; i += 3) {
      var n = (b[i] << 16) | ((b[i + 1] || 0) << 8) | (b[i + 2] || 0);
      s += A[(n >> 18) & 63] + A[(n >> 12) & 63] + (i + 1 < b.length ? A[(n >> 6) & 63] : '=') + (i + 2 < b.length ? A[n & 63] : '=');
    }
    return s;
  }

  /* ---------- planilha ---------- */
  var CONT = { planilha: 0, cache: 0, detalhe: {} };
  function conta(tipo, nome) { CONT[tipo]++; CONT.detalhe[nome] = (CONT.detalhe[nome] || 0) + 1; }
  function Faixa(aba, r, c, nr, nc) { this.aba = aba; this.r = r; this.c = c; this.nr = nr; this.nc = nc; }
  Faixa.prototype.getValues = function () {
    conta('planilha', 'getValues');
    var out = [];
    for (var i = 0; i < this.nr; i++) {
      var linha = [];
      for (var j = 0; j < this.nc; j++) linha.push(this.aba._get(this.r + i, this.c + j));
      out.push(linha);
    }
    return out;
  };
  Faixa.prototype.setValues = function (v) {
    conta('planilha', 'setValues');
    for (var i = 0; i < this.nr; i++) for (var j = 0; j < this.nc; j++) this.aba._set(this.r + i, this.c + j, v[i][j]);
    return this;
  };
  Faixa.prototype.setValue = function (v) {
    conta('planilha', 'setValue');
    for (var i = 0; i < this.nr; i++) for (var j = 0; j < this.nc; j++) this.aba._set(this.r + i, this.c + j, v);
    return this;
  };
  Faixa.prototype.setNumberFormats = function (f) {
    conta('planilha', 'setNumberFormats');
    for (var i = 0; i < this.nr; i++) for (var j = 0; j < this.nc; j++) this.aba._fmt[(this.r + i) + ',' + (this.c + j)] = f[i][j];
    return this;
  };
  Faixa.prototype.setNumberFormat = function (f) {
    for (var i = 0; i < this.nr; i++) for (var j = 0; j < this.nc; j++) this.aba._fmt[(this.r + i) + ',' + (this.c + j)] = f;
    return this;
  };
  Faixa.prototype.clearContent = function () {
    conta('planilha', 'clearContent');
    for (var i = 0; i < this.nr; i++) for (var j = 0; j < this.nc; j++) { var l = this.aba._d[this.r + i - 1]; if (l) l[this.c + j - 1] = ''; }
    return this;
  };
  ['setFontWeight', 'setBackground', 'setFontColor', 'setHorizontalAlignment', 'setDataValidation', 'setWrap'].forEach(function (m) { Faixa.prototype[m] = function () { return this; }; });

  function Aba(nome) { this._nome = nome; this._d = []; this._fmt = {}; this._max = 1000; }
  Aba.prototype._get = function (r, c) { var l = this._d[r - 1]; var v = l ? l[c - 1] : ''; return v === undefined || v === null ? '' : v; };
  Aba.prototype._set = function (r, c, v) {
    if (r > this._max || c > 26) throw new Error('The coordinates of the range are outside the dimensions of the sheet.');
    while (this._d.length < r) this._d.push([]);
    var l = this._d[r - 1];
    while (l.length < c) l.push('');
    if (v === null || v === undefined) v = '';
    var f = this._fmt[r + ',' + c] || 'General';
    if (f !== '@' && typeof v === 'string') {
      if (/^-?\d+(\.\d+)?$/.test(v)) v = Number(v);                         // "0453" -> 453
      else if (/^\d{4}-\d{2}-\d{2}([T ].*)?$/.test(v)) v = new Date(v);    // "2026-10-05" -> data
    }
    l[c - 1] = v;
  };
  Aba.prototype.getName = function () { return this._nome; };
  Aba.prototype.getLastRow = function () {
    conta('planilha', 'getLastRow');
    for (var r = this._d.length; r >= 1; r--) { var l = this._d[r - 1]; if (l && l.some(function (v) { return v !== '' && v !== null && v !== undefined; })) return r; }
    return 0;
  };
  Aba.prototype.getLastColumn = function () {
    var m = 0;
    this._d.forEach(function (l) { for (var c = l.length; c >= 1; c--) if (l[c - 1] !== '' && l[c - 1] !== null && l[c - 1] !== undefined) { if (c > m) m = c; break; } });
    return m;
  };
  Aba.prototype.getRange = function (r, c, nr, nc) { return new Faixa(this, r, c, nr || 1, nc || 1); };
  Aba.prototype.getMaxRows = function () { conta('planilha', 'getMaxRows'); return this._max; };
  Aba.prototype.insertRowsAfter = function (pos, n) { conta('planilha', 'insertRowsAfter'); this._max += n; };
  Aba.prototype.getDataRange = function () {
    var ult = 0, col = 0;
    for (var r = this._d.length; r >= 1; r--) { var l = this._d[r - 1]; if (l && l.some(function (v) { return v !== '' && v !== null && v !== undefined; })) { ult = r; break; } }
    for (var rr = 0; rr < ult; rr++) { var ll = this._d[rr] || []; for (var c = ll.length; c >= 1; c--) if (ll[c - 1] !== '' && ll[c - 1] !== null && ll[c - 1] !== undefined) { if (c > col) col = c; break; } }
    return new Faixa(this, 1, 1, Math.max(ult, 1), Math.max(col, 1));
  };
  Aba.prototype.protect = function () {
    var p = { setDescription: function () { return p; }, addEditor: function () { return p; }, getEditors: function () { return []; }, removeEditors: function () { return p; }, canDomainEdit: function () { return false; }, setDomainEdit: function () { return p; } };
    return p;
  };
  Aba.prototype.getProtections = function () { return []; };
  ['setFrozenRows', 'setTabColor', 'setColumnWidths', 'setColumnWidth'].forEach(function (m) { Aba.prototype[m] = function () { return this; }; });

  function Planilha(id) { this._id = id || 'PLANILHA-LOCAL'; this._abas = []; this._ativa = null; }
  Planilha.prototype.getId = function () { return this._id; };
  Planilha.prototype.getUrl = function () { return 'https://docs.google.com/spreadsheets/d/' + this._id; };
  Planilha.prototype.getSheetByName = function (n) { for (var i = 0; i < this._abas.length; i++) if (this._abas[i]._nome === n) return this._abas[i]; return null; };
  Planilha.prototype.insertSheet = function (n) { var a = new Aba(n); this._abas.push(a); return a; };
  Planilha.prototype.getSheets = function () { return this._abas.slice(); };
  Planilha.prototype.deleteSheet = function (a) { this._abas = this._abas.filter(function (x) { return x !== a; }); };
  Planilha.prototype.setActiveSheet = function (a) { this._ativa = a; return a; };
  Planilha.prototype.moveActiveSheet = function (pos) { var a = this._ativa; this._abas = this._abas.filter(function (x) { return x !== a; }); this._abas.splice(pos - 1, 0, a); };
  Planilha.prototype.setSpreadsheetTimeZone = function () { };
  Planilha.prototype.exportar = function () { return { id: this._id, abas: this._abas.map(function (a) { return { nome: a._nome, d: a._d.map(function (l) { return l.map(function (v) { return v instanceof Date ? { __data: v.toISOString() } : v; }); }), fmt: a._fmt }; }) }; };
  Planilha.prototype.importar = function (o) {
    this._id = o.id; this._abas = o.abas.map(function (x) { var a = new Aba(x.nome); a._d = x.d.map(function (l) { return l.map(function (v) { return v && v.__data ? new Date(v.__data) : v; }); }); a._fmt = x.fmt || {}; return a; });
  };

  /* ---------- ambiente global ---------- */
  function criarAmbiente(opc) {
    opc = opc || {};
    var ss = new Planilha(opc.id), props = {}, cache = {}, travas = { n: 0, historico: 0 }, drive = { pastas: [], arquivos: [] }, gatilhos = [];
    function mkProps() { return { getProperty: function (k) { return Object.prototype.hasOwnProperty.call(props, k) ? props[k] : null; }, setProperty: function (k, v) { props[k] = String(v); return this; }, deleteProperty: function (k) { delete props[k]; return this; }, getProperties: function () { return Object.assign({}, props); } }; }
    var G = {};
    G.SpreadsheetApp = {
      getActiveSpreadsheet: function () { return ss; },
      openById: function () { return ss; },
      newDataValidation: function () { var b = { requireValueInList: function () { return b; }, setAllowInvalid: function () { return b; }, build: function () { return {}; } }; return b; },
      ProtectionType: { SHEET: 'SHEET', RANGE: 'RANGE' },
      getUi: function () {
        var Btn = { OK: 'OK', YES: 'YES', NO: 'NO', CANCEL: 'CANCEL' };
        return { alert: function (a, b) { (opc.alertas || []).push([a, b]); return Btn.OK; }, prompt: function () { return { getSelectedButton: function () { return Btn.CANCEL; }, getResponseText: function () { return ''; } }; }, ButtonSet: { OK: 'OK', OK_CANCEL: 'OK_CANCEL', YES_NO: 'YES_NO' }, Button: Btn, createMenu: function () { var m = { addItem: function () { return m; }, addSeparator: function () { return m; }, addToUi: function () { } }; return m; }, showModalDialog: function () { } };
      }
    };
    G.PropertiesService = { getScriptProperties: mkProps };
    var TAM_MAX_CACHE = 100 * 1024;   // o Google recusa valor maior que 100 KB
    function tamanhoBytes(v) { return utf8(String(v)).length; }
    function checa(k, v) { if (String(k).length > 250) throw new Error('Argument too large: key'); if (tamanhoBytes(v) > TAM_MAX_CACHE) throw new Error('Argument too large: value'); }
    G.CacheService = { getScriptCache: function () {
      var c = {
        get: function (k) { conta('cache', 'get'); var x = cache[k]; return x && x.ate > Date.now() ? x.v : null; },
        getAll: function (ks) { conta('cache', 'getAll'); var o = {}; ks.forEach(function (k) { var x = cache[k]; if (x && x.ate > Date.now()) o[k] = x.v; }); return o; },
        put: function (k, v, s) { conta('cache', 'put'); v = String(v); checa(k, v); cache[k] = { v: v, ate: Date.now() + (s || 600) * 1000 }; },
        putAll: function (m, s) { conta('cache', 'putAll'); Object.keys(m).forEach(function (k) { checa(k, String(m[k])); }); Object.keys(m).forEach(function (k) { cache[k] = { v: String(m[k]), ate: Date.now() + (s || 600) * 1000 }; }); },
        remove: function (k) { conta('cache', 'remove'); delete cache[k]; },
        removeAll: function (ks) { conta('cache', 'removeAll'); ks.forEach(function (k) { delete cache[k]; }); }
      };
      return c;
    } };
    G.__cacheBruto = cache;
    G.LockService = { getScriptLock: function () { return { waitLock: function () { if (travas.n > 0) throw new Error('Lock ocupado'); travas.n++; travas.historico++; }, tryLock: function () { if (travas.n > 0) return false; travas.n++; travas.tentativas = (travas.tentativas || 0) + 1; return true; }, releaseLock: function () { travas.n = Math.max(0, travas.n - 1); }, hasLock: function () { return travas.n > 0; } }; } };
    G.Session = { getEffectiveUser: function () { return { getEmail: function () { return 'dono@exemplo.com'; } }; }, getScriptTimeZone: function () { return 'America/Bahia'; } };
    G.MimeType = { CSV: 'text/csv', PLAIN_TEXT: 'text/plain' };
    G.Utilities = {
      DigestAlgorithm: { SHA_256: 'SHA_256' },
      getUuid: function () { var h = '0123456789abcdef', s = ''; for (var i = 0; i < 36; i++) { if (i === 8 || i === 13 || i === 18 || i === 23) s += '-'; else if (i === 14) s += '4'; else if (i === 19) s += h[(Math.random() * 4 | 0) + 8]; else s += h[Math.random() * 16 | 0]; } return s; },
      computeDigest: function (alg, str) { return assinados(sha256(utf8(String(str)))); },
      computeHmacSha256Signature: function (valor, chave) { return assinados(hmac(utf8(String(chave)), utf8(String(valor)))); },
      base64EncodeWebSafe: function (bytes) { return b64(bytes, true); },
      base64Encode: function (bytes) { return b64(bytes, false); },
      sleep: function () { },
      formatDate: function (d, tz, pad) {
        var off = tz === 'America/Bahia' || tz === 'America/Sao_Paulo' ? -180 : 0, t = new Date(d.getTime() + off * 60000);
        function z(n, l) { return String(n).padStart(l || 2, '0'); }
        var m = { yyyy: z(t.getUTCFullYear(), 4), MM: z(t.getUTCMonth() + 1), dd: z(t.getUTCDate()), HH: z(t.getUTCHours()), mm: z(t.getUTCMinutes()), ss: z(t.getUTCSeconds()) };
        return pad.replace(/yyyy|MM|dd|HH|mm|ss/g, function (k) { return m[k]; });
      }
    };
    G.ScriptApp = {
      newTrigger: function (fn) { var t = { _fn: fn, timeBased: function () { return t; }, everyDays: function () { return t; }, atHour: function () { return t; }, create: function () { gatilhos.push(t); return t; }, getHandlerFunction: function () { return fn; } }; return t; },
      getProjectTriggers: function () { return gatilhos.slice(); }, deleteTrigger: function (t) { var i = gatilhos.indexOf(t); if (i >= 0) gatilhos.splice(i, 1); },
      getService: function () { return { getUrl: function () { return 'http://localhost/app'; } }; }
    };
    G.DriveApp = {
      createFolder: function (n) { var f = { nome: n, arquivos: [], createFile: function (nome, conteudo) { f.arquivos.push({ nome: nome, conteudo: conteudo }); return {}; }, getUrl: function () { return 'https://drive.exemplo/' + encodeURIComponent(n); }, getFiles: function () { var i = 0; return { hasNext: function () { return false; }, next: function () { } }; } }; drive.pastas.push(f); return f; },
      getFoldersByName: function (n) { var l = drive.pastas.filter(function (p) { return p.nome === n; }), i = 0; return { hasNext: function () { return i < l.length; }, next: function () { return l[i++]; } }; },
      getFileById: function () { return { makeCopy: function (nome, pasta) { drive.arquivos.push({ nome: nome }); return {}; } }; }
    };
    G.HtmlService = {};
    return { globais: G, planilha: ss, props: props, travas: travas, drive: drive, gatilhos: gatilhos, cont: CONT, cache: cache, zerarCont: function () { CONT.planilha = 0; CONT.cache = 0; CONT.detalhe = {}; } };
  }

  var API = { criarAmbiente: criarAmbiente, sha256: sha256 };
  if (typeof module !== 'undefined' && module.exports) module.exports = API; else raiz.CafeLocal = API;
})(typeof window !== 'undefined' ? window : globalThis);