/**
 * Exemplos.gs — dados de exemplo para testar o sistema antes do uso real.
 * Passa pelos mesmos comandos do app (nada é inserido "por fora"), então o que aparece é o que o sistema geraria.
 * Os clientes de exemplo ficam marcados com origem EXEMPLO e saem no "Zerar movimentos".
 */
function carregarExemplos_(ss, agoraBase) {
  limparCache_();
  var db = new Banco(ss, { semCache: true });
  if (db.t('compra').length || db.t('venda').length || db.t('preparo').length) throw new Error('A planilha já tem movimentos. Zere antes de carregar os exemplos.');
  var P = 'usr-pedro', D = 'usr-digo', hoje = agoraBase.diaLocal;
  function ctx(uid, dia, hora) { return { usuarioId: uid, agora: { dataHora: dia + 'T' + hora + ':00.000Z', diaLocal: dia }, semFechamento: true }; }
  function compra(uid, dia, hora, mat, emb, valor, forn) { cmdCompra_(db, ctx(uid, dia, hora), { id: Utilities.getUuid(), material_id: mat, embalagens: emb, valor_centavos: valor, fornecedor_id: forn }); }

  cmdClienteSalvar_(db, ctx(P, hoje, '10:00'), { novo_id: 'cli-maria-exemplo', nome: 'Maria (exemplo)', telefone: '71900000001', email: 'maria.exemplo@gmail.com' });
  cmdClienteSalvar_(db, ctx(P, hoje, '10:00'), { novo_id: 'cli-joao-exemplo', nome: 'João (exemplo)', telefone: '71900000002', email: 'joao.exemplo@gmail.com' });

  compra(P, '2026-09-10', '13:05', 'mat-cafe', 1, 2500, 'for-a');
  compra(D, '2026-09-18', '20:40', 'mat-cafe', 1, 2900, 'for-b');
  compra(P, '2026-09-27', '12:30', 'mat-cafe', 1, 2600, 'for-a');
  compra(P, '2026-09-27', '12:36', 'mat-filtro', 1, 900, 'for-a');
  compra(P, '2026-09-27', '12:41', 'mat-leite', 4, 2200, 'for-a');
  compra(P, '2026-09-27', '12:43', 'mat-canela', 1, 800, 'for-a');
  compra(P, '2026-09-27', '12:45', 'mat-copo50', 1, 1000, 'for-a');
  compra(P, '2026-09-27', '12:46', 'mat-copo200', 1, 1500, 'for-a');
  compra(D, '2026-09-28', '21:10', 'mat-acucar', 1, 450, 'for-b');
  compra(D, '2026-09-28', '21:12', 'mat-leite', 2, 1100, 'for-b');
  compra(D, '2026-09-28', '21:14', 'mat-filtro', 1, 900, 'for-b');

  cmdPreparo_(db, ctx(P, hoje, '10:40'), { id: Utilities.getUuid(), litros: 1.5, quem: P, plano: { 'var-n100': 4, 'var-n50': 6, 'var-l100': 2, 'var-l50': 3, 'var-c100': 2, 'var-c50': 4 } });

  function venda(uid, hora, itens, forma, sorteio) { cmdVenda_(db, ctx(uid, hoje, hora), { id: Utilities.getUuid(), itens: itens, forma_pagamento_id: forma, sorteio: sorteio || null }); }
  venda(P, '11:05', { 'var-n50': 1 }, 'fp-dinheiro');
  venda(D, '11:20', { 'var-n100': 1, 'var-l50': 1 }, 'fp-pix', { cliente_id: 'cli-maria-exemplo', n: 3, tokens: ['0453', '0304', '0545'] });
  venda(P, '11:41', { 'var-l100': 1 }, 'fp-dinheiro');
  venda(P, '12:15', { 'var-c50': 1, 'var-n50': 1 }, 'fp-dinheiro');
  venda(D, '12:30', { 'var-c100': 1 }, 'fp-pix', { cliente_id: 'cli-joao-exemplo', n: 1, tokens: ['0812'] });
  limparCache_();
  return true;
}
