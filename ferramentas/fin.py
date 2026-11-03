#!/usr/bin/env python3
"""Mantém o backup do Financeiro (dados/financeiro-backup.json), o mesmo arquivo que o site importa.

Só stdlib. Toda escrita guarda antes uma cópia em dados/historico/.
Lançar a mesma fatura ou conta de novo atualiza o registro do mês em vez de duplicar.

Exemplos:
  fin.py fatura --cartao "Nubank" --valor 1234,56 --vencimento 10/11/2026 --fechamento 03/11/2026 --minimo 185,19
  fin.py conta --descricao "Aluguel" --valor 1800 --vencimento 05/11/2026 --categoria Moradia --mensal
  fin.py saldo --conta "Itaú corrente" --valor 2350,00
  fin.py pago --descricao "Aluguel" --em 05/11/2026
  fin.py resumo            # mês atual e próximos 2
  fin.py resumo --mes 2026-11
"""
import argparse
import json
import math
import os
import re
import random
import shutil
import string
import sys
import time
import unicodedata
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
ARQUIVO_PADRAO = RAIZ / 'dados' / 'financeiro-backup.json'
COLECOES = ('lancamentos', 'contas', 'cartoes')
FORMAS = ('boleto', 'pix', 'debito', 'fatura', 'transferencia', 'outro')


# ---------- utilitários ----------

def norm(s):
    return unicodedata.normalize('NFKD', str(s or '')).encode('ascii', 'ignore').decode().casefold().strip()


def novo_id():
    ms, base, out = int(time.time() * 1000), string.digits + string.ascii_lowercase, ''
    while ms:
        ms, r = divmod(ms, 36)
        out = base[r] + out
    return out + ''.join(random.choices(base, k=5))


def hoje():
    return date.today().isoformat()


class Erro(Exception):
    """Erro de uso: vira mensagem curta, sem traceback."""


def valor(txt, negativo=False):
    """'1.234,56' | '1234.56' | 'R$ 182,40' | '1.800' (milhar) | '1,234.56' -> float com 2 casas."""
    s = re.sub(r'R\$|\s|\xa0', '', str(txt))
    if ',' in s and '.' in s and s.rfind('.') > s.rfind(','):
        s = s.replace(',', '')
    elif ',' in s:
        s = s.replace('.', '').replace(',', '.')
    elif re.fullmatch(r'-?\d{1,3}(\.\d{3})+', s):
        s = s.replace('.', '')
    if not re.fullmatch(r'-?\d+(\.\d+)?', s):
        raise Erro(f'Valor inválido: {txt!r}. Use algo como 1.234,56.')
    v = round(float(s), 2)
    if not math.isfinite(v) or (v < 0 and not negativo):
        raise Erro(f'Valor inválido: {txt!r}.')
    return v


def data(txt):
    """'2026-11-10', '10/11/2026', '10/11/26' -> '2026-11-10'."""
    s = str(txt).strip()
    try:
        if re.fullmatch(r'\d{4}-\d{2}-\d{2}', s):
            return date.fromisoformat(s).isoformat()
        partes = s.split('/')
        if len(partes) == 2:  # 10/11 → próximo 10/11 a partir de hoje
            h = date.today()
            d = date(h.year, int(partes[1]), int(partes[0]))
            return (d if d >= h else date(h.year + 1, d.month, d.day)).isoformat()
        d, m, y = partes
        y = int(y)
        if y < 100:
            y += 2000
        return date(y, int(m), int(d)).isoformat()
    except ValueError:
        raise Erro(f'Data inválida: {txt!r}. Use DD/MM/AAAA.') from None


def ultimo_dia(y, m):
    return ((date(y + 1, 1, 1) if m == 12 else date(y, m + 1, 1)) - date(y, m, 1)).days


def proximo_mes(iso, dia_base=None):
    """Mesmo dia no mês seguinte; dia_base mantém 31 depois de um fevereiro (31/01 → 28/02 → 31/03)."""
    y, m, d = map(int, iso.split('-'))
    y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    return date(y, m, min(dia_base or d, ultimo_dia(y, m))).isoformat()


def brl(v):
    s = f'{abs(v):,.2f}'.replace(',', 'X').replace('.', ',').replace('X', '.')
    return ('-' if v < 0 else '') + 'R$ ' + s


# ---------- arquivo ----------

def carregar(caminho):
    if not caminho.exists():
        return {'versao': 1, 'salvoEm': None, **{c: [] for c in COLECOES}}
    try:
        d = json.loads(caminho.read_text(encoding='utf-8'))
    except json.JSONDecodeError as e:
        raise Erro(f'{caminho} não é um JSON válido ({e.msg}, linha {e.lineno}).') from None
    if not isinstance(d, dict):
        raise Erro(f'{caminho} não é um backup do Financeiro.')
    for c in COLECOES:
        d.setdefault(c, [])
        if not isinstance(d[c], list) or not all(isinstance(x, dict) for x in d[c]):
            raise Erro(f'{caminho}: "{c}" precisa ser uma lista de registros.')
    return d


def gravar(caminho, d):
    caminho.parent.mkdir(parents=True, exist_ok=True)
    if caminho.exists():
        hist = caminho.parent / 'historico'
        hist.mkdir(exist_ok=True)
        shutil.copy2(caminho, hist / f'{caminho.stem}-{datetime.now():%Y%m%d-%H%M%S-%f}.json')
    d['salvoEm'] = datetime.now(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')
    texto = json.dumps(d, ensure_ascii=False, indent=2, allow_nan=False) + '\n'
    tmp = caminho.with_suffix('.tmp')
    tmp.write_text(texto, encoding='utf-8')
    os.replace(tmp, caminho)  # troca atômica: nunca deixa o backup pela metade


def achar(lista, nome):
    alvo = norm(nome)
    return next((x for x in lista if norm(x.get('nome')) == alvo), None)


def aplicar_outro(novo, a):
    """--outro-nome/--outro-valor: parte do boleto que é de outra pessoa (ex.: cartão adicional da Agatha)."""
    if getattr(a, 'outro_valor', None) is None:
        if getattr(a, 'outro_nome', None):
            raise Erro('Informe também --outro-valor.')
        return
    v = valor(a.outro_valor)
    if v > novo['valor']:
        raise Erro('A parte de outra pessoa não pode passar do valor total.')
    if v and not (a.outro_nome or '').strip():
        raise Erro('Informe de quem é a parte com --outro-nome.')
    novo['outroValor'] = v
    novo['outroNome'] = (a.outro_nome or '').strip() if v else ''


def parte_minha(x):
    return round((x.get('valor') or 0) - (x.get('outroValor') or 0), 2)


# ---------- comandos ----------

def cmd_cartao(d, a, quieto=False):
    c = achar(d['cartoes'], a.cartao)
    if not c:
        c = {'id': novo_id(), 'nome': a.cartao, 'limite': 0, 'fatura': 0, 'diaFechamento': None, 'diaVencimento': None}
        d['cartoes'].append(c)
        acao = 'criado'
    else:
        acao = 'atualizado'
    if getattr(a, 'limite', None) is not None:
        c['limite'] = valor(a.limite)
    if getattr(a, 'fatura_aberta', None) is not None:
        c['fatura'] = valor(a.fatura_aberta)
    for campo, attr in (('diaFechamento', 'dia_fechamento'), ('diaVencimento', 'dia_vencimento')):
        dia = getattr(a, attr, None)
        if dia is None:
            continue
        if not 1 <= int(dia) <= 31:
            raise Erro(f'Dia inválido: {dia}.')
        if not getattr(a, 'so_se_vazio', False) or not c.get(campo):
            c[campo] = int(dia)
    c['atualizadoEm'] = hoje()
    if not quieto:
        print(f'Cartão {c["nome"]} {acao}.')
    return c


def cmd_fatura(d, a):
    venc = data(a.vencimento)
    # dias do cartão vindos da fatura só preenchem o que está vazio (vencimento adiado por feriado não muda o cartão)
    a.so_se_vazio = a.dia_vencimento is None and a.dia_fechamento is None
    a.dia_vencimento = a.dia_vencimento or int(venc[8:])
    if a.fechamento:
        a.dia_fechamento = a.dia_fechamento or int(data(a.fechamento)[8:])
    c = cmd_cartao(d, a, quieto=True)
    l = next((x for x in d['lancamentos'] if x.get('forma') == 'fatura' and str(x.get('vencimento', ''))[:7] == venc[:7]
              and (x.get('cartaoId') == c['id'] or (not x.get('cartaoId') and norm(x.get('descricao')) == norm('Fatura ' + c['nome'])))), None)
    obs = [f'mínimo {brl(valor(a.minimo))}' if a.minimo else None,
           f'fechou {data(a.fechamento)[8:]}/{data(a.fechamento)[5:7]}' if a.fechamento else None,
           a.obs]
    novo = {'descricao': f'Fatura {c["nome"]}', 'valor': valor(a.valor), 'vencimento': venc,
            'natureza': 'pagar', 'forma': 'fatura', 'categoria': 'Cartão', 'recorrencia': '',
            'cartaoId': c['id'], 'obs': ' · '.join(x for x in obs if x)}
    if a.codigo:
        novo['codigo'] = a.codigo
    aplicar_outro(novo, a)
    if l:
        if 'outroValor' not in novo and (l.get('outroValor') or 0) > novo['valor']:
            raise Erro('O valor novo é menor que a parte de outra pessoa já lançada; informe --outro-valor.')
        l.update(novo)
        print(f'Fatura {c["nome"]} de {venc[5:7]}/{venc[:4]} atualizada: {brl(novo["valor"])}, vence {venc}.')
    else:
        d['lancamentos'].append({'id': novo_id(), **novo, 'codigo': a.codigo or '', 'pago': False, 'pagoEm': None})
        print(f'Fatura {c["nome"]} lançada: {brl(novo["valor"])}, vence {venc}.')


def cmd_conta(d, a):
    venc = data(a.vencimento)
    natureza = 'receber' if a.receber else 'pagar'
    l = next((x for x in d['lancamentos'] if norm(x.get('descricao')) == norm(a.descricao)
              and x.get('natureza', 'pagar') == natureza and str(x.get('vencimento', ''))[:7] == venc[:7]), None)
    novo = {'descricao': a.descricao, 'valor': valor(a.valor), 'vencimento': venc, 'natureza': natureza}
    for campo in ('categoria', 'forma', 'codigo', 'obs'):
        if getattr(a, campo) is not None:
            novo[campo] = getattr(a, campo)
    if a.mensal:
        novo['recorrencia'] = 'mensal'
        novo['diaBase'] = int(venc[8:])
    aplicar_outro(novo, a)
    if l:
        if 'outroValor' not in novo and (l.get('outroValor') or 0) > novo['valor']:
            raise Erro('O valor novo é menor que a parte de outra pessoa já lançada; informe --outro-valor.')
        l.update(novo)
        print(f'{a.descricao} de {venc[5:7]}/{venc[:4]} atualizada: {brl(novo["valor"])}, vence {venc}.')
    else:
        base = {'id': novo_id(), 'forma': 'boleto', 'categoria': '', 'recorrencia': '', 'codigo': '', 'obs': '',
                'pago': False, 'pagoEm': None}
        d['lancamentos'].append({**base, **novo})
        print(f'{a.descricao} lançada: {brl(novo["valor"])}, vence {venc}.')


def cmd_saldo(d, a):
    c = achar(d['contas'], a.conta)
    if not c:
        c = {'id': novo_id(), 'nome': a.conta, 'tipo': a.tipo or 'corrente'}
        d['contas'].append(c)
    elif a.tipo:
        c['tipo'] = a.tipo
    if a.banco and a.banco.strip():
        c['banco'] = a.banco.strip()
    c['saldo'] = valor(a.valor, negativo=True)
    c['atualizadoEm'] = hoje()
    print(f'Saldo {c["nome"]}: {brl(c["saldo"])}.')


def cmd_pago(d, a):
    abertos = [x for x in d['lancamentos'] if not x.get('pago')]
    if a.id:
        alvo = [x for x in abertos if x['id'] == a.id]
    else:
        if not norm(a.descricao):
            raise Erro('Informe a descrição.')
        alvo = [x for x in abertos if norm(x.get('descricao')) == norm(a.descricao)] \
            or [x for x in abertos if norm(a.descricao) in norm(x.get('descricao'))]
    if a.mes:
        alvo = [x for x in alvo if str(x.get('vencimento', ''))[:7] == a.mes]
    if not alvo:
        raise Erro('Nenhum lançamento em aberto encontrado.')
    alvo.sort(key=lambda x: x.get('vencimento', ''))
    if len({x['descricao'] for x in alvo}) > 1:
        raise Erro('Mais de um lançamento combina: ' + '; '.join(f'{x["descricao"]} ({x["vencimento"]}, id {x["id"]})' for x in alvo))
    l = alvo[0]
    l['pago'], l['pagoEm'] = True, data(a.em) if a.em else hoje()
    print(f'{l["descricao"]} ({l["vencimento"]}) marcado como pago em {l["pagoEm"]}.')
    if l.get('recorrencia') == 'mensal' and not any(x.get('origem') == l['id'] for x in d['lancamentos']):
        dia_base = l.get('diaBase') or int(l['vencimento'][8:])
        venc = proximo_mes(l['vencimento'], dia_base)
        ja = next((x for x in d['lancamentos'] if x is not l and norm(x.get('descricao')) == norm(l.get('descricao'))
                   and x.get('natureza', 'pagar') == l.get('natureza', 'pagar') and str(x.get('vencimento', ''))[:7] == venc[:7]), None)
        if ja:
            ja['origem'] = l['id']
            print(f'O de {venc[5:7]}/{venc[:4]} já estava lançado.')
        else:
            d['lancamentos'].append({**l, 'id': novo_id(), 'vencimento': venc, 'diaBase': dia_base, 'pago': False,
                                     'pagoEm': None, 'origem': l['id'], 'codigo': ''})
            print(f'Próximo criado para {venc}.')


def meses_padrao():
    h = date.today()
    out = []
    for i in range(3):
        y, m = h.year + (h.month - 1 + i) // 12, (h.month - 1 + i) % 12 + 1
        out.append(f'{y}-{m:02d}')
    return out


def por_banco(contas):
    """Mesmo agrupamento de porBanco (logica.js): banco (ou nome), do maior para o menor saldo."""
    grupos = {}
    for c in contas:
        banco = str(c.get('banco') or '').strip() or str(c.get('nome') or '').strip() or 'Sem nome'
        g = grupos.setdefault(norm(banco), {'banco': banco, 'total': 0, 'contas': []})
        g['total'] = round(g['total'] + (c.get('saldo') or 0), 2)
        g['contas'].append(c)
    return sorted(grupos.values(), key=lambda g: (-g['total'], g['banco']))


def cmd_resumo(d, a):
    h = hoje()
    soma = lambda cs: round(sum(c.get('saldo') or 0 for c in cs), 2)
    inv = [c for c in d['contas'] if c.get('tipo') == 'investimento']
    print(f'Backup salvo em {d.get("salvoEm") or "—"}')
    print(f'Total: {brl(soma(d["contas"]))} (em conta {brl(soma(d["contas"]) - soma(inv))} · investido {brl(soma(inv))})')
    for g in por_banco(d['contas']):
        print(f'  {g["banco"]}: {brl(g["total"])}')
        for c in g['contas']:
            print(f'    {c["nome"]}: {brl(c.get("saldo") or 0)} ({c.get("tipo", "corrente")}, atualizado {c.get("atualizadoEm", "?")})')
    atrasados = [x for x in d['lancamentos'] if not x.get('pago') and x.get('natureza', 'pagar') == 'pagar' and str(x.get('vencimento', '')) < h]
    if atrasados:
        print(f'\nATRASADOS: {brl(sum(x["valor"] for x in atrasados))}')
        for x in sorted(atrasados, key=lambda x: x['vencimento']):
            print(f'  {x["vencimento"]}  {x["descricao"]}: {brl(x["valor"])}')
    for mes in ([a.mes] if a.mes else meses_padrao()):
        itens = sorted((x for x in d['lancamentos'] if x.get('natureza', 'pagar') == 'pagar'
                        and str(x.get('vencimento', ''))[:7] == mes), key=lambda x: x['vencimento'])
        fat = [x for x in itens if x.get('forma') == 'fatura']
        cts = [x for x in itens if x.get('forma') != 'fatura']
        tot = lambda xs: sum(x['valor'] for x in xs)
        falta = tot(x for x in itens if not x.get('pago'))
        print(f'\n== {mes[5:]}/{mes[:4]} ==  total {brl(tot(itens))} · falta pagar {brl(falta)}')
        outros = {}
        for x in itens:
            if x.get('outroValor'):
                outros[x.get('outroNome') or 'outra pessoa'] = outros.get(x.get('outroNome') or 'outra pessoa', 0) + x['outroValor']
        if outros:
            print(f'  Sua parte: {brl(sum(parte_minha(x) for x in itens))}' + ''.join(f' · {n}: {brl(v)}' for n, v in outros.items()))
        for titulo, grupo in (('Faturas de cartão', fat), ('Contas', cts)):
            print(f'  {titulo}: {brl(tot(grupo))}')
            for x in grupo:
                marca = 'pago' if x.get('pago') else 'aberto'
                parte = f'  (sua parte {brl(parte_minha(x))}, {x.get("outroNome")} {brl(x["outroValor"])})' if x.get('outroValor') else ''
                print(f'    {x["vencimento"][8:]}/{x["vencimento"][5:7]}  {x["descricao"]:<28} {brl(x["valor"]):>14}  {marca}{parte}')
        receber = [x for x in d['lancamentos'] if x.get('natureza') == 'receber' and str(x.get('vencimento', ''))[:7] == mes]
        if receber:
            print(f'  A receber: {brl(tot(receber))}')


# ---------- agenda (.ics) — mesmas regras de paraIcs em js/logica.js ----------

def ics_texto(s):
    return str(s or '').replace('\\', '\\\\').replace(';', '\\;').replace(',', '\\,').replace('\r\n', '\n').replace('\n', '\\n')


def ics_dobra(linha):
    partes, atual, n = [], '', 0
    for ch in linha:
        b = len(ch.encode('utf-8'))
        if n + b > (74 if partes else 75):
            partes.append(atual)
            atual, n = '', 0
        atual += ch
        n += b
    partes.append(atual)
    return '\r\n '.join(partes)


def soma_dias(iso, n):
    return (date.fromisoformat(iso) + timedelta(days=n)).isoformat()


def para_ics(d, h, agora=None):
    agora = agora or datetime.now(timezone.utc)
    desde = soma_dias(h, -60)
    its = sorted((x for x in d['lancamentos'] if str(x.get('vencimento', '')) >= desde or not x.get('pago')),
                 key=lambda x: x['vencimento'])
    linhas = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Financeiro Breno//PT-BR', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
              'X-WR-CALNAME:Financeiro', 'X-WR-TIMEZONE:America/Sao_Paulo']
    for x in its:
        receber, pago = x.get('natureza') == 'receber', bool(x.get('pago'))
        valor_txt = brl(x['valor']) + (f' (sua parte {brl(parte_minha(x))})' if x.get('outroValor') else '')
        prefixo = ('Recebido: ' if receber else 'Pago: ') if pago else ('Receber: ' if receber else 'Pagar: ')
        titulo = f'{prefixo}{x.get("descricao") or "conta"} · {valor_txt}'
        desc = '\n'.join(t for t in (
            f'Valor: {brl(x["valor"])}',
            f'Sua parte: {brl(parte_minha(x))} · {x.get("outroNome")}: {brl(x["outroValor"])}' if x.get('outroValor') else None,
            x.get('obs') or None,
            f'Código: {x["codigo"]}' if x.get('codigo') else None,
            'https://brenisio.github.io/financeiro/') if t)
        linhas += ['BEGIN:VEVENT', f'UID:{x["id"]}@financeiro-breno', 'DTSTAMP:' + agora.strftime('%Y%m%dT%H%M%SZ'),
                   'DTSTART;VALUE=DATE:' + x['vencimento'].replace('-', ''),
                   'DTEND;VALUE=DATE:' + soma_dias(x['vencimento'], 1).replace('-', ''),
                   'SUMMARY:' + ics_texto(titulo), 'DESCRIPTION:' + ics_texto(desc), 'TRANSP:TRANSPARENT']
        if not pago:
            for t in ('-P1DT15H', 'PT9H'):  # 9h de 2 dias antes e 9h do dia
                linhas += ['BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:' + ics_texto(titulo), 'TRIGGER:' + t, 'END:VALARM']
        linhas.append('END:VEVENT')
    linhas.append('END:VCALENDAR')
    return '\r\n'.join(ics_dobra(l) for l in linhas) + '\r\n'


def cmd_agenda(d, a):
    saida = a.saida or a.arquivo.with_name('financeiro-lembretes.ics')
    saida.write_bytes(para_ics(d, hoje()).encode('utf-8'))
    n = sum(1 for x in d['lancamentos'] if not x.get('pago'))
    print(f'Lembretes de {n} conta(s) em aberto em {saida}. Importe no Google Agenda (Configurações → Importar).')


# ---------- CLI ----------

def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument('--arquivo', type=Path, default=ARQUIVO_PADRAO)
    sub = p.add_subparsers(dest='cmd', required=True)

    s = sub.add_parser('fatura', help='lança ou atualiza a fatura do mês de um cartão')
    s.add_argument('--cartao', required=True)
    s.add_argument('--valor', required=True)
    s.add_argument('--vencimento', required=True)
    s.add_argument('--fechamento')
    s.add_argument('--minimo')
    s.add_argument('--limite')
    s.add_argument('--codigo', help='linha digitável / pix copia e cola')
    s.add_argument('--obs')
    s.add_argument('--dia-fechamento', type=int)
    s.add_argument('--dia-vencimento', type=int)
    s.add_argument('--fatura-aberta', help='valor já gasto no ciclo seguinte, se o PDF mostrar')
    s.add_argument('--outro-nome', help='de quem é a outra parte (ex.: Agatha)')
    s.add_argument('--outro-valor', help='quanto do total é dessa pessoa')

    s = sub.add_parser('cartao', help='cadastra ou atualiza um cartão')
    s.add_argument('--cartao', required=True)
    s.add_argument('--limite')
    s.add_argument('--fatura-aberta')
    s.add_argument('--dia-fechamento', type=int)
    s.add_argument('--dia-vencimento', type=int)

    s = sub.add_parser('conta', help='lança ou atualiza uma conta/boleto do mês')
    s.add_argument('--descricao', required=True)
    s.add_argument('--valor', required=True)
    s.add_argument('--vencimento', required=True)
    s.add_argument('--categoria')
    s.add_argument('--forma', choices=FORMAS)
    s.add_argument('--codigo')
    s.add_argument('--obs')
    s.add_argument('--mensal', action='store_true', help='repete todo mês')
    s.add_argument('--receber', action='store_true', help='é um valor a receber')
    s.add_argument('--outro-nome', help='de quem é a outra parte')
    s.add_argument('--outro-valor', help='quanto do total é dessa pessoa')

    s = sub.add_parser('saldo', help='atualiza o saldo de uma conta bancária')
    s.add_argument('--conta', required=True)
    s.add_argument('--valor', required=True)
    s.add_argument('--tipo', choices=('corrente', 'poupanca', 'carteira', 'investimento'))
    s.add_argument('--banco', help='banco onde está (agrupa contas e investimentos no resumo)')

    s = sub.add_parser('pago', help='marca um lançamento em aberto como pago')
    g = s.add_mutually_exclusive_group(required=True)
    g.add_argument('--descricao')
    g.add_argument('--id')
    s.add_argument('--mes', help='AAAA-MM, se houver mais de um mês em aberto')
    s.add_argument('--em', help='data do pagamento (padrão: hoje)')

    s = sub.add_parser('resumo', help='soma faturas e contas por mês')
    s.add_argument('--mes', help='AAAA-MM')

    s = sub.add_parser('agenda', help='gera o .ics de lembretes para importar no Google Agenda')
    s.add_argument('--saida', type=Path, help='padrão: financeiro-lembretes.ics ao lado do backup')

    # "--valor -120,50" (saldo negativo) vira "--valor=-120,50" pro argparse não achar que é uma opção
    argv = list(sys.argv[1:] if argv is None else argv)
    for i in range(len(argv) - 1):
        if argv[i] == '--valor' and re.fullmatch(r'-[\d.,]+', argv[i + 1]):
            argv[i:i + 2] = [f'--valor={argv[i + 1]}', None]
    a = p.parse_args([x for x in argv if x is not None])
    try:
        d = carregar(a.arquivo)
        if a.cmd in ('resumo', 'agenda'):
            (cmd_resumo if a.cmd == 'resumo' else cmd_agenda)(d, a)
            return 0
        {'fatura': cmd_fatura, 'cartao': cmd_cartao, 'conta': cmd_conta, 'saldo': cmd_saldo, 'pago': cmd_pago}[a.cmd](d, a)
        gravar(a.arquivo, d)
    except Erro as e:
        print(f'erro: {e}', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
