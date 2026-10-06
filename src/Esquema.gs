/**
 * Esquema.gs — FONTE ÚNICA do modelo de dados do CoffeCommit.
 *
 * Daqui saem: as abas da planilha, os formatos de coluna, as listas de validação,
 * o dicionário de dados (_esquema), a auditoria e o DDL do MySQL.
 *
 * Sintaxe de coluna:  nome:tipo[flags]
 *   tipos : id, texto, int, cent, qtd, dt, dia, bool, enum(A|B|C)
 *   flags : *  chave primária   #  valor único   ?  pode ficar vazio   >tabela  chave estrangeira
 */
var VERSAO_ESQUEMA = 1;
/* sobe quando a instalação passa a fazer algo novo (ex.: formatar as linhas). O app recusa trabalhar até rodar "Instalar / atualizar". */
var VERSAO_INSTALACAO_ = 8;
var INICIO_VIGENCIA = '2000-01-01T00:00:00.000Z';

var AUDITORIA_ = 'criado_em:dt, criado_por:id>usuario, atualizado_em:dt?, atualizado_por:id>usuario?, versao:int';
var STATUS_ = 'enum(GRAVANDO|ATIVO|ESTORNADO)';

// [nome, grupo, descrição, colunas, com auditoria, colunas extras depois da auditoria (migração só acrescenta no fim)]
var DEF_ESQUEMA_ = [
  ['usuario', 'cadastro', 'Pessoas que usam o sistema', 'id:id*, nome:texto#, email_google:texto?, ativo:bool', 1],
  ['material', 'cadastro', 'Materiais e insumos. Todas as quantidades na unidade base (g, ml ou un)', 'id:id*, codigo:texto#, nome:texto#, unidade:enum(g|ml|un), estoque_minimo_qtd:qtd, pacote_qtd:qtd, preco_padrao_centavos:cent, passo_qtd:qtd, ativo:bool', 1, 'controla_estoque:bool'],
  ['produto', 'cadastro', 'Produtos vendidos (conceito: café normal, com canela, com leite)', 'id:id*, nome:texto#, categoria:texto, ativo:bool', 1],
  ['produto_variante', 'cadastro', 'Produto + tamanho (o que realmente se vende)', 'id:id*, produto_id:id>produto, tamanho_ml:int, ativo:bool', 1],
  ['preco_venda', 'cadastro', 'Preço de venda por vigência (nunca se altera: cria linha nova)', 'id:id*, variante_id:id>produto_variante, preco_centavos:cent, vigente_de:dt, vigente_ate:dt?, criado_em:dt, criado_por:id>usuario', 0],
  ['composicao_copo', 'cadastro', 'O que vai em cada copo (canela e qual copo), por vigência. leite_ml é legado e fica em 0: o café com leite já vem misturado no preparo', 'id:id*, variante_id:id>produto_variante, leite_ml:qtd, canela_g:qtd, copo_material_id:id>material, vigente_de:dt, vigente_ate:dt?', 1],
  ['receita_cafe', 'cadastro', 'Receita do café (por litro), por vigência e por tipo (CAFE ou CAFE_LEITE: o leite entra no preparo, não no copo). Sem pessoa = padrão da casa; com pessoa = receita própria de quem prepara', 'id:id*, usuario_id:id>usuario?, colheres_por_litro:qtd, g_por_colher:qtd, filtros_por_litro:qtd, acucar_g_por_litro:qtd, agua_ml_por_litro:qtd, vigente_de:dt, vigente_ate:dt?', 1, 'base:enum(CAFE|CAFE_LEITE), leite_ml_por_litro:qtd'],
  ['fornecedor', 'cadastro', 'Onde as compras são feitas', 'id:id*, nome:texto#, ativo:bool', 1],
  ['forma_pagamento', 'cadastro', 'Formas de pagamento', 'id:id*, nome:texto#, ativo:bool', 1],
  ['motivo_perda', 'cadastro', 'Motivos de perda de café', 'id:id*, nome:texto#, ativo:bool', 1],
  ['cliente', 'cadastro', 'Clientes que participam do sorteio (dados mínimos)', 'id:id*, codigo:texto#, nome:texto, telefone:texto#, email:texto#, consentimento_em:dt?, origem:enum(REAL|EXEMPLO), ativo:bool', 1],
  ['config', 'cadastro', 'Configurações com vigência (sorteio, materiais-chave)', 'id:id*, chave:texto, valor:texto, vigente_de:dt, vigente_ate:dt?, criado_em:dt, criado_por:id>usuario', 0],
  ['promocao', 'cadastro', 'Promoções (cadastro reservado; ainda não aplicadas nas vendas)', 'id:id*, nome:texto, desconto_pct:qtd, ativo:bool', 1],

  ['compra', 'movimento', 'Compras de material. Cada compra entra no estoque de quem comprou', 'id:id*, numero:int#, usuario_id:id>usuario, fornecedor_id:id>fornecedor, data_hora:dt, dia_local:dia, valor_total_centavos:cent, observacao:texto?, status:' + STATUS_, 1],
  ['compra_item', 'movimento', 'Itens da compra', 'id:id*, compra_id:id>compra, material_id:id>material, embalagens:int, qtd_base_qtd:qtd, valor_centavos:cent', 0],
  ['preparo', 'movimento', 'Preparos na cafeteira. O consumo sai do estoque de quem preparou', 'id:id*, numero:int#, usuario_id:id>usuario, registrado_por:id>usuario, data_hora:dt, dia_local:dia, litros:qtd, ml_cafe:qtd, receita_id:id>receita_cafe, status:' + STATUS_, 1, 'materiais_status:enum(PENDENTE|LANCADO), base:enum(CAFE|CAFE_LEITE)'],
  ['preparo_consumo', 'movimento', 'Materiais consumidos por preparo (padrão x real) com custo gravado', 'id:id*, preparo_id:id>preparo, material_id:id>material, qtd_padrao_qtd:qtd, qtd_real_qtd:qtd, custo_atual_centavos:cent, custo_padrao_centavos:cent', 0],
  ['preparo_plano', 'movimento', 'Copos que se pretende servir em cada preparo', 'id:id*, preparo_id:id>preparo, variante_id:id>produto_variante, copos:int', 0],
  ['venda', 'movimento', 'Vendas. total_cafe_centavos é o valor cobrado do café (já com o desconto manual, se houve). Não mexem no estoque de material, só no café pronto do dia', 'id:id*, numero:int#, usuario_id:id>usuario, data_hora:dt, dia_local:dia, forma_pagamento_id:id>forma_pagamento, cliente_id:id>cliente?, copos:int, ml_cafe:qtd, total_cafe_centavos:cent, total_sorteio_centavos:cent, status:' + STATUS_, 1, 'desconto_centavos:cent, promocao_id:id>promocao?'],
  ['venda_item', 'movimento', 'Itens da venda, com preço, café e tamanho do copo gravados no momento', 'id:id*, venda_id:id>venda, variante_id:id>produto_variante, qtd:int, preco_unit_centavos:cent, ml_cafe_unit:qtd', 0, 'tamanho_ml:int'],
  ['consumo_proprio', 'movimento', 'Café tomado por nós, registrado na hora. Sai do café pronto, não é venda e não tem cobrança', 'id:id*, numero:int#, usuario_id:id>usuario, consumidor_id:id>usuario, data_hora:dt, dia_local:dia, copos:int, ml_cafe:qtd, observacao:texto?, status:' + STATUS_, 1],
  ['consumo_proprio_item', 'movimento', 'Itens do consumo próprio, com o café e o tamanho do copo gravados no momento', 'id:id*, consumo_id:id>consumo_proprio, variante_id:id>produto_variante, qtd:int, ml_cafe_unit:qtd, tamanho_ml:int', 0],
  ['ajuste_cafe', 'movimento', 'Perdas e acertos de café pronto', 'id:id*, numero:int#, usuario_id:id>usuario, data_hora:dt, dia_local:dia, tipo:enum(PERDA|ACERTO), ml_cafe:qtd, motivo_id:id>motivo_perda?, observacao:texto?, status:' + STATUS_, 1],
  ['ajuste_estoque', 'movimento', 'Ajustes, perdas de material e transferências entre pessoas', 'id:id*, numero:int#, tipo:enum(AJUSTE|PERDA|TRANSFERENCIA), material_id:id>material, usuario_id:id>usuario, usuario_destino_id:id>usuario?, qtd:qtd, motivo:texto?, data_hora:dt, dia_local:dia, status:' + STATUS_, 1],
  ['lancamento_financeiro', 'movimento', 'Aportes, reembolsos e despesas', 'id:id*, numero:int#, tipo:enum(APORTE|REEMBOLSO|DESPESA), usuario_id:id>usuario, valor_centavos:cent, descricao:texto?, data_hora:dt, dia_local:dia, status:' + STATUS_, 1],
  ['numero_sorteio', 'movimento', 'Números do sorteio vendidos (nunca reaproveitados). Cada número pertence ao sorteio aberto na hora da venda', 'id:id*, numero:int#, token:texto#, cliente_id:id>cliente, venda_id:id>venda, sorteio_id:id>sorteio, valor_centavos:cent, criado_em:dt, status:enum(ATIVO|ESTORNADO)', 0],
  ['sorteio', 'movimento', 'Sorteios (rodadas). Só um fica ABERTO; os números vendidos entram no aberto. Novo sorteio encerra o aberto e abre outro', 'id:id*, rodada:int#, status:enum(ABERTO|ENCERRADO|CANCELADO), meta_numeros:int, qtd_numeros:int, aberto_em:dt, encerrado_em:dt?, encerrado_por:id>usuario?', 1],
  ['fechamento_dia', 'movimento', 'Fechamento e reabertura do dia (vale a última linha de cada dia)', 'id:id*, dia_local:dia, status:enum(FECHADO|REABERTO), saldo_ml:qtd, usuario_id:id>usuario, data_hora:dt', 0],

  ['movimento_estoque', 'livro', 'Livro de movimentação do estoque de material. Gerado pelo sistema', 'id:id*, usuario_id:id>usuario, material_id:id>material, tipo:enum(COMPRA|PREPARO|AJUSTE|PERDA|TRANSF_SAIDA|TRANSF_ENTRADA|ESTORNO), qtd:qtd, data_hora:dt, dia_local:dia, origem_tabela:texto, origem_id:id, estorno_de_id:id?', 0],
  ['movimento_cafe', 'livro', 'Livro do café pronto, em ml. Gerado pelo sistema', 'id:id*, tipo:enum(PREPARO|VENDA|PERDA|ACERTO|CONSUMO|ESTORNO), ml_cafe:qtd, data_hora:dt, dia_local:dia, origem_tabela:texto, origem_id:id, estorno_de_id:id?', 0],

  ['estorno', 'controle', 'Registro de cada desfazer', 'id:id*, tabela_origem:texto, id_origem:id, motivo:texto?, usuario_id:id>usuario, data_hora:dt', 0],
  ['sequencia', 'controle', 'Contadores dos números sequenciais', 'tabela:texto*, ultimo:int', 0],
  ['log_sistema', 'controle', 'Registro das gravações e erros', 'id:id*, data_hora:dt, usuario_id:id?, acao:texto, tabela:texto?, id_registro:id?, resultado:enum(OK|ERRO), detalhe:texto?', 0]
];

var CORES_GRUPO_ = { cadastro: '#4F7CAC', movimento: '#C97B4A', livro: '#6B8E5A', controle: '#8A8A8A', meta: '#444444' };

/* ---------- leitura do esquema ---------- */
function colunas_(spec) {
  return spec.split(/\s*,\s*/).map(function (s) {
    var m = /^(\w+):(enum\([^)]*\)|\w+)((?:[*#?]|>\w+)*)$/.exec(s.trim());
    if (!m) throw new Error('Esquema inválido: ' + s);
    var flags = m[3];
    var fk = /> *(\w+)/.exec(flags);
    var ehEnum = m[2].indexOf('enum(') === 0;
    return {
      nome: m[1],
      tipo: ehEnum ? 'enum' : m[2],
      valores: ehEnum ? m[2].slice(5, -1).split('|') : null,
      pk: flags.indexOf('*') >= 0,
      unico: flags.indexOf('#') >= 0,
      nulo: flags.indexOf('?') >= 0,
      fk: fk ? fk[1] : null
    };
  });
}

function esquema_() {
  if (esquema_.cache) return esquema_.cache;
  var lista = DEF_ESQUEMA_.map(function (d) {
    var cols = colunas_(d[3]).concat(d[4] ? colunas_(AUDITORIA_) : []).concat(d[5] ? colunas_(d[5]) : []);
    var pk = cols.filter(function (c) { return c.pk; })[0];
    return { nome: d[0], grupo: d[1], desc: d[2], colunas: cols, pk: pk ? pk.nome : 'id', auditoria: !!d[4] };
  });
  esquema_.cache = lista;
  return lista;
}

function esquemaTabela_(nome) {
  var l = esquema_();
  for (var i = 0; i < l.length; i++) if (l[i].nome === nome) return l[i];
  throw new Error('Tabela fora do esquema: ' + nome);
}

/* ---------- dados iniciais dos cadastros ---------- */
function sementes_(agora) {
  var aud = { criado_em: agora, criado_por: 'usr-sistema', atualizado_em: null, atualizado_por: null, versao: 1 };
  function c(o) { return Object.assign({}, aud, o); }
  var v0 = INICIO_VIGENCIA;
  var S = {};
  S.usuario = [
    c({ id: 'usr-sistema', nome: 'Sistema', email_google: null, ativo: false }),
    c({ id: 'usr-pedro', nome: 'Pedro', email_google: null, ativo: true }),
    c({ id: 'usr-digo', nome: 'Digo', email_google: null, ativo: true })
  ];
  S.material = [
    ['mat-cafe', 'CAFE', 'Café em pó', 'g', 500, 500, 2700, 50],
    ['mat-filtro', 'FILTRO', 'Filtro de papel', 'un', 10, 30, 900, 1],
    ['mat-agua', 'AGUA', 'Água', 'ml', 0, 20000, 0, 500],
    ['mat-leite', 'LEITE', 'Leite', 'ml', 1000, 1000, 550, 100],
    ['mat-canela', 'CANELA', 'Canela em pó', 'g', 10, 50, 800, 5],
    ['mat-acucar', 'ACUCAR', 'Açúcar', 'g', 500, 1000, 450, 50],
    ['mat-copo50', 'COPO50', 'Copo 50 ml', 'un', 20, 50, 1000, 1],
    ['mat-copo200', 'COPO200', 'Copo 200 ml (serve 100 ml)', 'un', 20, 50, 1500, 1]
  ].map(function (m) { return c({ id: m[0], codigo: m[1], nome: m[2], unidade: m[3], estoque_minimo_qtd: m[4], pacote_qtd: m[5], preco_padrao_centavos: m[6], passo_qtd: m[7], ativo: true, controla_estoque: m[0] !== 'mat-agua' }); });
  S.produto = [
    c({ id: 'prd-normal', nome: 'Café normal', categoria: 'CAFE', ativo: true }),
    c({ id: 'prd-canela', nome: 'Café com canela', categoria: 'CAFE', ativo: true }),
    c({ id: 'prd-leite', nome: 'Café com leite', categoria: 'CAFE', ativo: true })
  ];
  var VARS = [
    ['var-n50', 'prd-normal', 50, 100, 0, 0, 'mat-copo50'], ['var-n100', 'prd-normal', 100, 150, 0, 0, 'mat-copo200'],
    ['var-c50', 'prd-canela', 50, 150, 0, 0.5, 'mat-copo50'], ['var-c100', 'prd-canela', 100, 200, 0, 1, 'mat-copo200'],
    ['var-l50', 'prd-leite', 50, 200, 0, 0, 'mat-copo50'], ['var-l100', 'prd-leite', 100, 250, 0, 0, 'mat-copo200']
  ];
  S.produto_variante = VARS.map(function (v) { return c({ id: v[0], produto_id: v[1], tamanho_ml: v[2], ativo: true }); });
  S.preco_venda = VARS.map(function (v) { return { id: 'pv-' + v[0].slice(4), variante_id: v[0], preco_centavos: v[3], vigente_de: v0, vigente_ate: null, criado_em: agora, criado_por: 'usr-sistema' }; });
  S.composicao_copo = VARS.map(function (v) { return c({ id: 'cc-' + v[0].slice(4), variante_id: v[0], leite_ml: v[4], canela_g: v[5], copo_material_id: v[6], vigente_de: v0, vigente_ate: null }); });
  S.receita_cafe = [
    c({ id: 'rec-1', usuario_id: null, colheres_por_litro: 4, g_por_colher: 7, filtros_por_litro: 1, acucar_g_por_litro: 0, agua_ml_por_litro: 1000, vigente_de: v0, vigente_ate: null, base: 'CAFE', leite_ml_por_litro: 0 }),
    c({ id: 'rec-2', usuario_id: null, colheres_por_litro: 4, g_por_colher: 7, filtros_por_litro: 1, acucar_g_por_litro: 0, agua_ml_por_litro: 600, vigente_de: v0, vigente_ate: null, base: 'CAFE_LEITE', leite_ml_por_litro: 400 })
  ];
  S.fornecedor = [c({ id: 'for-a', nome: 'Mercado A', ativo: true }), c({ id: 'for-b', nome: 'Mercado B', ativo: true }), c({ id: 'for-o', nome: 'Outro', ativo: true })];
  S.forma_pagamento = [c({ id: 'fp-dinheiro', nome: 'Dinheiro', ativo: true }), c({ id: 'fp-pix', nome: 'Pix', ativo: true }), c({ id: 'fp-cartao', nome: 'Cartão', ativo: true })];
  S.motivo_perda = [c({ id: 'mp-sobra', nome: 'Sobra', ativo: true }), c({ id: 'mp-derramou', nome: 'Derramou', ativo: true }), c({ id: 'mp-proprio', nome: 'Consumo próprio', ativo: true }), c({ id: 'mp-estragou', nome: 'Estragou', ativo: true })];
  var cfg = [
    ['sorteio.meta_numeros', '40'], ['sorteio.preco_numero_centavos', '100'],
    ['material.cafe', 'mat-cafe'], ['material.filtro', 'mat-filtro'], ['material.agua', 'mat-agua'], ['material.leite', 'mat-leite'], ['material.canela', 'mat-canela'], ['material.acucar', 'mat-acucar']
  ];
  S.config = cfg.map(function (k, i) { return { id: 'cfg-' + (i + 1), chave: k[0], valor: k[1], vigente_de: v0, vigente_ate: null, criado_em: agora, criado_por: 'usr-sistema' }; });
  S.promocao = [c({ id: 'promo-1', nome: 'Combo 2 cafés 100 ml', desconto_pct: 10, ativo: false })];
  S.sorteio = [c({ id: 'sort-1', rodada: 1, status: 'ABERTO', meta_numeros: 40, qtd_numeros: 0, aberto_em: agora, encerrado_em: null, encerrado_por: null })];
  S.sequencia = [{ tabela: 'sorteio', ultimo: 1 }];
  return S;
}

/* ---------- tipos do MySQL (usado pelo gerador de DDL e pelo dicionário) ---------- */
function tipoMySQL_(col) {
  switch (col.tipo) {
    case 'id': return 'CHAR(36)';
    case 'texto': return (col.nome === 'email' || col.nome === 'observacao' || col.nome === 'detalhe' || col.nome === 'descricao') ? 'VARCHAR(255)' : 'VARCHAR(120)';
    case 'int': return 'INT';
    case 'cent': return 'BIGINT';
    case 'qtd': return 'DECIMAL(14,3)';
    case 'dt': return 'DATETIME(3)';
    case 'dia': return 'DATE';
    case 'bool': return 'TINYINT(1)';
    case 'enum': return 'ENUM(' + col.valores.map(function (v) { return "'" + v + "'"; }).join(',') + ')';
  }
  throw new Error('Tipo desconhecido: ' + col.tipo);
}
