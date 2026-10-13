# Levantamento do Hexon principal (hexon.app.br) — ideias para o Hexon 2.0

Feito em 03/10/2026, lendo o código do zip enviado pelo usuário (repositório privado `Daniel563-on/Hexon-principal`). **Nada foi alterado no Hexon principal.**
Não temos acesso ao servidor nem ao banco dele. O objetivo é **tirar ideias e melhorias e reproduzir no nosso sistema** (Hexon Preventiva → Hexon 2.0), do nosso jeito: com as nossas regras do banco, índices, disjuntor e custos controlados.

Tamanho: 145 arquivos, ~88 mil linhas. Projeto Firebase `hexon-prod` (outro banco). Também foi feito no AI Studio.

---

## 1. Resumo em uma página

| Módulo do principal | O que faz | Temos hoje? | Vale trazer? |
|---|---|---|---|
| Ordens de Serviço (corretiva) | Emitir, executar, 4 assinaturas, validação por link, custos | Só preventiva/vistoria/ronda | **Sim — é o coração do 2.0** |
| Modelos de OS | Construtor de formulário com fases, condicionais, regras de status | Modelos de checklist (preventiva) | Sim, ampliar o nosso |
| PDF mapeado | PDF oficial com campos posicionados | Temos PDF mapeado | Comparar e melhorar |
| Homem-hora, hora extra, pernoite | Tarifas por cargo, HE 50/70/100, sábado/domingo/feriado | HH e pernoite (sem hora extra) | Sim (hora extra) |
| Solicitações | Hora extra, pernoite e gerais, com aprovação e teto de gastos | Só solicitações de corretiva | Sim |
| Programação Semanal | Roteiro por técnico/dia com mapa do RJ (CRAAIs e comarcas) | Planejamento de lotes | Sim (depois) |
| Equipes | "Minha equipe" do técnico para preencher a OS | Não | Sim, junto com OS |
| Ponto | Bater ponto e registros | Não | **Cuidado** (ver 3.9) |
| Ativos | Cadastro, importação, histórico, "saúde do ativo" | Temos (com QR e cópia local) | Só ideias pontuais |
| Materiais e consumíveis | Estoque com baixa automática | Materiais sem estoque | Decisão sua |
| Contratos e Fornecedores | Contratos com vigência, valor, ativo ligado | Não | Sim (simples) |
| Quadro de Avisos | Comunicados por gerência, fixados, urgência | Não | Sim (simples) |
| Histórico GLPI | Sobe um relatório HTML do GLPI para consulta | Não | Talvez |
| Relatórios e Dashboard | SLA, MTBF/MTTR, custos por gerência | Dashboard e fechamento mensal | Sim, na Etapa 9 |
| PMOC | Formulário mensal + atalho (SSO) para um PMOC externo | **É o nosso sistema** | — |

---

## 2. Avisos importantes antes de copiar qualquer coisa

### 2.1 Segurança do principal — NÃO reproduzir
1. **Lista de usuários aberta para qualquer pessoa, até sem login**, e cada usuário guarda a senha (em forma de "hash") no próprio cadastro. Quem tiver o endereço do banco consegue baixar todos os usuários e tentar descobrir as senhas.
2. **Ordens de Serviço legíveis e criáveis sem login**, e editáveis por qualquer um enquanto não estiverem fechadas.
3. Coleções totalmente abertas (ler e gravar sem login): `requests_configs`, `contracts_suppliers`, `system_control`.
4. Login próprio (senha conferida no navegador) com "entrada anônima" de reserva, e senhas padrão no código (`admin123`, `tech123`, `almoxarifado123`).
5. Atalho para o PMOC externo ("SSO") que manda os dados do usuário e uma "chave secreta" no próprio endereço da página: qualquer um pode montar esse endereço.
6. A página pública de validação lê a OS direto do banco pelo navegador, o que só funciona porque as OS estão abertas.

O nosso sistema já faz isso do jeito certo (login do Firebase, regras por perfil e gerência, assinatura limitada, página pública só com `get` de 1 documento). **Tudo o que vier do principal será refeito com as nossas regras.**
Recomendo avisar quem cuida do principal sobre os itens 1 a 3: são riscos reais hoje.

### 2.2 Partes que parecem protótipo (dados de exemplo)
- **Ponto:** a "geolocalização GPS" e o "IP" são textos fixos (sempre o mesmo ponto de São Paulo e o mesmo IP). Não há GPS de verdade.
- **Equipes (TeamsView):** números fixos na tela (ex.: "SLA médio mensal 99,2%"), regras de exemplo escritas no texto ("raio de 15 km da planta industrial") e nomes fictícios ("Carlos Souza", "Mariana Lima") que aparecem quando não há usuários.
- **Relatórios:** parte dos textos é decorativa ("Análise cognitiva", "C-Level Board"), e o MTBF liga a OS ao ativo **procurando o nome ou código do ativo no título da OS**. Quando falta o tempo, usa 2,5 h. No nosso sistema a OS tem o `assetId`, então dá para fazer isso certo.
- **Cálculo de assinaturas e equipe:** descobre "quem é engenheiro/gerente" procurando palavras no nome do campo ou do cargo ("engenheiro", "gerente", "coordenador"...). Funciona, mas é frágil. No nosso, cada assinatura terá um papel fixo.

### 2.3 Custo do banco no principal (para não repetir)
- Administrador baixa **todas as OS** da coleção de uma vez; o técnico faz 3 a 4 buscas.
- Validade da cópia das OS: 5 min de dia (06–20 h) e 6 h à noite.
- Assinaturas (imagens) gravadas **dentro da OS**, o que deixa cada OS pesada para ler e gravar.
- PDF oficial e relatório GLPI gravados em base64 no banco (documentos grandes).
- Tarifas de HH guardadas no navegador; o custo é calculado com a cópia local.

O nosso já resolve a maioria disso: cópia local com escuta incremental (`syncAt`), assinatura em coleção separada, índices esparsos e disjuntor.

---

## 3. Módulo a módulo

### 3.1 Ordens de Serviço (corretivas e outras)
**Como funciona no principal**
- **Emitir OS:** modelo (ou formulário simples), ativo (busca por código/patrimônio ou digitado), técnico responsável ou "em aberto", equipe (atalho "minha equipe da semana"), prazo (SLA) opcional, restrição por gerência e custo previsto.
- **Número sequencial:** OS-1001, OS-1002...
- **Status:** Nova → Em andamento (ao definir técnico/equipe; grava a hora) → assinatura do profissional → **Aguardando assinatura do Engenheiro** → **Aguardando assinatura do Gerente** → Fechada. Também existem **Pendente** (pausa) e Cancelada (com motivo).
- **Pendência (pausa):** motivo (ex.: "aguardando peças", "sem acesso à subestação"). O tempo pausado é descontado do homem-hora; ao retomar, registra quem retomou e quanto tempo ficou parada.
- **Cancelamento:** motivo obrigatório (ex.: "chamado duplicado no GLPI"), quem cancelou e quando.
- **Execução em 2 abas:** Criação (dados da abertura) e Execução (perguntas do técnico, materiais, consumíveis, hora extra, pernoites, anexos).
- **Assinaturas:** nome + desenho. A do cliente pode ser trocada pela **validação por link**. "Assinar em lote" e o filtro "**Necessitam minha assinatura**" (fila do engenheiro/gerente).
- **Validação por link (sem login):**
  - gera um link com protocolo (ex.: VAL-2026-X8F2A), com validade de 3/7/15/30/60 dias;
  - o solicitante abre, vê um resumo mínimo da OS e **aprova** (nome, matrícula, nota de 1 a 5) ou **contesta** (motivo);
  - grava IP, navegador e hora;
  - o link vai por e-mail (Outlook/Teams, com o PDF);
  - o token nunca é guardado puro, só o "hash";
  - a gravação passa pelo servidor, com limite de tentativas por IP;
  - os textos da página são configuráveis.
- **Número do chamado GLPI** e marca de "baixa no GLPI" (filtro "Pendente baixa no GLPI").
- **Lista:**
  - filtros por status (inclui aguardando engenheiro/gerente, pendentes, atrasadas, canceladas) e por período de abertura ou de conclusão;
  - resumo financeiro em cada cartão (HH, hora extra, pernoite, materiais, custo fixo, total);
  - selo de validado/contestado;
  - paginação.
- **Exportar:** planilha XLSX com várias abas (geral, respostas, horas, materiais, histórico) e ZIP com o PDF de cada OS. Também tem **atribuição em lote**.
- **Proteções:** aviso "a OS foi alterada por outra pessoa, atualize antes" e aviso de "gravação de assinatura ainda pendente".

**O que temos hoje:** OS preventiva, vistoria e ronda, geradas por disparo. Execução no celular com checklist, 1 assinatura, histórico do ativo, solicitação de corretiva (itens "Sim"), tempo e HH, pernoite por lote.

**Ideias para o 2.0 (a desenhar com você):**
1. **OS corretiva emitida à mão**, usando o mesmo motor de execução que já temos, com número sequencial próprio.
2. **Assinaturas em sequência configuráveis por modelo** (técnico → cliente/validação → engenheiro → gerente), cada uma com papel fixo e uma fila "precisam da minha assinatura". Assinaturas continuam em coleção separada.
3. **Pendência/pausa com motivo**, descontando o tempo do HH.
4. **Validação por link pelo solicitante**, feita por uma Cloud Function nossa (como a de redefinir senha), sem abrir a OS para o público.
5. **Campo GLPI** e controle de "baixa no GLPI".
6. **Exportação** XLSX/ZIP de PDFs (com `runBulk`).
7. **Aviso de conflito** quando duas pessoas mexem na mesma OS.

### 3.2 Modelos de OS (construtor de formulário)
**No principal:**
- **Tipos de pergunta:** texto curto/longo, número (inteiro, máscara, tamanho máximo), data/hora, lista, múltipla escolha, sim/não, assinatura (com papel), **bloco repetível**, materiais usados.
- **Cada pergunta pertence a uma fase:** **Criação** (quem abre) ou **Execução** (quem executa).
- **"Campos globais do sistema"** liga/desliga: equipe, prazo, pendência, as 4 assinaturas, materiais, HH, responsável (e permite renomear e tornar obrigatório).
- **Condicionais:** "se a resposta X for Y, mostra estas perguntas".
- **Regras de fluxo:** "se a pergunta for preenchida / assinada / tiver a opção Z → muda o status".
- **Permissão por cargo:** quem vê e quem edita cada fase.
- Duplicar, mover, pré-visualizar Criação e Execução.

**Nós:** modelos de checklist com versão (sobe a cada edição), usados no disparo.
**Ideia:** ampliar o nosso modelo com fases, condicionais, bloco repetível e papel da assinatura, mantendo o controle de **versão** que já temos (o principal não tem).

### 3.3 PDF mapeado
**No principal:**
- sobe o PDF oficial e arrasta as caixas de cada campo (página, posição, tamanho, fonte, negrito, alinhamento), com zoom;
- liga o PDF a um modelo e permite "testar com uma OS real";
- o PDF fica guardado em base64 no banco.

**Nós:** já temos PDF mapeado. **Ideia:** comparar as duas telas e trazer o que faltar ("testar com OS real", alinhamento). Guardar o PDF no Storage, e não no banco.

### 3.4 Homem-hora, hora extra, pernoite e custo da OS
**Regras do principal:**
- **HH:** conta só **segunda a sexta, 08:00–18:00**, desde a atribuição da equipe até a assinatura do técnico. O almoço não é descontado; feriados marcados na OS e pausas não contam. Menos de 1 h cobra 1 h. O resultado é multiplicado pela tarifa do cargo de **cada pessoa da equipe** e fica **congelado na OS** ao fechar (quem estava e qual cargo).
- **Hora extra:**
  - lançada por dia (data, horas, feriado) ou manual (horas 50%/70%/100%);
  - tarifa por cargo: HE 50% (ou valor × 1,5), 70% (× 1,7), 100% (× 2);
  - **sábado e domingo/feriado configuráveis por cargo** (0/50/70/100);
  - bloqueia o cálculo se alguém da equipe estiver sem tarifa.
- **Pernoite:** diárias × tarifa global (ou da OS).
- **Custo fixo** global por OS.
- **Total** = materiais + consumíveis + HH + hora extra + pernoite + custo fixo.
- Alterar tarifas exige **confirmar matrícula e senha do Super Admin** de novo.

**Nós:**
- HH por cargo **com histórico de vigência** (melhor que o deles);
- pernoite por lote (pessoas × noites ÷ OS);
- tempo pela hora do servidor, com "tempo suspeito" acima de 10 h e "horário divergente".

**Falta:** hora extra, feriados, pausa e custo fixo.
**Atenção:** a regra de HH é diferente. O principal conta o horário comercial desde a atribuição; o nosso conta do "Iniciar" ao "Concluir" de verdade. **Você precisa decidir qual vale no 2.0** (pergunta 1).

### 3.5 Solicitações (hora extra, pernoite e gerais)
**No principal:**
- **Hora Extra:** funcionário, equipe, data/hora de início e fim, motivo, justificativa, aprovação do supervisor, assinatura.
- **Pernoite:** funcionário, cidade, hotel, motivo, datas, assinatura.
- **Gerais:** categorias, urgência, materiais do almoxarifado.
- **Configurável:** formulário de cada tipo; fluxo de status (criar status como "Aguardando pagamento" e tramitar com parecer); permissão por cargo em cada etapa; numeração Nº/Ano com número inicial.
- **Beneficiários:** vários colaboradores, mais CRAAIs e comarcas atendidas.
- **Painel de custos:** total de HE e pernoite por gerência e período, com **teto de gastos (limite) e alerta**.
- PDF mapeado da solicitação.

**Nós:** só a solicitação de corretiva gerada pela preventiva.
**Ideia:** módulo "Solicitações" com hora extra e pernoite **aprovadas antes**, ligando ao custo da OS/lote, com teto de gastos por gerência. Começar com fluxo fixo e simples (Pendente → Aprovada/Negada) e deixar o fluxo configurável para depois.

### 3.6 Programação Semanal e Equipes
**No principal:**
- **Programação:** por semana, técnico e dia: equipe que acompanha, **paradas em sequência** (comarca/CRAAI) e status (rascunho/publicada/concluída). Permite copiar para outros dias, limpar a semana e exportar PDF/planilha, com **auditoria** de antes e depois.
- **Mapa do RJ:** 16 CRAAIs e 92 comarcas com coordenadas e código IBGE, editor de contornos, cores por gerência e OS ativas por comarca.
- **"Minha equipe":** cada técnico guarda os ajudantes fixos, usados para preencher a equipe da OS.

**Nós:** planejamento por lotes (período, técnico, pernoite) e calendário.
**Ideia:**
- "minha equipe" do técnico (simples e útil para o HH com várias pessoas);
- programação semanal **ligada aos lotes que já existem**;
- mapa numa etapa posterior.

Os dados de CRAAIs/comarcas do principal (`craaiTerritoryData.ts`, `rjGeoData.ts`) podem ser reaproveitados, porque são dados públicos do RJ.

### 3.7 Ativos
**No principal:**
- cadastro com CRAAI, gerência, unidade, marca, capacidade, responsável, criticidade, valor de compra, data de aquisição e valor líquido; status operando/manutenção/crítico;
- importação XLSX com "de/para" de colunas e exportação;
- histórico de intervenções em PDF/planilha;
- **"Saúde do ativo"** = 100 − (gasto com materiais ÷ valor do ativo × 100): verde acima de 89, amarelo de 51 a 89, vermelho até 50.

**Nós:** cadastro, importação com baixa dos ausentes, QR, histórico paginado e cópia local.
**Ideias:** criticidade, valor do ativo e **saúde do ativo** (ajuda a decidir "consertar ou trocar"). Aqui, o cálculo usaria o `assetId` e o custo completo (HH + materiais).

### 3.8 Materiais, consumíveis e almoxarifado
**No principal:**
- dois cadastros: materiais e **itens de consumo (miudezas)**;
- estoque com quantidade, mínimo, local e preço, **alerta de reposição** e baixa automática ao lançar na OS;
- só cargos autorizados (almoxarife) lançam;
- importação XLSX.

**Nós:** materiais por gerência **sem estoque** (decisão anterior), com histórico de valor.
**Pergunta:** quer controle de estoque no 2.0 ou continua sem? (pergunta 3)

### 3.9 Ponto (bater ponto e registros)
**No principal:** entrada, saída e retorno do almoço, saída final, justificativa, espelho em CSV e banco de horas. **Parece protótipo:** GPS e IP fixos, e grava primeiro no navegador.
**Atenção:** ponto eletrônico de verdade tem regras legais (Portaria 671 do MTE: comprovante, registro que não pode ser alterado, arquivos fiscais). **Recomendo não incluir no 2.0 sem antes confirmar com o RH/jurídico** se ele vai substituir o ponto oficial ou é só controle interno (pergunta 4).

### 3.10 Contratos e Fornecedores
**No principal:** empresa, CNPJ, contato, nº do contrato, objeto, valor anual, vigência (início/fim), status (ativo/expirado/suspenso), ativo ligado e gerência.
**Ideia:** módulo simples, com **aviso de contrato perto de vencer** (dá para ir na rotina diária das Cloud Functions que já existe).

### 3.11 Quadro de Avisos
**No principal:** comunicado com título, texto, tipo (urgente/atenção/info), imagem, fixado e gerência (ou todas).
**Ideia:** simples e barato, com 1 escuta pequena só dos avisos ativos.

### 3.12 Histórico GLPI
**No principal:** sobe o relatório HTML exportado do GLPI, compactado e partido em pedaços no banco, para consulta. A versão on-line pelo servidor está desligada.
**Ideia:** só se ainda for útil. O melhor caminho seria guardar no Storage, e não no banco (pergunta 5).

### 3.13 Relatórios e Dashboard
**No principal:**
- SLA (dentro e fora do prazo), TMA por gerência e por tipo, backlog;
- custos HH/HE/pernoite/materiais por gerência;
- ativos com maior gasto, MTBF/MTTR/disponibilidade;
- alertas de estoque;
- impressão e Excel.

**Nós:** Dashboard e fechamento mensal (resumos prontos, leitura barata); Etapa 9 (Relatórios) adiada.
**Ideia:** usar essa lista como **cardápio da Etapa 9**, calculando dos resumos mensais (barato) e com MTBF pelo `assetId`.

### 3.14 Usuários, cargos e permissões
**No principal:**
- **cargo com matriz de permissões por módulo** (acessar/criar/editar/excluir e específicas como "ver valores", "baixa GLPI", "vincular consumíveis");
- **permissões individuais por usuário** que sobrescrevem as do cargo;
- **escopo de OS:** só as minhas / minha equipe / minha gerência / todas;
- marca "**administrativo / não operacional**" (não entra em equipe nem no HH);
- empresas (clientes) acima das gerências;
- botão "**desconectar o usuário em todos os aparelhos**";
- importação de colaboradores por XLSX.

**Nós:** perfis com permissões, gerência, força de trabalho importada e cargos com valor.
**Ideias:**
- escopo "minha equipe";
- permissão individual que sobrescreve o perfil (só se precisar);
- marca "não operacional";
- "desconectar de todos os aparelhos" (o Firebase permite, via Cloud Function).

---

## 4. Ideias técnicas (proteção, custo e manutenção)

| Ideia do principal | Para que serve | Como ficaria no nosso |
|---|---|---|
| Aviso de nova versão (`appVersionGuard`): consulta `version.json` a cada 3 min; recarrega sozinho em 60 s no Dashboard/login, senão pede para salvar; adiar 10 min | Atualizar os aparelhos após deploy | **Já temos** (`AppUpdateBanner`: confere a cada 30 min e ao voltar à aba, recarrega em 1 min, botão "Forçar atualização"). Ideia pequena: não recarregar sozinho no meio de uma OS aberta e opção de adiar |
| **Versão por módulo** (`system_control/global.cacheVersions.cargos`, `.rates`...) | Recarrega só o cadastro que mudou | Evolução do nosso `dataVersionAt` (hoje 1 número só) |
| Modo manutenção e "forçar atualização em todos os aparelhos" | Avisar e travar o uso durante uma correção | **Já temos** (`MaintenanceScreen` + `SystemControlCard`) |
| **Disjuntor com nova tentativa progressiva** (15 s → 5 min), limite por alvo e bloqueio de escuta duplicada | Evita loop que alterna documentos e escuta aberta 2 vezes | Melhorar o nosso `guard.ts` (hoje desarma até recarregar) |
| **Botão "Sincronizar" com tempo de espera** (10 s / 5 min) | Recarregar à mão sem deixar a pessoa clicar sem parar | Nas telas de cadastro |
| **Confirmar a senha antes de mudar valores** (tarifas, cargos) | Segurança extra em ações sensíveis | `reauthenticateWithCredential` do Firebase |
| **Testes automáticos** dos cálculos (hora extra, cache, versões) | Mudança futura não quebrar conta de dinheiro | Começar pelos cálculos de HH/HE/pernoite |
| Validade da cópia diferente de dia e de noite | Menos leituras fora do expediente | Avaliar caso a caso |

---

## 5. O que NÃO trazer
- Login próprio com senha no banco, entrada anônima e senhas padrão (item 2.1).
- Coleções abertas, OS públicas e atalho SSO com chave no endereço.
- Assinatura e PDF dentro do documento da OS ou do modelo.
- Admin baixando todas as OS de uma vez.
- Detecção de papel/equipe por palavras no nome do campo.
- Ponto com GPS/IP falsos.

---

## 6. Perguntas para você (decidir antes de desenhar)
1. **Homem-hora:** no 2.0 vale a regra do principal (horário comercial seg–sex 08–18, desde a atribuição) ou a nossa (do "Iniciar" ao "Concluir")? Ou uma regra por tipo de OS?
2. **Hora extra:** os percentuais 50/70/100% e a configuração de sábado e domingo/feriado por cargo valem para vocês? A hora extra é lançada na OS pelo técnico ou precisa de **solicitação aprovada antes**?
3. **Estoque:** quer controle de estoque (quantidade, mínimo, baixa automática) ou continua sem?
4. **Ponto:** o ponto do 2.0 vai substituir o ponto oficial da empresa (exige regras legais) ou é só controle interno?
5. **GLPI:** o histórico GLPI ainda é usado? Existe chance de integrar direto com o GLPI (buscar chamados) em vez de subir arquivo?
6. **Assinaturas:** toda OS corretiva terá técnico → cliente → engenheiro → gerente, ou depende do modelo?
7. **Empresas (clientes):** no 2.0 haverá mais de um cliente, além do MPRJ, ou só gerências?

---

## 7. Proposta de ordem (cada etapa só começa com sua aprovação)
1. **Base da OS corretiva:** emitir à mão, número sequencial, pausa/pendência, cancelamento com motivo, GLPI. Usa o motor de execução que já temos.
2. **Assinaturas em sequência** + fila "precisam da minha assinatura" + validação por link (Cloud Function).
3. **Hora extra, feriados e custo fixo** (depois das respostas 1 e 2) + "minha equipe" do técnico.
4. **Solicitações** de hora extra e pernoite com aprovação e teto de gastos.
5. **Modelos ampliados** (fases, condicionais, bloco repetível).
6. **Quadro de Avisos** e **Contratos** (simples).
7. **Programação Semanal** (ligada aos lotes) e depois o mapa.
8. **Relatórios (Etapa 9)** com SLA, custos e MTBF pelo `assetId`.
9. Ponto e GLPI só depois das respostas 4 e 5.

Os itens 1 a 4 mudam o banco (coleções novas, regras, índices). Cada um terá desenho, custo estimado e regras completas antes de programar.
