import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// Relógio fixo: sábado, 31/10/2026 10h (Brasília). Os prazos ficam previsíveis.
const AGORA = new Date('2026-10-31T10:00:00-03:00');

// Backup de exemplo (fictício) no formato que o site exporta
const BACKUP = {
  versao: 1, salvoEm: '2026-10-30T12:00:00.000Z',
  contas: [
    { id: 'c1', nome: 'Itaú corrente', tipo: 'corrente', saldo: 3000, atualizadoEm: '2026-10-30' },
    { id: 'c2', nome: 'CDB', tipo: 'investimento', saldo: 10000, atualizadoEm: '2026-10-01' }
  ],
  cartoes: [{ id: 'k1', nome: 'Nubank', limite: 5000, fatura: 640.5, diaFechamento: 3, diaVencimento: 10, atualizadoEm: '2026-10-30' }],
  lancamentos: [
    { id: 'l1', descricao: 'Claro', valor: 129.9, vencimento: '2026-10-20', natureza: 'pagar', forma: 'boleto', categoria: 'Casa', recorrencia: 'mensal', codigo: '84670000001-2 99990000000-1', obs: '', pago: false, pagoEm: null },
    { id: 'l2', descricao: 'Aluguel', valor: 1800, vencimento: '2026-11-05', natureza: 'pagar', forma: 'pix', categoria: 'Moradia', recorrencia: 'mensal', codigo: '', obs: '', pago: false, pagoEm: null },
    { id: 'l3', descricao: 'Fatura Nubank', valor: 1300, vencimento: '2026-11-10', natureza: 'pagar', forma: 'fatura', categoria: 'Cartão', recorrencia: '', codigo: '', obs: 'mínimo R$ 195,00', pago: false, pagoEm: null, cartaoId: 'k1', outroNome: 'Agatha', outroValor: 300 },
    { id: 'l4', descricao: 'Freela site', valor: 500, vencimento: '2026-11-15', natureza: 'receber', forma: 'pix', categoria: '', recorrencia: '', codigo: '', obs: '', pago: false, pagoEm: null },
    { id: 'l5', descricao: 'Seguro obra', valor: 210, vencimento: '2026-12-15', natureza: 'pagar', forma: 'boleto', categoria: 'Obra', recorrencia: 'mensal', codigo: '', obs: '', pago: false, pagoEm: null },
    { id: 'l6', descricao: 'MEI', valor: 75.6, vencimento: '2026-10-20', natureza: 'pagar', forma: 'boleto', categoria: 'Impostos', recorrencia: 'mensal', codigo: '', obs: '', pago: true, pagoEm: '2026-10-19' }
  ]
};

const erros = page => {
  const lista = [];
  page.on('pageerror', e => lista.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/fonts\.g/.test(m.text())) lista.push(m.text()); });
  return lista;
};
const arquivo = obj => ({ name: 'financeiro-backup.json', mimeType: 'application/json', buffer: Buffer.from(typeof obj === 'string' ? obj : JSON.stringify(obj)) });
const importar = (page, obj = BACKUP) => page.locator('#arquivo').setInputFiles(arquivo(obj));
async function abrirComDados(page) {
  await page.goto('/');
  await importar(page);
  await expect(page.locator('#toast')).toContainText('Backup aberto');
}
const item = (page, id) => page.locator(`#lista .item[data-id="${id}"]`);
const aba = (page, mes) => page.locator(`#meses .mes[data-mes="${mes}"]`);
const modal = page => page.getByRole('dialog');
async function lerDownload(download) {
  const partes = await (await download.createReadStream()).toArray();
  return JSON.parse(Buffer.concat(partes).toString('utf8'));
}

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(AGORA);
});

test('abre vazio, sem erro, só com o convite para começar', async ({ page }) => {
  const e = erros(page);
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-pronto', '1');
  await expect(page.locator('#inicio')).toBeVisible();
  await expect(page.locator('#hoje')).toContainText('31 de outubro de 2026');
  for (const id of ['#hero', '#meses', '#contas-mes', '#sec-cartoes', '#sec-contas', '#aviso-atraso']) await expect(page.locator(id)).toBeHidden();
  await expect(page.locator('#bt-novo')).toBeVisible();
  expect(e).toEqual([]);
});

test('abre o backup no mês atual, com atraso e somas certas', async ({ page }) => {
  const e = erros(page);
  await abrirComDados(page);
  await expect(page.locator('#inicio')).toBeHidden();
  await expect(aba(page, '2026-10')).toHaveAttribute('aria-pressed', 'true');
  await expect(aba(page, '2026-10')).toHaveClass(/atrasado/);
  await expect(page.locator('#h-rot')).toHaveText('Falta pagar em outubro');
  await expect(page.locator('#h-valor')).toHaveText('R$ 129,90');
  await expect(page.locator('#h-sub')).toHaveText('R$ 75,60 pago de R$ 205,50 · 1 conta em aberto');
  await expect(page.locator('#h-barra')).toHaveAttribute('aria-valuenow', '37');
  await expect(page.locator('#aviso-atraso')).toContainText('R$ 129,90 atrasado: Claro');
  await expect(page.locator('#bt-ver-atraso')).toBeHidden();
  await expect(item(page, 'l1')).toHaveClass(/atrasado/);
  await expect(item(page, 'l1')).toContainText('Venceu 20/10 · há 11 dias');
  await expect(item(page, 'l6')).toHaveClass(/pago/);
  await expect(page.locator('#lista .item')).toHaveCount(2);
  // cartão: 5000 − 640,50 em aberto − 1300 da fatura fechada
  await expect(page.locator('#cartoes [data-id="k1"]')).toContainText('livre R$ 3.059,50');
  await expect(page.locator('#contas')).toContainText('Itaú corrente');
  await expect(page.locator('#bt-backup')).toHaveText('Backup em dia');
  expect(e).toEqual([]);
});

test('novembro separa a sua parte da parte da Agatha', async ({ page }) => {
  await abrirComDados(page);
  await aba(page, '2026-11').click();
  await expect(aba(page, '2026-11')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#h-rot')).toHaveText('Sua parte que falta pagar em novembro');
  await expect(page.locator('#h-valor')).toHaveText('R$ 2.800,00');
  const partes = page.locator('#h-partes');
  await expect(partes).toContainText('Boletos em abertoR$ 3.100,00');
  await expect(partes).toContainText('Parte da AgathaR$ 300,00');
  await expect(partes).toContainText('Em conta hojeR$ 3.000,00');
  await expect(partes).toContainText('Sobra depois de pagarR$ 400,00'); // 3000 + 500 a receber − 3100
  await expect(item(page, 'l3')).toContainText('seu R$ 1.000,00');
  await expect(item(page, 'l4')).toContainText('+ R$ 500,00');
  // o aviso de atraso agora leva de volta a outubro
  await page.locator('#bt-ver-atraso').click();
  await expect(aba(page, '2026-10')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#lista .atrasado .abrir')).toBeFocused();
});

test('marcar como pago pelo círculo, com Desfazer no aviso', async ({ page }) => {
  await abrirComDados(page);
  await item(page, 'l1').locator('.check').click();
  await expect(page.locator('#toast')).toContainText('Pago. O de novembro já está na lista.');
  await expect(item(page, 'l1')).toHaveClass(/pago/);
  await expect(item(page, 'l1').locator('.check')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#aviso-atraso')).toBeHidden();
  await expect(page.locator('#h-sub')).toHaveText('Tudo pago em outubro.');
  await aba(page, '2026-11').click();
  await expect(page.locator('#lista .item', { hasText: 'Claro' })).toHaveCount(1);
  await aba(page, '2026-10').click();
  await page.locator('#toast button', { hasText: 'Desfazer' }).click();
  await expect(item(page, 'l1')).not.toHaveClass(/pago/);
  await aba(page, '2026-11').click();
  await expect(page.locator('#lista .item', { hasText: 'Claro' })).toHaveCount(0);
  // tocar no círculo de um pago desfaz
  await aba(page, '2026-10').click();
  await item(page, 'l6').locator('.check').click();
  await expect(item(page, 'l6')).not.toHaveClass(/pago/);
});

test('detalhes mostram a divisão e pagam pela janela', async ({ page }) => {
  await abrirComDados(page);
  await aba(page, '2026-11').click();
  await item(page, 'l3').locator('.abrir').click();
  const d = modal(page);
  await expect(d.locator('h2')).toHaveText('Fatura Nubank');
  await expect(d.locator('.split')).toContainText('Sua parteR$ 1.000,00');
  await expect(d.locator('.split')).toContainText('AgathaR$ 300,00');
  await expect(d).toContainText('Fatura de cartão · Nubank');
  await expect(d.getByRole('button', { name: 'Paguei' })).toBeFocused();
  await d.getByRole('button', { name: 'Paguei' }).click();
  await expect(modal(page)).toHaveCount(0);
  await expect(item(page, 'l3')).toHaveClass(/pago/);
  await expect(page.locator('#h-valor')).toHaveText('R$ 1.800,00');
  await item(page, 'l3').locator('.abrir').click();
  await modal(page).getByRole('button', { name: 'Desfazer pagamento' }).click();
  await expect(item(page, 'l3')).not.toHaveClass(/pago/);
});

test('copiar o código do boleto', async ({ page, context, browserName }) => {
  test.skip(browserName !== 'chromium', 'permissão de área de transferência só no Chromium');
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await abrirComDados(page);
  await item(page, 'l1').locator('.abrir').click();
  await modal(page).getByRole('button', { name: 'Copiar código' }).click();
  await expect(page.locator('#toast')).toHaveText('Código copiado');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('84670000001-2 99990000000-1');
});

test('lançar: validação, "1.800" vira mil e oitocentos e a tela vai para o mês', async ({ page }) => {
  await abrirComDados(page);
  await page.locator('#bt-novo').click();
  const f = modal(page);
  await expect(f.locator('h2')).toHaveText('Nova conta');
  await expect(f.getByLabel('Descrição')).toBeFocused();
  await expect(f.locator('details.mais')).not.toHaveAttribute('open', '');
  await f.getByRole('button', { name: 'Salvar' }).click();
  await expect(f.locator('.msg')).toHaveText('Preencha “Descrição”.');
  await f.getByLabel('Descrição').fill('Seguro carro');
  await f.getByLabel('Valor (R$)').fill('abc');
  await f.getByRole('button', { name: 'Salvar' }).click();
  await expect(f.locator('.msg')).toContainText('precisa ser um valor');
  await expect(f.getByLabel('Valor (R$)')).toHaveAttribute('aria-invalid', 'true');
  await f.getByLabel('Valor (R$)').fill('1.800');
  await f.getByLabel('Vencimento').fill('2026-12-07');
  await f.getByLabel('Repete todo mês').check();
  // parte de outra pessoa maior que o total
  await f.locator('details.mais summary').click();
  await f.getByLabel('Parte de outra pessoa').fill('Agatha');
  await f.getByLabel('Valor dela/dele (R$)').fill('2000');
  await f.getByRole('button', { name: 'Salvar' }).click();
  await expect(f.locator('.msg')).toHaveText('A parte de outra pessoa não pode passar do valor total.');
  await f.getByLabel('Valor dela/dele (R$)').fill('600');
  await f.getByRole('button', { name: 'Salvar' }).click();
  await expect(modal(page)).toHaveCount(0);
  await expect(aba(page, '2026-12')).toHaveAttribute('aria-pressed', 'true');
  const linha = page.locator('#lista .item', { hasText: 'Seguro carro' });
  await expect(linha).toContainText('R$ 1.800,00');
  await expect(linha).toContainText('seu R$ 1.200,00');
  await expect(page.locator('#bt-backup')).toHaveText('Salvar backup');
});

test('a receber pelo seletor do formulário', async ({ page }) => {
  await abrirComDados(page);
  await page.locator('#bt-novo').click();
  const f = modal(page);
  await f.getByText('A receber', { exact: true }).click();
  await f.getByLabel('Descrição').fill('Reembolso Agatha');
  await f.getByLabel('Valor (R$)').fill('300');
  await f.getByLabel('Vencimento').fill('2026-11-12');
  await f.getByRole('button', { name: 'Salvar' }).click();
  const linha = page.locator('#lista .item', { hasText: 'Reembolso Agatha' });
  await expect(linha).toHaveClass(/receber/);
  await expect(linha).toContainText('+ R$ 300,00');
  await expect(linha).toContainText('Cai 12/11 · em 12 dias'); // receita não "vence"
  await expect(page.locator('#h-valor')).toHaveText('R$ 2.800,00'); // a receber não mexe no que falta pagar
  await linha.locator('.abrir').click();
  await expect(modal(page)).toContainText('Previsto para');
  await expect(modal(page)).not.toContainText('Vencimento');
});

test('editar e excluir (com confirmação em dois toques)', async ({ page }) => {
  await abrirComDados(page);
  await item(page, 'l1').locator('.abrir').click();
  await modal(page).getByRole('button', { name: 'Editar', exact: true }).click();
  const f = modal(page);
  await expect(f.locator('h2')).toHaveText('Editar conta');
  await expect(f.getByLabel('Descrição')).toHaveValue('Claro');
  await expect(f.getByLabel('Valor (R$)')).toHaveValue('129,90');
  await expect(f.locator('details.mais')).toHaveAttribute('open', '');
  await f.getByLabel('Valor (R$)').fill('139,90');
  await f.getByRole('button', { name: 'Salvar' }).click();
  await expect(item(page, 'l1')).toContainText('R$ 139,90');

  await item(page, 'l1').locator('.abrir').click();
  await modal(page).getByRole('button', { name: 'Editar', exact: true }).click();
  const excluir = modal(page).getByRole('button', { name: 'Excluir' });
  await excluir.click();
  await expect(modal(page).getByRole('button', { name: 'Toque de novo para excluir' })).toBeVisible();
  await expect(item(page, 'l1')).toHaveCount(1);
  await modal(page).getByRole('button', { name: 'Toque de novo para excluir' }).click();
  await expect(item(page, 'l1')).toHaveCount(0);
  await expect(page.locator('#toast')).toHaveText('Excluído');
});

test('janela: Esc fecha e devolve o foco; Tab fica dentro; o fundo fica inerte', async ({ page }) => {
  await abrirComDados(page);
  const abrir = item(page, 'l1').locator('.abrir');
  await abrir.focus();
  await page.keyboard.press('Enter');
  await expect(modal(page)).toBeVisible();
  await expect(page.locator('.wrap')).toHaveJSProperty('inert', true);
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => !!document.activeElement.closest('.modal'))).toBe(true);
  }
  // detalhe → editar → Esc: o foco volta para a linha que abriu
  await modal(page).getByRole('button', { name: 'Editar', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(modal(page)).toHaveCount(0);
  await expect(page.locator('.wrap')).toHaveJSProperty('inert', false);
  await expect(abrir).toBeFocused();
  // clique no fundo fecha; clique dentro não
  await page.locator('#bt-novo').click();
  await modal(page).locator('h2').click();
  await expect(modal(page)).toBeVisible();
  await page.mouse.click(5, 5);
  await expect(modal(page)).toHaveCount(0);
});

test('cartão: fatura fechou soma na fatura do mês', async ({ page }) => {
  await abrirComDados(page);
  await page.locator('#cartoes [data-id="k1"] .linha').click();
  await expect(modal(page).locator('h2')).toHaveText('Editar cartão');
  await modal(page).getByRole('button', { name: 'A fatura fechou: lançar R$ 640,50' }).click();
  await expect(page.locator('#toast')).toContainText('Fatura de R$ 640,50 lançada para 10/11/2026');
  await expect(aba(page, '2026-11')).toHaveAttribute('aria-pressed', 'true');
  await expect(item(page, 'l3')).toContainText('R$ 1.940,50');
  await expect(page.locator('#cartoes [data-id="k1"]')).toContainText('fatura atual R$ 0,00');
});

test('conta bancária: atualizar saldo, inclusive negativo', async ({ page }) => {
  await abrirComDados(page);
  await page.locator('#contas [data-id="c1"] .linha').click();
  await modal(page).getByLabel('Saldo atual (R$)').fill('-120,50');
  await modal(page).getByRole('button', { name: 'Salvar' }).click();
  await expect(page.locator('#contas [data-id="c1"] .v')).toHaveText('-R$ 120,50');
  await expect(page.locator('#contas [data-id="c1"] .v')).toHaveClass(/neg/);
});

test('contas agrupadas por banco, com subtotal e total geral', async ({ page }) => {
  await abrirComDados(page);
  await expect(page.locator('#contas-total')).toContainText('R$ 13.000,00');
  await expect(page.locator('#contas-total')).toContainText('em conta R$ 3.000,00 · investido R$ 10.000,00');
  await page.locator('#contas [data-id="c2"] .linha').click();
  await modal(page).getByLabel('Banco').fill('Itaú');
  await modal(page).getByRole('button', { name: 'Salvar' }).click();
  await page.locator('#contas [data-id="c1"] .linha').click();
  await modal(page).getByLabel('Banco').fill('Itaú');
  await modal(page).getByRole('button', { name: 'Salvar' }).click();
  const grupo = page.locator('#contas .banco');
  await expect(grupo).toHaveCount(1);
  await expect(grupo.locator('.banco-nome')).toHaveText('Itaú');
  await expect(grupo.locator('.banco-total')).toHaveText('R$ 13.000,00');
  await expect(grupo.locator('[data-id]')).toHaveCount(2);
});

test('backup: baixar e abrir de novo dá o mesmo resultado', async ({ page }) => {
  await abrirComDados(page);
  await item(page, 'l1').locator('.check').click();
  await expect(page.locator('#bt-backup')).toHaveText('Salvar backup');
  await page.locator('#bt-backup').click();
  await expect(modal(page)).toContainText('Há alterações fora do backup');
  const [download] = await Promise.all([page.waitForEvent('download'), modal(page).getByRole('button', { name: 'Baixar backup' }).click()]);
  expect(download.suggestedFilename()).toBe('financeiro-backup.json');
  const json = await lerDownload(download);
  expect(json.versao).toBe(1);
  expect(json.lancamentos.find(l => l.id === 'l3')).toMatchObject({ outroNome: 'Agatha', outroValor: 300 });
  expect(json.lancamentos.find(l => l.id === 'l1').pago).toBe(true);
  await expect(page.locator('#bt-backup')).toHaveText('Backup em dia');

  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await importar(page, json);
  // outubro ficou todo pago, então a tela abre no próximo mês com conta em aberto
  await expect(aba(page, '2026-11')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#h-valor')).toHaveText('R$ 2.929,90'); // 1.800 + 1.000 + Claro de novembro, criado ao pagar
  await aba(page, '2026-10').click();
  await expect(item(page, 'l1')).toHaveClass(/pago/);
});

test('lembretes: baixa o .ics para o Google Agenda', async ({ page }) => {
  await abrirComDados(page);
  await page.locator('#bt-backup').click();
  await expect(modal(page).locator('h2')).toHaveText('Backup e avisos');
  const [download] = await Promise.all([page.waitForEvent('download'), modal(page).getByRole('button', { name: 'Baixar lembretes (.ics)' }).click()]);
  expect(download.suggestedFilename()).toBe('financeiro-lembretes.ics');
  const partes = await (await download.createReadStream()).toArray();
  const ics = Buffer.concat(partes).toString('utf8').replace(/\r\n /g, '');
  expect(ics).toContain('SUMMARY:Pagar: Fatura Nubank · R$ 1.300\\,00 (sua parte R$ 1.000\\,00)');
  expect(ics).toContain('DTSTART;VALUE=DATE:20261110');
  expect(ics).toContain('SUMMARY:Pago: MEI');
  await expect(page.locator('#toast')).toContainText('Importe no Google Agenda');
});

test('abrir backup por cima pede confirmação e avisa se for mais antigo', async ({ page }) => {
  await abrirComDados(page);
  await item(page, 'l1').locator('.check').click(); // alteração local depois do backup
  await importar(page, { ...BACKUP, lancamentos: BACKUP.lancamentos.slice(0, 2) });
  const d = modal(page);
  await expect(d.locator('.confirma')).toContainText('2 lançamentos');
  await expect(d.locator('.confirma')).toContainText('mais antigo');
  await d.getByRole('button', { name: 'Cancelar' }).click();
  await expect(page.locator('#lista .item')).toHaveCount(2);
  await page.keyboard.press('Escape');
  await importar(page, { ...BACKUP, lancamentos: BACKUP.lancamentos.slice(0, 2) });
  await modal(page).getByRole('button', { name: 'Trocar' }).click();
  await expect(modal(page)).toHaveCount(0);
  await expect(page.locator('#toast')).toContainText('Backup aberto: 2 lançamentos');
  await expect(item(page, 'l1')).not.toHaveClass(/pago/);
});

test('arquivos inválidos não estragam nada', async ({ page }) => {
  await abrirComDados(page);
  await importar(page, 'não é json');
  await expect(page.locator('#toast')).toContainText('Não consegui ler esse arquivo');
  await importar(page, { foo: 1 });
  await expect(page.locator('#toast')).toContainText('não é um backup do Financeiro');
  await importar(page, { lancamentos: [{ descricao: 'X', valor: 1, vencimento: '31/10/2026' }] });
  await expect(page.locator('#toast')).toContainText('sem vencimento válido');
  await expect(page.locator('#lista .item')).toHaveCount(2);
});

test('sem rolagem lateral de 320 a 1280 px', async ({ page }) => {
  await abrirComDados(page);
  for (const w of [320, 375, 768, 1280]) {
    await page.setViewportSize({ width: w, height: 800 });
    for (const mes of ['2026-10', '2026-11']) {
      await aba(page, mes).click();
      const largura = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(largura, `largura em ${w}px`).toBeLessThanOrEqual(w);
    }
    await page.locator('#bt-novo').click();
    await modal(page).locator('details.mais summary').click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(w);
    await page.keyboard.press('Escape');
  }
});

test('no celular, tudo que se toca tem pelo menos 40 px', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'só no celular');
  await abrirComDados(page);
  const pequenos = await page.evaluate(() => [...document.querySelectorAll('button')]
    .filter(b => b.offsetParent !== null || getComputedStyle(b).position === 'fixed')
    .map(b => ({ t: b.textContent.trim() || b.getAttribute('aria-label'), h: b.getBoundingClientRect().height, w: b.getBoundingClientRect().width }))
    .filter(b => b.h < 40 || b.w < 40));
  expect(pequenos).toEqual([]);
});

for (const esquema of ['light', 'dark']) {
  test(`acessibilidade (axe) no tema ${esquema}, com e sem janela aberta`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: esquema });
    await page.goto('/');
    const vazio = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(vazio.violations.map(v => v.id + ': ' + v.nodes.map(n => n.target).join(' | '))).toEqual([]);
    await importar(page);
    await aba(page, '2026-11').click();
    const cheio = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(cheio.violations.map(v => v.id + ': ' + v.nodes.map(n => n.target).join(' | '))).toEqual([]);
    await item(page, 'l3').locator('.abrir').click();
    const det = await new AxeBuilder({ page }).include('.modal').withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(det.violations.map(v => v.id + ': ' + v.nodes.map(n => n.target).join(' | '))).toEqual([]);
    await modal(page).getByRole('button', { name: 'Editar', exact: true }).click();
    await modal(page).locator('details.mais summary').click();
    const form = await new AxeBuilder({ page }).include('.modal').withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(form.violations.map(v => v.id + ': ' + v.nodes.map(n => n.target).join(' | '))).toEqual([]);
  });
}

// ---------- avisos (notificações) ----------

// Notification de mentira: registra o que seria mostrado e devolve a permissão pedida
const fingeNotificacao = (page, permissao, resposta = permissao) => page.addInitScript(([p, r]) => {
  window.__avisos = [];
  const N = function (titulo, opcoes) { window.__avisos.push([titulo, opcoes && opcoes.body]); };
  N.permission = p;
  N.requestPermission = async () => { N.permission = r; return r; };
  window.Notification = N;
}, [permissao, resposta]);

test('convite para ligar os avisos: ativa, e "agora não" fica lembrado', async ({ page }) => {
  await fingeNotificacao(page, 'default', 'granted');
  await abrirComDados(page);
  await expect(page.locator('#convite-avisos')).toBeVisible();
  const axe = await new AxeBuilder({ page }).include('#convite-avisos').withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(axe.violations.map(v => v.id)).toEqual([]);
  await page.locator('#bt-ativar-avisos').click();
  await expect(page.locator('#toast')).toContainText('Avisos ligados');
  await expect(page.locator('#convite-avisos')).toBeHidden();
});

test('convite some com "agora não", mesmo recarregando', async ({ page }) => {
  await fingeNotificacao(page, 'default');
  await abrirComDados(page);
  await page.getByRole('button', { name: 'Agora não' }).click();
  await expect(page.locator('#convite-avisos')).toBeHidden();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-pronto', '1');
  await expect(page.locator('#lista .item').first()).toBeVisible();
  await expect(page.locator('#convite-avisos')).toBeHidden();
});

test('avisos negados explicam como liberar', async ({ page }) => {
  await fingeNotificacao(page, 'denied');
  await abrirComDados(page);
  await expect(page.locator('#convite-avisos')).toBeHidden();
  await page.locator('#bt-backup').click();
  await expect(modal(page).locator('#avisos-texto')).toContainText('Avisos bloqueados');
});

test('testar aviso mostra as contas que vencem (sem service worker: só com a página aberta)', async ({ page }) => {
  await fingeNotificacao(page, 'granted');
  await abrirComDados(page);
  await page.locator('#bt-backup').click();
  await expect(modal(page).locator('#avisos-texto')).toContainText('instalar como app');
  await modal(page).getByRole('button', { name: 'Testar aviso' }).click();
  await expect.poll(() => page.evaluate(() => window.__avisos)).toEqual([['Claro está atrasada', 'Claro: atrasada há 11 dias · R$ 129,90']]);
});

test.describe('app instalável (service worker de verdade)', () => {
  // notificação a partir do service worker não funciona no "headless shell"; aqui sobe o Chromium completo
  let navegador, context, page;
  test.beforeEach(async ({ playwright, browserName, isMobile }) => {
    test.skip(browserName !== 'chromium' || isMobile, 'service worker module + periodic sync: Chrome (roda uma vez, no desktop)');
    navegador = await playwright.chromium.launch({ channel: 'chromium' });
    context = await navegador.newContext({ serviceWorkers: 'allow', baseURL: 'http://127.0.0.1:8797/', timezoneId: 'America/Sao_Paulo', locale: 'pt-BR' });
    await context.grantPermissions(['notifications'], { origin: 'http://127.0.0.1:8797' });
    page = await context.newPage();
  });
  test.afterEach(async () => { await navegador?.close(); });

  test('abre sem internet e avisa em segundo plano, uma vez por dia', async () => {
    await page.goto('/');
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
    await page.reload(); // passa a ser controlada pelo service worker
    await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
    await importar(page);
    await expect(page.locator('#toast')).toContainText('Backup aberto');
    await expect(page.locator('#convite-avisos')).toBeHidden(); // já liberado

    // o service worker lê o espelho no IndexedDB e mostra a notificação
    const titulos = () => page.evaluate(async () => (await (await navigator.serviceWorker.ready).getNotifications()).map(n => n.title));
    const cdp = await context.newCDPSession(page);
    await cdp.send('ServiceWorker.enable');
    const ids = [];
    cdp.on('ServiceWorker.workerRegistrationUpdated', e => e.registrations.forEach(r => ids.push(r.registrationId)));
    await expect.poll(() => ids.length).toBeGreaterThan(0);
    const origem = new URL(page.url()).origin;
    await cdp.send('ServiceWorker.dispatchPeriodicSyncEvent', { origin: origem, registrationId: ids[0], tag: 'contas', lastChance: false });
    await expect.poll(titulos).toEqual(['Claro está atrasada']);

    // segundo disparo no mesmo dia não repete
    await page.evaluate(async () => (await navigator.serviceWorker.ready).getNotifications().then(ns => ns.forEach(n => n.close())));
    await cdp.send('ServiceWorker.dispatchPeriodicSyncEvent', { origin: origem, registrationId: ids[0], tag: 'contas', lastChance: false });
    await page.waitForTimeout(500);
    expect(await titulos()).toEqual([]);

    // sem internet o app ainda abre, com os dados
    await context.setOffline(true);
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-pronto', '1');
    await expect(page.locator('#lista .item')).toHaveCount(2);
    await context.setOffline(false);
  });
});
