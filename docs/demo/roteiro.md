# Roteiro de demonstração

Os nove passos de `docs/build-frontend.md`, com tamanhos que produzem a fragmentação na
tela. Ensaiado em 26/11/2026 contra o backend real, e coberto pela seção 22 do smoke
(`npm run check`), que roda os mesmos passos no mock com estes mesmos arquivos.

## Antes de começar

- Rode `npm run dev`. O frontend precisa falar com o backend real: apague a linha
  `VITE_MOCK=1` de `apps/web/.env.development`.
- O passo 1 formata o disco: tudo o que estiver em `apps/api/fat_disk.img` é apagado.
- Os arquivos a enviar estão nesta pasta:

| Arquivo | Tamanho | Clusters de 512 B |
| --- | --- | --- |
| `ata.txt` | 1.200 B | 3 |
| `notas.txt` | 900 B | 2 |
| `relatorio.txt` | 2.300 B | 5 |

Siga a ordem exata. Uma pasta ou um arquivo a mais antes do passo 4 muda os números
dos clusters (a fragmentação continua acontecendo, mas o texto abaixo deixa de bater).

## Passos

| # | O que fazer | O que aparece |
| --- | --- | --- |
| 1 | **Disco › Formatar…**: FAT16, 512 bytes, 256 clusters. Iniciar, e Formatar no aviso. | Mapa todo livre, só a raiz no cluster 2. 255 clusters livres. |
| 2 | **Arquivo › Nova pasta**, nome `DOCS`. Abra a pasta. **Arquivo › Enviar arquivo…**: `ata.txt`, depois `notas.txt`. | `DOCS` no cluster 3, `ata.txt` em 4–6, `notas.txt` em 7–8: os clusters acendem em sequência. |
| 3 | Selecione `ata.txt`, tecla Del, **Sim**. | O aviso lista os clusters 4, 5 e 6. No mapa, um buraco de três clusters entre `DOCS` e `notas.txt`. |
| 4 | **Arquivo › Enviar arquivo…**: `relatorio.txt`. | Cadeia 4 5 6 → salto (7–8 em uso) → 9 10. A barra de status diz "2 fragmentos". |
| 5 | Com `relatorio.txt` selecionado, **Propriedades › Detalhes FAT**. | Tabela 4→5→6→9→10, a linha do 6 diz "salta 7–8 (DOCS\notas.txt)". Slack de 260 B (5 × 512 − 2.300). |
| 6 | Abra o arquivo (Enter), **Sobrescrever…**: offset `1530`, trecho `## TRECHO NOVO ##`. | A previsão diz que só os clusters 6 e 9 são reescritos e que a FAT não muda. Depois, o texto aparece na linha 026 e **o mapa continua igual**. |
| 7 | **Substituir…**: troque tudo por `Versao curta do relatorio.` | A cadeia encolhe de 5 para 1 cluster (só o 4). Os clusters 5, 6, 9 e 10 voltam a ficar livres no mapa. |
| 8 | **Disco › Verificar disco**. | "Nenhum problema encontrado", 5 clusters em uso (2, 3, 4, 7 e 8). |
| 9 | **Disco › Formatar…**: FAT32 (o número de clusters vira 1024 sozinho). Iniciar, e Formatar no aviso. | O mapa passa a 64 colunas e 1.023 clusters livres. A raiz é uma cadeia a partir do cluster 2. |

## O que dizer em cada momento

- **Passos 3 e 4**: o simulador aloca por *first-fit*, procurando o primeiro cluster
  livre a partir do 2. O `relatorio.txt` precisa de 5 clusters, o buraco só tem 3, então
  a cadeia ocupa o buraco e continua depois do `notas.txt`.
- **Passo 6**: sobrescrever dentro do tamanho do arquivo não aloca nem libera nada. O
  trecho atravessa o salto entre os clusters 6 e 9, e mesmo assim a FAT fica idêntica.
- **Passo 7**: substituir por algo menor mantém os primeiros clusters da cadeia e libera
  o resto.

## Por que estes tamanhos

O buraco precisa ficar **antes** de um arquivo que continua ocupado. Se o apagado fosse
o `notas.txt`, o buraco ficaria no fim da área usada e o `relatorio.txt` sairia contíguo
(4 a 8), sem fragmentação.

## Extras opcionais

- **Persistência**: pare o `npm run dev` (Ctrl+C), suba de novo e recarregue a página. O
  disco volta como estava; nenhum dialog de formatar aparece.
- **Raiz do FAT32 como cadeia** (depois do passo 9): crie 9 arquivos na raiz com
  **Arquivo › Novo arquivo**. Cada cluster de 512 B guarda 8 entradas de 64 B, então a 9ª
  faz a raiz crescer para os clusters 2 → 3. Com nada selecionado, o mapa acende os dois.
  Em FAT16 a mesma raiz para em 64 entradas.
