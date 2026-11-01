// Regras do Financeiro sem DOM: datas, valores, backup e somas. Testado em tests/unit/logica.test.js.
// Estado: { lancamentos: [{ id, dados }], contas: [...], cartoes: [...] } — o mesmo formato do backup, com `dados` separado do id.

export const COLECOES = ['lancamentos', 'contas', 'cartoes'];
export const MES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
export const FORMAS = [['boleto', 'Boleto'], ['pix', 'Pix'], ['debito', 'Débito automático'], ['fatura', 'Fatura de cartão'], ['transferencia', 'Transferência'], ['outro', 'Outro']];
export const TIPOS_CONTA = [['corrente', 'Conta corrente'], ['poupanca', 'Poupança'], ['carteira', 'Dinheiro / carteira'], ['investimento', 'Investimento']];

// ---------- datas (sempre locais, AAAA-MM-DD) ----------

export const pad = n => String(n).padStart(2, '0');
export const iso = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
export const ehData = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s)) && iso(deIso(s)) === s;
export function deIso(s) { const [y, m, d] = String(s).split('-').map(Number); return new Date(y, m - 1, d); }
export const hojeIso = (agora = new Date()) => iso(agora);
// Diferença em dias de calendário (UTC evita o horário de verão distorcer a conta)
export function dias(a, b) {
  const [y1, m1, d1] = a.split('-').map(Number), [y2, m2, d2] = b.split('-').map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
}
export function somaDias(s, n) { const d = deIso(s); d.setDate(d.getDate() + n); return iso(d); }
const ultimoDia = (y, m0) => new Date(y, m0 + 1, 0).getDate();
export function somaMeses(s, n) {
  const [y, m, d] = s.split('-').map(Number);
  const alvo = new Date(y, m - 1 + n, 1);
  return iso(new Date(alvo.getFullYear(), alvo.getMonth(), Math.min(d, ultimoDia(alvo.getFullYear(), alvo.getMonth()))));
}
// Recorrência mensal: mantém o dia pedido (diaBase) mesmo depois de um mês curto (31/01 → 28/02 → 31/03)
export function proximoMes(s, diaBase) {
  const [y, m] = s.split('-').map(Number);
  const alvo = new Date(y, m, 1);
  const dia = Math.min(diaBase || Number(s.slice(8)), ultimoDia(alvo.getFullYear(), alvo.getMonth()));
  return iso(new Date(alvo.getFullYear(), alvo.getMonth(), dia));
}
// Próxima data (hoje inclusive) que cai no dia `dia` do mês
export function proximoDia(dia, hoje) {
  const [y, m] = hoje.split('-').map(Number);
  const em = (yy, m0) => iso(new Date(yy, m0, Math.min(dia, ultimoDia(yy, m0))));
  const d = em(y, m - 1);
  return d >= hoje ? d : em(m === 12 ? y + 1 : y, m === 12 ? 0 : m);
}
export function quando(s, hoje) {
  const n = dias(hoje, s);
  if (n === 0) return 'hoje';
  if (n === 1) return 'amanhã';
  if (n === -1) return 'ontem';
  return n < 0 ? 'há ' + (-n) + ' dias' : 'em ' + n + ' dias';
}
export const mesDe = s => String(s || '').slice(0, 7);
export const nomeMes = m => MES[Number(m.slice(5, 7)) - 1] + '/' + m.slice(0, 4);

// ---------- valores ----------

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
export const brl = v => BRL.format(Number(v) || 0).replace(/ /g, ' ');
export const centavos = v => Math.round((Number(v) || 0) * 100) / 100;

/** '1.234,56' | '1234.56' | 'R$ 182,40' | '1.234' (milhar) | '-50' → número; inválido → NaN */
export function parseValor(txt) {
  let s = String(txt ?? '').replace(/R\$|\s| /g, '');
  if (!s) return NaN;
  if (s.includes(',') && s.includes('.') && s.lastIndexOf('.') > s.lastIndexOf(',')) s = s.replace(/,/g, ''); // 1,234.56
  else if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  if (!/^-?\d+(\.\d+)?$/.test(s)) return NaN;
  return centavos(Number(s));
}
export const valorParaCampo = v => (v == null || v === '') ? '' : centavos(v).toFixed(2).replace('.', ',');

// ---------- backup ----------

export const novoId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
export const vazio = () => ({ lancamentos: [], contas: [], cartoes: [] });

/** Valida e converte o JSON do backup. Lança Error com mensagem legível. */
export function deBackup(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj) || !COLECOES.some(n => Array.isArray(obj[n])))
    throw new Error('Esse arquivo não é um backup do Financeiro.');
  const st = vazio(), vistos = new Set(), problemas = [];
  for (const n of COLECOES) {
    for (const [i, bruto] of (Array.isArray(obj[n]) ? obj[n] : []).entries()) {
      if (!bruto || typeof bruto !== 'object' || Array.isArray(bruto)) { problemas.push(`${n} #${i + 1} não é um registro`); continue; }
      const { id, ...dados } = bruto;
      let chave = typeof id === 'string' && id ? id : novoId();
      while (vistos.has(chave)) chave = novoId();
      vistos.add(chave);
      if (n === 'lancamentos') {
        if (!ehData(dados.vencimento)) problemas.push(`lançamento “${dados.descricao || i + 1}” sem vencimento válido`);
        dados.valor = centavos(dados.valor);
        dados.natureza = dados.natureza === 'receber' ? 'receber' : 'pagar';
        dados.pago = dados.pago === true;
        // parte de outra pessoa (ex.: cartão adicional): entre 0 e o valor total
        const outro = Math.min(Math.max(centavos(dados.outroValor), 0), dados.valor);
        if (outro) { dados.outroValor = outro; dados.outroNome = String(dados.outroNome || '').trim() || 'Outra pessoa'; }
        else { delete dados.outroValor; delete dados.outroNome; }
      } else if (n === 'contas') dados.saldo = centavos(dados.saldo);
      else { dados.limite = centavos(dados.limite); dados.fatura = centavos(dados.fatura); }
      st[n].push({ id: chave, dados });
    }
  }
  if (problemas.length) throw new Error('Backup com problemas: ' + problemas.slice(0, 3).join('; ') + (problemas.length > 3 ? '…' : '') + '.');
  return st;
}
export function paraBackup(st, agora = new Date()) {
  const out = { versao: 1, salvoEm: agora.toISOString() };
  for (const n of COLECOES) out[n] = st[n].map(i => Object.assign({ id: i.id }, i.dados));
  return out;
}
export const contagem = st => COLECOES.reduce((o, n) => (o[n] = st[n].length, o), {});
export const backupPendente = meta => !!meta.alteradoEm && (!meta.exportadoEm || meta.alteradoEm > meta.exportadoEm);

// ---------- operações (devolvem um estado novo) ----------

const sem = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
export const mesmoNome = (a, b) => sem(a) === sem(b);
const troca = (lista, id, f) => lista.map(i => i.id === id ? { id, dados: f(i.dados) } : i);

export function adicionar(st, colecao, dados, id = novoId()) {
  return { ...st, [colecao]: [...st[colecao], { id, dados }] };
}
export function atualizar(st, colecao, id, dados) {
  return { ...st, [colecao]: troca(st[colecao], id, d => ({ ...d, ...dados })) };
}
export function remover(st, colecao, id) {
  return { ...st, [colecao]: st[colecao].filter(i => i.id !== id) };
}

/** Marca pago; se for mensal, cria o do mês seguinte (uma vez só). Devolve { st, proximo } */
export function pagar(st, id, hoje, idNovo = novoId()) {
  const l = st.lancamentos.find(i => i.id === id);
  if (!l || l.dados.pago) return { st, proximo: null };
  let novo = atualizar(st, 'lancamentos', id, { pago: true, pagoEm: hoje });
  let proximo = null;
  if (l.dados.recorrencia === 'mensal' && !st.lancamentos.some(i => i.dados.origem === id)) {
    const diaBase = l.dados.diaBase || Number(l.dados.vencimento.slice(8));
    const venc = proximoMes(l.dados.vencimento, diaBase);
    // já lançado à mão (ou pelo fin.py) no mês seguinte? só liga os dois em vez de duplicar
    const jaExiste = st.lancamentos.find(i => i.id !== id && mesmoNome(i.dados.descricao, l.dados.descricao)
      && i.dados.natureza === l.dados.natureza && mesDe(i.dados.vencimento) === mesDe(venc));
    if (jaExiste) novo = atualizar(novo, 'lancamentos', jaExiste.id, { origem: id });
    else {
      proximo = { ...l.dados, vencimento: venc, diaBase, pago: false, pagoEm: null, origem: id, codigo: '' };
      novo = adicionar(novo, 'lancamentos', proximo, idNovo);
    }
  }
  return { st: novo, proximo };
}
/** Desfaz o pagamento. O lançamento do mês seguinte criado por ele sai, se ainda estiver intocado (não pago, mesmo valor). */
export function desfazer(st, id) {
  const l = st.lancamentos.find(i => i.id === id);
  let novo = atualizar(st, 'lancamentos', id, { pago: false, pagoEm: null });
  const gerado = novo.lancamentos.find(i => i.dados.origem === id && !i.dados.pago);
  if (gerado && l && gerado.dados.valor === l.dados.valor && !gerado.dados.codigo) novo = remover(novo, 'lancamentos', gerado.id);
  return novo;
}
/** Fatura fechou: lança o valor em aberto como conta a pagar e zera o ciclo */
export function fecharFatura(st, cartaoId, hoje, idNovo = novoId()) {
  const c = st.cartoes.find(i => i.id === cartaoId);
  const valor = centavos(c?.dados.fatura);
  if (!c || valor <= 0) return null;
  const vencimento = proximoDia(c.dados.diaVencimento || 10, hoje);
  const existente = st.lancamentos.find(i => i.dados.forma === 'fatura' && !i.dados.pago && mesDe(i.dados.vencimento) === mesDe(vencimento)
    && (i.dados.cartaoId === cartaoId || (!i.dados.cartaoId && mesmoNome(i.dados.descricao, 'Fatura ' + c.dados.nome))));
  let novo = existente
    ? atualizar(st, 'lancamentos', existente.id, { valor: centavos(existente.dados.valor + valor), cartaoId })
    : adicionar(st, 'lancamentos', { descricao: 'Fatura ' + c.dados.nome, valor, vencimento, natureza: 'pagar', forma: 'fatura', categoria: 'Cartão', recorrencia: '', codigo: '', obs: '', pago: false, pagoEm: null, cartaoId }, idNovo);
  novo = atualizar(novo, 'cartoes', cartaoId, { fatura: 0, atualizadoEm: hoje });
  return { st: novo, vencimento, valor };
}

// ---------- leituras ----------

const soma = arr => centavos(arr.reduce((s, l) => s + (Number(l.dados.valor) || 0), 0));
/** Quanto do lançamento é seu (valor − parte de outra pessoa) */
export const parteMinha = l => centavos((Number(l.dados.valor) || 0) - (Number(l.dados.outroValor) || 0));
const somaMinha = arr => centavos(arr.reduce((s, l) => s + parteMinha(l), 0));
const ehPagar = l => l.dados.natureza !== 'receber';
export const abertos = st => st.lancamentos.filter(l => !l.dados.pago).sort((a, b) => a.dados.vencimento.localeCompare(b.dados.vencimento) || (a.dados.descricao || '').localeCompare(b.dados.descricao || ''));

export function resumo(st, hoje) {
  const lim = somaDias(hoje, 30);
  const ab = abertos(st);
  const pagar30 = ab.filter(l => ehPagar(l) && l.dados.vencimento <= lim);
  const receber30 = ab.filter(l => !ehPagar(l) && l.dados.vencimento <= lim);
  const atrasados = ab.filter(l => ehPagar(l) && l.dados.vencimento < hoje);
  const liquidas = st.contas.filter(c => c.dados.tipo !== 'investimento');
  const saldo = centavos(liquidas.reduce((s, c) => s + (Number(c.dados.saldo) || 0), 0));
  const investido = centavos(st.contas.filter(c => c.dados.tipo === 'investimento').reduce((s, c) => s + (Number(c.dados.saldo) || 0), 0));
  return {
    saldo, investido, temContas: st.contas.length > 0,
    pagar30: soma(pagar30), nPagar30: pagar30.length,
    receber30: soma(receber30),
    atrasado: soma(atrasados), nAtrasados: atrasados.length,
    sobra: centavos(saldo + soma(receber30) - soma(pagar30))
  };
}

export function grupos(st, hoje) {
  const g7 = somaDias(hoje, 7), g30 = somaDias(hoje, 30);
  const ab = abertos(st);
  return [
    ['Atrasadas', 'atrasado', l => l.dados.vencimento < hoje],
    ['Próximos 7 dias', 'semana', l => l.dados.vencimento >= hoje && l.dados.vencimento <= g7],
    ['Até 30 dias', 'mes', l => l.dados.vencimento > g7 && l.dados.vencimento <= g30],
    ['Mais adiante', 'depois', l => l.dados.vencimento > g30]
  ].map(([titulo, chave, f]) => {
    const itens = ab.filter(f);
    return { titulo, chave, itens, totalPagar: soma(itens.filter(ehPagar)) };
  }).filter(g => g.itens.length);
}

export function pagosRecentes(st, hoje) {
  const desde = somaDias(hoje, -30);
  return st.lancamentos.filter(l => l.dados.pago && (l.dados.pagoEm || '') >= desde)
    .sort((a, b) => (b.dados.pagoEm || '').localeCompare(a.dados.pagoEm || ''));
}

/** Soma por mês de vencimento: faturas × contas, pago × falta, sua parte × de outros.
 *  Janela: mês passado até +3, mais qualquer mês com conta em aberto (atrasada ou futura). */
export function porMes(st, hoje) {
  const atual = mesDe(hoje);
  const janela = new Set([-1, 0, 1, 2, 3].map(n => mesDe(somaMeses(atual + '-01', n))));
  abertos(st).filter(ehPagar).forEach(l => janela.add(mesDe(l.dados.vencimento)));
  return [...janela].sort().map(m => {
    const its = st.lancamentos.filter(l => ehPagar(l) && mesDe(l.dados.vencimento) === m);
    const faturas = soma(its.filter(l => l.dados.forma === 'fatura'));
    const total = soma(its), pago = soma(its.filter(l => l.dados.pago));
    const abertosMes = its.filter(l => !l.dados.pago);
    const outros = {};
    for (const l of its) if (l.dados.outroValor) outros[l.dados.outroNome] = centavos((outros[l.dados.outroNome] || 0) + l.dados.outroValor);
    const receber = st.lancamentos.filter(l => !ehPagar(l) && mesDe(l.dados.vencimento) === m);
    return {
      mes: m, atual: m === atual, faturas, contas: centavos(total - faturas), total, pago, falta: centavos(total - pago), n: its.length,
      seu: somaMinha(its), faltaSeu: somaMinha(abertosMes), pagoSeu: somaMinha(its.filter(l => l.dados.pago)),
      outros: Object.entries(outros).map(([nome, valor]) => ({ nome, valor })),
      receber: soma(receber), nAbertos: abertosMes.length, atrasado: abertosMes.some(l => l.dados.vencimento < hoje)
    };
  }).filter(r => r.n);
}

/** Lançamentos de um mês: em aberto por vencimento, depois os pagos */
export function doMes(st, mes) {
  const its = st.lancamentos.filter(l => mesDe(l.dados.vencimento) === mes);
  const porData = (a, b) => a.dados.vencimento.localeCompare(b.dados.vencimento) || (a.dados.descricao || '').localeCompare(b.dados.descricao || '');
  return [...its.filter(l => !l.dados.pago).sort(porData), ...its.filter(l => l.dados.pago).sort(porData)];
}

/** Mês que a tela abre: o próximo com conta em aberto (atrasos aparecem num aviso à parte); sem nada em aberto, o atual */
export function mesInicial(st, hoje) {
  const atual = mesDe(hoje);
  const prox = abertos(st).find(l => ehPagar(l) && mesDe(l.dados.vencimento) >= atual);
  return prox ? mesDe(prox.dados.vencimento) : atual;
}

/** Limite livre = limite − fatura em aberto − faturas já fechadas e não pagas desse cartão */
export function disponivel(st, cartao) {
  const fechadas = st.lancamentos.filter(l => l.dados.cartaoId === cartao.id && !l.dados.pago);
  return centavos((Number(cartao.dados.limite) || 0) - (Number(cartao.dados.fatura) || 0) - soma(fechadas));
}

// ---------- agenda (.ics) ----------
// Cada conta vira um evento de dia inteiro no vencimento, com lembrete 2 dias antes e no dia, às 9h.
// UID fixo por lançamento: importar de novo atualiza o evento em vez de duplicar. Pagos viram "Pago: …" sem lembrete.

const icsTexto = s => String(s ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
/** Quebra linhas em até 75 bytes (RFC 5545), sem partir caractere acentuado */
function icsDobra(linha) {
  const partes = [];
  let atual = '', bytes = 0;
  for (const ch of linha) {
    const n = new TextEncoder().encode(ch).length;
    if (bytes + n > (partes.length ? 74 : 75)) { partes.push(atual); atual = ''; bytes = 0; }
    atual += ch; bytes += n;
  }
  partes.push(atual);
  return partes.join('\r\n ');
}
const icsData = s => s.replace(/-/g, '');
const icsCarimbo = d => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

export function paraIcs(st, hoje, agora = new Date()) {
  const desde = somaDias(hoje, -60);
  const its = st.lancamentos.filter(l => l.dados.vencimento >= desde || !l.dados.pago)
    .sort((a, b) => a.dados.vencimento.localeCompare(b.dados.vencimento));
  const linhas = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Financeiro Breno//PT-BR', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'X-WR-CALNAME:Financeiro', 'X-WR-TIMEZONE:America/Sao_Paulo'];
  for (const l of its) {
    const d = l.dados, receber = d.natureza === 'receber';
    const valor = brl(d.valor) + (d.outroValor ? ' (sua parte ' + brl(parteMinha(l)) + ')' : '');
    const titulo = (d.pago ? (receber ? 'Recebido: ' : 'Pago: ') : (receber ? 'Receber: ' : 'Pagar: ')) + (d.descricao || 'conta') + ' · ' + valor;
    const desc = [
      'Valor: ' + brl(d.valor),
      d.outroValor ? 'Sua parte: ' + brl(parteMinha(l)) + ' · ' + d.outroNome + ': ' + brl(d.outroValor) : null,
      d.obs || null,
      d.codigo ? 'Código: ' + d.codigo : null,
      'https://brenisio.github.io/financeiro/'
    ].filter(Boolean).join('\n');
    linhas.push('BEGIN:VEVENT', 'UID:' + l.id + '@financeiro-breno', 'DTSTAMP:' + icsCarimbo(agora),
      'DTSTART;VALUE=DATE:' + icsData(d.vencimento), 'DTEND;VALUE=DATE:' + icsData(somaDias(d.vencimento, 1)),
      'SUMMARY:' + icsTexto(titulo), 'DESCRIPTION:' + icsTexto(desc), 'TRANSP:TRANSPARENT');
    if (!d.pago) for (const t of ['-P1DT15H', 'PT9H']) // 9h de 2 dias antes e 9h do dia
      linhas.push('BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:' + icsTexto(titulo), 'TRIGGER:' + t, 'END:VALARM');
    linhas.push('END:VEVENT');
  }
  linhas.push('END:VCALENDAR');
  return linhas.map(icsDobra).join('\r\n') + '\r\n';
}

// ---------- aviso do dia (notificação do app) ----------

/** Um aviso por dia, juntando as contas a pagar que vencem em até 2 dias ou já venceram. null = nada a avisar. */
export function avisoDoDia(st, hoje) {
  const its = abertos(st).filter(l => ehPagar(l) && dias(hoje, l.dados.vencimento) <= 2);
  if (!its.length) return null;
  const prazo = l => { const n = dias(hoje, l.dados.vencimento); return n < 0 ? 'atrasada ' + quando(l.dados.vencimento, hoje) : n === 0 ? 'vence hoje' : n === 1 ? 'vence amanhã' : 'vence em 2 dias'; };
  const valor = l => brl(l.dados.valor) + (l.dados.outroValor ? ' (seu ' + brl(parteMinha(l)) + ')' : '');
  const atrasadas = its.filter(l => l.dados.vencimento < hoje);
  const titulo = atrasadas.length
    ? (atrasadas.length > 1 ? atrasadas.length + ' contas atrasadas' : (atrasadas[0].dados.descricao || 'Conta') + ' está atrasada')
    : its.length > 1 ? its.length + ' contas vencendo' : (its[0].dados.descricao || 'Conta') + ' ' + prazo(its[0]);
  const corpo = its.map(l => (l.dados.descricao || 'Conta') + ': ' + prazo(l) + ' · ' + valor(l)).join('\n');
  return { titulo, corpo, tag: 'contas-' + hoje, n: its.length };
}
