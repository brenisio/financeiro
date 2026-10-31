# Financeiro pessoal do Breno

Página estática (`index.html`, sem build) publicada no GitHub Pages: https://brenisio.github.io/financeiro/
Repo: github.com/brenisio/financeiro (conta pessoal — usar `GH_TOKEN=$(gh auth token --user brenisio)`; o gh ativo é o da Econodata).

## Onde ficam os dados

- O repo e o Pages são PÚBLICOS: só código vai pra lá. Nenhum dado financeiro entra no git (`.gitignore` bloqueia `*.json` e `dados/`).
- Na página, os dados ficam no `localStorage` do navegador. O backup é o `financeiro-backup.json` exportado pela página
  e guardado pelo Breno no Google Drive; em outro aparelho ele importa esse arquivo.
- Pra eu editar: o Breno coloca o backup em `dados/` (ignorado pelo git), eu altero o JSON e ele importa de volta na página.

## Formato do backup

```json
{ "versao": 1, "salvoEm": "ISO-8601",
  "lancamentos": [{ "id", "descricao", "valor": 182.4, "vencimento": "AAAA-MM-DD", "natureza": "pagar"|"receber",
                    "forma": "boleto"|"pix"|"debito"|"fatura"|"transferencia"|"outro", "categoria", "recorrencia": ""|"mensal",
                    "codigo", "obs", "pago": false, "pagoEm": "AAAA-MM-DD"|null, "origem"?, "cartaoId"? }],
  "contas":  [{ "id", "nome", "tipo": "corrente"|"poupanca"|"carteira"|"investimento", "saldo", "atualizadoEm" }],
  "cartoes": [{ "id", "nome", "limite", "fatura", "diaFechamento", "diaVencimento", "atualizadoEm" }] }
```

## Como trabalhar aqui

- Ao editar o backup: mantenha os `id` existentes, gere ids novos únicos, grave `atualizadoEm` = hoje em contas/cartões
  e atualize `salvoEm`.
- Marcar pago = `pago: true, pagoEm: hoje`; se `recorrencia: "mensal"`, crie o do mês seguinte com `origem` = id.
- "Como estou?": leia o backup e resuma atrasados, o que vence em 7 dias, saldo em conta e sobra em 30 dias
  (saldo + a receber − a pagar). Aponte saldos com mais de 7 dias sem atualização.
- Valores em BRL, datas locais (America/Sao_Paulo).
