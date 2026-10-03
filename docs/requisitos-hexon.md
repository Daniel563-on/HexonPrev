# Hexon Preventiva — Requisitos, análise e plano

> Documento vivo. Guarda o que o sistema precisa ter, o que já existe, o que muda e a ordem das etapas.
> **Se o contexto da conversa se perder, este arquivo é a referência.** Consultar antes de mexer em qualquer parte e atualizar ao fim de cada entrega.
> Última atualização: 03/10/2026.

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

**Como trabalhamos (fluxo de cada entrega)**
1. Conversar e **desenhar antes de programar**; o usuário aprova. Nada inventado: o que não foi confirmado é dito como "não sei / não confirmei".
2. Claude programa no ramo `claude/...`, roda `npx tsc --noEmit` e `npm run build`, faz commit e push.
3. Claude entrega **trechos** (.md, até ~10–15 KB por arquivo; pares "Trocar / Por" ou arquivo inteiro) e **confere aplicando os trechos sobre o `main`** antes de enviar.
4. O usuário aplica no **Google AI Studio** e faz commit no `main`. Claude confere com `git fetch origin main && git diff --stat -w origin/main -- src firestore.rules`.
   - Diferenças antigas e inofensivas (ignorar): linhas em branco em `NewModelModal.tsx`, `JobRolesPanel.tsx`, `core.ts`; 1 comentário em `serviceOrders.ts`; `export * from './orderControl'` no `firebase.ts` do `main`; 2 linhas de comentário no `App.tsx`. O `firestore.rules` do `main` fica desatualizado: **vale o que está publicado no Console**.
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
9. Testes: o usuário testa no site ou no preview com Super Admin, planejador (Carlos Miguel) e técnico. Medições de custo pelo Console → Uso ("Últimos 60 minutos", passando o mouse no minuto) e Query Insights.

**Preferências do usuário:** respostas diretas e sem invenção; pedir instrução antes de decidir; sem janelas `alert/confirm` do navegador em telas novas (mensagens na própria tela); o banco será **zerado antes da produção** (ficam só os Super Admins).

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

## 2. Situação atual (03/10/2026)

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
| Planejamento (lotes, pernoite, calendário) | ✅ | Etapa 5. Prazo de planejamento do Super Admin em tempo real (decisão 41). |
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
| `users`, `authIndex`, `profiles`, `config`, `managements`, `units` | Cadastro, vínculo do login, perfis, permissões, gerências | Ver regras |
| `monthlySummaries` | Resumos do mês (gravados pela nuvem) | Equipe lê |
| `accessLogs` | Registro de acesso (inclui login com falha, feito antes de entrar) | Qualquer login grava, **só os campos do registro e textos curtos**; Super Admin lê |
| `auditLogs` | Auditoria (inclui "Proteção do sistema" do disjuntor) | Equipe grava; Super Admin lê |
| `appControl/status` | Forçar atualização e modo manutenção | Leitura pública; Super Admin grava |

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
41. **Prazo de planejamento em tempo real (02/10/2026):** a tela de Preventivas escuta `planningDeadlines` (1 leitura por gerência ao abrir + 1 por mudança). Antes a cópia do navegador nunca atualizava (o planejador via o prazo antigo). A contagem regressiva é recalculada na tela a cada minuto, sem ler o banco.
42. **Calendário vazio na 1ª entrada (01/10/2026):** a escuta das OS agora recomeça quando o login do Firebase fica pronto (`currentUser?.uid` nas dependências em `App.tsx`).
43. **Preventivas mais leve (02/10/2026):** a comarca vem da própria OS (gravada no disparo); ativo procurado por código (mapa), não percorrendo a lista; listas e filtros recalculados só quando as OS ou filtros mudam.
44. **Técnico sem OS antigas (03/10/2026):** a lista do técnico vem só da escuta em tempo real; a cópia antiga do navegador (`hexon_service_orders`), que aparecia quando a lista ficava vazia e travava a tela (OS no formato antigo), não é mais usada e é apagada do aparelho.
45. **Histórico paginado (03/10/2026):** histórico do ativo/endereço em páginas de 12 (busca 13 para saber se há próxima), do mais recente para o mais antigo, dentro do sistema e no QR público (`src/db/historyPages.ts`, `src/components/assets/HistoryPager.tsx`). Índice `histories`: `assetId ↑ + date ↓`.
46. **Assinatura medida (03/10/2026, quadro 400×160, traço 2,5 px, PNG):** curta ~7 KB, normal ~13 KB, longa ~43 KB, rabisco máximo ~124 KB. Limite nas regras: **150 KB** (nunca recusa assinatura real).
47. **Regras de prazo mantidas (02/10/2026):** prazo do planejador expirado = planejador bloqueado (Super Admin nunca); OS não planejada fica "Aguardando" até o fim do período e então vira Não Executada; planejada não feita no dia vira Atrasada (técnico ainda executa até o fim do período). Sem registro de pedido/autorização para mudar o prazo.
48. **Custo estimado em produção (02/10/2026):** 2 Super Admins, 6–9 planejadores, 180–200 técnicos, 10 mil ativos, ~1.000 materiais, 9.500 OS no disparo mensal, 500 rondas diárias (dias úteis) e 250 semanais (~21.600 OS/mês). Estimativa: **~US$ 0,50 a 2 por mês no 1º ano** (cresce com o armazenamento: ~0,2–0,4 GB/mês). Hosting, Functions e Scheduler não medidos (devem ficar no grátis).

### Pendências (atualizado 03/10/2026)
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
| P14 | Botão OK do prazo de planejamento usa `alert()` do navegador | aberto | Trocar por mensagem na tela |
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

## 6. Perguntas em aberto

Hexon 2.0 (seção 11), feitas em 03/10/2026:
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

---

## 9. Índices do banco (25, conferidos em 03/10/2026)

| Coleção | Campos | Esparso |
|---|---|---|
| assetDeletions | syncAt | — |
| assets | code | — |
| assets | specs.PATRIMONIO | — |
| assets | syncAt | — |
| dispatchIndex | startDate | — |
| histories | assetId ↑ + date ↓ | — |
| orderDeletions | syncAt | — |
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
| auditLogs | timestamp ↓ | — |
| accessLogs | timestamp ↓ | — |
| materials | unit | — |
| workforce | unit | — |
| users | gerencia | — |
| planningLots | unit + periodStart | — |

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
| `src/db/appControl.ts` | Forçar atualização e manutenção (fora do disjuntor de propósito) |
| `src/db/manHours.ts` | Tempo, homem-hora e custo da OS |
| `src/db/solicitations.ts` | Decisões das solicitações de corretiva |
| `src/components/GuardBanner.tsx`, `AppUpdateBanner.tsx`, `MaintenanceScreen.tsx` | Avisos globais |
| `src/components/orders/planning/PlanningBoard.tsx` | Calendário do planejador |
| `src/components/mobile/TechnicianMobileView.tsx` | App do técnico |
| `src/components/assets/HistoryPager.tsx` | Paginação do histórico |
| `cloud-functions/functions/index.js` | `resetUserPassword` (chamada, só Super Admin), `dailyDeadlines` (00:00, Brasília), `monthlyClosing` (00:10 do dia 1º) |
| `firestore.rules` | Regras (publicar no Console) |

---

## 11. Hexon 2.0 — unificar com o Hexon principal (levantamento iniciado em 03/10/2026)

**Ideia do usuário:** transformar este sistema no "Hexon 2.0", substituindo o Hexon principal (hexon.app.br, outro banco e outro domínio), com tudo num lugar só. O que foi feito até agora (preventivas) vira o módulo **"Preventivas"** (no sistema antigo se chama "PMOC"). Os conceitos continuam os mesmos: gerência (cada um só vê a sua), homem-hora, pernoite, hora extra, permissões. A tela de login continua; sai o nome "Preventiva" e entra o logo novo da Hexon. Usuários, Gestão de Ativos e Materiais iriam "para a frente" (fora do módulo de preventivas). Trabalho por etapas, como até agora, com o usuário explicando página por página.

**O que o Hexon principal tem (prints de 02/10/2026)**
- **Menu:** Dashboard, Bater Ponto, Registros de ponto, Ordens de Serviço (Ver Ordens, Novo Modelo, Homem-Hora), Equipes, Programação Semanal, Solicitações, Gestão de Ativos, Contratos e Fornecedores, PMOC, Gestão de Materiais, Usuários, Relatórios, Histórico GLPI, Quadro de Avisos, Configurações.
- **Lista de OS:** busca; Modelos; Exportar planilha (XLSX); Baixar PDFs (ZIP); Sincronizar; Zerar cache; Emitir OS; filtro de status. Cada cartão: nº (OS-1234), local, nº GLPI, status (Nova, Em andamento...), abertura, prazo, intervenção (Preventiva, Corretiva, Layout...), categoria (ACJ, Outros...), técnico, gerência, endereço, ativo; resumo financeiro (Total, HH, Hora extra, Pernoite, Materiais); botões Ficha e Executar OS.
- **Emitir OS:** gerência responsável (privacidade), ativo opcional (busca ou código), técnico (ou em aberto), prazo limite (SLA), custo calculado; **modelo de OS** com formulário próprio (ex.: "MPRJ OS", 19 campos): intervenção, GLPI, data de abertura, requerente (nome, CRAAI, comarca, telefone, e-mail), CRAAI/comarca/endereço de execução, descrição, categoria.
- **Ficha da OS:** observações; **4 assinaturas em sequência** (Profissional → depois Cliente, Engenheiro e Gerente); materiais de consumo e miudezas; cálculo de custo e homem-hora durante a execução (equipe, início, tempo, materiais, consumíveis, total parcial); linha do tempo; botões Pendente, Cancelar OS, PDF mapeado, Ficha (XLSX).

**Perguntas em aberto (Hexon 2.0)** — ver seção 6.

**Levantamento do código do principal (03/10/2026): `docs/levantamento-hexon-principal.md`** (ler antes de qualquer trabalho no 2.0).
- Repositório privado `Daniel563-on/Hexon-principal` com o zip do código (só leitura; não alterar). ~88 mil linhas, projeto `hexon-prod`, servidor Express publicado como Cloud Function `api`.
- **Direção decidida pelo usuário:** não temos acesso ao servidor nem ao banco do principal, então **tiramos ideias e melhorias e reproduzimos no nosso sistema**, devagar e com cautela, uma etapa por vez com aprovação.
- **Não reproduzir** (segurança do principal): usuários com hash de senha legíveis sem login, OS públicas, coleções abertas, login próprio com entrada anônima e senhas padrão, SSO com chave no endereço; assinatura/PDF dentro do documento; admin lendo todas as OS.
- Partes do principal que são protótipo: ponto (GPS/IP fixos), números fixos em Equipes, MTBF por texto do título.
- Diferenças de regra a decidir: HH (principal = seg–sex 08–18 desde a atribuição; nosso = Iniciar→Concluir), hora extra 50/70/100% com sábado/domingo por cargo (não temos), estoque (principal tem; nós decidimos sem).
- Ordem proposta (aguardando aprovação): 1) aviso de nova versão + modo manutenção; 2) base da OS corretiva (emitir, nº sequencial, pausa, cancelamento, GLPI); 3) assinaturas em sequência + validação por link; 4) hora extra/feriados/custo fixo + "minha equipe"; 5) solicitações HE/pernoite com teto; 6) modelos ampliados; 7) avisos e contratos; 8) programação semanal/mapa; 9) relatórios; 10) ponto e GLPI após respostas.

