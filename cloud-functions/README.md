# Cloud Functions do Hexon

Cópia do código da Cloud Function publicada no projeto Firebase `core-philosophy-lr5vm`.
Esta pasta **não faz parte do app** (o AI Studio/Vite não a utiliza); ela existe apenas para
guardar o código do servidor e permitir republicá-lo.

## Função `resetUserPassword`

- Região: `us-central1`
- Chamada pelo app em `src/db/core.ts` → `adminResetUserPassword(userId)` (botão de cadeado na tela de usuários).
- O que faz:
  1. Exige usuário logado (não anônimo).
  2. Confere se quem chamou é **Super Administrador ativo** (`authIndex/{uid}` → `users/{userId}` com `authUid` igual e `status == 'Ativo'`).
  3. Redefine a senha do usuário-alvo para a senha provisória (ou cria a conta se não existir).
  4. Encerra as sessões abertas do usuário-alvo, grava `authUid`/`authIndex` e registra em `auditLogs`.
- Roda com a conta de serviço `hexon-functions@core-philosophy-lr5vm.iam.gserviceaccount.com`,
  que tem somente `roles/datastore.user` e `roles/firebaseauth.admin`.

## Como republicar (Google Cloud Shell)

1. Abra o Cloud Shell em https://console.cloud.google.com (projeto `core-philosophy-lr5vm`).
2. Baixe esta pasta do GitHub e entre nela:

   ```bash
   git clone --branch claude/analise-codigo-npm-dev-oqclzj --depth 1 https://github.com/Daniel563-on/HexonPrev.git
   cd HexonPrev/cloud-functions
   (cd functions && npm install)
   ```

3. Faça login no Firebase (responda `n` às perguntas sobre Gemini e coleta de dados):

   ```bash
   npx firebase-tools@latest login --no-localhost
   ```

4. Publique:

   ```bash
   npx firebase-tools@latest deploy --only functions --project core-philosophy-lr5vm
   ```

5. Garanta que a função aceita chamadas do app (a publicação nem sempre aplica isso sozinha):

   ```bash
   gcloud run services add-iam-policy-binding resetuserpassword --region=us-central1 --project=core-philosophy-lr5vm --member="allUsers" --role="roles/run.invoker"
   ```

   Isso é seguro: a própria função confere o login e o perfil de Super Administrador.

## Configuração feita uma única vez (já aplicada — referência)

```bash
# Permissão de compilação para a conta padrão do projeto
gcloud projects add-iam-policy-binding core-philosophy-lr5vm --member="serviceAccount:696666316886-compute@developer.gserviceaccount.com" --role="roles/cloudbuild.builds.builder"

# Conta de serviço própria da função
gcloud iam service-accounts create hexon-functions --display-name="Hexon Cloud Functions" --project=core-philosophy-lr5vm
gcloud projects add-iam-policy-binding core-philosophy-lr5vm --member="serviceAccount:hexon-functions@core-philosophy-lr5vm.iam.gserviceaccount.com" --role="roles/datastore.user" --condition=None
gcloud projects add-iam-policy-binding core-philosophy-lr5vm --member="serviceAccount:hexon-functions@core-philosophy-lr5vm.iam.gserviceaccount.com" --role="roles/firebaseauth.admin" --condition=None
```

## Ver erros da função

```bash
gcloud functions logs read resetUserPassword --region=us-central1 --gen2 --limit=20
```
