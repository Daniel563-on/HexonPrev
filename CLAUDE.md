# Hexon Preventiva — instruções para o Claude

**Antes de qualquer tarefa, leia `docs/requisitos-hexon.md`** — começando pelas seções **0 (Guia rápido)** e **0.1 (Estado atual do app)** (documento principal: fluxo de trabalho, decisões, regras do banco, índices, custos, proteções e pendências). Ao terminar uma entrega, atualize esse documento (decisões novas, pendências, índices, regras).

Resumo do essencial (detalhes no documento):
- Usuário não programa: conversa em português, respostas diretas, sem inventar; desenhar e pedir aprovação antes de programar.
- Desenvolver no ramo `claude/analise-codigo-npm-dev-oqclzj`; rodar `npx tsc --noEmit` e `npm run build`; commit e push.
- **Entrega direto no `main` (desde 13/10/2026; não se mandam mais trechos para o AI Studio):** depois de todos os testes, dizer ao usuário o resultado (números), o que muda, os índices novos e o texto das regras, e **pedir autorização para enviar ao `main`**. Só com o "autorizo" dele: conferir se o `main` mudou (`git fetch origin main`; se mudou, juntar e testar de novo), fazer o `main` andar até o ramo (`git push origin HEAD:main`, sem forçar) e manter o ramo igual ao `main`. O usuário puxa no Google AI Studio, confere no preview e faz o deploy.
- Regras do banco são publicadas à mão no Console (aba Segurança): mandar o texto completo no chat.
- Todo arquivo novo em `src/db` deve importar o Firestore de `./guard` (disjuntor); operação que grava/lê muito de uma vez deve usar `runBulk`.
- Banco Firestore Enterprise: custo por unidades de leitura/gravação e por entrada de índice; preferir índices esparsos e campos de controle (`src/db/orderControl.ts`).
- **Vocabulário do usuário:** "OS" / "Ordens de Serviço" = OS do sistema principal (corretiva, layout, acompanhamento). "Preventiva" / "PMOC" = o sistema de preventivas. Não misturar.
- Hexon 2.0 = junção do Hexon principal com a Preventiva: em toda fase que juntar os dois, avisar no desenho que é etapa de junção (o que vem de cada lado).
- **Arquivo no celular nunca por link de download:** usar `deliverFile`/`deliverBytes` (`src/lib/fileDelivery.ts` → aviso "PDF pronto"). No iPhone, a página sair (`pagehide`) desliga o Firestore e o app trava (P39). Nome de arquivo por `safeFileName`.
- **Formulário da OS no celular não tem "Salvar":** só Pendente, Acompanhamento (caixa com texto obrigatório) e Concluir.
- **Tempo real barato:** escutas por campos de controle esparsos (`techOpen`, `cliSigned`, `signQueue`, `nextSigner`) ou só do que mudou depois de abrir a tela (`subscribeWorkOrderChanges`); nunca escutar uma coleção inteira.
- Status no banco "Aguardando assinaturas" + `nextSigner`; na tela/PDF/planilha usar `osStatusLabel`.
- Testar antes de entregar: emuladores do Firebase + vite + Playwright, com as regras publicadas (o usuário cola no chat).
