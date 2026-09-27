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
| 2 | Efetivo | Base de pessoas (com e sem login), importação por planilha, cargo, vínculo usuário↔pessoa e valor da hora (a tela já feita, adaptada). |
| 3 | Materiais | Base de materiais com importação. |
| 4 | Modelos e disparo | Periodicidades novas, materiais previstos no modelo, validação datas × periodicidade, duplicidade revisada e disparo por unidade. |
| 5 | Planejamento | Pernoite; técnico gravado pelo código, não pelo nome. |
| 6 | Execução | Visualizar ≠ Iniciar; início e conclusão com hora do servidor; equipe habitual; participantes; materiais usados; bloqueio após assinatura; linha do tempo da OS; concluída sai da lista. |
| 7 | Homem-hora | Cálculo automático e congelado na OS no momento da conclusão. |
| 8 | Solicitações | "Abrir corretiva" / "Não abrir", com registro de quem decidiu e quando. |
| 9 | Relatórios | Indicadores de tempo, homem-hora, materiais, pernoite e produtividade, com exportação para Excel e PDF. |
| 10 | Prazos e horários | Rotina à 00:00, fechamento à 00:30 do dia 1º e trava de conclusão fora do prazo. |

---

## 5. Perguntas em aberto

Respostas registradas aqui assim que decididas.

1. **Periodicidades:** hoje existem **Quinzenal** e **Anual**, inclusive nas periodicidades dos ativos importados. Elas saem, ou ficam junto com Diária, Semanal, Mensal, Trimestral e Semestral?
2. **Perfis atuais:** posso converter automaticamente Administrador → Planejador e Profissional → Técnico?
3. **Visão por unidade:** algum perfil futuro vai precisar ver **mais de uma unidade** (ex.: um diretor da DOM vendo as 3 gerências)? Se sim, a permissão de perfil terá "unidade própria" ou "todas as unidades".
4. **Horas do efetivo:** para o homem-hora basta **horas** (tempo × pessoas), ou também **custo em R$**? Se tiver custo, o valor da hora vale para **todos do efetivo** (técnico, mecânico, meio oficial) ou só para os técnicos?
5. **Participação:** todos os participantes contam o **tempo inteiro** da OS, ou o técnico informa quanto tempo cada um participou?
6. **Materiais:** quais colunas tem a planilha (código, descrição, unidade...)? O técnico informa só a quantidade usada? Material tem custo?
7. **Pernoite:** é só "sim/não" por OS, ou precisa da **quantidade de noites**?
8. **Pausa:** se o técnico iniciar e precisar parar (fim do expediente, falta de peça), existe **pausar/retomar**? Ou o tempo conta direto do início até a conclusão?
9. **Concluídas do técnico:** somem totalmente do app dele, ou fica uma aba "Histórico" só para consulta?
10. **Corretiva:** ao escolher "Abrir corretiva", precisa registrar o **número da corretiva** do outro sistema?
11. **Replanejamento:** o planejador pode trocar a data ou o técnico enquanto a OS **não foi iniciada**? E depois de iniciada?
12. **Alterações administrativas:** depois de concluída, o Super Admin pode corrigir algo (ex.: material lançado errado)? Se sim, fica registrado na linha do tempo.
