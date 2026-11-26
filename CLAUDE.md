# Simulador FAT16/FAT32 — monorepo

Trabalho acadêmico de Sistemas de Arquivos. Duas aplicações:

- `apps/api/` — backend em Python/FastAPI, **pronto e testado** (69 testes passando)
- `apps/web/` — frontend em React + TypeScript, **é onde trabalhamos**

**Nunca edite nada em `apps/api/`.** Se algo precisar mudar lá, pare e avise — o backend
é de outro integrante do grupo e será sincronizado por ele.

## Documentação

| Arquivo | Conteúdo |
| --- | --- |
| `docs/build-frontend.md` | especificação completa: API real, componentes, 22 telas, fases |
| `docs/mockups/telas.md` | as 22 telas com as anotações de comportamento — **leia este** |
| `docs/mockups/mockups.html` | o mesmo, renderizável no navegador (1,9 MB, não abra em contexto) |
| `docs/demo/roteiro.md` | roteiro da apresentação, ensaiado; os arquivos a enviar ficam ao lado |
| `apps/api/api.py`, `apps/api/fat_simulator.py` | fonte da verdade sobre comportamento |

Em dúvida sobre o que a API faz, **leia o código Python**. Não presuma, não invente.

## Estado atual

As fases 0 a 6 de `docs/build-frontend.md` estão feitas, e o roteiro de demonstração foi
ensaiado contra o backend real. Não há fase pendente: daqui em diante é correção e ajuste.

- `src/api/` — client, mock, normalizador e hooks do TanStack Query (`queries.ts`)
- `src/components/` — `shell/` (janela XP), `explorer/` (árvore e lista), `content/`
  (visualizador e editores), `inspector/` (mapa de clusters, cadeia, verificação), `dialogs/`
- Área de trabalho do XP: `src/lib/windows.ts` (regras das janelas, sem React),
  `components/desktop/` (ícones, barra de tarefas, Iniciar, balões), `components/session/`
  (boot, Bem-vindo, desligar)
- Arrastar para mover: regra do destino em `src/lib/dragMove.ts`, ponteiro e fantasma em `src/hooks/useDragMove.ts`
- `src/lib/` — lógica sem React: cadeias, formatação, previsão do efeito de uma escrita
- `smoke.ts` — uma seção por fase (1–22) e por parte da área de trabalho e do arrastar (23–26); a seção 22
  repete o roteiro de demonstração no mock

## Fatos da API que quebram código se esquecidos

Verificados executando o backend, não lidos de documentação. O contrato em PDF que circula
no grupo diverge do código em cinco pontos — estes são os valores reais:

1. **Erro vem como `{"detail": "..."}`**, não `{"ok": false, "error": "..."}`. Sucesso vem
   como `{"ok": true, "data": {...}}`. Decida sucesso por `res.ok` (status HTTP), nunca
   por `body.ok`.
2. **`cluster_size`, `espaco_total`, `espaco_livre`, `fat_offset`, `data_offset` são
   strings** no formato `"512 bytes"`. Multiplicar isso dá `NaN`.
3. **`root_max_entradas` muda de tipo**: `64` em FAT16, `"(ilimitado — FAT32)"` em FAT32.
4. **Nomes são case-sensitive**: `/Docs` e `/docs` coexistem como pastas distintas. Nunca
   normalize com `toLowerCase()` ao comparar nomes.
5. **Sem disco formatado, todo endpoint devolve 400** com "Nenhum disco aberto" — não 404.
6. Nomes têm no máximo **31 caracteres** e não podem conter `/`.
7. `ctime` e `mtime` vêm em **segundos** Unix. Multiplique por 1000 antes de `new Date()`.
8. **Limite da raiz em FAT16 é 64 entradas**, não 512.
9. **`POST /disk/check` devolve HTTP 200 mesmo quando acha problema** — `consistente:
   false` não é erro de API, é resultado da verificação.
10. **O disco persiste em arquivo** (`fat_disk.img`): reiniciar o servidor não apaga nada.
    Nunca chame `/disk/format` automaticamente ao abrir a aplicação.

Os itens 1 a 4 já estão tratados em `src/api/`. Mantenha assim ao editar.

## O que NÃO existe na API

Não desenhe, não implemente, não invente endpoint para:

- upload multipart (é `create` + `write` em Base64, duas chamadas)
- exclusão recursiva (`DELETE` de pasta com conteúdo devolve 409; a recursão é do cliente)
- desfragmentação
- atributos de arquivo (somente leitura, oculto, sistema, arquivo morto)
- data de último acesso (só `ctime` e `mtime`)
- leitura de setor bruto
- campo indicando se uma pasta tem subpastas
- rótulo de volume
- cópia de arquivo (só `move`; copiar exigiria read + create + write)

Sete situações diferentes compartilham o HTTP 400. Exiba `detail` como veio; **não infira
a causa por substring da mensagem**. A única exceção é detectar "Nenhum disco aberto", já
isolada em `ehSemDisco()` no `client.ts`.

## Convenções

- Comentários e identificadores em **inglês**; textos de interface em **pt-BR**
- Nenhum componente chama `fetch` direto — tudo passa por `src/api/`
- Tipos crus (`DiskInfoRaw`) ficam na borda; componentes só veem tipos normalizados
- `xp.css` fornece os widgets; tree view, list view, menus e dialogs são código nosso
- Commits em Conventional Commits, primeira linha curta (~4 palavras)

## Comandos

```bash
npm run dev          # sobe backend (8000) e frontend (5173) juntos
npm run check        # pytest + smoke do mock + typecheck — rode antes de concluir
```

O frontend roda em modo mock por padrão (`VITE_MOCK=1` em `apps/web/.env.development`).
Apague essa linha para falar com o backend real.

Para validar contra o backend sem tocar no `apps/api/fat_disk.img` de quem está usando,
suba um par isolado em outras portas, com o disco num arquivo de rascunho:

```bash
cd apps/api && FAT_DISK_PATH=/caminho/rascunho.img uvicorn api:app --port 8001
cd apps/web && VITE_MOCK=0 VITE_API_URL=http://localhost:8001 npx vite --port 5174 --strictPort
```
