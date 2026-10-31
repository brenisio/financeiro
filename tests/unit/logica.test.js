import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseValor, valorParaCampo, dias, somaMeses, proximoMes, proximoDia, quando, ehData,
  deBackup, paraBackup, backupPendente, vazio, adicionar, pagar, desfazer, fecharFatura,
  resumo, grupos, porMes, disponivel, pagosRecentes, brl
} from '../../js/logica.js';

const HOJE = '2026-10-31';
const lanc = (id, dados) => ({ id, dados: { natureza: 'pagar', forma: 'boleto', pago: false, pagoEm: null, ...dados } });
const estado = (parcial = {}) => ({ ...vazio(), ...parcial });

test('parseValor entende os formatos de dinheiro', () => {
  const casos = {
    '182,40': 182.4, '1.234,56': 1234.56, '1234.56': 1234.56, 'R$ 1.800,00': 1800, '1.800': 1800,
    '1.234.567': 1234567, '1,234.56': 1234.56, '0,1': 0.1, '-50': -50, ' 99 ': 99, '10.5': 10.5, 'R$ 12,00': 12
  };
  for (const [txt, esperado] of Object.entries(casos)) assert.equal(parseValor(txt), esperado, txt);
  for (const ruim of ['', 'abc', '1,2,3', '12a', 'NaN', 'Infinity', null, undefined]) assert.ok(Number.isNaN(parseValor(ruim)), String(ruim));
  assert.equal(parseValor('0,105'), 0.11);
});

test('valorParaCampo volta no formato brasileiro', () => {
  assert.equal(valorParaCampo(1234.5), '1234,50');
  assert.equal(valorParaCampo(null), '');
  assert.equal(parseValor(valorParaCampo(1800)), 1800);
});

test('brl formata em reais', () => {
  assert.equal(brl(1234.5), 'R$ 1.234,50');
  assert.equal(brl('x'), 'R$ 0,00');
});

test('datas: dias, meses e validação', () => {
  assert.equal(dias('2026-10-31', '2026-11-01'), 1);
  assert.equal(dias('2026-02-28', '2026-03-01'), 1);
  assert.equal(dias('2026-12-31', '2027-01-01'), 1);
  assert.equal(dias('2026-11-10', '2026-11-01'), -9);
  assert.equal(somaMeses('2026-01-31', 1), '2026-02-28');
  assert.equal(somaMeses('2026-12-15', 1), '2027-01-15');
  assert.equal(somaMeses('2026-01-15', -1), '2025-12-15');
  assert.ok(ehData('2026-02-28'));
  assert.ok(!ehData('2026-02-30'));
  assert.ok(!ehData('31/10/2026'));
  assert.ok(!ehData(20261031));
  assert.equal(quando('2026-10-31', HOJE), 'hoje');
  assert.equal(quando('2026-11-01', HOJE), 'amanhã');
  assert.equal(quando('2026-10-25', HOJE), 'há 6 dias');
});

test('recorrência mensal mantém o dia 31 depois de fevereiro', () => {
  let v = '2026-01-31';
  const seq = [];
  for (let i = 0; i < 4; i++) { v = proximoMes(v, 31); seq.push(v); }
  assert.deepEqual(seq, ['2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31']);
  assert.equal(proximoMes('2026-12-10', 10), '2027-01-10');
  assert.equal(proximoMes('2028-01-30', 30), '2028-02-29');
});

test('proximoDia acha o próximo vencimento do cartão', () => {
  assert.equal(proximoDia(10, '2026-10-31'), '2026-11-10');
  assert.equal(proximoDia(31, '2026-10-31'), '2026-10-31');
  assert.equal(proximoDia(31, '2026-11-01'), '2026-11-30');
  assert.equal(proximoDia(5, '2026-12-20'), '2027-01-05');
});

test('deBackup valida e converte; paraBackup faz o caminho de volta', () => {
  const obj = { versao: 1, salvoEm: '2026-10-31T10:00:00.000Z',
    lancamentos: [{ id: 'a', descricao: 'Luz', valor: '182.4', vencimento: '2026-11-10', pago: 'sim' }],
    contas: [{ id: 'c', nome: 'Itaú', saldo: 100 }], cartoes: [] };
  const st = deBackup(obj);
  assert.equal(st.lancamentos[0].dados.valor, 182.4);
  assert.equal(st.lancamentos[0].dados.natureza, 'pagar');
  assert.equal(st.lancamentos[0].dados.pago, false);
  const volta = paraBackup(st, new Date('2026-10-31T12:00:00Z'));
  assert.equal(volta.salvoEm, '2026-10-31T12:00:00.000Z');
  assert.deepEqual(deBackup(volta), st);
});

test('deBackup recusa arquivos ruins sem mexer em nada', () => {
  assert.throws(() => deBackup(null), /não é um backup/);
  assert.throws(() => deBackup([]), /não é um backup/);
  assert.throws(() => deBackup({ foo: 1 }), /não é um backup/);
  assert.throws(() => deBackup({ contas: [null] }), /não é um registro/);
  assert.throws(() => deBackup({ lancamentos: [{ descricao: 'X', valor: 1, vencimento: 20261110 }] }), /vencimento/);
  assert.throws(() => deBackup({ lancamentos: [{ descricao: 'X', valor: 1, vencimento: '2026-02-30' }] }), /vencimento/);
});

test('deBackup gera ids que faltam e resolve ids repetidos', () => {
  const st = deBackup({ lancamentos: [
    { id: 'x', descricao: 'A', valor: 1, vencimento: '2026-11-01' },
    { id: 'x', descricao: 'B', valor: 1, vencimento: '2026-11-01' },
    { descricao: 'C', valor: 1, vencimento: '2026-11-01' }] });
  const ids = st.lancamentos.map(l => l.id);
  assert.equal(new Set(ids).size, 3);
  assert.equal(ids[0], 'x');
});

test('backupPendente', () => {
  assert.equal(backupPendente({ alteradoEm: null, exportadoEm: null }), false);
  assert.equal(backupPendente({ alteradoEm: '2026-10-31T10:00:00.000Z', exportadoEm: null }), true);
  assert.equal(backupPendente({ alteradoEm: '2026-10-31T10:00:00.000Z', exportadoEm: '2026-10-31T11:00:00.000Z' }), false);
  assert.equal(backupPendente({ alteradoEm: '2026-10-31T12:00:00.000Z', exportadoEm: '2026-10-31T11:00:00.000Z' }), true);
});

test('pagar conta mensal cria a do mês seguinte uma vez só', () => {
  let st = estado({ lancamentos: [lanc('a', { descricao: 'Aluguel', valor: 1800, vencimento: '2026-11-05', recorrencia: 'mensal', codigo: '123' })] });
  const r = pagar(st, 'a', '2026-11-04', 'b');
  st = r.st;
  assert.equal(st.lancamentos.length, 2);
  const prox = st.lancamentos.find(l => l.id === 'b').dados;
  assert.equal(prox.vencimento, '2026-12-05');
  assert.equal(prox.origem, 'a');
  assert.equal(prox.codigo, '');
  assert.equal(prox.pago, false);
  assert.equal(st.lancamentos.find(l => l.id === 'a').dados.pagoEm, '2026-11-04');
  // pagar de novo não faz nada
  assert.equal(pagar(st, 'a', '2026-11-04', 'c').st, st);
  // desfazer tira o gerado; pagar de novo recria um só
  st = desfazer(st, 'a');
  assert.equal(st.lancamentos.length, 1);
  st = pagar(st, 'a', '2026-11-04', 'd').st;
  assert.equal(st.lancamentos.length, 2);
});

test('pagar não duplica se o mês seguinte já foi lançado à mão', () => {
  let st = estado({ lancamentos: [
    lanc('nov', { descricao: 'Luz', valor: 120, vencimento: '2026-11-10', recorrencia: 'mensal' }),
    lanc('dez', { descricao: 'luz ', valor: 100, vencimento: '2026-12-10' })] });
  st = pagar(st, 'nov', '2026-11-10', 'novo').st;
  assert.equal(st.lancamentos.length, 2);
  assert.equal(st.lancamentos.find(l => l.id === 'dez').dados.origem, 'nov');
});

test('desfazer mantém o mês seguinte se ele já foi alterado', () => {
  let st = estado({ lancamentos: [lanc('a', { descricao: 'Claro', valor: 129.9, vencimento: '2026-11-20', recorrencia: 'mensal' })] });
  st = pagar(st, 'a', '2026-11-20', 'b').st;
  st = { ...st, lancamentos: st.lancamentos.map(l => l.id === 'b' ? { id: 'b', dados: { ...l.dados, valor: 139.9 } } : l) };
  st = desfazer(st, 'a');
  assert.equal(st.lancamentos.length, 2);
});

test('fecharFatura lança, soma na fatura já lançada e zera o ciclo', () => {
  let st = estado({ cartoes: [{ id: 'nu', dados: { nome: 'Nubank', limite: 5000, fatura: 1200, diaVencimento: 10 } }] });
  const r = fecharFatura(st, 'nu', HOJE, 'f1');
  assert.equal(r.vencimento, '2026-11-10');
  st = r.st;
  const f = st.lancamentos[0].dados;
  assert.equal(f.valor, 1200); assert.equal(f.forma, 'fatura'); assert.equal(f.cartaoId, 'nu');
  assert.equal(st.cartoes[0].dados.fatura, 0);
  assert.equal(disponivel(st, st.cartoes[0]), 3800);
  assert.equal(fecharFatura(st, 'nu', HOJE), null);
  // fatura lançada antes pelo fin.py (sem cartaoId) é reaproveitada
  let st2 = estado({ cartoes: [{ id: 'nu', dados: { nome: 'Nubank', limite: 0, fatura: 50, diaVencimento: 10 } }],
    lancamentos: [lanc('x', { descricao: 'Fatura Nubank', valor: 100, vencimento: '2026-11-10', forma: 'fatura' })] });
  st2 = fecharFatura(st2, 'nu', HOJE).st;
  assert.equal(st2.lancamentos.length, 1);
  assert.equal(st2.lancamentos[0].dados.valor, 150);
});

test('resumo, grupos e soma por mês', () => {
  const st = estado({
    contas: [{ id: 'c1', dados: { nome: 'Itaú', tipo: 'corrente', saldo: 3000 } }, { id: 'c2', dados: { nome: 'CDB', tipo: 'investimento', saldo: 10000 } }],
    lancamentos: [
      lanc('atr', { descricao: 'Claro', valor: 129.9, vencimento: '2026-10-20' }),
      lanc('hoje', { descricao: 'MEI', valor: 75.6, vencimento: '2026-10-31' }),
      lanc('fat', { descricao: 'Fatura Nubank', valor: 1300, vencimento: '2026-11-10', forma: 'fatura' }),
      lanc('alu', { descricao: 'Aluguel', valor: 1800, vencimento: '2026-11-05', pago: true, pagoEm: '2026-10-30' }),
      lanc('rec', { descricao: 'Freela', valor: 500, vencimento: '2026-11-15', natureza: 'receber' }),
      lanc('dez', { descricao: 'Seguro obra', valor: 210, vencimento: '2026-12-15' })
    ] });
  const r = resumo(st, HOJE);
  assert.equal(r.saldo, 3000);
  assert.equal(r.investido, 10000);
  assert.equal(r.atrasado, 129.9);
  assert.equal(r.nAtrasados, 1);
  assert.equal(r.pagar30, 129.9 + 75.6 + 1300);
  assert.equal(r.receber30, 500);
  assert.equal(r.sobra, Math.round((3000 + 500 - 129.9 - 75.6 - 1300) * 100) / 100);

  assert.deepEqual(grupos(st, HOJE).map(g => [g.chave, g.itens.map(l => l.id)]),
    [['atrasado', ['atr']], ['semana', ['hoje']], ['mes', ['fat', 'rec']], ['depois', ['dez']]]);

  const meses = porMes(st, HOJE);
  assert.deepEqual(meses.map(m => m.mes), ['2026-10', '2026-11', '2026-12']);
  const nov = meses[1];
  assert.equal(nov.faturas, 1300); assert.equal(nov.contas, 1800); assert.equal(nov.total, 3100);
  assert.equal(nov.pago, 1800); assert.equal(nov.falta, 1300);
  assert.ok(meses[0].atual === true && meses[0].falta === 205.5);
  assert.deepEqual(pagosRecentes(st, HOJE).map(l => l.id), ['alu']);
});

test('porMes inclui mês antigo com atraso fora da janela', () => {
  const st = estado({ lancamentos: [lanc('v', { descricao: 'IPTU', valor: 300, vencimento: '2026-03-10' })] });
  assert.deepEqual(porMes(st, HOJE).map(m => m.mes), ['2026-03']);
});

test('adicionar não altera o estado original', () => {
  const st = vazio();
  const novo = adicionar(st, 'contas', { nome: 'X', saldo: 1 }, 'id1');
  assert.equal(st.contas.length, 0);
  assert.equal(novo.contas[0].id, 'id1');
});
