/**
 * Codigo.gs — pontos de entrada.
 *  - doGet / incluir : serve o Web App
 *  - api             : ÚNICA função chamada pelo celular (google.script.run)
 *  - menu da planilha: instalar, exemplos, zerar, auditar, DDL, CSV, rotinas
 *
 * Dica: o Apps Script carrega os arquivos em ordem alfabética; por isso nada aqui usa funções de
 * outros arquivos em tempo de carga (só dentro de funções).
 */

var FUSO_ = 'America/Bahia';

function doGet() {
  return HtmlService.createTemplateFromFile('Index').evaluate()
    .setTitle('CoffeCommit')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}
/* tira qualquer texto solto antes da primeira tag (acontece ao copiar e colar o arquivo com o título junto) */
function incluir(nome) { return HtmlService.createHtmlOutputFromFile(nome).getContent().replace(/^[^<]*/, ''); }

/* ---------- relógio e planilha ---------- */
function agora_() {
  if (typeof AGORA_TESTE === 'function') return AGORA_TESTE();
  var d = new Date();
  return { dataHora: d.toISOString(), diaLocal: Utilities.formatDate(d, FUSO_, 'yyyy-MM-dd') };
}
function formatarLocal_(iso, padrao) { return Utilities.formatDate(new Date(iso), FUSO_, padrao); }
function planilhaDe_(P) {
  if (P.PLANILHA_ID) return SpreadsheetApp.openById(P.PLANILHA_ID);
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('Planilha não encontrada. Rode o menu CoffeCommit > Instalar / atualizar planilha.');
  return ss;
}
function planilha_() { return planilhaDe_(lerProps_()); }
function comTrava_(fn) {
  var lock = LockService.getScriptLock();
  try { lock.waitLock(25000); } catch (e) { falha_('O sistema está ocupado. Tente de novo em instantes.'); }
  try { return fn(); } finally { lock.releaseLock(); }
}
function resp_(obj) { return JSON.stringify(obj); }

function rotas_() {
  return {
    'venda.registrar': cmdVenda_, 'preparo.registrar': cmdPreparo_, 'compra.registrar': cmdCompra_,
    'cafe.perda': cmdPerdaCafe_, 'cafe.acerto': cmdAcertoCafe_, 'estoque.mover': cmdMoverEstoque_,
    'dia.fechar': cmdFecharDia_, 'dia.reabrir': cmdReabrirDia_, 'financeiro.lancar': cmdLancamento_,
    'estornar': cmdEstornar_, 'cliente.salvar': cmdClienteSalvar_, 'cliente.ativo': cmdClienteAtivo_,
    'sorteio.novo': cmdNovoSorteio_, 'config.salvar': cmdConfig_, 'preco.alterar': cmdPreco_,
    'variante.ativo': cmdVarianteAtivo_, 'material.salvar': cmdMaterialSalvar_, 'receita.salvar': cmdReceita_,
    'composicao.salvar': cmdComposicao_, 'promocao.salvar': cmdPromocao_,
    'estoque.contar': cmdContarEstoque_, 'lista.salvar': cmdListaSalvar_, 'receita.padrao': cmdReceitaPadrao_,
    'preparo.materiais': cmdPreparoMateriais_, 'consumo.registrar': cmdConsumo_, 'variante.salvar': cmdVarianteSalvar_
  };
}

/* ---------- API única ---------- */
/* chave que lembra quais tabelas cada rota costuma usar, para buscá-las do cache de uma vez */
function rotaKey_(nome, p) {
  var k = nome;
  if (nome === 'ver') k += ':' + p.tela + ':' + (p.sub || '');
  else if (p._ver) k += '>' + p._ver.tela + ':' + (p._ver.sub || '');
  return 'uso:' + k;
}

function pendentesSeguro_(db) { try { return contarPendentes_(db); } catch (e) { return 0; } }

function executar_(db, usuarioId, nome, p, escrita) {
  // instalação atrasada NÃO trava o app (venda e estoque seguem funcionando); só avisa na tela
  var atrasada = db.P.INSTALACAO !== String(VERSAO_INSTALACAO_);
  db.prefetch(['usuario'], rotaKey_(nome, p));
  if (nome === 'publico') {
    var pub = { ok: true, usuarios: db.t('usuario').filter(ativoOk_).map(function (u) { return { id: u.id, nome: u.nome }; }) };
    db.finalizar(false);
    return pub;
  }
  var sessao = identificar_(db, usuarioId);
  if (!sessao) { db.finalizar(false); return { ok: false, sessao: false, erro: 'Escolha quem você é neste aparelho.' }; }
  var ctx = { usuarioId: sessao.usuarioId, agora: agora_() }, r, rotas = rotas_();
  db.ctx_ = ctx;
  try {
    var u = usuarioAtivo_(db, ctx.usuarioId);
    if (nome === 'sessao') r = { usuario: { id: u.id, nome: u.nome } };
    else if (nome === 'ver') r = ver_(db, ctx, p);
    else if (nome === 'cliente.buscar') r = buscarClientesVenda_(db, ctx, p);
    else if (nome === 'cliente.mascarado') r = { cliente: clienteMascarado_(db, ctx, p) };
    else if (nome === 'sistema.auditar') r = auditar_(db.planilha());
    else if (rotas[nome]) r = rotas[nome](db, ctx, p) || {};
    else falha_('Operação desconhecida.');
    r = r || {};
    if (nome === 'ver') r.pend = pendentesSeguro_(db);
    if (p._ver && nome !== 'ver') {
      // se a tela falhar DEPOIS de gravar, o registro continua valendo: devolve o resultado sem a tela
      try { r.view = ver_(db, ctx, p._ver); r.pend = r.view.pend = pendentesSeguro_(db); } catch (e) { r.viewErro = (e && e.message) || 'tela indisponível'; }
    }
  } finally { db.finalizar(escrita); }
  r.ok = true;
  if (atrasada) r.atualizar = true;
  return r;
}

function api(usuarioId, nome, pJson) {
  var db = null;
  try {
    var p = pJson ? JSON.parse(pJson) : {};
    function criar() { var P = lerProps_(); db = new Banco(function () { return planilhaDe_(P); }, { props: P }); return db; }   // a planilha só é aberta se precisar
    if (rotas_()[nome]) return resp_(comTrava_(function () { return executar_(criar(), usuarioId, nome, p, true); }));   // escrita: uma de cada vez
    return resp_(executar_(criar(), usuarioId, nome, p, false));
  } catch (e) {
    if (e && e.erroNegocio) return resp_({ ok: false, erro: e.message });
    try { if (db && db.ctx_) db.log(db.ctx_, nome, null, null, 'ERRO', e && e.message); } catch (e2) { /* ignora */ }
    console.error(e && e.stack ? e.stack : e);
    return resp_({ ok: false, erro: 'Erro interno: ' + (e && e.message ? e.message : e) });
  }
}

/* edição manual na planilha: o cache pode ter ficado velho, então é descartado */
function onEdit() { limparCache_(); }

/* ---------- menu da planilha (só o dono) ---------- */
function onOpen() {
  SpreadsheetApp.getUi().createMenu('CoffeCommit')
    .addItem('Instalar / atualizar planilha', 'menuInstalar')
    .addSeparator()
    .addItem('Carregar dados de exemplo', 'menuExemplos')
    .addItem('Zerar movimentos (antes do uso real)', 'menuZerar')
    .addSeparator()
    .addItem('Auditar dados', 'menuAuditar')
    .addItem('Limpar cache (se algo parecer velho)', 'menuLimparCache')
    .addItem('Ver esquema do MySQL (DDL)', 'menuDDL')
    .addItem('Exportar CSV para o Drive', 'menuCSV')
    .addSeparator()
    .addItem('Instalar rotinas (backup diário)', 'menuRotinas')
    .addItem('Mostrar link do app', 'menuLink')
    .addToUi();
}
function ui_() { return SpreadsheetApp.getUi(); }
function menuInstalar() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  PropertiesService.getScriptProperties().setProperty('PLANILHA_ID', ss.getId());
  ss.setSpreadsheetTimeZone(FUSO_);
  var r = instalarPlanilha_(ss, new Date().toISOString()), aviso = '';
  try {
    var pr = protegerAbas_(ss);
    aviso = '\n\nAbas travadas contra edição manual: ' + (pr.travadas + pr.jaEstavam) + ' de ' + pr.total + '.' + (pr.falhas.length ? '\nNão consegui travar: ' + pr.falhas.slice(0, 3).join('; ') + '. O app funciona normalmente.' : '');
  } catch (e) { aviso = '\n\nAtenção: não consegui travar as abas contra edição manual (' + e.message + '). O app funciona normalmente.'; }
  ui_().alert('Planilha instalada', r.abas + ' abas prontas (' + r.criadas.length + ' novas). Agora é só implantar o app e abrir o link no celular.' + aviso, ui_().ButtonSet.OK);
}
function menuExemplos() {
  var ok = ui_().alert('Carregar dados de exemplo', 'Cria compras, um preparo, vendas e dois clientes de exemplo, para você testar. Depois use "Zerar movimentos" antes do uso real. Continuar?', ui_().ButtonSet.YES_NO);
  if (ok !== ui_().Button.YES) return;
  try { carregarExemplos_(planilha_(), agora_()); ui_().alert('Exemplos carregados.'); } catch (e) { ui_().alert(e.message); }
}
function menuZerar() {
  var r = ui_().prompt('Zerar movimentos', 'Apaga compras, preparos, vendas, perdas, lançamentos, números do sorteio e os clientes de exemplo. Os cadastros de materiais, produtos e receitas ficam.\n\nIsso NÃO pode ser desfeito. Digite ZERAR para confirmar.', ui_().ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui_().Button.OK || r.getResponseText().trim() !== 'ZERAR') { ui_().alert('Nada foi apagado.'); return; }
  zerarMovimentos_(planilha_(), new Date().toISOString());
  ui_().alert('Movimentos zerados.');
}
function menuAuditar() {
  var r = auditar_(planilha_());
  var txt = r.limpo ? 'Tudo certo: nenhum erro encontrado.' : r.erros + ' erro(s) e ' + r.alertas + ' alerta(s).';
  if (r.achados.length) txt += '\n\n' + r.achados.slice(0, 12).map(function (a) { return '[' + a.nivel + '] ' + a.tabela + ' ' + a.id + ': ' + a.msg; }).join('\n');
  ui_().alert('Auditoria', txt, ui_().ButtonSet.OK);
}
function menuDDL() {
  var html = HtmlService.createHtmlOutput('<textarea style="width:100%;height:92%;font-family:monospace;font-size:12px">' + gerarDDL_().replace(/&/g, '&amp;').replace(/</g, '&lt;') + '</textarea>').setWidth(900).setHeight(600);
  ui_().showModalDialog(html, 'Esquema do MySQL (copie e use no MySQL)');
}
function menuCSV() {
  try { ui_().alert('Exportação pronta', 'Pasta criada no seu Drive:\n' + exportarCSV_(planilha_(), agora_()), ui_().ButtonSet.OK); } catch (e) { ui_().alert('Não foi possível exportar: ' + e.message); }
}
function menuRotinas() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'rotinaNoturna') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('rotinaNoturna').timeBased().everyDays(1).atHour(23).create();
  ui_().alert('Rotina instalada: todo dia por volta das 23h faz o backup e a auditoria.');
}
function menuLimparCache() { limparCache_(); ui_().alert('Cache limpo. O próximo toque no app lê tudo da planilha de novo.'); }
function menuLink() {
  var url = ScriptApp.getService().getUrl();
  ui_().alert('Link do app', url ? url : 'Ainda não há implantação. Em Implantar > Nova implantação > App da Web: executar como "Eu", acesso "Qualquer pessoa com Conta Google".', ui_().ButtonSet.OK);
}

/* ---------- rotina noturna: backup + auditoria ---------- */
function rotinaNoturna() {
  var ss = planilha_(), ag = agora_(), db = new Banco(ss);
  var ctx = { usuarioId: 'usr-sistema', agora: ag };
  try {
    var it = DriveApp.getFoldersByName('CoffeCommit backups'), pasta = it.hasNext() ? it.next() : DriveApp.createFolder('CoffeCommit backups');
    DriveApp.getFileById(ss.getId()).makeCopy('CoffeCommit backup ' + ag.diaLocal, pasta);
    var files = pasta.getFiles(), limite = Date.now() - 14 * 24 * 3600 * 1000;
    while (files.hasNext()) { var f = files.next(); if (f.getDateCreated().getTime() < limite) f.setTrashed(true); }
    db.log(ctx, 'backup', null, null, 'OK', 'cópia criada');
  } catch (e) { db.log(ctx, 'backup', null, null, 'ERRO', e.message); }
  var a = auditar_(ss);
  db.log(ctx, 'auditoria', null, null, a.limpo ? 'OK' : 'ERRO', a.erros + ' erro(s), ' + a.alertas + ' alerta(s)');
}
