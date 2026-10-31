"""Testes do ferramentas/fin.py. Rodar: python3 -m unittest discover -s tests/unit -p 'test_*.py'"""
import contextlib
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'ferramentas'))
import fin  # noqa: E402


class Base(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.arq = Path(self.dir.name) / 'financeiro-backup.json'

    def tearDown(self):
        self.dir.cleanup()

    def rodar(self, *args):
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            codigo = fin.main(['--arquivo', str(self.arq), *args])
        return codigo, out.getvalue(), err.getvalue()

    def ok(self, *args):
        codigo, out, err = self.rodar(*args)
        self.assertEqual(codigo, 0, err)
        return out

    def falha(self, *args):
        codigo, _, err = self.rodar(*args)
        self.assertEqual(codigo, 1)
        self.assertIn('erro:', err)
        return err

    def dados(self):
        return json.loads(self.arq.read_text(encoding='utf-8'))


class TestValor(unittest.TestCase):
    def test_formatos(self):
        casos = {'182,40': 182.4, '1.234,56': 1234.56, '1234.56': 1234.56, 'R$ 1.800,00': 1800, '1.800': 1800,
                 '1,234.56': 1234.56, '10.5': 10.5, '0,1': 0.1}
        for txt, esperado in casos.items():
            self.assertEqual(fin.valor(txt), esperado, txt)

    def test_invalidos(self):
        for ruim in ('nan', 'inf', '-50', 'abc', '', '1,2,3'):
            with self.assertRaises(fin.Erro, msg=ruim):
                fin.valor(ruim)
        self.assertEqual(fin.valor('-50', negativo=True), -50)

    def test_datas(self):
        self.assertEqual(fin.data('10/11/2026'), '2026-11-10')
        self.assertEqual(fin.data('10/11/26'), '2026-11-10')
        self.assertEqual(fin.data('2026-11-10'), '2026-11-10')
        for ruim in ('31/11/2026', '2026-02-30', 'amanhã', '10-11-2026'):
            with self.assertRaises(fin.Erro, msg=ruim):
                fin.data(ruim)

    def test_proximo_mes_mantem_dia_31(self):
        v, seq = '2026-01-31', []
        for _ in range(4):
            v = fin.proximo_mes(v, 31)
            seq.append(v)
        self.assertEqual(seq, ['2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31'])
        self.assertEqual(fin.proximo_mes('2026-12-10'), '2027-01-10')


class TestComandos(Base):
    def test_fatura_nao_duplica_e_atualiza(self):
        self.ok('fatura', '--cartao', 'Nubank', '--valor', '1.234,56', '--vencimento', '10/11/2026',
                '--fechamento', '03/11/2026', '--minimo', '185,19', '--limite', '8.000')
        self.ok('fatura', '--cartao', 'nubank', '--valor', '1300', '--vencimento', '2026-11-10')
        d = self.dados()
        self.assertEqual(len(d['cartoes']), 1)
        self.assertEqual(len(d['lancamentos']), 1)
        f, c = d['lancamentos'][0], d['cartoes'][0]
        self.assertEqual((f['valor'], f['forma'], f['cartaoId']), (1300, 'fatura', c['id']))
        self.assertEqual((c['limite'], c['diaVencimento'], c['diaFechamento']), (8000, 10, 3))

    def test_fatura_adiada_nao_muda_dia_do_cartao(self):
        self.ok('fatura', '--cartao', 'Nubank', '--valor', '100', '--vencimento', '10/11/2026')
        self.ok('fatura', '--cartao', 'Nubank', '--valor', '100', '--vencimento', '12/01/2027')
        self.assertEqual(self.dados()['cartoes'][0]['diaVencimento'], 10)

    def test_fatura_reaproveita_lancada_no_site_sem_cartao(self):
        self.arq.write_text(json.dumps({'versao': 1, 'cartoes': [], 'contas': [], 'lancamentos': [
            {'id': 'x', 'descricao': 'Fatura Nubank', 'valor': 50, 'vencimento': '2026-11-10', 'forma': 'fatura',
             'natureza': 'pagar', 'pago': False}]}), encoding='utf-8')
        self.ok('fatura', '--cartao', 'Nubank', '--valor', '900', '--vencimento', '10/11/2026')
        d = self.dados()
        self.assertEqual(len(d['lancamentos']), 1)
        self.assertEqual(d['lancamentos'][0]['valor'], 900)
        self.assertEqual(d['lancamentos'][0]['cartaoId'], d['cartoes'][0]['id'])

    def test_conta_mensal_paga_gera_proxima_sem_duplicar(self):
        self.ok('conta', '--descricao', 'Luz', '--valor', '120', '--vencimento', '10/11/2026', '--mensal')
        self.ok('conta', '--descricao', 'Luz', '--valor', '100', '--vencimento', '10/12/2026')
        self.ok('pago', '--descricao', 'luz', '--mes', '2026-11')
        d = self.dados()
        self.assertEqual(len(d['lancamentos']), 2)
        dez = next(x for x in d['lancamentos'] if x['vencimento'] == '2026-12-10')
        self.assertEqual(dez['valor'], 100)
        self.assertTrue(dez['origem'])

    def test_conta_mensal_dia_31(self):
        self.ok('conta', '--descricao', 'Condomínio', '--valor', '500', '--vencimento', '31/01/2027', '--mensal')
        self.ok('pago', '--descricao', 'Condomínio')
        self.ok('pago', '--descricao', 'Condomínio')
        vencs = sorted(x['vencimento'] for x in self.dados()['lancamentos'])
        self.assertEqual(vencs, ['2027-01-31', '2027-02-28', '2027-03-31'])

    def test_conta_mesma_do_mes_atualiza(self):
        self.ok('conta', '--descricao', 'Claro', '--valor', '129,90', '--vencimento', '20/11/2026')
        self.ok('conta', '--descricao', 'claro', '--valor', '139,90', '--vencimento', '21/11/2026')
        d = self.dados()
        self.assertEqual(len(d['lancamentos']), 1)
        self.assertEqual(d['lancamentos'][0]['valor'], 139.9)

    def test_pago_exige_descricao_e_prefere_igualdade(self):
        self.ok('conta', '--descricao', 'MEI', '--valor', '75,60', '--vencimento', '20/11/2026')
        self.ok('conta', '--descricao', 'MEI atrasado', '--valor', '75,60', '--vencimento', '20/12/2026')
        self.falha('pago', '--descricao', '')
        self.ok('pago', '--descricao', 'MEI')
        pagos = [x['descricao'] for x in self.dados()['lancamentos'] if x['pago']]
        self.assertEqual(pagos, ['MEI'])
        self.falha('pago', '--descricao', 'inexistente')

    def test_saldo_aceita_negativo(self):
        self.ok('saldo', '--conta', 'Itaú', '--valor', '-120,50')
        self.ok('saldo', '--conta', 'itaú', '--valor', '2.350,00')
        d = self.dados()
        self.assertEqual(len(d['contas']), 1)
        self.assertEqual(d['contas'][0]['saldo'], 2350)

    def test_erros_nao_gravam_nada(self):
        self.falha('conta', '--descricao', 'X', '--valor', 'nan', '--vencimento', '10/11/2026')
        self.falha('conta', '--descricao', 'X', '--valor', '10', '--vencimento', '31/11/2026')
        self.assertFalse(self.arq.exists())

    def test_json_sempre_valido_e_com_historico(self):
        self.ok('saldo', '--conta', 'A', '--valor', '1')
        self.ok('saldo', '--conta', 'A', '--valor', '2')
        self.ok('saldo', '--conta', 'A', '--valor', '3')
        json.loads(self.arq.read_text(encoding='utf-8'), parse_constant=lambda c: self.fail(c))
        self.assertEqual(len(list((self.arq.parent / 'historico').glob('*.json'))), 2)
        self.assertTrue(self.dados()['salvoEm'].endswith('Z'))

    def test_backup_corrompido_da_erro_claro(self):
        self.arq.write_text('{ruim', encoding='utf-8')
        self.assertIn('não é um JSON válido', self.falha('resumo'))
        self.arq.write_text('{"contas": [null]}', encoding='utf-8')
        self.assertIn('lista de registros', self.falha('resumo'))

    def test_resumo_soma_faturas_e_contas(self):
        self.ok('fatura', '--cartao', 'Nubank', '--valor', '1300', '--vencimento', '10/11/2026')
        self.ok('fatura', '--cartao', 'Itaú', '--valor', '820,10', '--vencimento', '15/11/2026')
        self.ok('conta', '--descricao', 'Aluguel', '--valor', '1.800', '--vencimento', '05/11/2026')
        out = self.ok('resumo', '--mes', '2026-11')
        self.assertIn('total R$ 3.920,10', out)
        self.assertIn('Faturas de cartão: R$ 2.120,10', out)
        self.assertIn('Contas: R$ 1.800,00', out)


if __name__ == '__main__':
    unittest.main()
