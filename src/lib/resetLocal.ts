import { idbKeys, idbRemove } from '../utils/idbCache';

// ZERAR O BANCO (ajuste A2) — o lado do aparelho.
// O servidor grava appControl/status.resetAt (e resetUsersAt no zerar para implantação). Aparelho com cópia guardada
// de antes daquele zerar: marca, recarrega e apaga a cópia no começo da próxima abertura (antes de qualquer tela usá-la).
// Assim não sobram OS "fantasmas" (excluídas no banco e ainda na tela). Cadastros guardados (ativos, materiais, modelos,
// endereços...) continuam: não mudam no zerar.

const SEEN_KEY = 'hexon_reset_seen_v1';
const PENDING_KEY = 'hexon_reset_pending_v1';

interface Marks {
  at: number;
  usersAt: number;
}
interface Pending extends Marks {
  users: boolean;
}

// Movimento (os dois modos): cópia das OS, exclusões recebidas, rascunhos de execução e listas antigas
const ORDER_IDB = ['hexon_orders_sync_v1_', 'hexon_orders_deletions_v1_'];
const ORDER_LS = ['hexon_service_orders', 'hexon_histories', 'hexon_planning_deadlines', 'hexon_audit_logs', 'hexon_access_logs'];
const ORDER_LS_PREFIX = ['hexon_exec_draft_v1_', 'hexon_notices_'];
// Usuários (só no zerar para implantação). A sessão de quem está logado (hexon_cached_user) fica: ao abrir, o app confere
// o cadastro no banco — quem foi apagado sai sozinho e o Super Administrador continua dentro.
const isUsersIdb = (k: string) => k.startsWith('hexon_sync_v1|') && k.includes('|users|');
const USERS_LS = ['hexon_users', 'hexon_cache_timestamps'];

function read<T>(key: string): T | null {
  try {
    return JSON.parse(localStorage.getItem(key) || 'null') as T | null;
  } catch {
    return null;
  }
}
function write(key: string, v: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* ignora */
  }
}

const idbMatch = (k: string, users: boolean) => ORDER_IDB.some((p) => k.startsWith(p)) || (users && isUsersIdb(k));
const lsMatch = (k: string, users: boolean) => ORDER_LS.includes(k) || ORDER_LS_PREFIX.some((p) => k.startsWith(p)) || (users && USERS_LS.includes(k));

function lsKeys(): string[] {
  try {
    return Object.keys(localStorage);
  } catch {
    return [];
  }
}

async function hasCopies(users: boolean): Promise<boolean> {
  if (lsKeys().some((k) => lsMatch(k, users))) return true;
  return (await idbKeys()).some((k) => idbMatch(k, users));
}

// Chamado a cada mudança do controle do sistema: zerar novo → apaga a cópia (recarregando) ou só anota, se não há cópia
let handling = false;
export async function checkResetMarks(c: { resetAt?: number; resetUsersAt?: number } | null): Promise<void> {
  if (!c || handling) return;
  const seen = read<Marks>(SEEN_KEY) || { at: 0, usersAt: 0 };
  const at = Number(c.resetAt || 0);
  const usersAt = Number(c.resetUsersAt || 0);
  // Só um valor MAIOR que o já tratado (a cópia do aparelho do controle pode estar atrasada)
  if (at <= seen.at && usersAt <= seen.usersAt) return;
  handling = true;
  const marks: Marks = { at: Math.max(at, seen.at), usersAt: Math.max(usersAt, seen.usersAt) };
  const users = usersAt > seen.usersAt;
  if (!(await hasCopies(users))) {
    write(SEEN_KEY, marks);
    handling = false;
    return;
  }
  write(PENDING_KEY, { ...marks, users } as Pending);
  window.location.reload();
}

// Começo da abertura do app (main.tsx), antes das telas: apaga a cópia marcada
export async function runPendingReset(): Promise<void> {
  const p = read<Pending>(PENDING_KEY);
  if (!p) return;
  try {
    const keys = await idbKeys();
    await Promise.all(keys.filter((k) => idbMatch(k, !!p.users)).map((k) => idbRemove(k)));
    lsKeys()
      .filter((k) => lsMatch(k, !!p.users))
      .forEach((k) => {
        try {
          localStorage.removeItem(k);
        } catch {
          /* ignora */
        }
      });
  } finally {
    // Mesmo se algo falhar, não fica recarregando sem parar
    write(SEEN_KEY, { at: p.at, usersAt: p.usersAt } as Marks);
    try {
      localStorage.removeItem(PENDING_KEY);
    } catch {
      /* ignora */
    }
  }
}
