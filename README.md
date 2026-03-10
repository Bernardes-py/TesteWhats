# TesteWhats

Aplicação Node para envio/recebimento via Z‑API com UI simples em `public/chat.html`.

## Requisitos
- Node 18+ (ou superior)
- Git

## Configuração (Credenciais Z‑API)
- As credenciais ficam em `data/secrets.json` (NÃO é commitado por `.gitignore`).
- Você pode configurar via API:
  - `POST http://localhost:3000/api/config/secrets`
  - Body JSON:
    ```
    {
      "ZAPI_INSTANCE_ID": "...",
      "ZAPI_INSTANCE_TOKEN": "...",
      "ZAPI_CLIENT_TOKEN": "..."
    }
    ```
- Alternativamente, coloque o arquivo `data/secrets.json` com os mesmos campos.

## Rodando em desenvolvimento
1. Iniciar servidor:
   - `node src/index.js`
   - Health: `http://localhost:3000/health`
2. UI de chat:
   - `http://localhost:3000/chat.html`
3. (Opcional) Dev runner:
   - `node scripts/dev-runner.js --help`
   - `node scripts/dev-runner.js start --mock true`
   - `node scripts/dev-runner.js test:receive --phone 5511999999999`

## Webhooks (produção / testes reais)
- Para receber webhooks em dev, use um túnel (Cloudflare/ngrok) e aponte:
  - `GET /api/webhooks/quick-setup?baseUrl=HTTPS_DO_TUNEL`

## Segurança
- `.gitignore` exclui `data/` (logs, runtime e `secrets.json`) para evitar vazamento de segredos.
- Não commit sua `.env` ou chaves sensíveis.

## Subir para GitHub
1. Crie um repositório vazio em sua conta (ex.: `https://github.com/<usuario>/TesteWhats`).
2. No diretório do projeto:
   ```bash
   git init
   git add .
   git commit -m "Inicial"
   git branch -M main
   git remote add origin https://github.com/<usuario>/TesteWhats.git
   git push -u origin main
   ```
3. Em outro computador:
   ```bash
   git clone https://github.com/<usuario>/TesteWhats.git
   cd TesteWhats
   node src/index.js
   ```
4. Configure `data/secrets.json` no novo ambiente (ou use `POST /api/config/secrets`).

## Estrutura de diretórios (resumo)
- `src/` — servidor, rotas de API, webhooks
- `public/` — UI simples do chat
- `scripts/` — utilitários de diagnóstico/testes
- `data/` — logs, runtime e credenciais (excluídos do Git)
- `backups/` — backups locais (excluídos do Git)

