/**
 * Seguranca.gs — quem está usando o app.
 *
 * Não há senha nem PIN. Na primeira vez que o app abre num aparelho, a pessoa escolhe quem é
 * (Pedro ou Digo) e o aparelho lembra. O servidor só confere se essa pessoa existe e está ativa.
 *
 * Consequência: o LINK do app funciona como a chave. Quem tiver o link consegue usar o app.
 * Por isso o link deve ficar só com a dupla.
 */
function identificar_(db, usuarioId) {
  var u = usuarioId ? mapa_(db, 'usuario')[usuarioId] : null;
  if (!u || !u.ativo) return null;
  return { usuarioId: u.id };
}
