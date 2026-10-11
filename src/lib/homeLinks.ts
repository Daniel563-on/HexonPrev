// ATALHOS DO INÍCIO: o Início guarda aqui o filtro com que a próxima tela deve abrir (ex.: lista de OS em "Contestadas",
// Solicitações na aba "Material"). A tela lê ao abrir (peek) e apaga depois de abrir (clear).
// Só na memória: recarregar a página volta ao normal.

const links = new Map<string, unknown>();

export function setHomeLink(screen: string, value: unknown): void {
  links.set(screen, value);
}

export function peekHomeLink<T>(screen: string): T | undefined {
  return links.get(screen) as T | undefined;
}

export function clearHomeLink(screen: string): void {
  links.delete(screen);
}

// Lista de OS (Chamados GLPI): situação do painel, "atrasadas" ou a fila "Precisam da minha assinatura"
export interface HomeOsLink {
  status?: string;
  late?: boolean;
  sign?: boolean;
}
