/**
 * Planilha.gs — única camada que conhece o Google Planilhas.
 *
 * - leitura de uma tabela por chamada, com cache em memória e no CacheService (ver Banco);
 * - gravação guiada pelo esquema (ordem e tipos das colunas);
 * - gravação em duas etapas: primeiro os filhos e os livros, por último a linha-mãe (o "commit");
 * - colunas de texto já nascem com formato texto, para o Sheets não transformar "0453" em 453.
 */

/**
 * Banco = leitura e gravação por tabela, pensando em VELOCIDADE (cada chamada ao Planilhas custa ~100-250 ms):
 *  - cada tabela é lida com uma só chamada (getDataRange) e guardada em memória durante a execução;
 *  - entre uma execução e outra, as tabelas ficam no CacheService (pedaços de até 30 mil caracteres), com versão
 *    por tabela: quem grava atualiza o cache na hora; quem só lê usa o cache e só o alimenta quando ninguém gravou;
 *  - gravar = um setValues por tabela (as colunas já nascem com formato certo na instalação) e a memória é atualizada
 *    junto, sem reler;
 *  - gravação em duas etapas: primeiro os filhos e os livros, por último a linha-mãe, que é o "commit". Sem a mãe,
 *    o que sobrou é lixo inerte (não entra em saldo nem total) e a auditoria acusa.
 * O cache é só aceleração: se algo falhar, lê da planilha. Edição manual na planilha limpa o cache (onEdit).
 */
var CACHE_TTL_ = 21600;
var CACHE_PEDACO_ = 30000;

function chaveVer_(n) { return 'tv:' + n; }
function chaveDado_(n, ver, i) { return 't:' + n + ':' + ver + ':' + i; }
function novaVersao_() { return Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36); }
function lerProps_() { return PropertiesService.getScriptProperties().getProperties(); }
function gensDe_(P) { try { return JSON.parse(P.GENS || '{}'); } catch (e) { return {}; } }
/* "geração" de uma tabela: sobe a cada gravação. Fica nas Propriedades (que não somem), então mesmo que o cache falhe
   no meio de uma gravação, o que ficou velho no cache é reconhecido e descartado. */
function genDe_(P, gens, nome) { return (P.EPOCA || '0') + '.' + (gens[nome] || 0); }
function limparCache_() {
  try { PropertiesService.getScriptProperties().setProperty('EPOCA', novaVersao_()); } catch (e) { /* ignora */ }
  try { CacheService.getScriptCache().removeAll(esquema_().map(function (d) { return chaveVer_(d.nome); })); } catch (e) { /* sem cache, sem problema */ }
}

/* origem: a planilha, ou uma função que a abre (abrir a planilha leva tempo, então só abrimos se precisar) */
function Banco(origem, opc) {
  opc = opc || {};
  this._src = origem; this._ss = typeof origem === 'function' ? null : origem;
  this.cache = {}; this._mp = null; this._ov = null;
  this.sujas = {}; this.doSheet = {}; this.usadas = {}; this.ultima = {}; this.pos = {};
  this.P = opc.props || lerProps_(); this.gens = gensDe_(this.P);
  this.cacheOn = !opc.semCache && this.P.CACHE_DESLIGADO !== '1';
  this.usoKey = null; this.usoAntes = null;
}
Banco.prototype.planilha = function () { if (!this._ss) this._ss = this._src(); return this._ss; };
Banco.prototype.invalidar = function () { this.cache = {}; this._mp = null; this._ov = null; this.sujas = {}; this.doSheet = {}; this.ultima = {}; this.pos = {}; };
Banco.prototype.aba = function (nome) {
  var s = this.planilha().getSheetByName(nome);
  if (!s) throw new Error('Aba ausente: ' + nome + '. Use o menu CoffeCommit > Instalar / atualizar planilha.');
  return s;
};
Banco.prototype.sujo_ = function (nome) {
  this.sujas[nome] = true;
  if (this._mp) delete this._mp[nome];
  if (this._ov) delete this._ov[nome];
};

function formatoColuna_(c) {
  switch (c.tipo) {
    case 'int': case 'cent': return '0';
    case 'qtd': return '0.###';
    case 'bool': return 'General';
    default: return '@';
  }
}
function deCelula_(c, v) {
  if (v === '' || v === null || v === undefined) return null;
  switch (c.tipo) {
    case 'int': case 'cent': case 'qtd': return Number(v);
    case 'bool': return v === true || v === 'TRUE' || v === 'true';
    default: return String(v);
  }
}
function paraCelula_(c, v) {
  if (v === null || v === undefined) return '';
  if (c.tipo === 'bool') return !!v;
  if (c.tipo === 'int' || c.tipo === 'cent' || c.tipo === 'qtd') return Number(v);
  return String(v);
}
/* formata as linhas [de, de+n) da aba: texto continua texto ("0453" não vira 453) */
function formatarLinhas_(sh, def, de, n) {
  if (n <= 0) return;
  var fmt = def.colunas.map(formatoColuna_), linhas = [];
  for (var i = 0; i < n; i++) linhas.push(fmt);
  sh.getRange(de, 1, n, def.colunas.length).setNumberFormats(linhas);
}

/* ---------- cache entre execuções ---------- */
Banco.prototype.paraArr_ = function (def, linhas) {
  return linhas.map(function (o) { var a = [o.__linha]; for (var j = 0; j < def.colunas.length; j++) a.push(o[def.colunas[j].nome]); return a; });
};
Banco.prototype.deArr_ = function (def, arr) {
  return arr.map(function (a) { var o = { __linha: a[0] }; for (var j = 0; j < def.colunas.length; j++) o[def.colunas[j].nome] = a[j + 1]; return o; });
};
/* traz do cache, em poucas chamadas, as tabelas que esta rota costuma usar (e só as que estão na geração atual) */
Banco.prototype.prefetch = function (nomes, usoKey) {
  if (!this.cacheOn) return;
  var self = this;
  try {
    var c = CacheService.getScriptCache();
    this.usoKey = usoKey || null;
    var lista = nomes.slice(), conhecido = false;
    if (usoKey) { var u = c.get(usoKey); if (u) { conhecido = true; this.usoAntes = JSON.parse(u); this.usoAntes.forEach(function (n) { if (lista.indexOf(n) < 0) lista.push(n); }); } }
    if (usoKey && !conhecido) esquema_().forEach(function (d) { if (lista.indexOf(d.nome) < 0) lista.push(d.nome); });   // rota nova: traz tudo o que já está no cache
    lista = lista.filter(function (n) { return !self.cache[n]; });
    if (!lista.length) return;
    var vs = c.getAll(lista.map(chaveVer_)), plano = [], chaves = [];
    lista.forEach(function (n) {
      var v = vs[chaveVer_(n)]; if (!v) return;
      var p = v.split(':'), k = Number(p[1]);
      if (p[2] !== genDe_(self.P, self.gens, n)) return;      // ficou velho (alguém gravou depois): ignora
      plano.push({ n: n, ver: p[0], k: k });
      for (var i = 0; i < k; i++) chaves.push(chaveDado_(n, p[0], i));
    });
    if (!chaves.length) return;
    var dados = c.getAll(chaves);
    plano.forEach(function (it) {
      var partes = [];
      for (var i = 0; i < it.k; i++) { var d = dados[chaveDado_(it.n, it.ver, i)]; if (d === undefined || d === null) return; partes.push(d); }
      try { self.cache[it.n] = self.deArr_(esquemaTabela_(it.n), JSON.parse(partes.join(''))); self.ultima[it.n] = ultimaLinhaDe_(self.cache[it.n]); } catch (e) { /* cache ruim: lê da planilha */ }
    });
  } catch (e) { /* cache é só aceleração */ }
};
function ultimaLinhaDe_(linhas) { var m = 1; linhas.forEach(function (l) { if (l.__linha > m) m = l.__linha; }); return m; }

/* chamado no fim da execução. Quem escreveu tem a trava (e leu as propriedades já dentro dela); quem só leu tenta pegar
   a trava só para alimentar o cache, e só alimenta o que ninguém gravou desde o início da leitura. */
Banco.prototype.finalizar = function (escreveu) {
  if (!this.cacheOn) return;
  var self = this, lock = null;
  try {
    var sujas = Object.keys(this.sujas), alimentar = Object.keys(this.doSheet).filter(function (n) { return self.cache[n] && !self.sujas[n]; });
    var uso = (this.usoAntes || []).slice(); Object.keys(this.usadas).forEach(function (n) { if (uso.indexOf(n) < 0) uso.push(n); });
    var usoMudou = !!this.usoKey && uso.length !== (this.usoAntes || []).length;
    if (!sujas.length && !alimentar.length && !usoMudou) return;
    var P = this.P, gens = this.gens;
    if (!escreveu) {
      lock = LockService.getScriptLock();
      if (!lock.tryLock(1)) { lock = null; return; }
      var agora = lerProps_(), gAgora = gensDe_(agora);
      alimentar = alimentar.filter(function (n) { return genDe_(agora, gAgora, n) === genDe_(P, gens, n); });
      P = agora; gens = gAgora;
    }
    var props = PropertiesService.getScriptProperties();
    if (sujas.length) {
      sujas.forEach(function (n) { gens[n] = (gens[n] || 0) + 1; });
      props.setProperty('GENS', JSON.stringify(gens));          // primeiro o que é durável…
      P = Object.assign({}, P, { GENS: JSON.stringify(gens) });
    }
    var c = CacheService.getScriptCache(), mapa = {}, remover = [];   // …depois o cache
    sujas.forEach(function (n) { if (self.cache[n]) self.paraCache_(n, mapa, genDe_(P, gens, n)); else remover.push(chaveVer_(n)); });
    alimentar.forEach(function (n) { self.paraCache_(n, mapa, genDe_(P, gens, n)); });
    if (usoMudou) mapa[this.usoKey] = JSON.stringify(uso);
    if (remover.length) c.removeAll(remover);
    if (Object.keys(mapa).length) c.putAll(mapa, CACHE_TTL_);
  } catch (e) { /* cache é só aceleração */ }
  finally { if (lock) { try { lock.releaseLock(); } catch (e2) { /* ignora */ } } }
};
Banco.prototype.paraCache_ = function (nome, mapa, gen) {
  var json = JSON.stringify(this.paraArr_(esquemaTabela_(nome), this.cache[nome])), ver = novaVersao_(), k = Math.max(1, Math.ceil(json.length / CACHE_PEDACO_));
  for (var i = 0; i < k; i++) mapa[chaveDado_(nome, ver, i)] = json.slice(i * CACHE_PEDACO_, (i + 1) * CACHE_PEDACO_);
  mapa[chaveVer_(nome)] = ver + ':' + k + ':' + gen;
};

/* ---------- leitura ---------- */
Banco.prototype.t = function (nome) {
  this.usadas[nome] = true;
  if (this.cache[nome]) return this.cache[nome];
  var def = esquemaTabela_(nome), vals = this.aba(nome).getDataRange().getValues(), cols = def.colunas, out = [];
  for (var i = 1; i < vals.length; i++) {
    var o = { __linha: i + 1 }, vazia = true;
    for (var j = 0; j < cols.length; j++) { var v = deCelula_(cols[j], vals[i][j]); o[cols[j].nome] = v; if (v !== null) vazia = false; }
    if (!vazia) out.push(o);
  }
  this.cache[nome] = out; this.doSheet[nome] = true; this.ultima[nome] = vals.length;
  return out;
};
Banco.prototype.achar = function (nome, id) {
  var pk = esquemaTabela_(nome).pk, l = this.t(nome);
  for (var i = 0; i < l.length; i++) if (l[i][pk] === id) return l[i];
  return null;
};
Banco.prototype.contar = function (nome) { return this.t(nome).length; };
function normalizar_(def, o, linha) {
  var r = { __linha: linha };
  def.colunas.forEach(function (c) { r[c.nome] = deCelula_(c, paraCelula_(c, o[c.nome])); });
  return r;
}

/* ---------- escrita ---------- */
Banco.prototype.anexar = function (nome, objs) {
  if (!objs.length) return;
  this.usadas[nome] = true;
  var def = esquemaTabela_(nome), sh = this.aba(nome), cols = def.colunas, self = this;
  var rows = objs.map(function (o) { return cols.map(function (c) { return paraCelula_(c, o[c.nome]); }); });
  var r0 = (this.ultima[nome] || sh.getLastRow()) + 1, fim = r0 + rows.length - 1;
  if (this.P.INSTALACAO !== String(VERSAO_INSTALACAO_)) formatarLinhas_(sh, def, r0, rows.length);   // instalação atrasada: garante formato texto nas linhas novas
  try {
    sh.getRange(r0, 1, rows.length, cols.length).setValues(rows);
  } catch (e) {
    var max = sh.getMaxRows();   // a aba encheu: amplia e formata as linhas novas
    if (fim <= max) throw e;
    var extra = Math.max(fim - max, 1000);
    sh.insertRowsAfter(max, extra);
    formatarLinhas_(sh, def, max + 1, extra);
    sh.getRange(r0, 1, rows.length, cols.length).setValues(rows);
  }
  this.ultima[nome] = fim;
  if (this.cache[nome]) objs.forEach(function (o, i) { self.cache[nome].push(normalizar_(def, o, r0 + i)); });
  else { var pk = def.pk; this.pos[nome] = this.pos[nome] || {}; objs.forEach(function (o, i) { self.pos[nome][o[pk]] = r0 + i; }); }
  this.sujo_(nome);
};
Banco.prototype.atualizar = function (nome, id, patch) {
  var def = esquemaTabela_(nome), cols = def.colunas, atual = null, linha = null;
  if (this.cache[nome]) { atual = this.achar(nome, id); if (atual) linha = atual.__linha; }
  else if (this.pos[nome] && this.pos[nome][id]) linha = this.pos[nome][id];
  else { atual = this.achar(nome, id); if (atual) linha = atual.__linha; }
  if (!linha) throw new Error('Registro não encontrado em ' + nome + ': ' + id);
  var sh = this.aba(nome), chaves = Object.keys(patch).filter(function (k) { return cols.some(function (c) { return c.nome === k; }); });
  function col(k) { for (var i = 0; i < cols.length; i++) if (cols[i].nome === k) return i; return -1; }
  if (chaves.length === 1) {
    sh.getRange(linha, col(chaves[0]) + 1).setValue(paraCelula_(cols[col(chaves[0])], patch[chaves[0]]));
  } else if (atual) {
    var novo = Object.assign({}, atual, patch);
    if (this.P.INSTALACAO !== String(VERSAO_INSTALACAO_)) formatarLinhas_(sh, def, linha, 1);
    sh.getRange(linha, 1, 1, cols.length).setValues([cols.map(function (c) { return paraCelula_(c, novo[c.nome]); })]);
  } else {
    var rg = sh.getRange(linha, 1, 1, cols.length), vals = rg.getValues()[0];
    chaves.forEach(function (k) { vals[col(k)] = paraCelula_(cols[col(k)], patch[k]); });
    rg.setValues([vals]);
  }
  if (atual) chaves.forEach(function (k) { atual[k] = deCelula_(cols[col(k)], paraCelula_(cols[col(k)], patch[k])); });
  this.sujo_(nome);
};
Banco.prototype.limpar = function (nome) {
  var sh = this.aba(nome), n = sh.getLastRow();
  if (n >= 2) sh.getRange(2, 1, n - 1, esquemaTabela_(nome).colunas.length).clearContent();
  this.cache[nome] = []; this.ultima[nome] = 1; delete this.pos[nome]; this.sujo_(nome);
};
Banco.prototype.reescrever = function (nome, objs) { this.limpar(nome); this.anexar(nome, objs); };

/* gravação: filhos e livros primeiro; a linha-mãe por último é o "commit" */
Banco.prototype.gravar = function (plano) {
  var self = this;
  (plano.filhos || []).forEach(function (f) { if (f.linhas.length) self.anexar(f.tabela, f.linhas); });
  this.anexar(plano.mae.tabela, [plano.mae.obj]);
};
Banco.prototype.proximoNumero = function (tabela) {
  var r = this.achar('sequencia', tabela);
  if (r) { var n = r.ultimo + 1; this.atualizar('sequencia', tabela, { ultimo: n }); return n; }
  this.anexar('sequencia', [{ tabela: tabela, ultimo: 1 }]);
  return 1;
};
Banco.prototype.log = function (ctx, acao, tabela, idReg, resultado, detalhe) {
  try {
    this.anexar('log_sistema', [{ id: Utilities.getUuid(), data_hora: ctx.agora.dataHora, usuario_id: ctx.usuarioId || null, acao: acao, tabela: tabela || null, id_registro: idReg || null, resultado: resultado, detalhe: detalhe ? String(detalhe).slice(0, 240) : null }]);
  } catch (e) { /* o log nunca derruba a operação */ }
};

/* ================= instalação ================= */
var META_ESQUEMA_ = ['tabela', 'grupo', 'posicao', 'coluna', 'tipo', 'tipo_mysql', 'nulo', 'chave', 'referencia', 'descricao_tabela'];
var META_VERSAO_ = ['versao', 'aplicada_em', 'descricao'];

/* cria o cabeçalho; se a aba é de uma versão anterior e só faltam colunas NO FIM, acrescenta (e devolve os nomes) */
function garantirCabecalho_(sh, nomes, cor) {
  var n = nomes.length, adicionadas = [];
  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, n).setNumberFormats([nomes.map(function () { return '@'; })]);
    sh.getRange(1, 1, 1, n).setValues([nomes]);
  } else {
    var atual = sh.getRange(1, 1, 1, Math.max(n, sh.getLastColumn())).getValues()[0].map(String), usadas = atual.length;
    while (usadas > 0 && atual[usadas - 1] === '') usadas--;
    var prefixoOk = usadas <= n;
    for (var i = 0; i < Math.min(usadas, n); i++) if (atual[i] !== nomes[i]) prefixoOk = false;
    if (!prefixoOk) throw new Error('O cabeçalho da aba "' + sh.getName() + '" não confere com o esquema. Não mexa nas colunas pela planilha.');
    if (usadas < n) {
      adicionadas = nomes.slice(usadas);
      sh.getRange(1, usadas + 1, 1, adicionadas.length).setNumberFormats([adicionadas.map(function () { return '@'; })]);
      sh.getRange(1, usadas + 1, 1, adicionadas.length).setValues([adicionadas]);
    }
  }
  sh.getRange(1, 1, 1, n).setFontWeight('bold').setBackground(cor).setFontColor('#FFFFFF');
  sh.setFrozenRows(1);
  sh.setTabColor(cor);
  sh.setColumnWidths(1, n, 140);
  return adicionadas;
}

/* valor inicial das colunas acrescentadas em planilhas que já existiam */
function preencherColunaNova_(sh, def, coluna, ss) {
  var n = sh.getLastRow() - 1;
  if (n < 1) return;
  var idx = def.colunas.map(function (c) { return c.nome; }).indexOf(coluna) + 1, ids = sh.getRange(2, 1, n, 1).getValues();
  if (def.nome === 'venda' && coluna === 'desconto_centavos') sh.getRange(2, idx, n, 1).setValues(ids.map(function () { return [0]; }));
  if (def.nome === 'venda_item' && coluna === 'tamanho_ml') {
    var pv = ss.getSheetByName('produto_variante'), tam = {};
    if (pv && pv.getLastRow() > 1) pv.getRange(2, 1, pv.getLastRow() - 1, 3).getValues().forEach(function (r) { tam[r[0]] = Number(r[2]); });
    var iv = def.colunas.map(function (c) { return c.nome; }).indexOf('variante_id') + 1, vars = sh.getRange(2, iv, n, 1).getValues();
    sh.getRange(2, idx, n, 1).setValues(vars.map(function (r) { return [tam[r[0]] || '']; }));
  }
  if (def.nome === 'receita_cafe' && coluna === 'base') sh.getRange(2, idx, n, 1).setValues(ids.map(function () { return ['CAFE']; }));
  if (def.nome === 'receita_cafe' && coluna === 'leite_ml_por_litro') sh.getRange(2, idx, n, 1).setValues(ids.map(function () { return [0]; }));
  if (def.nome === 'preparo' && coluna === 'base') sh.getRange(2, idx, n, 1).setValues(ids.map(function () { return ['CAFE']; }));
  if (def.nome === 'preparo' && coluna === 'materiais_status') sh.getRange(2, idx, n, 1).setValues(ids.map(function () { return ['LANCADO']; }));
  if (def.nome === 'material' && coluna === 'controla_estoque') sh.getRange(2, idx, n, 1).setValues(ids.map(function (r) { return [r[0] !== 'mat-agua']; }));
}

/* planilhas instaladas antes só tinham a receita do café: cria a padrão do café com leite (água e leite no preparo) */
function migrarReceitaLeite_(db, sem) {
  var rec = db.t('receita_cafe'), temLeite = rec.some(function (r) { return r.base === 'CAFE_LEITE' && !r.usuario_id && !r.vigente_ate; });
  if (temLeite || !rec.length) return;
  var modelo = sem.receita_cafe.filter(function (r) { return r.base === 'CAFE_LEITE'; })[0];
  if (modelo) db.anexar('receita_cafe', [Object.assign({}, modelo, { id: 'rec-leite' })]);
}

function instalarPlanilha_(ss, agoraIso) {
  limparCache_();
  var db = new Banco(ss, { semCache: true }), nomes = {};
  ss.getSheets().forEach(function (s) { nomes[s.getName()] = true; });
  var criadas = [];
  esquema_().forEach(function (def, idx) {
    var sh = ss.getSheetByName(def.nome) || ss.insertSheet(def.nome);
    if (!nomes[def.nome]) criadas.push(def.nome);
    var novas = garantirCabecalho_(sh, def.colunas.map(function (c) { return c.nome; }), CORES_GRUPO_[def.grupo]);
    formatarLinhas_(sh, def, 2, sh.getMaxRows() - 1);   // texto continua texto, em todas as linhas da aba
    novas.forEach(function (col) { preencherColunaNova_(sh, def, col, ss); });
    def.colunas.forEach(function (c, i) {
      if (c.tipo === 'enum') sh.getRange(2, i + 1, 998, 1).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(c.valores, true).setAllowInvalid(false).build());
    });
  });
  var shE = ss.getSheetByName('_esquema') || ss.insertSheet('_esquema');
  garantirCabecalho_(shE, META_ESQUEMA_, CORES_GRUPO_.meta);
  var shV = ss.getSheetByName('_versao') || ss.insertSheet('_versao');
  garantirCabecalho_(shV, META_VERSAO_, CORES_GRUPO_.meta);
  ['Planilha1', 'Sheet1', 'Página1'].forEach(function (n) {
    var s = ss.getSheetByName(n);
    if (s && s.getLastRow() <= 1 && ss.getSheets().length > 1) ss.deleteSheet(s);
  });
  // dicionário de dados
  var linhas = [];
  esquema_().forEach(function (def) {
    def.colunas.forEach(function (c, i) {
      linhas.push([def.nome, def.grupo, i + 1, c.nome, c.tipo === 'enum' ? 'enum(' + c.valores.join('|') + ')' : c.tipo, tipoMySQL_(c), c.nulo ? 'sim' : 'não', c.pk ? 'PK' : c.unico ? 'único' : '', c.fk || '', i === 0 ? def.desc : '']);
    });
  });
  if (shE.getLastRow() > 1) shE.getRange(2, 1, shE.getLastRow() - 1, META_ESQUEMA_.length).clearContent();
  shE.getRange(2, 1, linhas.length, META_ESQUEMA_.length).setNumberFormats(linhas.map(function () { return META_ESQUEMA_.map(function () { return '@'; }); }));
  shE.getRange(2, 1, linhas.length, META_ESQUEMA_.length).setValues(linhas);
  var vers = shV.getLastRow() > 1 ? shV.getRange(2, 1, shV.getLastRow() - 1, 1).getValues().map(function (r) { return Number(r[0]); }) : [];
  if (vers.indexOf(VERSAO_ESQUEMA) < 0) {
    var rg = shV.getRange(shV.getLastRow() + 1, 1, 1, 3);
    rg.setNumberFormats([['0', '@', '@']]);
    rg.setValues([[VERSAO_ESQUEMA, agoraIso, 'Esquema versão ' + VERSAO_ESQUEMA]]);
  }
  // dados iniciais dos cadastros (só se a aba estiver vazia)
  var sem = sementes_(agoraIso);
  Object.keys(sem).forEach(function (t) { if (db.contar(t) === 0) db.anexar(t, sem[t]); });
  migrarReceitaLeite_(db, sem);
  ordenarAbas_(ss);
  PropertiesService.getScriptProperties().setProperty('INSTALACAO', String(VERSAO_INSTALACAO_));
  limparCache_();
  return { criadas: criadas, abas: esquema_().length + 2 };
}

function ordenarAbas_(ss) {
  var ordem = ['cadastro', 'movimento', 'livro', 'controle'], pos = 1;
  ordem.forEach(function (g) {
    esquema_().filter(function (d) { return d.grupo === g; }).forEach(function (d) {
      var sh = ss.getSheetByName(d.nome); ss.setActiveSheet(sh); ss.moveActiveSheet(pos++);
    });
  });
  ['_esquema', '_versao'].forEach(function (n) { var sh = ss.getSheetByName(n); ss.setActiveSheet(sh); ss.moveActiveSheet(pos++); });
}

/* só o dono edita; o sistema (que roda como dono) continua gravando.
   Cada aba é tratada separada: uma já travada ou com problema não impede as outras. */
function protegerAbas_(ss) {
  var eu = Session.getEffectiveUser(), r = { travadas: 0, jaEstavam: 0, falhas: [], total: 0 };
  ss.getSheets().forEach(function (sh) {
    r.total++;
    try {
      var ps = sh.getProtections(SpreadsheetApp.ProtectionType.SHEET), p = ps.length ? ps[0] : sh.protect();
      p.setDescription('CoffeCommit: use o sistema para registrar');
      p.addEditor(eu);
      var outros = p.getEditors().filter(function (u) { return u.getEmail() !== eu.getEmail(); });
      if (outros.length) p.removeEditors(outros);
      if (p.canDomainEdit()) p.setDomainEdit(false);
      r.travadas++;
    } catch (e) {
      if (/protegid|protected/i.test(String(e && e.message))) r.jaEstavam++;     // já estava travada: tudo certo
      else r.falhas.push(sh.getName() + ': ' + (e && e.message));
    }
  });
  return r;
}

/* apaga movimentos, livros e controle (cadastros ficam). Só pelo menu do dono. */
function zerarMovimentos_(ss, agoraIso) {
  limparCache_();
  var db = new Banco(ss, { semCache: true });
  esquema_().filter(function (d) { return d.grupo !== 'cadastro'; }).forEach(function (d) { db.limpar(d.nome); });
  var reais = db.t('cliente').filter(function (c) { return c.origem !== 'EXEMPLO'; }).map(function (c) { var o = Object.assign({}, c); delete o.__linha; return o; });
  db.reescrever('cliente', reais);
  // os contadores de código de cliente e material não podem voltar atrás (códigos são únicos)
  function maxSufixo(lista, campo) { var m = 0; lista.forEach(function (x) { var n = parseInt(String(x[campo]).replace(/\D/g, ''), 10); if (n > m) m = n; }); return m; }
  var mc = maxSufixo(reais, 'codigo'), mm = maxSufixo(db.t('material').filter(function (x) { return /^MAT/.test(x.codigo); }), 'codigo');
  if (mc) db.anexar('sequencia', [{ tabela: 'cliente', ultimo: mc }]);
  if (mm) db.anexar('sequencia', [{ tabela: 'material', ultimo: mm }]);
  limparCache_();
  return true;
}
