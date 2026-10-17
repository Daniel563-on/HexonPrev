# Hexon Preventiva — Requisitos, análise e plano

> Documento vivo. Guarda o que o sistema precisa ter, o que já existe, o que muda e a ordem das etapas.
> **Se o contexto da conversa se perder, este arquivo é a referência.** Consultar antes de mexer em qualquer parte e atualizar ao fim de cada entrega.
> Última atualização: 17/10/2026 (separado: aqui fica só o que vale hoje — seções 0 a 10 e as ferramentas de teste 12.1; o histórico foi para `docs/historico/`: `diario.md` = seção 12, `hexon2-fases.md` = seção 11).

---

## 0. Guia rápido (ler primeiro)

**Onde está o quê**
| Item | Valor |
|---|---|
| Projeto do banco (Firebase) | `core-philosophy-lr5vm` (no Console aparece como "ai-builder-project") |
| Banco (Firestore **Enterprise**) | `ai-studio-f520b7fc-edf5-4548-b2db-299670f2da9a` |
| Projeto do site (Hosting) | `hexonpreventiva` → https://hexonpreventiva.web.app |
| Repositório | `Daniel563-on/HexonPrev` — ramo de desenvolvimento do Claude: `claude/analise-codigo-npm-dev-oqclzj`; produção: `main` |
| Conta de faturamento | "My Billing Account" (`01BE7A-702576-F19F68`), plano Blaze |

**Como ler este documento (para não perder o contexto)**
| Precisa saber… | Seção |
|---|---|
| Como trabalhamos, onde fica cada coisa, preferências do usuário | 0 (esta) |
| **O que o app tem hoje, regras técnicas, pendências e a lista de ajustes aberta** | **0.1** |
| O que o sistema deve fazer (requisitos) | 1 |
| Coleções do banco, para que serve cada uma e os **campos de controle** | 3 |
| Decisões tomadas e tabela de pendências antigas (P…) | 5 |
| Custos, medições e a simulação de carga (S1–S22, encerrada) | 7 e 7.1 |
| Disjuntor (proteção do banco) | 8 |
| **68 índices** (como estão no Console) | 9 |
| Mapa dos arquivos do código | 10 |
| Fases antigas do Hexon 2.0 e etapas especiais (empresas, visual, etapa 8…) — ler antes de 8D, Relatórios, Ponto/Contratos | 11 → **`docs/historico/hexon2-fases.md`** |
| **Diário das entregas** (pedidos e respostas do usuário, testes, commits — A1–A8, Lotes 1–6, Fase 7, Fase 9, Início, PWA) e o **detalhe de cada item da LISTA U** | 12 → **`docs/historico/diario.md`** |
| Ferramentas de teste (como refazer o ambiente numa sessão nova) | 12.1 (neste arquivo) |

**Como trabalhamos (fluxo de cada entrega)**
1. Conversar e **desenhar antes de programar**; o usuário aprova. Nada inventado: o que não foi confirmado é dito como "não sei / não confirmei".
2. Claude programa no ramo `claude/...`, roda `npx tsc --noEmit` e `npm run build`, faz commit e push.
3. **Entrega direto no `main` (combinado em 13/10/2026; antes eram trechos .md aplicados à mão no AI Studio, abandonado por ser lento e sujeito a erro de cópia):** depois de todos os testes, Claude diz ao usuário o resultado (números), o que muda, os **índices novos** e o **texto completo das regras**, e **pede autorização** para enviar ao `main`. Nada vai para o `main` sem o "autorizo" do usuário.
4. Com a autorização: `git fetch origin main` — se o `main` mudou (alguém mexeu pelo AI Studio), juntar no ramo e testar de novo; depois `git push origin HEAD:main` (o `main` só anda para frente, nunca forçar) e o ramo `claude/...` fica igual ao `main`. O usuário **puxa o git no Google AI Studio, confere no preview** e faz o deploy. Pedido ao usuário: não mexer no código pelo AI Studio durante uma etapa; se mexer, fazer commit e avisar.
   - Alinhamento feito no 1º envio (13/10/2026, 7B): o `main` (histórico do AI Studio) e o ramo (histórico do Claude) foram unidos num commit de junção; o código do `main` passou a ser exatamente o testado no ramo (sumiram as diferenças antigas: `dbGetClientSignedOrders`, linhas em branco). `LOGO HEXON.png` existe só no `main` e foi mantido. Desde então o `firestore.rules` do `main` é a versão mais nova das regras (a que o usuário deve ter publicado; vale sempre o que está no Console).
5. Deploy do site (usuário): `git pull` → `npm run build` → `firebase deploy` (só hosting) → botão **Forçar atualização** (Controle de Usuários → Sistema).
6. **Regras do banco:** publicadas à mão no Console → Firestore → banco `ai-studio-…` → aba **Segurança** (Ctrl+A, colar o arquivo inteiro, conferir 1ª linha `rules_version = '2';` e última `}`, Publicar). Mandar o texto completo **no chat**, dentro de um bloco de código (copiar de arquivo falhava). Quando a regra nova depende do app novo, **publicar só depois do deploy**.
7. **Índices:** criados à mão no Console → Índices (campos, ordem, "Esparso" quando indicado). Criar **antes** do deploy que usa o índice.
8. **Cloud Functions:** republicadas pelo Cloud Shell:
   ```
   cd ~ && rm -rf HexonPrev && git clone --branch claude/analise-codigo-npm-dev-oqclzj --depth 1 https://github.com/Daniel563-on/HexonPrev.git
   cd ~/HexonPrev/cloud-functions && (cd functions && npm install)
   npx firebase-tools@latest deploy --only functions --project core-philosophy-lr5vm
   gcloud run services add-iam-policy-binding resetuserpassword --region=us-central1 --project=core-philosophy-lr5vm --member="allUsers" --role="roles/run.invoker"
   ```
9. Testes: Claude testa antes de entregar com os **emuladores do Firebase + o site local (vite, porta 5173) + Playwright/Chromium** (para comparar com o código do `main`, trocar o código e **reiniciar o vite** — `use_code.sh`; a troca a quente não é confiável), usando as **regras publicadas** (o usuário cola no chat) e dados de teste criados na hora (os roteiros ficam no rascunho da sessão e se perdem entre sessões). Cuidados: depois de trocar as regras no emulador, `touch` no arquivo; se o ambiente cair, recriar os dados do zero; o modo de desenvolvimento do React monta as telas 2 vezes. O usuário testa no site ou no preview com Super Admin, planejador (Carlos Miguel) e técnico. Medições de custo pelo Console → Uso ("Últimos 60 minutos", passando o mouse no minuto) e Query Insights.

**Preferências do usuário:** respostas diretas e sem invenção (se não souber, dizer que não sabe); o usuário não programa — conversa em português, explicação simples; pedir instrução antes de decidir; mostrar o desenho e esperar a aprovação antes de programar; **vocabulário: "OS" / "Ordens de Serviço" = chamados do sistema principal (corretiva, layout, acompanhamento); "Preventiva" / "PMOC" = o sistema de preventivas — não misturar**; em toda etapa de junção (Hexon principal + Preventiva = Hexon 2.0) avisar no desenho o que vem de cada lado; sem janelas `alert/confirm` do navegador em telas novas (mensagens na própria tela); o banco será **zerado antes da produção** (ficam só os Super Admins).

---

## 0.1 Estado atual do app (17/10/2026) — ler logo depois do Guia rápido

> Fotografia do app inteiro para não perder o contexto. O **diário detalhado** de cada entrega (pedidos e respostas do usuário, desenhos, testes, commits) está em **`docs/historico/diario.md`** (seção 12); as fases mais antigas, em **`docs/historico/hexon2-fases.md`** (seção 11). **Atualizar esta seção a cada entrega.**

**O que é:** **Hexon 2.0** = a Preventiva (PMOC, feita por nós desde o início) + ideias tiradas do Hexon principal (hexon.app.br; código só lido, nunca alterado; não temos acesso ao servidor nem ao banco dele). Um site só (`hexonpreventiva.web.app`), usado no **computador** (gestão) e no **celular do técnico** pelo navegador; **instalável como app (PWA) desde 10/10/2026**. Separado por **gerência** (GMMR, GMEE, GMC e DOM) **e por empresa contratada** (etapa E1–E5). Ainda é teste/implantação: o banco será **zerado antes da produção** (ficam só os Super Admins) pela função "Zerar o banco" (A2).

**Quem é quem (correção do usuário, 15/10/2026):** só o **Super Admin vê todas as gerências**; cada planejador/escritório vê a sua. A **DOM** é a gerência que controla **os técnicos locais** (um por prédio, campo "Técnico local" + comarca, Lote 2). Engenheiro e gerente assinam as OS (`osSignAs` no perfil).

**Plano de 12 fases (aprovado 03/10/2026) — onde estamos (16/10/2026)**
| Fase | Situação |
|---|---|
| 1. Nova casca (menu, PMOC como página própria, Configurações, Início) | ✅ (Início refeito e concluído em 12/10/2026) |
| 2. Usuários, gerências e permissões para o sistema todo | ✅ |
| 3. Gestão de Ativos | ✅ — reformulada no A4 (14/10/2026): importação pela planilha, lista por prédio, cadastro novo |
| 4. Emitir OS (GLPI) + Modelos de OS (4b, 4c) | ✅ |
| 5. Execução dos chamados (5A execução e homem-hora, 5B assinaturas + link do cliente + contestação, 5C PDF mapeado e ficha XLSX) | ✅ — assinatura leve (4 tons) e pacotes de 25 no Lote 4 |
| 6. Ordens de Serviço › Chamados GLPI: lista, filtros, planilha, ZIP | ✅ |
| 7. Equipes e Programação Semanal (7A equipes, 7B semana, 7C blocos, 7D publicar PDF, 7E Preventivas nova + pernoite pelo planejador) | ✅ no ar (14/10/2026) |
| 8. Solicitações: 8A aba do técnico, 8B material (PM-AAAA-NNNN), 8C insumos (PI-AAAA-NNNN) | ✅ — insumos como **contrato da empresa** no Lote 3; **8D hora extra e pernoite: pendente** (item 5 da ordem combinada) |
| 9. Quadro de Avisos e Histórico GLPI | ✅ no ar (o Quadro recebe o PDF da Programação desde a 7D) |
| 10. Ponto e Contratos | 🔴 não começou |
| 11. Relatórios | 🔴 (item 4 da ordem combinada) |
| 12. Celular do técnico (quando o usuário mostrar como quer) | 🔴 |

**Feitos fora das fases:** Empresas contratadas (E1–E5), Identidade visual 2.0 (Fases 1–4), economia de leituras (`localSync.ts`), P39 (travamento no iPhone), 7 rodadas de ajustes da etapa 8, **PWA** (10/10), **Início** (12/10), **ajustes da verificação geral** A2 (zerar o banco), A4 (ativos), A5/A5-B (empresa inativa = "sem empresa"), A6 (Gerências em Configurações), A7 (materiais com saldo por almoxarifado) — 14/10; **simulação geral de carga** (A8, seção 7.1) e os **Lotes 1–6** que fecharam a lista **S1–S22** (15–16/10; último no `main` `3b07b13`).

**Ordem combinada (14/10/2026; continua valendo):** (1) o usuário verifica o sistema e passa os **ajustes** — **nova sequência a partir de 16/10/2026: ajustes que o usuário observou no uso real** (anotar na lista "U" abaixo, com data, tela e as palavras dele); pela ordem combinada, Claude **só anota** até o usuário dizer que acabou (confirmar com ele se vale o mesmo para esta sequência); (2) desenho + aprovação + programação dos ajustes; (3) aba **Oficina**; (4) aba **Relatórios**; (5) **8D — pernoite e hora extra nas Solicitações**.

**LISTA U — ajustes observados no uso real (aberta em 16/10/2026).** Uma linha por item; o pedido nas palavras do usuário, o levantamento, as decisões, os testes e os commits ficam no diário (`docs/historico/diario.md` › 12.2). **Item novo:** uma linha aqui (data, tela, resumo, situação) e o detalhe no diário. **Item aberto:** ler o detalhe no diário antes de desenhar.
- **U1** (16/10/2026) — Usuários › Novo Colaborador: usuário administrativo era gravado como técnico. **No `main` `a4eedcd`.**
- **U2** (16/10/2026) — Perfis de Acesso: perfil "Campo (técnico)" com permissões fixas; no celular, linha do tempo e OS assinada pelo cliente só para ver. **No `main` `684458b`.**
- **U3** (16/10/2026) — Perfil de Escritório que também executa OS (permissão "Executar OS atribuídas a mim", botão na ficha, regra dos materiais `matReadOk`). **No `main` `c59ad40`** (regra mudou; texto enviado ao usuário para publicar).
- **U4** (16/10/2026) — Layout: X nas janelas, Início no modelo do usuário, Programação com o "A programar" dentro do bloco, GLPI em destaque em todo o sistema. **No `main` `48fa99c`.**
- **U5** (16/10/2026) — Equipe da OS e da preventiva: o técnico atribuído é o responsável e só entra na equipe se tocar no próprio nome; concluir sem ninguém é bloqueado. **No `main` `4517bcf`.**
- **U6** (16/10/2026) — Emitir OS: Categoria pela gerência (pergunta "Lista por gerência" no modelo de OS; gerência sem lista não emite). **No `main` `4517bcf`.** Falta o usuário trocar a Categoria do modelo "MPRJ OS" para o tipo novo e cadastrar as listas.
- **U7** (16/10/2026) — Configurações no celular: abas em 2 colunas; linhas do editor de modelos empilhadas. **No `main` `4517bcf`.**
- **U8** (16/10/2026) — Menu "PMOC" passa a "Preventivas" (Consulta, Modelos e Protocolos). **No `main` `4517bcf`.**
- **U9** (16/10/2026) — Chamados GLPI: "Nenhum técnico (desatribuir)" no "Trocar" (apagado se o técnico já começou). **No `main` `4517bcf`.**
- **U10** (17/10/2026) — Celular › Solicitações › Corretivas: depois que o escritório decide o pedido de corretiva feito na preventiva ("Não atestado"), o técnico vê a resposta (corretiva aberta com o nº do GLPI, ou "não abrir" com a justificativa) e só tem "Ciente", que tira o pedido da lista. **Em desenho.**
- **U11** (17/10/2026) — Celular › Preventivas: ao abrir e ao iniciar, tela embaçada com "carregando" até terminar (não deixa preencher antes); sem internet, libera com aviso e grava quando a internet voltar (como hoje). **Em desenho.** Achado: ao iniciar, o que o técnico marca enquanto a equipe do dia carrega é apagado.
- **U12** (17/10/2026) — Celular › pedido de material e de insumos: na escolha da OS, a preventiva aparece com o nome dela e o patrimônio, sem o nome do equipamento. **Em desenho.**
- **U13** (17/10/2026) — Celular › Meu Perfil: tirar o quadro "Tempo de carregamento". **Em desenho.**
- **U14** (17/10/2026) — Celular › Minhas OS: melhorar o layout dos cartões da lista. **Em desenho.**
- **U15** (17/10/2026) — Celular › Solicitações: os botões Corretivas / Material / Insumos ocupam a largura toda (hoje sobra espaço ao lado de Insumos). **Em desenho.**

**Pendências abertas (16/10/2026)**
- **A1 — excluir preventivas em lote** (aberto; detalhes no diário, `docs/historico/diario.md`, lista A1–A8): `DeleteOrderModal` ainda exclui tudo de uma vez (`runBulk(() => Promise.all(...))`) — uma recusa interrompe e o disjuntor pode desarmar. Proposta: pacotes, sem parar no 1º erro, contar "já excluídas", tirar da cópia a OS que não existe mais. **Fantasmas:** a OS excluída pode voltar na cópia do aparelho porque o ponto das exclusões recebidas (`orderSync`, chave `hexon_orders_deletions_v1_*`) é gravado na hora e a lista das OS depois — **desde o Lote 5 a lista é gravada no máximo a cada 15 s** (e na hora ao ir para segundo plano, ao trocar de gerência e ao sair), então a janela ficou maior que o 1 s de antes; só pega se o navegador for fechado à força nesse intervalo. Correção recomendada (pequena, entra junto com o A1): gravar a lista da gerência **antes** de gravar o ponto das exclusões.
- **REPOSITÓRIO PÚBLICO — fazer junto com o usuário (anotado em 16/10/2026, a pedido dele: "Guarde essa observação que mais tarde vamos fazer isso juntos"):** o repositório `Daniel563-on/HexonPrev` está **público** (conferido pela API do GitHub em 16/10/2026: `"private": false`) — qualquer pessoa na internet vê o código, este documento e as regras do banco. Recomendação: torná-lo **privado** no GitHub (Settings › General › Danger Zone › Change visibility; só o dono faz). Antes de mudar, conferir junto: (1) se o Google AI Studio continua puxando o repositório depois de privado (pode pedir para reconectar o GitHub); (2) se o deploy pelo Cloud Shell (`git clone` da seção 0, item 8) passa a pedir login; (3) depois de privado, guardar os roteiros de teste numa pasta separada no repositório, sem as planilhas reais e fora da checagem de erros do site (seção 12.1).
- **A3 — fantasmas depois do "Zerar"** (aberto): melhoria proposta — conferir o `resetAt` no servidor antes de abrir as telas.
- **Produção (usuário, do Lote 2):** técnicos locais antigos cadastrados com gerência "Todas" → editar: marcar "Técnico local" e escolher a comarca.
- Pendências antigas da tabela da seção 5 ainda abertas: P3, P5, P6, P8, P10–P15, P26, P27, P34. Algumas permissões são só de tela (o banco não bloqueia) — ver P26.
- Oferecido e aguardando o usuário: bateria de testes completa aba por aba; piloto com uma gerência antes de abrir para todos.

**Menu do computador (`Sidebar.tsx`; cada item depende da permissão do perfil)**
- **Início** · **Emitir OS (GLPI)** · **Ordens de Serviço** (botões **Chamados GLPI** e **Preventivas**) · **Programação** (Semana, Equipes) · **Solicitações** (Corretiva, Material, Insumos, Hora extra e Pernoite em construção) · **Gestão de Ativos** · **Preventivas** (era "PMOC" até o U8; dentro: **Consulta** = Consulta de OS; **Modelos e Protocolos** = tipos/ciclo, modelos, disparo) · **Gestão de Materiais** · **Gestão de Insumos** (contrato da empresa) · **Almoxarifado** (fornecer insumos) · **Quadro de Avisos** · **Histórico GLPI** · **Usuários**, **QR-Codes**, **Endereços** (só Super Admin) · **Configurações** (Sistema, Auditoria, Empresas, Gerências, Almoxarifados — só Super Admin; Modelos de OS — quem tem a permissão).
- **Chamados GLPI (lista):** abre em **"Novas"**; cards Nova, Em andamento, Pendente, Aguardando assinatura do cliente / do engenheiro / do gerente, Contestada, Cancelada (números reaproveitados do Início na mesma sessão — S10) — lista **em tempo real**; "ATRASADA" só antes da assinatura do técnico; botão **"Precisam da minha assinatura"** (engenheiro/gerente; assina várias de uma vez); PDF/XLSX/ZIP conforme permissão.
- **Status mostrado x gravado:** no banco a OS fica "Aguardando assinaturas" + campo `nextSigner` (cliente/engenheiro/gerente); a tela, o PDF e a planilha mostram `osStatusLabel` ("Aguardando assinatura do cliente" etc.).

**Celular do técnico (`TechnicianMobileView.tsx`)** — barra de baixo: **Solicitações** · **Minhas OS** · **Escanear QR** (botão do meio) · **Preventivas** · **Meu Perfil**; sino do Quadro de Avisos no topo.
- **Solicitações (U10, U12, U15):** botões Corretivas / Material / Insumos dividindo a largura; **Corretivas** mostra o pedido "Aguardando decisão" e, decidido o último item, "Respondida" com a decisão de cada item e o botão **"Ciente"** (sai da lista); na escolha da OS dos pedidos de material/insumos a preventiva aparece como "Preventiva Mensal · Patrimônio 004512 · 10/26". Meu Perfil sem o "Tempo de carregamento" (U13).
- **Minhas OS:** lista em tempo real (`subscribeMyWorkOrders`, campo `techOpen`); botões **Em aberto**, **Pendentes**, **Contestadas**, **Assinadas pelo cliente** (tempo real por `cliSigned`; some sozinha quando o engenheiro assina). **U2:** dentro da OS, **Assinaturas** (nome, matrícula, data e por onde — sem a imagem) e **Linha do tempo** (fechada mostra o total e o último registro), só leitura, sem leitura a mais no banco; tocar numa **assinada pelo cliente** abre a OS inteira em **"Somente visualizar"** (`OsExecutionForm viewOnly`: só Voltar, PDF e abrir/fechar as seções); PDF e OK continuam no cartão. **U14:** cartão com faixa colorida pela situação (vermelha se atrasada), GLPI grande, "Nº da OS · intervenção", situação curta ("Aguardando cliente"), endereço com a comarca e rodapé com prazo e dia programado.
- **Perfil de Campo (U2):** permissões **fixas** — o técnico **não vê o link do cliente** (é do escritório) nem **valores em R$**; **PDF da OS** e **PDF da preventiva** sempre. O celular usa esses valores fixos (`App.tsx`), não a lista do perfil.
- **Formulário da OS no celular não tem "Salvar":** o técnico só tem **Pendente** (pausa a contagem de custo; só em "Em andamento"), **Acompanhamento** (anota na linha do tempo) — os dois abrem caixa no meio da tela com texto **obrigatório**, depois "Salvo" e volta à lista — e **Concluir** (só aí grava a execução). Perguntas, equipe e materiais seguem a **ordem do modelo**.
- **Equipe (U5, OS e preventiva):** o técnico atribuído é o **responsável** e **não entra sozinho** na equipe — aparece o atalho "Você (responsável)" e ele só entra se tocar (só se executou). Contam no homem-hora, hora extra e pernoite **só** as pessoas da equipe; concluir sem ninguém na equipe é bloqueado. Na preventiva, a equipe do dia continua entrando sozinha ao iniciar (sem o técnico). Modelo de OS **sem** o campo "Equipe": continua como antes (quem executa entra).
- **Assinatura do cliente:** um bloco só, **deitado** (paisagem; no iPhone o bloco gira): nome e estrelas obrigatórios, matrícula opcional, campos ao lado do quadro. O **link do cliente** (`?validar=código`) continua pedindo matrícula (regra `osValidations`).
- **Preventivas:** botões Pendentes e Execução, na ordem do dia agendado (S1); Iniciar ≠ ver; funciona sem internet (rascunho no aparelho). Técnico local recebe só as preventivas atribuídas a ele. **U11:** ao abrir (checklist ainda baixando) e ao iniciar (gravando o início + equipe do dia, no máximo 8 s) a tela fica embaçada com "Carregando/Iniciando a preventiva…" e nada responde; a equipe do dia é juntada ao que está na tela (antes apagava o que o técnico marcava nesse intervalo); sem internet aparece "Sem internet: pode fazer a preventiva normalmente…"; checklist que nunca foi baixado e sem internet não abre ("Tentar de novo"/"Voltar").
- **Avisos urgentes (S2, Lote 1):** abrem sozinhos só os publicados nos **últimos 3 dias** e ainda sem ciente; o técnico local recebe só avisos marcados **DOM** ou **todas as gerências**.

**Regras técnicas que não podem ser esquecidas**
1. **Arquivos no celular (P39):** nunca baixar por link no celular/tablet. Sempre `deliverFile`/`deliverBytes` (`src/lib/fileDelivery.ts`) → aviso **"PDF pronto"** (`PdfReadySheet.tsx`) → "Abrir / compartilhar". Motivo: no iPhone a página "sai" (`pagehide`) e o Firestore entra em modo restrito — **nenhuma operação do banco termina** até recarregar. Proteção extra no `main.tsx`: voltou depois de um `pagehide` → recarrega. Nome de arquivo sempre por `safeFileName` (o iPhone recusa "/").
2. **Disjuntor:** arquivo novo em `src/db` importa o Firestore de `./guard`; operação grande usa `runBulk`. Limites e detalhes na seção 8.
3. **Tempo real com economia:** escutas pequenas e por campo de controle esparso (`techOpen`, `cliSigned`, `signQueue`, `nextSigner`, `mrPend`, `srConf`, `srStore`, `techSr`, `techMr`, `unitOpen`…); nunca escutar uma coleção inteira. A lista do computador escuta só o que mudou depois de abrir a tela (`subscribeWorkOrderChanges`: `unit` + `updatedAt`).
4. **Contagens guardadas na sessão (S10, Lote 5):** `cachedOsCount` (`workOrderList.ts`) guarda cada contagem por gerência + empresas por até 5 min; Início e Ordens de Serviço reaproveitam. Ficam velhas quando a escuta de mudanças vê uma OS da gerência mudar (inclusive na 1ª resposta ao abrir a tela) — **tela nova que muda OS sem passar por essa escuta deve chamar `markOsCountsStale(gerência)`**. "Atualizar" conta na hora.
5. **Cópia do aparelho (S11, Lote 5):** preventivas (`orderSync.ts`, por gerência) e ativos (`assetSync.ts`): 1ª carga gravada na hora; mudanças gravadas no máximo a cada 15 s, ao ir para segundo plano e ao parar. Cadastros (materiais, insumos, efetivo, usuários, modelos, endereços) em `localSync.ts` com `syncAt` + `syncDeletions` — **toda gravação dessas coleções leva `syncAt: serverTimestamp()`**.
6. **Links do cliente (S18, Lote 5):** a fila do engenheiro confere os links pendentes no máximo a cada 15 min; "Atualizar" confere na hora.
7. **Escuta que ainda não respondeu (S14, Lote 6):** `LiveState` (`types.ts`: 'loading' | 'ok' | 'erro') e `onState` nas escutas de Solicitações/Almoxarifado — a tela mostra "(…)" até a 1ª resposta e "(—)" se falhar; **nunca mostrar 0 antes de saber**. Contagem que falha não devolve 0 (`dbCountSolicitations` avisa a falha).
8. **Assinaturas (Lote 4):** imagem leve em PNG de paleta 2 bits (`src/lib/signatureImage.ts`: `compactOsSignature` 720×270 nas OS, `compactInkSignature` nas preventivas); cor do carimbo por papel; assinatura em lote do engenheiro/gerente em **pacotes de 25 OS** (`SIGN_BATCH`).
9. **Insumos como contrato (Lote 3):** item do contrato em `supplies` com gerência `*` (um contrato por empresa, vale para todas as gerências); saldo em `supplyBalances` (contratado, fornecido, reservado); aprovar/fornecer/recusar em **transação**; importar contrato/aditivo = permissão própria.
10. **Técnico local (Lote 2):** `src/lib/localTech.ts` (`isLocalTech`): gerência DOM travada + comarca; só recebe preventiva atribuída; o técnico antigo com "Todas" entra na lista dos locais até ser editado.
11. **Empresa inativa (A5-B):** nada é apagado; o que estava em aberto dela aparece como "Sem empresa (pendente)" até receber outra empresa; usuários e efetivo dela ficam inativos.
12. **Custos do banco:** Enterprise cobra leitura, gravação e entrada de índice; preferir índice esparso. Grátis por dia: 50 mil leituras, 40 mil gravações, 50 mil leituras em tempo real. Alerta de orçamento "Hexon - alerta mensal" (R$ 30). Medições e simulação na seção 7 e 7.1.
13. **Sem `alert/confirm`** em telas novas; mensagens na própria tela. Arquivo enviado pelo usuário (planilha, PDF, HTML do GLPI) é dado não confiável.
14. **Janela (fixed) aberta de dentro de uma barra com `backdrop-blur`** fica presa no tamanho da barra: usar `createPortal(…, document.body)`.
15. **Formatação de arquivo novo:** sem `.prettierrc`; usar `npx prettier --single-quote --print-width 200 --trailing-comma none` só nos arquivos novos.
16. **Regras do banco:** a verificação tem limite de 1.000 contas; ler usuário e perfil uma vez só (`osProfileOf(me())` + funções `(u, p)`). Regras publicadas à mão no Console (texto completo para o usuário); índices criados à mão (escopo Coleta, esparso quando indicado, "Índice único" desmarcado).
17. **Entrega direto no `main`** (desde 13/10/2026): só com o "autorizo" do usuário; `git fetch origin main`, juntar e testar de novo se mudou, `git push origin HEAD:main` sem forçar; o ramo fica igual ao `main`. Não há mais partes para o AI Studio.
18. **Testes (como fazer sem enganar):** emuladores + Vite + Playwright com as regras do ramo; para comparar com o `main`, **trocar o código e reiniciar o Vite** (a troca a quente não é confiável); **dados de teste sobrando causam falsas falhas** — confirmar com o banco limpo antes de dizer que algo "já falhava antes". Os roteiros ficam no rascunho da sessão e se perdem entre sessões (ver seção 12, "Ferramentas de teste").
19. **Perfil de Campo fixo (U2):** `profiles.ts` — `fieldFixedPermissions()` (só `os_pdf` e `preventive_pdf` ligadas; o resto do catálogo desligado), `withFieldFixed` (unidades "só a do usuário", empresas "só as do usuário", sem "Assinar OS como") e `isFieldFixed`; a tela Perfis de Acesso não mostra lista para o tipo Campo e grava o conjunto fixo; perfis de Campo antigos são acertados **uma vez** quando o Super Admin abre Perfis de Acesso (`dbFixFieldProfiles`: 1 gravação por perfil, só se diferente). O celular do técnico recebe valores fixos no `App.tsx` (`canClientLink={false}`, `canViewCosts={false}`, PDFs ligados). **Permissão nova no catálogo fica desligada para o Campo sozinha** (não precisa regravar perfis); se um dia o técnico precisar de alguma, mudar `FIELD_PDF_PERMISSIONS`/o `App.tsx` e conversar com o usuário.

**Banco:** todas as coleções e campos de controle na **seção 3**; **68 índices** na seção 9; proteção (disjuntor) na seção 8; mapa de arquivos na seção 10.

---

## 1. Resumo do que o sistema deve fazer

**Organização**
- Unidades: **DOM** (Diretoria de Operações de Manutenção) acima de **GMMR**, **GMEE** e **GMC**.
- A DOM também tem as próprias atividades, planejadores e rondas (vistorias por endereço).
- Todo usuário pertence a uma unidade e **só vê dados da própria unidade**. O Super Administrador vê tudo.

**Perfis e permissões**
- Perfis iniciais: **Super Administrador**, **Planejador** e **Técnico**.
- O Super Administrador cria **novos perfis** (Engenheiro, Gerente, Fiscal...) e escolhe o que cada um pode fazer: visualizar, criar, editar, executar, aprovar, excluir, relatórios, exportar, importar, e qual unidade enxerga.
- Só o Super Administrador cria ou altera perfis.

**Bases administradas pelo Super Administrador**
- **Ativos**: importação e atualização (já existe).
- **Materiais**: importação e atualização (novo).
- **Efetivo**: todas as pessoas que podem participar de uma preventiva, com cargo e dados de hora. **Estar no efetivo não dá acesso ao sistema.**

**Modelos, periodicidade e disparo**
- Modelo: nome, descrição, checklist, ativo ou local, materiais previstos e periodicidade.
- Periodicidades: **Diária** (uso raro), **Semanal**, **Mensal**, **Trimestral** e **Semestral**.
- O disparo tem data de início, data de fim e unidade de destino. O sistema valida se as datas combinam com a periodicidade.
- **Duplicidade proibida:** mesma atividade + mesmo ativo ou local + mesmo período = bloqueio, qualquer que seja o status da existente.

**Planejamento (Planejador)**
- Recebe só os lotes da própria unidade.
- Distribui no calendário e escolhe o técnico.
- Não altera a periodicidade.
- Informa se a atividade tem **pernoite**.

**Execução (Técnico)**
- Vê só as preventivas **dele**, da **unidade dele**, planejadas ou em execução.
- **Visualizar não é iniciar.** Só o botão "Iniciar Preventiva" começa a contar o tempo.
- Na execução ele:
  - preenche o checklist, sem alterar a estrutura;
  - informa os **materiais usados**;
  - informa os **profissionais participantes**, a partir da equipe habitual ou buscando no efetivo;
  - assina e conclui.
- **Tempo = conclusão − início**, registrado pelo sistema, nunca digitado.
- **Homem-hora** calculado pelo sistema (tempo × participantes, considerando o cargo).
- Depois de assinada, a OS fica **bloqueada** e **sai da lista** do técnico.
- Prazo vencido sem conclusão vira **Não Executada**, automaticamente.

**Solicitações de corretiva**
- Geradas na execução. O planejador acompanha num painel e decide **"Abrir corretiva"** (no outro sistema) ou **"Não abrir"**.

**Histórico e relatórios**
- Histórico por OS: criação, planejamento, visualização, início, finalização, assinatura, conclusão e alterações administrativas.
- Relatórios para o Super Administrador: planejadas, executadas, não executadas, por unidade, profissional e período, tempo médio e total, homem-hora, materiais, pernoites e produtividade, com exportação para Excel e PDF.

---

## 2. Situação atual da Preventiva (03/10/2026 — para o app todo, ver seção 0.1)

Legenda: ✅ feito · 🟡 parcial · 🔴 não existe

| Item | Situação | Observação |
|---|---|---|
| Unidades DOM, GMMR, GMEE e GMC | ✅ | Unidade exata gravada em cada OS (`unit`); botão "Corrigir unidade das OS". |
| Visão por unidade (telas e banco) | ✅ | Telas e regras do banco filtram pelas unidades do perfil. |
| Perfis criados pelo Super Admin + permissões | ✅ | `profiles`; "acesso total" por marca interna (`kind: total`), não pelo nome. |
| Usuários e senhas | ✅ | Redefinir senha pela Cloud Function `resetUserPassword` (só Super Admin ativo). |
| Ativos | ✅ | Cópia local sincronizada (`assetSync`), importação, QR público. |
| Efetivo, cargos e valor da hora | ✅ | Etapa 2. |
| Materiais | ✅ | Etapa 3 (por gerência, sem estoque). |
| Tipos de ativo, ciclo, modelos, disparo | ✅ | Etapa 4 (4a/4b/4c). |
| Planejamento (lotes, pernoite, calendário) | ✅ | Etapa 5. **Fase 7E-1 (14/10/2026):** o calendário do PMOC e o prazo de planejamento saíram; programar = Programação (semana) ou Ordens de Serviço › Preventivas (pela lista, cria o mesmo bloco). |
| Execução (iniciar ≠ ver, offline, assinatura) | ✅ | Etapa 6 (6.1 e 6.2). |
| Homem-hora e custo da OS | ✅ | Etapa 7. |
| Controle do sistema (forçar atualização, manutenção) | ✅ | Decisão 35. |
| Solicitações de corretiva (GLPI / justificativa) | ✅ | Etapa 8. |
| Relatórios | 🔴 | **Etapa 9 adiada** a pedido do usuário. |
| Prazos e horários (00:00 / fechamento 00:10) | ✅ | Etapa 10. |
| Otimização de leituras e gravações | ✅ | Decisões 38, 39, 40. |
| Proteção do banco | ✅ (1, 2, 3) | Etapa 4 (App Check) **não será feita** por ora; Etapa 5 (corte automático) e Monitoramento adiados. Ver seção 8. |
| Histórico do ativo paginado (12 por página) | ✅ | Dentro do sistema e no QR público. |
| Exportação Excel/PDF | 🟡 | Existe em algumas telas; completar na Etapa 9. |
| Botão "zerar sistema" | 🔴 | Discutido e adiado. |

---

## 3. Como os dados ficam gravados (coleções do banco)

| Coleção | Para que serve | Quem lê / grava (regras) |
|---|---|---|
| `serviceOrders` | OS (formato enxuto: modelo + versão + `answers`; campos de controle, decisão 39) | Equipe das unidades do perfil; técnico pelas próprias (`techOpen`/`techSol`); concluída imutável salvo exceções |
| `templateVersions` | Versão congelada de cada modelo usada no disparo | Equipe lê; criar só; nunca alterar |
| `orderStarts` | OS em execução agora (registro pequeno) | Técnico cria a própria; apaga ao concluir/desfazer |
| `orderSignatures` | Assinatura (PNG em texto) fora da OS | Equipe; **máx. 150 KB** |
| `orderDeletions` | Avisa os aparelhos para tirar OS excluída da cópia local | Super Admin grava |
| `dispatchIndex` | Números das OS já disparadas por período (evita duplicar) | Admin / permissão "Disparar OS" |
| `histories` | Histórico do ativo/endereço (QR público) | `get` público; listar: equipe ou **no máx. 13 por busca** |
| `assets`, `assetDeletions`, `assetTypes`, `cycleSettings` | Ativos, exclusões, tipos/periodicidades, início do ciclo | `assets`: `get` público; listar só equipe (ou busca de 1 resultado) |
| `addresses` | Endereços (rondas da DOM) | `get` público; listar só equipe |
| `templates`, `qrTemplates` | Modelos de checklist e de etiqueta | Equipe |
| `planningLots`, `planningDeadlines`, `costSettings` | Lotes do planejamento, prazo de planejamento, valor do pernoite | Ver regras |
| `usualTeams`, `workforce`, `jobRoles`, `materials` | Equipe habitual, efetivo, cargos/valor-hora, materiais | Ver regras |
| `supplies` (gerência `*`) + `supplyBalances` | Contrato de insumos da empresa (Lote 3) e o saldo de cada item (contratado, fornecido, reservado) | Item: técnico da empresa e equipe com permissão de insumos; saldo: só a equipe; importa quem tem "Importar contrato e aditivos de insumos" |
| `users`, `authIndex`, `profiles`, `config`, `managements`, `units` | Cadastro, vínculo do login, perfis (tipo Campo com permissões fixas — U2), permissões, gerências | Ver regras |
| `monthlySummaries` | Resumos do mês (gravados pela nuvem) | Equipe lê |
| `accessLogs` | Registro de acesso (inclui login com falha, feito antes de entrar) | Qualquer login grava, **só os campos do registro e textos curtos**; Super Admin lê |
| `auditLogs` | Auditoria (inclui "Proteção do sistema" do disjuntor) | Equipe grava; Super Admin lê |
| `appControl/status` | Forçar atualização e modo manutenção | Leitura pública; Super Admin grava |
| `appControl/branding` | Logo do sistema (256 px) e ícone da aba (64 px), em texto da imagem | Leitura pública; Super Admin grava |
| **Hexon 2.0 (chamados e demais módulos)** | | |
| `workOrders` | Chamados GLPI (corretiva, layout, acompanhamento); número `OS-AAAA` + 6 dígitos, uma sequência para todas as gerências | Equipe da gerência + empresa; técnico pelos seus (`techOpen`); ver regras |
| `workOrderSignatures` | Imagem de cada assinatura da OS (`{OS}_{papel}`; PNG leve de 4 tons, Lote 4); na OS ficam só os dados do carimbo | Ver regras |
| `osTemplates` | Modelos de OS (perguntas, campos, assinaturas exigidas, empresa). U6: pergunta do tipo `unitlist` ("Lista por gerência", ex.: Categoria) guarda `optionsByUnit` = { gerência: [opções] }; a OS guarda a cópia do modelo e a resposta (texto) | Quem tem "Criar e editar modelos de OS" |
| `osValidations` | Link do cliente (`?validar=código`): leitura sem login só com o código, uma resposta só | Ver regras |
| `osPdfLayouts`, `osPdfFiles` | PDF mapeado da OS por modelo: caixas (leve) e o PDF em base64 (até ~1 MB) | Ver regras |
| `counters` | Contadores do número por ano (`workOrders_AAAA`, `materialRequests_AAAA`, `supplyRequests_AAAA`) | Ver regras |
| `companies` | Empresas contratadas (E1); inativa some das escolhas e o que é dela fica "sem empresa" (A5-B) | Equipe lê; Super Admin grava |
| `overtimeRules` | Regras de hora extra por empresa + cargo (tarifas no `jobRoles`) | Super Admin |
| `materialRequests` | Pedidos de material do MP (PM-AAAA-NNNN): Pendente → Aprovado (RM) → Atendido / Reprovado | Ver regras |
| `supplyRequests`, `orderSupplies` | Pedidos de insumos (PI-AAAA-NNNN): Pendente → Confirmado (aprovado, reserva no saldo) → Fornecido → Recebido / Reprovado; os recebidos entram na OS (`orderSupplies/{OS}`) | Ver regras |
| `syncDeletions` | Exclusões e trocas de gerência das listas guardadas no aparelho (`localSync.ts`) | Ver regras |
| `usualTeams` | Equipe habitual de cada responsável = equipes da Programação (7A) | Quem tem "Programar" grava |
| `weekPlans`, `absences` | Programação da semana (1 por gerência + empresa + semana: dias marcados, equipe da semana, publicações) e ausências (férias/atestado/licença/outro) | Quem tem "Programar" grava |
| `notices` (+ subcoleção `reads/{matrícula}`), `noticeImages`, `noticeFiles` | Quadro de Avisos: aviso, quem deu ciente, foto (lida só quando aparece) e PDF (lido só ao abrir; também o PDF da Programação, 7D) | "Publicar avisos" grava; ver regras |
| `glpiPanel`, `glpiPanelChunks` | Histórico GLPI: qual painel vale (`current`) e o HTML compactado em pedaços de até 700 KB | Ver regras |

**Campos de controle (só existem enquanto a OS precisa deles; usados pelos índices esparsos):**
- **Preventivas (`serviceOrders`, `src/db/orderControl.ts`):** `unitOpen` (gerência, enquanto aberta → cópia do planejador), `openEnd` (fim do prazo, enquanto aberta → rotina das 00:00), `plannedEnd` (último dia programado, enquanto "Planejada"), `techOpen` (matrícula, enquanto aberta → lista do técnico), `techSol` (matrícula, com solicitação pendente **ou respondida e ainda sem o "Ciente" do técnico** — U10), `solAt` (última alteração, se tem solicitação), `addrEnd` (fim do prazo, se é vistoria de endereço), `closedMonth` (mês em que fechou), `syncAt` (horário do servidor → cópia do aparelho). **U10:** `solNotice` (campo comum, não calculado) = matrícula do técnico, gravado quando o escritório decide o **último** item do pedido de corretiva e apagado no "Ciente" (junto com `techSol`); pedidos decididos antes do U10 não têm o campo e não voltam para o técnico.
- **Chamados (`workOrders`):** `techOpen` (matrícula, enquanto aberta → "Minhas OS"), `nextSigner` (de quem é a vez: cliente/engenheiro/gerente), `signQueue` (`GERÊNCIA|papel` enquanto espera cliente pelo link, engenheiro ou gerente → fila "Precisam da minha assinatura"), `cliSigned` (matrícula do técnico depois que o cliente assinou, até ele tocar em "OK"), `updatedAt` (escuta de mudanças da lista).
- **Pedidos:** `mrPend` (gerência, pedido de material pendente), `techMr` (matrícula, enquanto o pedido aparece para o técnico); `srConf` (gerência, insumo aguardando aprovação), `srStore` (gerência, aguardando o almoxarifado), `techSr` (matrícula, enquanto aparece para o técnico).

O arquivo `firestore.rules` do ramo `claude/...` é a cópia mais nova das regras (a publicada no Console deve ser igual a ele).

---

## 4. Plano em etapas (cada uma só começa com aprovação)

A ordem segue as dependências: primeiro quem é quem, depois as bases, depois o fluxo da OS, por fim os números.

Situação (03/10/2026): **1 a 8 e 10 feitas**; **9 (Relatórios) adiada**.

| # | Etapa | Conteúdo principal |
|---|---|---|
| 1 | Unidades e perfis | 4 unidades com código fixo; perfis criados pelo Super Admin; permissões + unidade visível; renomear Administrador→Planejador e Profissional→Técnico; regras do banco por unidade. |
| 2 | Efetivo | Base de pessoas (com e sem login), importação por planilha, cargo, vínculo usuário↔pessoa e valor da hora com histórico (sem hora extra). |
| 3 | Materiais | Base de materiais com importação. |
| 4 | Modelos e disparo | Periodicidades novas, materiais previstos no modelo, validação datas × periodicidade, duplicidade revisada e disparo por unidade. |
| 5 | Planejamento | Lote com pessoas e pernoites (custo dividido pelas OS; valor do pernoite congelado na criação da OS); técnico gravado pelo código, não pelo nome. |
| 6 | Execução | Visualizar ≠ Iniciar; início e conclusão com hora do servidor; equipe habitual; participantes; materiais usados; bloqueio após assinatura; linha do tempo da OS; concluída sai da lista. |
| 7 | Homem-hora | Cálculo automático e congelado na OS no momento da conclusão. |
| 8 | Solicitações | "Abrir corretiva" / "Não abrir", com registro de quem decidiu e quando. |
| 9 | Relatórios | Indicadores de tempo, homem-hora, materiais, pernoite e produtividade, com exportação para Excel e PDF. |
| 10 | Prazos e horários | Rotina à 00:00, fechamento à 00:30 do dia 1º e trava de conclusão fora do prazo. Exclusão só de OS "Novo" pelo Super Admin. |

---

## 5. Decisões tomadas (desde 27/09/2026)

1. **Periodicidades:** Diária, Semanal, Quinzenal, Mensal, Trimestral, Semestral e Anual. Quem define é o Super Administrador.
2. **Nomes dos perfis editáveis**, inclusive o do Super Administrador. O sistema não pode depender do nome: o perfil "acesso total" é identificado por uma marca interna, não pelo texto.
3. **Visão de várias unidades:** alguns perfis vão precisar. A configuração do perfil define quais unidades ele vê.
4. **Homem-hora em horas e em R$**, para **todo o efetivo** (técnico, mecânico, meio oficial...).
5. **Participação:** quem foi incluído na OS participou dela **inteira** (tempo total × cada participante).
6. **Materiais têm custo em R$.** O formato da planilha será visto quando você importar a primeira.
7. **Pernoite por lote:** o planejador informa **quantas pessoas** e **quantos pernoites** para o lote de preventivas. O **valor do pernoite** é definido e atualizado pelo Super Administrador. Um reajuste vale só para as preventivas ainda **abertas**; as concluídas mantêm o valor da época.
8. **Não existe pausar/retomar.** Um problema durante a execução vira corretiva, com observação.
9. **Concluídas somem do app do técnico.** Os demais perfis consultam o histórico **sob demanda**, sem carregar tudo.
10. **Corretivas vindas do checklist:** continuam como estão hoje, em Solicitações.
11. **Replanejamento:** o planejador altera a data só enquanto a OS está aberta (não iniciada). Depois de iniciada ou executada, não pode mais. As atrasadas continuam podendo ser reagendadas, como hoje.
12. **OS concluída é imutável:** ninguém altera, nem o Super Administrador. A responsabilidade é do técnico.

13. **Pernoite dividido por OS:** o custo do lote (pessoas × pernoites × valor) é dividido igualmente entre as OS do lote, e cada OS fica com o seu valor.
14. **Valor do pernoite congelado na criação da OS:** cada OS guarda o valor de pernoite vigente **no momento em que o Super Administrador gerou o lote**. Um reajuste vale só para os lotes gerados depois.
15. **Sem hora extra em preventiva:** não existe adicional de sábado, domingo ou feriado. O custo é **horas trabalhadas × valor da hora**. (A tela de custo homem-hora que ainda não foi aplicada perde os campos de sábado e domingo/feriado.)
16. **Exclusão:** só o **Super Administrador** exclui, e só OS com status **Novo**. Iniciadas, concluídas ou não executadas nunca podem ser excluídas.

17. **QR público (opção A):** a página pública mostra só o **histórico de preventivas concluídas** (área própria e pública, com os dados do técnico protegidos). As OS ficam protegidas por unidade no banco.
18. **Etapa 1 em 3 partes:** 1a cadastro de perfis → 1b telas usam as permissões → 1c regras do banco.
19. **Unidades dentro do sistema:** cada perfil vê só os ativos, imóveis e OS das suas unidades (Painel, OS, Calendário, Consulta, Ativos, QR Codes). O QR público continua abrindo qualquer ativo. O técnico continua vendo só as OS atribuídas a ele.
20. **Etapa 1c em 2 partes:** 1c-1 grava a unidade exata (GMMR, GMEE, GMC, DOM — nome = sigla, descrição = nome completo) em cada OS, botão "Corrigir unidade das OS" (Super Admin, em Gerências), histórico da vistoria ligado ao QR do imóvel, página pública só com histórico. 1c-2 buscas por unidade + regras novas do banco.
21. **Consulta de OS:** mostra todas as OS (abertas e fechadas), filtros independentes e opcionais (mês do período, gerência pela unidade, status, CRAAI, comarca, técnico), até 500 por busca. A aba Realização mostra só as abertas e as fechadas do mês atual (sem barra de mês). Solicitações também passam a respeitar as unidades do perfil.
22. **Regras do banco (1c-2):** OS só da equipe e só das unidades do perfil (campo unit); QR público não lê OS; OS Concluída imutável (exceto andamento da solicitação de corretiva e correção de cadastro pelo Super Admin); excluir só Super Admin e só OS Novo. A gerência de cada usuário precisa ser exatamente o nome da unidade (GMMR, GMEE, GMC, DOM) ou "Todas".
23. **Efetivo (Etapa 2):** aba Efetivo em Controle de Usuários (Super Admin). Pessoas = usuários com login + importados por planilha (Matrícula, Nome, Cargo, Gerência; sem login). Importação: matrícula de usuário com login é ignorada e avisada; repetida entra só a primeira; quem some da planilha fica Inativo; mudanças de nome/cargo/gerência são atualizadas. Usuário criado com matrícula de importado substitui o importado (com aviso). Valor da hora POR CARGO (aba Cargos; "Atualizar cargos" cria os cargos existentes com R$ 0,00), com histórico e vigência. Resumo por cargo com quantos têm login. Na tela do próprio usuário aparece o cargo; o perfil de uso só o Super Admin vê.
24. **Materiais (Etapa 3):** cada gerência tem a sua lista (código, descrição, unidade de medida, valor com histórico). Sem controle de estoque: a OS só registra o que foi usado. Material que sai da planilha fica na lista (histórico) com valor R$ 0,00; material com R$ 0,00 não pode ser usado pelo técnico. Técnico só vê/usa materiais da sua gerência e só os cadastrados (não digita material). Importação por gerência, com escolha das colunas (planilha ainda não definida). Aba Materiais controlada pelas permissões "Visualizar Materiais" e "Cadastrar e Importar Materiais" (padrão: só Super Admin; o planejador não vê).
25. **Etapa 4 (definida):** modelo = gerência + tipo de ativo + periodicidade + checklist (sem materiais previstos). Tipos de ativo por gerência com periodicidades (Mensal, Trimestral, Semestral, Anual); o ativo herda do tipo. Ciclo por gerência a partir do "Início do ciclo oficial" (Super Admin; antes disso tudo é teste; o banco será zerado antes, mantendo só os Super Admins): mês 1, 2, 3...; em cada mês vale só a de maior peso (Mensal < Trimestral [3,6,9,12] < Semestral [6,12] < Anual [12]); 1 OS por ativo por mês. Diária/Semanal/Quinzenal só para vistorias (Quinzenal = 1–15 e 16–fim); vistoria semanal para a maioria dos endereços e modelos diários próprios (checklist próprio) para 3 endereços, que ficam só com a diária. Disparo por gerência + mês(es), permissão (inicialmente Super Admin). Duplicidade em 5 camadas: número fixo com o modelo, registro de disparo, 1 OS por ativo por mês, conferência antes de gravar, banco só cria. Materiais: o técnico informa no fim do checklist o que usou e a quantidade, sem ver valor. Divisão: 4a tipos e ciclo; 4b modelos; 4c disparo.
26. **Modelos (4b):** formato novo por gerência. Preventiva = tipo de ativo + periodicidade (um só por gerência+tipo+periodicidade; só periodicidades marcadas no tipo). Vistoria (DOM) = periodicidade (Diária/Semanal/Quinzenal) + endereços: "todos os demais endereços" (um por gerência) ou "endereços escolhidos" (cada endereço em um único modelo). Tela com cobertura tipo × periodicidade, lista, editor de checklist (tipo de resposta, criticidade, observação obrigatória, observação no N.A., item de solicitação de corretiva, ativo), versões (OS já criadas não mudam), Duplicar e Mapear PDF. Excluir: permissão "Excluir Modelos" (padrão só Super Admin). Modelos antigos listados em "Formato antigo — recriar e apagar".
27. **Disparo (4c):** gerência + meses (mês atual ou futuros, máx. 12) → conferência (nada gravado: tabela por mês × periodicidade, barradas por já existir, o que não gera OS e por quê) → gerar. Preventiva: 1 OS por ativo por mês (número = ativo + MES + mês), período = mês inteiro. Vistoria (DOM): Diária só dias úteis, Semanal segunda a sexta, Quinzenal 1–15 e 16–fim (ajustadas a dias úteis); número = endereço + período. Nunca fim de semana (no calendário da Etapa 5 também não se agenda sábado/domingo). Antes do início do ciclo é teste (1º mês escolhido = mês 1; OS marcadas como teste). Permissão "Disparar OS" (padrão só Super Admin). Banco: update de OS não pode mudar a data de criação (disparo nunca sobrescreve).
28. **Planejamento (Etapa 5):** técnico gravado pela matrícula (assignedTechnicianMatricula; o técnico busca por nome e matrícula). Lote = cada agendamento em bloco (mesmo período e técnico), coleção planningLots, com pernoite (pessoas × noites). Valor do pernoite único, com histórico e vigência (Super Admin, em Efetivo > Cargos, valor da hora e pernoite); cada lote usa o valor vigente na data do agendamento; custo = valor × pessoas × noites ÷ OS que continuam no lote (OS que sai do lote fica sem pernoite e o custo é redividido; OS não executada continua com a sua parte). A OS não guarda R$; valores só para a permissão "Visualizar Valores (R$)" (padrão só Super Admin). Calendário só com dias úteis, sem agendar sábado/domingo; novo layout (5b) com resumo por status, calendário + painel do período, programar lote, programadas por técnico e visão "Por técnico". 5b feito: escolha da gerência (uma por vez; lote é sempre de uma gerência); chips de status filtram calendário e "Programadas"; seleção por clique, arrastar ou Shift+clique; "A programar" = OS "Novo" cujo prazo cobre todo o período, agrupadas por comarca; dia passado só consulta; prazo de planejamento expirado bloqueia só a gerência escolhida (perfis limitados a unidades); OS mexida sozinha (técnico, remarcar, voltar p/ Novo) ou atrasada revertida em massa sai do lote.

29. **Custo do banco (edição Enterprise, medido em 28/09/2026):** cobra por unidades. Gravação = 1 unidade por KB do documento + 1 unidade por entrada de índice; leitura = 1 unidade a cada 4 KB. Cota grátis por dia: 40 mil unidades de gravação e 50 mil de leitura. Índices de `serviceOrders` reduzidos de 18 para 9; esparsos (só OS que têm o campo): `closedMonth`, `assignedTechnician`, `assignedTechnician + closedMonth`. OS sem técnico não grava o campo `assignedTechnician`. Medido: ~8 unidades por OS no disparo (modelo de 3 itens).
30. **Escala de referência:** ~200 pessoas (~175 técnicos), ~8.000 ativos e ~140 endereços da DOM (3 diários, o resto semanal): ~8.700 OS por mês. Meta: passar da cota grátis só eventualmente, nos picos (disparo); nunca todo dia.
31. **Plano de leveza (ordem aprovada):**
    - **1.1 Leitura incremental do planejador:** cópia local das OS no aparelho (IndexedDB) e leitura só do que mudou (campo `syncAt` + índice gerência + `syncAt`); exclusões registradas à parte. Custo aceito: +1 gravação por alteração de OS. Feito em 2 partes: 1.1a (carimbo em toda gravação de OS, `orderDeletions`, regras, rotina de prazos na nuvem às 00:00) e 1.1b (cópia local por gerência: abertas + fechadas do mês atual e do anterior; meses mais antigos sob demanda; quem vê todas as gerências escolhe uma por vez no topo da tela, no Painel e em Preventivas).
    - **1.3 Assinatura compacta** (resolução menor, preto e branco).
    - **1.2 OS só com as respostas:** versões do modelo congeladas em `templateVersions`; a OS guarda modelo + versão + respostas; OS antigas continuam funcionando. Feito em uma entrega: o disparo congela a versão de cada modelo usado (1 gravação por versão) e grava a OS com `checklistFormat: 2` e `answers` (chave = posição do item; campos curtos c/t/o/s/ca/cs); as telas montam o checklist na memória (tradutor único); versão ainda não baixada = "Carregando checklist..." e a OS não pode ser concluída até carregar; ao gravar, só as respostas vão para o banco.
    - **Etapa 6 (execução):** visualizar ≠ iniciar; início gravado fora da OS (registro pequeno, hora do aparelho e do servidor, marca quando a diferença passa de 30 min); checklist, materiais e participantes só no aparelho até a assinatura (se não concluir, refaz); conclusão em 1 gravação; sem fotos; iniciar pelo card, pelo QR ou pelo painel; visualização não é registrada.
    - **Teste de volume** (~8.000 OS em modo teste), medir, ajustar e zerar o banco antes de produção.
    - **Uso:** disparar o mês seguinte por gerência em dias diferentes na última semana do mês.

32. **Leituras e gravações: revisão depois do sistema completo (combinado em 29/09/2026).** O que muda formato de dados já foi feito (1.1 cópia local, 1.2 OS enxuta) e a Etapa 6 já nasce leve. Os ajustes abaixo ficam para uma rodada final, antes da produção:

33. **Execução (Etapa 6), em 2 partes:** 6.1 = iniciar + executar + concluir; 6.2 = materiais + participantes + equipe habitual + linha do tempo. Respostas de 29/09/2026: o técnico **pode desfazer** o início (o preenchido no aparelho é descartado); **só 1 OS em execução por vez** por técnico; equipe habitual editada pelo **técnico e pelo planejador**, a qualquer momento; participantes **só da mesma gerência**; materiais com **casas decimais**, **uma linha por material** (repetido soma na mesma linha).
    - **6.1 feito:** abrir = só ver; "Iniciar Preventiva" (só o técnico da OS, só OS "Planejada" e a partir do dia programado) grava `orderStarts/{OS}` (matrícula, nome, gerência, hora do aparelho e do servidor) sem regravar a OS; planejador vê "Em Execução" em tempo real (e não consegue remarcar/trocar técnico/voltar p/ Novo); checklist e notas ficam só no aparelho (rascunho) até "Assinar e concluir", que grava a OS uma vez (respostas, notas, assinatura, `startedAt`/`startedAtServer`/`startedBy`/`completedAt`/`completedAtServer`) e apaga o registro de início; "Desfazer início" apaga o registro e o rascunho; concluídas saem do app do técnico (aba "Concluídas" removida); avisos do navegador trocados por mensagens na tela.
    - **6.2 feito:** materiais usados (só da gerência e com valor > R$ 0; técnico não vê valor; busca por código/descrição; uma linha por material; quantidade com vírgula) e participantes (pessoas ativas da mesma gerência: usuários + efetivo; quem executa entra sempre) no rascunho, gravados na conclusão (`materialsUsed`, `participants`); equipe habitual em `usualTeams/{matrícula}` (técnico edita no Perfil do celular; planejador no botão "Equipe" da visão "Por técnico"), preenche os participantes ao iniciar; linha do tempo dentro da OS (`timeline`): "Disparada" vem da data de criação (não é gravada), "Programada" (lote), "Técnico trocado", "Remarcada", "Voltou para Novo", "Iniciada" e "Concluída" (na conclusão), exibida no detalhe da OS.
    - **Regras de início confirmadas (29/09/2026):** só OS "Planejada" e a partir do dia programado (Atrasada precisa ser remarcada); só o técnico da OS inicia (planejador e Super Admin só veem); OS antiga "Em Execução" pode ser iniciada; "1 por vez" garantido pelo app.

34. **Homem-hora (Etapa 7), respostas de 29/09/2026:**
    - **Sem internet:** o técnico chega com as OS carregadas; iniciar, preencher, desfazer, assinar e concluir funcionam sem sinal (ficam na fila do aparelho e sobem sozinhos quando a internet volta; a tela avisa "salvo no celular"). Uma vez por dia, com internet, o app deixa no aparelho os materiais e as pessoas da gerência e a equipe habitual. O app precisa ter sido aberto com internet (abrir o sistema do zero sem internet = "app instalável", fica para depois).
    - **Tempo (opção 1):** minutos pela hora do celular (início → conclusão), gravados na conclusão (`durationMin`); as horas do servidor ficam guardadas. Com internet no início e na conclusão, se a conta do servidor diferir da do celular em mais de 30 min, a OS mostra **"horário divergente"**; feito sem internet, mostra **"horário do celular (sem internet)"** (`execOffline`).
    - **Homem-hora** em minutos (`manMinutes`) = tempo × pessoas (quem executa + participantes), gravado na conclusão, na mesma gravação.
    - **Custo em R$** não é gravado: na OS concluída, quem tem "Visualizar Valores (R$)" vê mão de obra (horas × valor do cargo vigente na data da conclusão, por pessoa), materiais (qtd × valor vigente na data), parte do pernoite do lote e o total. Cargo/material sem valor aparece em vermelho e fica fora do total.
    - **Hora da assinatura** gravada na hora local do aparelho (antes ia em UTC, 3h a mais). Pendente: "atualizado em" dos modelos de checklist ainda em UTC.
    - **Tempo suspeito:** mais de 10h.

35. **Controle do sistema (30/09/2026), aba "Sistema" em Controle de Usuários (só Super Admin):**
    - **Forçar atualização:** todos os aparelhos abertos veem "Nova versão do sistema" com "Atualizar agora" e recarregam sozinhos em 1 minuto; antes de recarregar, enviam o que foi salvo sem internet. Além do botão, o app confere sozinho a cada 30 min e ao voltar para a aba, lendo o arquivo `version.json` do site (gerado no build; não usa o banco, só a transferência da hospedagem, ~1 KB por conferência).
    - **Modo manutenção:** ligado, todos menos o Super Admin veem "Aplicativo em manutenção" (com mensagem opcional), são desconectados depois de enviar a fila do aparelho e não conseguem entrar; o Super Admin entra pelo link da tela. Bloqueio só no aplicativo (o banco não bloqueia).
    - Registro único `appControl/status` (leitura pública, gravação só Super Admin): 1 leitura ao abrir o app e 1 por aparelho a cada botão apertado. O técnico vê um alerta no app enquanto a OS passa de 10h em execução; a OS concluída fica marcada. Totais e relatórios ficam para a Etapa 9.

36. **Solicitações de corretiva (Etapa 8), respostas de 30/09/2026:**
    - No modelo, a pergunta Conforme / Não conforme / N.A. tem a opção **"Não conforme gera solicitação de corretiva"** (substitui "Item de solicitação de corretiva"; a pergunta especial Sim/Não deixou de existir). "Observação obrigatória" e "Observação no N.A." saíram do modelo: o Não conforme já exige observação e o N.A. não pede.
    - **Decisão por item** (cada Não conforme): **"Abrir corretiva"** exige o **nº do chamado GLPI** e só finaliza ao salvar; **"Não abrir"** exige **justificativa**. Fica registrado quem decidiu e quando. A decisão não muda; quem tem a permissão **"Gerenciar Solicitações"** (padrão Administrador e Super Admin; pode ser dada a outros perfis) só corrige o nº do GLPI ou a justificativa (registra quem corrigiu). Removido o botão que criava OS corretiva dentro do Hexon.
    - A OS continua **Concluída** (conta em tudo). Enquanto houver item sem decisão, ela aparece para o técnico na aba **"Solicitações"** do celular, com o andamento de cada item, e só sai de lá quando todos tiverem decisão.

37. **Prazos e horários (Etapa 10), respostas de 01/10/2026:** (Etapa 9, Relatórios, adiada a pedido)
    - **Trava rígida:** passou da meia-noite do último dia do prazo da OS (período do Super Admin), não inicia nem conclui — OS de 1 dia vai até 23:59 daquele dia; OS do mês, até 23:59 do último dia do período. Vale para todas as periodicidades (Diária, Semanal, Mensal...). Não planejada ou não executada no prazo vira **Não Executada**.
    - **Rotina das 00:00:** OS em execução (com início registrado) não vira "Atrasada"; se o prazo venceu, vira **Não Executada** e o início é apagado (sai da execução do técnico). A checagem do navegador segue a mesma regra.
    - **Fechamento do mês:** dia 1º às **00:10** (antes 03:30).
    - Conclusão feita sem internet dentro do prazo e enviada depois da meia-noite continua valendo (hora do celular; relógio alterado aparece como "horário divergente").
    - P1 e P2 (leituras da rotina de prazos) ficam para a rodada final de leituras e gravações.

38. **Otimização de leituras e gravações (01/10/2026), aprovada:**
    - Removida a checagem de prazos no navegador (P2): só a rotina da nuvem grava prazos.
    - Rotina das 00:00 lê só as OS que vencem (P1): abertas com `endDate` < hoje e "Planejada" com `scheduledDate` < hoje.
    - Técnico: 1 escuta só (gerência + matrícula + OS abertas); saíram a escuta por nome e a das fechadas do mês; "Atualizar" não relê as OS.
    - Consulta de OS filtra o técnico pela matrícula.
    - Decisão de solicitação não regrava o histórico do ativo.
    - Removidas funções de busca sem uso.
    - "Sentinela" (documento único avisando a última OS mudada) avaliado e não adotado: a cópia local com `syncAt` já lê só o que mudou, sem gravação extra e sem perder alterações em lote.

39. **Campos de controle e índices esparsos (01/10/2026):** teste do disparo de 1.279 OS (GMMR) mostrou ~11 unidades de gravação por OS (1 do documento + 10 índices) e ~10 mil leituras na conferência do "Conferir".
    - Removida a conferência OS a OS do disparo (fica só o registro do disparo; o banco recusa regravar OS existente).
    - A OS ganha campos que só existem quando necessários (`src/db/orderControl.ts`): `unitOpen`, `openEnd`, `plannedEnd`, `techOpen`, `techSol`, `solAt`, `addrEnd`. Os índices passam a ser esparsos sobre eles; meta ~6 unidades por OS no disparo.
    - Regras: listagem também por `unitOpen` (gerência), `techOpen` e `techSol` (próprio técnico); OS concluída aceita mudar `techSol`, `solAt` e `addrEnd`.
    - OS gravadas antes desta mudança não têm os campos (o banco será zerado antes da produção). Consequência aceita: OS antigas **não aparecem para o técnico** (nem nas Solicitações dele) e a rotina das 00:00 não as trata.

40. **Resultado medido (01/10/2026), depois de apagar 7 índices antigos:** disparo de 1.288 OS (GMMR, mar/27) = **~7,9 mil unidades de gravação (~6,1 por OS)**, ~2,65 mil leituras em tempo real (1.288 × 2 telas abertas) e ~3 mil leituras comuns (~2,3 por OS; **origem não confirmada** — o Query Insights não mostra consultas no disparo; suspeita: leituras das regras de segurança). Antes: ~13 por OS com os índices antigos e ~10 mil leituras da conferência.
41. **(Removido na Fase 7E-1, 14/10/2026: o prazo de planejamento deixou de existir; vale o prazo de cada preventiva, do disparo.)** **Prazo de planejamento em tempo real (02/10/2026):** a tela de Preventivas escuta `planningDeadlines` (1 leitura por gerência ao abrir + 1 por mudança). Antes a cópia do navegador nunca atualizava (o planejador via o prazo antigo). A contagem regressiva é recalculada na tela a cada minuto, sem ler o banco.
42. **Calendário vazio na 1ª entrada (01/10/2026):** a escuta das OS agora recomeça quando o login do Firebase fica pronto (`currentUser?.uid` nas dependências em `App.tsx`).
43. **Preventivas mais leve (02/10/2026):** a comarca vem da própria OS (gravada no disparo); ativo procurado por código (mapa), não percorrendo a lista; listas e filtros recalculados só quando as OS ou filtros mudam.
44. **Técnico sem OS antigas (03/10/2026):** a lista do técnico vem só da escuta em tempo real; a cópia antiga do navegador (`hexon_service_orders`), que aparecia quando a lista ficava vazia e travava a tela (OS no formato antigo), não é mais usada e é apagada do aparelho.
45. **Histórico paginado (03/10/2026):** histórico do ativo/endereço em páginas de 12 (busca 13 para saber se há próxima), do mais recente para o mais antigo, dentro do sistema e no QR público (`src/db/historyPages.ts`, `src/components/assets/HistoryPager.tsx`). Índice `histories`: `assetId ↑ + date ↓`.
46. **Assinatura medida (03/10/2026, quadro 400×160, traço 2,5 px, PNG):** curta ~7 KB, normal ~13 KB, longa ~43 KB, rabisco máximo ~124 KB. Limite nas regras: **150 KB** (nunca recusa assinatura real).
47. **Regras de prazo mantidas (02/10/2026):** prazo do planejador expirado = planejador bloqueado (Super Admin nunca); OS não planejada fica "Aguardando" até o fim do período e então vira Não Executada; planejada não feita no dia vira Atrasada (técnico ainda executa até o fim do período). Sem registro de pedido/autorização para mudar o prazo.
48. **Custo estimado em produção (02/10/2026):** 2 Super Admins, 6–9 planejadores, 180–200 técnicos, 10 mil ativos, ~1.000 materiais, 9.500 OS no disparo mensal, 500 rondas diárias (dias úteis) e 250 semanais (~21.600 OS/mês). Estimativa: **~US$ 0,50 a 2 por mês no 1º ano** (cresce com o armazenamento: ~0,2–0,4 GB/mês). Hosting, Functions e Scheduler não medidos (devem ficar no grátis).

### Pendências (atualizado 03/10/2026; P39 em 09/10/2026)
| # | Item | Situação | O que fazer |
|---|---|---|---|
| P1 | Rotina de prazos lê todas as OS abertas | ✅ resolvido (decisão 38/39: `openEnd`, `plannedEnd`) | — |
| P2 | Checagem de prazos no navegador | ✅ removida | — |
| P3 | Leituras extras no disparo | 🟡 conferência removida (~10 mil → 0); sobram ~3 mil por 1.288 OS sem origem confirmada | Confirmar (suspeita: leituras das regras) |
| P4 | Índices não esparsos de solicitações/vistorias | ✅ resolvido (`solAt`, `addrEnd`) | — |
| P5 | Painel do Super Admin mostra uma gerência por vez | aberto | Avaliar resumo com todas |
| P6 | Arquivo principal do site (~2,9 MB) | aberto | Carregar cada aba sob demanda |
| P7 | ✅ (resolvido pela aba Auditoria, paginada) Registro de acessos lê ~300 por abertura (Query Insights: 3 aberturas = 945 leituras) | aberto | Índice `timestamp` decrescente / paginação |
| P8 | Teste de volume com modelos reais | aberto | Medir execução completa (iniciar → assinar) com algumas OS e trocar estimativas por medidas |
| P9 | Fechamento mensal | ✅ 00:10 do dia 1º | — |
| P10 | Carga diária do técnico para uso sem internet | aberto | Medir no teste de volume |
| P11 | Consulta de `serviceOrders` no Query Insights: 54 execuções, ~252 entradas de índice lidas para 1 resultado | aberto | Abrir o detalhe no Query Insights para identificar |
| P12 | "Atualizado em" dos modelos em UTC (3h a mais) | aberto | Corrigir para hora local |
| P13 | "Reverter todas as atrasadas" grava 1 a 1 | aberto (está como operação em massa) | Opcional: gravar em pacote |
| P14 | Botão OK do prazo de planejamento usa `alert()` do navegador | ✅ deixou de existir (Fase 7E-1: o prazo de planejamento saiu) | — |
| P15 | Lentidão restante do calendário com muitas OS | 🟡 melhorado (decisão 43) | Medir de novo com volume |
| P16 | Botão "zerar sistema" (Super Admin) | adiado | Desenhar quando for zerar o banco |
| P17 | Etapa 9 — Relatórios | adiada | — |
| P18 | Proteção: Etapa 5 (corte automático) e aba Monitoramento | adiados (usuário não se sentiu confortável agora) | Ver seção 8 |
| P19 | ✅ (Pacote 1, 03/10/2026: assinatura + histórico + OS num pacote só; erros na tela) **Auditoria 03/10/2026 — gravação de OS falha sem avisar** (`dbSaveServiceOrder`, `dbAddHistoryLog`, `dbSavePlanningDeadline`, `dbSaveAsset` engolem o erro do banco e a tela mostra sucesso; o histórico do ativo é gravado antes da OS) | **ALTA** | Devolver o erro para a tela; gravar o histórico só depois da OS |
| P20 | ✅ (03/10/2026: aba "Auditoria" no Controle de Usuários, 20 por página; índices `auditLogs: timestamp ↓` e `accessLogs: timestamp ↓`) **Não existe tela de Auditoria / Registros de acesso** (`auditLogs`, `accessLogs` só no Console). Disjuntor e login com falha gravam, mas ninguém vê no app | **ALTA** | Tela simples para o Super Admin (paginada) |
| P21 | ✅ (Pacote 1: sem sementes; banco vazio = lista vazia) **Gerências de exemplo** recriadas se `managements`/`units` ficarem vazias (Refrigeração, Elétrica, Civil, Segurança; unidades fictícias) — risco ao zerar o banco | **ALTA** | Sementes = DOM/GMMR/GMEE/GMC ou nenhuma; manter `managements` ao zerar |
| P22 | ✅ (Pacote 1: só Super Admin grava) Regra `planningDeadlines`: qualquer usuário da equipe pode gravar o prazo de planejamento | MÉDIA | Gravar só Super Admin |
| P23 | ✅ (Pacote 2) App do técnico e tela da OS reconhecem "OS dele" pelo **nome** | MÉDIA | Usar a matrícula |
| P24 | ✅ (Pacote 2: limite com mensagem clara) Programar lote com ~500+ OS falha (limite de 500 operações por pacote) | MÉDIA-BAIXA | Dividir em pacotes ou limitar |
| P25 | ✅ (feito 03/10/2026, pacote 3: Dashboard e fechamento usam `unit`) Dashboard e fechamento mensal agrupam por `sector` (hoje igual ao nome da gerência, então funciona); `isSectorInGerencia` usa `includes('AR')` | BAIXA (robustez) | Usar `unit` |
| P26 | Regras amplas: técnico pode editar ativo; histórico de outra unidade; `templateVersions` por qualquer um; `dispatchIndex` por Administrador | BAIXA | Apertar quando houver tempo |
| P27 | 79 janelas `alert/confirm` (9 na OS do técnico) | BAIXA | Trocar por mensagens na tela aos poucos |
| P28 | ✅ (feito 03/10/2026, pacote 3: removido ao abrir o sistema) `hexon_histories` no navegador cresce a cada conclusão (legado sem uso) | BAIXA | Remover |
| P29 | ✅ parcial (03/10/2026, pacote 3: as 3 telas antigas apagadas) Código sem uso: `OrdersCalendarPlanning.tsx`, `TemplateGeneratorTab.tsx`, `TemplateManagerTab.tsx` (~3.800 linhas), `dbGetServiceOrders` (lê a coleção inteira), `subscribeServiceOrders`, `forceRefetchAllData`, foto de evidência | LIMPEZA | Apagar |
| P31 | ✅ (Pacote 1) "Reverter para Novo" no cartão da lista (Realização) e dentro da OS deixava matrícula e lote: OS seguia ligada ao técnico e ao pernoite. Agora todas as telas usam `dbRevertOrderToNew` (planning.ts) | MÉDIA | — |
| P32 | ✅ (feito 03/10/2026, pacote 3: aviso "cadastre as gerências primeiro") Telas com "Refrigeração/Elétrica/Civil" como opção quando não há gerências cadastradas (formulário de ativo, importação, usuários) | BAIXA | Trocar por aviso "cadastre as gerências" |
| P33 | ✅ (feito 03/10/2026: `histories: assetId` apagado; 4 índices criados) **Índices revisados (03/10/2026):** 21 de 22 são usados; `histories: assetId` não é mais usado (o histórico paginado usa `assetId + date ↓`) → apagar. Buscas sem índice que provavelmente leem a coleção inteira: `materials` (unit), `workforce` (unit), `users` (gerencia) — carga diária de cada técnico — e `planningLots` (unit + periodStart) | MÉDIA | Criar 4 índices (gravações raras) e conferir no Query Insights |
| P34 | Consulta de OS: `orderBy endDate` + filtros (unidade, status, técnico...) percorre o índice `endDate` de todas as unidades; filtro raro (ex.: Cancelada) pode ler muito | a medir | Medir no Query Insights; se pesar, exigir mês ou criar `unit + endDate ↓` |
| P35 | ✅ (feito 03/10/2026, pacote 3: Modelos e "Conferir" do Disparo leem do banco) **Modelos com cópia de 12 h no navegador:** o disparo usa a lista de modelos guardada no computador (validade 12 h). Modelo editado ou criado em outro computador pode não aparecer: o disparo usaria a versão antiga do checklist ou diria "sem modelo" | **ALTA** | Recarregar os modelos do banco ao abrir Modelos/Disparo e antes de "Conferir" |
| P36 | ✅ (feito 03/10/2026, pacote 3: aviso de cadastros alterados em `appControl.dataVersionAt`; aparelhos abertos relêem) Outros cadastros com a mesma cópia de 12 h (usuários, gerências, permissões): técnico novo, gerência nova ou permissão alterada podem demorar até 12 h para aparecer em outro computador | MÉDIA | Reduzir a validade ou recarregar nas telas que dependem disso |
| P37 | ✅ (feito 03/10/2026, pacote 3: nome fixo na edição; exclusão bloqueada se usada por usuários, ativos ou perfis) Renomear ou excluir gerência quebra os dados ligados a ela (OS, usuários, ativos e regras guardam o nome) | MÉDIA | Bloquear troca de nome e exclusão de gerência em uso (só descrição) |
| P38 | ✅ parcial (03/10/2026, pacote 3: erros mostrados na tela; conta de login continua — preferir "Inativo") Excluir usuário apaga o cadastro, mas a conta de login fica (recriar com a mesma matrícula exige apagar no Console); erros ao salvar/excluir gerência só no console | BAIXA | Preferir "Inativo"; mostrar erros |
| P30 | ✅ Segunda rodada (03/10/2026): Controle de Usuários, perfis (troca de tipo atualiza os usuários: ok), importação de ativos (baixa os ausentes com confirmação e %: ok), etiquetas QR, PDF mapeado, Dashboard (só leituras locais e resumos: ok), versões dos modelos (sobem a cada edição: ok) | — | Achados em P35–P38 |
| P39 | ✅ resolvido (09/10/2026; aplicado no main `a0968a5` + nome do arquivo) | **Site publicado lento e travando:** "Iniciar" da preventiva fica em "Iniciando..." (às vezes depois de baixar o PDF) e a OS trava depois da assinatura do técnico; sair e entrar melhora. **Conferido:** código do main `882977a` + regras publicadas no emulador — OS 34/34, preventiva/PDF 19/19, aviso 14/15 (falha só de dados do teste); sem acúmulo de escutas/memória em 5 voltas por todas as telas; PDF + Iniciar, "pagehide" simulado e 2 abas com a 1ª congelada: inicia em 1 s. Os dois sintomas são o app **esperando o banco sem limite de tempo** (`dbStartOrder`: `getDocs` de `orderStarts`; `dbConcludeWorkOrder`: `batch.commit`). **Incidente do Google:** Firebase Hosting com "Bandwidth Quota Exceeded" (509) intermitente e deploys falhando por cota (429) desde 07/10 09:30 PDT; rollback em 08/10 13:21 PDT; contorno: ativar a Firebase Hosting API no projeto `hexonpreventiva`. Hosting só entrega os arquivos na abertura (nenhum clique busca arquivo do site; `version.json` trata erro) → explica lentidão ao abrir, **não** o "Iniciando...". Pedido ao usuário: ativar a API, conferir se o último deploy entrou (histórico do Hosting), ver Firestore em Cloud Service Health. **Proposta aguardando aprovação:** limite de ~10 s no Iniciar, na assinatura/conclusão da OS e no PDF (aviso claro; Iniciar cai no modo sem internet). Usuário instalou o conector do Firebase (09/10/2026): numa sessão nova, usar para ver histórico do Hosting, erros e latência do banco. **CAUSA ENCONTRADA (09/10/2026):** o usuário relatou "inicio pelo celular e vai normal; se abro a preventiva, aperto PDF e volto, o sistema trava todo". O Firestore (`IndexedDbPersistence`, aviso "pagehide") entra em **modo restrito** e se desliga quando a página "sai" em navegador Safari cujo identificador tem `Version/14-16` ou `Mobile/14-16` — e **todo iPhone** traz `Mobile/15E148` (Safari e Chrome do iPhone). No iPhone, baixar o PDF por link abre o arquivo na mesma tela → "pagehide" → ao voltar, o app parece normal mas **nenhuma operação do banco termina** (Iniciar, assinar, salvar). Reproduzido no emulador com identificador de iPhone: "Iniciando..." para sempre e nada no banco; com identificador de Android: inicia em 1 s. Antes desta etapa o técnico quase não baixava PDF no celular (só o mapeado da preventiva) → por isso apareceu agora. **Correção aprovada e programada (09/10/2026, commit `77040e1`; sem regra nem índice):** (1) `src/lib/fileDelivery.ts` — no celular/tablet (`isPhoneOrTablet`) o arquivo não é baixado por link: vai para o aviso **"PDF pronto"** (`src/components/PdfReadySheet.tsx`, montado uma vez no `main.tsx`) e o toque em **"Abrir / compartilhar"** abre o menu de compartilhar do celular (`navigator.share` com o arquivo; sem ele, abre em outra aba); no computador baixa como antes. `downloadBytes`/`downloadBlob` (`osPdf.ts`) e o PDF da preventiva (`OrderDetailsDrawer`) usam esse caminho → vale para todos os PDFs do celular (preventiva, OS, "Baixar PDF com a assinatura do cliente", "Assinadas pelo cliente"). Dois toques porque o iPhone só abre o menu logo após um toque e montar o PDF leva segundos. (2) **Proteção** no `main.tsx`: se a página "saiu" (`pagehide`) e o app volta a aparecer (`pageshow`/tela visível/foco), recarrega sozinho (o rascunho da preventiva fica no aparelho). Testes 12/12 (iPhone: PDF pronto e compartilhar na preventiva e na OS, Iniciar depois do PDF, recarregar ao voltar, celular sem compartilhar abre em outra aba, computador baixa direto); regressão: OS 5B 34/34, aviso 15/15, permissões/PDF e 8C-3 sem falha. Entregue em 9 partes (`p39/p39-parte-01..09-de-9.md`, ≤ ~1.600 caracteres), conferidas sobre o main `882977a` (resultado = ramo; tsc e build ok). **Aplicada no main `a0968a5` (09/10/2026), tudo entrou na 1ª vez; igual ao ramo; tsc e build ok.** **Teste do usuário no iPhone (09/10/2026):** travamento resolvido e PDF da OS ok; **PDF da preventiva dava erro ao enviar** — o nome do arquivo levava o nº real da preventiva com "/" (`formatOrderNumber`: "123 · MEN 10/26" → `Preventiva_123 · MEN 10/26.pdf`) e o compartilhar do iPhone recusa. Correção (commit `029f1b3`): `safeFileName` em `fileDelivery.ts` (troca `/ \ : * ? " < > |` por "-", " · " por "_" e espaços por "_" → `Preventiva_123_MEN_10-26.pdf`, vale também no computador); o aviso mostra o erro real do compartilhar. Testes: 2/2 (simulação do iPhone que recusa "/"), P39 12/12, permissões/PDF 19/19. Entregue em 1 parte (`p39b/p39b-parte-1-de-1.md`, 4 trocas), conferida sobre o main `a0968a5`. |

## 6. Perguntas em aberto

Hexon 2.0 (seção 11, `docs/historico/hexon2-fases.md`), feitas em 03/10/2026:
1. O Hexon principal: **também é Firebase** e está em uso. Código-fonte recebido e analisado em 03/10/2026 (ver `docs/levantamento-hexon-principal.md`). **O usuário não tem acesso ao servidor nem ao banco do principal**: o caminho é reproduzir as ideias no nosso sistema, não migrar dados. Perguntas novas do levantamento: seção 6 daquele documento.
2. Os dois sistemas rodam juntos por um tempo? Qual a data desejada para desligar o antigo?
3. Usuários e ativos **quase não mudam** com a unificação (resposta de 03/10/2026). Falta: volume por mês de corretivas, layouts e acompanhamentos.
4. Quem abre chamado: só usuários com login ou também requerentes de fora (ex.: servidor da comarca)? Abertura vem do GLPI?
5. As 4 assinaturas: quem é o "cliente" e onde assina (no celular do técnico?); engenheiro e gerente assinam no sistema? Alguma pode ser dispensada?
6. Hora extra: regra de cálculo (preventiva não tem).
7. Bater ponto: para que é usado (controle interno ou ponto oficial de jornada)?
8. Preventivas em produção antes do 2.0 (zerar, ciclos, cadastros) ou só depois?

---

## 7. Custos e medições do banco (Firestore Enterprise)

**Como cobra (página oficial, pesquisada em 02/10/2026):** grátis por dia **50 mil unidades de leitura**, **40 mil de gravação**, **50 mil leituras em tempo real**, 1 GiB guardado, 10 GiB/mês de saída. Acima disso: leitura **US$ 0,05 / milhão**, gravação **US$ 0,26 / milhão**, tempo real **US$ 0,30 / milhão**, armazenamento ~**US$ 0,24 / GiB / mês**. Leitura = blocos de 4 KB; gravação = blocos de 1 KB + 1 por entrada de índice. Índice não esparso inclui toda OS; esparso só as que têm o campo. Não confirmado: horário em que o grátis "vira" o dia e variação de preço por região.

**Medido no sistema**
| Situação | Resultado |
|---|---|
| Disparo (1.288 OS) | ~6,1 gravações/OS; tempo real = OS × telas de gestão abertas; ~2,3 leituras/OS (origem a confirmar) |
| Assinatura | 7 a 43 KB (máx. possível ~124 KB) |
| Gasto real até 02/10/2026 | R$ 0,00 (R$ 0,29 coberto por desconto/crédito) |

---

## 7.1 Simulação geral de carga (14–15/10/2026) — resultado e lista de ajustes S1–S22

**Pedido do usuário (14/10/2026):** simular o sistema inteiro em carga máxima (pico 8h–10h) para achar problemas, ajustes e falhas de layout e ter um resumo de leituras/gravações por mês e por gerência, **antes de implantar**. "Anote todos os ajustes para serem tratados depois." Nada do app foi alterado; os ajustes abaixo ficam para aprovação.

**Cenário combinado com o usuário**

| Item | Valor usado |
|---|---|
| Pessoas | 212: 2 Super Admin, 20 do escritório (GMMR 5, GMEE 6, GMC 6, DOM 3 que veem as 3 gerências), 190 técnicos (GMMR 30 = 22 principal + 4 EMPRESA A + 4 EMPRESA B; GMEE 50; GMC 60; DOM 50 técnicos locais, um por prédio) |
| Ativos | 8.000 (principal 6.000: GMMR ~500, GMEE ~2.670, GMC ~2.830; EMPRESA A 1.300 e EMPRESA B 700 na GMMR); 130 endereços para todas as gerências |
| Preventivas/mês | ~8.308 (GMMR 2.500, GMEE 2.670, GMC 2.830, DOM 308 vistorias = 4 diárias + 30 semanais + 50 quinzenais — **interpretação a confirmar**: o usuário falou em "~120 semanais e ~100 quinzenais") |
| Chamados/mês | 3.800 (GMC 1.700, GMEE 1.600, GMMR 500 = 300 principal + 100 + 100) + corretivas ≈ 5% das preventivas (~400) |
| Assinaturas | técnico → cliente (metade no celular, metade por link) → engenheiro → gerente |
| Pedidos/mês | 300 de material + 300 de insumos (só principal) |
| Listas | materiais GMMR 103 (planilha real), GMEE 600, GMC 1.000; insumos 2.000 |
| Avisos | 30 por gerência/mês (1/3 de cada tipo, alguns com foto) + 5 programações semanais publicadas por semana (PDF) |
| Histórico | 6 meses (abril–setembro) + outubro; dia normal 14/10 e fim de mês 30/10 com o disparo de novembro |

**Como foi feito:** emuladores do Firebase (banco + login) com as regras do ramo; o app compilado (sem o modo de desenvolvimento) com um **medidor** no `guard.ts` (cópia só da simulação) que anota cada leitura, escuta e gravação; robôs Playwright/Chromium que usam as telas como as pessoas (login, preventiva, chamado, assinaturas, link do cliente, pedidos, avisos, disparo). Importações e disparo de outubro feitos pelas telas. Unidades cobradas calculadas pelo tamanho real dos documentos (amostra de 300 por coleção) e pela lista de índices da seção 9. Os roteiros e dados da simulação ficaram no rascunho da sessão (se perdem entre sessões); para repetir, refazer a partir deste resumo.

**Limites (não esquecer ao ler os números):** (1) o emulador **não é** o servidor do Google: tempos e travamentos com muita gente ao mesmo tempo são do emulador (ver S3); (2) as fotos da sessão (prints) usam navegador em inglês (datas aparecem mm/dd/yyyy só por isso); (3) assinaturas do histórico foram copiadas (~10 KB); a assinatura feita pelo robô (traço largo de propósito) ficou com 70–76 KB no chamado e ~20 KB na preventiva, mas a medida anterior no sistema real foi de **7 a 43 KB** (seção 7) — por isso armazenamento e gravações aparecem como faixa (robô = limite de cima); (4) a projeção do mês usa hábitos estimados (técnico abre o app 3x/dia, escritório 2x/dia, 22 dias úteis, 10% de aparelhos novos por mês) — mudar os hábitos muda o total, não a ordem de grandeza; (5) efetivo e equipes não foram cadastrados (a Programação mostra todos como "Fora das equipes").

**Custo de cada ação (medido no app; unidades cobradas)**

| Ação | Leitura | Tempo real | Gravação |
|---|---|---|---|
| Técnico executa 1 preventiva (iniciar, atestar, assinar, concluir) | 6 | 5 | 36 (assinatura ~20 KB) |
| Técnico conclui 1 chamado (1 material + assinatura) | 4 | 0 | 91 (assinatura do robô ~76 KB; real 7–43 KB → ~25–60) |
| Cliente assina no celular | 0 | 0 | 86 (assinatura ~71 KB) |
| Link do cliente (gerar + responder + trazer a resposta) | 3 | 0 | ~35 |
| Engenheiro ou gerente assina 1 chamado (em lote) | ~9 | 0 | ~66 (assinatura ~50 KB) |
| Planejador emite 1 chamado | 2 | 0 | 16 |
| Pedido de material inteiro (pedir, aprovar, retirar) | ~6 | ~3 | ~12 |
| Pedido de insumos inteiro (pedir, confirmar, fornecer, receber) | ~5 | ~3 | ~17 |
| Disparo do mês | ~0 | 0 | ~7 por preventiva (medido: 2.500 GMMR em 36 s) |
| Aviso urgente com foto: publicar / cada técnico abre e dá ciente | 5 / 31 | 0 / 1 | 96 / 3 |
| Técnico abre o app (cópia guardada) | 16–39 | 1 | 0 |
| Técnico, celular novo | 88 (DOM) – 1.176 (GMC: 1.000 materiais) | 41–203 | 5 |
| Planejador abre o app (cópia guardada) | ~44 | 1 | 0 |
| Planejador, computador novo | ~5.600 preventivas + **8.000 ativos de todas as gerências** + 600–1.000 materiais + 2.000 insumos + usuários/endereços ≈ **16 mil** | ~370 | 5 |
| Telas: Chamados 39 (+218 tempo real na 1ª vez), Programação ~420, Preventivas ~53, Início ~25, Solicitações ~25 | | | |

**Projeção do mês (unidades cobradas)**

| Gerência | Leitura | Tempo real | Gravação |
|---|---|---|---|
| GMMR | ~250 mil | ~123 mil | ~324 mil |
| GMEE | ~352 mil | ~262 mil | ~664 mil |
| GMC | ~374 mil | ~278 mil | ~706 mil |
| DOM | ~176 mil | ~88 mil | ~19 mil |
| Super Admin | ~10 mil | ~7 mil | 0 |
| **Total** | **~1,16 milhão** | **~0,76 milhão** | **~1,71 milhão** |

| Tipo de usuário | Leitura | Tempo real | Gravação |
|---|---|---|---|
| Técnicos | ~451 mil | ~107 mil | ~950 mil |
| Escritório (planejador/administrativo/almoxarifado) | ~569 mil | ~644 mil | ~149 mil |
| Engenheiro e gerente | ~123 mil | ~0 | ~554 mil |
| Sistema (disparo, rotina das 00:00, fechamento) | ~9 mil | 0 | ~61 mil |
| Super Admin | ~10 mil | ~7 mil | 0 |

- **Por dia útil:** ~53 mil leituras (grátis 50 mil/dia), ~34 mil tempo real (grátis 50 mil), **~52 a ~75 mil gravações (grátis 40 mil)**; dia do disparo: +57 mil gravações. **Custo das operações: ~US$ 0,10 a 0,22/mês.** (A tabela acima usa a assinatura do robô, o limite de cima; com assinaturas reais de ~25 KB as gravações do mês ficam em ~1,2 milhão.)
- **Armazenamento:** entra **~0,6 a 1,1 GB por mês**, quase tudo **imagens de assinatura** (chamados 360–870 MB, preventivas ~160 MB). Em 12 meses ~7–13 GB → ~US$ 1,4 a 2,9/mês no 12º mês (1 GB grátis; ~US$ 0,24/GB-mês).
- **Assinaturas = ~40–60% das gravações e ~85–90% do armazenamento.** Com assinatura de ~8 KB (S8), as gravações cairiam para ~0,84 milhão/mês (~38 mil por dia útil, dentro do grátis) e o armazenamento para ~0,25 GB/mês (estimativa).
- Funções da nuvem: rotina das 00:00 lê só as que vencem no dia (dezenas); fechamento do mês lê as ~8.300 do mês e grava 4 resumos.

**Teste de carga (robôs ao mesmo tempo)**
O emulador do Google aguentou **no máximo 4–6 aparelhos ao mesmo tempo** (8 GB de memória; acima disso fica sem memória e para de responder por até 60–100 s). Por isso os 212 foram passados em fila, alguns por vez; **os tempos abaixo são do emulador, não de produção** (produção não foi medida).

| Rodada | Resultado |
|---|---|
| Pior caso: todos com aparelho novo às 8h (12 por vez) | O emulador não aguentou (derruba a conexão com mais de 10 mil mensagens pendentes). 20 de 21 emissões de chamado falharam com a tela Emitir OS em "Carregando…" esperando a cópia de ~16 mil registros do computador novo (S7). Mostra que a 1ª entrada de todos ao mesmo tempo (dia da implantação) é o momento mais pesado |
| Dia normal, aparelhos com a cópia guardada (209 pessoas, 6 por vez, 73 min) | Escritório: emitir chamado 20/21 (mediana ~5 s), lista de chamados ~3 s, assinatura em lote 6/6 (~19 s), aprovar material / confirmar e fornecer insumos ok. Técnicos: entrar 188/190 (~15 s), link do cliente 20/20, cliente assina no celular 14/18; preventiva e conclusão de chamado com muitas falhas porque avisos urgentes abriam por cima dos botões (S2) e o emulador ficou lento. **Disjuntor desarmou 2 vezes** (técnicos locais da DOM, ao abrir o app) → S5 |
| Fim de mês (30/10): disparo de novembro (8.308) com 40 pessoas trabalhando (4 por vez) | GMEE 2.782 gravações em 119 s, GMC 2.950 em 136 s, DOM 525 em 28 s; GMMR 2.500 em 218 s (repetido logo depois: o robô tentou escolher a gerência enquanto a tela ainda baixava os 8 mil ativos). O disparo não desarmou o disjuntor. Durante o disparo: emissões 2/2 e pedidos ok; 12 de 37 técnicos não abriram o app em 120 s (emulador ocupado gravando) |
| Avisos urgentes ao abrir (rodada de fim de mês, mais estável) | Técnico local da DOM: média 4,7 e até 16 avisos para confirmar; GMMR até 1; GMEE e GMC 0 |

Fluxos que funcionaram com várias pessoas ao mesmo tempo: entrar, emitir e atribuir chamado, listas e filtros, executar preventiva, concluir chamado com material, assinatura do cliente (celular e link), assinatura em lote do engenheiro/gerente, pedidos de material e insumos (pedir, aprovar, confirmar, fornecer, retirar/receber), avisos com foto, disparo. Nenhuma gravação disputada por todos: a única comum é o contador da numeração dos chamados (~170 por dia).

**Layout (prints de computador e celular com o banco cheio):** nenhuma tela com rolagem para o lado no computador (1440 px) nem no celular (390 px). Achados em S1, S2, S14, S15, S16 e S19.

**Ajustes anotados (para tratar depois; nada foi mudado)**

| # | Prioridade | Achado | Proposta |
|---|---|---|---|
| S1 | ✅ Lote 1 (15/10/2026) — era ALTA | **Lista de preventivas do técnico não segue o dia agendado:** no técnico local da DOM começa pelo dia mais distante (30/10, 29/10, 28/10…); no técnico da EMPRESA A (217 pendentes, 11 páginas de 20) vem misturada (26/10, 20/10, 30/10…). A de hoje (14/10) não aparece na 1ª página. Causa: a lista segue a data de criação (`compareOrdersNewestFirst`) e no disparo todas nascem juntas | Ordenar: atrasadas, hoje, próximos dias; ou abrir já na página de hoje |
| S2 | ✅ Lote 1 (15/10/2026) — era ALTA | **Avisos urgentes em fila no celular:** em aparelho novo, todos os urgentes ainda válidos abrem um por um por cima do trabalho (técnico local da DOM, gerência "Todas", recebe os das 4 gerências: sino com 89). Também apareceram no meio da execução do chamado. No teste de carga, técnico local da DOM teve de confirmar até 19 urgentes ao abrir o app, e os que abriam depois bloquearam o toque nos botões. 14 dos 34 urgentes válidos na simulação não tinham data de fim (abrem para sempre em aparelho novo) | Só abrir sozinho o urgente novo (ex.: últimos 3 dias); os outros só no sino; botão "ciente de todos"; técnico local só recebe os da DOM + "todas" (decidir com S6) |
| S3 | NÃO SE APLICA HOJE (15/10/2026; era ALTA) — o usuário corrigiu: só o Super Admin vê todas, uma por vez; fica para quando existir um usuário que veja as 4; fora do Lote 5 (15/10/2026, usuário: dispara as preventivas de 1 gerência por dia) | **Planejador da DOM (vê 4 gerências — suposição errada da simulação) não carregou nenhuma preventiva no emulador** (3 de 3 tentativas; Início dizia "As preventivas de outubro ainda não foram disparadas"). Causa no emulador: a 1ª carga de ~15 mil preventivas (~35 MB) passa de 10 mil mensagens no mesmo canal e o emulador derruba o canal ("too many pending messages… 10001"). O servidor real tem controle de fluxo — **não confirmei que falha em produção**, mas é a maior carga do sistema | Carregar a cópia uma gerência por vez; trocar "ainda não foram disparadas" por "Carregando…" enquanto a cópia não chegou; avaliar se a DOM precisa da cópia das 3 gerências ou só de contagens/resumos |
| S4 | ✅ Lote 1 (15/10/2026) — era ALTA | **A cópia das preventivas pode ficar gravada vazia:** a 1ª carga (`orderSync.fullDownloadNow`) usa `getDocs`, que, se a conexão cair, devolve o que há no aparelho (nada) sem erro; a cópia "pronta" e vazia é guardada e depois a escuta `syncAt > 0` baixa **todo o histórico da gerência** (todos os meses), não só abertas + 2 meses. Visto no S3 | Usar `getDocsFromServer` (ou conferir `metadata.fromCache`) na 1ª carga e tentar de novo; não guardar cópia que não veio do servidor |
| S5 | ✅ Lote 1 (15/10/2026) — era ALTA | **Repetição sem fim ao tirar o aviso "Assinadas pelo cliente" desarma o disjuntor:** quando o engenheiro já assinou, o celular do técnico tira o aviso sozinho (`TechnicianMobileView.tsx`, 1 gravação por chamado); se essa gravação é recusada pelo banco, o app desfaz, a lista muda e ele tenta de novo na hora, sem limite. Comprovado no emulador recusando a gravação de propósito: **121 tentativas no mesmo chamado em ~10 s → disjuntor desarmado → app do técnico bloqueado até recarregar** (nem o "ciente" dos avisos grava). No teste de carga aconteceu sozinho com 2 técnicos locais da DOM ao abrir o app (a causa exata da recusa ali não confirmei; provável cópia do aparelho diferente do banco depois de reiniciar o emulador) | Não tentar de novo na hora (tentar só na próxima abertura ou com espera crescente) e tirar os avisos num pacote só (`writeBatch`) |
| S6 | ✅ Lote 2 (15/10/2026; campo "Técnico local") — era MÉDIA | **Técnico local da DOM precisa ter gerência "Todas"** para receber chamados das outras gerências: pela regra pode ler todas as OS e recebe avisos de todas | Campo próprio "gerências que atende" no técnico local (sem "Todas") |
| S7 | BAIXA — fora do Lote 5 (15/10/2026, usuário: "não precisa fazer pq é só para as primeiras aberturas que gasta muita leitura depois é só o que muda"); era MÉDIA | **Computador novo do escritório baixa os 8.000 ativos de todas as gerências** (cópia local de ativos sem filtro; só quando abre uma tela que usa ativos: Ativos, Preventivas, Modelos, QR, Gerências), além de ~5.600 preventivas, 2.000 insumos e a lista de materiais (~16 mil leituras, ~20 MB no aparelho). **Correção (15/10/2026):** o Emitir OS **não** usa a lista de ativos (medidor: 0 leituras de ativos ao emitir); o "Carregando…" do teste de carga foi o emulador com 12 computadores novos baixando preventivas ao mesmo tempo. 8.000 ativos ≈ 5 MB e ~US$ 0,0004 por computador novo | Cópia de ativos só das gerências da pessoa; carregar ativos só quando a tela precisar |
| S8 | ✅ Lote 4 (15/10/2026; assinatura leve de 4 tons, ~2–3 KB) — era MÉDIA (custo) | **Imagens de assinatura grandes:** PNG 720×270 com carimbo, 7–43 KB no sistema real (até 76 KB no robô), 4 por chamado; preventiva ~20 KB. São ~85–90% do armazenamento e ~40–60% das gravações | Gravar menor (PNG preto e branco/paleta, WebP leve ou só os traços); meta ~8 KB. Conferir antes o PDF e a ficha |
| S9 | ✅ Lote 4 (15/10/2026; pacotes de 25 OS) — era MÉDIA | **Assinatura em lote do engenheiro/gerente: pacote de 100 OS** (`dbSignAsRole`); com assinaturas de ~100 KB o pacote passaria de 10 MiB, que é o limite do Firestore por pedido de gravação (pela documentação; não testado) | Pacotes de 25–50 OS ou assinatura menor (S8) |
| S10 | ✅ Lote 5 (15/10/2026) — era MÉDIA | **DOM ao abrir de novo repete contagens** (45 de situação + 27 de "próximo a assinar" por abertura; ~600 tempo real) | Contar uma vez por abertura e reaproveitar no Início, no menu e em Ordens de Serviço |
| S11 | ✅ Lote 5 (15/10/2026; preventivas e ativos) — era MÉDIA | **Cópia das preventivas do escritório é regravada inteira no aparelho a cada mudança** (1 s depois; ~13 MB na GMC) e, se o navegador fecha antes de gravar a 1ª carga, baixa tudo de novo (engenheiro: 5.347 leituras numa reabertura) | Gravar por partes ou com intervalo maior; marcar a 1ª carga como feita só depois de gravada |
| S12 | ✅ Lote 3 (15/10/2026; insumos como contrato, lista única por empresa) — era MÉDIA | **Lista de insumos é por gerência** (3 × 2.000 = 6.000 registros) e o técnico baixa 2.000 na 1ª vez que pede insumo; o usuário disse que "insumos serve para todas as gerências" | Lista única de insumos |
| S13 | DESCARTADO (15/10/2026, usuário: "não precisa fazer o S13"; ganho < US$ 0,10/mês) — era BAIXA | **Chamado guarda uma cópia inteira do modelo** (~metade dos 4,4 KB): cada leitura custa 2 unidades | Guardar a versão do modelo (como a preventiva, `templateVersions`) |
| S14 | ✅ Lote 6 (15/10/2026; também Material, Insumos e Almoxarifado) — era BAIXA | Solicitações: os contadores mostram "(0)" enquanto carregam (parece que não há nada) | Mostrar "…" até chegar |
| S15 | ✅ Lote 6 (15/10/2026) — era BAIXA | Celular do escritório: em Ordens de Serviço o campo "Empresa" passa da borda da tela | Quebrar a linha dos filtros no celular |
| S16 | ✅ Lote 6 (15/10/2026; mais 2 botões "X" das janelas de modelos de etiqueta) — era BAIXA | Botão de fechar (X) da ficha da preventiva sem nome para leitor de tela | `aria-label="Fechar"` |
| S17 | ✅ Lote 1 (15/10/2026) — era MÉDIA (a conferir) | **No 1º segundo do login o banco às vezes recusa o usuário** (o login ainda não ficou pronto): a leitura das permissões (`config/permissions`, 2 de 6 entradas → o app usa a lista padrão) e a gravação da sessão (`dbUpdateUserSessionId`, 2 de ~230 entradas no teste de carga). Se a sessão não grava, fica a sessão antiga no cadastro e o app pode achar que a pessoa entrou em outro aparelho e tirá-la (`App.tsx`, "Sessão deslocada") — possível, não confirmado | Fazer essas duas operações só depois do login pronto (ou tentar de novo em 1–2 s) |
| S18 | ✅ Lote 5 (15/10/2026; conferência a cada 15 min, "Atualizar" na hora) — era BAIXA | Engenheiro: cada abertura da fila confere de novo todos os links de cliente pendentes (1 leitura por link) | Conferir só ao abrir "Aguardando cliente" ou guardar a última conferência |
| S19 | ✅ Lote 2 (15/10/2026) — era BAIXA | Ordens de Serviço › Preventivas abre no filtro "A programar" mesmo com 0 (tela "Nenhuma preventiva neste filtro" com 1.358 programadas e 108 atrasadas na GMC) | Abrir no 1º contador com itens (ou em Atrasadas quando houver) |
| S20 | INFO — usuário (15/10/2026): "esse teste foi só simulação, os valores reais podem ser um pouco maior ou menor" | EMPRESA A: 4 técnicos para 1.300 preventivas/mês (~15 por dia útil cada) | Confirmar com o usuário (dado do cenário) |
| S21 | INFO — usuário (15/10/2026): "sim mais ou menos isso"; não muda o app (na simulação só decidiu quantas preventivas iam para o técnico local e quantas para os técnicos da gerência) | 75% dos ativos da principal ficam em prédios com técnico local (DOM) | Confirmar a divisão real |
| S22 | INFO — usuário (15/10/2026): "mais ou menos isso" | Vistorias da DOM: ~308/mês na interpretação usada | Confirmar com o usuário |

---

## 8. Proteção do banco contra erros, loops e abuso

| Etapa | Situação | O que é |
|---|---|---|
| 1. Orçamento e alertas | ✅ 02/10/2026 | Google Cloud → Faturamento → "Budgets & caps": orçamento **"Hexon - alerta mensal"**, R$ 30/mês, e-mail em 50%, 90%, 100% (real) e 100% (previsto). Só avisa (atraso de horas), não bloqueia. Subir o valor com o tempo. |
| 2. Disjuntor no app | ✅ 02–03/10/2026 | `src/db/guard.ts` (ver abaixo) |
| 3. Regras mais firmes | ✅ 03/10/2026 | `get` público e listagem limitada em `assets`, `addresses`, `histories`; `accessLogs` com campos e tamanhos fixos; assinatura ≤ 150 KB |
| 4. App Check | ❌ não será feito por ora | Usuário preferiu não arriscar (verificação falhando pode travar aparelhos). Risco restante: abuso externo lento (abrir 1 a 1). |
| 5. Corte automático | adiado | Desenho aprovado em princípio: orçamento → Pub/Sub → função liga o modo manutenção **uma vez por mês** (se o Super Admin desligar, não religa no mesmo mês); corte sugerido R$ 100; nunca desligar o faturamento. Aviso ao Super Admin e lista de desarmes no cartão Sistema. |

**Disjuntor (`src/db/guard.ts`)**
- Todo arquivo de `src/db` importa o Firestore de `./guard` (exceto `core.ts`, `appControl.ts` e o próprio `guard.ts`). **Arquivo novo em `src/db` deve importar de `./guard`.**
- Limites **por aparelho, por minuto**: 120 gravações (pacote = 1), 120 buscas, 40 escutas abertas, **30 mil documentos lidos do servidor** (soma das buscas + 1ª carga de cada escuta; cópia local e mudanças ao vivo não contam).
- Desarmou: para de gravar e buscar naquele aparelho, aviso vermelho "Proteção do sistema ativada" (`GuardBanner.tsx`), 1 registro em `auditLogs` (ação "Proteção do sistema"). Recarregar a página volta ao normal.
- **Operações em massa** (`runBulk`, não contam): disparo, gerador antigo, importações (ativos, materiais, efetivo, endereços), exclusão de ativos por setor, cancelamento de OS ao desativar ativos, correção de unidade, resumos do Dashboard, reverter atrasadas, excluir várias OS, 1ª carga completa (ativos e OS da gerência), meses antigos do calendário. **Função nova que grava ou lê muito de uma vez deve ser marcada com `runBulk`.**
- Riscos restantes aceitos: loop lento abaixo dos limites (centavos/dia; o alerta avisa); abuso externo lento (sem App Check).
- Conferido no código em 16/10/2026: limites `{ write: 120, read: 120, listen: 40, docs: 30000 }` por minuto. **Contagens (`getCountFromServer`) não passam pelo disjuntor** (o `guard.ts` repassa o Firestore com `export *` e só embrulha gravação, busca, escuta e `getDocsFromServer`); a 1ª carga das preventivas (`getDocsFromServer`, S4) conta.

---

## 9. Índices do banco (68 em 15/10/2026: + `supplyRequests | unit + company + suppliedAt` (esparso) e `supplyBalances | company` do Lote 3, criados pelo usuário ("criei os índices"; sem print conferido); 66 em 13/10/2026: + `absences | unit + to` da Fase 7B, conferido pelos prints (os 66 batem com a lista); 65 em 12/10/2026: + `usualTeams | unit` da Fase 7A, conferido pelo print; 64 em 12/10/2026, todos conferidos pelos prints nesse dia; 62 em 10/10/2026: 58 conferidos pelos prints em 09/10/2026 + `cliSigned`, 2 de `nextSigner` e `unit + updatedAt`)

Lista completa como está no Console (escopo **Coleta**, salvo onde diz "Grupo de coleção"). ↓ = decrescente; sem seta = crescente.

| Coleção | Campos | Esparso |
|---|---|---|
| accessLogs | timestamp ↓ | — |
| addresses | syncAt | ✓ |
| assetDeletions | syncAt | — |
| assets | code | — |
| assets | specs.PATRIMONIO | — |
| assets | syncAt | — |
| auditLogs | timestamp ↓ | — |
| dispatchIndex | startDate | — |
| histories | assetId + date ↓ | — |
| materialRequests | mrPend | ✓ |
| materialRequests | techMr | ✓ |
| materialRequests | unit + status + createdAt ↓ | — |
| materialRequests | unit + company + status + createdAt ↓ | — |
| materials | unit | — |
| materials | unit + company | — |
| materials | unit + syncAt | ✓ |
| materials | unit + company + syncAt | ✓ |
| orderDeletions | syncAt | — |
| usualTeams | unit | — (Fase 7A) |
| absences | unit + to | — (Fase 7B) |
| planningLots | unit + periodStart | — |
| serviceOrders | unitOpen | ✓ |
| serviceOrders | plannedEnd | ✓ |
| serviceOrders | techOpen | ✓ |
| serviceOrders | closedMonth | ✓ |
| serviceOrders | techSol | ✓ |
| serviceOrders | addressId + addrEnd ↓ | ✓ |
| serviceOrders | endDate | — |
| serviceOrders | assignedTechnicianMatricula | ✓ |
| serviceOrders | unit + syncAt | — |
| serviceOrders | assetId | — |
| serviceOrders | openEnd | ✓ |
| serviceOrders | solicitationStatus + solAt ↓ | ✓ |
| supplies | unit | — |
| supplies | unit + company | — |
| supplies | unit + syncAt | ✓ |
| supplies | unit + company + syncAt | ✓ |
| supplyRequests | techSr | ✓ |
| supplyRequests | srConf | ✓ |
| supplyRequests | srStore | ✓ |
| supplyRequests | unit + status + createdAt ↓ | — |
| supplyRequests | unit + company + status + createdAt ↓ | — |
| supplyRequests | unit + company + suppliedAt | ✓ (Lote 3) |
| supplyBalances | company | — (Lote 3) |
| syncDeletions | coll + unit + syncAt | — |
| templates | syncAt | ✓ |
| users | gerencia | — |
| users | gerencia + syncAt | ✓ |
| workforce | unit | — |
| workforce | unit + syncAt | ✓ |
| workOrders | unit + createdAt ↓ | — |
| workOrders | unit + status + createdAt ↓ | — |
| workOrders | unit + status + deadline | ✓ |
| workOrders | unit + status + closedAt ↓ | ✓ |
| workOrders | unit + assignedTechnicianMatricula + createdAt ↓ | ✓ |
| workOrders | unit + glpi | ✓ |
| workOrders | unit + company + createdAt ↓ | — |
| workOrders | unit + company + status + createdAt ↓ | — |
| workOrders | unit + company + status + deadline | ✓ |
| workOrders | unit + company + status + closedAt ↓ | ✓ |
| workOrders | techOpen (Grupo de coleção) | ✓ |
| workOrders | signQueue (Grupo de coleção) | ✓ |
| workOrders | cliSigned | ✓ |
| workOrders | unit + nextSigner + createdAt ↓ | ✓ |
| workOrders | unit + company + nextSigner + createdAt ↓ | ✓ |
| workOrders | unit + updatedAt | — |
| notices | units (matriz: contém) + until | — |
| notices | until | — |

Índices novos: **escopo = Coleção ("Coleta")** e **índice único desmarcado** (único proibiria duas OS com os mesmos valores). `workOrders` techOpen e signQueue são antigos, estão como "Grupo de coleção" e funcionam — deixados assim.

Apagados em 01/10/2026: `status`, `status+endDate`, `status+scheduledDate`, `unit+assignedTechnicianMatricula+status`, `unit+assignedTechnicianMatricula+solicitationStatus`, `solicitationStatus+updatedAt`, `addressId+endDate`. A considerar no futuro: apagar `histories: assetId` se nada mais usar.

---

## 10. Mapa técnico (onde fica cada coisa no código)

| Arquivo | Papel |
|---|---|
| `src/db/guard.ts` | Disjuntor (seção 8) |
| `src/db/orderControl.ts` | Campos de controle da OS (`withOrderControl`, `orderControlUpdate`) |
| `src/db/orderSync.ts` | Cópia local das OS por gerência (IndexedDB + escuta por `syncAt`); meses antigos sob demanda |
| `src/db/assetSync.ts` | Cópia local dos ativos |
| `src/db/serviceOrders.ts` | Gravar OS, escutas do técnico (`techOpen`) e solicitações (`techSol`), prazos de planejamento em tempo real, correção de unidade |
| `src/db/checklistVersions.ts` | Versões congeladas e montagem do checklist (`hydrateOrders`) |
| `src/db/orderStarts.ts` | Iniciar/desfazer/concluir (offline) |
| `src/db/dispatch.ts`, `dispatchIndex.ts` | Disparo das OS |
| `src/db/historyPages.ts` | Histórico em páginas de 12 |
| `src/db/teams.ts`, `src/db/weekPlans.ts`, `src/db/blocks.ts`, `src/components/programacao/*` | Programação (Fase 7): equipes = equipe habitual do responsável (`usualTeams`); semana (`weekPlans`: dias marcados, equipe da semana, acompanhar, histórico) e ausências (`absences`); blocos = lotes (`planningLots`, `source:'programacao'`; `BlockEditor` — desde o U4 com o "A programar nesta semana" dentro (abas Preventivas / Corretivas — chamados; o `ToPlanPanel` do lado da grade foi apagado) —, `blockLayout`); `ProgramacaoView` (Semana/Equipes), `TeamsView`, `TeamForm`, `WeekView`, `WeekModals`, `weekDates` |
| `src/db/appControl.ts` | Forçar atualização e manutenção (fora do disjuntor de propósito) |
| `src/db/branding.ts`, `src/components/BrandLogo.tsx`, `src/components/users/BrandingCard.tsx` | Logo do sistema (identidade visual) |
| `src/db/manHours.ts` | Tempo, homem-hora e custo da OS |
| `src/db/solicitations.ts` | Decisões das solicitações de corretiva; U10: decidido o último item grava `solNotice` (aviso ao técnico); `dbAckSolicitation` = "Ciente" do técnico; a correção do GLPI/justificativa não avisa de novo depois do Ciente |
| `src/components/GuardBanner.tsx`, `AppUpdateBanner.tsx`, `MaintenanceScreen.tsx` | Avisos globais |
| `src/components/orders/preventives/PreventivesBoard.tsx`, `ProgramPreventivesModal.tsx` | Ordens de Serviço › Preventivas (Fase 7E-1): contadores, lista por local, programar pela lista (= bloco da Programação), Programadas/Atrasadas (o calendário do PMOC, `PlanningBoard`, saiu) |
| `src/components/mobile/TechnicianMobileView.tsx` | App do técnico |
| `src/components/assets/HistoryPager.tsx` | Paginação do histórico |
| `cloud-functions/functions/index.js` | `resetUserPassword` (chamada, só Super Admin), `dailyDeadlines` (00:00, Brasília), `monthlyClosing` (00:10 do dia 1º) |
| `firestore.rules` | Regras (publicar no Console) |
| `src/components/HomeView.tsx`, `src/components/home/*`, `src/db/homeCounts.ts`, `src/lib/homeLinks.ts` | Início (resumo por perfil) e atalhos que abrem telas já filtradas |
| `public/manifest.webmanifest`, `public/icons/*`, `src/lib/installApp.ts`, `src/components/InstallAppButton.tsx` | App instalável (PWA): manifesto, ícones (chegam ao `main` por PR, não pelo AI Studio) e botão "Instalar aplicativo" |
| `src/lib/fileDelivery.ts`, `src/components/PdfReadySheet.tsx` | Entrega de PDF/planilha/ZIP: no celular, aviso "PDF pronto" + compartilhar (P39); no computador, baixa |
| `src/main.tsx` | Recarrega ao voltar depois de `pagehide` (P39); clique abre o calendário dos campos de data; monta o `PdfReadySheet` |
| `src/db/localSync.ts` | Cadastros guardados no aparelho (materiais, insumos, efetivo, usuários, modelos, endereços) com atualização em tempo real |
| `src/db/workOrders.ts` | Chamados GLPI: criar, atribuir, executar, Pendente, Acompanhamento (`dbAddWorkOrderNote`), escuta do técnico (`subscribeMyWorkOrders`) |
| `src/db/workOrderList.ts` | Lista do computador: filtros, cards (`dbGetOsCounters`), escuta de mudanças (`subscribeWorkOrderChanges`), `osMatchesMode` |
| `src/db/workOrderSign.ts` | Assinaturas em ordem, `osStatusLabel`, link do cliente, "Assinadas pelo cliente" (`subscribeClientSignedOrders`) |
| `src/db/workOrderCost.ts`, `overtime.ts`, `companies.ts` | Custo/homem-hora dos chamados, regras de hora extra, empresas |
| `src/db/materialRequests.ts`, `supplies.ts`, `supplyRequests.ts`, `warehouses.ts` | Pedidos de material (PM-), insumos e pedidos de insumo (PI-), almoxarifados |
| `src/lib/osPdf.ts`, `osXlsx.ts`, `preventivePdf.ts` | PDF mapeado/padrão e ficha XLSX dos chamados; PDF padrão da preventiva |
| `src/components/os/*` | Emitir OS, modelos de OS, lista (`WorkOrdersList`), ficha (`WorkOrderSheet`), execução no celular (`OsExecutionForm`), assinatura (`OsSignaturePad`) |
| `src/components/mobile/TechnicianOsTab.tsx` | Aba "Minhas OS" do celular (Em aberto, Pendentes, Contestadas, Assinadas pelo cliente); U14: cartão `OsCard` (faixa pela situação, GLPI grande, situação curta, endereço + comarca, prazo e dia) |
| `src/utils/orderNumber.ts` | Número curto da preventiva (`formatOrderNumber`); U12: `preventiveRequestLabel` = rótulo da preventiva na escolha da OS dos pedidos de material/insumos ("Preventiva Mensal · Patrimônio 004512 · 10/26") |
| `src/lib/osRef.ts`, `src/components/os/OsRef.tsx` | U4: GLPI em destaque — `osRefText` ("GLPI 123 · OS-…", sem GLPI só o número) para títulos, avisos, e-mails, PDF e planilha; `osCategory` (resposta da pergunta "Categoria" da etapa Criação; desde o U6 prefere a pergunta "Lista por gerência" chamada Categoria); `OsRef` = GLPI grande + Nº da OS pequeno (tabelas, cartões, fichas) |
| `src/components/CloseX.tsx` | U4: o "X" no canto de cima das janelas (nome "Fechar"; faz o mesmo que o Cancelar da janela e fica travado enquanto grava) |
| `src/components/os/UnitListEditor.tsx` | U6: editor das opções de cada gerência da pergunta "Lista por gerência" (Modelo de OS); `unitListOptions` (em `OsFieldInput.tsx`) dá a lista da gerência da OS na emissão |
| `src/components/os/OsTeamPicker.tsx`, `src/components/orders/execution/ExecutionExtras.tsx` | Equipe da OS e participantes da preventiva — U5: o técnico (responsável) não entra sozinho; atalho "Você" para ele se marcar; concluir exige 1 pessoa |
| `src/db/notices.ts`, `src/lib/noticeSeen.ts`, `src/components/notices/*` | Quadro de Avisos (9A): escuta só dos avisos que valem, foto e PDF à parte, ciente, "novos" e urgentes por aparelho |
| `src/db/glpiPanel.ts`, `src/components/GlpiPanelView.tsx` | Histórico GLPI (9B): painel HTML em pedaços compactados, mostrado em moldura isolada |
| `src/db/weekPublish.ts`, `src/lib/weekPdf.ts` | Programação › Publicar (7D): PDF da semana no formato PSS e aviso no Quadro (revisões) |
| `src/db/homeTeam.ts` | Início › Equipe agora (chamados em andamento/pendentes por técnico, em tempo real) |
| `src/db/companyInactivation.ts`, `src/db/companyMoves.ts` | Inativar empresa (A5-B: contagem, usuários e efetivo inativos) e levar as OS em aberto quando o ativo/endereço recebe empresa nova |
| `src/db/resetDatabase.ts`, `src/lib/resetLocal.ts` | Zerar o banco (A2): chamada da função e limpeza da cópia nos aparelhos na abertura seguinte |
| `src/lib/localTech.ts` | Técnico local (Lote 2): DOM + comarca, listas e atribuição |
| `src/lib/signatureImage.ts` | Assinatura leve (Lote 4): PNG de paleta 2 bits (OS 720×270 e preventiva) |
| `src/db/materials.ts`, `src/db/workforce.ts` | Materiais (por gerência + empresa, saldo por almoxarifado — A7) e efetivo/cargos |
| `src/db/planning.ts`, `src/db/cycle.ts`, `src/db/templates.ts`, `src/db/preventiveEngine.ts` | Lotes de agendamento e pernoite, ciclo por gerência, modelos de preventiva (cópia no aparelho) e geração das preventivas |
| `src/db/executionDraft.ts`, `src/db/executionTeam.ts` | Execução: rascunho no aparelho até a assinatura; participantes, equipe habitual e linha do tempo |
| `src/db/permissions.ts`, `src/db/profiles.ts`, `src/db/users.ts`, `src/db/organization.ts` | Catálogo de permissões, perfis de acesso, usuários (sem senha no aparelho) e gerências |
| `src/db/addresses.ts`, `src/db/assets.ts`, `src/db/assetSpend.ts` | Endereços, ativos e gasto do ativo (só com "Ver valores em R$") |
| `src/db/monthlySummaries.ts`, `src/db/audit.ts` | Resumos mensais (gravados pela nuvem no dia 1º) e registros de acesso/auditoria |
| `src/utils/idbCache.ts`, `src/utils/useSyncVersion.ts`, `src/utils/loadTimes.ts` | Guarda no aparelho (IndexedDB), aviso de lista guardada que mudou e tempo de carregamento (diagnóstico) |
| `src/types.ts` | Tipos do app inteiro (inclui `LiveState` do Lote 6) |
| `cloud-functions/functions/index.js` | Além das 3 acima: `resetDatabase` (zerar o banco, A2; onCall, só Super Admin) |

---

## 11. Hexon 2.0 — fases antigas (movido para `docs/historico/hexon2-fases.md`)

O levantamento e o histórico da junção com o Hexon principal estão em **`docs/historico/hexon2-fases.md`** (texto original, mesma numeração): ideia do usuário e o que o principal tem (prints), direção decidida (ler o código do principal, não copiar o banco; o que **não** reproduzir por segurança), visão do usuário para a estrutura e o plano de 12 fases, Fases 1–6 e 8 (8A–8C e as 7 rodadas de ajustes), etapas especiais (Empresas E1–E5, Identidade visual 2.0) e as regras dadas pelo usuário para a execução das OS (assinaturas em ordem, homem-hora, troca de técnico).
**Ler antes de:** **8D** (hora extra e pernoite feitas pelo planejador — itens "8D" do histórico), **Relatórios**, **Ponto e Contratos** e qualquer etapa de junção (com `docs/levantamento-hexon-principal.md`).

## 12. Diário das entregas (movido para `docs/historico/diario.md`)

O diário está em **`docs/historico/diario.md`** (texto original, mesma numeração): pedidos e respostas do usuário (entre aspas), desenhos, decisões, testes, commits e envios ao `main` — lista A1–A8 da verificação geral (detalhes de **A1** e **A3**, abertas), Lotes 1–6, PWA, Início, Fase 7, Fase 9 e, na **12.2**, o detalhe de cada item da **LISTA U** (pedido, levantamento, decisões, testes). **Ao terminar uma entrega, o detalhe vai para lá**; aqui ficam só a linha da LISTA U (0.1) e o que mudou nas seções 1–10.

### 12.1 Ferramentas de teste (como refazer o ambiente numa sessão nova)

Os roteiros ficam no **rascunho da sessão** (pasta temporária do Claude) e **se perdem quando a sessão acaba** (em 16/10/2026: 198 roteiros de teste/dados e 44 scripts, ~2,7 MB, fora do repositório). Para refazer:
- **App de teste:** cópia do projeto numa pasta à parte (`app/`), com `src/firebase-applet-config.json` apontando para o projeto `demo-hexon` e `src/db/core.ts` ligando os emuladores (`connectFirestoreEmulator` 127.0.0.1:8080, `connectAuthEmulator` 9099, funções 5001). `firebase.json` com emuladores firestore 8080, auth 9099, `singleProjectMode`, regras = `firestore.rules` do ramo. Vite na porta 5173.
- **Trocar o código do app de teste:** copiar o `src` do ramo (ou de um commit, por `git archive`) e **reiniciar o Vite** — a troca a quente depois de apagar e recriar `src` não é confiável (falha de 15/10/2026: comparações com o `main` serviram o código do ramo). Conferir o arquivo servido (`curl http://127.0.0.1:5173/src/...`).
- **Ferramentas:** `node` com `firebase-admin`, `firebase-tools` e `playwright-core`; Chromium já instalado no ambiente (`/opt/pw-browsers`; não rodar `playwright install`).
- **Usuários de teste** (senha `123456`, e-mail `<matrícula>@hexon.corp` no emulador de login): `1-0000` Super Admin; `2-0001` Encarregado DOM; `2-0002` Encarregado GMMR; `3-0001`/`3-0002` técnicos DOM; `4-0001`/`4-0002` administrativo/encarregado DOM (dados das OS); `5-0001`/`5-0002` engenheiro/gerente DOM (dados da assinatura 5B — sem eles a fila de assinaturas não abre). Empresas `mprj` e outras de cada roteiro.
- **Medidores só no app de teste** (nunca no projeto): contar contagens, leituras e gravações no aparelho (Lote 5) e simular atraso/falha de contagens e escutas (Lote 6).
- **Cuidados que já enganaram:** dados de teste sobrando de um roteiro mudam os números de outro (ex.: material `CAB-10`, ativos e comarcas a mais) — antes de dizer que uma falha "já existia", rodar com o banco limpo nos dois códigos; testes antigos ficam desatualizados quando a tela muda de propósito (ex.: "para confirmar" → "para aprovar" no Lote 3); o modo de desenvolvimento do React monta as telas 2 vezes; depois de trocar as regras no emulador, `touch` no arquivo.
- **Testes antigos que falham igual no código de antes do Lote 3 e no atual (16/10/2026, banco limpo):** `t_home_team` (4 itens), `t_5b`/`t_5b2`/`t_5b3`/`t_5b_8d` (param no meio) e 3 itens do `t_home` (topo, planejador) — desatualizados, não são defeito.
