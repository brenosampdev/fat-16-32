# Simulador FAT16/FAT32

Trabalho de Sistemas de Arquivos — Turma 26.

- `apps/api/` — simulador FAT em Python/FastAPI (backend). Não vem neste repositório: é
  versionado à parte pelo integrante responsável e precisa estar nesta pasta para rodar.
- `apps/web/` — Explorer no estilo Windows XP em React + TypeScript (frontend)
- `docs/build-frontend.md` — especificação de implementação do frontend
- `docs/demo/roteiro.md` — roteiro da apresentação, com os arquivos a enviar

## Pré-requisitos

Git, Node.js e Python 3 (testado com Node 24 e Python 3.12).

## Instalar

```bash
git clone https://github.com/brenosampdev/fat-16-32.git
cd fat-xp
npm install
```

## Rodar só o frontend (mock)

O frontend sobe em modo mock por padrão (`VITE_MOCK=1` em `apps/web/.env.development`) e
não precisa do backend:

```bash
npm run dev:web    # http://localhost:5173
```

Use `dev:web`, não `dev`: o `dev` também tenta subir o backend. Com `?sem-boot` no fim do
endereço, a tela de boot é pulada.

## Rodar com o backend

1. Coloque o backend em `apps/api/` (`api.py`, `fat_simulator.py`, `requirements.txt`,
   `test_api.py`).

2. Crie o ambiente Python e instale as dependências.

   Windows (PowerShell):

   ```powershell
   python -m venv .venv
   .venv\Scripts\Activate.ps1
   pip install -r apps/api/requirements.txt
   ```

   Se o PowerShell bloquear a ativação, rode antes
   `Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass`.

   Linux/macOS:

   ```bash
   python3 -m venv .venv && source .venv/bin/activate
   pip install -r apps/api/requirements.txt
   ```

3. Suba os dois com o mock desligado. A variável vale só para aquela janela do terminal, e o
   `.env.development` versionado não muda.

   Windows (PowerShell):

   ```powershell
   $env:VITE_MOCK = "0"; npm run dev
   ```

   Linux/macOS:

   ```bash
   VITE_MOCK=0 npm run dev
   ```

O backend sobe em :8000 e o frontend em :5173. Num clone novo ainda não há disco, então o
app abre o diálogo Formatar. O disco formatado fica em `apps/api/fat_disk.img`, fora do
repositório, e sobrevive a reiniciar o servidor.

Cada janela nova do terminal precisa ativar o `.venv` de novo antes de `npm run dev` ou
`npm run check`.

## Verificar

```bash
npm run check      # 69 testes do backend + smoke do mock + typecheck
```

Precisa do backend em `apps/api/` e do `.venv` ativo. Sem o backend, rode só a parte do
frontend:

```bash
npm run test:web   # smoke do mock
npm run typecheck
```
