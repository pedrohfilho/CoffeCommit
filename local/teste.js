'use strict';
/**
 * teste.js — testes automáticos dos arquivos .gs (regras, planilha, PIN, estorno, sorteio, auditoria, DDL).
 * Roda os mesmos arquivos do Apps Script no ambiente simulado.
 */
const { carregar } = require('./carregar');

let total = 0, falhas = [];
function ok(cond, nome, extra) {
  total++;
  if (!cond) { falhas.push(nome + (extra !== undefined ? ' -> ' + JSON.stringify(extra) : '')); console.log('  FALHA ' + nome + (extra !== undefined ? ' -> ' + JSON.stringify(extra).slice(0, 300) : '')); }
}
function grupo(n) { console.log('\n[' + n + ']'); }

function iniciar(opc) {
  opc = opc || {};
  const { ctx, amb } = carregar();
  const ss = amb.planilha;
  let minuto = 0;
  const base = Date.UTC(2026, 9, 5, 12, 0, 0);
  ctx.AGORA_TESTE = function () {
    const d = new Date(base + minuto * 60000);
    return { dataHora: d.toISOString(), diaLocal: ctx.Utilities.formatDate(d, 'America/Bahia', 'yyyy-MM-dd') };
  };
  ctx.PropertiesService.getScriptProperties().setProperty('PLANILHA_ID', 'x');
  ctx.instalarPlanilha_(ss, new Date(base).toISOString());
  const T = {
    ctx, amb, ss,
    avancar(min) { minuto += min == null ? 1 : min; },
    ch(quem, nome, p) { minuto++; return JSON.parse(ctx.api(quem, nome, JSON.stringify(p || {}))); }
  };
  T.pedro = 'usr-pedro';   // agora a "identidade" é só o id da pessoa escolhida no aparelho
  T.digo = 'usr-digo';
  T.db = () => new ctx.Banco(ss);
  T.uid = () => ctx.Utilities.getUuid();
  if (opc.exemplos) ctx.carregarExemplos_(ss, ctx.AGORA_TESTE());
  return T;
}
const H = (T) => T.ctx.AGORA_TESTE().diaLocal;
function venda(T, token, itens, forma, sorteio, id) { return T.ch(token, 'venda.registrar', { id: id || T.uid(), itens: itens, forma_pagamento_id: forma || 'fp-dinheiro', sorteio: sorteio || null }); }
function preparo(T, token, litros, plano, quem) { return T.ch(token, 'preparo.registrar', { id: T.uid(), litros: litros, plano: plano || {}, quem: quem || 'usr-pedro' }); }
function compra(T, token, mat, emb, valor, forn) { return T.ch(token, 'compra.registrar', { id: T.uid(), material_id: mat, embalagens: emb, valor_centavos: valor, fornecedor_id: forn || 'for-a' }); }
const ver = (T, token, tela, sub, q) => T.ch(token, 'ver', { tela: tela, sub: sub, q: q });

/* ==================================================================== */
grupo('instalação e esquema');
{
  const T = iniciar();
  const nomes = T.ss.getSheets().map((s) => s.getName());
  ok(nomes.length === 33, '33 abas (31 do esquema + _esquema + _versao)', nomes.length);
  ok(nomes[0] === 'usuario' && nomes[nomes.length - 1] === '_versao', 'abas ordenadas por grupo', [nomes[0], nomes[nomes.length - 1]]);
  const db = T.db();
  ok(db.t('material').length === 8 && db.t('produto_variante').length === 6 && db.t('preco_venda').length === 6, 'cadastros iniciais carregados');
  ok(db.t('usuario').length === 3 && db.t('usuario').filter((u) => u.ativo).length === 2, 'usuários: Pedro, Digo e sistema (inativo)');
  T.ctx.instalarPlanilha_(T.ss, new Date().toISOString());
  ok(T.db().t('material').length === 8, 'reinstalar não duplica os dados iniciais');
  ok(T.ss.getSheetByName('_esquema').getLastRow() > 150, 'dicionário de dados gerado (_esquema)', T.ss.getSheetByName('_esquema').getLastRow());
  ok(T.ss.getSheetByName('venda').getRange(1, 1, 1, 3).getValues()[0].join() === 'id,numero,usuario_id', 'cabeçalho da aba venda');
  T.ss.getSheetByName('venda').getRange(1, 2).setValue('errado');
  let erro = null; try { T.ctx.instalarPlanilha_(T.ss, new Date().toISOString()); } catch (e) { erro = e.message; }
  ok(erro && /não confere/.test(erro), 'cabeçalho alterado à mão é recusado', erro);
}

grupo('quem está usando (sem PIN)');
{
  const T = iniciar();
  const pub = JSON.parse(T.ctx.api(null, 'publico', '{}'));
  ok(pub.ok && pub.usuarios.length === 2 && pub.usuarios.every((u) => u.id && u.nome && Object.keys(u).length === 2), 'a lista de pessoas traz só id e nome de quem está ativo', pub);
  ok(pub.usuarios.map((u) => u.nome).join() === 'Pedro,Digo', 'Pedro e Digo');
  ok(T.ch(null, 'ver', { tela: 'venda' }).sessao === false, 'sem escolher a pessoa: recusado');
  ok(T.ch('usr-fantasma', 'ver', { tela: 'venda' }).sessao === false, 'pessoa que não existe: recusada');
  ok(T.ch('usr-sistema', 'ver', { tela: 'venda' }).sessao === false, 'usuário inativo (sistema) não entra');
  ok(T.ch('usr-pedro', 'sessao').usuario.nome === 'Pedro' && T.ch('usr-digo', 'sessao').usuario.nome === 'Digo', 'pedro e digo são reconhecidos');
  ok(T.ch('usr-pedro', 'login', { usuario_id: 'usr-pedro', pin: '1111' }).erro === 'Operação desconhecida.', 'não existe mais login por PIN');
  const guardadas = Object.keys(T.amb.props);
  ok(guardadas.every((k) => ['PLANILHA_ID', 'EPOCA', 'GENS', 'CACHE_DESLIGADO', 'INSTALACAO'].includes(k)), 'nenhuma senha ou segredo guardado nas propriedades do script (só id da planilha e controle do cache)', guardadas);
  const v = T.ch('usr-digo', 'venda.registrar', { id: T.uid(), itens: { 'var-n50': 1 }, forma_pagamento_id: 'fp-dinheiro' });
  ok(!v.ok === false || /Falta|Nada|passou|registrada/.test(v.msg || v.erro || ''), 'o registro fica no nome de quem escolheu');
  ok(T.db().t('venda').slice(-1)[0].usuario_id === 'usr-digo', 'venda gravada em nome do Digo');
}

grupo('instalação desatualizada');
{
  const T = iniciar();
  const props = T.ctx.PropertiesService.getScriptProperties();
  ok(T.ch(T.pedro, 'ver', { tela: 'venda' }).ok, 'com a instalação em dia, o app funciona');
  props.setProperty('INSTALACAO', '1');
  const r = T.ch(T.pedro, 'venda.registrar', { id: T.uid(), itens: { 'var-n50': 1 }, forma_pagamento_id: 'fp-pix' });
  ok(!r.ok && /precisa ser atualizada/.test(r.erro) && T.db().t('venda').length === 0, 'instalação antiga: recusa gravar e explica o que fazer', r);
  ok(/precisa ser atualizada/.test(T.ch(T.pedro, 'ver', { tela: 'venda' }).erro), 'e também recusa mostrar telas');
  T.ctx.instalarPlanilha_(T.ss, new Date().toISOString());
  ok(T.ch(T.pedro, 'ver', { tela: 'venda' }).ok, 'depois de Instalar / atualizar volta a funcionar');
  const sh = T.ss.getSheetByName('venda');
  ok(Object.keys(sh._fmt).length > 500 && sh._fmt['500,3'] === '@' && sh._fmt['1000,1'] === '@' && sh._fmt['500,2'] === '0', 'a instalação formata todas as linhas da aba como texto');
}

grupo('menu Instalar quando falta permissão para travar as abas');
{
  const T = iniciar();
  const avisos = [];
  T.ctx.SpreadsheetApp.getUi = () => ({ alert: (a, b) => { avisos.push([a, b]); return 'OK'; }, ButtonSet: { OK: 'OK' }, Button: { OK: 'OK' } });
  T.ctx.Session.getEffectiveUser = () => { throw new Error('As permissões especificadas não são suficientes para chamar Session.getEffectiveUser.'); };
  T.ctx.menuInstalar();
  ok(avisos.length === 1 && /Planilha instalada/.test(avisos[0][0]) && /não consegui travar as abas/.test(avisos[0][1]), 'a instalação termina e avisa que não conseguiu travar as abas', avisos);
  ok(T.ch(T.pedro, 'ver', { tela: 'venda' }).ok, 'e o app funciona normalmente');
  const m = JSON.parse(require('fs').readFileSync(require('path').join(__dirname, '..', 'src', 'appsscript.json'), 'utf8'));
  ok(m.oauthScopes.includes('https://www.googleapis.com/auth/userinfo.email') && m.oauthScopes.includes('https://www.googleapis.com/auth/spreadsheets'), 'o manifesto pede a permissão de e-mail usada na proteção das abas', m.oauthScopes);
}

grupo('travar as abas: uma já travada não impede as outras');
{
  const T = iniciar();
  T.ss.getSheetByName('produto_variante').protect = () => { throw new Error('A página "produto_variante" já está protegida.'); };
  T.ss.getSheetByName('log_sistema').protect = () => { throw new Error('Erro inesperado do Google'); };
  const r = T.ctx.protegerAbas_(T.ss);
  ok(r.total === 33 && r.jaEstavam === 1 && r.travadas === 31 && r.falhas.length === 1 && /log_sistema/.test(r.falhas[0]), 'segue pelas outras abas: 31 travadas, 1 já estava, 1 falha', r);
  const avisos = [];
  T.ctx.SpreadsheetApp.getUi = () => ({ alert: (a, b) => { avisos.push([a, b]); return 'OK'; }, ButtonSet: { OK: 'OK' }, Button: { OK: 'OK' } });
  T.ctx.menuInstalar();
  ok(avisos.length === 1 && /Abas travadas contra edição manual: 32 de 33/.test(avisos[0][1]) && /Não consegui travar: log_sistema/.test(avisos[0][1]), 'o instalador mostra quantas abas ficaram travadas', avisos[0]);
}

grupo('formatos de coluna (zeros à esquerda)');
{
  const T = iniciar({ exemplos: true });
  const nums = T.db().t('numero_sorteio').map((n) => n.token);
  ok(nums.includes('0453') && nums.includes('0304') && nums.includes('0545') && nums.includes('0812'), 'tokens com zero à esquerda continuam texto', nums);
  const vd = T.db().t('venda')[0];
  ok(typeof vd.dia_local === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(vd.dia_local) && typeof vd.data_hora === 'string', 'datas continuam texto ISO (o Sheets não as converte)', vd.dia_local);
  ok(T.db().t('cliente')[0].telefone === '71900000001', 'telefone continua texto');
}

grupo('dados de exemplo');
{
  const T = iniciar({ exemplos: true });
  const db = T.db();
  ok(db.t('compra').length === 11 && db.t('venda').length === 5 && db.t('preparo').length === 1, 'compras, vendas e preparo de exemplo');
  const sal = T.ctx.saldosEstoque_(db);
  ok(Math.abs(sal['usr-pedro']['mat-cafe'] - 958) < 1e-6, 'estoque de café do Pedro = 1000 - 42', sal['usr-pedro']['mat-cafe']);
  ok(sal['usr-pedro']['mat-copo200'] === 41 && sal['usr-pedro']['mat-copo50'] === 36, 'copos descontados pelo plano');
  ok(sal['usr-digo']['mat-cafe'] === 500 && !sal['usr-digo']['mat-copo50'], 'o Digo tem só o que comprou');
  const v = ver(T, T.pedro, 'venda');
  ok(v.view === undefined && v.ok && v.saldoMl === 1000, 'saldo de café pronto = 1.500 - 500', v.saldoMl);
  ok(T.db().t('cliente').every((c) => c.origem === 'EXEMPLO'), 'clientes de exemplo marcados');
  const a = T.ch(T.pedro, 'sistema.auditar');
  ok(a.ok && a.limpo && a.erros === 0, 'auditoria dos exemplos sem erros', a.achados);
  let e = null; try { T.ctx.carregarExemplos_(T.ss, T.ctx.AGORA_TESTE()); } catch (x) { e = x.message; }
  ok(/já tem movimentos/.test(e), 'não carrega exemplos duas vezes');
}

grupo('venda');
{
  const T = iniciar({ exemplos: true });
  const id = T.uid();
  const r = venda(T, T.pedro, { 'var-l100': 1, 'var-n50': 2 }, 'fp-pix', null, id);
  ok(r.ok && /R\$.*4,50/.test(r.msg), 'venda registrada com total certo', r.msg);
  const v = T.db().achar('venda', id);
  ok(v.status === 'ATIVO' && v.total_cafe_centavos === 450 && v.ml_cafe === 160 && v.copos === 3, 'totais gravados', v);
  ok(v.dia_local === H(T) && v.usuario_id === 'usr-pedro', 'dia e quem registrou vêm do servidor');
  const it = T.db().t('venda_item').filter((i) => i.venda_id === id);
  ok(it.length === 2 && it.find((i) => i.variante_id === 'var-l100').preco_unit_centavos === 250 && it.find((i) => i.variante_id === 'var-l100').ml_cafe_unit === 60, 'preço e café gravados no momento');
  const r2 = venda(T, T.pedro, { 'var-l100': 1, 'var-n50': 2 }, 'fp-pix', null, id);
  ok(r2.ok && r2.repetido && T.db().t('venda').filter((x) => x.id === id).length === 1, 'reenvio com o mesmo id não duplica');
  ok(T.db().t('movimento_estoque').every((m) => m.origem_tabela !== 'venda'), 'venda não mexe no estoque de material');
  ok(ver(T, T.pedro, 'venda').saldoMl === 840, 'saldo de café desceu 160 ml');
  ok(venda(T, T.pedro, {}, 'fp-pix').erro === 'Nada no pedido.', 'pedido vazio recusado');
  ok(/forma de pagamento/.test(venda(T, T.pedro, { 'var-n50': 1 }, 'fp-xxx').erro), 'forma de pagamento inválida');
  ok(/indisponível/.test(venda(T, T.pedro, { 'var-zzz': 1 }, 'fp-pix').erro), 'produto inexistente');
  ok(/Identificador/.test(T.ch(T.pedro, 'venda.registrar', { id: 'x', itens: { 'var-n50': 1 }, forma_pagamento_id: 'fp-pix' }).erro), 'id curto demais recusado');
  ok(/Quantidade/.test(venda(T, T.pedro, { 'var-n50': 100 }, 'fp-pix').erro), 'quantidade absurda recusada');
  const antes = T.db().t('venda').length;
  const passou = venda(T, T.digo, { 'var-n100': 9 }, 'fp-dinheiro');
  ok(passou.ok && passou.passou && /passou do café preparado/.test(passou.msg) && T.db().t('venda').length === antes + 1, 'venda acima do café preparado é aceita, com aviso', passou.msg);
  ok(ver(T, T.pedro, 'venda').saldoMl === -60, 'saldo fica negativo e a tela mostra');
}

grupo('venda com números do sorteio');
{
  const T = iniciar({ exemplos: true });
  const r = venda(T, T.pedro, { 'var-n50': 1 }, 'fp-pix', { cliente_id: 'cli-maria-exemplo', n: 2 });
  ok(r.ok && r.ticket && r.ticket.numeros.length === 2 && r.ticket.cliente === 'Maria (exemplo)', 'ticket com cliente e 2 números', r.ticket);
  ok(r.ticket.numeros[0].numero === 5 && r.ticket.numeros[1].numero === 6, 'numeração segue (5 e 6)', r.ticket.numeros);
  ok(r.ticket.numeros.every((n) => /^\d{4}$/.test(n.token)) && r.ticket.numeros[0].token !== r.ticket.numeros[1].token, 'códigos de 4 dígitos diferentes');
  const usados = T.db().t('numero_sorteio').map((n) => n.token);
  ok(new Set(usados).size === usados.length, 'nenhum código repetido no sistema');
  const v = T.db().achar('venda', T.db().t('venda').slice(-1)[0].id);
  ok(v.total_sorteio_centavos === 200 && v.cliente_id === 'cli-maria-exemplo', 'receita do sorteio separada e cliente na venda');
  ok(/Cliente inválido/.test(venda(T, T.pedro, { 'var-n50': 1 }, 'fp-pix', { cliente_id: 'nao-existe', n: 1 }).erro), 'cliente inexistente recusado');
  ok(/de 1 a 99/.test(venda(T, T.pedro, { 'var-n50': 1 }, 'fp-pix', { cliente_id: 'cli-maria-exemplo', n: 100 }).erro), 'mais de 99 números numa venda é recusado');
  ok(T.db().t('numero_sorteio').every((n) => n.sorteio_id === 'sort-1'), 'todo número guarda o id do sorteio em que foi vendido');
  T.ch(T.pedro, 'cliente.ativo', { id: 'cli-joao-exemplo', ativo: false });
  ok(/inativo/.test(venda(T, T.pedro, { 'var-n50': 1 }, 'fp-pix', { cliente_id: 'cli-joao-exemplo', n: 1 }).erro), 'cliente inativo recusado');
  const so = venda(T, T.pedro, {}, 'fp-pix', { cliente_id: 'cli-maria-exemplo', n: 1 });
  ok(so.ok && T.db().t('venda').slice(-1)[0].copos === 0 && T.db().t('movimento_cafe').filter((m) => m.origem_id === T.db().t('venda').slice(-1)[0].id).length === 0, 'venda só de números não mexe no café');
  const antes = T.db().t('numero_sorteio').length;
  const cod = T.db().t('numero_sorteio').slice(-1)[0].numero;
  const id = T.db().t('venda').slice(-1)[0].id;
  T.ch(T.pedro, 'estornar', { tabela: 'venda', id: id });
  const prox = venda(T, T.pedro, {}, 'fp-pix', { cliente_id: 'cli-maria-exemplo', n: 1 });
  ok(prox.ticket.numeros[0].numero === cod + 1, 'número de venda desfeita não é reaproveitado', [cod, prox.ticket.numeros[0].numero]);
  // 300 números: nenhum código repetido
  for (let i = 0; i < 15; i++) venda(T, T.pedro, {}, 'fp-pix', { cliente_id: 'cli-maria-exemplo', n: 20 });
  const todos = T.db().t('numero_sorteio').map((n) => n.token);
  ok(todos.length > 300 && new Set(todos).size === todos.length, 'mais de 300 números sem repetir código', todos.length);
}

grupo('preparo e estoque de quem preparou');
{
  const T = iniciar({ exemplos: true });
  const r = preparo(T, T.pedro, 1, { 'var-n100': 2, 'var-l100': 1 }, 'usr-pedro');
  ok(r.ok, 'preparo registrado', r);
  const db = T.db(), p = db.t('preparo').slice(-1)[0];
  const cons = db.t('preparo_consumo').filter((c) => c.preparo_id === p.id);
  const q = (m) => (cons.find((c) => c.material_id === m) || {}).qtd_real_qtd;
  ok(q('mat-cafe') === 28 && q('mat-filtro') === 1 && q('mat-agua') === 1000 && q('mat-leite') === 40 && q('mat-copo200') === 3, 'consumo = receita x litros + plano', cons.map((c) => [c.material_id, c.qtd_real_qtd]));
  ok(cons.find((c) => c.material_id === 'mat-cafe').custo_atual_centavos === Math.round(28 * 2600 / 500) && cons.find((c) => c.material_id === 'mat-cafe').custo_padrao_centavos === Math.round(28 * 2700 / 500), 'custo atual (última compra) e padrão gravados', cons[0]);
  ok(Math.abs(T.ctx.cafeDoDia_(T.db(), H(T)).produzido - 2500) < 1e-9, 'café produzido do dia = 1.500 + 1.000');
  const semEst = preparo(T, T.digo, 1, { 'var-n100': 1 }, 'usr-digo');
  ok(semEst.ok && semEst.atencao && /Atenção: faltou estoque de/.test(semEst.msg) && /Copo 200 ml/.test(semEst.msg), 'Digo sem copos/filtro: o preparo É registrado, com aviso do que faltou (não trava)', semEst);
  ok(!/Água/.test(semEst.msg), 'e a água nunca aparece como falta (não controla estoque)', semEst.msg);
  ok(T.ctx.saldosEstoque_(T.db())['usr-digo']['mat-copo200'] === -1, 'o saldo do copo do Digo ficou em −1 até ele lançar a compra ou contar');
  ok(T.ch(T.digo, 'estornar', { tabela: 'preparo', id: T.db().t('preparo').slice(-1)[0].id }).ok, 'e dá para desfazer');
  ok(/passa do volume/.test(preparo(T, T.pedro, 0.5, { 'var-n100': 6 }).erro), 'plano acima do volume recusado');
  ok(/Litros inválidos/.test(preparo(T, T.pedro, 0.7, {}).erro) && /Litros inválidos/.test(preparo(T, T.pedro, 11, {}).erro) && /Litros inválidos/.test(preparo(T, T.pedro, 0, {}).erro), 'litros fora da regra recusados');
  ok(/Pessoa inválida/.test(preparo(T, T.pedro, 1, {}, 'usr-sistema').erro), 'quem preparou precisa ser pessoa ativa');
  const id = T.uid();
  const a = T.ch(T.pedro, 'preparo.registrar', { id: id, litros: 0.5, plano: {}, quem: 'usr-pedro' }), b = T.ch(T.pedro, 'preparo.registrar', { id: id, litros: 0.5, plano: {}, quem: 'usr-pedro' });
  ok(a.ok && b.repetido, 'reenvio do mesmo preparo não duplica');
  // transferir material para o Digo e ele preparar
  const mov = (mat, qtd) => T.ch(T.pedro, 'estoque.mover', { id: T.uid(), tipo: 'TRANSFERENCIA', material_id: mat, de: 'usr-pedro', qtd: qtd });
  ['mat-copo200', 'mat-filtro'].forEach((m) => mov(m, 3));
  ok(/não controla estoque/.test(mov('mat-agua', 3000).erro), 'água não pode ser transferida (não controla estoque)');
  const rd = preparo(T, T.digo, 1, { 'var-n100': 2 }, 'usr-digo');
  ok(rd.ok, 'depois de receber material, o Digo prepara', rd);
  const pd = T.db().t('preparo').slice(-1)[0];
  ok(pd.usuario_id === 'usr-digo' && pd.registrado_por === 'usr-digo', 'preparo fica no nome de quem preparou');
  const ag = ver(T, T.pedro, 'financeiro', 'resultado');
  ok(ag.atribuicao.find((x) => x.nome === 'Digo').val.indexOf('R$') === 0, 'atribuição por quem preparou aparece');
}

grupo('compra');
{
  const T = iniciar({ exemplos: true });
  const r = compra(T, T.digo, 'mat-cafe', 2, 5400, 'for-b');
  ok(r.ok && /1\.000 g no estoque de Digo/.test(r.msg), 'compra entra no estoque de quem registrou', r.msg);
  ok(T.ctx.saldosEstoque_(T.db())['usr-digo']['mat-cafe'] === 1500, 'estoque do Digo: 500 + 1.000');
  const v = ver(T, T.pedro, 'compra');
  ok(v.hist['mat-cafe'].menor === 2500 && v.hist['mat-cafe'].maior === 2900 && v.hist['mat-cafe'].ultimo === 2700, 'histórico de preços por pacote (menor/maior/último)', v.hist['mat-cafe']);
  ok(v.hist['mat-cafe'].medio > 2500 && v.hist['mat-cafe'].medio < 2900, 'preço médio ponderado');
  ok(v.recentes.length === 6 && v.recentes[0].texto.indexOf('Café') === 0 && v.recentes[0].material_id === 'mat-cafe' && v.recentes[0].embalagens === 2, 'compras recentes (6, com os dados para corrigir)');
  ok(/Embalagens/.test(compra(T, T.pedro, 'mat-cafe', 0, 100).erro) && /Embalagens/.test(compra(T, T.pedro, 'mat-cafe', 51, 100).erro), 'embalagens fora de 1 a 50');
  ok(/Valor inválido/.test(compra(T, T.pedro, 'mat-cafe', 1, -5).erro), 'valor negativo recusado');
  ok(/Material inválido/.test(compra(T, T.pedro, 'mat-zzz', 1, 100).erro) && /onde comprou/.test(compra(T, T.pedro, 'mat-cafe', 1, 100, 'for-zzz').erro), 'material/fornecedor inexistentes');
  const idCompra = T.db().t('compra').filter((c) => c.status === 'ATIVO' && c.usuario_id === 'usr-pedro' && c.valor_total_centavos === 1500)[0];
  const cp200 = T.db().t('compra_item').filter((i) => i.material_id === 'mat-copo200')[0];
  const r2 = T.ch(T.pedro, 'estornar', { tabela: 'compra', id: cp200.compra_id });
  ok(/ficaria negativo/.test(r2.erro), 'desfazer compra de material já consumido é recusado', r2.erro);
  const livre = compra(T, T.pedro, 'mat-acucar', 1, 450);
  const r3 = T.ch(T.pedro, 'estornar', { tabela: 'compra', id: T.db().t('compra').slice(-1)[0].id });
  ok(r3.ok && T.ctx.saldosEstoque_(T.db())['usr-pedro']['mat-acucar'] === undefined || T.ctx.saldosEstoque_(T.db())['usr-pedro']['mat-acucar'] === 0, 'desfazer compra livre devolve o estoque');
  ok(T.ch(T.pedro, 'estornar', { tabela: 'compra', id: T.db().t('compra').slice(-1)[0].id }).erro === 'Esse registro já foi desfeito.', 'desfazer duas vezes é recusado');
  ok(ver(T, T.pedro, 'compra').hist['mat-acucar'].ultimas.length === 1, 'compra desfeita sai do histórico de preços (fica só a de exemplo)');
}

grupo('fechamento: venda acima do limite, perda, acerto, dia fechado');
{
  const T = iniciar({ exemplos: true });
  for (let i = 0; i < 12; i++) venda(T, T.pedro, { 'var-n100': 1 }, 'fp-pix');
  let f = ver(T, T.pedro, 'fechamento');
  ok(f.diff === -200 && f.produzidoMl === 1500 && f.vendidoMl === 1700, 'diferença negativa de 200 ml', [f.diff, f.produzidoMl, f.vendidoMl]);
  ok(/diferença de/.test(T.ch(T.pedro, 'dia.fechar').erro), 'não fecha com diferença');
  ok(/passar da diferença/.test(T.ch(T.pedro, 'cafe.perda', { id: T.uid(), ml: 50, motivo_id: 'mp-sobra' }).erro), 'perda não pode passar da diferença (diferença negativa)');
  const a = T.ch(T.pedro, 'cafe.acerto', { id: T.uid() });
  ok(a.ok && /\+200 ml/.test(a.msg), 'acerto cobre os 200 ml', a.msg);
  ok(/Não há venda acima/.test(T.ch(T.pedro, 'cafe.acerto', { id: T.uid() }).erro), 'acerto sem necessidade é recusado');
  ok(ver(T, T.pedro, 'fechamento').diff === 0, 'diferença zerada');
  ok(T.ch(T.pedro, 'dia.fechar').ok && ver(T, T.pedro, 'venda').fechado === true, 'dia fechado');
  ok(/dia está fechado/.test(venda(T, T.pedro, { 'var-n50': 1 }).erro), 'venda bloqueada');
  ok(/dia está fechado/.test(preparo(T, T.pedro, 1, {}).erro), 'preparo bloqueado');
  ok(/dia está fechado/.test(T.ch(T.pedro, 'cafe.perda', { id: T.uid(), ml: 50, motivo_id: 'mp-sobra' }).erro), 'perda bloqueada');
  const vid = T.db().t('venda').slice(-1)[0].id;
  ok(/Reabra o dia/.test(T.ch(T.pedro, 'estornar', { tabela: 'venda', id: vid }).erro), 'desfazer venda de dia fechado exige reabrir');
  ok(compra(T, T.pedro, 'mat-acucar', 1, 450).ok, 'compra continua liberada com o dia fechado');
  ok(T.ch(T.pedro, 'dia.reabrir').ok && !ver(T, T.pedro, 'venda').fechado, 'reabrir');
  ok(T.ch(T.pedro, 'estornar', { tabela: 'venda', id: vid }).ok, 'depois de reabrir dá para desfazer');
  f = ver(T, T.pedro, 'fechamento');
  ok(f.diff === 100, 'desfazer venda devolve 100 ml', f.diff);
  const p = T.ch(T.pedro, 'cafe.perda', { id: T.uid(), ml: 100, motivo_id: 'mp-derramou' });
  ok(p.ok, 'perda de 100 ml', p);
  ok(ver(T, T.pedro, 'fechamento').diff === 0 && ver(T, T.pedro, 'fechamento').perdidoMl === 100, 'perda registrada e diferença zerada');
  ok(/motivo/.test(T.ch(T.pedro, 'cafe.perda', { id: T.uid(), ml: 10, motivo_id: 'x' }).erro), 'perda sem motivo');
  const aj = ver(T, T.pedro, 'fechamento').ajustes;
  ok(aj.length === 2 && /Ajuste \+200/.test(aj[1].texto.replace(/\u00A0/g, ' ')) , 'ajustes de hoje listados', aj);
  const idAcerto = T.db().t('ajuste_cafe').find((x) => x.tipo === 'ACERTO').id;
  const d = T.ch(T.pedro, 'estornar', { tabela: 'ajuste_cafe', id: idAcerto });
  ok(d.ok && /passam do café preparado/.test(d.msg), 'desfazer o ajuste avisa que a diferença volta', d.msg);
  ok(T.ch(T.pedro, 'sistema.auditar').limpo, 'auditoria limpa depois de tudo');
}

grupo('estoque: ajuste, perda de material, transferência');
{
  const T = iniciar({ exemplos: true });
  const mv = (tipo, mat, de, qtd) => T.ch(T.pedro, 'estoque.mover', { id: T.uid(), tipo: tipo, material_id: mat, de: de, qtd: qtd });
  ok(mv('AJUSTE', 'mat-cafe', 'usr-pedro', -8).ok && T.ctx.saldosEstoque_(T.db())['usr-pedro']['mat-cafe'] === 950, 'ajuste negativo');
  ok(/negativo/.test(mv('AJUSTE', 'mat-cafe', 'usr-pedro', -9999).erro), 'ajuste que deixaria negativo');
  ok(/Informe a quantidade/.test(mv('AJUSTE', 'mat-cafe', 'usr-pedro', 0).erro) && /Informe a quantidade/.test(mv('PERDA', 'mat-cafe', 'usr-pedro', 0).erro), 'quantidade zero recusada');
  ok(mv('PERDA', 'mat-leite', 'usr-pedro', 100).ok && T.ctx.saldosEstoque_(T.db())['usr-pedro']['mat-leite'] === 3700, 'perda de material');
  ok(/negativo/.test(mv('PERDA', 'mat-leite', 'usr-pedro', 99999).erro), 'perda maior que o estoque');
  const t = mv('TRANSFERENCIA', 'mat-canela', 'usr-pedro', 10), s = T.ctx.saldosEstoque_(T.db());
  ok(t.ok && s['usr-pedro']['mat-canela'] === 36 && s['usr-digo']['mat-canela'] === 10, 'transferência move de um para o outro', [s['usr-pedro']['mat-canela'], s['usr-digo']['mat-canela']]);
  ok(/negativo/.test(mv('TRANSFERENCIA', 'mat-canela', 'usr-digo', 11).erro), 'transferência sem saldo');
  ok(/inválido/.test(mv('XPTO', 'mat-cafe', 'usr-pedro', 1).erro), 'tipo inválido');
  const ledger = ver(T, T.pedro, 'estoque', 'movs').movs;
  ok(ledger.length > 5 && ledger[0].tipo === 'TRANSF_ENTRADA', 'livro de movimentos mostra as mais recentes primeiro', ledger.slice(0, 2));
  const id = T.db().t('ajuste_estoque').slice(-1)[0].id;
  ok(T.ch(T.pedro, 'estornar', { tabela: 'ajuste_estoque', id: id }).ok && T.ctx.saldosEstoque_(T.db())['usr-pedro']['mat-canela'] === 46, 'desfazer transferência devolve');
  const sal = ver(T, T.pedro, 'estoque', 'saldos');
  const cafe = sal.linhas.find((l) => l.id === 'mat-cafe');
  ok(cafe.por['usr-pedro'] === 950 && cafe.por['usr-digo'] === 500 && cafe.total === 1450, 'tela de saldos por pessoa', cafe);
}

grupo('financeiro');
{
  const T = iniciar({ exemplos: true });
  const l = (tipo, uid, valor) => T.ch(T.pedro, 'financeiro.lancar', { id: T.uid(), tipo: tipo, usuario_id: uid, valor_centavos: valor });
  ok(l('REEMBOLSO', 'usr-pedro', 1000).ok && l('APORTE', 'usr-digo', 5000).ok && l('DESPESA', 'usr-digo', 700).ok, 'três tipos de lançamento');
  ok(/Informe o valor/.test(l('REEMBOLSO', 'usr-pedro', 0).erro) && /inválido/.test(l('XPTO', 'usr-pedro', 100).erro), 'valor zero e tipo inválido');
  const r = ver(T, T.pedro, 'financeiro', 'resultado');
  const pb = (n) => r.payback.find((x) => x.nome === n);
  ok(pb('Pedro').pctTxt === '13%' || pb('Pedro').pctTxt === '14%' || /%/.test(pb('Pedro').pctTxt), 'payback do Pedro', pb('Pedro'));
  ok(r.payback.length === 3 && r.payback[2].nome === 'Geral', 'payback por pessoa e geral');
  ok(r.tiles.find((t) => t.lbl === 'Despesas').val.indexOf('7,00') > 0, 'despesa aparece no resultado');
  const lista = ver(T, T.pedro, 'financeiro', 'lanc').lista;
  ok(lista.length === 3, 'lançamentos listados');
  ok(T.ch(T.pedro, 'estornar', { tabela: 'lancamento_financeiro', id: lista[0].id }).ok && ver(T, T.pedro, 'financeiro', 'lanc').lista.length === 2, 'desfazer lançamento');
}

grupo('clientes');
{
  const T = iniciar({ exemplos: true });
  const salvar = (p) => T.ch(T.pedro, 'cliente.salvar', Object.assign({ novo_id: T.uid() }, p));
  ok(/Digite o nome/.test(salvar({ nome: 'A', telefone: '71999998888', email: 'a@gmail.com' }).erro), 'nome curto');
  ok(/Telefone/.test(salvar({ nome: 'Ana Souza', telefone: '7199', email: 'a@gmail.com' }).erro), 'telefone curto');
  ok(/E-mail/.test(salvar({ nome: 'Ana Souza', telefone: '71999998888', email: 'ana-gmail' }).erro), 'e-mail inválido');
  const a = salvar({ nome: 'Ana Souza', telefone: '(71) 99999-8888', email: 'Ana.Souza@Gmail.com' });
  const ana = T.db().achar('cliente', a.cliente_id);
  ok(a.ok && ana.telefone === '71999998888' && ana.email === 'ana.souza@gmail.com' && ana.origem === 'REAL' && ana.consentimento_em, 'cadastro normaliza telefone e e-mail', ana);
  ok(/C00\d/.test(ana.codigo), 'código sequencial do cliente', ana.codigo);
  ok(/já está no cadastro de Ana Souza/.test(salvar({ nome: 'Outra', telefone: '71 99999 8888', email: 'o@gmail.com' }).erro) && /já está no cadastro/.test(salvar({ nome: 'Outra', telefone: '71988887777', email: 'ANA.souza@gmail.com' }).erro), 'telefone/e-mail repetidos');
  const ed = T.ch(T.pedro, 'cliente.salvar', { id: ana.id, nome: 'Ana Souza Lima', telefone: '71999998888', email: 'ana.souza@gmail.com' });
  ok(ed.ok && T.db().achar('cliente', ana.id).nome === 'Ana Souza Lima' && T.db().achar('cliente', ana.id).versao === 2, 'edição mantém o id e sobe a versão');
  ok(T.ch(T.pedro, 'cliente.ativo', { id: ana.id, ativo: false }).ok && !T.db().achar('cliente', ana.id).ativo && T.db().t('cliente').length === 3, 'inativar não apaga');
  // busca na Venda (privacidade)
  const b = (q) => T.ch(T.pedro, 'cliente.buscar', { q: q });
  ok(b('m').ativa === false && b('m').itens.length === 0, 'uma letra não busca');
  const bm = b('mar');
  ok(bm.itens.length === 1 && bm.itens[0].contato === '(71) \u2022\u2022\u2022\u2022\u2022-0001' && JSON.stringify(bm).indexOf('maria.exemplo') < 0 && JSON.stringify(bm).indexOf('90000') < 0, 'busca na Venda mascara o telefone e esconde o e-mail', bm);
  ok(b('ana').itens.length === 0, 'cliente inativo não aparece na Venda');
  ok(b('0453').itens[0].nome === 'Maria (exemplo)', 'busca por código do número');
  ok(b('4').itens[0].nome === 'João (exemplo)', 'busca pelo número 4');
  for (let i = 0; i < 6; i++) salvar({ nome: 'Cliente Lote ' + i, telefone: '7198800000' + i, email: 'lote' + i + '@gmail.com' });
  const bl = b('lote');
  ok(bl.itens.length === 3 && bl.total === 6, 'no máximo 3 resultados, informando o total', [bl.itens.length, bl.total]);
  // tela de clientes (gestão): tudo à vista
  const vc = ver(T, T.pedro, 'clientes', 'lista', '');
  ok(vc.total === 9 && vc.clientes.length === 9, 'tela de Clientes lista todos', vc.total);
  const maria = vc.clientes.find((c) => c.nome === 'Maria (exemplo)');
  ok(maria.telefone === '(71) 90000-0001' && maria.email === 'maria.exemplo@gmail.com' && maria.numeros.length === 3 && maria.numeros[1].token === '0304', 'gestão mostra dados completos e os números com código', maria);
  ok(vc.clientes[0].nome.localeCompare(vc.clientes[1].nome, 'pt-BR') <= 0, 'ordem alfabética');
  ok(ver(T, T.pedro, 'clientes', 'lista', 'joao.exemplo').clientes.length === 1 && ver(T, T.pedro, 'clientes', 'lista', '0545').clientes[0].nome === 'Maria (exemplo)', 'filtro por e-mail e por código');
  ok(!JSON.stringify(ver(T, T.pedro, 'venda')).includes('Maria') && !JSON.stringify(ver(T, T.pedro, 'venda')).includes('90000'), 'a tela de Venda nem recebe dados de clientes');
}

grupo('sorteio por rodadas (cada número guarda o id do sorteio)');
{
  const T = iniciar({ exemplos: true });
  let s = ver(T, T.pedro, 'clientes', 'sorteio', '');
  ok(s.rodadaAtual === 1 && s.meta === 40 && s.nAtivos === 4 && !s.liberado && s.nClientes === 2, 'estado inicial: sorteio 1, 4 números de 40', s);
  ok(T.db().t('sorteio').length === 1 && T.db().t('sorteio')[0].status === 'ABERTO', 'existe um sorteio aberto desde a instalação');
  // o relato: um cliente compra 40 números
  const r40 = venda(T, T.pedro, {}, 'fp-pix', { cliente_id: 'cli-maria-exemplo', n: 40 });
  ok(r40.ok && r40.ticket.numeros.length === 40, 'um cliente compra 40 números numa venda só', r40.erro);
  s = ver(T, T.pedro, 'clientes', 'sorteio', '');
  ok(s.nAtivos === 44 && s.liberado, 'o progresso conta NÚMEROS (44 de 40) e libera o sorteio', s);
  let c = ver(T, T.pedro, 'clientes', 'sorteio', '0304');
  ok(c.conferir.length === 1 && c.conferir[0].dono.indexOf('Maria') === 0 && c.conferir[0].ativo && c.conferir[0].rodada === 1, 'conferir número pelo código', c.conferir);
  c = ver(T, T.pedro, 'clientes', 'sorteio', '4');
  ok(c.conferir[0].dono.indexOf('João') === 0, 'conferir número pelo número');
  ok(ver(T, T.pedro, 'clientes', 'sorteio', '9999').conferir.length === 0 && ver(T, T.pedro, 'clientes', 'sorteio', '9999').conferiu, 'número inexistente');
  ok(T.ch(T.pedro, 'config.salvar', { chave: 'sorteio.meta_numeros', valor: 50 }).ok && ver(T, T.pedro, 'clientes', 'sorteio', '').meta === 50 && !ver(T, T.pedro, 'clientes', 'sorteio', '').liberado, 'mudar a meta para 50 números');
  ok(/limite/.test(T.ch(T.pedro, 'config.salvar', { chave: 'sorteio.meta_numeros', valor: 5 }).erro) && /inválida/.test(T.ch(T.pedro, 'config.salvar', { chave: 'xx', valor: 5 }).erro), 'limites da configuração');
  T.ch(T.pedro, 'config.salvar', { chave: 'sorteio.meta_numeros', valor: 40 });
  const idNovo = T.uid();
  const n = T.ch(T.pedro, 'sorteio.novo', { id: idNovo });
  ok(n.ok && /Sorteio nº 1 encerrado com 44 números/.test(n.msg) && /nº 2 começou do zero/.test(n.msg), 'novo sorteio encerra o 1 (44 números) e abre o 2', n.msg);
  ok(T.ch(T.pedro, 'sorteio.novo', { id: idNovo }).repetido && T.db().t('sorteio').length === 2, 'reenvio não cria outro sorteio');
  ok(/Não há números/.test(T.ch(T.pedro, 'sorteio.novo', { id: T.uid() }).erro), 'sem números no sorteio atual não há o que encerrar');
  let rs = T.db().t('sorteio');
  ok(rs[0].status === 'ENCERRADO' && rs[0].qtd_numeros === 44 && rs[0].encerrado_em && rs[1].status === 'ABERTO' && rs[1].rodada === 2 && rs[1].id === idNovo, 'rodada 1 ENCERRADA com 44 números; rodada 2 ABERTA', rs.map((x) => [x.rodada, x.status, x.qtd_numeros]));
  s = ver(T, T.pedro, 'clientes', 'sorteio', '');
  ok(s.rodadaAtual === 2 && s.nAtivos === 0 && !s.liberado && s.historico.length === 1 && s.historico[0].podeDesfazer, 'sorteio 2 começa do zero (0 de 40) e o 1 vai para o histórico', s);
  ok(T.db().t('numero_sorteio').filter((x) => x.sorteio_id === 'sort-1').length === 44, 'os 44 números continuam gravados no sorteio 1');
  const vc = ver(T, T.pedro, 'clientes', 'lista', '');
  ok(vc.clientes.length === 2 && vc.clientes.every((x) => x.numeros.length === 0), 'cadastros ficam, sem números no sorteio novo');
  c = ver(T, T.pedro, 'clientes', 'sorteio', '3');
  ok(c.conferir[0] && !c.conferir[0].ativo && c.conferir[0].rodada === 1, 'número antigo aparece como do sorteio 1, não ativo', c.conferir);
  // o bug relatado: depois do novo sorteio ainda puxava números do primeiro
  const r = venda(T, T.pedro, {}, 'fp-pix', { cliente_id: 'cli-maria-exemplo', n: 2 });
  ok(r.ticket.numeros[0].numero === 45, 'número novo continua a numeração (45), nunca repete', r.ticket);
  ok(T.db().t('numero_sorteio').filter((x) => x.sorteio_id === idNovo).length === 2, 'os 2 números novos entram no sorteio 2');
  s = ver(T, T.pedro, 'clientes', 'sorteio', '');
  ok(s.nAtivos === 2 && s.nClientes === 1, 'o sorteio 2 mostra só os 2 novos (e não os 44 do primeiro)', s);
  ok(ver(T, T.pedro, 'clientes', 'lista', 'maria').clientes[0].numeros.length === 2, 'a Maria só tem os 2 números novos ativos');
  ok(/Já foram vendidos 2 números/.test(T.ch(T.pedro, 'estornar', { tabela: 'sorteio', id: 'sort-1' }).erro), 'não reabre o sorteio 1 enquanto o 2 tem números vendidos');
  ok(T.ch(T.pedro, 'estornar', { tabela: 'venda', id: T.db().t('venda').slice(-1)[0].id }).ok, 'desfazer a venda dos 2 números novos');
  ok(T.ch(T.pedro, 'estornar', { tabela: 'sorteio', id: idNovo }).erro === 'Só dá para reabrir um sorteio encerrado.', 'só reabre sorteio encerrado');
  const re = T.ch(T.pedro, 'estornar', { tabela: 'sorteio', id: 'sort-1' });
  ok(re.ok && /nº 1 reaberto/.test(re.msg), 'reabrir o sorteio 1', re);
  rs = T.db().t('sorteio');
  ok(rs[0].status === 'ABERTO' && rs[1].status === 'CANCELADO', 'o 1 volta a ABERTO e o 2 fica CANCELADO', rs.map((x) => x.status));
  s = ver(T, T.pedro, 'clientes', 'sorteio', '');
  ok(s.rodadaAtual === 1 && s.nAtivos === 44, 'os 44 números voltam a valer', s);
  const n3 = T.ch(T.pedro, 'sorteio.novo', { id: T.uid() });
  ok(n3.ok && /nº 3 começou/.test(n3.msg), 'novo sorteio depois do cancelado leva o nº 3 (o 2 não é reaproveitado)', n3.msg);
  ok(T.ch(T.pedro, 'sistema.auditar').limpo, 'auditoria limpa');
}

grupo('desfazer venda: livros e números');
{
  const T = iniciar({ exemplos: true });
  const r = venda(T, T.pedro, { 'var-l100': 2 }, 'fp-pix', { cliente_id: 'cli-maria-exemplo', n: 2 });
  const vid = T.db().t('venda').slice(-1)[0].id;
  const antes = ver(T, T.pedro, 'venda').saldoMl;
  ok(T.ch(T.pedro, 'estornar', { tabela: 'venda', id: vid }).ok, 'estorno aceito');
  ok(ver(T, T.pedro, 'venda').saldoMl === antes + 120, 'devolve o café ao saldo');
  ok(T.db().t('numero_sorteio').filter((n) => n.venda_id === vid).every((n) => n.status === 'ESTORNADO'), 'números da venda viram ESTORNADO');
  ok(T.db().t('estorno').length === 1 && T.db().t('estorno')[0].usuario_id === 'usr-pedro', 'linha em estorno com quem desfez');
  const h = ver(T, T.digo, 'historico').linhas.find((l) => l.id === vid);
  ok(h.status === 'ESTORNADO' && h.estornadoPor === 'Pedro' && h.resumo.indexOf('0') >= 0 && !/\b0005\b/.test(h.resumo), 'histórico mostra o estorno sem expor os números', h);
  ok(T.ch(T.pedro, 'estornar', { tabela: 'xpto', id: vid }).erro === 'Esse registro não pode ser desfeito.' && T.ch(T.pedro, 'estornar', { tabela: 'venda', id: 'nao-existe-123' }).erro === 'Registro não encontrado.', 'estorno inválido');
  const pid = T.db().t('preparo')[0].id;
  const rp = T.ch(T.pedro, 'estornar', { tabela: 'preparo', id: pid });
  ok(rp.ok && /passam do café preparado/.test(rp.msg), 'desfazer preparo com café já vendido avisa', rp.msg);
  ok(T.ctx.saldosEstoque_(T.db())['usr-pedro']['mat-cafe'] === 1000, 'e devolve o material ao estoque de quem preparou');
}

grupo('cadastros com vigência');
{
  const T = iniciar({ exemplos: true });
  const idAntiga = T.uid();
  venda(T, T.pedro, { 'var-l100': 1 }, 'fp-pix', null, idAntiga);
  const p = T.ch(T.pedro, 'preco.alterar', { variante_id: 'var-l100', preco_centavos: 260 });
  ok(p.ok, 'preço alterado');
  ok(T.ch(T.pedro, 'preco.alterar', { variante_id: 'var-l100', preco_centavos: 260 }).msg === 'Preço já é esse.', 'mesmo preço não cria linha');
  ok(/limite/.test(T.ch(T.pedro, 'preco.alterar', { variante_id: 'var-l100', preco_centavos: 5 }).erro), 'preço mínimo');
  const pv = T.db().t('preco_venda').filter((x) => x.variante_id === 'var-l100');
  ok(pv.length === 2 && pv[0].vigente_ate && !pv[1].vigente_ate, 'preço antigo fechado e novo aberto', pv);
  ok(T.db().achar('venda', idAntiga).total_cafe_centavos === 250, 'venda antiga mantém o preço da hora');
  const nova = venda(T, T.pedro, { 'var-l100': 1 });
  ok(T.db().t('venda').slice(-1)[0].total_cafe_centavos === 260, 'venda nova usa o preço novo');
  ok(T.ch(T.pedro, 'preco.alterar', { variante_id: 'var-l100', preco_centavos: 270 }).ok && ver(T, T.pedro, 'cadastros', 'produtos').historico.length === 2, 'várias mudanças no mesmo dia ficam em ordem (histórico)', ver(T, T.pedro, 'cadastros', 'produtos').historico);
  ok(ver(T, T.pedro, 'cadastros', 'produtos').historico[0].replace(/\u00A0/g, ' ').indexOf('R$ 2,60 \u2192 R$ 2,70') >= 0, 'histórico mostra de → para');
  ok(T.ch(T.pedro, 'variante.ativo', { id: 'var-n50', ativo: false }).ok && !ver(T, T.pedro, 'venda').produtos.some((x) => x.id === 'var-n50'), 'produto fora de venda some da Venda');
  ok(/indisponível/.test(venda(T, T.pedro, { 'var-n50': 1 }).erro), 'e não pode ser vendido');
  const r = T.ch(T.pedro, 'receita.salvar', { colheres_por_litro: 5 });
  ok(r.ok && T.db().t('receita_cafe').length === 2, 'receita nova por vigência');
  preparo(T, T.pedro, 1, {});
  const cons = T.db().t('preparo_consumo').filter((c) => c.preparo_id === T.db().t('preparo').slice(-1)[0].id && c.material_id === 'mat-cafe')[0];
  ok(cons.qtd_real_qtd === 35, 'preparo novo usa a receita nova (5 x 7 g)', cons);
  const rpAntigo = T.db().t('preparo_consumo').filter((c) => c.preparo_id === T.db().t('preparo')[0].id && c.material_id === 'mat-cafe')[0];
  ok(rpAntigo.qtd_real_qtd === 42, 'preparo antigo mantém a receita da época');
  ok(/inválido/.test(T.ch(T.pedro, 'receita.salvar', { g_por_colher: 0 }).erro), 'receita com zero recusada');
  ok(T.ch(T.pedro, 'composicao.salvar', { variante_id: 'var-l100', leite_ml: 50 }).ok && ver(T, T.pedro, 'venda').produtos.find((x) => x.id === 'var-l100').cafeMl === 50, 'composição do copo por vigência');
  ok(/limite/.test(T.ch(T.pedro, 'composicao.salvar', { variante_id: 'var-l50', leite_ml: 45 }).erro), 'leite não pode tirar todo o café');
  ok(T.ch(T.pedro, 'material.salvar', { id: 'mat-cafe', estoque_minimo_qtd: 600, preco_padrao_centavos: 3000, pacote_qtd: 500 }).ok, 'material editado');
  const mc = T.db().achar('material', 'mat-cafe');
  ok(mc.estoque_minimo_qtd === 600 && mc.preco_padrao_centavos === 3000 && mc.versao === 2, 'material mudou e subiu a versão');
  ok(/pacote_qtd/.test(T.ch(T.pedro, 'material.salvar', { id: 'mat-cafe', pacote_qtd: 0 }).erro), 'pacote zero recusado');
  const nm = T.ch(T.pedro, 'material.salvar', { novo_id: T.uid(), nome: 'Copo 100 ml', unidade: 'un' });
  ok(nm.ok && T.db().t('material').some((m) => m.nome === 'Copo 100 ml' && m.unidade === 'un' && m.pacote_qtd === 10 && m.codigo === 'MAT001'), 'material novo com padrões da unidade');
  ok(/Já existe/.test(T.ch(T.pedro, 'material.salvar', { novo_id: T.uid(), nome: 'copo 100 ML', unidade: 'un' }).erro), 'nome repetido (maiúsculas ignoradas)');
  ok(/Digite o nome/.test(T.ch(T.pedro, 'material.salvar', { novo_id: T.uid(), nome: '', unidade: 'g' }).erro) && /unidade/.test(T.ch(T.pedro, 'material.salvar', { novo_id: T.uid(), nome: 'Xis', unidade: 'kg' }).erro), 'nome e unidade obrigatórios');
  ok(T.ch(T.pedro, 'material.salvar', { id: 'mat-acucar', ativo: false }).ok && !ver(T, T.pedro, 'compra').materiais.some((m) => m.id === 'mat-acucar') && !ver(T, T.pedro, 'estoque', 'saldos').linhas.some((m) => m.id === 'mat-acucar'), 'material inativo some de Compra e Estoque');
  ok(T.ch(T.pedro, 'promocao.salvar', { id: 'promo-1', ativo: true, desconto_pct: 15 }).ok && ver(T, T.pedro, 'cadastros', 'promos').promocoes[0].desconto === 15, 'promoção cadastrada');
  ok(/Desconto/.test(T.ch(T.pedro, 'promocao.salvar', { id: 'promo-1', desconto_pct: 80 }).erro), 'desconto máximo');
  ok(T.ch(T.pedro, 'sistema.auditar').limpo, 'auditoria limpa');
}

grupo('gravação (filhos primeiro, mãe por último) e travas');
{
  const T = iniciar({ exemplos: true });
  const antes = T.amb.travas.historico;
  venda(T, T.pedro, { 'var-n50': 1 });
  ok(T.amb.travas.historico === antes + 1 && T.amb.travas.n === 0, 'cada gravação pega e solta a trava');
  ver(T, T.pedro, 'venda');
  ok(T.amb.travas.historico === antes + 1, 'leitura não usa trava');
  const consoleOriginal = T.ctx.console; T.ctx.console = { error() { }, log() { } };
  const orig = T.ctx.Banco.prototype.anexar, nVendas0 = T.db().t('venda').length;
  T.ctx.Banco.prototype.anexar = function (nome, objs) { if (nome === 'movimento_cafe') throw new Error('queda no meio'); return orig.call(this, nome, objs); };
  const r = venda(T, T.pedro, { 'var-n100': 3 });
  T.ctx.Banco.prototype.anexar = orig; T.ctx.console = consoleOriginal;
  ok(!r.ok && /queda no meio/.test(r.erro) && T.amb.travas.n === 0, 'erro no meio devolve erro e solta a trava', r);
  const db = T.db();
  ok(db.t('venda').length === nVendas0 && db.t('venda').every((v) => v.status === 'ATIVO'), 'sem a linha-mãe a venda não existe (nada de registro pela metade)');
  ok(db.t('venda_item').some((i) => !db.achar('venda', i.venda_id)), 'sobrou lixo dos filhos, sem pai');
  ok(T.ctx.agregados_(db, T.ctx.AGORA_TESTE().dataHora).nVendas === 6 && ver(T, T.pedro, 'venda').saldoMl === 950, 'e o lixo não conta em totais nem no saldo (5 de exemplo + 1)');
  const a = T.ch(T.pedro, 'sistema.auditar');
  ok(!a.limpo && a.achados.some((x) => /venda_id aponta para venda inexistente/.test(x.msg)), 'a auditoria acusa o lixo', a.achados);
  ok(venda(T, T.pedro, { 'var-n100': 3 }).ok, 'repetir a venda funciona');
  ok(T.ch(T.pedro, 'xpto').erro === 'Operação desconhecida.', 'operação desconhecida');
  ok(T.ch(T.pedro, 'ver', { tela: 'xpto' }).erro === 'Tela desconhecida.', 'tela desconhecida');
  // sobra no livro sem origem
  const T2 = iniciar({ exemplos: true });
  T2.db().anexar('movimento_cafe', [{ id: T2.uid(), tipo: 'VENDA', ml_cafe: -50, data_hora: T2.ctx.AGORA_TESTE().dataHora, dia_local: H(T2), origem_tabela: 'venda', origem_id: 'nao-existe-0001', estorno_de_id: null }]);
  ok(T2.ch(T2.pedro, 'sistema.auditar').achados.some((x) => /sem o registro de origem/.test(x.msg)) && ver(T2, T2.pedro, 'venda').saldoMl === 1000, 'linha de livro sem origem: acusada e não entra no saldo');
}

grupo('auditoria detecta mexida à mão');
{
  const T = iniciar({ exemplos: true });
  ok(T.ch(T.pedro, 'sistema.auditar').limpo, 'base limpa');
  const sh = T.ss.getSheetByName('venda'), col = (nome) => T.ctx.esquemaTabela_('venda').colunas.findIndex((c) => c.nome === nome) + 1;
  sh.getRange(2, col('forma_pagamento_id')).setValue('fp-inexistente');
  sh.getRange(3, col('status')).setValue('QUASE');
  sh.getRange(4, col('total_cafe_centavos')).setValue(1);
  const sh2 = T.ss.getSheetByName('movimento_estoque');
  sh2.getRange(2, T.ctx.esquemaTabela_('movimento_estoque').colunas.findIndex((c) => c.nome === 'qtd') + 1).setValue(-100000);
  const a = T.ch(T.pedro, 'sistema.auditar'), t = JSON.stringify(a.achados);
  ok(!a.limpo && a.erros >= 3, 'auditoria acusa erros', a.erros);
  ok(/forma_pagamento_id aponta para forma_pagamento inexistente/.test(t), 'chave estrangeira quebrada');
  ok(/status fora da lista/.test(t), 'valor fora da lista');
  ok(/difere da soma dos itens/.test(t), 'total que não bate com os itens');
  ok(/estoque negativo/.test(t) && a.achados.find((x) => /estoque negativo/.test(x.msg)).nivel === 'ALERTA', 'estoque negativo vira ALERTA (não é erro de dados)');
}

grupo('DDL do MySQL e exportação');
{
  const T = iniciar({ exemplos: true });
  const ddl = T.ctx.gerarDDL_();
  const n = (ddl.match(/CREATE TABLE/g) || []).length;
  ok(n === 31, '31 tabelas no DDL', n);
  ok(/CREATE TABLE `venda`/.test(ddl) && /`total_cafe_centavos` BIGINT NOT NULL/.test(ddl) && /`status` ENUM\('GRAVANDO','ATIVO','ESTORNADO'\) NOT NULL/.test(ddl) && /`cliente_id` CHAR\(36\) NULL/.test(ddl), 'tipos corretos no DDL');
  ok(/UNIQUE KEY `uq_venda_numero`/.test(ddl) && /PRIMARY KEY \(`id`\)/.test(ddl) && /ADD CONSTRAINT `fk_venda_usuario_id` FOREIGN KEY/.test(ddl), 'chaves único, primária e estrangeira');
  ok(ddl.indexOf('CREATE TABLE `cliente`') < ddl.indexOf('CREATE TABLE `venda`') && ddl.indexOf('CREATE TABLE `venda`') < ddl.indexOf('CREATE TABLE `venda_item`'), 'tabelas na ordem de dependência');
  const ordem = T.ctx.ordemDeCarga_();
  ok(ordem.length === 31 && ordem.indexOf('usuario') < ordem.indexOf('compra') && ordem.indexOf('compra') < ordem.indexOf('compra_item'), 'ordem de carga', ordem.slice(0, 5));
  ok(!/\bundefined\b/.test(ddl), 'DDL sem "undefined"');
  const url = T.ctx.exportarCSV_(T.ss, T.ctx.AGORA_TESTE());
  const pasta = T.amb.drive.pastas[0];
  ok(/drive/.test(url) && pasta.arquivos.length === 32 && pasta.arquivos.some((a) => a.nome === 'schema.sql'), '31 CSVs + schema.sql na pasta', pasta.arquivos.length);
  const csv = pasta.arquivos.find((a) => a.nome === 'numero_sorteio.csv').conteudo.split('\n');
  ok(csv[0] === 'id,numero,token,cliente_id,venda_id,sorteio_id,valor_centavos,criado_em,status' && /,0453,/.test(csv[1]), 'CSV com cabeçalho na ordem do esquema e token preservado', csv.slice(0, 2));
  ok(T.ctx.csvCampo_('a,"b"') === '"a,""b"""' && T.ctx.csvCampo_(true) === '1' && T.ctx.csvCampo_(null) === '', 'escape de CSV');
}

grupo('zerar movimentos');
{
  const T = iniciar({ exemplos: true });
  T.ch(T.pedro, 'cliente.salvar', { novo_id: T.uid(), nome: 'Cliente Real', telefone: '71977770000', email: 'real@gmail.com' });
  T.ctx.zerarMovimentos_(T.ss, new Date().toISOString());
  const db = T.db();
  ok(['compra', 'venda', 'preparo', 'movimento_estoque', 'movimento_cafe', 'numero_sorteio', 'estorno', 'log_sistema'].every((t) => db.t(t).length === 0), 'movimentos, livros e controle zerados');
  ok(db.t('cliente').length === 1 && db.t('cliente')[0].nome === 'Cliente Real', 'clientes de exemplo saem, o real fica');
  ok(db.t('material').length === 8 && db.t('preco_venda').length === 6, 'cadastros ficam');
  const r = T.ch(T.pedro, 'cliente.salvar', { novo_id: T.uid(), nome: 'Outro Real', telefone: '71977771111', email: 'real2@gmail.com' });
  ok(r.ok && T.db().achar('cliente', r.cliente_id).codigo !== 'C001' && T.db().t('cliente').map((c) => c.codigo).length === new Set(T.db().t('cliente').map((c) => c.codigo)).size, 'contador de código de cliente não volta atrás', T.db().t('cliente').map((c) => c.codigo));
  ok(T.ch(T.pedro, 'sistema.auditar').limpo, 'auditoria limpa depois de zerar');
  ok(ver(T, T.pedro, 'venda').saldoMl === 0, 'saldo zerado');
}

grupo('crescimento além das 1.000 linhas da aba');
{
  const T = iniciar();
  const antes = T.db().t('log_sistema').length;
  const linhas = [];
  for (let i = 0; i < 1500; i++) linhas.push({ id: T.uid(), data_hora: '2026-10-05T12:00:00.000Z', usuario_id: null, acao: 'teste', tabela: null, id_registro: null, resultado: 'OK', detalhe: 'linha ' + i });
  T.db().anexar('log_sistema', linhas);
  T.db().anexar('log_sistema', linhas.slice(0, 700).map((l) => Object.assign({}, l, { id: T.uid() })));
  ok(T.db().t('log_sistema').length === antes + 2200, 'gravar 2.200 linhas numa aba de 1.000 amplia a aba', T.db().t('log_sistema').length);
  ok(T.ss.getSheetByName('log_sistema').getMaxRows() > 2200, 'a aba cresceu');
  ok(T.db().t('log_sistema')[2199].detalhe === 'linha 699', 'as linhas novas estão certas');
  ok(T.ch(T.pedro, 'sistema.auditar').limpo, 'auditoria limpa com a aba grande');
}

grupo('receita por pessoa, açúcar e ajustes no preparo');
{
  const T = iniciar({ exemplos: true });
  const ts = () => T.ctx.AGORA_TESTE().dataHora;
  const rv = ver(T, T.pedro, 'preparo');
  ok(rv.receitaPor['usr-pedro'].filtros === 1 && !rv.receitaPor['usr-pedro'].propria && rv.receitaPor['usr-digo'].acucar === 0, 'no começo todos usam a receita padrão (1 filtro por litro, sem açúcar)', rv.receitaPor);
  const e = T.ch(T.pedro, 'receita.salvar', { usuario_id: 'usr-pedro', filtros_por_litro: 0, acucar_g_por_litro: 10 });
  ok(e.ok && /Receita de Pedro/.test(e.msg), 'Pedro cria receita própria: sem filtro de papel e com 10 g de açúcar por litro', e);
  const rv2 = ver(T, T.pedro, 'preparo');
  ok(rv2.receitaPor['usr-pedro'].filtros === 0 && rv2.receitaPor['usr-pedro'].acucar === 10 && rv2.receitaPor['usr-pedro'].propria, 'a receita do Pedro vale para ele');
  ok(rv2.receitaPor['usr-digo'].filtros === 1 && rv2.receitaPor['usr-digo'].acucar === 0 && !rv2.receitaPor['usr-digo'].propria, 'a do Digo não muda');
  ok(T.ch(T.pedro, 'receita.salvar', { usuario_id: 'usr-pedro', filtros_por_litro: -1 }).erro.indexOf('inválido') >= 0 && /inválido/.test(T.ch(T.pedro, 'receita.salvar', { colheres_por_litro: 0 }).erro), 'filtro 0 pode, colher 0 não');
  const c1 = T.ctx.consumoPreparo_(T.db(), ts(), 1, {}, 'usr-pedro').consumo, c2 = T.ctx.consumoPreparo_(T.db(), ts(), 1, {}, 'usr-digo').consumo;
  ok(c1['mat-filtro'] === undefined && c1['mat-acucar'] === 10 && c2['mat-filtro'] === 1 && c2['mat-acucar'] === undefined, 'consumo calculado: Pedro sem filtro e com açúcar; Digo com filtro e sem açúcar', [c1, c2]);
  const f1 = preparo(T, T.pedro, 1, {}, 'usr-pedro');
  ok(f1.ok && f1.atencao && /Atenção: faltou estoque de Açúcar \(faltam 10 g\) para Pedro/.test(f1.msg), 'Pedro ainda não tem açúcar: registra e avisa quanto faltou', f1.msg);
  ok(T.ch(T.pedro, 'estornar', { tabela: 'preparo', id: T.db().t('preparo').slice(-1)[0].id }).ok, 'desfaz para seguir o roteiro');
  ok(T.ch(T.digo, 'estoque.mover', { id: T.uid(), tipo: 'TRANSFERENCIA', material_id: 'mat-acucar', de: 'usr-digo', qtd: 500 }).ok, 'Digo passa 500 g de açúcar para o Pedro');
  const f2 = preparo(T, T.pedro, 1, {}, 'usr-pedro');
  ok(f2.ok, 'agora o Pedro prepara', f2);
  const sal = T.ctx.saldosEstoque_(T.db());
  ok(sal['usr-pedro']['mat-acucar'] === 490 && sal['usr-pedro']['mat-filtro'] === 28, 'baixou 10 g de açúcar e NENHUM filtro do estoque do Pedro (continuam os 28 filtros)', [sal['usr-pedro']['mat-acucar'], sal['usr-pedro']['mat-filtro']]);
  ok(T.ch(T.pedro, 'receita.padrao', { usuario_id: 'usr-pedro' }).ok && !ver(T, T.pedro, 'preparo').receitaPor['usr-pedro'].propria && ver(T, T.pedro, 'preparo').receitaPor['usr-pedro'].filtros === 1, 'voltar à receita padrão da casa');
  ok(/já usa/.test(T.ch(T.pedro, 'receita.padrao', { usuario_id: 'usr-pedro' }).msg), 'voltar duas vezes não quebra');
  // padrão da casa não mexe na receita própria já criada
  T.ch(T.pedro, 'receita.salvar', { usuario_id: 'usr-digo', acucar_g_por_litro: 5 });
  T.ch(T.pedro, 'receita.salvar', { colheres_por_litro: 6 });
  const rv3 = ver(T, T.pedro, 'preparo').receitaPor;
  ok(rv3['usr-digo'].colheres === 4 && rv3['usr-digo'].acucar === 5 && rv3['usr-pedro'].colheres === 6, 'receita própria (Digo) não muda quando a casa muda; quem usa a da casa (Pedro) muda', rv3);
  const cr = ver(T, T.pedro, 'cadastros', 'receitas');
  ok(cr.escopos.length === 3 && cr.escopos[0].nome === 'Padrão da casa' && cr.escopos[2].propria && !cr.escopos[1].propria, 'tela de receitas: casa, Pedro, Digo', cr.escopos.map((x) => [x.nome, x.propria]));
  // ajustes dentro do próprio preparo
  const T2 = iniciar({ exemplos: true });
  T2.ch(T2.digo, 'estoque.mover', { id: T2.uid(), tipo: 'TRANSFERENCIA', material_id: 'mat-acucar', de: 'usr-digo', qtd: 500 });
  const idA = T2.uid();
  const a = T2.ch(T2.pedro, 'preparo.registrar', { id: idA, litros: 1, plano: {}, quem: 'usr-pedro', ajustes: { 'mat-filtro': 0, 'mat-acucar': 20 } });
  ok(a.ok && /2 ajustes/.test(a.msg), 'preparo com 2 ajustes: sem filtro e com 20 g de açúcar', a);
  const cons = T2.db().t('preparo_consumo').filter((x) => x.preparo_id === idA), g = (m) => cons.find((x) => x.material_id === m);
  ok(g('mat-filtro').qtd_padrao_qtd === 1 && g('mat-filtro').qtd_real_qtd === 0 && g('mat-acucar').qtd_padrao_qtd === 0 && g('mat-acucar').qtd_real_qtd === 20, 'guarda o padrão (receita) e o real (usado)', cons.map((x) => [x.material_id, x.qtd_padrao_qtd, x.qtd_real_qtd]));
  ok(g('mat-acucar').custo_atual_centavos === Math.round(20 * 450 / 1000) && g('mat-filtro').custo_atual_centavos === 0, 'o custo usa a quantidade real', g('mat-acucar'));
  const led = T2.db().t('movimento_estoque').filter((x) => x.origem_id === idA);
  ok(!led.some((x) => x.material_id === 'mat-filtro') && led.find((x) => x.material_id === 'mat-acucar').qtd === -20, 'o estoque baixa o real: nada de filtro, 20 g de açúcar');
  ok(/Material inválido/.test(T2.ch(T2.pedro, 'preparo.registrar', { id: T2.uid(), litros: 1, plano: {}, quem: 'usr-pedro', ajustes: { 'mat-xxx': 5 } }).erro) && /Quantidade inválida/.test(T2.ch(T2.pedro, 'preparo.registrar', { id: T2.uid(), litros: 1, plano: {}, quem: 'usr-pedro', ajustes: { 'mat-acucar': -3 } }).erro), 'ajuste com material ou quantidade inválida é recusado');
  const idX = T2.uid(), ex = T2.ch(T2.pedro, 'preparo.registrar', { id: idX, litros: 1, plano: {}, quem: 'usr-pedro', ajustes: { 'mat-acucar': 9999 } });
  ok(ex.ok && ex.atencao && /Açúcar/.test(ex.msg), 'ajuste acima do estoque: registra e avisa');
  ok(T2.ch(T2.pedro, 'estornar', { tabela: 'preparo', id: idX }).ok, 'e desfaz');
  ok(T2.ch(T2.pedro, 'estornar', { tabela: 'preparo', id: idA }).ok && T2.ctx.saldosEstoque_(T2.db())['usr-pedro']['mat-acucar'] === 500, 'desfazer devolve exatamente o que foi usado');
  ok(T2.ch(T2.pedro, 'sistema.auditar').limpo, 'auditoria limpa (livro bate com o consumo real)');
}

grupo('estoque: contar e corrigir');
{
  const T = iniciar({ exemplos: true });
  const cont = (u, mat, v, id) => T.ch(T.pedro, 'estoque.contar', { id: id || T.uid(), material_id: mat, usuario_id: u, contado: v });
  const r = cont('usr-pedro', 'mat-cafe', 900);
  ok(r.ok && /958 → 900 g/.test(r.msg.replace(/\u00A0/g, ' ')), 'contagem do café: tinha 958, contou 900', r.msg);
  ok(T.ctx.saldosEstoque_(T.db())['usr-pedro']['mat-cafe'] === 900, 'saldo virou 900');
  const aj = T.db().t('ajuste_estoque').slice(-1)[0];
  ok(aj.tipo === 'AJUSTE' && aj.qtd === -58 && aj.motivo === 'Contagem de estoque', 'virou um ajuste de −58 com motivo "Contagem de estoque"', aj);
  ok(cont('usr-pedro', 'mat-cafe', 900).igual === true && T.db().t('ajuste_estoque').length === 1, 'contar o mesmo valor não cria registro');
  ok(cont('usr-digo', 'mat-cafe', 650).ok && T.ctx.saldosEstoque_(T.db())['usr-digo']['mat-cafe'] === 650, 'contagem para o estoque do Digo (para cima)');
  ok(/quantidade que você contou/.test(cont('usr-pedro', 'mat-cafe', -1).erro) && /Material inválido/.test(cont('usr-pedro', 'mat-zzz', 1).erro), 'contagem inválida é recusada');
  const idc = T.uid(); cont('usr-pedro', 'mat-leite', 3000, idc); const rep = cont('usr-pedro', 'mat-leite', 3000, idc);
  ok(rep.repetido, 'reenviar a mesma contagem não duplica');
  const movs = ver(T, T.pedro, 'estoque', 'movs').movs;
  ok(movs.slice(0, 3).every((m) => m.desfazer && m.tabela === 'ajuste_estoque'), 'movimentos recentes mostram "desfazer" para os ajustes', movs.slice(0, 3));
  ok(movs.some((m) => m.tabela === 'compra' && m.desfazer) && movs.some((m) => m.tabela === 'preparo' && m.desfazer), 'também para compra e preparo');
  const m0 = movs[0];
  ok(T.ch(T.pedro, 'estornar', { tabela: m0.tabela, id: m0.origem }).ok, 'desfazer a contagem pelo movimento');
  ok(!ver(T, T.pedro, 'estoque', 'movs').movs.filter((m) => m.tipo === 'ESTORNO').some((m) => m.desfazer), 'linhas de estorno não oferecem desfazer');
  const sl = ver(T, T.pedro, 'estoque', 'saldos').linhas.find((l) => l.id === 'mat-cafe');
  ok(sl.passo === 50 && sl.min === 500, 'saldos trazem mínimo e passo para editar na tela', sl);
}

grupo('compra: corrigir, e listas editáveis');
{
  const T = iniciar({ exemplos: true });
  const c0 = compra(T, T.pedro, 'mat-acucar', 1, 450);
  const velho = T.db().t('compra').slice(-1)[0];
  const antes = T.ctx.saldosEstoque_(T.db())['usr-pedro']['mat-acucar'];
  const idN = T.uid();
  const co = T.ch(T.pedro, 'compra.registrar', { id: idN, corrige_id: velho.id, material_id: 'mat-acucar', embalagens: 2, valor_centavos: 900, fornecedor_id: 'for-b' });
  ok(co.ok && /Compra corrigida/.test(co.msg), 'corrigir: 1 pacote → 2 pacotes', co);
  ok(T.db().achar('compra', velho.id).status === 'ESTORNADO' && T.db().achar('compra', idN).status === 'ATIVO' && /Corrige a compra #/.test(T.db().achar('compra', idN).observacao), 'a antiga fica ESTORNADA e a nova registra "Corrige a compra #…"');
  ok(T.ctx.saldosEstoque_(T.db())['usr-pedro']['mat-acucar'] === antes + 1000, 'o estoque ficou certo: +1.000 g em relação à antes da correção', [antes, T.ctx.saldosEstoque_(T.db())['usr-pedro']['mat-acucar']]);
  ok(/não está mais ativa/.test(T.ch(T.pedro, 'compra.registrar', { id: T.uid(), corrige_id: velho.id, material_id: 'mat-acucar', embalagens: 1, valor_centavos: 450, fornecedor_id: 'for-a' }).erro), 'não corrige compra já desfeita');
  // corrigir que deixaria o estoque negativo não grava nada
  const cx = compra(T, T.digo, 'mat-canela', 1, 800), nc = T.db().t('compra').length;
  const dig = T.db().t('compra').slice(-1)[0];
  T.ch(T.digo, 'estoque.mover', { id: T.uid(), tipo: 'TRANSFERENCIA', material_id: 'mat-canela', de: 'usr-digo', qtd: 50 });
  const neg = T.ch(T.digo, 'compra.registrar', { id: T.uid(), corrige_id: dig.id, material_id: 'mat-acucar', embalagens: 1, valor_centavos: 450, fornecedor_id: 'for-a' });
  ok(/ficaria negativo/.test(neg.erro) && T.db().t('compra').length === nc && T.db().achar('compra', dig.id).status === 'ATIVO', 'correção que deixa estoque negativo é recusada e não grava nada', neg.erro);
  const e1 = T.db().t('estorno').length;
  ok(T.ch(T.pedro, 'sistema.auditar').limpo, 'auditoria limpa depois das correções');
  // listas
  const ls = (tabela, p) => T.ch(T.pedro, 'lista.salvar', Object.assign({ tabela: tabela }, p));
  const nid = T.uid();
  ok(ls('fornecedor', { novo_id: nid, nome: 'Atacadão' }).ok && ver(T, T.pedro, 'compra').fornecedores.some((f) => f.nome === 'Atacadão'), 'novo local de compra aparece na tela de Compra');
  ok(ls('fornecedor', { novo_id: nid, nome: 'Atacadão' }).repetido, 'reenviar não duplica');
  ok(/Já existe/.test(ls('fornecedor', { novo_id: T.uid(), nome: 'atacadão' }).erro) && /2 a 40/.test(ls('fornecedor', { novo_id: T.uid(), nome: 'A' }).erro) && /Lista inválida/.test(ls('usuario', { novo_id: T.uid(), nome: 'Xis' }).erro), 'nome repetido, curto ou lista inválida');
  ok(ls('fornecedor', { id: nid, nome: 'Atacadão Centro' }).ok && T.db().achar('fornecedor', nid).nome === 'Atacadão Centro' && T.db().achar('fornecedor', nid).versao === 2, 'renomear');
  ok(compra(T, T.pedro, 'mat-acucar', 1, 450, nid).ok, 'dá para comprar no local novo');
  ok(ls('fornecedor', { id: nid, ativo: false }).ok && !ver(T, T.pedro, 'compra').fornecedores.some((f) => f.id === nid), 'inativar tira da tela de Compra (a compra antiga continua)');
  ok(ls('forma_pagamento', { novo_id: T.uid(), nome: 'Vale-refeição' }).ok && ver(T, T.pedro, 'venda').formas.some((f) => f.nome === 'Vale-refeição'), 'nova forma de pagamento aparece na Venda');
  ok(ls('motivo_perda', { novo_id: T.uid(), nome: 'Cliente devolveu' }).ok && ver(T, T.pedro, 'fechamento').motivos.some((m) => m.nome === 'Cliente devolveu'), 'novo motivo de perda aparece no Fechamento');
  ['fp-dinheiro', 'fp-pix'].forEach((id) => ls('forma_pagamento', { id: id, ativo: false }));
  ls('forma_pagamento', { id: 'fp-cartao', ativo: false });
  const ultimoAtivo = T.db().t('forma_pagamento').filter((f) => f.ativo);
  ok(ultimoAtivo.length === 1, 'sobra um ativo', ultimoAtivo.length);
  ok(/pelo menos um/.test(ls('forma_pagamento', { id: ultimoAtivo[0].id, ativo: false }).erro), 'não deixa inativar o último item da lista');
  ok(ver(T, T.pedro, 'cadastros', 'listas').listas.length === 3, 'tela de listas traz as 3 listas');
}

grupo('painéis batem com os registros');
{
  const T = iniciar({ exemplos: true });
  const fR = (c) => T.ctx.fmtR_(c).replace(/\u00A0/g, ' ');
  const lim = (s) => String(s).replace(/\u00A0/g, ' ');
  const tile = (v, l) => lim(v.tiles.find((x) => x.lbl === l).val);
  const barra = (lista, l) => lista.find((x) => x.lbl === l);
  // movimento extra e variado
  venda(T, T.pedro, { 'var-c100': 2, 'var-n50': 3 }, 'fp-cartao');
  venda(T, T.digo, { 'var-l50': 1 }, 'fp-pix', { cliente_id: 'cli-joao-exemplo', n: 3 });
  preparo(T, T.pedro, 2, { 'var-n100': 4 });
  compra(T, T.digo, 'mat-cafe', 1, 3100, 'for-b');
  T.ch(T.pedro, 'cafe.perda', { id: T.uid(), ml: 100, motivo_id: 'mp-derramou' });
  T.ch(T.pedro, 'financeiro.lancar', { id: T.uid(), tipo: 'DESPESA', usuario_id: 'usr-pedro', valor_centavos: 350 });
  T.ch(T.pedro, 'financeiro.lancar', { id: T.uid(), tipo: 'REEMBOLSO', usuario_id: 'usr-digo', valor_centavos: 500 });
  const idDesf = T.db().t('venda')[0].id; T.ch(T.pedro, 'estornar', { tabela: 'venda', id: idDesf });   // uma venda desfeita não pode contar
  // verdades calculadas direto dos registros, sem usar o código do sistema
  const db = T.db(), vA = db.t('venda').filter((v) => v.status === 'ATIVO'), pA = db.t('preparo').filter((p) => p.status === 'ATIVO'), cA = db.t('compra').filter((c) => c.status === 'ATIVO');
  const soma = (a, f) => a.reduce((t, x) => t + f(x), 0);
  const fat = soma(vA, (v) => v.total_cafe_centavos), fatS = soma(vA, (v) => v.total_sorteio_centavos), copos = soma(vA, (v) => v.copos);
  const itens = db.t('venda_item').filter((i) => vA.some((v) => v.id === i.venda_id));
  const consAt = db.t('preparo_consumo').filter((c) => pA.some((p) => p.id === c.preparo_id));
  const custoAt = soma(consAt, (c) => c.custo_atual_centavos), gasto = soma(cA, (c) => c.valor_total_centavos);
  const desp = soma(db.t('lancamento_financeiro').filter((l) => l.status === 'ATIVO' && l.tipo === 'DESPESA'), (l) => l.valor_centavos);
  const g = ver(T, T.pedro, 'paineis', 'geral', undefined);
  const painel = (sub, periodo) => T.ch(T.pedro, 'ver', { tela: 'paineis', sub: sub, periodo: periodo || 'tudo' });
  let v = painel('geral');
  ok(tile(v, 'Faturamento dos cafés') === fR(fat), 'Geral: faturamento = soma dos cafés das vendas ativas', [tile(v, 'Faturamento dos cafés'), fR(fat)]);
  ok(tile(v, 'Copos vendidos') === String(copos), 'Geral: copos vendidos', [tile(v, 'Copos vendidos'), copos]);
  ok(tile(v, 'Litros preparados') === T.ctx.fmtN_(soma(pA, (p) => p.litros)) + ' L', 'Geral: litros preparados', tile(v, 'Litros preparados'));
  const pv = (vid) => soma(itens.filter((i) => i.variante_id === vid), (i) => i.qtd);
  ok([['normal 50 ml', 'var-n50'], ['normal 100 ml', 'var-n100'], ['com canela 100 ml', 'var-c100'], ['com leite 50 ml', 'var-l50'], ['com leite 100 ml', 'var-l100'], ['com canela 50 ml', 'var-c50']].every(([l, id]) => parseInt(barra(v.b1, l).val, 10) === pv(id)), 'Geral: copos de cada produto', v.b1.map((b) => [b.lbl, b.val]));
  const pag = (f) => soma(vA.filter((x) => x.forma_pagamento_id === f), (x) => x.total_cafe_centavos + x.total_sorteio_centavos);
  ok(lim(barra(v.b2, 'Dinheiro').val) === fR(pag('fp-dinheiro')) && lim(barra(v.b2, 'Pix').val) === fR(pag('fp-pix')) && lim(barra(v.b2, 'Cartão').val) === fR(pag('fp-cartao')), 'Geral: faturamento por forma de pagamento', v.b2);
  v = painel('vendas');
  ok(tile(v, 'Vendas') === String(vA.length) && tile(v, 'Ticket médio') === fR(fat / vA.length) && lim(tile(v, 'Café vendido')) === T.ctx.fmtN_(soma(vA, (x) => x.ml_cafe)) + ' ml', 'Vendas: quantidade, ticket médio e café vendido');
  ok(v.b1.reduce((t, b) => t + parseInt(b.val, 10), 0) === vA.length, 'Vendas: as vendas por horário somam o total', v.b1);
  v = painel('compras');
  ok(tile(v, 'Gasto total') === fR(gasto) && tile(v, 'Compras') === String(cA.length), 'Compras: gasto e quantidade');
  const pacs = db.t('compra_item').filter((i) => i.material_id === 'mat-cafe' && cA.some((c) => c.id === i.compra_id)).map((i) => i.valor_centavos / i.qtd_base_qtd * 500);
  ok(tile(v, 'Café: menor pacote') === fR(Math.min(...pacs)) && tile(v, 'Café: maior pacote') === fR(Math.max(...pacs)), 'Compras: menor e maior pacote de café', pacs);
  ok(v.b2.length === pacs.length, 'Compras: uma barra por compra de café');
  const loc = (f) => soma(cA.filter((c) => c.fornecedor_id === f), (c) => c.valor_total_centavos);
  ok(lim(barra(v.b1, 'Mercado A').val) === fR(loc('for-a')) && lim(barra(v.b1, 'Mercado B').val) === fR(loc('for-b')), 'Compras: gasto por local', v.b1);
  v = painel('producao');
  const gCafe = soma(consAt.filter((c) => c.material_id === 'mat-cafe'), (c) => c.qtd_real_qtd);
  ok(tile(v, 'Preparos') === String(pA.length) && lim(tile(v, 'Café em pó usado')) === T.ctx.fmtN_(gCafe) + ' g', 'Produção: preparos e café em pó usado');
  ok(lim(barra(v.b2, 'Derramou').val) === '100 ml', 'Produção: perda por motivo');
  ok(parseFloat(barra(v.b1, 'Pedro').val.replace(',', '.')) === soma(pA.filter((p) => p.usuario_id === 'usr-pedro'), (p) => p.litros), 'Produção: litros por pessoa');
  v = painel('fin');
  const receita = fat + fatS;
  ok(tile(v, 'Receita total') === fR(receita) && tile(v, 'Custo (atual)') === fR(custoAt) && tile(v, 'Despesas') === fR(desp), 'Financeiro: receita, custo e despesas');
  ok(tile(v, 'Margem') === Math.round((receita - custoAt - desp) / receita * 100) + '%', 'Financeiro: margem');
  const invD = soma(cA.filter((c) => c.usuario_id === 'usr-digo'), (c) => c.valor_total_centavos);
  ok(barra(v.b1, 'Digo').val === Math.round(500 / invD * 100) + '%', 'Financeiro: payback do Digo = reembolsado ÷ investido', [barra(v.b1, 'Digo').val, 500, invD]);
  v = painel('estoque');
  const sal = T.ctx.saldosEstoque_(db), mats = db.t('material').filter((m) => m.ativo && m.controla_estoque !== false);
  const abaixo = mats.filter((m) => ((sal['usr-pedro'] || {})[m.id] || 0) + ((sal['usr-digo'] || {})[m.id] || 0) < m.estoque_minimo_qtd).length;
  ok(tile(v, 'Abaixo do mínimo') === String(abaixo) && tile(v, 'Materiais ativos') === String(mats.length), 'Estoque: abaixo do mínimo e materiais ativos');
  ok(lim(barra(v.b2, 'Pedro').val) === T.ctx.fmtN_(sal['usr-pedro']['mat-cafe']) + ' g', 'Estoque: café de cada pessoa bate com o saldo');
  v = painel('sorteio');
  const vals = db.t('numero_sorteio').filter((n) => n.status === 'ATIVO' && vA.some((x) => x.id === n.venda_id));
  ok(tile(v, 'Números vendidos (todos)') === String(vals.length) && tile(v, 'No sorteio atual') === String(vals.length) && tile(v, 'Receita dos números') === fR(soma(vals, (n) => n.valor_centavos)), 'Sorteio: números vendidos, no sorteio atual e receita');
  ok(lim(v.b2[0].val) === vals.length + ' de 40 números', 'Sorteio: progresso até a meta', v.b2);
  // a venda desfeita não conta; uma venda nova muda o painel
  const antes = parseInt(tile(painel('vendas'), 'Vendas'), 10);
  venda(T, T.pedro, { 'var-n100': 1 }, 'fp-dinheiro');
  ok(parseInt(tile(painel('vendas'), 'Vendas'), 10) === antes + 1 && tile(painel('geral'), 'Faturamento dos cafés') === fR(fat + 150), 'o painel muda assim que entra uma venda nova');
  // períodos
  const hoje = painel('geral', 'hoje'), tudo = painel('geral', 'tudo');
  ok(lim(painel('compras', 'hoje').tiles[0].val) === fR(3100) && lim(painel('compras', '7d').tiles[0].val) === fR(3100) && tile(painel('compras'), 'Gasto total') === fR(gasto), 'Compras de setembro não entram em "hoje" nem em "7 dias" (só a de hoje, R$ 31,00); "tudo" soma todas');
  ok(tile(hoje, 'Faturamento dos cafés') === tile(tudo, 'Faturamento dos cafés'), 'todas as vendas são de hoje: hoje = tudo');
  T.avancar(60 * 24 * 3);   // 3 dias depois
  venda(T, T.pedro, { 'var-n50': 2 }, 'fp-dinheiro');
  const fatHoje = 200, fatTudo = fat + 150 + 200;
  ok(tile(painel('geral', 'hoje'), 'Faturamento dos cafés') === fR(fatHoje) && tile(painel('geral', '7d'), 'Faturamento dos cafés') === fR(fatTudo) && tile(painel('geral', 'tudo'), 'Faturamento dos cafés') === fR(fatTudo), 'depois de 3 dias: "hoje" só a venda nova; "7 dias" e "tudo" as duas');
  T.avancar(60 * 24 * 7);   // 10 dias depois do começo
  ok(tile(painel('geral', '7d'), 'Faturamento dos cafés') === fR(0) && tile(painel('geral', 'tudo'), 'Faturamento dos cafés') === fR(fatTudo), 'depois de 10 dias: "7 dias" não pega as vendas antigas; "tudo" pega');
  ok(painel('estoque', 'hoje').ignoraPeriodo === true && painel('geral', 'hoje').ignoraPeriodo === false, 'painéis de situação (estoque, sorteio) avisam que ignoram o período');
  ok(painel('fin', 'hoje').b1.find((b) => b.lbl === 'Digo').val === barra(painel('fin', 'tudo').b1, 'Digo').val, 'o payback é sempre o acumulado, mesmo em "hoje"');
}

grupo('velocidade e cache');
{
  const T = iniciar({ exemplos: true });
  const props = T.ctx.PropertiesService.getScriptProperties();
  const TELAS = [['venda'], ['preparo'], ['compra'], ['fechamento'], ['estoque', 'saldos'], ['estoque', 'movs'], ['estoque', 'mexer'], ['paineis', 'geral', 'hoje'], ['paineis', 'compras', 'tudo'], ['paineis', 'sorteio'], ['cadastros', 'materiais'], ['cadastros', 'produtos'], ['cadastros', 'receitas'], ['cadastros', 'listas'], ['financeiro', 'resultado'], ['financeiro', 'lanc'], ['clientes', 'lista'], ['clientes', 'sorteio'], ['historico'], ['sistema']];
  const verSem = (quem, q) => { props.setProperty('CACHE_DESLIGADO', '1'); try { return T.ch(quem, 'ver', q); } finally { props.deleteProperty('CACHE_DESLIGADO'); } };
  const diferencas = (quem) => TELAS.filter((x) => { const q = { tela: x[0], sub: x[1], periodo: x[2] }; return JSON.stringify(T.ch(quem, 'ver', q)) !== JSON.stringify(verSem(quem, q)); }).map((x) => x.join('/'));
  const chamadas = (f) => { T.amb.zerarCont(); const r = f(); return { r: r, planilha: T.amb.cont.planilha, cache: T.amb.cont.cache }; };

  // 1) tela já vista não toca na planilha
  TELAS.forEach((x) => T.ch(T.pedro, 'ver', { tela: x[0], sub: x[1], periodo: x[2] }));
  const lentas = TELAS.filter((x) => chamadas(() => T.ch(T.pedro, 'ver', { tela: x[0], sub: x[1], periodo: x[2] })).planilha > 0).map((x) => x.join('/'));
  ok(lentas.length === 0, 'telas já abertas não fazem NENHUMA chamada à planilha', lentas);
  const c1 = chamadas(() => T.ch(T.digo, 'ver', { tela: 'venda' }));
  ok(c1.planilha === 0 && c1.cache <= 4, 'o cache vale para todos: o Digo abre a Venda sem tocar na planilha (≤ 4 chamadas ao cache)', c1);

  // 2) gravar custa poucas chamadas
  T.ch(T.pedro, 'venda.registrar', { id: T.uid(), itens: { 'var-n50': 1 }, forma_pagamento_id: 'fp-pix', _ver: { tela: 'venda' } });
  const g = {};
  g.venda = chamadas(() => T.ch(T.pedro, 'venda.registrar', { id: T.uid(), itens: { 'var-n50': 1 }, forma_pagamento_id: 'fp-pix', _ver: { tela: 'venda' } }));
  g.vendaSorteio = chamadas(() => T.ch(T.pedro, 'venda.registrar', { id: T.uid(), itens: { 'var-n50': 1 }, forma_pagamento_id: 'fp-pix', sorteio: { cliente_id: 'cli-maria-exemplo', n: 40 }, _ver: { tela: 'venda' } }));
  T.ch(T.pedro, 'preparo.registrar', { id: T.uid(), litros: 1, plano: {}, quem: 'usr-pedro', _ver: { tela: 'preparo' } });
  g.preparo = chamadas(() => T.ch(T.pedro, 'preparo.registrar', { id: T.uid(), litros: 1, plano: {}, quem: 'usr-pedro', _ver: { tela: 'preparo' } }));
  T.ch(T.pedro, 'compra.registrar', { id: T.uid(), material_id: 'mat-cafe', embalagens: 1, valor_centavos: 2700, fornecedor_id: 'for-a', _ver: { tela: 'compra' } });
  g.compra = chamadas(() => T.ch(T.pedro, 'compra.registrar', { id: T.uid(), material_id: 'mat-cafe', embalagens: 1, valor_centavos: 2700, fornecedor_id: 'for-a', _ver: { tela: 'compra' } }));
  T.ch(T.pedro, 'cafe.perda', { id: T.uid(), ml: 50, motivo_id: 'mp-sobra', _ver: { tela: 'fechamento' } });
  g.perda = chamadas(() => T.ch(T.pedro, 'cafe.perda', { id: T.uid(), ml: 50, motivo_id: 'mp-sobra', _ver: { tela: 'fechamento' } }));
  Object.keys(g).forEach((k) => { ok(g[k].r.ok, 'gravação ' + k + ' deu certo', g[k].r.erro); ok(g[k].planilha <= 8, k + ': no máximo 8 chamadas à planilha (era 46 a 86)', g[k].planilha); });
  ok(g.venda.cache <= 6 && g.preparo.cache <= 6, 'e no máximo 6 ao cache', [g.venda.cache, g.preparo.cache]);

  // 3) o cache nunca mostra algo diferente da planilha: compara todas as telas depois de cada operação
  const op = {
    'venda': () => T.ch(T.pedro, 'venda.registrar', { id: T.uid(), itens: { 'var-l100': 2 }, forma_pagamento_id: 'fp-dinheiro' }),
    'venda com sorteio': () => T.ch(T.digo, 'venda.registrar', { id: T.uid(), itens: { 'var-c50': 1 }, forma_pagamento_id: 'fp-pix', sorteio: { cliente_id: 'cli-joao-exemplo', n: 3 } }),
    'preparo com ajuste': () => T.ch(T.pedro, 'preparo.registrar', { id: T.uid(), litros: 1.5, plano: { 'var-n100': 3 }, quem: 'usr-pedro', ajustes: { 'mat-filtro': 0 } }),
    'compra': () => T.ch(T.digo, 'compra.registrar', { id: T.uid(), material_id: 'mat-leite', embalagens: 2, valor_centavos: 1100, fornecedor_id: 'for-b' }),
    'perda de café': () => T.ch(T.pedro, 'cafe.perda', { id: T.uid(), ml: 100, motivo_id: 'mp-derramou' }),
    'transferência': () => T.ch(T.pedro, 'estoque.mover', { id: T.uid(), tipo: 'TRANSFERENCIA', material_id: 'mat-copo50', de: 'usr-pedro', qtd: 5 }),
    'contagem': () => T.ch(T.digo, 'estoque.contar', { id: T.uid(), material_id: 'mat-cafe', usuario_id: 'usr-digo', contado: 321 }),
    'cliente novo': () => T.ch(T.pedro, 'cliente.salvar', { novo_id: T.uid(), nome: 'Cliente Cache', telefone: '71955554444', email: 'cache@gmail.com' }),
    'preço': () => T.ch(T.pedro, 'preco.alterar', { variante_id: 'var-n100', preco_centavos: 175 }),
    'local novo': () => T.ch(T.digo, 'lista.salvar', { tabela: 'fornecedor', novo_id: T.uid(), nome: 'Atacadão Cache' }),
    'receita própria': () => T.ch(T.pedro, 'receita.salvar', { usuario_id: 'usr-pedro', filtros_por_litro: 0, acucar_g_por_litro: 5 }),
    'lançamento': () => T.ch(T.pedro, 'financeiro.lancar', { id: T.uid(), tipo: 'REEMBOLSO', usuario_id: 'usr-pedro', valor_centavos: 800 }),
    'meta do sorteio': () => T.ch(T.pedro, 'config.salvar', { chave: 'sorteio.meta_numeros', valor: 30 }),
    'material': () => T.ch(T.pedro, 'material.salvar', { id: 'mat-agua', estoque_minimo_qtd: 3000 }),
    'novo sorteio': () => T.ch(T.pedro, 'sorteio.novo', { id: T.uid() }),
    'venda depois do novo sorteio': () => T.ch(T.pedro, 'venda.registrar', { id: T.uid(), itens: {}, forma_pagamento_id: 'fp-pix', sorteio: { cliente_id: 'cli-maria-exemplo', n: 2 } }),
    'desfazer venda': () => T.ch(T.pedro, 'estornar', { tabela: 'venda', id: T.db().t('venda').filter((v) => v.status === 'ATIVO').slice(-1)[0].id }),
    'reabrir sorteio': () => T.ch(T.pedro, 'estornar', { tabela: 'sorteio', id: T.db().t('sorteio').filter((s) => s.status === 'ENCERRADO').slice(-1)[0].id }),
    'fechar dia': () => { const d = T.db(); const sal = T.ctx.cafeDoDia_(d, H(T)).saldo; if (sal > 0) T.ch(T.pedro, 'cafe.perda', { id: T.uid(), ml: sal, motivo_id: 'mp-sobra' }); else if (sal < 0) T.ch(T.pedro, 'cafe.acerto', { id: T.uid() }); return T.ch(T.pedro, 'dia.fechar'); },
    'reabrir dia': () => T.ch(T.pedro, 'dia.reabrir'),
    'compra corrigida': () => { const c = T.db().t('compra').filter((x) => x.status === 'ATIVO').slice(-1)[0], i = T.db().t('compra_item').filter((x) => x.compra_id === c.id)[0]; return T.ch(T.digo, 'compra.registrar', { id: T.uid(), corrige_id: c.id, material_id: i.material_id, embalagens: i.embalagens + 1, valor_centavos: c.valor_total_centavos + 100, fornecedor_id: c.fornecedor_id }); }
  };
  const quebras = [];
  Object.keys(op).forEach((nome) => { const r = op[nome](); if (!r.ok) quebras.push(nome + ': ' + r.erro); const d = diferencas(T.pedro); if (d.length) quebras.push(nome + ' → telas diferentes: ' + d.join(', ')); });
  ok(quebras.length === 0, 'depois de cada uma das ' + Object.keys(op).length + ' operações, as ' + TELAS.length + ' telas com cache são IDÊNTICAS às lidas direto da planilha', quebras);
  ok(T.ch(T.pedro, 'sistema.auditar').limpo, 'auditoria limpa depois da sequência toda');

  // 4) edição manual da planilha: onEdit descarta o cache
  T.ch(T.pedro, 'ver', { tela: 'compra' });
  const shMat = T.ss.getSheetByName('material'), colNome = T.ctx.esquemaTabela_('material').colunas.findIndex((c) => c.nome === 'nome') + 1;
  shMat.getRange(2, colNome).setValue('Café MEXIDO À MÃO');
  const velho = T.ch(T.pedro, 'ver', { tela: 'compra' }).materiais.find((m) => m.id === 'mat-cafe').nome;
  ok(velho === 'Café em pó', 'sem avisar, o app ainda mostra o valor guardado no cache', velho);
  T.ctx.onEdit();
  ok(T.ch(T.pedro, 'ver', { tela: 'compra' }).materiais.find((m) => m.id === 'mat-cafe').nome === 'Café MEXIDO À MÃO', 'depois do onEdit (edição manual), o app lê a planilha de novo');
  shMat.getRange(2, colNome).setValue('Café em pó'); T.ctx.onEdit();

  // 5) cache perdido ou quebrado nunca estraga o resultado
  const antes = JSON.stringify(TELAS.map((x) => T.ch(T.pedro, 'ver', { tela: x[0], sub: x[1], periodo: x[2] })));
  Object.keys(T.amb.cache).filter((k) => /^t:/.test(k)).forEach((k, i) => { if (i % 2 === 0) delete T.amb.cache[k]; });    // some metade dos pedaços
  ok(JSON.stringify(TELAS.map((x) => T.ch(T.pedro, 'ver', { tela: x[0], sub: x[1], periodo: x[2] }))) === antes, 'cache pela metade (pedaços sumiram): mesmos resultados');
  Object.keys(T.amb.cache).forEach((k) => { delete T.amb.cache[k]; });
  ok(JSON.stringify(TELAS.map((x) => T.ch(T.pedro, 'ver', { tela: x[0], sub: x[1], periodo: x[2] }))) === antes, 'cache vazio (expirou): mesmos resultados');
  Object.keys(T.amb.cache).filter((k) => /^t:/.test(k)).forEach((k) => { T.amb.cache[k].v = '[[1,2'; });
  ok(JSON.stringify(TELAS.map((x) => T.ch(T.pedro, 'ver', { tela: x[0], sub: x[1], periodo: x[2] }))) === antes, 'cache corrompido: mesmos resultados');
  const CS = T.ctx.CacheService, orig = CS.getScriptCache;
  CS.getScriptCache = () => { throw new Error('Service invoked too many times'); };
  const sem = T.ch(T.pedro, 'venda.registrar', { id: T.uid(), itens: { 'var-n50': 1 }, forma_pagamento_id: 'fp-pix', _ver: { tela: 'venda' } });
  CS.getScriptCache = orig;
  ok(sem.ok && sem.view, 'se o serviço de cache falhar (cota), o app segue funcionando só com a planilha', sem.erro);
  ok(diferencas(T.pedro).length === 0, 'e o cache volta a bater depois da falha');
  props.setProperty('CACHE_DESLIGADO', '1'); T.amb.zerarCont(); T.ch(T.pedro, 'ver', { tela: 'venda' }); const off = T.amb.cont.cache; props.deleteProperty('CACHE_DESLIGADO');
  ok(off === 0, 'o interruptor CACHE_DESLIGADO desliga o cache por completo', off);

  // 6) alguém grava no meio de uma leitura: a leitura velha NÃO pode sujar o cache
  T.ch(T.pedro, 'ver', { tela: 'venda' });
  Object.keys(T.amb.cache).forEach((k) => { if (/^tv:(venda|movimento_cafe)$/.test(k)) delete T.amb.cache[k]; });   // venda e movimento_cafe saem do cache
  const leitor = new T.ctx.Banco(T.ss);
  leitor.prefetch(['usuario'], 'uso:ver:venda:');                                   // o leitor começa aqui…
  leitor.t('venda'); leitor.t('movimento_cafe');                                    // …lê da planilha…
  const nVenda = T.db().t('venda').length;
  T.ch(T.digo, 'venda.registrar', { id: T.uid(), itens: { 'var-n50': 1 }, forma_pagamento_id: 'fp-pix' });  // …e enquanto isso o Digo vende
  leitor.finalizar(false);                                                          // o leitor termina com dados velhos e tenta guardá-los
  const vista = T.ch(T.pedro, 'ver', { tela: 'venda' });
  ok(T.db().t('venda').length === nVenda + 1 && JSON.stringify(vista) === JSON.stringify(verSem(T.pedro, { tela: 'venda' })), 'leitura que ficou velha no meio do caminho não suja o cache (a venda do Digo aparece)');
  // gravação em andamento: leitor não consegue a trava e não alimenta o cache
  const travado = T.ctx.LockService.getScriptLock(); travado.waitLock(1);
  Object.keys(T.amb.cache).forEach((k) => { if (/^tv:cliente$/.test(k)) delete T.amb.cache[k]; });
  T.amb.zerarCont(); T.ch(T.pedro, 'ver', { tela: 'clientes', sub: 'lista' }); travado.releaseLock();
  ok(!T.amb.cache['tv:cliente'], 'enquanto há gravação em andamento, quem só lê não grava no cache');
  ok(T.amb.travas.n === 0, 'e nenhuma trava fica presa');

  // 7) tabela grande é guardada em vários pedaços e volta igual
  const T2 = iniciar({ exemplos: true });
  const grande = []; for (let i = 0; i < 2500; i++) grande.push({ id: T2.uid(), data_hora: '2026-10-05T12:00:00.000Z', usuario_id: 'usr-pedro', acao: 'teste', tabela: null, id_registro: null, resultado: 'OK', detalhe: 'linha com acentuação ç ã é ' + i });
  const dbG = new T2.ctx.Banco(T2.ss); dbG.anexar('log_sistema', grande); dbG.t('log_sistema'); dbG.finalizar(true);
  const chaves = Object.keys(T2.amb.cache).filter((k) => /^t:log_sistema:/.test(k));
  ok(chaves.length >= 3 && chaves.every((k) => Buffer.byteLength(T2.amb.cache[k].v) < 100 * 1024), 'tabela de 2.500 linhas vira ' + chaves.length + ' pedaços, todos abaixo de 100 KB', chaves.length);
  const dbL = new T2.ctx.Banco(T2.ss); dbL.prefetch(['log_sistema']);
  ok(dbL.cache.log_sistema && dbL.cache.log_sistema.length === 2500 + 0 && dbL.cache.log_sistema[2499].detalhe === 'linha com acentuação ç ã é 2499', 'e volta igual do cache (sem ler a planilha)');
}

grupo('água e outros materiais sem controle de estoque');
{
  const T = iniciar({ exemplos: true });
  const agua = T.db().achar('material', 'mat-agua');
  ok(agua.controla_estoque === false && T.db().achar('material', 'mat-cafe').controla_estoque === true, 'água vem sem controle de estoque; os demais controlam');
  ok(!ver(T, T.pedro, 'estoque', 'saldos').linhas.some((l) => l.id === 'mat-agua') && !ver(T, T.pedro, 'compra').materiais.some((m) => m.id === 'mat-agua') && !ver(T, T.pedro, 'estoque', 'mexer').materiais.some((m) => m.id === 'mat-agua'), 'a água não aparece em Estoque nem em Compra');
  ok(ver(T, T.pedro, 'cadastros', 'materiais').materiais.find((m) => m.id === 'mat-agua').controla === false, 'mas aparece em Cadastros, com a opção desligada');
  ok(/não controla estoque/.test(compra(T, T.pedro, 'mat-agua', 1, 100).erro) && /não controla estoque/.test(T.ch(T.pedro, 'estoque.contar', { id: T.uid(), material_id: 'mat-agua', usuario_id: 'usr-pedro', contado: 5 }).erro), 'compra e contagem de água são recusadas com explicação');
  const r = preparo(T, T.pedro, 1, {}, 'usr-pedro'), p = T.db().t('preparo').slice(-1)[0];
  const cons = T.db().t('preparo_consumo').filter((c) => c.preparo_id === p.id), led = T.db().t('movimento_estoque').filter((m) => m.origem_id === p.id);
  ok(r.ok && !r.atencao, 'preparar sem nunca ter "comprado" água: sem aviso nenhum', r);
  ok(cons.some((c) => c.material_id === 'mat-agua' && c.qtd_real_qtd === 1000) && !led.some((m) => m.material_id === 'mat-agua'), 'o consumo de água fica registrado (1.000 ml), mas não mexe no estoque');
  ok(T.ch(T.pedro, 'sistema.auditar').limpo, 'auditoria limpa');
  // liga o controle: passa a aparecer, com saldo zero
  ok(T.ch(T.pedro, 'material.salvar', { id: 'mat-agua', controla_estoque: true }).ok && ver(T, T.pedro, 'estoque', 'saldos').linhas.some((l) => l.id === 'mat-agua'), 'ligar "controla estoque" faz a água aparecer no Estoque');
  const r2 = preparo(T, T.pedro, 1, {}, 'usr-pedro');
  ok(r2.ok && r2.atencao && /Água \(faltam 1\.000 ml\)/.test(r2.msg.replace(/\u00A0/g, ' ')), 'e então o preparo avisa a falta de água (sem travar)', r2.msg);
  ok(T.ch(T.pedro, 'material.salvar', { id: 'mat-agua', controla_estoque: false }).ok && !ver(T, T.pedro, 'estoque', 'saldos').linhas.some((l) => l.id === 'mat-agua'), 'e dá para desligar de novo');
  // material novo nasce controlando
  const nm = T.ch(T.pedro, 'material.salvar', { novo_id: T.uid(), nome: 'Copo 300 ml', unidade: 'un' });
  ok(nm.ok && T.db().t('material').find((m) => m.nome === 'Copo 300 ml').controla_estoque === true, 'material novo nasce controlando estoque');
}

grupo('planilha instalada antes: ganha a coluna nova sem perder nada');
{
  const T = iniciar({ exemplos: true });
  const sh = T.ss.getSheetByName('material'), n = T.ctx.esquemaTabela_('material').colunas.length;
  sh.getRange(1, n).setValue(''); sh.getRange(2, n, 8, 1).clearContent();                    // como era na versão anterior
  const antes = T.db().t('material').map((m) => m.nome + m.estoque_minimo_qtd);
  T.ctx.instalarPlanilha_(T.ss, new Date().toISOString());
  const m = new T.ctx.Banco(T.ss, { semCache: true }).t('material');
  ok(sh.getRange(1, n).getValues()[0][0] === 'controla_estoque', 'o cabeçalho ganha a coluna no fim');
  ok(m.length === 8 && m.find((x) => x.id === 'mat-agua').controla_estoque === false && m.filter((x) => x.controla_estoque === true).length === 7, 'valores iniciais: água sem controle, os outros 7 com controle', m.map((x) => [x.id, x.controla_estoque]));
  ok(JSON.stringify(m.map((x) => x.nome + x.estoque_minimo_qtd)) === JSON.stringify(antes), 'o resto dos dados não muda');
  sh.getRange(1, 3).setValue('renomeada');
  let e = null; try { T.ctx.instalarPlanilha_(T.ss, new Date().toISOString()); } catch (x) { e = x.message; }
  ok(/não confere/.test(e), 'coluna do meio alterada continua sendo recusada');
}

grupo('receita com zeros e configuração em lote');
{
  const T = iniciar({ exemplos: true });
  const e = T.ch(T.pedro, 'receita.salvar', { usuario_id: 'usr-pedro', colheres_por_litro: 3, g_por_colher: 9.5, filtros_por_litro: 0, acucar_g_por_litro: 200, agua_ml_por_litro: 0 });
  const r = ver(T, T.pedro, 'preparo').receitaPor['usr-pedro'];
  ok(e.ok && r.colheres === 3 && r.gPorColher === 9.5 && r.filtros === 0 && r.acucar === 200 && r.agua === 0, 'todos os campos de uma vez, com zero em filtro e água e açúcar de 200 g', r);
  ok(T.db().t('receita_cafe').filter((x) => x.usuario_id === 'usr-pedro').length === 1, 'uma única versão nova (não uma por clique)');
  const c = T.ctx.consumoPreparo_(T.db(), T.ctx.AGORA_TESTE().dataHora, 1, {}, 'usr-pedro').consumo;
  ok(c['mat-cafe'] === 28.5 && c['mat-acucar'] === 200 && c['mat-agua'] === undefined && c['mat-filtro'] === undefined, 'consumo: 28,5 g de café, 200 g de açúcar, sem água e sem filtro', c);
  ok(/inválido/.test(T.ch(T.pedro, 'receita.salvar', { usuario_id: 'usr-pedro', colheres_por_litro: 0 }).erro) && /inválido/.test(T.ch(T.pedro, 'receita.salvar', { usuario_id: 'usr-pedro', g_por_colher: 0 }).erro), 'sem café na receita não pode');
  ok(T.ch(T.pedro, 'config.salvar', { itens: { 'sorteio.meta_numeros': 25, 'sorteio.preco_numero_centavos': 150 } }).ok, 'regras do sorteio salvas juntas');
  const s = ver(T, T.pedro, 'clientes', 'sorteio', '');
  ok(s.meta === 25 && s.preco === 150, 'meta 25 e preço R$ 1,50', [s.meta, s.preco]);
  const antes = T.db().t('config').length;
  ok(/limite/.test(T.ch(T.pedro, 'config.salvar', { itens: { 'sorteio.meta_numeros': 30, 'sorteio.preco_numero_centavos': 1 } }).erro) && T.db().t('config').length === antes && ver(T, T.pedro, 'clientes', 'sorteio', '').meta === 25, 'se um valor for inválido, nenhum é salvo');
}

grupo('todas as telas respondem');
{
  const T = iniciar({ exemplos: true });
  const telas = [['venda'], ['preparo'], ['compra'], ['fechamento'], ['estoque', 'saldos'], ['estoque', 'movs'], ['estoque', 'mexer'], ['paineis', 'geral'], ['paineis', 'vendas'], ['paineis', 'estoque'], ['paineis', 'compras'], ['paineis', 'producao'], ['paineis', 'fin'], ['paineis', 'sorteio'], ['cadastros', 'materiais'], ['cadastros', 'produtos'], ['cadastros', 'receitas'], ['cadastros', 'listas'], ['cadastros', 'promos'], ['financeiro', 'resultado'], ['financeiro', 'lanc'], ['clientes', 'lista'], ['clientes', 'sorteio'], ['historico'], ['sistema'], ['mais']];
  telas.forEach((t) => { const r = ver(T, T.pedro, t[0], t[1]); ok(r.ok, 'tela ' + t.join('/'), r.erro); });
  const zero = iniciar();
  telas.forEach((t) => { const r = ver(zero, zero.pedro, t[0], t[1]); ok(r.ok, 'tela vazia ' + t.join('/'), r.erro); });
  const pg = ver(T, T.pedro, 'paineis', 'geral');
  ok(pg.tiles.length === 4 && pg.b1.length === 6 && pg.b2.length === 2, 'painel geral com tiles e barras');
  ok(ver(T, T.pedro, 'sistema').tabelas.length === 31, 'tela Sistema lista as 31 tabelas');
  const h = ver(T, T.pedro, 'historico').linhas;
  ok(h.length > 15 && h[0].quando >= h[h.length - 1].quando, 'histórico ordenado do mais novo ao mais antigo');
  const prep = ver(T, T.pedro, 'preparo');
  ok(prep.saldos['usr-pedro']['mat-cafe'] === 958 && prep.copoPorVariante['var-n100'] === 'mat-copo200' && prep.chaves.cafe === 'mat-cafe', 'tela de Preparo traz o que o cálculo precisa');
}

console.log('\n' + (total - falhas.length) + '/' + total + ' verificações OK');
if (falhas.length) { console.log('\nFALHARAM:'); falhas.forEach((f) => console.log(' - ' + f)); process.exit(1); }
