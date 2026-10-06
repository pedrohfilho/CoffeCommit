/**
 * Core.gs — regras do negócio.
 *
 * Não usa SpreadsheetApp. Recebe um "db" (ver Planilha.gs) e um "ctx":
 *   ctx = { usuarioId, agora: { dataHora (ISO UTC), diaLocal (AAAA-MM-DD, fuso America/Bahia) }, semFechamento? }
 *
 * Regras de ouro:
 *  - registros de movimento nunca são editados; erro se corrige por estorno;
 *  - saldos e totais são calculados dos livros (movimento_estoque, movimento_cafe), nunca digitados;
 *  - preço e custo são gravados no momento do registro;
 *  - a venda não mexe no estoque de material; o preparo mexe no estoque de quem preparou.
 */

/* ================= utilidades ================= */
function ErroNegocio(msg) { this.name = 'ErroNegocio'; this.message = msg; this.erroNegocio = true; }
ErroNegocio.prototype = Object.create(Error.prototype);
function falha_(msg) { throw new ErroNegocio(msg); }
function r3_(n) { return Math.round(n * 1000) / 1000; }
function soma_(arr, f) { var t = 0; for (var i = 0; i < arr.length; i++) t += f ? f(arr[i]) : arr[i]; return t; }
function ultimo_(arr) { return arr.length ? arr[arr.length - 1] : null; }
function milhar_(s) { return String(s).replace(/\B(?=(\d{3})+(?!\d))/g, '.'); }
function fmtN_(n) {
  n = Math.round(n * 10) / 10;
  var neg = n < 0, p = Math.abs(n).toString().split('.');
  return (neg ? '\u2212' : '') + milhar_(p[0]) + (p[1] ? ',' + p[1] : '');
}
function fmtR_(c) {
  var neg = c < 0, v = Math.abs(Math.round(c)), cc = String(v % 100);
  if (cc.length < 2) cc = '0' + cc;
  return (neg ? '\u2212' : '') + 'R$\u00A0' + milhar_(Math.floor(v / 100)) + ',' + cc;
}
function nb_(s) {
  return String(s)
    .replace(/R\$ (?=\d)/g, 'R$\u00A0')
    .replace(/(\d) (ml|g|un|L|vendas|venda|copos|copo|números|número|%)(?![A-Za-zÀ-ú])/g, '$1\u00A0$2')
    .replace(/N\u00BA (\d)/g, 'N\u00BA\u00A0$1')
    .replace(/c\u00F3digo (\d)/g, 'c\u00F3digo\u00A0$1')
    .replace(/(\d) de (\d)/g, '$1\u00A0de\u00A0$2');
}
function pad4_(n) { return String(n).padStart(4, '0'); }
function mapa_(db, nome) {
  if (!db._mp) db._mp = {};
  if (!db._mp[nome]) { var m = {}; db.t(nome).forEach(function (r) { m[r.id] = r; }); db._mp[nome] = m; }
  return db._mp[nome];
}
function vigenteEm_(r, ts) { return r.vigente_de <= ts && (!r.vigente_ate || ts < r.vigente_ate); }
function idValido_(id) { if (!id || typeof id !== 'string' || !/^[A-Za-z0-9_-]{8,64}$/.test(id)) falha_('Identificador inválido. Tente de novo.'); }
function novoId_() { return Utilities.getUuid(); }

/* constrói uma linha de tabela já com auditoria */
function nova_(ctx, obj) {
  var o = Object.assign({}, obj);
  if (!o.id) o.id = novoId_();
  o.criado_em = ctx.agora.dataHora; o.criado_por = ctx.usuarioId;
  o.atualizado_em = null; o.atualizado_por = null; o.versao = 1;
  return o;
}
function carimbo_(ctx, db, row) { return { atualizado_em: ctx.agora.dataHora, atualizado_por: ctx.usuarioId, versao: (row.versao || 1) + 1 }; }

/* ================= cadastros vigentes ================= */
/* material que não entra no controle de estoque (ex.: água): nunca trava nada e some das telas de estoque */
function controla_(m) { return !!m && m.controla_estoque !== false; }
function usuarioAtivo_(db, id) {
  var u = mapa_(db, 'usuario')[id];
  if (!u || !u.ativo) falha_('Pessoa inválida.');
  return u;
}
function cfgValor_(db, chave, padrao, ts) {
  var l = db.t('config').filter(function (c) { return c.chave === chave && vigenteEm_(c, ts); });
  return l.length ? ultimo_(l).valor : padrao;
}
function materiaisChave_(db, ts) {
  var o = {};
  ['cafe', 'filtro', 'agua', 'leite', 'canela', 'acucar'].forEach(function (k) { o[k] = cfgValor_(db, 'material.' + k, null, ts); });
  return o;
}
function precoVigente_(db, varId, ts) {
  var l = db.t('preco_venda').filter(function (p) { return p.variante_id === varId && vigenteEm_(p, ts); });
  if (!l.length) falha_('Produto sem preço cadastrado.');
  return ultimo_(l).preco_centavos;
}
function composicaoVigente_(db, varId, ts) {
  var l = db.t('composicao_copo').filter(function (p) { return p.variante_id === varId && vigenteEm_(p, ts); });
  if (!l.length) falha_('Produto sem composição cadastrada.');
  return ultimo_(l);
}
/* receita de quem prepara: a própria, se tiver; senão a padrão da casa */
var BASES_ = ['CAFE', 'CAFE_LEITE'];
function baseValida_(b) { b = b || 'CAFE'; if (BASES_.indexOf(b) < 0) falha_('Tipo de café inválido.'); return b; }
function receitaVigente_(db, ts, usuarioId, base) {
  base = base || 'CAFE';
  var vig = db.t('receita_cafe').filter(function (r) { return vigenteEm_(r, ts) && (r.base || 'CAFE') === base; });
  var propria = usuarioId ? vig.filter(function (r) { return r.usuario_id === usuarioId; }) : [];
  if (propria.length) return ultimo_(propria);
  var padrao = vig.filter(function (r) { return !r.usuario_id; });
  if (!padrao.length) falha_('Receita do café' + (base === 'CAFE_LEITE' ? ' com leite' : '') + ' não cadastrada.');
  return ultimo_(padrao);
}

/* ================= livros e saldos ================= */
var ORIGENS_ESTOQUE_ = ['compra', 'preparo', 'ajuste_estoque'];
var ORIGENS_CAFE_ = ['preparo', 'venda', 'ajuste_cafe', 'consumo_proprio'];
/* ids dos registros "de verdade" (ATIVO ou ESTORNADO) de cada tabela de origem; só lê as tabelas pedidas */
function origensValidas_(db, tabelas) {
  if (!db._ov) db._ov = {};
  var ov = {};
  tabelas.forEach(function (t) {
    if (!db._ov[t]) { var o = {}; db.t(t).forEach(function (r) { if (r.status === 'ATIVO' || r.status === 'ESTORNADO') o[r.id] = true; }); db._ov[t] = o; }
    ov[t] = db._ov[t];
  });
  return ov;
}
function movValido_(ov, m) { return !!(ov[m.origem_tabela] && ov[m.origem_tabela][m.origem_id]); }

function saldosEstoque_(db) {
  var ov = origensValidas_(db, ORIGENS_ESTOQUE_), s = {};
  db.t('movimento_estoque').forEach(function (m) {
    if (!movValido_(ov, m)) return;
    var u = s[m.usuario_id] || (s[m.usuario_id] = {});
    u[m.material_id] = r3_((u[m.material_id] || 0) + m.qtd);
  });
  return s;
}
function qtdEstoque_(sal, u, mat) { return (sal[u] && sal[u][mat]) || 0; }

function cafeDoDia_(db, dia) {
  var ov = origensValidas_(db, ORIGENS_CAFE_), aj = mapa_(db, 'ajuste_cafe');
  var r = { produzido: 0, vendido: 0, perdido: 0, consumido: 0, saldo: 0 };
  db.t('movimento_cafe').forEach(function (m) {
    if (m.dia_local !== dia || !movValido_(ov, m)) return;
    r.saldo = r3_(r.saldo + m.ml_cafe);
    if (m.origem_tabela === 'preparo') r.produzido = r3_(r.produzido + m.ml_cafe);
    else if (m.origem_tabela === 'venda') r.vendido = r3_(r.vendido - m.ml_cafe);
    else if (m.origem_tabela === 'consumo_proprio') r.consumido = r3_(r.consumido - m.ml_cafe);
    else if (m.origem_tabela === 'ajuste_cafe') {
      var a = aj[m.origem_id];
      if (a && a.tipo === 'ACERTO') r.produzido = r3_(r.produzido + m.ml_cafe);
      else r.perdido = r3_(r.perdido - m.ml_cafe);
    }
  });
  return r;
}
function diaFechado_(db, dia) {
  var l = db.t('fechamento_dia').filter(function (f) { return f.dia_local === dia; });
  return l.length ? ultimo_(l).status === 'FECHADO' : false;
}
function exigirDiaAberto_(db, ctx) {
  if (!ctx.semFechamento && diaFechado_(db, ctx.agora.diaLocal)) falha_('O dia está fechado. Reabra em Fechamento do dia para registrar.');
}

/* custo por unidade base: atual = última compra; padrão = preço padrão do pacote */
function custosUnitarios_(db) {
  var res = {}, comp = mapa_(db, 'compra');
  db.t('material').forEach(function (m) { var p = m.preco_padrao_centavos / m.pacote_qtd; res[m.id] = { atual: p, padrao: p }; });
  var itens = db.t('compra_item').filter(function (i) { var c = comp[i.compra_id]; return c && c.status === 'ATIVO'; });
  itens.sort(function (a, b) { var x = comp[a.compra_id].data_hora, y = comp[b.compra_id].data_hora; return x < y ? -1 : x > y ? 1 : 0; });
  itens.forEach(function (i) { if (res[i.material_id] && i.qtd_base_qtd > 0) res[i.material_id].atual = i.valor_centavos / i.qtd_base_qtd; });
  return res;
}

/* sorteio: só um fica ABERTO; cada número guarda o id do sorteio em que foi vendido.
   O progresso conta os NÚMEROS vendidos no sorteio aberto. Novo sorteio encerra o aberto e abre outro, do zero. */
function estadoSorteio_(db, ts) {
  var meta = Math.max(1, Number(cfgValor_(db, 'sorteio.meta_numeros', '40', ts)));
  var preco = Number(cfgValor_(db, 'sorteio.preco_numero_centavos', '100', ts));
  var vendas = mapa_(db, 'venda');
  var rodadas = db.t('sorteio').filter(function (s) { return s.status !== 'CANCELADO'; }).sort(function (a, b) { return a.rodada - b.rodada; });
  var abertos = rodadas.filter(function (s) { return s.status === 'ABERTO'; }), aberto = ultimo_(abertos);
  var validos = db.t('numero_sorteio').filter(function (n) { var v = vendas[n.venda_id]; return n.status === 'ATIVO' && v && v.status === 'ATIVO'; });
  var ativos = aberto ? validos.filter(function (n) { return n.sorteio_id === aberto.id; }) : [];
  var maxRodada = 0; db.t('sorteio').forEach(function (s) { if (s.rodada > maxRodada) maxRodada = s.rodada; });
  return { meta: meta, preco: preco, aberto: aberto, rodadaAtual: aberto ? aberto.rodada : maxRodada + 1, ativos: ativos, nAtivos: ativos.length, liberado: ativos.length >= meta, validos: validos, rodadas: rodadas, encerrados: rodadas.filter(function (s) { return s.status === 'ENCERRADO'; }) };
}
function sorteioAberto_(db, ctx, criar) {
  var ab = ultimo_(db.t('sorteio').filter(function (s) { return s.status === 'ABERTO'; }));
  if (ab || !criar) return ab;
  var meta = Math.max(1, Number(cfgValor_(db, 'sorteio.meta_numeros', '40', ctx.agora.dataHora)));
  var novo = nova_(ctx, { rodada: db.proximoNumero('sorteio'), status: 'ABERTO', meta_numeros: meta, qtd_numeros: 0, aberto_em: ctx.agora.dataHora, encerrado_em: null, encerrado_por: null });
  db.anexar('sorteio', [novo]);
  return novo;
}

/* consumo de material de um preparo, pela receita de quem prepara e pelo plano de copos */
function consumoPreparo_(db, ts, litros, plano, usuarioId, base) {
  var rc = receitaVigente_(db, ts, usuarioId, base), mp = materiaisChave_(db, ts), c = {}, cafePlano = 0, copos = 0;
  function add(id, q) { if (!id || !(q > 0)) return; c[id] = r3_((c[id] || 0) + q); }
  add(mp.cafe, litros * rc.colheres_por_litro * rc.g_por_colher);
  add(mp.filtro, Math.ceil(litros * rc.filtros_por_litro - 1e-9));
  add(mp.acucar, litros * rc.acucar_g_por_litro);
  add(mp.agua, litros * rc.agua_ml_por_litro);
  add(mp.leite, litros * (rc.leite_ml_por_litro || 0));          // o leite entra no preparo (café com leite), nunca no copo
  var vars = mapa_(db, 'produto_variante');
  Object.keys(plano).forEach(function (vid) {
    var n = plano[vid]; if (!(n > 0)) return;
    var v = vars[vid], comp = composicaoVigente_(db, vid, ts);
    cafePlano += n * v.tamanho_ml; copos += n;                       // o copo só tem o produto: café (o café com leite já vem misturado)
    add(mp.canela, n * comp.canela_g); add(comp.copo_material_id, n);
  });
  return { consumo: c, cafePlanoMl: r3_(cafePlano), copos: copos, receita: rc };
}

/* ================= COMANDOS ================= */

function tokensUsados_(db) { var s = {}; db.t('numero_sorteio').forEach(function (n) { s[n.token] = true; }); return s; }
function maxNumeroSorteio_(db) { var m = 0; db.t('numero_sorteio').forEach(function (n) { if (n.numero > m) m = n.numero; }); return m; }
function gerarToken_(usados) {
  for (var i = 0; i < 400; i++) {
    var t = String(Math.floor(Math.random() * 10000)).padStart(4, '0');
    if (!usados[t]) { usados[t] = true; return t; }
  }
  var k = 10000; while (usados[String(k)]) k++; usados[String(k)] = true; return String(k);
}

function ticketDaVenda_(db, vendaId) {
  var v = mapa_(db, 'venda')[vendaId];
  var nums = db.t('numero_sorteio').filter(function (n) { return n.venda_id === vendaId; }).sort(function (a, b) { return a.numero - b.numero; });
  if (!v || !nums.length) return null;
  var c = mapa_(db, 'cliente')[v.cliente_id];
  return { cliente: c ? c.nome : '', numeros: nums.map(function (n) { return { numero: n.numero, token: n.token }; }) };
}

function cmdVenda_(db, ctx, p) {
  idValido_(p.id);
  var ja = db.achar('venda', p.id);
  if (ja) return { msg: 'Venda já registrada.', repetido: true, ticket: ticketDaVenda_(db, ja.id) };
  exigirDiaAberto_(db, ctx);
  var ts = ctx.agora.dataHora, dia = ctx.agora.diaLocal;
  var forma = mapa_(db, 'forma_pagamento')[p.forma_pagamento_id];
  if (!forma || !forma.ativo) falha_('Escolha a forma de pagamento.');
  var vars = mapa_(db, 'produto_variante'), itens = [], copos = 0, ml = 0, total = 0;
  Object.keys(p.itens || {}).forEach(function (vid) {
    var q = parseInt(p.itens[vid], 10);
    if (!(q > 0)) return;
    if (q > 99) falha_('Quantidade grande demais.');
    var v = vars[vid];
    if (!v || !v.ativo) falha_('Produto indisponível.');
    var preco = precoVigente_(db, vid, ts), cafe = v.tamanho_ml;
    itens.push({ variante_id: vid, qtd: q, preco_unit_centavos: preco, ml_cafe_unit: cafe, tamanho_ml: v.tamanho_ml });
    copos += q; ml += q * cafe; total += q * preco;
  });
  var nSort = 0, cliente = null;
  if (p.sorteio) {
    nSort = parseInt(p.sorteio.n, 10);
    if (!(nSort >= 1 && nSort <= 99)) falha_('Quantidade de números inválida (de 1 a 99).');
    cliente = mapa_(db, 'cliente')[p.sorteio.cliente_id];
    if (!cliente || !cliente.ativo) falha_('Cliente inválido ou inativo.');
  }
  if (!itens.length && !nSort) falha_('Nada no pedido.');
  // desconto manual: não é regra, é um valor que a pessoa informa na hora (ex.: 1º café grátis), com o nome da promoção do dia se quiser
  var desconto = Math.round(Number(p.desconto_centavos || 0)), promo = null;
  if (!(desconto >= 0)) falha_('Desconto inválido.');
  if (desconto > total) falha_('O desconto não pode passar do valor do café (' + fmtR_(total) + ').');
  if (desconto > 0) {
    if (p.promocao_id) { promo = mapa_(db, 'promocao')[p.promocao_id]; if (!promo || !promo.ativo) falha_('Promoção inválida ou desativada.'); }
  }
  var precoNum = nSort ? estadoSorteio_(db, ts).preco : 0, totalSort = nSort * precoNum;   // venda sem números nem toca no sorteio
  var saldoAntes = cafeDoDia_(db, dia).saldo;
  var vendaId = p.id, numero = db.proximoNumero('venda');
  var venda = nova_(ctx, { id: vendaId, numero: numero, usuario_id: ctx.usuarioId, data_hora: ts, dia_local: dia, forma_pagamento_id: forma.id, cliente_id: cliente ? cliente.id : null, copos: copos, ml_cafe: r3_(ml), total_cafe_centavos: total - desconto, total_sorteio_centavos: totalSort, status: 'ATIVO', desconto_centavos: desconto, promocao_id: promo ? promo.id : null });
  var filhos = [];
  filhos.push({ tabela: 'venda_item', linhas: itens.map(function (i) { return Object.assign({ id: novoId_(), venda_id: vendaId }, i); }) });
  var nums = [];
  if (nSort) {
    var ab = sorteioAberto_(db, ctx, true), usados = tokensUsados_(db), base = maxNumeroSorteio_(db), forcados = (ctx.semFechamento && p.sorteio.tokens) || null;
    for (var k = 0; k < nSort; k++) {
      var tok = forcados && forcados[k] ? forcados[k] : gerarToken_(usados);
      usados[tok] = true;
      nums.push({ id: novoId_(), numero: base + 1 + k, token: tok, cliente_id: cliente.id, venda_id: vendaId, sorteio_id: ab.id, valor_centavos: precoNum, criado_em: ts, status: 'ATIVO' });
    }
    filhos.push({ tabela: 'numero_sorteio', linhas: nums });
  }
  if (ml > 0) filhos.push({ tabela: 'movimento_cafe', linhas: [{ id: novoId_(), tipo: 'VENDA', ml_cafe: -r3_(ml), data_hora: ts, dia_local: dia, origem_tabela: 'venda', origem_id: vendaId, estorno_de_id: null }] });
  db.gravar({ mae: { tabela: 'venda', obj: venda }, filhos: filhos });
  var msg = 'Venda registrada \u00B7 ' + fmtR_(total - desconto + totalSort) + (desconto > 0 ? ' (desconto de ' + fmtR_(desconto) + (promo ? ' \u00B7 ' + promo.nome : '') + ')' : '');
  var passou = ml > saldoAntes + 1e-9;
  if (passou) msg = 'Venda registrada, mas passou do café preparado. Registre o preparo que faltou ou ajuste no Fechamento.';
  return { msg: msg, passou: passou, ticket: nSort ? ticketDaVenda_(db, vendaId) : null, numero: numero };
}

/* ---------- preparo: rápido (só litros e quem) e materiais depois ---------- */
function pendente_(p) { return p.materiais_status === 'PENDENTE'; }
function contarPendentes_(db) { return db.t('preparo').filter(function (p) { return p.status === 'ATIVO' && pendente_(p); }).length; }
/* café que o plano de copos usa; não depende da receita */
function planoCafeMl_(db, ts, plano) {
  var vars = mapa_(db, 'produto_variante'), ml = 0;
  Object.keys(plano).forEach(function (vid) { var n = plano[vid]; if (!(n > 0)) return; ml += n * vars[vid].tamanho_ml; });
  return r3_(ml);
}
function lerPlano_(db, p) {
  var plano = {}, vars = mapa_(db, 'produto_variante');
  Object.keys(p.plano || {}).forEach(function (vid) {
    var n = parseInt(p.plano[vid], 10);
    if (!(n > 0)) return;
    if (n > 99) falha_('Quantidade grande demais no plano.');
    if (!vars[vid] || !vars[vid].ativo) falha_('Produto indisponível no plano.');
    plano[vid] = n;
  });
  return plano;
}
/* "padrão" = o que a receita manda; "real" = o que foi usado (a pessoa pode ajustar) */
function aplicarAjustes_(db, calc, ajustes) {
  var mats = mapa_(db, 'material'), real = {}, ajustados = 0;
  Object.keys(calc.consumo).forEach(function (mid) { real[mid] = calc.consumo[mid]; });
  Object.keys(ajustes || {}).forEach(function (mid) {
    var m = mats[mid]; if (!m || !m.ativo) falha_('Material inválido nos ajustes do preparo.');
    var q = Number(ajustes[mid]); if (!(q >= 0 && q <= 100000)) falha_('Quantidade inválida em ' + m.nome + '.');
    q = r3_(q);
    if (Math.abs(q - (calc.consumo[mid] || 0)) > 1e-9) ajustados++;
    real[mid] = q;
  });
  return { real: real, ajustados: ajustados };
}
/* monta as linhas de consumo, o livro de estoque (só de material que controla) e os avisos de falta */
function linhasDeConsumo_(db, pid, quem, calc, real, ts, dia) {
  var mats = mapa_(db, 'material'), cu = custosUnitarios_(db), sal = saldosEstoque_(db), cons = [], led = [], negativos = [], ids = {};
  Object.keys(calc.consumo).forEach(function (m) { ids[m] = true; }); Object.keys(real).forEach(function (m) { ids[m] = true; });
  Object.keys(ids).forEach(function (mid) {
    var padrao = calc.consumo[mid] || 0, q = real[mid] || 0;
    if (!(padrao > 0 || q > 0)) return;
    cons.push({ id: novoId_(), preparo_id: pid, material_id: mid, qtd_padrao_qtd: padrao, qtd_real_qtd: q, custo_atual_centavos: Math.round(q * cu[mid].atual), custo_padrao_centavos: Math.round(q * cu[mid].padrao) });
    if (q > 0 && controla_(mats[mid])) {
      led.push({ id: novoId_(), usuario_id: quem.id, material_id: mid, tipo: 'PREPARO', qtd: -q, data_hora: ts, dia_local: dia, origem_tabela: 'preparo', origem_id: pid, estorno_de_id: null });
      var tem = qtdEstoque_(sal, quem.id, mid);
      if (tem + 1e-9 < q) negativos.push(mats[mid].nome + ' (faltam ' + fmtN_(q - Math.max(0, tem)) + ' ' + mats[mid].unidade + ')');
    }
  });
  return { cons: cons, led: led, negativos: negativos };
}
function avisoFalta_(negativos, nome) {
  return negativos.length ? ' Atenção: faltou estoque de ' + negativos.join(', ') + ' para ' + nome + '; o saldo ficou negativo. Registre a compra ou use "Contei o estoque".' : '';
}

/* modo "rapido": só litros e quem; o café já entra para vender e os materiais ficam PENDENTES.
   modo "completo" (padrão): como antes, com receita e ajustes. A falta de estoque nunca trava. */
function cmdPreparo_(db, ctx, p) {
  idValido_(p.id);
  if (db.achar('preparo', p.id)) return { msg: 'Preparo já registrado.', repetido: true };
  exigirDiaAberto_(db, ctx);
  var ts = ctx.agora.dataHora, dia = ctx.agora.diaLocal, rapido = p.modo === 'rapido';
  var litros = Number(p.litros);
  if (!(litros >= 0.5 && litros <= 10) || Math.abs(litros * 2 - Math.round(litros * 2)) > 1e-9) falha_('Litros inválidos (de 0,5 em 0,5, até 10).');
  var quem = usuarioAtivo_(db, p.quem), plano = lerPlano_(db, p);
  if (planoCafeMl_(db, ts, plano) > litros * 1000 + 1e-9) falha_('O plano de copos passa do volume preparado. Aumente os litros ou tire copos.');
  var base = baseValida_(p.base), rc = receitaVigente_(db, ts, quem.id, base), numero = db.proximoNumero('preparo'), pid = p.id;
  var prep = nova_(ctx, { id: pid, numero: numero, usuario_id: quem.id, registrado_por: ctx.usuarioId, data_hora: ts, dia_local: dia, litros: litros, ml_cafe: litros * 1000, receita_id: rc.id, status: 'ATIVO', materiais_status: rapido ? 'PENDENTE' : 'LANCADO', base: base });
  var pl = Object.keys(plano).map(function (vid) { return { id: novoId_(), preparo_id: pid, variante_id: vid, copos: plano[vid] }; });
  var cafe = [{ id: novoId_(), tipo: 'PREPARO', ml_cafe: litros * 1000, data_hora: ts, dia_local: dia, origem_tabela: 'preparo', origem_id: pid, estorno_de_id: null }];
  var filhos = [], aviso = '', ajustados = 0, negativos = [];
  if (!rapido) {
    var calc = consumoPreparo_(db, ts, litros, plano, quem.id, base), aj = aplicarAjustes_(db, calc, p.ajustes), lc = linhasDeConsumo_(db, pid, quem, calc, aj.real, ts, dia);
    ajustados = aj.ajustados; negativos = lc.negativos; aviso = avisoFalta_(negativos, quem.nome);
    filhos.push({ tabela: 'preparo_consumo', linhas: lc.cons }, { tabela: 'preparo_plano', linhas: pl }, { tabela: 'movimento_estoque', linhas: lc.led }, { tabela: 'movimento_cafe', linhas: cafe });
  } else filhos.push({ tabela: 'preparo_plano', linhas: pl }, { tabela: 'movimento_cafe', linhas: cafe });
  db.gravar({ mae: { tabela: 'preparo', obj: prep }, filhos: filhos });
  var msg = 'Preparo registrado \u00B7 ' + fmtN_(litros * 1000) + ' ml de ' + (base === 'CAFE_LEITE' ? 'café com leite' : 'café') + ' para vender' + (ajustados ? ' (com ' + ajustados + (ajustados === 1 ? ' ajuste' : ' ajustes') + ' nos materiais)' : '') + '.';
  return { msg: msg + (rapido ? ' Os materiais ficam para completar depois, já com a receita preenchida.' : '') + aviso, atencao: negativos.length > 0, pendente: rapido, numero: numero };
}

/* completa os materiais de preparos que ficaram PENDENTES (um com ajustes, ou vários só pela receita) */
function cmdPreparoMateriais_(db, ctx, p) {
  var ids = p.ids || (p.preparo_id ? [p.preparo_id] : []);
  if (!ids.length) falha_('Escolha o preparo.');
  var temAjuste = (p.ajustes && Object.keys(p.ajustes).length) || (p.plano && Object.keys(p.plano).length);
  if (ids.length > 1 && temAjuste) falha_('Ajustes valem para um preparo por vez.');
  var alvo = ids.map(function (id) {
    var pr = db.achar('preparo', id);
    if (!pr) falha_('Preparo não encontrado.');
    if (pr.status !== 'ATIVO') falha_('Esse preparo foi desfeito.');
    return pr;
  }), pend = alvo.filter(pendente_);
  if (!pend.length) return { msg: 'Os materiais desse preparo já estão lançados.', repetido: true };
  var ts = ctx.agora.dataHora, dia = ctx.agora.diaLocal, negativos = [], us = mapa_(db, 'usuario'), feitos = 0;
  pend.forEach(function (pr) {
    var quem = us[pr.usuario_id], plano = {}, novasPl = [];
    db.t('preparo_plano').filter(function (x) { return x.preparo_id === pr.id; }).forEach(function (x) { plano[x.variante_id] = (plano[x.variante_id] || 0) + x.copos; });
    if (!Object.keys(plano).length && pend.length === 1 && p.plano) {
      plano = lerPlano_(db, p);
      novasPl = Object.keys(plano).map(function (vid) { return { id: novoId_(), preparo_id: pr.id, variante_id: vid, copos: plano[vid] }; });
    }
    if (novasPl.length && planoCafeMl_(db, ts, plano) > pr.litros * 1000 + 1e-9) falha_('O plano passa do volume do preparo nº ' + pr.numero + '.');   // o plano já registrado foi conferido com o tamanho da época
    // se uma tentativa anterior caiu no meio e os materiais já estão gravados, só falta virar LANCADO
    var jaTem = db.t('preparo_consumo').some(function (c) { return c.preparo_id === pr.id; });
    if (!jaTem) {
      var calc = consumoPreparo_(db, pr.data_hora, pr.litros, plano, pr.usuario_id, pr.base || 'CAFE'), aj = aplicarAjustes_(db, calc, pend.length === 1 ? p.ajustes : null), lc = linhasDeConsumo_(db, pr.id, quem, calc, aj.real, ts, dia);
      negativos = negativos.concat(lc.negativos.map(function (x) { return x + ' no preparo nº ' + pr.numero; }));
      db.anexar('preparo_consumo', lc.cons);
      if (novasPl.length) db.anexar('preparo_plano', novasPl);
      if (lc.led.length) db.anexar('movimento_estoque', lc.led);
    }
    db.atualizar('preparo', pr.id, Object.assign({ materiais_status: 'LANCADO' }, carimbo_(ctx, db, pr)));
    feitos++;
  });
  return { msg: 'Materiais lançados em ' + feitos + (feitos === 1 ? ' preparo' : ' preparos') + '.' + (negativos.length ? ' Atenção: faltou estoque de ' + negativos.join(', ') + '; o saldo ficou negativo. Registre a compra ou use "Contei o estoque".' : ''), atencao: negativos.length > 0, lancados: feitos };
}

function cmdCompra_(db, ctx, p) {
  idValido_(p.id);
  if (db.achar('compra', p.id)) return { msg: 'Compra já registrada.', repetido: true };
  var ts = ctx.agora.dataHora, dia = ctx.agora.diaLocal;
  var mat = mapa_(db, 'material')[p.material_id];
  if (!mat || !mat.ativo) falha_('Material inválido.');
  if (!controla_(mat)) falha_(mat.nome + ' não controla estoque, então não tem compra a registrar. Para controlar, ligue "Controla estoque" em Cadastros › Materiais.');
  var forn = mapa_(db, 'fornecedor')[p.fornecedor_id];
  if (!forn || !forn.ativo) falha_('Escolha onde comprou.');
  var emb = parseInt(p.embalagens, 10), valor = Math.round(Number(p.valor_centavos));
  if (!(emb >= 1 && emb <= 50)) falha_('Embalagens inválidas (de 1 a 50).');
  if (!(valor >= 0)) falha_('Valor inválido.');
  var qtd = r3_(emb * mat.pacote_qtd), dono = usuarioAtivo_(db, ctx.usuarioId), cid = p.id, observacao = null, velha = null;
  if (p.corrige_id) {
    // correção = nova compra + desfazer a antiga, conferindo o estoque pelo saldo líquido
    velha = db.achar('compra', p.corrige_id);
    if (!velha || velha.status !== 'ATIVO') falha_('A compra a corrigir não está mais ativa.');
    var iv = db.t('compra_item').filter(function (i) { return i.compra_id === velha.id; });
    var sal = saldosEstoque_(db), antes = {}, tocados = [];
    iv.forEach(function (i) { tocados.push([velha.usuario_id, i.material_id]); });
    tocados.push([dono.id, mat.id]);
    tocados.forEach(function (t) { antes[t.join('/')] = qtdEstoque_(sal, t[0], t[1]); });
    iv.forEach(function (i) { var u = sal[velha.usuario_id] = sal[velha.usuario_id] || {}; u[i.material_id] = r3_((u[i.material_id] || 0) - i.qtd_base_qtd); });
    var d = sal[dono.id] = sal[dono.id] || {}; d[mat.id] = r3_((d[mat.id] || 0) + qtd);
    tocados.forEach(function (t) { var depois = qtdEstoque_(sal, t[0], t[1]); if (depois < -1e-9 && depois < antes[t.join('/')] - 1e-9) falha_('Não dá para corrigir: o estoque de ' + (mapa_(db, 'material')[t[1]] || {}).nome + ' ficaria negativo.'); });
    observacao = 'Corrige a compra #' + velha.numero;
  }
  var numero = db.proximoNumero('compra');
  var compra = nova_(ctx, { id: cid, numero: numero, usuario_id: dono.id, fornecedor_id: forn.id, data_hora: ts, dia_local: dia, valor_total_centavos: valor, observacao: observacao, status: 'ATIVO' });
  db.gravar({
    mae: { tabela: 'compra', obj: compra },
    filhos: [
      { tabela: 'compra_item', linhas: [{ id: novoId_(), compra_id: cid, material_id: mat.id, embalagens: emb, qtd_base_qtd: qtd, valor_centavos: valor }] },
      { tabela: 'movimento_estoque', linhas: [{ id: novoId_(), usuario_id: dono.id, material_id: mat.id, tipo: 'COMPRA', qtd: qtd, data_hora: ts, dia_local: dia, origem_tabela: 'compra', origem_id: cid, estorno_de_id: null }] }
    ]
  });
  if (velha) { ctx.semChecagemEstoque = true; try { cmdEstornar_(db, ctx, { tabela: 'compra', id: velha.id, motivo: 'Corrigida pela compra #' + numero }); } finally { ctx.semChecagemEstoque = false; } }
  return { msg: (velha ? 'Compra corrigida \u00B7 ' : 'Compra registrada \u00B7 ') + mat.nome + ' ' + fmtN_(qtd) + ' ' + mat.unidade + ' no estoque de ' + dono.nome, numero: numero };
}

/* café tomado por nós: sai do café pronto na hora, sem cobrança e sem contar como venda (nem para o sorteio) */
function cmdConsumo_(db, ctx, p) {
  idValido_(p.id);
  if (db.achar('consumo_proprio', p.id)) return { msg: 'Consumo já registrado.', repetido: true };
  exigirDiaAberto_(db, ctx);
  var ts = ctx.agora.dataHora, dia = ctx.agora.diaLocal, quem = usuarioAtivo_(db, p.consumidor_id || ctx.usuarioId), vars = mapa_(db, 'produto_variante'), itens = [], copos = 0, ml = 0;
  Object.keys(p.itens || {}).forEach(function (vid) {
    var q = parseInt(p.itens[vid], 10);
    if (!(q > 0)) return;
    if (q > 99) falha_('Quantidade grande demais.');
    var v = vars[vid];
    if (!v || !v.ativo) falha_('Produto indisponível.');
    var cafe = v.tamanho_ml;
    itens.push({ variante_id: vid, qtd: q, ml_cafe_unit: cafe, tamanho_ml: v.tamanho_ml });
    copos += q; ml += q * cafe;
  });
  if (!itens.length) falha_('Escolha o que foi tomado.');
  var saldoAntes = cafeDoDia_(db, dia).saldo, numero = db.proximoNumero('consumo_proprio'), cid = p.id;
  var cab = nova_(ctx, { id: cid, numero: numero, usuario_id: ctx.usuarioId, consumidor_id: quem.id, data_hora: ts, dia_local: dia, copos: copos, ml_cafe: r3_(ml), observacao: null, status: 'ATIVO' });
  db.gravar({ mae: { tabela: 'consumo_proprio', obj: cab }, filhos: [
    { tabela: 'consumo_proprio_item', linhas: itens.map(function (i) { return Object.assign({ id: novoId_(), consumo_id: cid }, i); }) },
    { tabela: 'movimento_cafe', linhas: [{ id: novoId_(), tipo: 'CONSUMO', ml_cafe: -r3_(ml), data_hora: ts, dia_local: dia, origem_tabela: 'consumo_proprio', origem_id: cid, estorno_de_id: null }] }
  ] });
  var passou = ml > saldoAntes + 1e-9, msg = 'Consumo registrado \u00B7 ' + copos + (copos === 1 ? ' copo' : ' copos') + ' \u00B7 ' + fmtN_(ml) + ' ml de café (' + quem.nome + '). Não entra como venda.';
  if (passou) msg += ' Passou do café preparado: registre o preparo que faltou ou ajuste no Fechamento.';
  return { msg: msg, passou: passou, numero: numero };
}

function cmdPerdaCafe_(db, ctx, p) {
  idValido_(p.id);
  if (db.achar('ajuste_cafe', p.id)) return { msg: 'Perda já registrada.', repetido: true };
  exigirDiaAberto_(db, ctx);
  var ts = ctx.agora.dataHora, dia = ctx.agora.diaLocal, ml = Number(p.ml);
  var motivo = mapa_(db, 'motivo_perda')[p.motivo_id];
  if (!motivo || !motivo.ativo) falha_('Escolha o motivo.');
  var diff = cafeDoDia_(db, dia).saldo;
  if (!(ml > 0)) falha_('Informe quantos ml foram perdidos.');
  if (ml > diff + 1e-9) falha_('A perda não pode passar da diferença do dia (' + fmtN_(Math.max(0, diff)) + ' ml).');
  var numero = db.proximoNumero('ajuste_cafe');
  var aj = nova_(ctx, { id: p.id, numero: numero, usuario_id: ctx.usuarioId, data_hora: ts, dia_local: dia, tipo: 'PERDA', ml_cafe: -ml, motivo_id: motivo.id, observacao: null, status: 'ATIVO' });
  db.gravar({ mae: { tabela: 'ajuste_cafe', obj: aj }, filhos: [{ tabela: 'movimento_cafe', linhas: [{ id: novoId_(), tipo: 'PERDA', ml_cafe: -ml, data_hora: ts, dia_local: dia, origem_tabela: 'ajuste_cafe', origem_id: p.id, estorno_de_id: null }] }] });
  return { msg: 'Perda registrada \u00B7 ' + fmtN_(ml) + ' ml (' + motivo.nome + ')' };
}

function cmdAcertoCafe_(db, ctx, p) {
  idValido_(p.id);
  if (db.achar('ajuste_cafe', p.id)) return { msg: 'Ajuste já registrado.', repetido: true };
  exigirDiaAberto_(db, ctx);
  var ts = ctx.agora.dataHora, dia = ctx.agora.diaLocal, diff = cafeDoDia_(db, dia).saldo;
  if (!(diff < -1e-9)) falha_('Não há venda acima do preparado para ajustar.');
  var ml = r3_(-diff), numero = db.proximoNumero('ajuste_cafe');
  var aj = nova_(ctx, { id: p.id, numero: numero, usuario_id: ctx.usuarioId, data_hora: ts, dia_local: dia, tipo: 'ACERTO', ml_cafe: ml, motivo_id: null, observacao: 'Preparo não lançado', status: 'ATIVO' });
  db.gravar({ mae: { tabela: 'ajuste_cafe', obj: aj }, filhos: [{ tabela: 'movimento_cafe', linhas: [{ id: novoId_(), tipo: 'ACERTO', ml_cafe: ml, data_hora: ts, dia_local: dia, origem_tabela: 'ajuste_cafe', origem_id: p.id, estorno_de_id: null }] }] });
  return { msg: 'Ajuste registrado: +' + fmtN_(ml) + ' ml de café (preparo não lançado).' };
}

function cmdMoverEstoque_(db, ctx, p) {
  idValido_(p.id);
  if (db.achar('ajuste_estoque', p.id)) return { msg: 'Movimento já registrado.', repetido: true };
  var ts = ctx.agora.dataHora, dia = ctx.agora.diaLocal, qtd = Number(p.qtd);
  var mat = mapa_(db, 'material')[p.material_id];
  if (!mat || !mat.ativo) falha_('Material inválido.');
  if (!controla_(mat)) falha_(mat.nome + ' não controla estoque.');
  if (['AJUSTE', 'PERDA', 'TRANSFERENCIA'].indexOf(p.tipo) < 0) falha_('Tipo de movimento inválido.');
  var de = usuarioAtivo_(db, p.de), para = null;
  if (p.tipo === 'AJUSTE') { if (!qtd) falha_('Informe a quantidade do ajuste.'); }
  else if (!(qtd > 0)) falha_('Informe a quantidade.');
  if (p.tipo === 'TRANSFERENCIA') {
    var outros = db.t('usuario').filter(function (u) { return u.ativo && u.id !== de.id; });
    if (!outros.length) falha_('Não há outra pessoa para receber.');
    para = outros[0];
  }
  var sal = saldosEstoque_(db), atual = qtdEstoque_(sal, de.id, mat.id);
  var depois = p.tipo === 'AJUSTE' ? atual + qtd : atual - qtd;
  if (depois < -1e-9) falha_('O estoque de ' + mat.nome + ' de ' + de.nome + ' ficaria negativo.');
  var numero = db.proximoNumero('ajuste_estoque'), id = p.id;
  var cab = nova_(ctx, { id: id, numero: numero, tipo: p.tipo, material_id: mat.id, usuario_id: de.id, usuario_destino_id: para ? para.id : null, qtd: qtd, motivo: p.motivo || null, data_hora: ts, dia_local: dia, status: 'ATIVO' });
  function lin(u, tipo, q) { return { id: novoId_(), usuario_id: u, material_id: mat.id, tipo: tipo, qtd: q, data_hora: ts, dia_local: dia, origem_tabela: 'ajuste_estoque', origem_id: id, estorno_de_id: null }; }
  var led = p.tipo === 'AJUSTE' ? [lin(de.id, 'AJUSTE', qtd)] : p.tipo === 'PERDA' ? [lin(de.id, 'PERDA', -qtd)] : [lin(de.id, 'TRANSF_SAIDA', -qtd), lin(para.id, 'TRANSF_ENTRADA', qtd)];
  db.gravar({ mae: { tabela: 'ajuste_estoque', obj: cab }, filhos: [{ tabela: 'movimento_estoque', linhas: led }] });
  return { msg: 'Movimento registrado no estoque.' };
}

function cmdFecharDia_(db, ctx, p) {
  var dia = ctx.agora.diaLocal;
  if (diaFechado_(db, dia)) return { msg: 'O dia já está fechado.' };
  var saldo = cafeDoDia_(db, dia).saldo;
  if (Math.abs(saldo) > 1e-9) falha_('O dia só fecha quando produzido = vendido + perdido (diferença de ' + fmtN_(saldo) + ' ml).');
  db.anexar('fechamento_dia', [{ id: novoId_(), dia_local: dia, status: 'FECHADO', saldo_ml: 0, usuario_id: ctx.usuarioId, data_hora: ctx.agora.dataHora }]);
  return { msg: 'Dia fechado: produzido = vendido + perdido.' };
}
function cmdReabrirDia_(db, ctx, p) {
  var dia = ctx.agora.diaLocal;
  if (!diaFechado_(db, dia)) return { msg: 'O dia não está fechado.' };
  db.anexar('fechamento_dia', [{ id: novoId_(), dia_local: dia, status: 'REABERTO', saldo_ml: cafeDoDia_(db, dia).saldo, usuario_id: ctx.usuarioId, data_hora: ctx.agora.dataHora }]);
  return { msg: 'Dia reaberto.' };
}

function cmdLancamento_(db, ctx, p) {
  idValido_(p.id);
  if (db.achar('lancamento_financeiro', p.id)) return { msg: 'Lançamento já registrado.', repetido: true };
  if (['APORTE', 'REEMBOLSO', 'DESPESA'].indexOf(p.tipo) < 0) falha_('Tipo de lançamento inválido.');
  var u = usuarioAtivo_(db, p.usuario_id), valor = Math.round(Number(p.valor_centavos));
  if (!(valor > 0)) falha_('Informe o valor.');
  var numero = db.proximoNumero('lancamento_financeiro');
  var l = nova_(ctx, { id: p.id, numero: numero, tipo: p.tipo, usuario_id: u.id, valor_centavos: valor, descricao: p.descricao || null, data_hora: ctx.agora.dataHora, dia_local: ctx.agora.diaLocal, status: 'ATIVO' });
  db.gravar({ mae: { tabela: 'lancamento_financeiro', obj: l }, filhos: [] });
  return { msg: 'Lançamento registrado \u00B7 ' + fmtR_(valor) };
}

/* ---------- estorno (desfazer) ---------- */
var TABELAS_ESTORNAVEIS_ = ['venda', 'compra', 'preparo', 'ajuste_cafe', 'ajuste_estoque', 'lancamento_financeiro', 'sorteio', 'consumo_proprio'];
function cmdEstornar_(db, ctx, p) {
  if (TABELAS_ESTORNAVEIS_.indexOf(p.tabela) < 0) falha_('Esse registro não pode ser desfeito.');
  if (p.tabela === 'sorteio') return desfazerSorteio_(db, ctx, p);
  var cab = db.achar(p.tabela, p.id);
  if (!cab) falha_('Registro não encontrado.');
  if (cab.status !== 'ATIVO') falha_('Esse registro já foi desfeito.');
  if ((p.tabela === 'venda' || p.tabela === 'preparo' || p.tabela === 'ajuste_cafe' || p.tabela === 'consumo_proprio') && diaFechado_(db, cab.dia_local)) falha_('O dia ' + cab.dia_local + ' está fechado. Reabra o dia para desfazer.');
  var ts = ctx.agora.dataHora, dia = ctx.agora.diaLocal, mats = mapa_(db, 'material');
  var invE = db.t('movimento_estoque').filter(function (m) { return m.origem_tabela === p.tabela && m.origem_id === cab.id && !m.estorno_de_id; });
  var invC = db.t('movimento_cafe').filter(function (m) { return m.origem_tabela === p.tabela && m.origem_id === cab.id && !m.estorno_de_id; });
  var sal = saldosEstoque_(db);
  invE.forEach(function (m) {
    var u = sal[m.usuario_id] = sal[m.usuario_id] || {};
    u[m.material_id] = r3_((u[m.material_id] || 0) - m.qtd);
    if (!ctx.semChecagemEstoque && u[m.material_id] < -1e-9) falha_('Não dá para desfazer: o estoque de ' + mats[m.material_id].nome + ' ficaria negativo.');
  });
  var linhasE = invE.map(function (m) { return { id: novoId_(), usuario_id: m.usuario_id, material_id: m.material_id, tipo: 'ESTORNO', qtd: -m.qtd, data_hora: ts, dia_local: dia, origem_tabela: m.origem_tabela, origem_id: m.origem_id, estorno_de_id: m.id }; });
  var linhasC = invC.map(function (m) { return { id: novoId_(), tipo: 'ESTORNO', ml_cafe: -m.ml_cafe, data_hora: ts, dia_local: m.dia_local, origem_tabela: m.origem_tabela, origem_id: m.origem_id, estorno_de_id: m.id }; });
  db.anexar('estorno', [{ id: novoId_(), tabela_origem: p.tabela, id_origem: cab.id, motivo: p.motivo || null, usuario_id: ctx.usuarioId, data_hora: ts }]);
  if (linhasE.length) db.anexar('movimento_estoque', linhasE);
  if (linhasC.length) db.anexar('movimento_cafe', linhasC);
  db.atualizar(p.tabela, cab.id, Object.assign({ status: 'ESTORNADO' }, carimbo_(ctx, db, cab)));
  if (p.tabela === 'venda') db.t('numero_sorteio').filter(function (n) { return n.venda_id === cab.id; }).forEach(function (n) { db.atualizar('numero_sorteio', n.id, { status: 'ESTORNADO' }); });
  var msg = 'Registro desfeito (estorno).';
  if ((p.tabela === 'preparo' || p.tabela === 'ajuste_cafe') && cafeDoDia_(db, cab.dia_local).saldo < -1e-9) msg = 'Registro desfeito. Agora as vendas passam do café preparado: acerte no Fechamento do dia.';
  return { msg: msg };
}

/* ---------- clientes e sorteio ---------- */
function soDigitos_(s) { return String(s || '').replace(/\D/g, ''); }
function cmdClienteSalvar_(db, ctx, p) {
  var nome = String(p.nome || '').trim(), tel = soDigitos_(p.telefone), email = String(p.email || '').trim().toLowerCase();
  if (nome.length < 2) falha_('Digite o nome do cliente.');
  if (tel.length < 10 || tel.length > 11) falha_('Telefone com DDD: 10 ou 11 números.');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) falha_('E-mail inválido.');
  var outro = db.t('cliente').filter(function (c) { return c.id !== p.id && (c.telefone === tel || c.email === email); })[0];
  if (outro) falha_('Esse telefone ou e-mail já está no cadastro de ' + outro.nome + ' (' + outro.codigo + ').');
  if (p.id && db.achar('cliente', p.id)) {
    var c = db.achar('cliente', p.id);
    db.atualizar('cliente', c.id, Object.assign({ nome: nome, telefone: tel, email: email, origem: 'REAL' }, carimbo_(ctx, db, c)));
    return { msg: 'Cliente atualizado.', cliente_id: c.id };
  }
  idValido_(p.novo_id);
  var seq = db.proximoNumero('cliente');
  var novo = nova_(ctx, { id: p.novo_id, codigo: 'C' + String(seq).padStart(3, '0'), nome: nome, telefone: tel, email: email, consentimento_em: ctx.agora.dataHora, origem: ctx.semFechamento ? 'EXEMPLO' : 'REAL', ativo: true });
  db.anexar('cliente', [novo]);
  return { msg: 'Cliente cadastrado: ' + novo.codigo + '.', cliente_id: novo.id };
}
function cmdClienteAtivo_(db, ctx, p) {
  var c = db.achar('cliente', p.id);
  if (!c) falha_('Cliente não encontrado.');
  db.atualizar('cliente', c.id, Object.assign({ ativo: !!p.ativo }, carimbo_(ctx, db, c)));
  return { msg: p.ativo ? 'Cliente ativado.' : 'Cliente inativado.' };
}
function cmdNovoSorteio_(db, ctx, p) {
  idValido_(p.id);
  if (db.achar('sorteio', p.id)) return { msg: 'Novo sorteio já registrado.', repetido: true };
  var ts = ctx.agora.dataHora, est = estadoSorteio_(db, ts);
  if (!est.aberto || !est.nAtivos) falha_('Não há números neste sorteio para encerrar.');
  var antigo = est.aberto;
  db.atualizar('sorteio', antigo.id, Object.assign({ status: 'ENCERRADO', qtd_numeros: est.nAtivos, meta_numeros: est.meta, encerrado_em: ts, encerrado_por: ctx.usuarioId }, carimbo_(ctx, db, antigo)));
  var novo = nova_(ctx, { id: p.id, rodada: db.proximoNumero('sorteio'), status: 'ABERTO', meta_numeros: est.meta, qtd_numeros: 0, aberto_em: ts, encerrado_em: null, encerrado_por: null });
  db.anexar('sorteio', [novo]);
  return { msg: 'Sorteio nº ' + antigo.rodada + ' encerrado com ' + est.nAtivos + (est.nAtivos === 1 ? ' número' : ' números') + '. O sorteio nº ' + novo.rodada + ' começou do zero. Os cadastros continuam.' };
}
/* desfazer o último "novo sorteio": reabre o anterior; só vale se o novo ainda não vendeu números */
function desfazerSorteio_(db, ctx, p) {
  var r = db.achar('sorteio', p.id);
  if (!r) falha_('Sorteio não encontrado.');
  if (r.status !== 'ENCERRADO') falha_('Só dá para reabrir um sorteio encerrado.');
  var ultimoEnc = ultimo_(db.t('sorteio').filter(function (s) { return s.status === 'ENCERRADO'; }).sort(function (a, b) { return a.rodada - b.rodada; }));
  if (ultimoEnc.id !== r.id) falha_('Só o último sorteio encerrado pode ser reaberto.');
  var est = estadoSorteio_(db, ctx.agora.dataHora);
  if (est.aberto && est.nAtivos > 0) falha_('Já foram vendidos ' + est.nAtivos + (est.nAtivos === 1 ? ' número' : ' números') + ' no sorteio nº ' + est.aberto.rodada + '. Desfaça essas vendas antes de reabrir o nº ' + r.rodada + '.');
  var ts = ctx.agora.dataHora;
  if (est.aberto) db.atualizar('sorteio', est.aberto.id, Object.assign({ status: 'CANCELADO', encerrado_em: ts, encerrado_por: ctx.usuarioId }, carimbo_(ctx, db, est.aberto)));
  db.atualizar('sorteio', r.id, Object.assign({ status: 'ABERTO', encerrado_em: null, encerrado_por: null, qtd_numeros: 0 }, carimbo_(ctx, db, r)));
  db.anexar('estorno', [{ id: novoId_(), tabela_origem: 'sorteio', id_origem: r.id, motivo: p.motivo || null, usuario_id: ctx.usuarioId, data_hora: ts }]);
  return { msg: 'Sorteio nº ' + r.rodada + ' reaberto. O números dele voltam a valer.' };
}

/* ---------- cadastros com vigência ---------- */
function fecharVigencia_(db, ctx, tabela, atual) {
  db.atualizar(tabela, atual.id, Object.assign({ vigente_ate: ctx.agora.dataHora }, tabela === 'preco_venda' || tabela === 'config' ? {} : carimbo_(ctx, db, atual)));
}
function cmdConfig_(db, ctx, p) {
  var CHAVES = { 'sorteio.meta_numeros': [10, 500], 'sorteio.preco_numero_centavos': [1, 100000] };
  var NOMES = { 'sorteio.meta_numeros': 'A meta do sorteio deve ficar entre 10 e 500 números.', 'sorteio.preco_numero_centavos': 'O preço do número deve ficar entre R$ 0,01 e R$ 1.000,00.' };
  var itens = p.itens || (p.chave ? (function () { var o = {}; o[p.chave] = p.valor; return o; })() : {}), ts = ctx.agora.dataHora, novos = {};
  if (!Object.keys(itens).length) falha_('Configuração inválida.');
  Object.keys(itens).forEach(function (k) {
    if (!CHAVES[k]) falha_('Configuração inválida.');
    var v = Math.round(Number(itens[k]));
    if (!(v >= CHAVES[k][0] && v <= CHAVES[k][1])) falha_(NOMES[k]);
    novos[k] = v;
  });
  Object.keys(novos).forEach(function (k) {
    db.t('config').filter(function (c) { return c.chave === k && vigenteEm_(c, ts); }).forEach(function (c) { fecharVigencia_(db, ctx, 'config', c); });
    db.anexar('config', [{ id: novoId_(), chave: k, valor: String(novos[k]), vigente_de: ts, vigente_ate: null, criado_em: ts, criado_por: ctx.usuarioId }]);
  });
  return { msg: Object.keys(novos).length > 1 ? 'Regras do sorteio atualizadas.' : 'Regra do sorteio atualizada.' };
}
function cmdPreco_(db, ctx, p) {
  var v = mapa_(db, 'produto_variante')[p.variante_id];
  if (!v) falha_('Produto não encontrado.');
  var preco = Math.round(Number(p.preco_centavos));
  if (!(preco >= 1 && preco <= 100000)) falha_('Preço fora do limite permitido (de R$ 0,01 a R$ 1.000,00).');
  var ts = ctx.agora.dataHora, atual = ultimo_(db.t('preco_venda').filter(function (x) { return x.variante_id === v.id && vigenteEm_(x, ts); }));
  if (atual && atual.preco_centavos === preco) return { msg: 'Preço já é esse.' };
  if (atual) fecharVigencia_(db, ctx, 'preco_venda', atual);
  db.anexar('preco_venda', [{ id: novoId_(), variante_id: v.id, preco_centavos: preco, vigente_de: ts, vigente_ate: null, criado_em: ts, criado_por: ctx.usuarioId }]);
  return { msg: 'Preço atualizado. O anterior fica guardado no histórico.' };
}
function cmdVarianteAtivo_(db, ctx, p) {
  var v = db.achar('produto_variante', p.id);
  if (!v) falha_('Produto não encontrado.');
  db.atualizar('produto_variante', v.id, Object.assign({ ativo: !!p.ativo }, carimbo_(ctx, db, v)));
  return { msg: p.ativo ? 'Produto à venda.' : 'Produto fora de venda.' };
}
function cmdMaterialSalvar_(db, ctx, p) {
  var m = p.id ? db.achar('material', p.id) : null;
  var campos = {};
  if (p.nome !== undefined) { campos.nome = String(p.nome).trim(); if (campos.nome.length < 2) falha_('Digite o nome do material.'); }
  ['estoque_minimo_qtd', 'pacote_qtd', 'preco_padrao_centavos', 'passo_qtd'].forEach(function (k) {
    if (p[k] !== undefined) { var n = Number(p[k]); if (!(n >= 0) || (k === 'pacote_qtd' && !(n > 0)) || (k === 'passo_qtd' && !(n > 0))) falha_('Valor inválido em ' + k + '.'); campos[k] = k === 'preco_padrao_centavos' ? Math.round(n) : r3_(n); }
  });
  if (p.ativo !== undefined) campos.ativo = !!p.ativo;
  if (p.controla_estoque !== undefined) campos.controla_estoque = !!p.controla_estoque;
  if (m) {
    if (campos.nome && db.t('material').some(function (x) { return x.id !== m.id && x.nome.toLowerCase() === campos.nome.toLowerCase(); })) falha_('Já existe um material com esse nome.');
    db.atualizar('material', m.id, Object.assign(campos, carimbo_(ctx, db, m)));
    return { msg: 'Material atualizado.' };
  }
  idValido_(p.novo_id);
  if (!campos.nome) falha_('Digite o nome do material.');
  if (['g', 'ml', 'un'].indexOf(p.unidade) < 0) falha_('Escolha a unidade (g, ml ou un).');
  if (db.t('material').some(function (x) { return x.nome.toLowerCase() === campos.nome.toLowerCase(); })) falha_('Já existe um material com esse nome.');
  var seq = db.proximoNumero('material');
  var un = p.unidade;
  db.anexar('material', [nova_(ctx, { id: p.novo_id, codigo: 'MAT' + String(seq).padStart(3, '0'), nome: campos.nome, unidade: un, estoque_minimo_qtd: 0, pacote_qtd: un === 'un' ? 10 : 500, preco_padrao_centavos: 0, passo_qtd: un === 'un' ? 1 : 50, ativo: true, controla_estoque: true })]);
  return { msg: 'Material adicionado. Ajuste mínimo, pacote e preço na lista.' };
}
/* receita: vale para a casa (sem usuario_id) ou para uma pessoa (usuario_id). Mudar cria uma versão nova. */
var CAMPOS_RECEITA_ = { colheres_por_litro: 0.1, g_por_colher: 0.1, filtros_por_litro: 0, acucar_g_por_litro: 0, agua_ml_por_litro: 0, leite_ml_por_litro: 0 };
function cmdReceita_(db, ctx, p) {
  var ts = ctx.agora.dataHora, dono = p.usuario_id ? usuarioAtivo_(db, p.usuario_id).id : null, tipo = baseValida_(p.base);
  var base = receitaVigente_(db, ts, dono, tipo), nova = {};
  Object.keys(CAMPOS_RECEITA_).forEach(function (k) {
    nova[k] = base[k] || 0;
    if (p[k] !== undefined) { var n = Number(p[k]); if (!(n >= CAMPOS_RECEITA_[k] && n <= 100000)) falha_('Valor inválido na receita (' + k.replace(/_/g, ' ') + ').'); nova[k] = r3_(n); }
  });
  if ((base.usuario_id || null) === dono) fecharVigencia_(db, ctx, 'receita_cafe', base);
  db.anexar('receita_cafe', [nova_(ctx, Object.assign(nova, { usuario_id: dono, vigente_de: ts, vigente_ate: null, base: tipo }))]);
  return { msg: (dono ? 'Receita de ' + mapa_(db, 'usuario')[dono].nome : 'Receita padrão da casa') + (tipo === 'CAFE_LEITE' ? ' (café com leite)' : '') + ' atualizada. Preparos antigos mantêm a receita da época.' };
}
function cmdReceitaPadrao_(db, ctx, p) {
  var u = usuarioAtivo_(db, p.usuario_id), ts = ctx.agora.dataHora;
  var tipo = p.base ? baseValida_(p.base) : null, minhas = db.t('receita_cafe').filter(function (r) { return r.usuario_id === u.id && vigenteEm_(r, ts) && (!tipo || (r.base || 'CAFE') === tipo); });
  if (!minhas.length) return { msg: u.nome + ' já usa a receita padrão da casa.' };
  minhas.forEach(function (r) { fecharVigencia_(db, ctx, 'receita_cafe', r); });
  return { msg: u.nome + ' voltou a usar a receita padrão da casa.' };
}

/* tamanho do copo e/ou preço de um produto, de uma vez. O que já foi vendido ou preparado mantém o tamanho e o preço da época. */
function cmdVarianteSalvar_(db, ctx, p) {
  var v = db.achar('produto_variante', p.variante_id), ts = ctx.agora.dataHora;
  if (!v) falha_('Produto não encontrado.');
  var tam = p.tamanho_ml !== undefined ? Math.round(Number(p.tamanho_ml)) : v.tamanho_ml;
  var preco = p.preco_centavos !== undefined ? Math.round(Number(p.preco_centavos)) : null;
  if (!(tam >= 20 && tam <= 1000)) falha_('O tamanho do copo deve ficar entre 20 e 1.000 ml.');
  if (preco !== null && !(preco >= 1 && preco <= 100000)) falha_('O preço deve ficar entre R$ 0,01 e R$ 1.000,00.');
  var msgs = [];
  if (tam !== v.tamanho_ml) {
    db.atualizar('produto_variante', v.id, Object.assign({ tamanho_ml: tam }, carimbo_(ctx, db, v)));
    msgs.push('Copo agora com ' + fmtN_(tam) + ' ml de café. Vale daqui para frente; o que já foi registrado mantém o tamanho da época');
  }
  if (preco !== null) { var r = cmdPreco_(db, ctx, { variante_id: v.id, preco_centavos: preco }); if (!/já é esse/.test(r.msg)) msgs.push('Preço atualizado'); }
  return { msg: msgs.length ? msgs.join('. ') + '.' : 'Nada mudou.' };
}

function cmdComposicao_(db, ctx, p) {
  var v = mapa_(db, 'produto_variante')[p.variante_id];
  if (!v) falha_('Produto não encontrado.');
  var ts = ctx.agora.dataHora, atual = composicaoVigente_(db, v.id, ts);
  var canela = p.canela_g !== undefined ? Number(p.canela_g) : atual.canela_g;
  if (!(canela >= 0 && canela <= 5)) falha_('Canela no copo fora do limite (até 5 g).');
  var copoId = p.copo_material_id || atual.copo_material_id, copo = mapa_(db, 'material')[copoId];
  if (!copo || !copo.ativo || copo.unidade !== 'un') falha_('Escolha um copo (material em unidades).');
  fecharVigencia_(db, ctx, 'composicao_copo', atual);
  db.anexar('composicao_copo', [nova_(ctx, { variante_id: v.id, leite_ml: 0, canela_g: r3_(canela), copo_material_id: copo.id, vigente_de: ts, vigente_ate: null })]);
  return { msg: 'Composição do copo atualizada.' };
}
/* promoções são só rótulos para registrar o motivo de um desconto manual; nada é aplicado sozinho */
function cmdPromocao_(db, ctx, p) {
  var nome = p.nome !== undefined ? String(p.nome).trim() : null;
  if (nome !== null && (nome.length < 2 || nome.length > 40)) falha_('O nome deve ter de 2 a 40 letras.');
  var pr = p.id ? db.achar('promocao', p.id) : null;
  if (!pr && p.novo_id && db.achar('promocao', p.novo_id)) return { msg: 'Promoção já adicionada.', repetido: true };
  if (nome !== null && db.t('promocao').some(function (x) { return (!pr || x.id !== pr.id) && x.nome.toLowerCase() === nome.toLowerCase(); })) falha_('Já existe uma promoção com esse nome.');
  var campos = {};
  if (p.desconto_pct !== undefined) { var d = Number(p.desconto_pct); if (!(d >= 0 && d <= 100)) falha_('Desconto de referência de 0% a 100%.'); campos.desconto_pct = d; }
  if (p.ativo !== undefined) campos.ativo = !!p.ativo;
  if (pr) {
    if (nome !== null) campos.nome = nome;
    db.atualizar('promocao', pr.id, Object.assign(campos, carimbo_(ctx, db, pr)));
    return { msg: 'Promoção atualizada.' };
  }
  idValido_(p.novo_id);
  if (nome === null) falha_('Digite o nome da promoção.');
  db.anexar('promocao', [nova_(ctx, { id: p.novo_id, nome: nome, desconto_pct: campos.desconto_pct || 0, ativo: true })]);
  return { msg: 'Promoção cadastrada: ' + nome + '. Ela aparece como motivo na hora de dar um desconto.' };
}

/* ---------- contagem de estoque e listas editáveis ---------- */
function cmdContarEstoque_(db, ctx, p) {
  idValido_(p.id);
  if (db.achar('ajuste_estoque', p.id)) return { msg: 'Contagem já registrada.', repetido: true };
  var mat = mapa_(db, 'material')[p.material_id];
  if (!mat || !mat.ativo) falha_('Material inválido.');
  if (!controla_(mat)) falha_(mat.nome + ' não controla estoque.');
  var u = usuarioAtivo_(db, p.usuario_id), contado = Number(p.contado);
  if (!(contado >= 0 && contado <= 10000000)) falha_('Informe a quantidade que você contou.');
  var atual = qtdEstoque_(saldosEstoque_(db), u.id, mat.id), diff = r3_(contado - atual);
  if (Math.abs(diff) < 1e-9) return { msg: 'O estoque já está igual ao que você contou. Nada a ajustar.', igual: true };
  var r = cmdMoverEstoque_(db, ctx, { id: p.id, tipo: 'AJUSTE', material_id: mat.id, de: u.id, qtd: diff, motivo: 'Contagem de estoque' });
  r.msg = 'Estoque de ' + mat.nome + ' de ' + u.nome + ' ajustado: ' + fmtN_(atual) + ' \u2192 ' + fmtN_(contado) + ' ' + mat.unidade + '.';
  return r;
}
var LISTAS_ = { fornecedor: 'Local de compra', forma_pagamento: 'Forma de pagamento', motivo_perda: 'Motivo de perda' };
function cmdListaSalvar_(db, ctx, p) {
  if (!LISTAS_[p.tabela]) falha_('Lista inválida.');
  var nome = p.nome !== undefined ? String(p.nome).trim() : null;
  if (nome !== null && (nome.length < 2 || nome.length > 40)) falha_('O nome deve ter de 2 a 40 letras.');
  var existente = p.id ? db.achar(p.tabela, p.id) : null;
  if (!existente && p.novo_id && db.achar(p.tabela, p.novo_id)) return { msg: 'Já adicionado.', repetido: true, id: p.novo_id };
  if (nome !== null && db.t(p.tabela).some(function (x) { return (!existente || x.id !== existente.id) && x.nome.toLowerCase() === nome.toLowerCase(); })) falha_('Já existe: ' + nome + '.');
  if (existente) {
    var campos = {};
    if (nome !== null) campos.nome = nome;
    if (p.ativo !== undefined) {
      campos.ativo = !!p.ativo;
      if (!campos.ativo && db.t(p.tabela).filter(function (x) { return x.ativo && x.id !== existente.id; }).length === 0) falha_('Precisa sobrar pelo menos um item ativo na lista.');
    }
    db.atualizar(p.tabela, existente.id, Object.assign(campos, carimbo_(ctx, db, existente)));
    return { msg: 'Atualizado.' };
  }
  idValido_(p.novo_id);
  if (db.achar(p.tabela, p.novo_id)) return { msg: 'Já adicionado.', repetido: true, id: p.novo_id };
  if (nome === null) falha_('Digite o nome.');
  db.anexar(p.tabela, [nova_(ctx, { id: p.novo_id, nome: nome, ativo: true })]);
  return { msg: LISTAS_[p.tabela] + ' adicionado: ' + nome + '.', id: p.novo_id };
}
