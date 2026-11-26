# Simulador FAT16/FAT32

Trabalho de Sistemas de Arquivos — Turma 26.

- `apps/api/` — simulador FAT em Python/FastAPI (backend). Não vem neste repositório: é
  versionado à parte pelo integrante responsável e precisa estar nesta pasta para rodar.
- `apps/web/` — Explorer no estilo Windows XP em React + TypeScript (frontend)
- `docs/build-frontend.md` — especificação de implementação do frontend
- `docs/demo/roteiro.md` — roteiro da apresentação, com os arquivos a enviar

## Rodar

```bash
npm install
python3 -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\Activate.ps1
pip install -r apps/api/requirements.txt

npm run dev        # backend em :8000, frontend em :5173
```

O frontend sobe em modo mock por padrão. Para falar com o backend real, apague a linha
`VITE_MOCK=1` de `apps/web/.env.development`.

## Verificar

```bash
npm run check      # 69 testes do backend + smoke do mock + typecheck
```
