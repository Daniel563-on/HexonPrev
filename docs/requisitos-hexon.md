# Hexon Preventiva — Requisitos, análise e plano

> Documento vivo. Guarda o que o sistema precisa ter, o que já existe, o que muda e a ordem das etapas.
> Se o contexto da conversa se perder, este arquivo é a referência.
> Última atualização: 27/09/2026.

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

## 2. Comparação com o sistema atual

Legenda: ✅ já existe · 🟡 existe, mas precisa ajustar · 🔴 não existe

| Item | Situação | Observação |
|---|---|---|
| Unidades DOM, GMMR, GMEE e GMC | 🟡 | Existe cadastro de gerências, mas a relação com o "setor" das OS é feita por nomes antigos (HVAC, Elétrica...). É preciso padronizar pelos 4 códigos. |
| Visão por unidade | 🟡 | Aplicada em várias telas, mas não em todas, e **não nas regras do banco**. Hoje um usuário poderia ler dados de outra unidade por fora da tela. |
| Perfis fixos (Super Admin / Administrador / Profissional) | 🟡 | Os três existem com outros nomes (Administrador = Planejador, Profissional = Técnico). |
| Criar novos perfis com permissões | 🔴 | Hoje só existem os 3 perfis fixos, e as regras do banco usam esses nomes. |
| Matriz de permissões | 🟡 | Existe (abas e ações), mas só para os 3 perfis e sem "unidade que pode ver". |
| Usuários e senhas | ✅ | Criar, alterar, inativar e redefinir senha. |
| Base de ativos com importação | ✅ | Cópia local sincronizada, importação que grava só o que mudou, baixa automática. |
| Base de materiais | 🔴 | Não existe. |
| Base de efetivo (pessoas sem login) | 🔴 | Hoje só existem usuários com login. |
| Cargo e valor da hora | 🟡 | O cargo é texto livre no usuário. A tela de custo homem-hora foi feita, mas **não foi aplicada**, e será refeita sobre o efetivo. |
| Modelos com checklist | ✅ | Existe, com versões e histórico de alterações. |
| Materiais previstos no modelo | 🔴 | |
| Periodicidades | 🟡 | Hoje: Semanal, Quinzenal, Mensal, Trimestral, Semestral e Anual. Falta Diária; ver pergunta 1. |
| Disparo por período com data de início e fim | ✅ | Existe (motor de preventivas + tela de disparo). |
| Validação de datas × periodicidade | 🟡 | Parcial, precisa reforçar. |
| Duplicidade | ✅ / 🟡 | Número da OS fixo (ativo + modelo + período) e registro de disparos. Revisar para cobrir todas as combinações da regra 10. |
| Direcionar o lote para a unidade | 🟡 | Hoje vai pelo tipo do ativo e pelo setor; padronizar por unidade. |
| Calendário de planejamento | ✅ | Com períodos, atrasadas, reversão em lote e bloqueio de datas passadas. |
| Pernoite | 🔴 | |
| Técnico vê só as dele | ✅ | Por nome do técnico atribuído. O ideal é passar a usar o código do usuário, não o nome. |
| **Visualizar ≠ Iniciar** | 🔴 | **Hoje, abrir a OS já a coloca em "Em Execução"**, e o horário de início não é gravado. |
| Horário de início e de conclusão automáticos | 🔴 / 🟡 | Só a hora da assinatura é gravada, e com o relógio do aparelho. |
| Equipe habitual do técnico | 🔴 | |
| Participantes da OS | 🔴 | |
| Materiais usados na OS | 🔴 | |
| Homem-hora automático | 🔴 | |
| Bloqueio após assinatura | 🟡 | A tela bloqueia, mas **o banco ainda aceitaria a alteração**. |
| Concluída sai da lista do técnico | 🟡 | Hoje existe um contador ou aba de concluídas no app do técnico; ver pergunta 9. |
| Não Executada automática | ✅ | Rotina diária no servidor e no app. Os horários serão revistos (00:00 / 00:30). |
| Solicitações de corretiva | ✅ / 🟡 | Existe o painel (Pendente, Resolvido, Cancelado). Ajustar para "Abrir corretiva" / "Não abrir". |
| Histórico de eventos por OS | 🔴 / 🟡 | Existe uma trilha de auditoria geral, mas não a linha do tempo de cada OS. |
| Relatórios e Dashboard | 🟡 | Existem, com fechamento mensal. Faltam homem-hora, tempo, materiais, pernoite e produtividade. |
| Exportação para Excel | 🟡 | Existe em algumas telas (Ativos, Consulta de OS). |
| DOM: rondas por endereço | ✅ | Endereços como "Imóvel", ficha e QR público. |

---

## 3. Como os dados vão ficar gravados

Explicado sem termos técnicos: cada item abaixo é uma "gaveta" no banco.

| Gaveta | Situação | Para que serve |
|---|---|---|
| `units` / `managements` | ajustar | As 4 unidades com código fixo (DOM, GMMR, GMEE, GMC). |
| `profiles` | nova | Perfis criados pelo Super Administrador, cada um com suas permissões e a unidade que pode ver. |
| `users` | ajustar | Login. Passa a apontar para um **perfil** e para uma **pessoa do efetivo**. |
| `workforce` (efetivo) | nova | Todas as pessoas, com nome, matrícula, cargo, unidade, ativo/inativo e se tem login. |
| `laborRates` | nova, reaproveitada | Valor da hora e adicional de sábado de cada pessoa, com histórico. Só o Super Administrador lê. |
| `materials` | nova | Base de materiais (código, descrição, unidade de medida). |
| `technicianTeams` | nova | Equipe habitual de cada técnico. |
| `templates` | ajustar | Materiais previstos e periodicidades novas. |
| `serviceOrders` | ajustar | Novos campos: unidade, pernoite, `startedAt` e `completedAt` (hora do servidor), duração, participantes, materiais usados, homem-hora calculado e bloqueio. |
| `serviceOrders/{id}/events` | nova | Linha do tempo da OS (quem fez o quê e quando). |
| `monthlySummaries` | ajustar | Passa a guardar também homem-hora, tempo, materiais e pernoites. |

**Proteções no banco (não só na tela)**
- Cada usuário só lê e grava dados da própria unidade.
- Uma OS concluída e assinada não pode mais ser alterada pelo técnico.
- O início e a conclusão usam o **horário do servidor**, para o relógio do celular não influenciar.
- Valores de hora só o Super Administrador lê.

---

## 4. Plano em etapas (cada uma só começa com aprovação)

A ordem segue as dependências: primeiro quem é quem, depois as bases, depois o fluxo da OS, por fim os números.

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

## 5. Decisões tomadas (27/09/2026)

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

## 6. Perguntas em aberto

(nenhuma no momento)
