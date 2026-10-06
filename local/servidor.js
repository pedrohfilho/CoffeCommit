'use strict';
/**
 * servidor.js — roda o app no computador com a planilha simulada.
 *
 *   node local/servidor.js                 usa os dados salvos (ou cria do zero)
 *   node local/servidor.js --exemplos      cria do zero já com dados de exemplo
 *   node local/servidor.js --limpo         apaga os dados salvos e recria
 *   node local/servidor.js --porta=4000
 *   node local/servidor.js --agora=2026-10-05T13:00:00Z   relógio fixo (para testar virada de dia)
 *
 * Sem PIN: na primeira abertura escolhe-se Pedro ou Digo. Os dados ficam em local/dados.json (não vai para o Git).
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const { carregar, montarHtml } = require('./carregar');

const args = process.argv.slice(2);
const flag = (n) => args.some((a) => a === '--' + n);
const valor = (n) => { const a = args.find((x) => x.startsWith('--' + n + '=')); return a ? a.split('=')[1] : null; };
const ARQ = path.join(__dirname, 'dados.json');
const PORTA = Number(valor('porta') || process.env.PORT || 3000);

if (flag('limpo') && fs.existsSync(ARQ)) fs.unlinkSync(ARQ);
const { ctx, amb } = carregar();

if (valor('agora')) {
  const base = new Date(valor('agora')).getTime();
  ctx.AGORA_TESTE = () => { const d = new Date(base); return { dataHora: d.toISOString(), diaLocal: ctx.Utilities.formatDate(d, 'America/Bahia', 'yyyy-MM-dd') }; };
}

function salvar() { fs.writeFileSync(ARQ, JSON.stringify({ planilha: amb.planilha.exportar(), props: amb.props })); }

if (fs.existsSync(ARQ)) {
  const d = JSON.parse(fs.readFileSync(ARQ, 'utf8'));
  amb.planilha.importar(d.planilha); Object.assign(amb.props, d.props);
  console.log('Dados carregados de local/dados.json');
} else {
  ctx.PropertiesService.getScriptProperties().setProperty('PLANILHA_ID', amb.planilha.getId());
  const agora = ctx.agora_();
  ctx.instalarPlanilha_(amb.planilha, agora.dataHora);
  if (flag('exemplos')) { ctx.carregarExemplos_(amb.planilha, agora); console.log('Dados de exemplo carregados.'); }
  salvar();
  console.log('Planilha simulada criada.');
}

const ESCRITAS = new Set(Object.keys(ctx.rotas_()));
const servidor = http.createServer((req, res) => {
  if (req.method === 'GET' && (req.url === '/' || req.url.startsWith('/?'))) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(montarHtml());
  }
  if (req.method === 'POST' && req.url === '/api') {
    let corpo = '';
    req.on('data', (c) => (corpo += c));
    req.on('end', () => {
      try {
        const { uid, nome, p } = JSON.parse(corpo || '{}');
        const r = ctx.api(uid || null, nome, JSON.stringify(p || {}));
        if (ESCRITAS.has(nome)) salvar();
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(r);
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, erro: 'Erro no servidor local: ' + e.message }));
      }
    });
    return;
  }
  res.writeHead(404); res.end('Não encontrado');
});
servidor.listen(PORTA, () => console.log('CoffeCommit local em http://localhost:' + PORTA));