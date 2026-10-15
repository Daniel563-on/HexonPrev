import { HexonUser } from '../types';

// TÉCNICO LOCAL (Lote 2, 15/10/2026): técnico da gerência DOM marcado "Técnico local" no cadastro, com a comarca onde
// atua (obrigatória, da lista de endereços). A DOM programa a semana dele (range de dias); as outras gerências só
// ATRIBUEM chamados e preventivas a ele (sem dia e sem pernoite), em listas separadas dos técnicos da gerência.
// Material e insumo que ele usa saem da gerência da OS. Pelas regras do banco ele lê e executa só o que foi atribuído a ele.
export const LOCAL_TECH_UNIT = 'DOM';

type TechLike = Pick<HexonUser, 'perfil' | 'gerencia'> & { localTech?: boolean };

export const isLocalTech = (u?: TechLike | null): boolean => !!u && u.perfil === 'Profissional' && u.localTech === true;
// Cadastro antigo (antes do campo): técnico com gerência "Todas". Entra na lista dos locais até ser editado.
export const isLegacyAllUnitsTech = (u?: TechLike | null): boolean => !!u && u.perfil === 'Profissional' && u.gerencia === 'Todas';

export interface LocalTechOption {
  matricula: string;
  name: string;
  comarca: string;
  companies: string[];
  legacy?: boolean; // gerência "Todas" (cadastro antigo)
}

// Técnicos locais de uma lista de usuários (ativos, da empresa, se informada)
export function localTechOptions(users: (TechLike & Partial<HexonUser>)[], company?: string): LocalTechOption[] {
  return users
    .filter((u) => u.status !== 'Inativo' && (isLocalTech(u) || isLegacyAllUnitsTech(u)) && !!u.matricula)
    .filter((u) => !company || (u.companies || []).includes(company))
    .map((u) => ({
      matricula: String(u.matricula),
      name: String(u.name || u.matricula),
      comarca: isLocalTech(u) ? String(u.localComarca || '') : '',
      companies: u.companies || [],
      legacy: !isLocalTech(u) || undefined
    }));
}

// Grupos da lista: quem atua na comarca da OS primeiro; depois por comarca e nome; cadastros antigos no fim
export function localTechGroups(list: LocalTechOption[], comarca?: string): { label: string; list: LocalTechOption[] }[] {
  const norm = (s: string) => s.trim().toLowerCase();
  const byName = (a: LocalTechOption, b: LocalTechOption) => a.name.localeCompare(b.name);
  const here = comarca ? list.filter((t) => !t.legacy && t.comarca && norm(t.comarca) === norm(comarca)).sort(byName) : [];
  const others = list
    .filter((t) => !t.legacy && !here.includes(t))
    .sort((a, b) => (a.comarca || 'zzz').localeCompare(b.comarca || 'zzz') || byName(a, b));
  const legacy = list.filter((t) => t.legacy).sort(byName);
  return [
    { label: `Na comarca da OS — ${comarca}`, list: here },
    { label: here.length ? 'Outras comarcas' : 'Técnicos locais', list: others },
    { label: 'Cadastro antigo (gerência "Todas")', list: legacy }
  ].filter((g) => g.list.length > 0);
}

export const localTechLabel = (t: LocalTechOption) => `${t.name} (${t.matricula})${t.comarca ? ` — ${t.comarca}` : ''}`;
