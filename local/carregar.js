'use strict';
/**
 * carregar.js — executa os arquivos src/*.gs num contexto isolado com o ambiente Google simulado.
 * Os arquivos entram em ordem alfabética (como no Apps Script), para pegar dependências de ordem de carga.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { criarAmbiente } = require('./planilha-local');

const RAIZ = path.join(__dirname, '..');
const SRC = path.join(RAIZ, 'src');

function lerFonte() {
  return fs.readdirSync(SRC).filter((f) => f.endsWith('.gs')).sort().map((f) => `// ===== ${f} =====\n` + fs.readFileSync(path.join(SRC, f), 'utf8')).join('\n');
}

function carregar(opc) {
  opc = opc || {};
  const amb = criarAmbiente(opc);
  const ctx = vm.createContext(Object.assign({ console }, amb.globais));
  vm.runInContext(lerFonte(), ctx, { filename: 'src.gs' });
  return { ctx, amb };
}

/* monta o HTML do app como o Apps Script faria (<?!= incluir('X') ?>) */
function montarHtml() {
  const lerHtml = (n) => fs.readFileSync(path.join(SRC, n + '.html'), 'utf8');
  return lerHtml('Index').replace(/<\?!=\s*incluir\('(\w+)'\)\s*\?>/g, (m, n) => lerHtml(n));
}

module.exports = { carregar, montarHtml, lerFonte, RAIZ };