# Requisitos Hexon

A ordem segue as dependências: primeiro quem é quem, depois as bases, depois o...

16. **Exclusão:** só o **Super Administrador** exclui, e só OS com status **Novo**. Iniciadas, concluídas ou não executadas nunca podem ser excluídas.
17. **QR público (opção A):** a página pública mostra só o **histórico de preventivas concluídas** (área própria e pública, com os dados do técnico protegidos). As OS ficam protegidas por unidade no banco.
18. **Etapa 1 em 3 partes:** 1a cadastro de perfis → 1b telas usam as permissões → 1c regras do banco.
19. **Unidades dentro do sistema:** cada perfil vê só os ativos, imóveis e OS das suas unidades (Painel, OS, Calendário, Consulta, Ativos, QR Codes). O QR público continua abrindo qualquer ativo. O técnico continua vendo só as OS atribuídas a ele.
20. **Etapa 1c em 2 partes:** 1c-1 grava a unidade exata (GMMR, GMEE, GMC, DOM — nome = sigla, descrição = nome completo) em cada OS, botão "Corrigir unidade das OS" (Super Admin, em Gerências), histórico da vistoria ligado ao QR do imóvel, página pública só com histórico. 1c-2 buscas por unidade + regras novas do banco.
21. **Consulta de OS:** mostra todas as OS (abertas e fechadas), filtros independentes e opcionais (mês do período, gerência pela unidade, status, CRAAI, comarca, técnico), até 500 por busca. A aba Realização mostra só as abertas e as fechadas do mês atual (sem barra de mês). Solicitações também passam a respeitar as unidades do perfil.
22. **Regras do banco (1c-2):** OS só da equipe e só das unidades do perfil (campo unit); QR público não lê OS; OS Concluída imutável (exceto andamento da solicitação de corretiva e correção de cadastro pelo Super Admin); excluir só Super Admin e só OS Novo. A gerência de cada usuário precisa ser exatamente o nome da unidade (GMMR, GMEE, GMC, DOM) ou "Todas".

## 6. Perguntas em aberto

(nenhuma no momento)
