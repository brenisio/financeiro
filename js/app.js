// Interface do Financeiro. As regras ficam em logica.js; aqui é só DOM, armazenamento e backup.
import {
  COLECOES, MES, FORMAS, TIPOS_CONTA, deIso, hojeIso, quando, pad, brl, parseValor, valorParaCampo,
  deBackup, paraBackup, contagem, backupPendente, vazio, adicionar, atualizar, remover, pagar, desfazer,
  fecharFatura, resumo, porMes, somaMeses, doMes, mesInicial, parteMinha, disponivel, dias, ehData, mesDe
} from './logica.js';

const CHAVE = 'financeiro-breno.v1', CHAVE_META = 'financeiro-breno.meta';
const $ = id => document.getElementById(id);
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const mesLongo = m => MESES[Number(m.slice(5, 7)) - 1];
const dataCurta = s => { const d = deIso(s); return pad(d.getDate()) + '/' + pad(d.getMonth() + 1); };
const dataLonga = s => deIso(s).toLocaleDateString('pt-BR');

function el(tag, attrs, ...filhos) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const f of filhos.flat(Infinity)) if (f != null && f !== false) e.append(f.nodeType ? f : String(f));
  return e;
}

let toastT;
/** Aviso rápido; com `acao` ({ rot, fn }) ganha um botão (ex.: Desfazer) e fica mais tempo na tela */
function toast(msg, acao) {
  const t = $('toast');
  t.replaceChildren(el('span', {}, msg));
  if (acao) t.append(el('button', { type: 'button', onclick: () => { t.hidden = true; acao.fn(); } }, acao.rot));
  t.hidden = false;
  clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, acao ? 6000 : 3200);
}

// ---------- estado e armazenamento ----------

let st = vazio();
let meta = { alteradoEm: null, exportadoEm: null };
let armazenamentoOk = true;
let mesSel = null; // mês escolhido nas abas; null = o que mesInicial escolher

function lerLocal() {
  try {
    const bruto = localStorage.getItem(CHAVE);
    st = bruto ? deBackup(JSON.parse(bruto)) : vazio();
    meta = Object.assign({ alteradoEm: null, exportadoEm: null }, JSON.parse(localStorage.getItem(CHAVE_META) || '{}'));
  } catch (e) {
    st = vazio();
    if (e instanceof Error && e.message.startsWith('Backup')) toast('Os dados salvos neste navegador estão inválidos. Abra seu backup.');
  }
}
function gravarLocal() {
  try {
    localStorage.setItem(CHAVE, JSON.stringify(paraBackup(st)));
    localStorage.setItem(CHAVE_META, JSON.stringify(meta));
    armazenamentoOk = true;
  } catch { armazenamentoOk = false; }
  return armazenamentoOk;
}
function aplicar(novo, msg, acao) {
  st = novo;
  meta.alteradoEm = new Date().toISOString();
  if (!gravarLocal()) toast('O navegador não deixou salvar. Baixe o backup antes de fechar a página.');
  else if (msg) toast(msg, acao);
  render();
}

// ---------- janela (modal) ----------

let fecharAtual = null, origemModal = null;
// com a janela aberta, o resto da página sai do alcance do teclado e do leitor de tela
const fundoInerte = sim => { for (const e of [document.querySelector('.wrap'), $('bt-novo')]) e.inert = sim; };
function abrirModal(conteudo, foco) {
  const raiz = $('modal-raiz');
  // trocar de janela (detalhe → editar) mantém o foco de volta no que abriu a primeira
  if (fecharAtual) fecharAtual(true); else origemModal = document.activeElement;
  const fundo = el('div', { class: 'modal-fundo', onmousedown: e => { if (e.target === e.currentTarget) fechar(); } }, conteudo);
  function teclas(e) {
    if (e.key === 'Escape') { e.preventDefault(); fechar(); }
    if (e.key === 'Tab') { // mantém o foco dentro da janela
      const f = [...conteudo.querySelectorAll('button, input, select, textarea, summary, [href]')].filter(x => !x.disabled && x.offsetParent !== null);
      const [pri, ult] = [f[0], f[f.length - 1]];
      if (e.shiftKey && document.activeElement === pri) { e.preventDefault(); ult.focus(); }
      else if (!e.shiftKey && document.activeElement === ult) { e.preventDefault(); pri.focus(); }
    }
  }
  function fechar(trocando) {
    document.removeEventListener('keydown', teclas);
    raiz.replaceChildren();
    fecharAtual = null;
    if (trocando) return;
    document.body.classList.remove('travado');
    fundoInerte(false);
    const o = origemModal; origemModal = null;
    if (o && document.contains(o)) o.focus();
    else $('bt-novo').focus();
  }
  fecharAtual = fechar;
  document.addEventListener('keydown', teclas);
  document.body.classList.add('travado');
  fundoInerte(true);
  raiz.replaceChildren(fundo);
  (foco || conteudo.querySelector('button, input')).focus();
  return fechar;
}
const fecharModal = () => fecharAtual && fecharAtual();

function janela(tag, titulo, attrs, ...corpo) {
  return el(tag, { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'modal-titulo', ...attrs },
    el('div', { class: 'modal-topo' },
      el('h2', { id: 'modal-titulo' }, titulo),
      el('button', { class: 'btn-icone', type: 'button', 'aria-label': 'Fechar', onclick: fecharModal }, '×')),
    ...corpo);
}

// ---------- formulários ----------

const ESPECS = {
  lancamentos: { nome: 'conta', campos: [
    { k: 'natureza', l: 'Tipo', t: 'seg', o: [['pagar', 'A pagar'], ['receber', 'A receber']] },
    { k: 'descricao', l: 'Descrição', t: 'text', req: 1, ph: 'Ex.: Aluguel, Claro, MEI' },
    { k: 'valor', l: 'Valor (R$)', t: 'money', req: 1, ph: '182,40', meia: 1 },
    { k: 'vencimento', l: 'Vencimento', t: 'date', req: 1, meia: 1 },
    { k: 'recorrencia', l: 'Repete todo mês', t: 'check', sim: 'mensal' },
    { k: 'forma', l: 'Forma', t: 'select', o: FORMAS, meia: 1, mais: 1 },
    { k: 'cartaoId', l: 'Qual cartão', t: 'select', cartoes: 1, meia: 1, mais: 1 },
    { k: 'categoria', l: 'Categoria', t: 'text', ph: 'Moradia, obra…', lista: 'categorias', mais: 1 },
    { k: 'outroNome', l: 'Parte de outra pessoa', t: 'text', ph: 'Ex.: Agatha', meia: 1, mais: 1 },
    { k: 'outroValor', l: 'Valor dela/dele (R$)', t: 'money', ph: '0,00', meia: 1, mais: 1 },
    { k: 'codigo', l: 'Linha digitável ou Pix copia e cola', t: 'textarea', mais: 1 },
    { k: 'obs', l: 'Observação', t: 'textarea', mais: 1 }
  ] },
  contas: { nome: 'conta bancária', campos: [
    { k: 'nome', l: 'Banco / conta', t: 'text', req: 1, ph: 'Ex.: Itaú corrente' },
    { k: 'saldo', l: 'Saldo atual (R$)', t: 'money', req: 1, ph: '2.350,00', neg: 1, meia: 1 },
    { k: 'tipo', l: 'Tipo', t: 'select', o: TIPOS_CONTA, meia: 1 }
  ] },
  cartoes: { nome: 'cartão', campos: [
    { k: 'nome', l: 'Cartão', t: 'text', req: 1, ph: 'Ex.: Nubank' },
    { k: 'limite', l: 'Limite total (R$)', t: 'money', meia: 1 },
    { k: 'fatura', l: 'Fatura atual, ainda aberta (R$)', t: 'money', ph: '0,00', meia: 1 },
    { k: 'diaFechamento', l: 'Dia que fecha', t: 'day', meia: 1 },
    { k: 'diaVencimento', l: 'Dia que vence', t: 'day', req: 1, meia: 1 }
  ] }
};

function abrirForm(colecao, item, padrao) {
  const base = ESPECS[colecao];
  const campos = base.campos.filter(c => !c.cartoes || st.cartoes.length);
  const dados = Object.assign({}, padrao || {}, item ? item.dados : {});
  const msg = el('p', { class: 'msg', role: 'alert' });
  const ler = {}, alvo = {};
  let mudouMais = false;

  const montar = c => {
    const id = 'f-' + colecao + '-' + c.k;
    const v = dados[c.k];
    if (c.t === 'seg') {
      const radios = c.o.map(([val, rot]) => el('label', {}, el('input', { type: 'radio', name: id, value: val, checked: (v || c.o[0][0]) === val }), el('span', {}, rot)));
      ler[c.k] = () => radios.map(r => r.querySelector('input')).find(r => r.checked)?.value || c.o[0][0];
      alvo[c.k] = radios[0].querySelector('input');
      return el('div', { class: 'campo seg', role: 'radiogroup', 'aria-label': c.l }, radios);
    }
    if (c.t === 'check') {
      const inp = el('input', { id, type: 'checkbox', checked: v === c.sim });
      ler[c.k] = () => inp.checked ? c.sim : ''; alvo[c.k] = inp;
      return el('label', { class: 'campo marca' }, inp, c.l);
    }
    let inp;
    if (c.t === 'select') {
      const opcoes = c.cartoes ? [['', 'Nenhum'], ...st.cartoes.map(k => [k.id, k.dados.nome])] : c.o;
      inp = el('select', { id }, opcoes.map(([val, rot]) => el('option', { value: val }, rot)));
      inp.value = v ?? opcoes[0][0];
      if (inp.selectedIndex < 0) inp.value = opcoes[0][0];
      if (c.mais && inp.value !== opcoes[0][0] && !(c.k === 'forma' && inp.value === 'boleto')) mudouMais = true;
    } else if (c.t === 'textarea') {
      inp = el('textarea', { id, placeholder: c.ph, rows: 2 });
      inp.value = v || '';
    } else {
      inp = el('input', {
        id, type: { money: 'text', day: 'number' }[c.t] || c.t, placeholder: c.ph, autocomplete: 'off', list: c.lista,
        inputmode: c.t === 'money' ? 'decimal' : (c.t === 'day' ? 'numeric' : null),
        min: c.t === 'day' ? '1' : null, max: c.t === 'day' ? '31' : null, step: c.t === 'day' ? '1' : null
      });
      inp.value = v == null ? '' : (c.t === 'money' ? (Number(v) ? valorParaCampo(v) : '') : v);
    }
    if (c.mais && c.t !== 'select' && inp.value) mudouMais = true;
    ler[c.k] = () => inp.value.trim(); alvo[c.k] = inp;
    const opcional = !c.req && c.t !== 'select';
    return el('div', { class: 'campo' + (c.meia ? ' meia' : '') }, el('label', { for: id }, c.l, opcional ? el('span', { class: 'opc' }, ' (opcional)') : null), inp);
  };

  const principais = campos.filter(c => !c.mais).map(montar);
  const extras = campos.filter(c => c.mais).map(montar);
  const mais = extras.length ? el('details', { class: 'mais', open: mudouMais }, el('summary', {}, 'Mais opções'), el('div', { class: 'campos' }, extras)) : null;

  // "Qual cartão" só aparece quando a forma é fatura
  if (alvo.cartaoId) {
    const caixa = alvo.cartaoId.parentElement;
    const sincroniza = () => { caixa.hidden = alvo.forma.value !== 'fatura'; };
    alvo.forma.addEventListener('change', sincroniza); sincroniza();
  }
  const cats = [...new Set(st.lancamentos.map(l => l.dados.categoria).filter(Boolean))].sort();
  const datalist = el('datalist', { id: 'categorias' }, cats.map(c => el('option', { value: c })));

  let armado = false;
  const btExcluir = item ? el('button', { class: 'btn perigo', type: 'button', onclick: () => {
    if (!armado) { armado = true; btExcluir.textContent = 'Toque de novo para excluir'; btExcluir.classList.add('armado'); return; }
    fecharModal(); aplicar(remover(st, colecao, item.id), 'Excluído');
  } }, 'Excluir') : null;
  const fat = colecao === 'cartoes' && item && Number(item.dados.fatura) > 0
    ? el('button', { class: 'btn', type: 'button', onclick: () => { fecharModal(); lancarFatura(item); } }, 'A fatura fechou: lançar ' + brl(item.dados.fatura))
    : null;

  function salvar(e) {
    e.preventDefault();
    const out = {};
    for (const c of campos) {
      const inp = alvo[c.k], raw = ler[c.k]();
      const erro = texto => { msg.textContent = texto; inp.setAttribute('aria-invalid', 'true'); if (mais && mais.contains(inp)) mais.open = true; inp.focus(); };
      inp.removeAttribute('aria-invalid');
      if (c.req && !raw) return erro('Preencha “' + c.l + '”.');
      if (c.t === 'money') {
        if (!raw) { out[c.k] = 0; continue; }
        const n = parseValor(raw);
        if (!Number.isFinite(n)) return erro('“' + c.l + '” precisa ser um valor, como 182,40.');
        if (n < 0 && !c.neg) return erro('“' + c.l + '” não pode ser negativo.');
        if (c.k === 'valor' && n === 0) return erro('O valor precisa ser maior que zero.');
        out[c.k] = n;
      } else if (c.t === 'day') {
        if (!raw) { out[c.k] = null; continue; }
        const n = Number(raw);
        if (!Number.isInteger(n) || n < 1 || n > 31) return erro('“' + c.l + '” vai de 1 a 31.');
        out[c.k] = n;
      } else if (c.t === 'date') {
        if (!ehData(raw)) return erro('Escolha uma data válida em “' + c.l + '”.');
        out[c.k] = raw;
      } else out[c.k] = raw;
    }
    const hoje = hojeIso();
    if (colecao !== 'lancamentos') out.atualizadoEm = hoje;
    else {
      if (out.outroValor > out.valor) { alvo.outroValor.setAttribute('aria-invalid', 'true'); mais.open = true; alvo.outroValor.focus(); msg.textContent = 'A parte de outra pessoa não pode passar do valor total.'; return; }
      if (out.outroValor && !out.outroNome) { alvo.outroNome.setAttribute('aria-invalid', 'true'); mais.open = true; alvo.outroNome.focus(); msg.textContent = 'Diga de quem é a outra parte.'; return; }
      if (!out.outroValor) { out.outroValor = undefined; out.outroNome = undefined; }
      if (out.forma !== 'fatura' || !out.cartaoId) out.cartaoId = undefined;
      if (out.recorrencia === 'mensal') out.diaBase = Number(out.vencimento.slice(8));
      if (!item) Object.assign(out, { pago: false, pagoEm: null });
      mesSel = mesDe(out.vencimento); // mostra o mês do que acabou de salvar
    }
    fecharModal();
    aplicar(item ? atualizar(st, colecao, item.id, out) : adicionar(st, colecao, out), 'Salvo');
  }

  const form = janela('form', (item ? 'Editar ' : 'Nova ') + base.nome, { novalidate: true, onsubmit: salvar },
    el('div', { class: 'campos' }, principais), mais, datalist, msg,
    fat,
    el('div', { class: 'rodape' }, btExcluir, el('button', { class: 'btn', type: 'button', onclick: fecharModal }, 'Cancelar'), el('button', { class: 'btn primario', type: 'submit' }, 'Salvar')));
  if (colecao === 'cartoes') form.querySelector('h2').textContent = item ? 'Editar cartão' : 'Novo cartão';
  abrirModal(form, alvo[campos.find(c => c.t !== 'seg').k]);
}

// ---------- ações ----------

function marcarPago(l) {
  const r = pagar(st, l.id, hojeIso());
  const receber = l.dados.natureza === 'receber';
  const txt = (receber ? 'Recebido' : 'Pago') + (r.proximo ? '. O de ' + mesLongo(r.proximo.vencimento) + ' já está na lista.' : '');
  aplicar(r.st, txt, { rot: 'Desfazer', fn: () => aplicar(desfazer(st, l.id), 'Voltou para a lista') });
}
function voltarAberto(l) { aplicar(desfazer(st, l.id), 'Voltou para a lista'); }
async function copiar(txt) {
  try { await navigator.clipboard.writeText(txt); toast('Código copiado'); }
  catch { toast('Não deu para copiar. Abra “Editar” e copie do campo.'); }
}
function lancarFatura(c) {
  const r = fecharFatura(st, c.id, hojeIso());
  if (!r) return toast('A fatura em aberto está zerada.');
  mesSel = mesDe(r.vencimento);
  aplicar(r.st, 'Fatura de ' + brl(r.valor) + ' lançada para ' + dataLonga(r.vencimento));
}

// ---------- detalhes de uma conta ----------

const formaNome = f => (FORMAS.find(x => x[0] === f) || [null, f])[1];
function estadoDe(l, hoje) {
  if (l.dados.pago) return 'pago';
  const n = dias(hoje, l.dados.vencimento);
  return n < 0 ? 'atrasado' : n <= 3 ? 'perto' : '';
}
function prazoTexto(l, hoje) {
  const d = l.dados;
  if (d.pago) return (d.natureza === 'receber' ? 'Recebido em ' : 'Pago em ') + dataCurta(d.pagoEm || hoje);
  const n = dias(hoje, d.vencimento);
  return (n < 0 ? 'Venceu ' : 'Vence ') + dataCurta(d.vencimento) + ' · ' + quando(d.vencimento, hoje);
}

function abrirDetalhe(l) {
  const d = l.dados, hoje = hojeIso(), receber = d.natureza === 'receber';
  const cartao = d.cartaoId ? st.cartoes.find(c => c.id === d.cartaoId) : null;
  const info = [
    ['Tipo', receber ? 'A receber' : 'A pagar'],
    d.forma ? ['Forma', formaNome(d.forma) + (cartao ? ' · ' + cartao.dados.nome : '')] : null,
    d.categoria ? ['Categoria', d.categoria] : null,
    d.recorrencia === 'mensal' ? ['Repete', 'Todo mês'] : null,
    ['Vencimento', dataLonga(d.vencimento)],
    d.obs ? ['Observação', d.obs] : null
  ].filter(Boolean);
  const btPagar = d.pago
    ? el('button', { class: 'btn', type: 'button', onclick: () => { fecharModal(); voltarAberto(l); } }, 'Desfazer pagamento')
    : el('button', { class: 'btn primario', type: 'button', onclick: () => { fecharModal(); marcarPago(l); } }, receber ? 'Recebi' : 'Paguei');
  const caixa = janela('div', d.descricao || '(sem descrição)', {},
    el('div', { class: 'det-valor' + (receber ? ' pos' : '') }, (receber ? '+ ' : '') + brl(d.valor)),
    el('p', { class: 'det-quando ' + estadoDe(l, hoje) }, prazoTexto(l, hoje)),
    d.outroValor ? el('div', { class: 'split' },
      el('div', {}, el('span', {}, 'Sua parte'), el('b', {}, brl(parteMinha(l)))),
      el('div', {}, el('span', {}, d.outroNome), el('b', {}, brl(d.outroValor)))) : null,
    el('dl', { class: 'info' }, info.map(([k, v]) => [el('dt', {}, k), el('dd', {}, v)])),
    d.codigo ? el('div', { class: 'codigo' }, el('code', {}, d.codigo),
      el('button', { class: 'btn', type: 'button', onclick: () => copiar(d.codigo) }, 'Copiar código')) : null,
    el('div', { class: 'rodape' }, el('button', { class: 'btn', type: 'button', onclick: () => abrirForm('lancamentos', l) }, 'Editar'), btPagar));
  abrirModal(caixa, btPagar);
}

// ---------- render ----------

function linhaConta(l, hoje) {
  const d = l.dados, receber = d.natureza === 'receber';
  const nome = d.descricao || '(sem descrição)';
  return el('li', { class: 'item ' + estadoDe(l, hoje) + (receber ? ' receber' : ''), 'data-id': l.id },
    el('button', { class: 'check', type: 'button', 'aria-pressed': d.pago ? 'true' : 'false',
      'aria-label': (d.pago ? 'Desfazer pagamento de ' : (receber ? 'Marcar como recebido: ' : 'Marcar como pago: ')) + nome,
      onclick: () => d.pago ? voltarAberto(l) : marcarPago(l) }),
    el('button', { class: 'abrir', type: 'button', 'aria-label': nome + ', ' + brl(d.valor) + ', ' + prazoTexto(l, hoje).toLowerCase() + '. Ver detalhes', onclick: () => abrirDetalhe(l) },
      el('span', { class: 't' }, nome),
      el('span', { class: 'v' }, (receber ? '+ ' : '') + brl(d.valor)),
      el('span', { class: 'm' }, prazoTexto(l, hoje)),
      d.outroValor ? el('span', { class: 'vs' }, 'seu ' + brl(parteMinha(l))) : el('span')));
}

function renderMes(hoje) {
  const linhas = porMes(st, hoje);
  const atual = mesDe(hoje);
  if (!mesSel) mesSel = mesInicial(st, hoje);
  // abas: meses com contas + o atual e os dois seguintes (dá para lançar adiantado) + o escolhido
  const fixos = [0, 1, 2].map(n => mesDe(somaMeses(atual + '-01', n)));
  const todos = [...new Set([...linhas.map(r => r.mes), ...fixos, mesSel])].sort()
    .map(m => linhas.find(r => r.mes === m) || { mes: m, faltaSeu: 0, n: 0 });
  const nav = $('meses');
  nav.replaceChildren(...todos.map(r => el('button', {
    class: 'mes' + (r.atrasado ? ' atrasado' : ''), type: 'button', 'aria-pressed': r.mes === mesSel ? 'true' : 'false', 'data-mes': r.mes,
    onclick: () => { mesSel = r.mes; render(); }
  }, el('b', {}, MES[Number(r.mes.slice(5)) - 1] + (r.mes.slice(0, 4) !== atual.slice(0, 4) ? ' ' + r.mes.slice(2, 4) : '')),
     el('span', {}, !r.n ? '—' : r.faltaSeu ? brl(r.faltaSeu).replace(/,\d\d$/, '') : 'tudo pago'))));
  const sel = nav.querySelector('[aria-pressed="true"]'); // rola só a faixa dos meses, nunca a página
  if (sel && (sel.offsetLeft < nav.scrollLeft || sel.offsetLeft + sel.offsetWidth > nav.scrollLeft + nav.clientWidth)) nav.scrollLeft = sel.offsetLeft - 16;

  const r = linhas.find(x => x.mes === mesSel);
  const nomeM = mesLongo(mesSel) + (mesSel.slice(0, 4) !== atual.slice(0, 4) ? ' de ' + mesSel.slice(0, 4) : '');
  const temOutros = r && r.outros.length;
  $('h-rot').textContent = (temOutros ? 'Sua parte que falta pagar em ' : 'Falta pagar em ') + nomeM;
  $('h-valor').textContent = brl(r ? r.faltaSeu : 0);
  const pct = r && r.seu ? Math.round(r.pagoSeu / r.seu * 100) : 0;
  $('h-barra').setAttribute('aria-valuenow', String(pct));
  $('h-barra').firstElementChild.style.width = pct + '%';
  $('h-sub').textContent = !r ? 'Nada lançado para ' + nomeM + '.'
    : !r.faltaSeu ? 'Tudo pago em ' + nomeM + '.'
    : brl(r.pagoSeu) + ' pago de ' + brl(r.seu) + ' · ' + r.nAbertos + (r.nAbertos > 1 ? ' contas em aberto' : ' conta em aberto');

  const partes = [];
  if (temOutros) {
    partes.push(['Boletos em aberto', brl(r.falta)]);
    for (const o of r.outros) partes.push(['Parte da ' + o.nome, brl(o.valor)]);
  }
  const res = resumo(st, hoje);
  if (res.temContas) {
    const receberAberto = doMes(st, mesSel).filter(l => l.dados.natureza === 'receber' && !l.dados.pago).reduce((s, l) => s + l.dados.valor, 0);
    partes.push(['Em conta hoje', brl(res.saldo)]);
    const sobra = res.saldo + receberAberto - (r ? r.falta : 0);
    partes.push(['Sobra depois de pagar', brl(sobra)]);
  }
  $('h-partes').replaceChildren(...partes.map(([k, v]) => el('div', { class: 'parte' }, el('span', {}, k), el('b', {}, v))));
  $('h-partes').hidden = !partes.length;

  const its = doMes(st, mesSel);
  $('h-lista').textContent = 'Contas de ' + nomeM;
  const nAb = its.filter(l => !l.dados.pago).length;
  $('h-qtd').textContent = its.length ? (nAb ? nAb + ' em aberto' : 'todas pagas') : '';
  $('lista').replaceChildren(...(its.length ? its.map(l => linhaConta(l, hoje))
    : [el('li', { class: 'vazio' }, 'Nenhuma conta em ' + nomeM + '. Use “Lançar”.')]));
}

function renderAtraso(hoje) {
  const atrasadas = st.lancamentos.filter(l => !l.dados.pago && l.dados.natureza !== 'receber' && l.dados.vencimento < hoje)
    .sort((a, b) => a.dados.vencimento.localeCompare(b.dados.vencimento));
  $('aviso-atraso').hidden = !atrasadas.length;
  if (!atrasadas.length) return;
  const total = atrasadas.reduce((s, l) => s + l.dados.valor, 0);
  $('atraso-txt').textContent = brl(total) + ' atrasado' + (atrasadas.length > 1 ? ' em ' + atrasadas.length + ' contas' : ': ' + atrasadas[0].dados.descricao);
  const mes = mesDe(atrasadas[0].dados.vencimento);
  $('bt-ver-atraso').hidden = mes === mesSel;
  $('bt-ver-atraso').onclick = () => { mesSel = mes; render(); $('lista').querySelector('.atrasado .abrir')?.focus(); };
}

function renderBancos(hoje) {
  const velho = d => d && dias(d, hoje) > 7;
  const atualizado = d => d ? el('span', { class: velho(d) ? 'velho' : '' }, ' · atualizado ' + quando(d, hoje)) : null;
  const porNome = arr => [...arr].sort((a, b) => (a.dados.nome || '').localeCompare(b.dados.nome || '', 'pt-BR'));
  const tipoNome = t => (TIPOS_CONTA.find(x => x[0] === t) || [null, t || ''])[1];

  $('cartoes').replaceChildren(...(st.cartoes.length ? porNome(st.cartoes).map(c => {
    const d = c.dados, lim = Number(d.limite) || 0, livre = disponivel(st, c);
    const uso = lim ? Math.max(0, Math.min(100, Math.round((lim - livre) / lim * 100))) : 0;
    return el('li', { 'data-id': c.id }, el('button', { class: 'linha', type: 'button', 'aria-label': 'Cartão ' + d.nome + (lim ? ', livre ' + brl(livre) : '') + '. Editar', onclick: () => abrirForm('cartoes', c) },
      el('span', { class: 't' }, d.nome),
      el('span', { class: 'v' + (livre < 0 ? ' neg' : '') }, lim ? 'livre ' + brl(livre) : ''),
      lim ? el('span', { class: 'barra', 'aria-hidden': 'true' }, el('i', { class: uso >= 80 ? 'alto' : '', style: 'width:' + uso + '%' })) : null,
      el('span', { class: 'm' }, 'fatura atual ' + brl(d.fatura),
        d.diaFechamento ? ' · fecha dia ' + d.diaFechamento : '', d.diaVencimento ? ' · vence dia ' + d.diaVencimento : '',
        lim ? ' · limite ' + brl(lim) : '', atualizado(d.atualizadoEm))));
  }) : [el('li', { class: 'vazio' }, 'Nenhum cartão. Mande a fatura em PDF para o Claude ou use “+ Cartão”.')]));

  const liquidas = st.contas.filter(c => c.dados.tipo !== 'investimento');
  $('contas').replaceChildren(...(st.contas.length ? porNome(st.contas).map(c => el('li', { 'data-id': c.id },
    el('button', { class: 'linha', type: 'button', 'aria-label': c.dados.nome + ', saldo ' + brl(c.dados.saldo) + '. Atualizar', onclick: () => abrirForm('contas', c) },
      el('span', { class: 't' }, c.dados.nome),
      el('span', { class: 'v' + (Number(c.dados.saldo) < 0 ? ' neg' : '') }, brl(c.dados.saldo)),
      el('span', { class: 'm' }, tipoNome(c.dados.tipo), atualizado(c.dados.atualizadoEm)))))
    : [el('li', { class: 'vazio' }, 'Cadastre o saldo que aparece no app do banco para ver quanto sobra no mês.')]));
  if (liquidas.length > 1) $('contas').append(el('li', { class: 'vazio' }, 'Total em conta: ', el('b', {}, brl(resumo(st, hoje).saldo))));
}

const fmtData = s => new Date(s).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
function renderBackup() {
  const pend = backupPendente(meta) || !armazenamentoOk;
  const b = $('bt-backup');
  b.classList.toggle('pendente', pend);
  b.classList.toggle('ok', !pend && !!meta.exportadoEm);
  $('backup-rot').textContent = pend ? 'Salvar backup' : meta.exportadoEm ? 'Backup em dia' : 'Backup';
}

function render() {
  const hoje = hojeIso();
  $('hoje').textContent = deIso(hoje).toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const nada = !COLECOES.some(n => st[n].length);
  $('inicio').hidden = !nada;
  for (const id of ['meses', 'hero', 'contas-mes', 'sec-cartoes', 'sec-contas']) $(id).hidden = nada;
  if (nada) mesSel = null;
  else renderMes(hoje);
  renderAtraso(hoje);
  renderBancos(hoje);
  renderBackup();
}

// ---------- backup: baixar / abrir ----------

function exportar() {
  const agora = new Date();
  const blob = new Blob([JSON.stringify(paraBackup(st, agora), null, 2) + '\n'], { type: 'application/json' });
  const a = el('a', { href: URL.createObjectURL(blob), download: 'financeiro-backup.json' });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  meta.exportadoEm = agora.toISOString();
  if (!meta.alteradoEm) meta.alteradoEm = meta.exportadoEm;
  gravarLocal(); renderBackup();
  toast('Backup baixado. Suba no Drive substituindo o anterior.');
}

function abrirBackup(confirmacao) {
  const pend = backupPendente(meta);
  const status = !armazenamentoOk ? ['O navegador não está salvando', 'Baixe o backup antes de fechar a página.']
    : pend ? ['Há alterações fora do backup', 'Baixe o backup e substitua o arquivo no Drive.']
    : meta.exportadoEm ? ['Backup em dia', 'Último backup: ' + fmtData(meta.exportadoEm) + '.']
    : ['Os dados ficam só neste navegador', 'Baixe o backup e guarde no Drive para abrir em outro lugar.'];
  const btBaixar = el('button', { class: 'btn' + (pend || !meta.exportadoEm ? ' primario' : ''), type: 'button', onclick: () => { exportar(); fecharModal(); } }, 'Baixar backup');
  const btAbrir = el('button', { class: 'btn', type: 'button', onclick: () => $('arquivo').click() }, 'Abrir backup…');
  const caixa = janela('div', 'Backup', {},
    el('p', { class: 'bk-status' }, el('b', {}, status[0]), status[1]),
    confirmacao || null,
    el('div', { class: 'rodape' }, btAbrir, btBaixar),
    el('p', { class: 'bk-dica' }, 'Dica: também dá para arrastar o arquivo para a página.'));
  abrirModal(caixa, confirmacao ? confirmacao.querySelector('button') : btBaixar);
}

function importarObjeto(obj) {
  let novo;
  try { novo = deBackup(obj); } catch (e) { toast(e.message); return; }
  const salvo = typeof obj.salvoEm === 'string' && !isNaN(Date.parse(obj.salvoEm)) ? obj.salvoEm : null;
  const c = contagem(novo);
  const efetivar = () => {
    st = novo; mesSel = null;
    meta = { alteradoEm: salvo || new Date().toISOString(), exportadoEm: salvo || new Date().toISOString() };
    gravarLocal(); fecharModal(); render();
    toast('Backup aberto: ' + c.lancamentos + ' lançamentos, ' + c.contas + ' contas, ' + c.cartoes + ' cartões');
  };
  if (!COLECOES.some(n => st[n].length)) return efetivar();
  const maisVelho = salvo && meta.alteradoEm && salvo < meta.alteradoEm;
  abrirBackup(el('div', { class: 'confirma', role: 'alert' },
    el('p', {}, 'Trocar os dados deste navegador pelo backup' + (salvo ? ' de ' + fmtData(salvo) : '') + ' (' + c.lancamentos + ' lançamentos, ' + c.contas + ' contas, ' + c.cartoes + ' cartões)?',
      maisVelho ? el('strong', { class: 'neg' }, ' Esse backup é mais antigo que as alterações feitas aqui; elas serão perdidas.') : null),
    el('div', { class: 'rodape' },
      el('button', { class: 'btn', type: 'button', onclick: () => abrirBackup() }, 'Cancelar'),
      el('button', { class: 'btn primario', type: 'button', onclick: efetivar }, 'Trocar'))));
}

async function importarArquivo(f) {
  if (!f) return;
  try { importarObjeto(JSON.parse(await f.text())); }
  catch { toast('Não consegui ler esse arquivo. Escolha o financeiro-backup.json.'); }
}

// ---------- ligações ----------

const novaConta = () => abrirForm('lancamentos', null, { natureza: 'pagar', forma: 'boleto', vencimento: hojeIso() });
$('bt-novo').onclick = novaConta;
$('bt-conta').onclick = () => abrirForm('contas');
$('bt-cartao').onclick = () => abrirForm('cartoes');
$('bt-backup').onclick = () => abrirBackup();
$('arquivo').onchange = e => { const f = e.target.files[0]; e.target.value = ''; importarArquivo(f); };
document.querySelectorAll('[data-acao="importar"]').forEach(b => { b.onclick = () => $('arquivo').click(); });
document.querySelectorAll('[data-acao="lancamento"]').forEach(b => { b.onclick = novaConta; });

// arrastar o backup pra dentro da página também abre
addEventListener('dragover', e => { if ([...(e.dataTransfer?.types || [])].includes('Files')) e.preventDefault(); });
addEventListener('drop', e => { const f = e.dataTransfer?.files?.[0]; if (f) { e.preventDefault(); importarArquivo(f); } });

// outra aba alterou os dados → recarrega; voltar pra aba num outro dia → recalcula prazos
addEventListener('storage', e => { if (e.key === CHAVE || e.key === CHAVE_META) { lerLocal(); render(); } });
document.addEventListener('visibilitychange', () => { if (!document.hidden && !fecharAtual) render(); });
// os dados já ficam no navegador; só avisa ao sair se ele recusou salvar
addEventListener('beforeunload', e => { if (!armazenamentoOk) { e.preventDefault(); e.returnValue = ''; } });

lerLocal();
render();
document.documentElement.dataset.pronto = '1';
