# Financeiro pessoal do Breno

Página estática (`index.html`, sem build) publicada no GitHub Pages: https://brenisio.github.io/financeiro/
Repo: github.com/brenisio/financeiro (conta pessoal; usar `GH_TOKEN=$(gh auth token --user brenisio)`, porque o gh ativo é o da Econodata).

## Estrutura e testes

- `index.html` (HTML + CSS) · `js/logica.js` (regras puras: datas, valores, backup, somas por mês, sua parte × de outros, recorrência, lembretes) · `js/app.js` (DOM, localStorage, import/export).
- Tela: uma coluna; abas de mês → destaque "falta pagar (sua parte)" → lista do mês com contas e lembretes por data (círculo = paguei/feito, linha = detalhes; lembrete tem a tag "Lembrete" e entra pelo seletor de tipo do "Lançar") → cartões e bancos. Backup fica no botão do topo; "Lançar" é o botão fixo.
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
python3 ferramentas/fin.py saldo  --conta "Cofrinho 120% CDI" --valor 2350 --tipo investimento --banco "Mercado Pago"
python3 ferramentas/fin.py pago   --descricao "Aluguel" [--mes 2026-11] [--em 05/11/2026]
python3 ferramentas/fin.py resumo [--mes 2026-11]
# lembrete sem valor (não entra nas somas; aparece na lista do mês, no aviso do dia e no .ics):
python3 ferramentas/fin.py lembrete --descricao "Cancelar Uber One" --data 25/11/2026 [--obs "..."]
python3 ferramentas/fin.py feito    --descricao "Uber One" [--mes 2026-11] [--em 24/11/2026]
# parte de outra pessoa no mesmo boleto (ex.: cartão adicional da Agatha), em fatura ou conta:
python3 ferramentas/fin.py fatura ... --outro-nome Agatha --outro-valor 2.048,92
```

## Avisos do próprio site (app instalável)

- `manifest.webmanifest` + `icones/` + `sw.js` (service worker módulo): instalável, abre sem internet (rede primeiro, cache como reserva).
- A página espelha o estado no IndexedDB (`js/avisos.js`); o SW, no `periodicsync` "contas" (Chrome/Android com o app instalado,
  o navegador decide a frequência), roda `avisoDoDia` (logica.js) e mostra um aviso por dia: contas a pagar que vencem em até 2 dias ou atrasadas.
- Sem servidor não há push garantido: no iPhone e no Firefox só funciona com a página aberta. O .ics do Google Agenda é o reforço.
- Teste real do SW: `tests/ui/site.spec.js`, bloco "app instalável" (Chromium completo, dispara o periodic sync via CDP).
  Falha conhecida: esse teste usa o relógio real (não o fixo de 31/10/2026); desde 20/11/2026 o backup de exemplo tem 3 contas
  atrasadas e ele espera "Claro está atrasada". Já falhava antes dos lembretes; o conserto é fixar a data no teste do SW.

## Lembretes (Google Agenda)

`python3 ferramentas/fin.py agenda` gera `dados/financeiro-lembretes.ics` (o site faz o mesmo em Backup → "Baixar lembretes").
Cada conta em aberto vira evento de dia inteiro no vencimento, com aviso 9h de 2 dias antes e 9h do dia; UID fixo por lançamento,
então reimportar atualiza. Depois de lançar/alterar contas, rode `agenda` e lembre o Breno de importar o .ics
(agenda.google.com → Configurações → Importar, de preferência numa agenda "Financeiro" com notificação por e-mail).
`paraIcs` (logica.js) e `para_ics` (fin.py) têm de gerar bytes idênticos (já divergiram uma vez: `;` sem escape no JS).

Ao relançar uma fatura, repita `--minimo`, `--fechamento` e `--obs`: a observação é refeita a cada chamada.
Fatura com cartão adicional de outra pessoa: some por portador no PDF e lance a parte dela com `--outro-*`
(o site mostra "sua parte" no destaque do mês e a parte dela separada).

## Quando o Breno mandar uma fatura em PDF

1. Copie o PDF para `dados/faturas/<cartao>-<AAAA-MM>.pdf`.
2. Extraia o texto: `pdftotext -layout arquivo.pdf -`. Se o PDF tiver senha, use a que está na memória privada do Claude
   (`senha-faturas`, fora do repo) com `pdftotext -upw <senha> ...`; se não abrir, peça. Nunca grave a senha neste repo (é público). Se o texto vier vazio (PDF escaneado), leia o PDF com a tool Read.
3. Pegue do PDF: nome do cartão/banco (use sempre o mesmo nome já cadastrado; veja com `resumo`), **total da fatura**,
   **vencimento**, fechamento, pagamento mínimo, limite total e a linha digitável, se houver.
   Cuidado: "total da fatura" ≠ "saldo anterior" ≠ "lançamentos do mês"; parcelas futuras não entram no total.
4. Rode `fin.py fatura ...` e depois `fin.py resumo`.
5. Responda curto: valor lançado, vencimento, e o total do mês (faturas + contas) com quanto falta pagar.
   Lembre: importar `dados/financeiro-backup.json` no site e subir no Drive.

Contas fixas (aluguel, seguro obra, Claro, MEI etc.) entram com `conta --mensal`; marcar pago gera a do mês seguinte.
Boletos em PDF seguem o mesmo fluxo, com `conta` no lugar de `fatura`.

## Lembretes sem valor ("cancelar Uber One até 25/11")

- Coleção `lembretes` no backup: `{ id, descricao, data, obs, feito, feitoEm }`. Backup antigo sem ela abre normal (lista vazia).
- Não entram em nenhuma soma (destaque, abas, falta pagar). Na lista do mês aparecem por data junto das contas, com a tag
  "Lembrete"; os feitos vão pro fim. Mês que só tem lembrete ganha aba ("1 lembrete").
- No site: "Lançar" → tipo "Lembrete" (leva a descrição e a data já digitadas). Ao editar, não dá pra trocar o tipo.
- Entram no aviso do dia (até 2 dias antes ou já passados) e no .ics ("Lembrete: …" com os mesmos alarmes; feito vira "Feito: …" sem alarme).
- Quando o Breno pedir um lembrete: `fin.py lembrete ...`, depois `fin.py agenda`, e lembre de importar o backup no site.
  Mesmo nome no mesmo mês atualiza em vez de duplicar.

## Publicar

Commit e push só quando o Breno pedir. O push usa a conta pessoal (token de `gh auth token --user brenisio`).
O Pages leva alguns minutos; o service worker pode segurar a versão antiga até um Ctrl+Shift+R.

## Regras

- Valores em BRL, datas locais (America/Sao_Paulo). Na dúvida sobre um valor do PDF, pergunte antes de lançar.
- Se o Breno editou no site depois do último backup, peça o JSON exportado mais recente antes de alterar (senão uma versão sobrescreve a outra).
- Excluir lançamento só com confirmação explícita.
