# CoffeCommit — MVP 1

O sistema da cafeteria: compras, preparo do café, vendas, estoque de cada pessoa, fechamento do dia, financeiro, clientes e números do sorteio.

Tudo funciona **dentro do Google Planilhas**. A planilha é o banco de dados, e **só o app mexe nela** (ninguém digita direto). Mais para a frente os mesmos dados vão para o MySQL, e a planilha já está organizada no formato do MySQL para isso ser fácil.

## O que tem em cada pasta

| Pasta | Para que serve | Onde é usada |
|---|---|---|
| `src/` | **O sistema de verdade**: as regras, as telas e o que grava na planilha | Vai para o **Google** (Apps Script). Também fica no VS Code e no GitHub |
| `local/` | **Ferramentas de teste**: imitam o Google no seu computador, para você ver o sistema funcionando e rodar os testes sem mexer na planilha de verdade | Só no **VS Code**. Nunca vai para o Google |
| raiz (`README.md`, `package.json`, `.gitignore`) | Documentação e configuração do projeto | Só no **VS Code / GitHub** |

## `src/` — o sistema (vai para o Google)

Arquivos `.gs` são o "cérebro" (código que roda nos servidores do Google). Arquivos `.html` são a "cara" (a tela que aparece no celular).

| Arquivo | O que faz, em uma frase |
|---|---|
| `Esquema.gs` | **A lista de todas as tabelas** da planilha (31), com as colunas e os tipos. Dele saem as abas, a validação e o esquema do MySQL |
| `Core.gs` | **As regras do negócio**: o que acontece quando registra uma venda, um preparo, uma compra, uma perda, uma contagem de estoque, um desfazer, um novo sorteio… |
| `Views.gs` | **Monta os dados de cada tela** (o que a tela de Venda, Estoque, Painéis etc. precisa mostrar) |
| `Planilha.gs` | **Lê e grava na planilha** e cria as 33 abas na instalação |
| `Seguranca.gs` | Diz quem está usando o app (sem senha: a pessoa escolhe quem é na primeira vez) |
| `Exemplos.gs` | Cria **dados de exemplo** para você testar (compras, vendas, clientes) |
| `Auditoria.gs` | **Confere se os dados estão certos**, gera o esquema do MySQL e exporta CSV |
| `Codigo.gs` | **A porta de entrada**: abre o app, recebe os pedidos do celular, cria o menu "CoffeCommit" na planilha |
| `Index.html`, `Estilo.html`, `App.html` | **A tela do app**: estrutura, visual (cores, tamanhos) e comportamento (botões, buscas) |
| `appsscript.json` | Configuração do projeto no Google (fuso de Salvador, permissões) |

## `local/` — ferramentas de teste (só no VS Code)

| Arquivo | O que faz |
|---|---|
| `servidor.js` | Abre o app no seu computador, em `http://localhost:3000`, com uma planilha de mentira |
| `teste.js` | Roda **369 verificações automáticas** das regras (venda, estoque, desfazer, sorteio por rodadas, receita por pessoa, painéis conferidos contra os registros, auditoria…) |
| `planilha-local.js` | A planilha de mentira em si (imita o Google Planilhas) |
| `carregar.js` | Carrega os arquivos de `src/` dentro da planilha de mentira |

## Como o sistema pensa (regras em português)

- **Nada é apagado.** "Desfazer" cria um estorno, e o registro continua aparecendo, riscado.
- **Estoque é de quem preparou.** Quando alguém registra um preparo, o café, filtro, água, leite, canela e copos saem do estoque **dessa pessoa**. A venda **não** mexe no estoque de material.
- **Café pronto do dia** = o que foi preparado − o que foi vendido − o que foi perdido. O dia só fecha quando isso dá zero.
- **Vender acima do que foi preparado** é permitido, com aviso. Para fechar o dia, lança-se o preparo que faltou ou faz-se um ajuste.
- **Preço e custo ficam gravados no momento.** Mudar o preço depois não altera vendas antigas, e o preço antigo fica no histórico.
- **Estoque nunca fica negativo.** O sistema recusa o que deixaria negativo.
- **Sorteio por rodadas**: existe sempre um sorteio ABERTO, e cada número vendido guarda o `sorteio_id` do sorteio em que foi vendido. O progresso conta os **números** vendidos nesse sorteio (por exemplo, 44 de 40). "Novo sorteio" encerra o aberto (os números ficam guardados nele) e abre outro, do zero; os clientes ficam. Dá para reabrir o último sorteio encerrado, desde que o atual ainda não tenha vendido números. Cada número tem um código de 4 dígitos que não se repete, e a numeração nunca é reaproveitada. Uma venda aceita até 99 números.
- **Receita por pessoa**: existe a receita da casa e, se quiser, a receita própria de cada pessoa (por exemplo, sem filtro de papel e com açúcar). Quem prepara usa a própria, se tiver; senão, a da casa. Preparos antigos guardam a receita da época.
- **Preparo editável**: na hora de registrar, dá para ajustar a quantidade de qualquer material ou acrescentar outro (açúcar, por exemplo). O sistema guarda o que a receita mandava (`qtd_padrao`) e o que foi usado de verdade (`qtd_real`); estoque e custo seguem o real.
- **Estoque**: além de ajustar e transferir, dá para "contar o estoque" (digitar quanto tem agora; o sistema lança a diferença) e desfazer cada movimento.
- **Compra**: valores e quantidades podem ser digitados; uma compra pode ser corrigida (entra a nova e a antiga é desfeita, conferindo o estoque pelo saldo líquido); locais de compra, formas de pagamento e motivos de perda são listas editáveis em Cadastros.
- **Painéis**: todos os números vêm dos registros (nada é fixo) e podem ser vistos por período: hoje, 7 dias ou tudo. Os painéis de situação (estoque e sorteio) e o payback não dependem do período.
- **Clientes**: só nome, telefone e e-mail. Na tela de Venda aparecem no máximo 3 resultados da busca, com telefone escondido; a lista completa fica na tela Clientes.
- **Registro repetido não duplica**: se o celular reenviar a mesma venda por falha de internet, o sistema reconhece e não grava de novo.

## Acesso

Sem senha e sem PIN. Na primeira vez que o app abre em um aparelho, a pessoa toca no próprio nome (Pedro ou Digo), e o aparelho lembra. O botão **Trocar** no topo muda a pessoa.

Isso significa que **o link do app é a chave**: quem tiver o link consegue usar o app. Mantenha o link só com a dupla. A planilha em si fica compartilhada só com o dono.

## Limites conhecidos

- Os arquivos foram testados no ambiente de teste (`local/`) e no navegador, mas **ainda não rodaram no Google de verdade**. Na primeira instalação pode aparecer algum ajuste (permissões, proteção das abas, rotina noturna).
- Sem internet, a ação não é feita e o app avisa; o toque pode ser repetido sem duplicar.
- As promoções estão cadastradas, mas ainda não são aplicadas nas vendas.
- A carga para o MySQL ainda não foi feita; o esquema (`CREATE TABLE`) e os CSVs já saem prontos pelo menu da planilha.
