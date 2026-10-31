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
    { id: 'l3', descricao: 'Fatura Nubank', valor: 1300, vencimento: '2026-11-10', natureza: 'pagar', forma: 'fatura', categoria: 'Cartão', recorrencia: '', codigo: '', obs: 'mínimo R$ 195,00', pago: false, pagoEm: null, cartaoId: 'k1' },
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
async function importar(page, obj = BACKUP) {
  await page.locator('#arquivo').setInputFiles(arquivo(obj));
}
async function abrirComDados(page) {
  await page.goto('/');
  await importar(page);
  await expect(page.locator('#toast')).toContainText('Backup importado');
}
const item = (page, id) => page.locator(`.item[data-id="${id}"]`);

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(AGORA);
});

test('abre vazio, sem erro, com os primeiros passos', async ({ page }) => {
  const e = erros(page);
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-pronto', '1');
  await expect(page.locator('#inicio')).toBeVisible();
  await expect(page.locator('#hoje')).toContainText('31 de outubro de 2026');
  await expect(page.locator('#r-saldo')).toHaveText('—');
  await expect(page.locator('#meses-box')).toBeHidden();
  expect(e).toEqual([]);
});

test('importa o backup e soma tudo certo', async ({ page }) => {
  const e = erros(page);
  await abrirComDados(page);
  await expect(page.locator('#inicio')).toBeHidden();
  await expect(page.locator('#r-saldo')).toHaveText('R$ 3.000,00');
  await expect(page.locator('#r-saldo-sub')).toContainText('R$ 10.000,00 investidos');
  // a pagar em 30 dias: Claro (atrasada) + Aluguel + Fatura = 3.229,90
  await expect(page.locator('#r-pagar')).toHaveText('R$ 3.229,90');
  await expect(page.locator('#r-atraso')).toHaveText('R$ 129,90');
  await expect(page.locator('#r-atraso-sub')).toHaveText('1 conta vencida');
  // sobra: 3000 + 500 − 3229,90
  await expect(page.locator('#r-sobra')).toHaveText('R$ 270,10');

  // por mês
  const linhas = page.locator('#meses tr');
  await expect(linhas).toHaveCount(3);
  await expect(linhas.nth(0)).toContainText('out/2026');
  await expect(linhas.nth(1).locator('td')).toHaveText(['R$ 1.300,00', 'R$ 1.800,00', 'R$ 3.100,00', 'R$ 0,00', 'R$ 3.100,00']);
  await expect(linhas.nth(0).locator('td').nth(3)).toHaveText('R$ 75,60');

  // grupos
  await expect(page.locator('.grupo.atrasado .item')).toHaveCount(1);
  await expect(page.locator('.grupo.semana .item')).toHaveCount(1);
  await expect(item(page, 'l1')).toContainText('venceu há 11 dias');
  await expect(item(page, 'l4')).toContainText('a receber');
  await expect(item(page, 'l4').getByRole('button', { name: 'Recebi' })).toBeVisible();

  // cartão: livre = 5000 − 640,50 em aberto − 1300 fechada
  const cartao = page.locator('#cartoes .linha[data-id="k1"]');
  await expect(cartao).toContainText('livre R$ 3.059,50 de R$ 5.000,00');
  await expect(cartao).toContainText('vence 10/11');
  // CDB sem atualização há 30 dias fica em destaque
  await expect(page.locator('#contas .linha[data-id="c2"] .pill.ambar')).toContainText('há 30 dias');
  await expect(page.locator('#status')).toContainText('Backup em dia');
  expect(e).toEqual([]);
});

test('lança uma conta pelo formulário, valida e entende 1.800', async ({ page }) => {
  await page.goto('/');
  await page.locator('#bt-novo').click();
  const dialogo = page.getByRole('dialog', { name: 'Novo lançamento' });
  await expect(dialogo).toBeVisible();
  await expect(page.locator('#f-lancamentos-descricao')).toBeFocused();
  await dialogo.getByRole('button', { name: 'Salvar' }).click();
  await expect(dialogo.locator('.msg')).toHaveText('Preencha “Descrição”.');
  await page.locator('#f-lancamentos-descricao').fill('Aluguel');
  await page.locator('#f-lancamentos-valor').fill('abc');
  await dialogo.getByRole('button', { name: 'Salvar' }).click();
  await expect(dialogo.locator('.msg')).toContainText('precisa ser um valor');
  await expect(page.locator('#f-lancamentos-valor')).toHaveAttribute('aria-invalid', 'true');
  await page.locator('#f-lancamentos-valor').fill('1.800');
  await page.locator('#f-lancamentos-vencimento').fill('2026-11-05');
  await page.locator('#f-lancamentos-recorrencia').selectOption('mensal');
  await page.locator('#f-lancamentos-categoria').fill('Moradia');
  await dialogo.getByRole('button', { name: 'Salvar' }).click();
  await expect(dialogo).toBeHidden();
  await expect(page.locator('.grupo.semana .item')).toContainText('R$ 1.800,00');
  await expect(page.locator('#status')).toContainText('alterações fora do backup');
  // continua lá depois de recarregar
  await page.reload();
  await expect(page.locator('.grupo.semana .item')).toContainText('Aluguel');
  await expect(page.locator('#r-pagar')).toHaveText('R$ 1.800,00');
});

test('campo do cartão só aparece quando a forma é fatura', async ({ page }) => {
  await abrirComDados(page);
  await page.locator('#bt-novo').click();
  const caixa = page.locator('#f-lancamentos-cartaoId');
  await expect(caixa).toBeHidden();
  await page.locator('#f-lancamentos-forma').selectOption('fatura');
  await expect(caixa).toBeVisible();
  await expect(caixa.locator('option')).toHaveText(['Nenhum', 'Nubank']);
});

test('Paguei numa conta mensal cria a do mês seguinte; Desfazer volta', async ({ page }) => {
  await abrirComDados(page);
  await item(page, 'l2').getByRole('button', { name: 'Paguei' }).click();
  await expect(page.locator('#toast')).toContainText('O de dez/2026 já está na lista');
  await expect(item(page, 'l2')).toHaveCount(1); // agora na lista de pagos
  await expect(page.locator('#pagos-box')).toBeVisible();
  await expect(page.locator('#vencimentos .item:has-text("Aluguel")')).toHaveCount(1);
  await expect(page.locator('#meses tr').nth(1).locator('td').nth(3)).toHaveText('R$ 1.800,00');
  await page.locator('#pagos-tit').click();
  await item(page, 'l2').getByRole('button', { name: 'Desfazer' }).click();
  await expect(page.locator('#toast')).toHaveText('Voltou para a lista');
  await expect(page.locator('#vencimentos .item:has-text("Aluguel")')).toHaveCount(1);
  await expect(item(page, 'l2').getByRole('button', { name: 'Paguei' })).toBeVisible();
});

test('editar e excluir pedem confirmação dentro do formulário', async ({ page }) => {
  await abrirComDados(page);
  await item(page, 'l5').getByRole('button', { name: 'Editar Seguro obra' }).click();
  const dialogo = page.getByRole('dialog', { name: 'Editar lançamento' });
  await expect(page.locator('#f-lancamentos-valor')).toHaveValue('210,00');
  const excluir = dialogo.getByRole('button', { name: 'Excluir' });
  await excluir.click();
  await expect(dialogo).toBeVisible();
  await expect(dialogo.getByRole('button', { name: 'Toque de novo para excluir' })).toBeVisible();
  await dialogo.getByRole('button', { name: 'Toque de novo para excluir' }).click();
  await expect(item(page, 'l5')).toHaveCount(0);
});

test('modal: Esc fecha e devolve o foco; Tab fica preso no formulário', async ({ page, browserName }) => {
  await page.goto('/');
  const botao = page.locator('#bt-conta');
  await botao.focus();
  await page.keyboard.press('Enter');
  const dialogo = page.getByRole('dialog');
  await expect(dialogo).toBeVisible();
  for (let i = 0; i < 12; i++) await page.keyboard.press('Tab');
  expect(await page.evaluate(() => !!document.activeElement.closest('.modal'))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(dialogo).toBeHidden();
  if (browserName !== 'webkit') await expect(botao).toBeFocused();
});

test('copiar código do boleto', async ({ page, context, browserName }) => {
  test.skip(browserName !== 'chromium', 'permissão de área de transferência só no Chromium');
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await abrirComDados(page);
  await item(page, 'l1').getByRole('button', { name: 'Copiar código' }).click();
  await expect(page.locator('#toast')).toHaveText('Código copiado');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('84670000001-2 99990000000-1');
});

test('fatura fechou: lança nos vencimentos e zera o ciclo', async ({ page }) => {
  await abrirComDados(page);
  const cartao = page.locator('#cartoes .linha[data-id="k1"]');
  await cartao.getByRole('button', { name: 'Fatura fechou: lançar' }).click();
  await expect(page.locator('#toast')).toContainText('R$ 640,50');
  // somou na fatura de novembro que já existia
  await expect(item(page, 'l3')).toContainText('R$ 1.940,50');
  await expect(cartao).toContainText('R$ 0,00');
  await expect(cartao.getByRole('button', { name: 'Fatura fechou: lançar' })).toHaveCount(0);
});

test('exporta um backup que importa de volta igual', async ({ page }) => {
  await abrirComDados(page);
  await item(page, 'l2').getByRole('button', { name: 'Paguei' }).click();
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#bt-exportar').click()]);
  expect(download.suggestedFilename()).toBe('financeiro-backup.json');
  const json = JSON.parse(await (await download.createReadStream()).toArray().then(b => Buffer.concat(b).toString('utf8')));
  expect(json.versao).toBe(1);
  expect(json.lancamentos).toHaveLength(7);
  expect(json.lancamentos.find(l => l.id === 'l2')).toMatchObject({ pago: true, pagoEm: '2026-10-31' });
  await expect(page.locator('#status')).toContainText('Backup em dia');
  // limpa e importa o exportado
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator('#inicio')).toBeVisible();
  await importar(page, json);
  await expect(page.locator('#toast')).toContainText('7 lançamentos');
  await expect(page.locator('#r-pagar')).toHaveText('R$ 1.429,90');
});

test('importar por cima pede confirmação e avisa quando o backup é mais antigo', async ({ page }) => {
  await abrirComDados(page);
  await item(page, 'l2').getByRole('button', { name: 'Paguei' }).click();
  await importar(page);
  const caixa = page.locator('#confirma');
  await expect(caixa).toBeVisible();
  await expect(caixa).toContainText('mais antigo que as alterações feitas aqui');
  await caixa.getByRole('button', { name: 'Cancelar' }).click();
  await expect(caixa).toBeHidden();
  await expect(page.locator('#pagos-box')).toBeVisible();
  await importar(page);
  await caixa.getByRole('button', { name: 'Substituir' }).click();
  await expect(page.locator('#pagos-box')).toBeVisible(); // o MEI pago no backup
  await expect(item(page, 'l2').getByRole('button', { name: 'Paguei' })).toBeVisible();
});

test('arquivo inválido não apaga nada', async ({ page }) => {
  await abrirComDados(page);
  await importar(page, '{quebrado');
  await expect(page.locator('#toast')).toContainText('Não consegui ler');
  await importar(page, { contas: [null] });
  await expect(page.locator('#toast')).toContainText('Backup com problemas');
  await importar(page, { lancamentos: [{ descricao: 'X', valor: 1, vencimento: 20261110 }] });
  await expect(page.locator('#toast')).toContainText('vencimento válido');
  await expect(page.locator('#r-saldo')).toHaveText('R$ 3.000,00');
});

test('nada transborda na largura da tela', async ({ page }) => {
  await abrirComDados(page);
  for (const largura of [320, 375, 768, 1280]) {
    await page.setViewportSize({ width: largura, height: 800 });
    const sobra = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(sobra, `largura ${largura}`).toBeLessThanOrEqual(0);
  }
  await page.setViewportSize({ width: 320, height: 700 });
  await item(page, 'l1').getByRole('button', { name: /^Editar/ }).click();
  const sobra = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(sobra).toBeLessThanOrEqual(0);
});

test('botões têm tamanho de toque no celular', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'só no celular');
  await abrirComDados(page);
  const alturas = await page.locator('button:visible').evaluateAll(bs => bs.map(b => [b.textContent.trim(), b.getBoundingClientRect().height]));
  for (const [nome, h] of alturas) expect(h, nome).toBeGreaterThanOrEqual(36);
  // ações de lançar ficam fixas embaixo
  const barra = await page.locator('.acoes-topo').boundingBox();
  const vp = page.viewportSize();
  expect(barra.y + barra.height).toBeGreaterThan(vp.height - 2);
});

for (const tema of ['light', 'dark']) {
  test(`acessibilidade sem violações graves (${tema})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: tema });
    await abrirComDados(page);
    await page.locator('#pagos-tit').click();
    const r = await new AxeBuilder({ page }).analyze();
    const graves = r.violations.filter(v => ['serious', 'critical'].includes(v.impact));
    expect(graves.map(v => `${v.id}: ${v.nodes.map(n => n.target).join(' | ')}`)).toEqual([]);
    await page.locator('#bt-novo').click();
    const r2 = await new AxeBuilder({ page }).include('.modal').analyze();
    expect(r2.violations.filter(v => ['serious', 'critical'].includes(v.impact)).map(v => `${v.id}: ${v.nodes.map(n => n.target + ' ' + (n.any[0]?.message || '')).join(' | ')}`)).toEqual([]);
  });
}
