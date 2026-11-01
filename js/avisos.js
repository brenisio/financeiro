// Avisos de vencimento. Usado pela página e pelo service worker (sw.js), que não enxerga o localStorage:
// por isso a página espelha o estado no IndexedDB, e os dois marcam ali o último dia avisado (um aviso por dia).
import { deBackup, avisoDoDia, hojeIso } from './logica.js';

const BANCO = 'financeiro-breno', LOJA = 'kv';
function abrir() {
  return new Promise((ok, erro) => {
    const r = indexedDB.open(BANCO, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(LOJA);
    r.onsuccess = () => ok(r.result);
    r.onerror = () => erro(r.error);
  });
}
async function op(modo, f) {
  const db = await abrir();
  try {
    return await new Promise((ok, erro) => {
      const t = db.transaction(LOJA, modo), r = f(t.objectStore(LOJA));
      t.oncomplete = () => ok(r?.result); t.onerror = () => erro(t.error);
    });
  } finally { db.close(); }
}
export const ler = k => op('readonly', s => s.get(k));
export const gravar = (k, v) => op('readwrite', s => s.put(v, k));

/** Mostra o aviso do dia se houver conta perto de vencer e se ainda não avisou hoje. `mostrar(titulo, opcoes)` exibe. */
export async function avisarSePreciso(mostrar, { hoje = hojeIso(), forcar = false } = {}) {
  const bruto = await ler('estado');
  if (!bruto) return null;
  const aviso = avisoDoDia(deBackup(bruto), hoje);
  if (!aviso || (!forcar && (await ler('avisadoEm')) === hoje)) return null;
  await mostrar(aviso.titulo, { body: aviso.corpo, tag: aviso.tag, icon: 'icones/192.png', badge: 'icones/192.png', data: { url: './' } });
  await gravar('avisadoEm', hoje);
  return aviso;
}
