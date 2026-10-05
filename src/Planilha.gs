/**
 * Planilha.gs — única camada que conhece o Google Planilhas.
 *
 * - leitura em bloco (uma chamada por aba), com cache só durante a execução;
 * - gravação guiada pelo esquema (ordem e tipos das colunas);
 * - gravação em duas fases: a linha-mãe entra como GRAVANDO, entram os filhos e os livros,
 *   e só no fim vira ATIVO. O que ficar pela metade é detectado pela auditoria;
 * - colunas de texto gravadas com formato texto, para o Sheets não transformar "0453" em 453.
 */

function Banco(ss) { this.ss = ss; this.cache = {}; this._mp = null; this._ov = null; }
Banco.prototype.invalidar = function () { this.cache = {}; this._mp = null; this._ov = null; };
Banco.prototype.aba = function (nome) {
  var s = this.ss.getSheetByName(nome);
  if (!s) throw new Error('Aba ausente: ' + nome + '. Use o menu CoffeCommit > Instalar / atualizar planilha.');
  return s;
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

/* lê a aba inteira como objetos; "__linha" guarda a posição para atualizações */
Banco.prototype.t = function (nome) {
  if (this.cache[nome]) return this.cache[nome];
  var def = esquemaTabela_(nome), sh = this.aba(nome), n = sh.getLastRow(), cols = def.colunas, out = [];
  if (n >= 2) {
    var vals = sh.getRange(2, 1, n - 1, cols.length).getValues();
    for (var i = 0; i < vals.length; i++) {
      var o = { __linha: i + 2 }, vazia = true;
      for (var j = 0; j < cols.length; j++) { var v = deCelula_(cols[j], vals[i][j]); o[cols[j].nome] = v; if (v !== null) vazia = false; }
      if (!vazia) out.push(o);
    }
  }
  this.cache[nome] = out;
  return out;
};
Banco.prototype.achar = function (nome, id) {
  var pk = esquemaTabela_(nome).pk, l = this.t(nome);
  for (var i = 0; i < l.length; i++) if (l[i][pk] === id) return l[i];
  return null;
};
Banco.prototype.contar = function (nome) { var sh = this.ss.getSheetByName(nome); return sh ? Math.max(0, sh.getLastRow() - 1) : 0; };

Banco.prototype.anexar = function (nome, objs) {
  if (!objs.length) return;
  var def = esquemaTabela_(nome), sh = this.aba(nome), cols = def.colunas;
  var fmt = cols.map(formatoColuna_);
  var rows = objs.map(function (o) { return cols.map(function (c) { return paraCelula_(c, o[c.nome]); }); });
  var r0 = Math.max(sh.getLastRow(), 1) + 1, ultima = r0 + rows.length - 1;
  // a aba nova tem 1.000 linhas; gravar além disso dá erro, então ampliamos antes
  if (ultima > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), Math.max(ultima - sh.getMaxRows(), 1000));
  var rg = sh.getRange(r0, 1, rows.length, cols.length);
  rg.setNumberFormats(rows.map(function () { return fmt; }));
  rg.setValues(rows);
  this.invalidar();
};
Banco.prototype.atualizar = function (nome, id, patch) {
  var def = esquemaTabela_(nome), alvo = this.achar(nome, id);
  if (!alvo) throw new Error('Registro não encontrado em ' + nome + ': ' + id);
  var sh = this.aba(nome), cols = def.colunas, rg = sh.getRange(alvo.__linha, 1, 1, cols.length), vals = rg.getValues()[0];
  cols.forEach(function (c, i) { if (Object.prototype.hasOwnProperty.call(patch, c.nome)) vals[i] = paraCelula_(c, patch[c.nome]); });
  rg.setNumberFormats([cols.map(formatoColuna_)]);
  rg.setValues([vals]);
  this.invalidar();
};
Banco.prototype.limpar = function (nome) {
  var sh = this.aba(nome), n = sh.getLastRow();
  if (n >= 2) sh.getRange(2, 1, n - 1, esquemaTabela_(nome).colunas.length).clearContent();
  this.invalidar();
};
Banco.prototype.reescrever = function (nome, objs) { this.limpar(nome); this.anexar(nome, objs); };

/* gravação em duas fases (ver cabeçalho do arquivo) */
Banco.prototype.gravar = function (plano) {
  var self = this, mae = plano.mae, final = mae.obj.status;
  var m = Object.assign({}, mae.obj); m.status = 'GRAVANDO';
  this.anexar(mae.tabela, [m]);
  (plano.filhos || []).forEach(function (f) { if (f.linhas.length) self.anexar(f.tabela, f.linhas); });
  this.atualizar(mae.tabela, mae.obj.id, { status: final });
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

function garantirCabecalho_(sh, nomes, cor) {
  var n = nomes.length;
  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, n).setNumberFormats([nomes.map(function () { return '@'; })]);
    sh.getRange(1, 1, 1, n).setValues([nomes]);
  } else {
    var atual = sh.getRange(1, 1, 1, Math.max(n, sh.getLastColumn())).getValues()[0], ok = true;
    for (var i = 0; i < n; i++) if (String(atual[i]) !== nomes[i]) ok = false;
    for (var k = n; k < atual.length; k++) if (atual[k] !== '') ok = false;
    if (!ok) throw new Error('O cabeçalho da aba "' + sh.getName() + '" não confere com o esquema. Não mexa nas colunas pela planilha.');
  }
  sh.getRange(1, 1, 1, n).setFontWeight('bold').setBackground(cor).setFontColor('#FFFFFF');
  sh.setFrozenRows(1);
  sh.setTabColor(cor);
  sh.setColumnWidths(1, n, 140);
}

function instalarPlanilha_(ss, agoraIso) {
  var db = new Banco(ss), nomes = {};
  ss.getSheets().forEach(function (s) { nomes[s.getName()] = true; });
  var criadas = [];
  esquema_().forEach(function (def, idx) {
    var sh = ss.getSheetByName(def.nome) || ss.insertSheet(def.nome);
    if (!nomes[def.nome]) criadas.push(def.nome);
    garantirCabecalho_(sh, def.colunas.map(function (c) { return c.nome; }), CORES_GRUPO_[def.grupo]);
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
  ordenarAbas_(ss);
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

/* só o dono edita; o sistema (que roda como dono) continua gravando */
function protegerAbas_(ss) {
  var eu = Session.getEffectiveUser();
  ss.getSheets().forEach(function (sh) {
    var ps = sh.getProtections(SpreadsheetApp.ProtectionType.SHEET), p = ps.length ? ps[0] : sh.protect();
    p.setDescription('CoffeCommit: use o sistema para registrar');
    p.addEditor(eu);
    var outros = p.getEditors().filter(function (u) { return u.getEmail() !== eu.getEmail(); });
    if (outros.length) p.removeEditors(outros);
    if (p.canDomainEdit()) p.setDomainEdit(false);
  });
}

/* apaga movimentos, livros e controle (cadastros ficam). Só pelo menu do dono. */
function zerarMovimentos_(ss, agoraIso) {
  var db = new Banco(ss);
  esquema_().filter(function (d) { return d.grupo !== 'cadastro'; }).forEach(function (d) { db.limpar(d.nome); });
  var reais = db.t('cliente').filter(function (c) { return c.origem !== 'EXEMPLO'; }).map(function (c) { var o = Object.assign({}, c); delete o.__linha; return o; });
  db.reescrever('cliente', reais);
  // os contadores de código de cliente e material não podem voltar atrás (códigos são únicos)
  function maxSufixo(lista, campo) { var m = 0; lista.forEach(function (x) { var n = parseInt(String(x[campo]).replace(/\D/g, ''), 10); if (n > m) m = n; }); return m; }
  var mc = maxSufixo(reais, 'codigo'), mm = maxSufixo(db.t('material').filter(function (x) { return /^MAT/.test(x.codigo); }), 'codigo');
  if (mc) db.anexar('sequencia', [{ tabela: 'cliente', ultimo: mc }]);
  if (mm) db.anexar('sequencia', [{ tabela: 'material', ultimo: mm }]);
  return true;
}
