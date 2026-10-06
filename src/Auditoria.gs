/**
 * Auditoria.gs — confere a integridade da planilha e prepara a ida para o MySQL.
 *   auditar_(ss)    → procura problemas (chaves, tipos, FKs, livros, estoque negativo, gravações incompletas)
 *   gerarDDL_()     → CREATE TABLE do MySQL gerado do Esquema.gs
 *   exportarCSV_()  → um CSV por aba (colunas na ordem do esquema) + schema.sql, numa pasta do Drive
 */
var RX_DT_ = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/;
var RX_DIA_ = /^\d{4}-\d{2}-\d{2}$/;

function auditar_(ss) {
  var db = new Banco(ss, { semCache: true }), achados = [], contagens = {};
  function A(nivel, tabela, id, msg) { achados.push({ nivel: nivel, tabela: tabela, id: id, msg: msg }); }
  var existe = {};
  function tem(tab, id) { if (!existe[tab]) { existe[tab] = {}; db.t(tab).forEach(function (r) { existe[tab][r[esquemaTabela_(tab).pk]] = true; }); } return !!existe[tab][id]; }

  esquema_().forEach(function (def) {
    var linhas = db.t(def.nome), vistos = {}, uniq = {};
    contagens[def.nome] = linhas.length;
    linhas.forEach(function (r) {
      var pk = r[def.pk];
      if (pk === null) A('ERRO', def.nome, 'linha ' + r.__linha, 'chave primária vazia');
      else if (vistos[pk]) A('ERRO', def.nome, pk, 'chave primária duplicada');
      vistos[pk] = true;
      def.colunas.forEach(function (c) {
        var v = r[c.nome];
        if (v === null) { if (!c.nulo && c.tipo !== 'bool') A('ERRO', def.nome, pk, 'coluna ' + c.nome + ' vazia'); return; }
        if (c.tipo === 'dt' && !RX_DT_.test(v)) A('ERRO', def.nome, pk, c.nome + ' não está no formato ISO UTC: ' + v);
        if (c.tipo === 'dia' && !RX_DIA_.test(v)) A('ERRO', def.nome, pk, c.nome + ' não está no formato AAAA-MM-DD: ' + v);
        if (c.tipo === 'enum' && c.valores.indexOf(v) < 0) A('ERRO', def.nome, pk, c.nome + ' fora da lista: ' + v);
        if ((c.tipo === 'int' || c.tipo === 'cent' || c.tipo === 'qtd') && isNaN(v)) A('ERRO', def.nome, pk, c.nome + ' não é número: ' + v);
        if (c.fk && !tem(c.fk, v)) A('ERRO', def.nome, pk, c.nome + ' aponta para ' + c.fk + ' inexistente: ' + v);
        if (c.unico) { var k = c.nome + ':' + String(v).toLowerCase(); if (uniq[k]) A('ERRO', def.nome, pk, 'valor duplicado em ' + c.nome + ': ' + v); uniq[k] = true; }
      });
      if (r.status === 'GRAVANDO') A('ALERTA', def.nome, pk, 'gravação incompleta (ficou GRAVANDO)');
    });
  });

  // livros sem registro de origem = gravação interrompida no meio (inerte: não entra em saldo, mas convém limpar)
  ['movimento_estoque', 'movimento_cafe'].forEach(function (l) {
    var ids = {}; db.t(l).forEach(function (m) { if (m.estorno_de_id) return; var t = m.origem_tabela; if (!ids[t]) { ids[t] = {}; db.t(t).forEach(function (r) { ids[t][r.id] = true; }); } if (!ids[t][m.origem_id]) A('ALERTA', l, m.id, 'linha do livro sem o registro de origem (' + t + ' ' + m.origem_id + '): gravação interrompida'); });
  });
  // estoque nunca negativo
  var sal = saldosEstoque_(db), mats = mapa_(db, 'material'), us = mapa_(db, 'usuario');
  Object.keys(sal).forEach(function (u) { Object.keys(sal[u]).forEach(function (m) { if (sal[u][m] < -1e-9) A('ALERTA', 'movimento_estoque', u + '/' + m, 'estoque negativo de ' + (mats[m] ? mats[m].nome : m) + ' para ' + (us[u] ? us[u].nome : u) + ': falta lançar uma compra ou fazer a contagem'); }); });

  // totais das vendas e compras
  var itV = {}; db.t('venda_item').forEach(function (i) { (itV[i.venda_id] = itV[i.venda_id] || []).push(i); });
  var numV = {}; db.t('numero_sorteio').forEach(function (n) { (numV[n.venda_id] = numV[n.venda_id] || []).push(n); });
  var cafeOrig = {}; db.t('movimento_cafe').forEach(function (m) { if (!m.estorno_de_id) cafeOrig[m.origem_tabela + ':' + m.origem_id] = (cafeOrig[m.origem_tabela + ':' + m.origem_id] || 0) + m.ml_cafe; });
  db.t('venda').forEach(function (v) {
    if (v.status === 'GRAVANDO') return;
    var its = itV[v.id] || [], tot = soma_(its, function (i) { return i.qtd * i.preco_unit_centavos; }), ml = soma_(its, function (i) { return i.qtd * i.ml_cafe_unit; });
    if (tot !== v.total_cafe_centavos + (v.desconto_centavos || 0)) A('ERRO', 'venda', v.id, 'total do café (' + v.total_cafe_centavos + ') mais o desconto (' + (v.desconto_centavos || 0) + ') difere da soma dos itens (' + tot + ')');
    if ((v.desconto_centavos || 0) > tot) A('ERRO', 'venda', v.id, 'desconto maior que o valor dos itens');
    if (Math.abs(ml - v.ml_cafe) > 1e-6) A('ERRO', 'venda', v.id, 'ml de café difere da soma dos itens');
    if (Math.abs((cafeOrig['venda:' + v.id] || 0) + v.ml_cafe) > 1e-6) A('ERRO', 'venda', v.id, 'livro do café não bate com a venda');
    var ns = numV[v.id] || [];
    if (soma_(ns, function (n) { return n.valor_centavos; }) !== v.total_sorteio_centavos) A('ERRO', 'venda', v.id, 'total do sorteio difere da soma dos números');
    if (ns.length && !v.cliente_id) A('ERRO', 'venda', v.id, 'venda com números do sorteio sem cliente');
  });
  var itCo = {}; db.t('consumo_proprio_item').forEach(function (i) { (itCo[i.consumo_id] = itCo[i.consumo_id] || []).push(i); });
  db.t('consumo_proprio').forEach(function (c) {
    if (c.status === 'GRAVANDO') return;
    if (Math.abs(soma_(itCo[c.id] || [], function (i) { return i.qtd * i.ml_cafe_unit; }) - c.ml_cafe) > 1e-6) A('ERRO', 'consumo_proprio', c.id, 'ml de café difere da soma dos itens');
    if (Math.abs((cafeOrig['consumo_proprio:' + c.id] || 0) + c.ml_cafe) > 1e-6) A('ERRO', 'consumo_proprio', c.id, 'livro do café não bate com o consumo');
  });
  var itC = {}; db.t('compra_item').forEach(function (i) { (itC[i.compra_id] = itC[i.compra_id] || []).push(i); });
  var estOrig = {}; db.t('movimento_estoque').forEach(function (m) { if (!m.estorno_de_id) estOrig[m.origem_tabela + ':' + m.origem_id] = (estOrig[m.origem_tabela + ':' + m.origem_id] || 0) + m.qtd; });
  db.t('compra').forEach(function (c) {
    if (c.status === 'GRAVANDO') return;
    var its = itC[c.id] || [];
    if (soma_(its, function (i) { return i.valor_centavos; }) !== c.valor_total_centavos) A('ERRO', 'compra', c.id, 'valor total difere da soma dos itens');
    if (Math.abs(soma_(its, function (i) { return i.qtd_base_qtd; }) - (estOrig['compra:' + c.id] || 0)) > 1e-6) A('ERRO', 'compra', c.id, 'livro do estoque não bate com a compra');
  });
  var cons = {}; db.t('preparo_consumo').forEach(function (c) { if (controla_(mats[c.material_id])) cons[c.preparo_id] = (cons[c.preparo_id] || 0) + c.qtd_real_qtd; });
  db.t('preparo').forEach(function (p) {
    if (p.status === 'GRAVANDO') return;
    if (Math.abs((cons[p.id] || 0) + (estOrig['preparo:' + p.id] || 0)) > 1e-6) A('ERRO', 'preparo', p.id, 'livro do estoque não bate com o consumo do preparo');
    if (Math.abs((cafeOrig['preparo:' + p.id] || 0) - p.litros * 1000) > 1e-6) A('ERRO', 'preparo', p.id, 'livro do café não bate com os litros');
  });
  // desfeitos: o líquido nos livros precisa ser zero e deve existir a linha em "estorno"
  var est = {}; db.t('estorno').forEach(function (e) { est[e.tabela_origem + ':' + e.id_origem] = true; });
  var liqE = {}, liqC = {};
  db.t('movimento_estoque').forEach(function (m) { var k = m.origem_tabela + ':' + m.origem_id; liqE[k] = (liqE[k] || 0) + m.qtd; });
  db.t('movimento_cafe').forEach(function (m) { var k = m.origem_tabela + ':' + m.origem_id; liqC[k] = (liqC[k] || 0) + m.ml_cafe; });
  TABELAS_ESTORNAVEIS_.forEach(function (t) {
    db.t(t).forEach(function (r) {
      if (r.status !== 'ESTORNADO') return;
      var k = t + ':' + r.id;
      if (!est[k]) A('ERRO', t, r.id, 'registro ESTORNADO sem linha em estorno');
      if (Math.abs(liqE[k] || 0) > 1e-6 || Math.abs(liqC[k] || 0) > 1e-6) A('ERRO', t, r.id, 'registro ESTORNADO com saldo líquido diferente de zero nos livros');
    });
  });
  // sorteios: só um aberto; número ativo não pode estar em sorteio cancelado
  var nAbertos = db.t('sorteio').filter(function (x) { return x.status === 'ABERTO'; }).length;
  if (nAbertos > 1) A('ERRO', 'sorteio', '-', 'há ' + nAbertos + ' sorteios abertos ao mesmo tempo');
  var sortMap = mapa_(db, 'sorteio');
  db.t('numero_sorteio').forEach(function (n) { var so = sortMap[n.sorteio_id]; if (so && so.status === 'CANCELADO' && n.status === 'ATIVO') A('ERRO', 'numero_sorteio', n.id, 'número ativo num sorteio cancelado'); });
  // dias fechados precisam estar zerados
  var dias = {}; db.t('fechamento_dia').forEach(function (f) { dias[f.dia_local] = f; });
  Object.keys(dias).forEach(function (d) { if (dias[d].status === 'FECHADO' && Math.abs(cafeDoDia_(db, d).saldo) > 1e-6) A('ERRO', 'fechamento_dia', d, 'dia fechado com diferença no café'); });
  // sequências
  db.t('sequencia').forEach(function (s) {
    if (!esquema_().some(function (d) { return d.nome === s.tabela; }) && ['cliente', 'material'].indexOf(s.tabela) < 0) A('ALERTA', 'sequencia', s.tabela, 'contador de tabela desconhecida');
    var maxN = 0; try { db.t(s.tabela).forEach(function (r) { var n = r.numero || r.rodada; if (n > maxN) maxN = n; }); } catch (e) { maxN = 0; }
    if (maxN > s.ultimo) A('ERRO', 'sequencia', s.tabela, 'contador (' + s.ultimo + ') menor que o maior número usado (' + maxN + ')');
  });

  var erros = achados.filter(function (a) { return a.nivel === 'ERRO'; }).length, alertas = achados.length - erros;
  return { limpo: erros === 0, erros: erros, alertas: alertas, achados: achados.slice(0, 60), contagens: contagens, versao: VERSAO_ESQUEMA };
}

/* ---------------- DDL do MySQL ---------------- */
function ordemDeCarga_() {
  var defs = esquema_(), feito = {}, ordem = [];
  function deps(d) { var s = {}; d.colunas.forEach(function (c) { if (c.fk && c.fk !== d.nome && !/^criado_por$|^atualizado_por$/.test(c.nome)) s[c.fk] = true; }); return Object.keys(s); }
  var restante = defs.slice(), guarda = 0;
  while (restante.length && guarda++ < 100) {
    restante = restante.filter(function (d) {
      if (deps(d).every(function (x) { return feito[x]; })) { feito[d.nome] = true; ordem.push(d.nome); return false; }
      return true;
    });
  }
  return ordem.concat(restante.map(function (d) { return d.nome; }));
}
function gerarDDL_() {
  var out = ['-- CoffeCommit \u2014 esquema MySQL gerado de Esquema.gs (versão ' + VERSAO_ESQUEMA + ')', 'SET NAMES utf8mb4;', 'SET FOREIGN_KEY_CHECKS = 0;', ''];
  var ordem = ordemDeCarga_(), fks = [];
  ordem.forEach(function (nome) {
    var d = esquemaTabela_(nome), linhas = [];
    d.colunas.forEach(function (c) { linhas.push('  `' + c.nome + '` ' + tipoMySQL_(c) + (c.nulo ? ' NULL' : ' NOT NULL')); });
    linhas.push('  PRIMARY KEY (`' + d.pk + '`)');
    d.colunas.forEach(function (c) { if (c.unico) linhas.push('  UNIQUE KEY `uq_' + nome + '_' + c.nome + '` (`' + c.nome + '`)'); });
    d.colunas.forEach(function (c) { if (c.tipo === 'cent') linhas.push('  CONSTRAINT `ck_' + nome + '_' + c.nome + '` CHECK (`' + c.nome + '` >= 0)'); });
    out.push('-- ' + d.desc);
    out.push('CREATE TABLE `' + nome + '` (\n' + linhas.join(',\n') + '\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;', '');
    d.colunas.forEach(function (c) { if (c.fk) fks.push('ALTER TABLE `' + nome + '` ADD CONSTRAINT `fk_' + nome + '_' + c.nome + '` FOREIGN KEY (`' + c.nome + '`) REFERENCES `' + c.fk + '` (`id`);'); });
  });
  out.push('-- chaves estrangeiras (depois de criar todas as tabelas)');
  out = out.concat(fks);
  out.push('', 'SET FOREIGN_KEY_CHECKS = 1;', '', '-- ordem de carga dos CSVs: ' + ordem.join(', '));
  return out.join('\n');
}

/* ---------------- CSV ---------------- */
function csvCampo_(v) {
  if (v === null || v === undefined) return '';
  if (v === true) return '1'; if (v === false) return '0';
  var s = String(v);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function csvDaTabela_(db, nome) {
  var d = esquemaTabela_(nome), linhas = [d.colunas.map(function (c) { return c.nome; }).join(',')];
  db.t(nome).forEach(function (r) { linhas.push(d.colunas.map(function (c) { return csvCampo_(r[c.nome]); }).join(',')); });
  return linhas.join('\n') + '\n';
}
function exportarCSV_(ss, agoraBase) {
  var db = new Banco(ss, { semCache: true }), carimbo = agoraBase.diaLocal + ' ' + formatarLocal_(agoraBase.dataHora, 'HHmm');
  var pasta = DriveApp.createFolder('CoffeCommit export ' + carimbo);
  ordemDeCarga_().forEach(function (n) { pasta.createFile(n + '.csv', csvDaTabela_(db, n), MimeType.CSV); });
  pasta.createFile('schema.sql', gerarDDL_(), MimeType.PLAIN_TEXT);
  return pasta.getUrl();
}
