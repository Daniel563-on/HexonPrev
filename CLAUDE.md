# Hexon Preventiva — instruções para o Claude

**Antes de qualquer tarefa, leia `docs/requisitos-hexon.md`** (documento principal: fluxo de trabalho, decisões, regras do banco, índices, custos, proteções e pendências). Ao terminar uma entrega, atualize esse documento (decisões novas, pendências, índices, regras).

Resumo do essencial (detalhes no documento):
- Usuário não programa: conversa em português, respostas diretas, sem inventar; desenhar e pedir aprovação antes de programar.
- Desenvolver no ramo `claude/analise-codigo-npm-dev-oqclzj`; rodar `npx tsc --noEmit` e `npm run build`; commit e push.
- Entregar trechos (.md "Trocar / Por" ou arquivo inteiro) conferidos contra `origin/main`; o usuário aplica no Google AI Studio e faz commit no `main`.
- Regras do banco são publicadas à mão no Console (aba Segurança): mandar o texto completo no chat.
- Todo arquivo novo em `src/db` deve importar o Firestore de `./guard` (disjuntor); operação que grava/lê muito de uma vez deve usar `runBulk`.
- Banco Firestore Enterprise: custo por unidades de leitura/gravação e por entrada de índice; preferir índices esparsos e campos de controle (`src/db/orderControl.ts`).
- **Vocabulário do usuário:** "OS" / "Ordens de Serviço" = OS do sistema principal (corretiva, layout, acompanhamento). "Preventiva" / "PMOC" = o sistema de preventivas. Não misturar.
- Hexon 2.0 = junção do Hexon principal com a Preventiva: em toda fase que juntar os dois, avisar no desenho que é etapa de junção (o que vem de cada lado).
