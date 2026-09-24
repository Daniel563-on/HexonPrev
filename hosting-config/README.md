# Configuração de publicação do site (Firebase Hosting)

Cópia de segurança do `firebase.json` usado para publicar o site em
https://hexonpreventiva.web.app (projeto Firebase **`hexonpreventiva`**).

> Os dados, o login e a Cloud Function ficam em **outro** projeto Firebase:
> `core-philosophy-lr5vm`. Este arquivo trata **somente** da hospedagem do site.

## O que esta configuração faz

- `public: dist` — publica a pasta gerada pelo `npm run build`.
- `rewrites` — qualquer endereço abre o app (`/index.html`).
- Cabeçalhos de proteção em todas as respostas:
  - `X-Frame-Options: SAMEORIGIN` e `Content-Security-Policy: frame-ancestors 'self'` — outros sites não conseguem exibir o Hexon dentro de um quadro (proteção contra clickjacking).
  - `X-Content-Type-Options: nosniff`
  - `Referrer-Policy: strict-origin-when-cross-origin`
- Cache:
  - `/` e `/index.html`: `no-cache` — a versão nova aparece logo após a publicação
    (inclui o link do QR Code, `/?public_asset=...`).
  - `/assets/**`: cache longo (`max-age=31536000, immutable`), pois esses arquivos mudam de nome a cada build.

## Como usar num computador novo

1. Copie este arquivo para a **raiz** do projeto (ao lado do `package.json`), com o nome `firebase.json`.
2. Selecione o projeto de hospedagem e publique:

   ```
   firebase use hexonpreventiva
   npm run build
   firebase deploy --only hosting
   ```

3. Confira os cabeçalhos:

   ```
   curl -I https://hexonpreventiva.web.app/
   ```

Se alterar o `firebase.json` usado para publicar, atualize também esta cópia.
