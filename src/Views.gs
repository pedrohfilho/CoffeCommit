/**
 * Views.gs — monta os dados de cada tela. Só leitura.
 * Cada tela pede apenas o que precisa, para ler poucas abas por chamada.
 */

function ativoOk_(x) { return x.ativo === true; }
function nomeDe_(mapa, id) { return mapa[id] ? mapa[id].nome : id; }
function hm_(iso) { return formatarLocal_(iso, 'HH:mm'); }
function dm_(iso) { return formatarLocal_(iso, 'dd/MM HH:mm'); }
function maskTel_(d) {
  var n = soDigitos_(d), fim = n.slice(-4);
  if (n.length === 11) return '(' + n.slice(0, 2) + ') \u2022\u2022\u2022\u2022\u2022-' + fim;
  if (n.length === 10) return '(' + n.slice(0, 2) + ') \u2022\u2022\u2022\u2022-' + fim;
  return '\u2022\u2022\u2022' + fim;
}
function fmtTel_(d) {
  var n = soDigitos_(d);
  if (n.length === 11) return '(' + n.slice(0, 2) + ') ' + n.slice(2, 7) + '-' + n.slice(7);
  if (n.length === 10) return '(' + n.slice(0, 2) + ') ' + n.slice(2, 6) + '-' + n.slice(6);
  return n;
}

function ver_(db, ctx, q) {
  switch (q.tela) {
    case 'venda': return viewVenda_(db, ctx);
    case 'preparo': return viewPreparo_(db, ctx);
    case 'compra': return viewCompra_(db, ctx);
    case 'fechamento': return viewFechamento_(db, ctx);
    case 'estoque': return viewEstoque_(db, ctx, q.sub || 'saldos');
    case 'paineis': return viewPaineis_(db, ctx, q.sub || 'geral', q.periodo || 'tudo');
    case 'cadastros': return viewCadastros_(db, ctx, q.sub || 'materiais');
    case 'financeiro': return viewFinanceiro_(db, ctx, q.sub || 'resultado');
    case 'clientes': return viewClientes_(db, ctx, q.sub || 'lista', q.q || '');
    case 'historico': return viewHistorico_(db, ctx);
    case 'sistema': return viewSistema_(db, ctx);
    case 'mais': return {};
  }
  falha_('Tela desconhecida.');
}

function itensPorVenda_(db) {
  var m = {}, vars = mapa_(db, 'produto_variante'), prods = mapa_(db, 'produto');
  db.t('venda_item').forEach(function (i) { (m[i.venda_id] = m[i.venda_id] || []).push(i); });
  return { itens: m, promos: mapa_(db, 'promocao'), rotulo: function (i) { var v = vars[i.variante_id]; return i.qtd + '\u00D7 ' + prods[v.produto_id].nome.replace('Café ', '') + ' ' + (i.tamanho_ml != null ? i.tamanho_ml : v.tamanho_ml) + ' ml'; } };
}
function textoVenda_(v, ipv) {
  var partes = [], its = ipv.itens[v.id] || [];
  if (its.length) partes.push(its.map(ipv.rotulo).join(', '));
  if (v.total_sorteio_centavos > 0) partes.push('com sorteio');
  var txt = partes.join(' + ') || 'Sem itens';
  if (v.desconto_centavos > 0) txt += ' \u00B7 desconto ' + fmtR_(v.desconto_centavos) + (ipv.promos && ipv.promos[v.promocao_id] ? ' (' + ipv.promos[v.promocao_id].nome + ')' : '');
  return txt;
}

function consumosDeHoje_(db, dia, us) {
  var vars = mapa_(db, 'produto_variante'), prods = mapa_(db, 'produto'), itens = {};
  db.t('consumo_proprio_item').forEach(function (i) { (itens[i.consumo_id] = itens[i.consumo_id] || []).push(i); });
  return db.t('consumo_proprio').filter(function (c) { return c.status === 'ATIVO' && c.dia_local === dia; }).slice(-6).reverse().map(function (c) {
    var txt = (itens[c.id] || []).map(function (i) { var v = vars[i.variante_id]; return i.qtd + '\u00D7 ' + prods[v.produto_id].nome.replace('Café ', '') + ' ' + i.tamanho_ml + ' ml'; }).join(', ');
    return { id: c.id, numero: c.numero, hora: hm_(c.data_hora), quem: nomeDe_(us, c.consumidor_id), texto: txt, ml: c.ml_cafe };
  });
}

/* ---------------- Venda ---------------- */
function viewVenda_(db, ctx) {
  var ts = ctx.agora.dataHora, dia = ctx.agora.diaLocal, prods = mapa_(db, 'produto');
  var produtos = db.t('produto_variante').filter(ativoOk_).map(function (v) {
    var comp = composicaoVigente_(db, v.id, ts);
    return { id: v.id, nome: prods[v.produto_id].nome, tamanho: v.tamanho_ml, preco: precoVigente_(db, v.id, ts), cafeMl: v.tamanho_ml };
  });
  var cafe = cafeDoDia_(db, dia), ipv = itensPorVenda_(db), formas = mapa_(db, 'forma_pagamento'), us = mapa_(db, 'usuario'), est = null;
  try { est = estadoSorteio_(db, ts); } catch (e) { est = null; }   // problema no sorteio não pode impedir a venda
  var ultimas = db.t('venda').filter(function (v) { return v.status === 'ATIVO' && v.dia_local === dia; }).slice(-4).reverse().map(function (v) {
    return { id: v.id, numero: v.numero, hora: hm_(v.data_hora), usuario: nomeDe_(us, v.usuario_id), forma: nomeDe_(formas, v.forma_pagamento_id), total: v.total_cafe_centavos + v.total_sorteio_centavos, texto: textoVenda_(v, ipv) };
  });
  return {
    dia: dia, fechado: diaFechado_(db, dia), saldoMl: cafe.saldo, produtos: produtos,
    formas: db.t('forma_pagamento').filter(ativoOk_).map(function (f) { return { id: f.id, nome: f.nome }; }),
    promocoes: db.t('promocao').filter(ativoOk_).map(function (x) { return { id: x.id, nome: x.nome }; }),
    usuarios: db.t('usuario').filter(ativoOk_).map(function (u) { return { id: u.id, nome: u.nome }; }),
    consumos: consumosDeHoje_(db, dia, us),
    ultimas: ultimas, sorteio: est ? { preco: est.preco, nAtivos: est.nAtivos, meta: est.meta, rodada: est.rodadaAtual } : null
  };
}

/* busca de cliente para a Venda: nada de lista, só 3 resultados com telefone mascarado */
function filtrarClientes_(db, q) {
  var qq = String(q || '').trim().toLowerCase(), qd = soDigitos_(qq), soNum = qq.length > 0 && /^[\d\s().+-]+$/.test(qq);
  if ((!soNum && qq.length < 2) || (soNum && !qd.length)) return { ativa: false, lista: [] };
  var vendas = mapa_(db, 'venda');
  var nums = db.t('numero_sorteio').filter(function (n) { var v = vendas[n.venda_id]; return n.status === 'ATIVO' && v && v.status === 'ATIVO'; });
  var lista = db.t('cliente').filter(function (c) {
    if (!soNum) return c.nome.toLowerCase().indexOf(qq) >= 0 || c.email.indexOf(qq) >= 0;
    if (qd.length >= 4 && c.telefone.indexOf(qd) >= 0) return true;
    if (qd.length <= 4) {
      var id = parseInt(qd, 10), tk = pad4_(id);
      return nums.some(function (n) { return n.cliente_id === c.id && (n.numero === id || n.token === qd.padStart(4, '0') || n.token === tk); });
    }
    return false;
  });
  return { ativa: true, lista: lista };
}
function buscarClientesVenda_(db, ctx, p) {
  var r = filtrarClientes_(db, p.q), ativos = r.lista.filter(ativoOk_);
  return { ativa: r.ativa, total: ativos.length, itens: ativos.slice(0, 3).map(function (c) { return { id: c.id, nome: c.nome, contato: maskTel_(c.telefone) }; }) };
}
function clienteMascarado_(db, ctx, p) {
  var c = mapa_(db, 'cliente')[p.id];
  return c ? { id: c.id, nome: c.nome, contato: maskTel_(c.telefone) } : null;
}

/* ---------------- Preparo ---------------- */
function viewPreparo_(db, ctx) {
  var ts = ctx.agora.dataHora, dia = ctx.agora.diaLocal, prods = mapa_(db, 'produto'), us = mapa_(db, 'usuario');
  var receitaPor = {}, receitas = {};
  function fmtR3(r, u) { return { colheres: r.colheres_por_litro, gPorColher: r.g_por_colher, filtros: r.filtros_por_litro, acucar: r.acucar_g_por_litro, agua: r.agua_ml_por_litro, leite: r.leite_ml_por_litro || 0, propria: r.usuario_id === u.id }; }
  BASES_.forEach(function (b) { receitas[b] = {}; db.t('usuario').filter(ativoOk_).forEach(function (u) { receitas[b][u.id] = fmtR3(receitaVigente_(db, ts, u.id, b), u); }); });
  receitaPor = receitas.CAFE;   // compatível com a tela antiga: a receita do café
  var copo = {}, produtos = db.t('produto_variante').filter(ativoOk_).map(function (v) {
    var comp = composicaoVigente_(db, v.id, ts); copo[v.id] = comp.copo_material_id;
    return { id: v.id, nome: prods[v.produto_id].nome, tamanho: v.tamanho_ml, canelaG: comp.canela_g, cafeMl: v.tamanho_ml };
  });
  var plano = {}; db.t('preparo_plano').forEach(function (x) { plano[x.preparo_id] = (plano[x.preparo_id] || 0) + x.copos; });
  return {
    dia: dia, fechado: diaFechado_(db, dia),
    usuarios: db.t('usuario').filter(ativoOk_).map(function (u) { return { id: u.id, nome: u.nome }; }),
    produtos: produtos, copoPorVariante: copo, chaves: materiaisChave_(db, ts),
    receitaPor: receitaPor, receitas: receitas,
    materiais: db.t('material').filter(ativoOk_).map(function (m) { return { id: m.id, nome: m.nome, un: m.unidade, passo: m.passo_qtd, controla: controla_(m) }; }),
    saldos: saldosEstoque_(db),
    hoje: db.t('preparo').filter(function (p) { return p.status === 'ATIVO' && p.dia_local === dia; }).reverse().map(function (p) { return { id: p.id, numero: p.numero, hora: hm_(p.data_hora), litros: p.litros, quem: nomeDe_(us, p.usuario_id), copos: plano[p.id] || 0, pendente: pendente_(p), base: p.base || 'CAFE' }; }),
    pendentes: pendentesDe_(db, us)
  };
}

/* preparos que ficaram sem os materiais, com o consumo que a receita da época manda (para preencher com um toque) */
function pendentesDe_(db, us) {
  var planoPor = {};
  db.t('preparo_plano').forEach(function (x) { var m = planoPor[x.preparo_id] = planoPor[x.preparo_id] || {}; m[x.variante_id] = (m[x.variante_id] || 0) + x.copos; });
  return db.t('preparo').filter(function (p) { return p.status === 'ATIVO' && pendente_(p); }).reverse().map(function (p) {
    var plano = planoPor[p.id] || {}, consumo = {};
    try { consumo = consumoPreparo_(db, p.data_hora, p.litros, plano, p.usuario_id, p.base || 'CAFE').consumo; } catch (e) { consumo = {}; }
    return { id: p.id, numero: p.numero, base: p.base || 'CAFE', dia: formatarLocal_(p.data_hora, 'dd/MM'), hora: hm_(p.data_hora), litros: p.litros, quemId: p.usuario_id, quem: nomeDe_(us, p.usuario_id), plano: plano, copos: soma_(Object.keys(plano), function (k) { return plano[k]; }), consumo: consumo };
  });
}

/* ---------------- Compra ---------------- */
function histMateriais_(db) {
  var comp = mapa_(db, 'compra'), forn = mapa_(db, 'fornecedor'), mats = mapa_(db, 'material'), h = {};
  db.t('compra_item').forEach(function (i) {
    var c = comp[i.compra_id]; if (!c || c.status !== 'ATIVO') return;
    var m = mats[i.material_id]; if (!m) return;
    (h[i.material_id] = h[i.material_id] || []).push({ data: c.data_hora, dia: formatarLocal_(c.data_hora, 'dd/MM'), forn: nomeDe_(forn, c.fornecedor_id), valor: i.valor_centavos, qtd: i.qtd_base_qtd, pacote: i.valor_centavos / i.qtd_base_qtd * m.pacote_qtd });
  });
  var out = {};
  Object.keys(h).forEach(function (k) {
    var l = h[k].sort(function (a, b) { return a.data < b.data ? -1 : 1; }), pc = l.map(function (x) { return x.pacote; });
    out[k] = { menor: Math.min.apply(null, pc), maior: Math.max.apply(null, pc), medio: soma_(l, function (x) { return x.valor; }) / soma_(l, function (x) { return x.qtd; }) * mats[k].pacote_qtd, ultimo: ultimo_(l).pacote, ultimas: l.slice(-4).reverse().map(function (x) { return { dia: x.dia, forn: x.forn, valor: x.pacote }; }) };
  });
  return out;
}
function viewCompra_(db, ctx) {
  var mats = mapa_(db, 'material'), forn = mapa_(db, 'fornecedor'), us = mapa_(db, 'usuario'), itens = {};
  db.t('compra_item').forEach(function (i) { itens[i.compra_id] = i; });
  var recentes = db.t('compra').filter(function (c) { return c.status === 'ATIVO'; }).slice(-6).reverse().map(function (c) {
    var i = itens[c.id], m = i ? mats[i.material_id] : null;
    return { id: c.id, numero: c.numero, material_id: i ? i.material_id : null, embalagens: i ? i.embalagens : 1, valor: c.valor_total_centavos, fornecedor_id: c.fornecedor_id, texto: nb_((m ? m.nome + ' ' + fmtN_(i.qtd_base_qtd) + ' ' + m.unidade : 'Compra') + ' \u00B7 ' + fmtR_(c.valor_total_centavos) + ' \u00B7 ' + nomeDe_(forn, c.fornecedor_id)), meta: '#' + c.numero + ' \u00B7 ' + dm_(c.data_hora) + ' \u00B7 ' + nomeDe_(us, c.usuario_id) };
  });
  return {
    materiais: db.t('material').filter(function (m) { return m.ativo && controla_(m); }).map(function (m) { return { id: m.id, nome: m.nome, un: m.unidade, pacote: m.pacote_qtd, precoPadrao: m.preco_padrao_centavos }; }),
    fornecedores: db.t('fornecedor').filter(ativoOk_).map(function (f) { return { id: f.id, nome: f.nome }; }),
    hist: histMateriais_(db), recentes: recentes
  };
}

/* ---------------- Fechamento ---------------- */
function viewFechamento_(db, ctx) {
  var dia = ctx.agora.diaLocal, cafe = cafeDoDia_(db, dia), mot = mapa_(db, 'motivo_perda'), us = mapa_(db, 'usuario');
  var vd = db.t('venda').filter(function (v) { return v.status === 'ATIVO' && v.dia_local === dia; });
  var ajustes = db.t('ajuste_cafe').filter(function (a) { return a.status === 'ATIVO' && a.dia_local === dia; }).reverse().map(function (a) {
    return { id: a.id, texto: a.tipo === 'PERDA' ? nb_(fmtN_(-a.ml_cafe) + ' ml \u00B7 ' + nomeDe_(mot, a.motivo_id)) : nb_('Ajuste +' + fmtN_(a.ml_cafe) + ' ml \u00B7 preparo n\u00E3o lan\u00E7ado'), meta: hm_(a.data_hora) + ' \u00B7 ' + nomeDe_(us, a.usuario_id) };
  });
  return {
    dia: dia, fechado: diaFechado_(db, dia), produzidoMl: cafe.produzido, vendidoMl: cafe.vendido, perdidoMl: cafe.perdido, consumidoMl: cafe.consumido, diff: cafe.saldo,
    copos: soma_(vd, function (v) { return v.copos; }), reais: soma_(vd, function (v) { return v.total_cafe_centavos; }),
    motivos: db.t('motivo_perda').filter(ativoOk_).map(function (m) { return { id: m.id, nome: m.nome }; }), ajustes: ajustes, pendMateriais: contarPendentes_(db)
  };
}

/* ---------------- Estoque ---------------- */
function viewEstoque_(db, ctx, sub) {
  var sal = saldosEstoque_(db), us = db.t('usuario').filter(ativoOk_), mats = mapa_(db, 'material');
  var usuarios = us.map(function (u) { return { id: u.id, nome: u.nome }; });
  if (sub === 'saldos') {
    return { sub: sub, usuarios: usuarios, linhas: db.t('material').filter(function (m) { return m.ativo && controla_(m); }).map(function (m) {
      var por = {}, tot = 0; us.forEach(function (u) { var q = qtdEstoque_(sal, u.id, m.id); por[u.id] = q; tot += q; });
      return { id: m.id, nome: m.nome, un: m.unidade, min: m.estoque_minimo_qtd, passo: m.passo_qtd, por: por, total: r3_(tot) };
    }) };
  }
  if (sub === 'movs') {
    var ov = origensValidas_(db, ORIGENS_ESTOQUE_), un = mapa_(db, 'usuario'), cab = { compra: mapa_(db, 'compra'), preparo: mapa_(db, 'preparo'), ajuste_estoque: mapa_(db, 'ajuste_estoque') };
    var movs = db.t('movimento_estoque').filter(function (m) { return movValido_(ov, m); }).slice(-30).reverse().map(function (m) {
      var h = cab[m.origem_tabela] && cab[m.origem_tabela][m.origem_id];
      return { texto: nomeDe_(mats, m.material_id) + ' \u00B7 ' + nomeDe_(un, m.usuario_id), tipo: m.tipo, meta: dm_(m.data_hora), qtd: m.qtd, un: mats[m.material_id].unidade, tabela: m.origem_tabela, origem: m.origem_id, desfazer: !m.estorno_de_id && !!h && h.status === 'ATIVO' };
    });
    return { sub: sub, movs: movs };
  }
  return { sub: sub, usuarios: usuarios, saldos: sal, materiais: db.t('material').filter(function (m) { return m.ativo && controla_(m); }).map(function (m) { return { id: m.id, nome: m.nome, un: m.unidade, passo: m.passo_qtd }; }) };
}

/* ---------------- agregados para painéis e financeiro ---------------- */
/* desde: 'AAAA-MM-DD' (só dali em diante) ou null (tudo). Investido e reembolsado são sempre o acumulado. */
function agregados_(db, ts, desde) {
  var A = { litrosBase: { CAFE: 0, CAFE_LEITE: 0 }, fat: 0, fatSort: 0, copos: 0, nVendas: 0, vendMl: 0, porProd: {}, porPag: {}, porHora: {}, porTam: {}, desc: 0, nDesc: 0, mlServido: 0, consumoMl: 0, consumoCopos: 0, litros: 0, nPrep: 0, nPrepPend: 0, prodMlLanc: 0, gCafe: 0, prodMl: 0, custoAt: 0, custoPad: 0, gasto: 0, nCompras: 0, porLocal: {}, despesas: 0, perdaMot: {}, pess: {}, litrosPess: {}, histCafe: [] };
  var us = db.t('usuario').filter(ativoOk_), formas = mapa_(db, 'forma_pagamento'), forn = mapa_(db, 'fornecedor'), mot = mapa_(db, 'motivo_perda'), vars = mapa_(db, 'produto_variante');
  function dentro(dia) { return !desde || dia >= desde; }
  us.forEach(function (u) { A.pess[u.id] = { ml: 0, invest: 0, reemb: 0 }; A.litrosPess[u.id] = 0; });
  var chave = materiaisChave_(db, ts);
  function add(o, k, v) { o[k] = (o[k] || 0) + v; }
  var vendasAt = {};
  db.t('venda').forEach(function (v) {
    if (v.status !== 'ATIVO' || !dentro(v.dia_local)) return;
    vendasAt[v.id] = true; A.nVendas++; A.desc += v.desconto_centavos || 0; if (v.desconto_centavos > 0) A.nDesc++; A.fat += v.total_cafe_centavos; A.fatSort += v.total_sorteio_centavos; A.copos += v.copos; A.vendMl += v.ml_cafe;
    add(A.porPag, nomeDe_(formas, v.forma_pagamento_id), v.total_cafe_centavos + v.total_sorteio_centavos);
    add(A.porHora, formatarLocal_(v.data_hora, 'HH'), 1);
  });
  db.t('venda_item').forEach(function (i) { if (!vendasAt[i.venda_id]) return; var tam = i.tamanho_ml != null ? i.tamanho_ml : ((vars[i.variante_id] || {}).tamanho_ml || 0); add(A.porProd, i.variante_id + '|' + tam, i.qtd); add(A.porTam, tam, i.qtd); A.mlServido += i.qtd * tam; });
  var prepAt = {};
  db.t('preparo').forEach(function (p) {
    if (p.status !== 'ATIVO' || !dentro(p.dia_local)) return;
    prepAt[p.id] = true; A.nPrep++; A.litros += p.litros; A.prodMl += p.litros * 1000;
    if (pendente_(p)) A.nPrepPend++; else A.prodMlLanc += p.litros * 1000;
    if (A.pess[p.usuario_id]) { A.pess[p.usuario_id].ml += p.litros * 1000; A.litrosPess[p.usuario_id] += p.litros; }
    A.litrosBase[p.base === 'CAFE_LEITE' ? 'CAFE_LEITE' : 'CAFE'] += p.litros;
  });
  db.t('preparo_consumo').forEach(function (c) { if (!prepAt[c.preparo_id]) return; A.custoAt += c.custo_atual_centavos; A.custoPad += c.custo_padrao_centavos; if (c.material_id === chave.cafe) A.gCafe += c.qtd_real_qtd; });
  var compAt = mapa_(db, 'compra');
  db.t('compra').forEach(function (c) {
    if (c.status !== 'ATIVO') return;
    if (A.pess[c.usuario_id]) A.pess[c.usuario_id].invest += c.valor_total_centavos;
    if (!dentro(c.dia_local)) return;
    A.nCompras++; A.gasto += c.valor_total_centavos; add(A.porLocal, nomeDe_(forn, c.fornecedor_id), c.valor_total_centavos);
  });
  db.t('consumo_proprio').forEach(function (c) { if (c.status === 'ATIVO' && dentro(c.dia_local)) { A.consumoMl += c.ml_cafe; A.consumoCopos += c.copos; } });
  db.t('ajuste_cafe').forEach(function (a) { if (a.status === 'ATIVO' && a.tipo === 'PERDA' && dentro(a.dia_local)) add(A.perdaMot, nomeDe_(mot, a.motivo_id), -a.ml_cafe); });
  db.t('lancamento_financeiro').forEach(function (l) {
    if (l.status !== 'ATIVO' || !A.pess[l.usuario_id]) return;
    if (l.tipo === 'REEMBOLSO') A.pess[l.usuario_id].reemb += l.valor_centavos;
    else if (l.tipo === 'APORTE') A.pess[l.usuario_id].invest += l.valor_centavos;
    else if (dentro(l.dia_local)) A.despesas += l.valor_centavos;
  });
  db.t('compra_item').forEach(function (i) {
    var c = compAt[i.compra_id]; if (!c || c.status !== 'ATIVO' || i.material_id !== chave.cafe || !dentro(c.dia_local)) return;
    A.histCafe.push({ data: c.data_hora, dia: formatarLocal_(c.data_hora, 'dd/MM'), forn: nomeDe_(forn, c.fornecedor_id), pacote: i.valor_centavos / i.qtd_base_qtd * 500 });
  });
  A.histCafe.sort(function (a, b) { return a.data < b.data ? -1 : 1; });
  A.us = us; A.vars = vars; A.resultado = A.fat + A.fatSort - A.custoAt - A.despesas; A.receita = A.fat + A.fatSort;
  A.margem = A.receita > 0 ? Math.round(A.resultado / A.receita * 100) : 0;
  return A;
}

function barras_(arr, fmt) {
  var mx = Math.max.apply(null, [1].concat(arr.map(function (a) { return a.n; })));
  return arr.map(function (a) { return { lbl: a.lbl, val: nb_(fmt(a.n)), pct: Math.max(2, Math.round(a.n / mx * 100)) }; });
}
function nCopos_(n) { return n + (n === 1 ? ' copo' : ' copos'); }

function desdeDoPeriodo_(dia, periodo) {
  if (periodo === 'hoje') return dia;
  if (periodo === '7d') { var d = new Date(dia + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - 6); return d.toISOString().slice(0, 10); }
  return null;
}
/* uma barra por produto e tamanho do copo: os atuais (mesmo sem venda) e os que só existem no histórico */
function produtosETamanhos_(db, A, vars, prods) {
  var itens = [], visto = {};
  function nome(vid, tam) { var v = db.achar('produto_variante', vid); return prods[v.produto_id].nome.replace('Café ', '') + ' ' + tam + ' ml'; }
  vars.forEach(function (v) { var k = v.id + '|' + v.tamanho_ml; visto[k] = true; itens.push({ lbl: nome(v.id, v.tamanho_ml), n: A.porProd[k] || 0 }); });
  Object.keys(A.porProd).forEach(function (k) { if (visto[k]) return; var p = k.split('|'); itens.push({ lbl: nome(p[0], p[1]), n: A.porProd[k] }); });
  return itens;
}

function viewPaineis_(db, ctx, sub, periodo) {
  var ts = ctx.agora.dataHora, desde = desdeDoPeriodo_(ctx.agora.diaLocal, periodo), A = agregados_(db, ts, desde), est = estadoSorteio_(db, ts), prods = mapa_(db, 'produto');
  var vars = db.t('produto_variante').filter(ativoOk_), us = A.us;
  var P = { tiles: [], t1: '', b1: [], t2: '', b2: [] };
  function T(l, v) { return { lbl: l, val: nb_(v) }; }
  var cu = null;
  if (sub === 'geral') {
    P = { tiles: [T('Faturamento dos cafés', fmtR_(A.fat)), T('Resultado', fmtR_(A.resultado)), T('Copos vendidos', String(A.copos)), T('Litros preparados', fmtN_(A.litros) + ' L')],
      t1: 'Mais vendidos', b1: barras_(produtosETamanhos_(db, A, vars, prods), nCopos_),
      t2: 'Faturamento por forma de pagamento', b2: barras_(Object.keys(A.porPag).map(function (k) { return { lbl: k, n: A.porPag[k] }; }), fmtR_) };
  } else if (sub === 'vendas') {
    var horas = Object.keys(A.porHora).sort();
    P = { tiles: [T('Vendas', String(A.nVendas)), T('Ticket médio', fmtR_(A.nVendas ? A.fat / A.nVendas : 0)), T('Copos', String(A.copos)), T('Café vendido', fmtN_(A.vendMl) + ' ml'), T('Descontos dados', fmtR_(A.desc) + (A.nDesc ? ' \u00B7 ' + A.nDesc + (A.nDesc === 1 ? ' venda' : ' vendas') : ''))],
      t1: 'Vendas por horário', b1: barras_(horas.map(function (h) { return { lbl: h + 'h', n: A.porHora[h] }; }), function (n) { return n + (n === 1 ? ' venda' : ' vendas'); }),
      t2: 'Copos por tamanho', b2: barras_(Object.keys(A.porTam).map(Number).concat(vars.map(function (v) { return v.tamanho_ml; }).filter(function (t, i, l) { return !A.porTam[t] && l.indexOf(t) === i; })).sort(function (a, b) { return a - b; }).map(function (ml) { return { lbl: ml + ' ml', n: A.porTam[ml] || 0 }; }), nCopos_) };
  } else if (sub === 'estoque') {
    var sal = saldosEstoque_(db), mats = db.t('material').filter(function (m) { return m.ativo && controla_(m); }), cafeId = materiaisChave_(db, ts).cafe;
    function totalMat(m) { return soma_(us, function (u) { return qtdEstoque_(sal, u.id, m.id); }); }
    var abaixo = mats.filter(function (m) { return totalMat(m) < m.estoque_minimo_qtd; }).length;
    P = { tiles: [T('Abaixo do mínimo', String(abaixo)), T('Materiais ativos', String(mats.length))].concat(us.slice(0, 2).map(function (u) { return T('Café \u2014 ' + u.nome, fmtN_(qtdEstoque_(sal, u.id, cafeId)) + ' g'); })),
      t1: 'Estoque total em relação ao mínimo', b1: mats.map(function (m) { var t = totalMat(m); return { lbl: m.nome, val: nb_(fmtN_(t) + ' ' + m.unidade), pct: Math.max(2, Math.min(100, m.estoque_minimo_qtd > 0 ? Math.round(t / (m.estoque_minimo_qtd * 2) * 100) : 100)) }; }),
      t2: 'Café em estoque por pessoa', b2: barras_(us.map(function (u) { return { lbl: u.nome, n: qtdEstoque_(sal, u.id, cafeId) }; }), function (n) { return fmtN_(n) + ' g'; }) };
  } else if (sub === 'compras') {
    var pcs = A.histCafe.map(function (h) { return h.pacote; });
    P = { tiles: [T('Gasto total', fmtR_(A.gasto)), T('Compras', String(A.nCompras)), T('Café: menor pacote', pcs.length ? fmtR_(Math.min.apply(null, pcs)) : '\u2014'), T('Café: maior pacote', pcs.length ? fmtR_(Math.max.apply(null, pcs)) : '\u2014')],
      t1: 'Gasto por local', b1: barras_(Object.keys(A.porLocal).map(function (k) { return { lbl: k, n: A.porLocal[k] }; }), fmtR_),
      t2: 'Café: preço do pacote de 500 g em cada compra', b2: barras_(A.histCafe.map(function (h) { return { lbl: h.dia + ' \u00B7 ' + h.forn, n: h.pacote }; }), fmtR_) };
  } else if (sub === 'producao') {
    P = { tiles: [T('Litros preparados', fmtN_(A.litros) + ' L'), T('Preparos', A.nPrep + (A.nPrepPend ? ' \u00B7 ' + A.nPrepPend + ' sem materiais' : '')), T('Café em pó usado', fmtN_(A.gCafe) + ' g'), T('Rendimento', A.gCafe ? fmtN_(A.prodMlLanc / A.gCafe) + ' ml/g' : '\u2014')],
      t1: 'Litros por pessoa e tipo', b1: barras_(us.map(function (u) { return { lbl: u.nome, n: A.litrosPess[u.id] }; }).concat([{ lbl: 'Café', n: A.litrosBase.CAFE }, { lbl: 'Café com leite', n: A.litrosBase.CAFE_LEITE }]), function (n) { return fmtN_(n) + ' L'; }),
      t2: 'Perdas e consumo próprio de café', b2: barras_(Object.keys(A.perdaMot).map(function (k) { return { lbl: k, n: A.perdaMot[k] }; }).concat(A.consumoMl > 0 ? [{ lbl: 'Consumo nosso (registrado na Venda)', n: A.consumoMl }] : []), function (n) { return fmtN_(n) + ' ml'; }) };
  } else if (sub === 'fin') {
    var invT = soma_(us, function (u) { return A.pess[u.id].invest; }), reT = soma_(us, function (u) { return A.pess[u.id].reemb; });
    var pc = function (i, r) { return i ? Math.round(r / i * 100) : 0; };
    P = { tiles: [T('Receita total', fmtR_(A.receita)), T('Custo (atual)', fmtR_(A.custoAt)), T('Despesas', fmtR_(A.despesas)), T('Margem', A.margem + '%')],
      t1: 'Payback (reembolsado ÷ investido)', b1: us.map(function (u) { var x = pc(A.pess[u.id].invest, A.pess[u.id].reemb); return { lbl: u.nome, val: x + '%', pct: Math.max(2, Math.min(100, x)) }; }).concat([{ lbl: 'Geral', val: pc(invT, reT) + '%', pct: Math.max(2, Math.min(100, pc(invT, reT))) }]),
      t2: 'Faturamento dos cafés atribuído a quem preparou', b2: barras_(us.map(function (u) { return { lbl: u.nome, n: A.prodMl > 0 ? A.fat * A.pess[u.id].ml / A.prodMl : 0 }; }), fmtR_) };
  } else {
    var rodadaDe = {}, porRodada = {};
    db.t('sorteio').forEach(function (s) { rodadaDe[s.id] = s.rodada; });
    est.validos.forEach(function (n) { var k = rodadaDe[n.sorteio_id] || '?'; porRodada[k] = (porRodada[k] || 0) + 1; });
    var pctMeta = Math.max(2, Math.min(100, Math.round(est.nAtivos / est.meta * 100)));
    P = { tiles: [T('Números vendidos (todos)', String(est.validos.length)), T('No sorteio atual', String(est.nAtivos)), T('Clientes cadastrados', String(db.t('cliente').length)), T('Receita dos números', fmtR_(soma_(est.validos, function (n) { return n.valor_centavos; })))],
      t1: 'Números vendidos por sorteio', b1: barras_(Object.keys(porRodada).sort(function (a, b) { return a - b; }).map(function (k) { return { lbl: 'Sorteio nº ' + k + (Number(k) === est.rodadaAtual ? ' (atual)' : ''), n: porRodada[k] }; }), function (n) { return n + (n === 1 ? ' número' : ' números'); }),
      t2: 'Progresso do sorteio atual', b2: [{ lbl: 'Sorteio nº ' + est.rodadaAtual, val: nb_(est.nAtivos + ' de ' + est.meta + ' números'), pct: pctMeta }] };
  }
  return { sub: sub, periodo: periodo, ignoraPeriodo: sub === 'estoque' || sub === 'sorteio', tiles: P.tiles, t1: P.t1, b1: P.b1, t2: P.t2, b2: P.b2 };
}

/* ---------------- Cadastros ---------------- */
function viewCadastros_(db, ctx, sub) {
  var ts = ctx.agora.dataHora, prods = mapa_(db, 'produto');
  if (sub === 'materiais') {
    var cu = custosUnitarios_(db);
    return { sub: sub, materiais: db.t('material').map(function (m) { return { id: m.id, nome: m.nome, un: m.unidade, min: m.estoque_minimo_qtd, pacote: m.pacote_qtd, preco: m.preco_padrao_centavos, passo: m.passo_qtd, ativo: m.ativo, controla: controla_(m), custoPadrao: cu[m.id].padrao }; }) };
  }
  if (sub === 'produtos') {
    var vars = db.t('produto_variante'), us = mapa_(db, 'usuario'), varMap = mapa_(db, 'produto_variante');
    var porVar = {}; db.t('preco_venda').forEach(function (p) { (porVar[p.variante_id] = porVar[p.variante_id] || []).push(p); });
    var hist = [];
    Object.keys(porVar).forEach(function (k) {
      var l = porVar[k].sort(function (a, b) { return a.vigente_de < b.vigente_de ? -1 : 1; }), v = varMap[k];
      for (var i = 1; i < l.length; i++) hist.push({ quando: l[i].vigente_de, txt: nb_(dm_(l[i].vigente_de) + ' \u00B7 ' + prods[v.produto_id].nome + ' ' + v.tamanho_ml + ' ml: ' + fmtR_(l[i - 1].preco_centavos) + ' \u2192 ' + fmtR_(l[i].preco_centavos) + ' \u00B7 ' + nomeDe_(us, l[i].criado_por)) });
    });
    hist.sort(function (a, b) { return a.quando < b.quando ? 1 : -1; });
    return { sub: sub, produtos: vars.map(function (v) { return { id: v.id, nome: prods[v.produto_id].nome, tamanho: v.tamanho_ml, preco: precoVigente_(db, v.id, ts), ativo: v.ativo }; }), historico: hist.slice(0, 12).map(function (h) { return h.txt; }) };
  }
  if (sub === 'receitas') {
    function fmtRec(r) { return { colheres: r.colheres_por_litro, gPorColher: r.g_por_colher, filtros: r.filtros_por_litro, acucar: r.acucar_g_por_litro, agua: r.agua_ml_por_litro, leite: r.leite_ml_por_litro || 0 }; }
    var escopos = [{ id: '', nome: 'Padrão da casa', propria: true, propriaLeite: true, receita: fmtRec(receitaVigente_(db, ts, null, 'CAFE')), receitaLeite: fmtRec(receitaVigente_(db, ts, null, 'CAFE_LEITE')) }].concat(db.t('usuario').filter(ativoOk_).map(function (u) { var r = receitaVigente_(db, ts, u.id, 'CAFE'), rl = receitaVigente_(db, ts, u.id, 'CAFE_LEITE'); return { id: u.id, nome: u.nome, propria: r.usuario_id === u.id, propriaLeite: rl.usuario_id === u.id, receita: fmtRec(r), receitaLeite: fmtRec(rl) }; }));
    return { sub: sub, escopos: escopos,
      copos: db.t('material').filter(function (m) { return m.ativo && m.unidade === 'un'; }).map(function (m) { return { id: m.id, nome: m.nome }; }),
      composicao: db.t('produto_variante').filter(ativoOk_).map(function (v) { var c = composicaoVigente_(db, v.id, ts); return { id: v.id, nome: prods[v.produto_id].nome, tamanho: v.tamanho_ml, canelaG: c.canela_g, cafeMl: v.tamanho_ml, copoId: c.copo_material_id }; }) };
  }
  if (sub === 'listas') {
    return { sub: sub, listas: [['fornecedor', 'Locais de compra'], ['forma_pagamento', 'Formas de pagamento'], ['motivo_perda', 'Motivos de perda de café']].map(function (x) {
      return { tabela: x[0], titulo: x[1], itens: db.t(x[0]).map(function (i) { return { id: i.id, nome: i.nome, ativo: i.ativo }; }) };
    }) };
  }
  return { sub: sub, promocoes: db.t('promocao').map(function (p) { return { id: p.id, nome: p.nome, desconto: p.desconto_pct, ativo: p.ativo }; }) };
}

/* ---------------- Financeiro ---------------- */
function viewFinanceiro_(db, ctx, sub) {
  var ts = ctx.agora.dataHora, A = agregados_(db, ts), us = A.us;
  if (sub === 'lanc') {
    var un = mapa_(db, 'usuario'), NOMES = { REEMBOLSO: 'Reembolso', APORTE: 'Aporte', DESPESA: 'Despesa' };
    return { sub: sub, usuarios: us.map(function (u) { return { id: u.id, nome: u.nome }; }), lista: db.t('lancamento_financeiro').filter(function (l) { return l.status === 'ATIVO'; }).reverse().slice(0, 40).map(function (l) { return { id: l.id, texto: nb_(NOMES[l.tipo] + ' ' + fmtR_(l.valor_centavos) + ' \u00B7 ' + nomeDe_(un, l.usuario_id)), meta: '#' + l.numero + ' \u00B7 ' + dm_(l.data_hora) + ' \u00B7 registrado por ' + nomeDe_(un, l.criado_por) }; }) };
  }
  var varPad = A.custoAt - A.custoPad;
  function mk(nome, inv, re) { var pc = inv > 0 ? Math.round(re / inv * 100) : 0; return { nome: nome, inv: fmtR_(inv), re: fmtR_(re), falta: fmtR_(Math.max(0, inv - re)), pctTxt: pc + '%', pct: Math.max(2, Math.min(100, pc)) }; }
  var invT = soma_(us, function (u) { return A.pess[u.id].invest; }), reT = soma_(us, function (u) { return A.pess[u.id].reemb; });
  return {
    sub: sub,
    tiles: [['Faturamento dos cafés', fmtR_(A.fat)], ['Receita dos números', fmtR_(A.fatSort)], ['Custo dos preparos', fmtR_(A.custoAt)], ['Variação vs padrão', (varPad > 0 ? '+' : '') + fmtR_(varPad)], ['Despesas', fmtR_(A.despesas)], ['Resultado', fmtR_(A.resultado)], ['Margem', A.margem + '%'], ['Copos vendidos', String(A.copos)]].map(function (x) { return { lbl: x[0], val: nb_(x[1]) }; }),
    payback: us.map(function (u) { return mk(u.nome, A.pess[u.id].invest, A.pess[u.id].reemb); }).concat([mk('Geral', invT, reT)]).map(function (r) { r.inv = nb_(r.inv); r.re = nb_(r.re); r.falta = nb_(r.falta); return r; }),
    atribuicao: us.map(function (u) { return { nome: u.nome, det: nb_(fmtN_(A.pess[u.id].ml / 1000) + ' L preparados'), val: nb_(fmtR_(A.prodMl > 0 ? A.fat * A.pess[u.id].ml / A.prodMl : 0)) }; })
  };
}

/* ---------------- Clientes e sorteio ---------------- */
function viewClientes_(db, ctx, sub, q) {
  var ts = ctx.agora.dataHora, est = estadoSorteio_(db, ts), ativosPor = {};
  est.ativos.forEach(function (n) { (ativosPor[n.cliente_id] = ativosPor[n.cliente_id] || []).push(n); });
  var nClientesComNum = Object.keys(ativosPor).length;
  if (sub === 'sorteio') {
    var cli = mapa_(db, 'cliente'), nqd = soDigitos_(q), achados = [], rodadaDe = {};
    db.t('sorteio').forEach(function (s) { rodadaDe[s.id] = s.rodada; });
    if (nqd.length >= 1 && nqd.length <= 4) {
      var id = parseInt(nqd, 10), tk = nqd.padStart(4, '0');
      achados = est.validos.filter(function (n) { return n.numero === id || n.token === tk; }).slice(0, 5).map(function (n) {
        var c = cli[n.cliente_id];
        return { titulo: 'N\u00BA ' + pad4_(n.numero) + ' \u00B7 c\u00F3digo ' + n.token, dono: c ? c.nome + ' \u00B7 ' + fmtTel_(c.telefone) : n.cliente_id, ativo: !!est.aberto && n.sorteio_id === est.aberto.id, rodada: rodadaDe[n.sorteio_id] || '?' };
      });
    }
    var us = mapa_(db, 'usuario'), enc = est.encerrados.slice().reverse();
    return {
      sub: sub, rodadaAtual: est.rodadaAtual, meta: est.meta, preco: est.preco, liberado: est.liberado, nAtivos: est.nAtivos, nClientes: nClientesComNum, conferir: achados, conferiu: nqd.length > 0,
      historico: enc.map(function (d, i) { return { id: d.id, texto: nb_('Sorteio n\u00BA ' + d.rodada + ' encerrado \u00B7 ' + d.qtd_numeros + (d.qtd_numeros === 1 ? ' n\u00FAmero' : ' n\u00FAmeros')), meta: dm_(d.encerrado_em) + ' \u00B7 por ' + nomeDe_(us, d.encerrado_por), podeDesfazer: i === 0 }; })
    };
  }
  var f = filtrarClientes_(db, q), base = f.ativa ? f.lista : db.t('cliente');
  var ord = base.slice().sort(function (a, b) { return a.nome.localeCompare(b.nome, 'pt-BR'); });
  return {
    sub: sub, total: db.t('cliente').length, comNumeros: nClientesComNum, mostrando: Math.min(ord.length, 60), encontrados: ord.length,
    clientes: ord.slice(0, 60).map(function (c) {
      return { id: c.id, codigo: c.codigo, nome: c.nome, telefone: fmtTel_(c.telefone), email: c.email, ativo: c.ativo, numeros: (ativosPor[c.id] || []).sort(function (a, b) { return a.numero - b.numero; }).map(function (n) { return { numero: n.numero, token: n.token }; }) };
    })
  };
}

/* ---------------- Histórico ---------------- */
function viewHistorico_(db, ctx) {
  var us = mapa_(db, 'usuario'), formas = mapa_(db, 'forma_pagamento'), forn = mapa_(db, 'fornecedor'), mats = mapa_(db, 'material'), mot = mapa_(db, 'motivo_perda');
  var ipv = itensPorVenda_(db), ci = {}; db.t('compra_item').forEach(function (i) { ci[i.compra_id] = i; });
  var est = {}; db.t('estorno').forEach(function (e) { est[e.tabela_origem + ':' + e.id_origem] = e; });
  var linhas = [];
  function push(tabela, r, tipo, resumo) {
    if (r.status === 'GRAVANDO') return;
    var e = est[tabela + ':' + r.id];
    linhas.push({ tabela: tabela, id: r.id, numero: r.numero || r.rodada, quando: r.data_hora, tipo: tipo, resumo: nb_(resumo), meta: dm_(r.data_hora) + ' \u00B7 ' + nomeDe_(us, r.usuario_id || r.criado_por), status: r.status, estornadoPor: e ? nomeDe_(us, e.usuario_id) : null, estornadoEm: e ? dm_(e.data_hora) : null });
  }
  db.t('venda').forEach(function (v) { push('venda', v, 'VENDA', textoVenda_(v, ipv) + ' \u00B7 ' + fmtR_(v.total_cafe_centavos + v.total_sorteio_centavos) + ' \u00B7 ' + nomeDe_(formas, v.forma_pagamento_id)); });
  db.t('preparo').forEach(function (p) { push('preparo', p, 'PREPARO', fmtN_(p.litros) + ' L de ' + (p.base === 'CAFE_LEITE' ? 'café com leite' : 'café') + ' preparados por ' + nomeDe_(us, p.usuario_id)); });
  db.t('compra').forEach(function (c) { var i = ci[c.id], m = i ? mats[i.material_id] : null; push('compra', c, 'COMPRA', (m ? m.nome + ' ' + fmtN_(i.qtd_base_qtd) + ' ' + m.unidade : 'Compra') + ' \u00B7 ' + fmtR_(c.valor_total_centavos) + ' \u00B7 ' + nomeDe_(forn, c.fornecedor_id)); });
  db.t('ajuste_cafe').forEach(function (a) { push('ajuste_cafe', a, a.tipo === 'PERDA' ? 'PERDA DE CAFÉ' : 'AJUSTE DE CAFÉ', a.tipo === 'PERDA' ? fmtN_(-a.ml_cafe) + ' ml \u00B7 ' + nomeDe_(mot, a.motivo_id) : '+' + fmtN_(a.ml_cafe) + ' ml de café \u00B7 preparo não lançado'); });
  db.t('ajuste_estoque').forEach(function (a) {
    var q = fmtN_(Math.abs(a.qtd)) + ' ' + (mats[a.material_id] ? mats[a.material_id].unidade : '') + ' de ' + nomeDe_(mats, a.material_id);
    push('ajuste_estoque', a, 'ESTOQUE', a.tipo === 'AJUSTE' ? 'Ajuste ' + (a.qtd > 0 ? '+' : '\u2212') + q + ' (' + nomeDe_(us, a.usuario_id) + ')' : a.tipo === 'PERDA' ? 'Perda de ' + q + ' (' + nomeDe_(us, a.usuario_id) + ')' : 'Transferência de ' + q + ': ' + nomeDe_(us, a.usuario_id) + ' \u2192 ' + nomeDe_(us, a.usuario_destino_id));
  });
  db.t('lancamento_financeiro').forEach(function (l) { push('lancamento_financeiro', l, 'FINANCEIRO', { REEMBOLSO: 'Reembolso', APORTE: 'Aporte', DESPESA: 'Despesa' }[l.tipo] + ' ' + fmtR_(l.valor_centavos) + ' \u00B7 ' + nomeDe_(us, l.usuario_id)); });
  db.t('consumo_proprio').forEach(function (c) { push('consumo_proprio', c, 'CONSUMO PRÓPRIO', c.copos + (c.copos === 1 ? ' copo' : ' copos') + ' tomado por ' + nomeDe_(us, c.consumidor_id) + ' \u00B7 ' + fmtN_(c.ml_cafe) + ' ml de café'); });
  db.t('sorteio').forEach(function (s) { if (s.status !== 'ENCERRADO') return; linhas.push({ tabela: 'sorteio', id: s.id, numero: s.rodada, quando: s.encerrado_em, tipo: 'NOVO SORTEIO', resumo: nb_('Sorteio nº ' + s.rodada + ' encerrado \u00B7 ' + s.qtd_numeros + (s.qtd_numeros === 1 ? ' número' : ' números')), meta: dm_(s.encerrado_em) + ' \u00B7 ' + nomeDe_(us, s.encerrado_por), status: 'ENCERRADO', estornadoPor: null, estornadoEm: null }); });
  linhas.sort(function (a, b) { return a.quando < b.quando ? 1 : a.quando > b.quando ? -1 : 0; });
  return { linhas: linhas.slice(0, 40) };
}

/* ---------------- Sistema ---------------- */
function viewSistema_(db, ctx) {
  return { versao: VERSAO_ESQUEMA, tabelas: esquema_().map(function (t) { return { nome: t.nome, grupo: t.grupo, linhas: db.contar(t.nome) }; }) };
}
