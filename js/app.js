// Interface do Financeiro. As regras ficam em logica.js; aqui é só DOM, armazenamento e backup.
import {
  COLECOES, MES, FORMAS, TIPOS_CONTA, deIso, hojeIso, quando, nomeMes, pad, brl, parseValor, valorParaCampo,
  deBackup, paraBackup, contagem, backupPendente, vazio, adicionar, atualizar, remover, pagar, desfazer,
  fecharFatura, resumo, grupos, pagosRecentes, porMes, disponivel, proximoDia, dias, ehData
} from './logica.js';

const CHAVE = 'financeiro-breno.v1', CHAVE_META = 'financeiro-breno.meta';
const $ = id => document.getElementById(id);

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
function toast(msg) {
  const t = $('toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, 3200);
}

// ---------- estado e armazenamento ----------

let st = vazio();
let meta = { alteradoEm: null, exportadoEm: null };
let armazenamentoOk = true;

function lerLocal() {
  try {
    const bruto = localStorage.getItem(CHAVE);
    st = bruto ? deBackup(JSON.parse(bruto)) : vazio();
    meta = Object.assign({ alteradoEm: null, exportadoEm: null }, JSON.parse(localStorage.getItem(CHAVE_META) || '{}'));
  } catch (e) {
    st = vazio();
    if (e instanceof Error && !(e instanceof SyntaxError) && e.message.startsWith('Backup')) toast('Os dados salvos neste navegador estão inválidos. Importe seu backup.');
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
function aplicar(novo, msg) {
  st = novo;
  meta.alteradoEm = new Date().toISOString();
  if (!gravarLocal()) toast('O navegador não deixou salvar. Exporte o backup antes de fechar a página.');
  else if (msg) toast(msg);
  render();
}

// ---------- formulários ----------

const ESPECS = {
  lancamentos: { nome: 'lançamento', campos: [
    { k: 'descricao', l: 'Descrição', t: 'text', req: 1, ph: 'Ex.: Aluguel, Claro, MEI', auto: 'off' },
    { k: 'valor', l: 'Valor (R$)', t: 'money', req: 1, ph: '182,40' },
    { k: 'vencimento', l: 'Vencimento', t: 'date', req: 1 },
    { k: 'natureza', l: 'Tipo', t: 'select', o: [['pagar', 'A pagar'], ['receber', 'A receber']], meia: 1 },
    { k: 'forma', l: 'Forma', t: 'select', o: FORMAS, meia: 1 },
    { k: 'cartaoId', l: 'Qual cartão', t: 'select', cartoes: 1, meia: 1 },
    { k: 'recorrencia', l: 'Repete', t: 'select', o: [['', 'Não repete'], ['mensal', 'Todo mês']], meia: 1 },
    { k: 'categoria', l: 'Categoria', t: 'text', ph: 'Moradia, obra…', meia: 1, lista: 'categorias' },
    { k: 'codigo', l: 'Linha digitável ou Pix copia e cola', t: 'textarea' },
    { k: 'obs', l: 'Observação', t: 'textarea' }
  ] },
  contas: { nome: 'conta', campos: [
    { k: 'nome', l: 'Banco / conta', t: 'text', req: 1, ph: 'Ex.: Itaú corrente' },
    { k: 'tipo', l: 'Tipo', t: 'select', o: TIPOS_CONTA },
    { k: 'saldo', l: 'Saldo atual (R$)', t: 'money', req: 1, ph: '2.350,00', neg: 1 }
  ] },
  cartoes: { nome: 'cartão', campos: [
    { k: 'nome', l: 'Cartão', t: 'text', req: 1, ph: 'Ex.: Nubank' },
    { k: 'limite', l: 'Limite total (R$)', t: 'money', meia: 1 },
    { k: 'fatura', l: 'Fatura em aberto (R$)', t: 'money', ph: '0,00', meia: 1 },
    { k: 'diaFechamento', l: 'Dia do fechamento', t: 'day', meia: 1 },
    { k: 'diaVencimento', l: 'Dia do vencimento', t: 'day', req: 1, meia: 1 }
  ] }
};

let fecharModal = null;
function abrirForm(colecao, item, padrao) {
  const base = ESPECS[colecao];
  // o campo "Qual cartão" só existe quando há cartões cadastrados
  const espec = { ...base, campos: base.campos.filter(c => !c.cartoes || st.cartoes.length) };
  const dados = Object.assign({}, padrao || {}, item ? item.dados : {});
  const origemFoco = document.activeElement;
  const raiz = $('modal-raiz');
  const msg = el('p', { class: 'msg', role: 'alert' });
  const inputs = {};
  const titulo = (item ? 'Editar ' : 'Novo ') + espec.nome;

  const campos = espec.campos.map(c => {
    const id = 'f-' + colecao + '-' + c.k;
    let inp;
    if (c.t === 'select') {
      const opcoes = c.cartoes ? [['', 'Nenhum'], ...st.cartoes.map(k => [k.id, k.dados.nome])] : c.o;
      inp = el('select', { id }, opcoes.map(([v, l]) => el('option', { value: v }, l)));
      c = { ...c, o: opcoes };
      inp.value = dados[c.k] ?? c.o[0][0];
      if (inp.selectedIndex < 0) inp.value = c.o[0][0];
    } else if (c.t === 'textarea') {
      inp = el('textarea', { id, placeholder: c.ph, rows: 2 });
      inp.value = dados[c.k] || '';
    } else {
      const tipo = { money: 'text', day: 'number' }[c.t] || c.t;
      inp = el('input', {
        id, type: tipo, placeholder: c.ph, autocomplete: c.auto || 'off', list: c.lista,
        inputmode: c.t === 'money' ? 'decimal' : (c.t === 'day' ? 'numeric' : null),
        min: c.t === 'day' ? '1' : null, max: c.t === 'day' ? '31' : null, step: c.t === 'day' ? '1' : null
      });
      const v = dados[c.k];
      inp.value = v == null ? '' : (c.t === 'money' ? valorParaCampo(v) : v);
    }
    inputs[c.k] = inp;
    return el('div', { class: 'campo' + (c.meia ? ' meia' : '') }, el('label', { for: id }, c.l, c.req || c.t === 'select' ? null : el('span', { class: 'opc' }, ' (opcional)')), inp);
  });

  // categorias já usadas viram sugestões
  // "Qual cartão" só aparece quando a forma é fatura
  if (inputs.cartaoId) {
    const caixa = inputs.cartaoId.parentElement;
    const sincroniza = () => { caixa.hidden = inputs.forma.value !== 'fatura'; };
    inputs.forma.addEventListener('change', sincroniza); sincroniza();
  }

  const cats = [...new Set(st.lancamentos.map(l => l.dados.categoria).filter(Boolean))].sort();
  const datalist = el('datalist', { id: 'categorias' }, cats.map(c => el('option', { value: c })));

  let confirmando = false;
  const btExcluir = item ? el('button', { class: 'btn perigo', type: 'button', onclick: () => {
    if (!confirmando) { confirmando = true; btExcluir.textContent = 'Toque de novo para excluir'; btExcluir.classList.add('armado'); return; }
    fechar(); aplicar(remover(st, colecao, item.id), 'Excluído');
  } }, 'Excluir') : null;

  const form = el('form', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'modal-titulo', novalidate: true, onsubmit: e => {
    e.preventDefault();
    const out = {};
    for (const c of espec.campos) {
      const inp = inputs[c.k], raw = inp.value.trim();
      const erro = texto => { msg.textContent = texto; inp.setAttribute('aria-invalid', 'true'); inp.focus(); };
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
      if (out.forma !== 'fatura' || !out.cartaoId) delete out.cartaoId;
      if (out.forma !== 'fatura' && item?.dados.cartaoId) out.cartaoId = null;
      if (out.recorrencia === 'mensal') out.diaBase = Number(out.vencimento.slice(8));
      if (!item) Object.assign(out, { pago: false, pagoEm: null });
    }
    fechar();
    aplicar(item ? atualizar(st, colecao, item.id, out) : adicionar(st, colecao, out), 'Salvo');
  } },
    el('div', { class: 'modal-topo' },
      el('h3', { id: 'modal-titulo' }, titulo),
      el('button', { class: 'btn-icone', type: 'button', 'aria-label': 'Fechar', onclick: () => fechar() }, '×')),
    el('div', { class: 'campos' }, campos), datalist, msg,
    el('div', { class: 'rodape' }, btExcluir || el('span'),
      el('div', { class: 'acoes' },
        el('button', { class: 'btn', type: 'button', onclick: () => fechar() }, 'Cancelar'),
        el('button', { class: 'btn primario', type: 'submit' }, 'Salvar')))
  );

  const fundo = el('div', { class: 'modal-fundo', onmousedown: e => { if (e.target === e.currentTarget) fechar(); } }, form);
  function teclas(e) {
    if (e.key === 'Escape') { e.preventDefault(); fechar(); }
    if (e.key === 'Tab') { // mantém o foco dentro do formulário
      const f = [...form.querySelectorAll('button, input, select, textarea')].filter(x => !x.disabled);
      const [pri, ult] = [f[0], f[f.length - 1]];
      if (e.shiftKey && document.activeElement === pri) { e.preventDefault(); ult.focus(); }
      else if (!e.shiftKey && document.activeElement === ult) { e.preventDefault(); pri.focus(); }
    }
  }
  function fechar() {
    document.removeEventListener('keydown', teclas);
    raiz.replaceChildren();
    document.body.classList.remove('travado');
    fecharModal = null;
    if (origemFoco && document.contains(origemFoco)) origemFoco.focus();
  }
  if (fecharModal) fecharModal();
  fecharModal = fechar;
  document.addEventListener('keydown', teclas);
  document.body.classList.add('travado');
  raiz.replaceChildren(fundo);
  inputs[espec.campos[0].k].focus();
}

// ---------- ações ----------

function marcarPago(l) {
  const r = pagar(st, l.id, hojeIso());
  const ehReceber = l.dados.natureza === 'receber';
  aplicar(r.st, r.proximo ? (ehReceber ? 'Recebido' : 'Pago') + '. O de ' + nomeMes(r.proximo.vencimento) + ' já está na lista.' : (ehReceber ? 'Marcado como recebido' : 'Marcado como pago'));
}
async function copiar(txt) {
  try { await navigator.clipboard.writeText(txt); toast('Código copiado'); }
  catch { toast('Não deu para copiar. Abra “Editar” e copie do campo.'); }
}
function lancarFatura(c) {
  const r = fecharFatura(st, c.id, hojeIso());
  if (!r) return toast('A fatura em aberto está zerada.');
  aplicar(r.st, 'Fatura de ' + brl(r.valor) + ' lançada para ' + deIso(r.vencimento).toLocaleDateString('pt-BR'));
}

// ---------- render ----------

const formaNome = f => (FORMAS.find(x => x[0] === f) || [null, f])[1];

function itemLanc(l, hoje, pago) {
  const d = l.dados, n = dias(hoje, d.vencimento), receber = d.natureza === 'receber';
  const estado = pago ? 'pago' : n < 0 ? 'atrasado' : n <= 2 ? 'perto' : '';
  const dt = deIso(d.vencimento);
  const prazo = pago ? null : el('span', { class: 'pill ' + (n < 0 ? 'vermelho' : n <= 2 ? 'ambar' : '') }, (n < 0 ? 'venceu ' : 'vence ') + quando(d.vencimento, hoje));
  return el('article', { class: 'item ' + estado, 'data-id': l.id },
    el('div', { class: 'data', 'aria-hidden': 'true' }, el('b', {}, pad(dt.getDate())), el('span', {}, MES[dt.getMonth()])),
    el('div', { class: 'desc' },
      el('h3', { class: 't' }, d.descricao || '(sem descrição)'),
      el('div', { class: 'm' },
        prazo,
        receber ? el('span', { class: 'pill verde' }, 'a receber') : null,
        d.forma ? el('span', {}, formaNome(d.forma)) : null,
        d.categoria ? el('span', {}, d.categoria) : null,
        d.recorrencia === 'mensal' ? el('span', {}, '↻ todo mês') : null,
        pago ? el('span', {}, (receber ? 'recebido em ' : 'pago em ') + deIso(d.pagoEm || hoje).toLocaleDateString('pt-BR')) : null),
      d.obs ? el('p', { class: 'obs' }, d.obs) : null),
    el('div', { class: 'dir' },
      el('span', { class: 'valor num' + (receber ? ' pos' : '') }, (receber ? '+ ' : '') + brl(d.valor)),
      el('div', { class: 'bts' }, pago
        ? [el('button', { class: 'btn peq', type: 'button', 'aria-label': 'Editar ' + (d.descricao || ''), onclick: () => abrirForm('lancamentos', l) }, 'Editar'),
           el('button', { class: 'btn peq', type: 'button', onclick: () => aplicar(desfazer(st, l.id), 'Voltou para a lista') }, 'Desfazer')]
        : [
            d.codigo ? el('button', { class: 'btn peq', type: 'button', onclick: () => copiar(d.codigo) }, 'Copiar código') : null,
            el('button', { class: 'btn peq', type: 'button', 'aria-label': 'Editar ' + (d.descricao || ''), onclick: () => abrirForm('lancamentos', l) }, 'Editar'),
            el('button', { class: 'btn peq primario', type: 'button', onclick: () => marcarPago(l) }, receber ? 'Recebi' : 'Paguei')
          ]))
  );
}

function renderResumo(hoje) {
  const r = resumo(st, hoje);
  $('r-saldo').textContent = r.temContas ? brl(r.saldo) : '—';
  $('r-saldo-sub').textContent = r.investido ? '+ ' + brl(r.investido) + ' investidos' : 'corrente, poupança e carteira';
  $('r-pagar').textContent = brl(r.pagar30);
  $('r-pagar-sub').textContent = r.nPagar30 ? r.nPagar30 + (r.nPagar30 > 1 ? ' contas' : ' conta') + ', com atrasadas' : 'nada a pagar';
  $('r-atraso').textContent = brl(r.atrasado);
  $('r-atraso').className = 'val num' + (r.nAtrasados ? ' neg' : '');
  $('t-atraso').classList.toggle('alerta', r.nAtrasados > 0);
  $('r-atraso-sub').textContent = r.nAtrasados ? r.nAtrasados + (r.nAtrasados > 1 ? ' contas vencidas' : ' conta vencida') : 'nada vencido';
  $('r-sobra').textContent = r.temContas ? brl(r.sobra) : '—';
  $('r-sobra').className = 'val num' + (!r.temContas ? '' : r.sobra < 0 ? ' neg' : ' pos');
  $('r-sobra-sub').textContent = r.temContas ? 'saldo + a receber − a pagar' : 'cadastre suas contas';
}

function renderMeses(hoje) {
  const linhas = porMes(st, hoje);
  $('meses-box').hidden = !linhas.length;
  $('meses').replaceChildren(...linhas.map(r => el('tr', { class: r.atual ? 'atual' : '' },
    el('th', { scope: 'row' }, nomeMes(r.mes), r.atual ? el('span', { class: 'sub' }, ' atual') : null),
    el('td', { 'data-rot': 'Faturas' }, brl(r.faturas)), el('td', { 'data-rot': 'Contas' }, brl(r.contas)),
    el('td', { 'data-rot': 'Total', class: 'forte' }, brl(r.total)),
    el('td', { 'data-rot': 'Pago', class: r.pago ? 'pos' : '' }, brl(r.pago)),
    el('td', { 'data-rot': 'Falta', class: r.falta && r.mes < hoje.slice(0, 7) ? 'neg forte' : 'forte' }, brl(r.falta)))));
}

function renderVencimentos(hoje) {
  const box = $('vencimentos');
  const gs = grupos(st, hoje);
  const nada = !st.lancamentos.length && !st.contas.length && !st.cartoes.length;
  $('inicio').hidden = !nada;
  if (!gs.length) {
    box.replaceChildren(nada ? '' : el('div', { class: 'vazio' }, st.lancamentos.length ? 'Tudo pago. Nenhum vencimento em aberto.' : 'Nenhum vencimento cadastrado. Use “+ Conta a pagar”.'));
  } else {
    box.replaceChildren(...gs.map(g => el('div', { class: 'grupo ' + g.chave },
      el('h3', { class: 'grupo-tit' }, el('span', {}, g.titulo, el('span', { class: 'qtd' }, ' · ' + g.itens.length)), el('span', { class: 'num' }, g.totalPagar ? brl(g.totalPagar) : '')),
      g.itens.map(l => itemLanc(l, hoje, false)))));
  }
  const pagos = pagosRecentes(st, hoje);
  $('pagos-box').hidden = !pagos.length;
  $('pagos-tit').textContent = 'Pagos nos últimos 30 dias (' + pagos.length + ')';
  $('pagos').replaceChildren(...pagos.map(l => itemLanc(l, hoje, true)));
}

function renderLado(hoje) {
  const velho = d => d && dias(d, hoje) > 7;
  const atualizado = d => d ? el('span', { class: velho(d) ? 'pill ambar' : '' }, 'atualizado ' + quando(d, hoje)) : null;
  const porNome = arr => [...arr].sort((a, b) => (a.dados.nome || '').localeCompare(b.dados.nome || '', 'pt-BR'));
  const tipoNome = t => ({ corrente: 'corrente', poupanca: 'poupança', carteira: 'carteira', investimento: 'investimento' })[t] || t || '';

  $('contas').replaceChildren(...(st.contas.length ? porNome(st.contas).map(c => el('div', { class: 'linha', 'data-id': c.id },
    el('h3', { class: 't' }, c.dados.nome),
    el('span', { class: 'num forte' + (Number(c.dados.saldo) < 0 ? ' neg' : '') }, brl(c.dados.saldo)),
    el('div', { class: 'm' }, el('span', {}, tipoNome(c.dados.tipo)), atualizado(c.dados.atualizadoEm)),
    el('div', { class: 'acoes-linha' }, el('button', { class: 'btn peq', type: 'button', 'aria-label': 'Atualizar saldo de ' + c.dados.nome, onclick: () => abrirForm('contas', c) }, 'Atualizar saldo'))))
    : [el('p', { class: 'linha m' }, 'Cadastre suas contas com o saldo que aparece no app do banco.')]));

  $('cartoes').replaceChildren(...(st.cartoes.length ? porNome(st.cartoes).map(c => {
    const d = c.dados, lim = Number(d.limite) || 0, livre = disponivel(st, c);
    const uso = lim ? Math.max(0, Math.min(100, Math.round((lim - livre) / lim * 100))) : 0;
    const venc = d.diaVencimento ? proximoDia(d.diaVencimento, hoje) : null;
    return el('div', { class: 'linha', 'data-id': c.id },
      el('h3', { class: 't' }, d.nome),
      el('span', { class: 'num forte' }, brl(d.fatura)),
      el('div', { class: 'm' }, el('span', {}, 'fatura em aberto'), d.diaFechamento ? el('span', {}, 'fecha dia ' + d.diaFechamento) : null,
        venc ? el('span', {}, 'vence ' + deIso(venc).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })) : null),
      lim ? el('div', { class: 'barra', role: 'meter', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(uso), 'aria-label': 'Limite usado em ' + d.nome },
        el('i', { class: uso >= 80 ? 'alto' : '', style: 'width:' + uso + '%' })) : null,
      lim ? el('div', { class: 'm' }, el('span', { class: livre < 0 ? 'neg' : '' }, 'livre ' + brl(livre) + ' de ' + brl(lim)), atualizado(d.atualizadoEm)) : el('div', { class: 'm' }, atualizado(d.atualizadoEm)),
      el('div', { class: 'acoes-linha' },
        el('button', { class: 'btn peq', type: 'button', 'aria-label': 'Atualizar cartão ' + d.nome, onclick: () => abrirForm('cartoes', c) }, 'Atualizar'),
        Number(d.fatura) > 0 ? el('button', { class: 'btn peq', type: 'button', onclick: () => lancarFatura(c) }, 'Fatura fechou: lançar') : null));
  }) : [el('p', { class: 'linha m' }, 'Cadastre cartões com limite e dia de vencimento.')]));
}

const fmtData = s => new Date(s).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
function renderBackup() {
  const pend = backupPendente(meta);
  $('backup').classList.toggle('pendente', pend || !armazenamentoOk);
  $('status').textContent = !armazenamentoOk ? 'O navegador não está salvando. Exporte o backup antes de fechar.'
    : pend ? 'Há alterações fora do backup. Exporte e substitua o arquivo no Drive.'
    : meta.exportadoEm ? 'Backup em dia · ' + fmtData(meta.exportadoEm)
    : 'Os dados ficam só neste navegador. Guarde o backup no Drive.';
}

function render() {
  const hoje = hojeIso();
  $('hoje').textContent = deIso(hoje).toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  renderResumo(hoje);
  renderMeses(hoje);
  renderVencimentos(hoje);
  renderLado(hoje);
  renderBackup();
}

// ---------- backup: exportar / importar ----------

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

function importarObjeto(obj) {
  let novo;
  try { novo = deBackup(obj); } catch (e) { toast(e.message); return; }
  const salvo = typeof obj.salvoEm === 'string' && !isNaN(Date.parse(obj.salvoEm)) ? obj.salvoEm : null;
  const c = contagem(novo);
  const efetivar = () => {
    st = novo;
    meta = { alteradoEm: salvo || new Date().toISOString(), exportadoEm: salvo || new Date().toISOString() };
    gravarLocal(); render();
    $('confirma').hidden = true;
    toast('Backup importado: ' + c.lancamentos + ' lançamentos, ' + c.contas + ' contas, ' + c.cartoes + ' cartões');
  };
  const temDados = COLECOES.some(n => st[n].length);
  if (!temDados) return efetivar();
  const maisVelho = salvo && meta.alteradoEm && salvo < meta.alteradoEm;
  const box = $('confirma');
  box.replaceChildren(
    el('p', {}, 'Substituir os dados deste navegador pelo backup' + (salvo ? ' de ' + fmtData(salvo) : '') + ' (' + c.lancamentos + ' lançamentos, ' + c.contas + ' contas, ' + c.cartoes + ' cartões)?',
      maisVelho ? el('strong', { class: 'neg' }, ' Esse backup é mais antigo que as alterações feitas aqui; elas serão perdidas.') : null),
    el('div', { class: 'acoes' },
      el('button', { class: 'btn peq primario', type: 'button', onclick: efetivar }, 'Substituir'),
      el('button', { class: 'btn peq', type: 'button', onclick: () => { box.hidden = true; } }, 'Cancelar')));
  box.hidden = false;
  box.querySelector('button').focus();
}

async function importarArquivo(f) {
  if (!f) return;
  try { importarObjeto(JSON.parse(await f.text())); }
  catch { toast('Não consegui ler esse arquivo. Escolha o financeiro-backup.json.'); }
}

// ---------- ligações ----------

$('bt-novo').onclick = () => abrirForm('lancamentos', null, { natureza: 'pagar', forma: 'boleto', vencimento: hojeIso() });
$('bt-receber').onclick = () => abrirForm('lancamentos', null, { natureza: 'receber', forma: 'pix', vencimento: hojeIso() });
$('bt-conta').onclick = () => abrirForm('contas');
$('bt-cartao').onclick = () => abrirForm('cartoes');
$('bt-exportar').onclick = exportar;
$('bt-importar').onclick = () => $('arquivo').click();
$('arquivo').onchange = e => { const f = e.target.files[0]; e.target.value = ''; importarArquivo(f); };
document.querySelectorAll('[data-acao="importar"]').forEach(b => { b.onclick = () => $('arquivo').click(); });
document.querySelectorAll('[data-acao="conta"]').forEach(b => { b.onclick = () => abrirForm('contas'); });
document.querySelectorAll('[data-acao="lancamento"]').forEach(b => { b.onclick = $('bt-novo').onclick; });

// arrastar o backup pra dentro da página também importa
addEventListener('dragover', e => { if ([...(e.dataTransfer?.types || [])].includes('Files')) e.preventDefault(); });
addEventListener('drop', e => { const f = e.dataTransfer?.files?.[0]; if (f) { e.preventDefault(); importarArquivo(f); } });

// outra aba alterou os dados → recarrega; voltar pra aba num outro dia → recalcula prazos
addEventListener('storage', e => { if (e.key === CHAVE || e.key === CHAVE_META) { lerLocal(); render(); } });
document.addEventListener('visibilitychange', () => { if (!document.hidden) render(); });
// os dados já ficam no navegador; só avisa ao sair se ele recusou salvar
addEventListener('beforeunload', e => { if (!armazenamentoOk) { e.preventDefault(); e.returnValue = ''; } });

lerLocal();
render();
document.documentElement.dataset.pronto = '1';
