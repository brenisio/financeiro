# Financeiro pessoal do Breno

Página estática (`index.html`, sem build) publicada no GitHub Pages: https://brenisio.github.io/financeiro/
Repo: github.com/brenisio/financeiro (conta pessoal; usar `GH_TOKEN=$(gh auth token --user brenisio)`, porque o gh ativo é o da Econodata).

## Estrutura e testes

- `index.html` (HTML + CSS) · `js/logica.js` (regras puras: datas, valores, backup, somas, recorrência) · `js/app.js` (DOM, localStorage, import/export).
- `ferramentas/fin.py` edita o backup pela linha de comando com as mesmas regras (dia 31, valor "1.800" = mil e oitocentos, sem duplicar).
- Testes: `npm test` (node --test da lógica + unittest do fin.py) e `npm run test:ui` (Playwright: desktop Chromium, Pixel 5, Firefox; axe; overflow 320–1280px). Já limitados a 4 workers.
  Porta dos testes: 8797 (a 8792 é usada por outro projeto do Breno). O relógio dos testes de UI é fixo em 31/10/2026.
- Mudou regra? Mude em `logica.js` E em `fin.py`, com teste nos dois.

## Onde ficam os dados

- O repo e o Pages são PÚBLICOS: só código vai pra lá. Nenhum dado financeiro entra no git (`.gitignore` bloqueia `*.json` e `dados/`).
- Na página, os dados ficam no `localStorage` do navegador. A fonte da verdade é o backup `dados/financeiro-backup.json`,
  que o Breno importa no site e guarda no Google Drive.
- PDFs recebidos ficam em `dados/faturas/` (também fora do git).

## Ferramenta: `ferramentas/fin.py` (só stdlib)

Toda alteração no backup passa por ela: não duplica lançamentos (a fatura é única por cartão + mês de vencimento,
e a conta por descrição + mês) e guarda uma cópia em `dados/historico/` antes de gravar.

```
python3 ferramentas/fin.py fatura --cartao "Nubank" --valor 1.234,56 --vencimento 10/11/2026 \
    --fechamento 03/11/2026 --minimo 185,19 --limite 8000 --codigo "<linha digitável>"
python3 ferramentas/fin.py conta  --descricao "Aluguel" --valor 1800 --vencimento 05/11/2026 --categoria Moradia --mensal
python3 ferramentas/fin.py saldo  --conta "Itaú corrente" --valor 2350
python3 ferramentas/fin.py pago   --descricao "Aluguel" [--mes 2026-11] [--em 05/11/2026]
python3 ferramentas/fin.py resumo [--mes 2026-11]
```

## Quando o Breno mandar uma fatura em PDF

1. Copie o PDF para `dados/faturas/<cartao>-<AAAA-MM>.pdf`.
2. Extraia o texto: `pdftotext -layout arquivo.pdf -`. Se o PDF tiver senha (comum em banco: dígitos do CPF), peça a senha
   e use `pdftotext -upw <senha> ...`; nunca grave a senha em arquivo nem em memória. Se o texto vier vazio (PDF escaneado), leia o PDF com a tool Read.
3. Pegue do PDF: nome do cartão/banco (use sempre o mesmo nome já cadastrado; veja com `resumo`), **total da fatura**,
   **vencimento**, fechamento, pagamento mínimo, limite total e a linha digitável, se houver.
   Cuidado: "total da fatura" ≠ "saldo anterior" ≠ "lançamentos do mês"; parcelas futuras não entram no total.
4. Rode `fin.py fatura ...` e depois `fin.py resumo`.
5. Responda curto: valor lançado, vencimento, e o total do mês (faturas + contas) com quanto falta pagar.
   Lembre: importar `dados/financeiro-backup.json` no site e subir no Drive.

Contas fixas (aluguel, seguro obra, Claro, MEI etc.) entram com `conta --mensal`; marcar pago gera a do mês seguinte.
Boletos em PDF seguem o mesmo fluxo, com `conta` no lugar de `fatura`.

## Regras

- Valores em BRL, datas locais (America/Sao_Paulo). Na dúvida sobre um valor do PDF, pergunte antes de lançar.
- Se o Breno editou no site depois do último backup, peça o JSON exportado mais recente antes de alterar (senão uma versão sobrescreve a outra).
- Excluir lançamento só com confirmação explícita.
