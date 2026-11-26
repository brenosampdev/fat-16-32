# Build do Frontend — Explorer Windows XP sobre a API FAT

Nov 25, 2026 · @Breno

Especificação de implementação do frontend: um shell no estilo do Windows XP Explorer, em React + TypeScript, consumindo a API do simulador FAT16/FAT32 que já existe e roda.

Tudo sobre a API neste documento foi obtido **executando o backend**, não lendo a documentação dele — que diverge do código em cinco pontos, três deles capazes de quebrar o client silenciosamente. Onde este documento contradiz qualquer outra fonte sobre o comportamento da API, **este documento vence**.

## O que foi verificado

O backend foi instalado e executado. `pytest test_api.py` — **69 passed**, dois warnings de `on_event` deprecado. Depois disso, cada resposta foi inspecionada campo a campo contra o contrato em PDF.

### Veredito

A implementação é sólida. O `fat_simulator.py` tem cadeia de clusters com detecção de ciclo, verificação de espaço antes de modificar, entrada de diretório de 64 bytes com `0xE5` para deletado, e um `check()` que detecta cross-linked, órfãos e cadeia inconsistente com `file_size`. O trabalho está bem feito.

O problema não é o código: **é o contrato em PDF, que não descreve o que o código faz**. Três diferenças quebram o client do frontend de forma silenciosa — sem erro de compilação, sem exceção, só valores errados na tela.

### Como as respostas foram obtidas

Via `TestClient` do FastAPI, em processo, com disco temporário por cenário. Tudo nesta aba vem dessa execução, não de leitura do código. Os números são de um disco FAT16, `cluster_size: 512`, `num_clusters: 256`.

### Coisas boas que o PDF não menciona

| Descoberta | Por que importa para o front |
| --- | --- |
| **O disco persiste em arquivo** (`fat_disk.img`) | reiniciar o servidor **não** perde os dados; o `@app.on_event("startup")` reabre o disco existente |
| `FAT_DISK_PATH` controla o caminho do disco | dá para isolar o disco de desenvolvimento do de demo |
| CORS liberado (`allow_origins=["*"]`) | o front em `localhost:5173` fala com o back sem proxy |
| Swagger em `/docs` | dá para testar endpoint na mão antes de escrever o componente |
| `check()` detecta cross-linked e órfãos de verdade | a tela de verificação tem conteúdo real, não decorativo |

A persistência derruba a preocupação anterior de perder o disco no meio da apresentação. Rodar com `--reload` é seguro.

## Divergências verificadas

Cinco diferenças entre o contrato em PDF e o que a API devolve. As três primeiras quebram código.

| # | Item | Contrato em PDF | Resposta real | Gravidade |
| --- | --- | --- | --- | --- |
| 1 | envelope de erro | `{"ok": false, "error": "..."}` | `{"detail": "..."}` | **quebra** |
| 2 | `cluster_size` | `512` (número) | `"512 bytes"` (string) | **quebra** |
| 3 | `root_max_entradas` | `64` (número) | `64` em FAT16, `"(ilimitado — FAT32)"` em FAT32 | **quebra** |
| 4 | `fat_offset`, `data_offset` | `512`, `2048` (números) | `"512 bytes"`, `"1536 bytes"` (strings) | menor |
| 5 | comparação de nomes | não documentado | **case-sensitive** | conceitual |

### 1. O envelope de erro não existe

O contrato promete `{"ok": false, "error": "mensagem"}`. A implementação usa `HTTPException(detail=...)`, e o FastAPI serializa isso como:

```json
{ "detail": "Diretório não encontrado: 'fantasma' em '/fantasma'." }
```

Não há `ok`. Não há `error`. Um client escrito contra o contrato faz:

```ts
if (!body.ok) throw new ApiError(res.status, body.error)  // body.error === undefined
```

O `if` dispara (porque `undefined` é falsy), mas a mensagem chega vazia. **Todo dialog de erro da UI apareceria em branco.** Sem erro de compilação e sem exceção — só uma caixa vazia na tela.

Respostas de **sucesso** seguem o contrato: `{"ok": true, "data": {...}}`. Só o caminho de erro diverge.

### 2. `cluster_size` é string

```json
{
  "variante": "FAT16",
  "cluster_size": "512 bytes",
  "num_clusters": 256,
  "clusters_livres": 255,
  "clusters_usados": 1,
  "espaco_total": "131072 bytes",
  "espaco_livre": "130560 bytes",
  "fat_offset": "512 bytes",
  "data_offset": "1536 bytes",
  "root_cluster": 2,
  "root_max_entradas": 64
}
```

O contorno que eu tinha recomendado era `clusters_livres * cluster_size`, justamente para fugir das strings. Só que `cluster_size` **também** é string. Em JavaScript:

```js
255 * "512 bytes"   // NaN
```

Na prática a barra de espaço em disco mostraria `NaN%`. `num_clusters`, `clusters_livres`, `clusters_usados` e `root_cluster` são números de verdade — esses salvam.

### 3. `root_max_entradas` muda de tipo conforme a variante

```python
'root_max_entradas': self.root_max_entries or '(ilimitado — FAT32)'
```

Em FAT16 vem `64`. Em FAT32 vem a string `"(ilimitado — FAT32)"`, porque `root_max_entries` é `0` e o `or` troca por texto. Um campo que muda de tipo conforme o estado é pior que um campo sempre string: o código funciona em FAT16 e falha ao trocar de variante.

### 4. `data_offset` também é outro valor

O PDF mostrava `2048`. O real é `1536`: cabeçalho de 512, mais a região da FAT de `(256+2) × 2 = 516` bytes arredondada para 1024. São campos informativos — a UI não depende deles — mas confirmam que o PDF foi escrito antes do código.

### 5. Nomes são case-sensitive

```
mkdir /Docs   -> 200
ls    /docs   -> 404
mkdir /docs   -> 200   (coexistem!)
ls    /       -> ["Docs", "docs"]
```

FAT de verdade é case-insensitive. Esta implementação compara com `e['name'] == name`, então `/Docs` e `/docs` são duas pastas distintas.

Isso tem peso na apresentação: se alguém da banca criar `TESTE` e depois `teste` esperando colisão, vai ver duas pastas. **Não é um bug do front** — é escolha do simulador — mas vale estar preparado para a pergunta, e o front não deve tentar "consertar" normalizando caixa, porque aí a UI mentiria sobre o estado do disco.

### Erros: todos os de cliente são 400

Medido, com a mensagem exata:

| Situação | HTTP | `detail` |
| --- | --- | --- |
| path inexistente | 404 | `Diretório não encontrado: 'x' em '/x'.` |
| nome duplicado | 409 | `'d' já existe.` |
| diretório não vazio | 409 | `Diretório 'cheia' não está vazio.` |
| sem disco formatado | **400** | `Nenhum disco aberto. Use POST /disk/format primeiro.` |
| nome > 31 chars | 400 | `Nome deve ter 1–31 caracteres.` |
| base64 inválido | 400 | `conteudo_base64 inválido: não é Base64 válido.` |
| path não é diretório | 400 | `'f.txt' não é um diretório.` |
| leitura de diretório | 400 | `'d' é um diretório.` |
| disco cheio | 400 | `Espaço insuficiente: precisamos de N cluster(s) a mais.` |
| root cheio (64 entradas) | 400 | `Diretório pai cheio (limite FAT16).` |
| mover pasta para dentro de si | 400 | `Não é possível mover um diretório para dentro de si mesmo.` |

Sete situações diferentes compartilham o 400. A UI não consegue distinguir "disco cheio" de "nome inválido" sem fazer match na string.

O código que decide isso está em `_http_code()` e funciona por substring em português:

```python
if any(k in low for k in ("não encontrado", "not found")): return 404
if any(k in low for k in ("já existe",)):                   return 409
```

Funciona hoje. Quebra no dia em que alguém reescrever uma mensagem de erro. **O front não deve fazer o mesmo**: exiba `detail` como veio e não tente inferir causa por substring.

### Confirmados, sem surpresa

- `GET /ls` não traz nada indicando se uma pasta tem subpastas
- `DELETE /file?path=/cheia&recursivo=true` → **409**; o parâmetro é ignorado, não existe
- `/disk/fat` devolve `status` como `"→ 6"`, com seta Unicode
- `/file/chain` funciona bem: `cadeia`, `num_clusters`, `slack_interno` corretos

## Monorepo

Um repositório, duas aplicações. O backend fica como o colega entregou: `apps/api/` é território dele, e o frontend nunca escreve ali.

```
fat-xp/
├── apps/
│   ├── api/                    território do backend — NÃO EDITAR
│   │   ├── fat_simulator.py
│   │   ├── api.py
│   │   ├── test_api.py
│   │   └── requirements.txt    (nosso: ele não mandou)
│   └── web/                    território do frontend
│       ├── src/
│       │   ├── api/            client, tipos, mock, queries
│       │   ├── components/     shell XP
│       │   ├── styles/
│       │   ├── App.tsx
│       │   └── main.tsx
│       ├── index.html
│       ├── package.json
│       └── vite.config.ts
├── package.json                workspaces + scripts raiz
├── .gitignore
└── README.md
```

### Rodar os dois

```bash
# uma vez
npm install
python3 -m venv .venv && source .venv/bin/activate
pip install -r apps/api/requirements.txt

# dia a dia
npm run dev            # sobe back (8000) e front (5173) juntos
```

O script raiz usa `concurrently`:

```json
{
  "workspaces": ["apps/web"],
  "scripts": {
    "dev":      "concurrently -n api,web -c cyan,magenta \"npm:dev:api\" \"npm:dev:web\"",
    "dev:api":  "cd apps/api && uvicorn api:app --reload --port 8000",
    "dev:web":  "npm run dev -w apps/web",
    "test:api": "cd apps/api && pytest -q",
    "test:web": "npm run smoke -w apps/web",
    "check":    "npm run test:api && npm run test:web && npm run typecheck -w apps/web"
  }
}
```

`npm run check` é o portão único: roda os 69 testes do Python, o smoke do mock e o typecheck. Todo agente roda isso antes de dizer que terminou.

### Variáveis de ambiente

| Variável | Onde | Valor | Para quê |
| --- | --- | --- | --- |
| `FAT_DISK_PATH` | backend | `./fat_disk.img` | caminho do disco; troque para isolar demo de desenvolvimento |
| `VITE_API_URL` | frontend | `http://localhost:8000` | host do backend |
| `VITE_MOCK` | frontend | `1` ou ausente | `1` usa o mock, ausente usa o backend real |

O mock continua valendo a pena mesmo com o backend pronto: os testes do front rodam sem subir Python, e dá para desenvolver offline. A regra é que **os dois precisam se comportar igual** — por isso o mock foi corrigido para replicar as divergências, inclusive o envelope `{"detail"}` e o case-sensitive.

### `.gitignore`

```
node_modules/
dist/
__pycache__/
.venv/
*.img          # o disco virtual não vai para o repo
.env.local
```

O `*.img` importa: o disco de desenvolvimento tem lixo de teste e é binário. Commitar causa conflito a cada push.

### `requirements.txt`

O colega não mandou. Deduzido dos imports e da execução:

```
fastapi>=0.115
uvicorn[standard]>=0.32
pydantic>=2.9
httpx>=0.27
pytest>=8.3
```

`httpx` é dependência do `TestClient`, então entra mesmo não aparecendo nos imports de `api.py`.

### Antes de mandar para ele

O repositório é seu até o push. Combine três coisas antes:

1. Quem commita em `apps/api/` — proposta: só ele, e o front abre issue em vez de editar
2. Se ele aceita o `requirements.txt` que você escreveu
3. Se o `fat_disk.img` fica no `.gitignore` (proposta: fica)

## Correções no client

O que a aba de frontend descreve está certo em arquitetura e errado em três tipos. Estas são as mudanças obrigatórias.

### Envelope de erro

O wrapper precisa ler `detail`, não `error`. Como as respostas de sucesso **seguem** o contrato, trate os dois formatos — assim o código sobrevive caso o back passe a emitir o envelope prometido:

```ts
type ApiOk<T>  = { ok: true; data: T }
type ApiErrContrato = { ok: false; error: string }
type ApiErrFastAPI  = { detail: string }
type ApiRes<T> = ApiOk<T> | ApiErrContrato | ApiErrFastAPI

function extrairErro(body: unknown, status: number): string {
  if (typeof body === 'object' && body !== null) {
    const b = body as Record<string, unknown>
    if (typeof b.detail === 'string') return b.detail   // FastAPI, o caso real
    if (typeof b.error === 'string') return b.error     // envelope do contrato
  }
  return `Erro HTTP ${status}.`
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(BASE + path, { headers: JSON_HEADERS, ...init })
  const body = await res.json().catch(() => null)

  if (!res.ok) throw new ApiError(res.status, extrairErro(body, res.status))

  const env = body as ApiOk<T>
  if (!env?.ok) throw new ApiError(res.status, extrairErro(body, res.status))
  return env.data
}
```

A mudança de fundo: **decidir sucesso por `res.ok` (status HTTP), não por `body.ok`**. O status é confiável nos dois formatos; o corpo não.

### `DiskInfo` com os tipos reais

```ts
/** Resposta crua. Campos com ` bytes` no fim são strings. */
export type DiskInfoRaw = {
  variante: string              // 'FAT16' | 'FAT32'
  cluster_size: string          // '512 bytes'
  num_clusters: number
  clusters_livres: number
  clusters_usados: number
  espaco_total: string          // '131072 bytes'
  espaco_livre: string
  fat_offset: string            // '512 bytes'
  data_offset: string           // '1536 bytes'
  root_cluster: number
  root_max_entradas: number | string   // 64  |  '(ilimitado — FAT32)'
}

/** O que os componentes consomem. Tudo numérico. */
export type DiskInfo = {
  variante: 'FAT16' | 'FAT32'
  clusterSize: number
  numClusters: number
  clustersLivres: number
  clustersUsados: number
  espacoTotal: number
  espacoLivre: number
  rootCluster: number
  /** null quando ilimitado (FAT32) */
  rootMaxEntradas: number | null
}
```

### Normalizador na borda

Um lugar só converte. Nenhum componente vê `DiskInfoRaw`:

```ts
/** '512 bytes' -> 512 ; 512 -> 512 ; qualquer outra coisa -> fallback */
const numerico = (v: unknown, fallback = 0): number => {
  if (typeof v === 'number') return v
  if (typeof v === 'string') {
    const n = Number.parseInt(v, 10)
    return Number.isNaN(n) ? fallback : n
  }
  return fallback
}

export function normalizarInfo(raw: DiskInfoRaw): DiskInfo {
  const clusterSize = numerico(raw.cluster_size, 512)
  return {
    variante: raw.variante === 'FAT32' ? 'FAT32' : 'FAT16',
    clusterSize,
    numClusters: raw.num_clusters,
    clustersLivres: raw.clusters_livres,
    clustersUsados: raw.clusters_usados,
    espacoTotal: numerico(raw.espaco_total, raw.num_clusters * clusterSize),
    espacoLivre: numerico(raw.espaco_livre, raw.clusters_livres * clusterSize),
    rootCluster: raw.root_cluster,
    // string = '(ilimitado — FAT32)'
    rootMaxEntradas: typeof raw.root_max_entradas === 'number'
      ? raw.root_max_entradas
      : null,
  }
}
```

Repare nos fallbacks de `espacoTotal` e `espacoLivre`: se o back passar a mandar número, `numerico` devolve direto; se mandar algo inesperado, o cálculo a partir dos campos que são confiavelmente numéricos cobre. **O dia em que o back corrigir os tipos, este código continua funcionando sem alteração.**

### Comparação de nomes passa a ser case-sensitive

O que a aba de frontend diz sobre case-insensitive vale para FAT de verdade, não para este backend.

```ts
// ERRADO para este backend
const existe = entradas.some(e => e.nome.toLowerCase() === nome.toLowerCase())

// CERTO
const existe = entradas.some(e => e.nome === nome)
```

Isso vale na validação otimista de nome duplicado e na resolução de path dentro do mock. Ordenação na tela pode continuar usando `localeCompare` — isso é apresentação, não identidade.

### "Sem disco" é 400, não 404

A pergunta que ficou em aberto tem resposta. O bootstrap distingue assim:

```ts
const SEM_DISCO = 'Nenhum disco aberto'

export const ehSemDisco = (e: unknown): boolean =>
  e instanceof ApiError && e.status === 400 && e.message.includes(SEM_DISCO)
```

Esta é a única exceção à regra de não fazer match em string de erro, e vale registrar o porquê: é a diferença entre abrir o `FormatDialog` e mostrar um dialog de falha. Isole numa função só, com o nome dizendo o que faz, para o dia em que vier um campo `codigo` e bastar trocar uma linha.

### Persistência muda o bootstrap

O disco sobrevive a restart. Na prática:

- Não chame `format` automaticamente ao abrir a app — isso **apagaria** o disco do usuário
- Chame `GET /disk/info`; se vier 400 com "Nenhum disco aberto", aí sim abra o `FormatDialog`
- Se vier 200, carregue normalmente

```tsx
const info = useDiskInfo()
if (info.isError && ehSemDisco(info.error)) return <FormatDialog obrigatorio />
if (info.isError) return <ErroDialog erro={info.error} />
```

## Catálogo de telas

Os mockups estão fechados: 22 telas, validadas contra os 15 endpoints. Nenhuma depende de funcionalidade inexistente. Esta tabela é o mapa entre o que foi desenhado e o que precisa ser chamado.

| # | Tela | Endpoints | Componentes |
| --- | --- | --- | --- |
| 01 | Principal, arquivo fragmentado selecionado | `/ls`, `/disk/info`, `/disk/fat`, `/file/chain` | shell completo |
| 02 | Seleção múltipla | os mesmos | `FileList`, `StatusBar` |
| 03 | Pasta vazia | `/ls` | `FileList` |
| 04 | Carregando | — | estado de `useQuery` |
| 05 | Erro: espaço insuficiente | 400 de `/file/write` | `ErrorDialog` |
| 06 | Propriedades: Geral | dados de `/ls` | `PropertiesDialog` |
| 07 | Propriedades: Detalhes FAT | `/file/chain` | `PropertiesDialog`, `FatTable` |
| 08 | Formatar | `/disk/format` | `FormatDialog` |
| 09 | Confirmar exclusão | `/file/chain` + `DELETE /file` | `ConfirmDeleteDialog` |
| 10 | Progresso: excluindo pasta | `/ls` + `DELETE` em laço | `ProgressDialog` |
| 11a | Ler: texto | `/file/read` | `FileViewer` |
| 11b | Ler: binário em hexadecimal | `/file/read` | `FileViewer`, `HexDump` |
| 12 | Escrever: acrescentar ao final | `/file/write` | `ContentEditor` |
| 13 | Sobrescrever: bytes no lugar | `/file/overwrite` | `ContentEditor` |
| 14 | Substituir: todo o conteúdo | `/file/replace` | `ContentEditor` |
| 15a | Renomear: edição na linha | `/file/rename` | `RenameInput` |
| 15b | Renomear: nome duplicado | 409 de `/file/rename` | `RenameInput` |
| 16 | Mover | `/file/move` | `MoveDialog` |
| 17 | Disco não formatado | 400 "Nenhum disco aberto" | `FormatDialog` |
| 18a | Verificação: disco limpo | `/disk/check` | `CheckReport` |
| 18b | Verificação: três problemas | `/disk/check` | `CheckReport` |
| 19 | FAT32: 1024 clusters | `/disk/format`, `/disk/fat` | `ClusterMap` |

Os 15 endpoints têm representação. As sete operações nomeadas do trabalho — ler, escrever, sobrescrever, apagar, substituir, renomear e mover — têm tela cada uma.

### Decisões que os mockups fixaram

| Decisão | Consequência |
| --- | --- |
| Cromo neutro nos mockups; aparência vem do `xp.css` | não copie cores dos mockups; use os tokens da biblioteca |
| Mapa colorido por **estado da FAT**, não por dono | cinco estados: livre, em uso, fim de cadeia, defeituoso, selecionado |
| Tooltip do cluster mostra `FAT[n]`, não o dono | a FAT não registra quem ocupa o cluster; a UI não inventa |
| Propriedades sem atributos | duas abas, rodapé só com OK e Cancelar |
| Lista sem coluna Fragmentos | exigiria um `/file/chain` por arquivo; fragmentação aparece nas Propriedades |
| Confirmar exclusão lista os clusters liberados | precisa de `/file/chain` **antes** do `DELETE` |
| Botão padrão de exclusão é **Não** | Enter não apaga nada por acidente |
| Modo Ícones e menu de contexto ficaram fora | se entrarem depois, não há mockup — siga as medidas deste documento |

### Valores de formatação corretos

A tela 08 mostra o grupo Resultado recalculando a cada mudança. Os números são deste backend, não do FAT real:

| Campo | Valor | Observação |
| --- | --- | --- |
| Clusters de dados | `num_clusters` | 256 em FAT16, 1024 em FAT32 |
| Tabela FAT | **uma** região | FAT real tem duas cópias; este simulador, uma |
| Entradas na raiz | **64** em FAT16 | `FAT16_ROOT_MAX = 64`, não 512 |
| Entradas na raiz | ilimitadas em FAT32 | a raiz vira cadeia de clusters |
| Espaço útil | `cluster_size × num_clusters` | calcule no cliente |

O limite de 64 muda a demonstração: a raiz enche no 64º arquivo, com HTTP 400 e "Diretório pai cheio (limite FAT16)".

## O shell XP

### Base

`xp.css` (`npm install xp.css`, MIT) é CSS puro e cobre os widgets: botões, title bar, tabs, campos, sliders, dropdowns, fieldsets. Importação:

```ts
import 'xp.css/dist/XP.css'
```

Ele **não** cobre o shell. Tree view, list view, menu bar, toolbar, address bar, status bar, context menu e os dialogs são código próprio. Envolva a aplicação numa `<div className="xp">` para os estilos valerem.

### Anatomia da janela

```
┌────────────────────────────────────────────────┐
│  Meu Disco FAT                            _  □  ×  │  TitleBar     28px
├────────────────────────────────────────────────┤
│ Arquivo  Editar  Exibir  Favoritos  Ferramentas     │  MenuBar      20px
├────────────────────────────────────────────────┤
│  ← Voltar  →  ↑ Acima  │  Nova pasta  │  Modos ▾    │  Toolbar      36px
├────────────────────────────────────────────────┤
│ Endereço  │ /docs                            │  → Ir  │  AddressBar   24px
├────────────────┬──────────────────────────────────┤
│ Pastas        │ Nome        Tam.   Tipo     Modificado │
│  Meu Disco    │ relatorio.txt 2 KB Documento 24/11 09:15│  Split
│   ├ docs       │ dados.bin    3 KB Binário   24/11 10:02│  180px | resto
│   └ backup     │                                        │
├───────────────┴──────────────────────────────────┤
│ 2 objetos      │  5,1 KB       │  127 KB livres       │  StatusBar    22px
└────────────────────────────────────────────────┘
```

Janela do Explorer: 860×620, aberta centralizada na área acima da barra de tarefas (maximizada quando não cabe), arrastável pela title bar, com minimizar, maximizar e fechar, e sem redimensionar pela borda. A área de trabalho do XP (janelas, barra de tarefas com Iniciar, sessão, zoom, dicas e sons) está especificada em `docs/superpowers/specs/2026-11-26-xp-desktop-design.md`; as regras das janelas ficam em `src/lib/windows.ts`.

A inspeção do disco (mapa de clusters, cadeia, verificação) fica dentro do Explorer, não numa segunda janela.

### Árvore de componentes

```
<App>
  <Session>                        boot, Bem-vindo, Desligar, Em espera, Reiniciar
    <DeskProvider>                 estado das janelas (lib/windows.ts), balões
      <Desktop>                    papel de parede
        <DesktopIcons />           Meu computador, Lixeira
        <AppWindow>                uma por janela aberta (Explorer, Lixeira); chrome XP, zoom;
                                   abaixo, o que o Explorer põe dentro da sua
          <TitleBar />
          <MenuBar />              dropdowns
          <Toolbar />              Voltar/Avançar/Acima, Abrir, Nova pasta, Excluir…
          <AddressBar />           path editável
          <SplitPane>
            <FolderTree />         só diretórios, lazy load
            <FileList />           Detalhes (o modo Ícones fica desabilitado)
            <ClusterMap />         mapa de clusters, com a cadeia (ChainStrip) no rodapé
          </SplitPane>
          <StatusBar />
          <ContextMenu />          fixo na posição do cursor, sem portal
          <…Dialog />              diálogos sobre a janela (Modal), sem portal
        </AppWindow>
        <Taskbar />                Iniciar, botões das janelas, bandeja (som, relógio)
        <Balloon />                balão da bandeja
        <StartMenu />              menu Iniciar funcional
      </Desktop>
    </DeskProvider>
  </Session>
  <TooltipLayer />                 dicas amarelas no lugar do title nativo
</App>
```

### Arquivos

```
src/
  api/
    types.ts          tipos crus e normalizados
    normalize.ts      DiskInfoRaw -> DiskInfo, helpers de parse
    client.ts         httpApi + ApiError/NetworkError
    mock.ts           mock alinhado ao backend real
    queries.ts        query keys, hooks, invalidação
    paths.ts          joinPath, parentOf, validateName, formatação
    index.ts          switch mock/real
  components/
    shell/            AppWindow, TitleBar, MenuBar, Toolbar, ContextMenu,
                      AddressBar, SplitPane, StatusBar, Desktop
    desktop/          DeskContext, DesktopIcons, Taskbar, Tray, StartMenu,
                      Balloon, RecycleBin, TooltipLayer, kinds
    session/          Session, BootScreen, WelcomeScreen, ShutdownDialog
    explorer/         Explorer, FolderTree, TreeItem, FileList, RenameField
    content/          FileViewer, ContentEditor, HexView, MiniMap
    dialogs/          Modal, ConfirmDelete, DeleteProgress, MoveDialog,
                      PropertiesDialog, UploadDialog, FormatDialog, ErrorDialog
    inspector/        ClusterMap, ChainStrip, CheckReport
    common/           Icon, ChainChips
  hooks/
    useSelection.ts   seleção múltipla com shift/ctrl
    useHistory.ts     pilhas de Voltar/Avançar
    useClipboard.ts   recortar/copiar/colar
    useContextMenu.ts
  styles/
    app.css           shell, lista, árvore
    inspector.css     mapa de clusters
  App.tsx
  main.tsx
```

### Estado

Cinco consumidores observam o mesmo disco: `FolderTree`, `FileList`, `AddressBar`, `StatusBar` e `ClusterMap`. Sem cache compartilhado, apagar um arquivo na lista deixa a árvore e o mapa desatualizados.

TanStack Query com invalidação por path resolve. Não há canal de eventos no backend, então a invalidação é inteiramente do cliente — o que basta, porque o disco só muda por ação da própria UI.

```ts
export const keys = {
  info:  ['disk', 'info'] as const,
  fat:   ['disk', 'fat'] as const,
  check: ['disk', 'check'] as const,
  dir:   (path: string) => ['dir', path] as const,
  chain: (path: string) => ['chain', path] as const,
  file:  (path: string) => ['file', path] as const,
}
```

| Operação | Invalidar |
| --- | --- |
| `mkdir` | `dir(pai)`, `info`, `fat` |
| `createFile` | `dir(pai)`, `info` |
| `write`, `replace` | `dir(pai)`, `info`, `fat`, `chain(path)`, `file(path)` |
| `overwrite` | `file(path)` apenas — não muda tamanho nem alocação |
| `remove` | `dir(pai)`, `info`, `fat` |
| `rename` | `dir(pai)` |
| `move` | `dir(paiOrigem)` **e** `dir(destino)` |
| `formatDisk` | `queryClient.clear()` |

Estado que **não** vai para o cache de query, porque não vem do servidor: path atual, seleção, modo de view, nós expandidos, área de transferência e histórico de navegação.

## Componentes

### `FolderTree`

Mostra **apenas diretórios**, com lazy load por nível usando o mesmo `GET /ls`.

```ts
type TreeNode = {
  path: string
  nome: string
  expandido: boolean
  carregado: boolean
  /** undefined = ainda não sabemos se tem subpastas */
  temFilhos?: boolean
  filhos?: TreeNode[]
}
```

**O problema do `+`:** `GET /ls` não diz se uma pasta contém subpastas. A árvore precisa dessa informação antes de expandir, para decidir se desenha o `+`.

Solução: com `temFilhos === undefined`, desenhe o `+`. Após a primeira expansão, grave o valor real e o `+` some se a pasta não tiver subpastas. A árvore fica correta a partir da primeira visita e o usuário raramente percebe.

O nó raiz chama-se `Meu Disco` e aponta para `/`. Sempre expandido, nunca removível.

```ts
const subpastas = (d: LsData) => d.entradas.filter(e => e.tipo === 'diretorio')
```

Clicar num nó navega. Clicar no `+`/`-` expande sem navegar — são ações distintas, como no XP.

### `FileList`

Dois modos: **Details** e **Icons**. Os outros três do XP (List, Tiles, Thumbnails) ficam no menu desabilitados ou fora.

Colunas de Details:

| Coluna | Origem | Formatação | Largura |
| --- | --- | --- | --- |
| Nome | `nome` | ícone por `tipo` + texto | flex |
| Tamanho | `tamanho` | `2 KB`; vazio para diretório | 80px |
| Tipo | derivado da extensão | `Documento de texto` | 140px |
| Modificado | `mtime` | `24/11/2026 09:15` | 130px |

```ts
// O XP arredondava para cima em KB, e só mostrava bytes abaixo de 1 KB
export const formatSize = (b: number): string =>
  b === 0 ? '' : b < 1024 ? `${b} bytes` : `${Math.ceil(b / 1024).toLocaleString('pt-BR')} KB`

// ctime/mtime vem em SEGUNDOS unix — esquecer o * 1000 joga tudo para 1970
export const formatDate = (unix: number): string =>
  new Date(unix * 1000).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
```

A API não devolve tipo de arquivo, só `arquivo` ou `diretorio`. Derive da extensão:

```ts
const TIPOS: Record<string, string> = {
  txt: 'Documento de texto', md: 'Documento de texto',
  json: 'Arquivo JSON', csv: 'Valores separados por vírgula',
  bin: 'Arquivo binário', dat: 'Arquivo de dados',
}

export const tipoLegivel = (e: LsEntry): string => {
  if (e.tipo === 'diretorio') return 'Pasta de arquivos'
  const ext = e.nome.includes('.') ? e.nome.split('.').pop()!.toLowerCase() : ''
  return TIPOS[ext] ?? (ext ? `Arquivo ${ext.toUpperCase()}` : 'Arquivo')
}
```

**Ordenação** client-side, sobre os dados já carregados. O XP sempre colocava pastas antes de arquivos, qualquer que fosse a coluna:

```ts
const ordenar = (entradas: LsEntry[], col: Coluna, asc: boolean) =>
  [...entradas].sort((a, b) => {
    if (a.tipo !== b.tipo) return a.tipo === 'diretorio' ? -1 : 1
    const r = compara(a, b, col)
    return asc ? r : -r
  })
```

Para a coluna Nome use `localeCompare` com `pt-BR` e `numeric: true`, para `arq2` vir antes de `arq10`.

**`primeiro_cluster` já vem em cada entrada.** Use para acender o `ClusterMap` ao selecionar, sem esperar o `/file/chain`. Arquivo vazio tem `primeiro_cluster: 0`, que não é cluster válido — trate como "sem alocação" e não acenda nada.

### `AddressBar`

Campo editável com o path atual. Enter navega. Path inválido traz 404 e abre dialog de erro, voltando o campo ao valor anterior.

Dropdown opcional com o histórico de paths visitados na sessão.

### `StatusBar`

Três painéis afundados, como no XP:

```tsx
<div className="status-bar">
  <p className="status-bar-field">{n} objeto(s)</p>
  <p className="status-bar-field">{formatSize(somaTamanhos)}</p>
  <p className="status-bar-field">{formatSize(info.espacoLivre)} livres</p>
</div>
```

Com item selecionado, o primeiro painel vira `1 objeto selecionado` e o segundo mostra o tamanho dele — detalhe do XP que custa pouco.

### `Toolbar`

| Botão | Ação | Desabilitado quando |
| --- | --- | --- |
| Voltar | pilha de histórico | pilha vazia |
| Avançar | pilha de avanço | pilha vazia |
| Acima | `parentOf(path)` | `path === '/'` |
| Nova pasta | cria inline no `FileList` | — |
| Modos | dropdown Details / Icons | — |

### `MenuBar`

Dropdowns que abrem no clique e trocam no hover enquanto um está aberto — comportamento clássico de menu.

| Menu | Itens |
| --- | --- |
| Arquivo | Nova pasta, Novo arquivo, Abrir, Renomear, Excluir, Propriedades |
| Editar | Recortar, Copiar, Colar, Selecionar tudo |
| Exibir | Detalhes, Ícones, Atualizar |
| Favoritos | (decorativo) |
| Ferramentas | Formatar disco, Verificar disco, Inspetor de disco |

O item **Inspetor de disco** abre a segunda janela. **Formatar** e **Verificar** abrem seus dialogs.

## Operações de conteúdo

Quatro das sete operações do trabalho mexem nos bytes do arquivo. Elas compartilham um componente, `ContentEditor`, que muda de modo. A quinta é só leitura.

| Modo | Endpoint | Regra | Efeito na FAT |
| --- | --- | --- | --- |
| ler | `GET /file/read` | — | nenhum |
| acrescentar | `POST /file/write` | anexa ao final | pode **estender** a cadeia |
| sobrescrever | `POST /file/overwrite` | `offset + tamanho ≤ atual` | **nenhum** |
| substituir | `POST /file/replace` | troca tudo | pode **encolher ou crescer** |

A coluna da direita é o conteúdo didático. Cada tela mostra a FAT antes e depois, e sobrescrever é a única em que as duas são idênticas — é o que prova que a escrita foi in-place.

### Base64 em tudo

O conteúdo trafega sempre em Base64, nos dois sentidos.

```ts
export const bytesToBase64 = (bytes: Uint8Array): string => {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin)
}

export const base64ToBytes = (b64: string): Uint8Array => {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export const textoParaBase64 = (s: string) => bytesToBase64(new TextEncoder().encode(s))
```

Base64 inválido retorna 400 com "conteudo\_base64 inválido". Como você sempre codifica no cliente, isso só aparece se houver bug seu.

### Onde o offset cai

A tela 13 mostra `Offset: 600 bytes (cluster 13, posição 88)`. Esse cálculo é do cliente, a partir da cadeia:

```ts
export function localizarOffset(offset: number, cadeia: number[], clusterSize: number) {
  const indice = Math.floor(offset / clusterSize)
  return {
    cluster: cadeia[indice] ?? null,   // null = offset alem da cadeia
    posicao: offset % clusterSize,
    indiceNaCadeia: indice,
  }
}
```

Com cadeia `[12, 13, 14]` e clusters de 512: offset 600 cai no índice 1, que é o cluster 13, posição 88. Mostrar isso enquanto o usuário digita o offset é o que transforma um campo numérico em demonstração de como o sistema de arquivos endereça bytes.

### Validação de sobrescrever

```ts
export const validarOverwrite = (offset: number, tamanhoNovo: number, tamanhoAtual: number) =>
  offset < 0            ? 'O offset não pode ser negativo.'
  : offset + tamanhoNovo > tamanhoAtual
      ? `${offset} + ${tamanhoNovo} = ${offset + tamanhoNovo} B passa do tamanho atual (${tamanhoAtual} B). Use Substituir para expandir.`
  : null
```

Valide enquanto digita, não no envio: o usuário vê a conta que o backend faria.

### Prevendo o efeito na FAT

As telas 12 e 14 mostram tabelas `Cluster | FAT[n] antes | FAT[n] depois`. São **previsão local**, calculada antes de enviar — não venha do servidor. Depois da escrita, invalide e refaça o fetch: a verdade é o que a API devolver.

```ts
const clustersNecessarios = (bytes: number, cs: number) => Math.ceil(bytes / cs)

/** Acrescentar: quantos clusters novos, e onde a cadeia se liga. */
export function preverAppend(cadeia: number[], tamAtual: number, novos: number, cs: number) {
  const precisa = clustersNecessarios(tamAtual + novos, cs)
  return {
    clustersNovos: Math.max(0, precisa - cadeia.length),
    ultimoAtual: cadeia.at(-1) ?? null,   // FAT[ultimoAtual]: EOF -> primeiro novo
    tamanhoNovo: tamAtual + novos,
  }
}

/** Substituir: o que sobra, o que se libera. */
export function preverReplace(cadeia: number[], tamNovo: number, cs: number) {
  const precisa = clustersNecessarios(tamNovo, cs)
  return {
    mantidos: cadeia.slice(0, precisa),      // FAT[ultimo mantido] -> EOF
    liberados: cadeia.slice(precisa),        // FAT[cada um] -> 0
    clustersNovos: Math.max(0, precisa - cadeia.length),
  }
}
```

Com cadeia `[12, 13, 14]` e novo conteúdo de 400 B em clusters de 512: `precisa = 1`, mantidos `[12]`, liberados `[13, 14]`. A tabela da tela 14 sai disso:

```
12   13    EOF
13   14    0 (livre)
14   EOF   0 (livre)
```

Isso espelha exatamente o que `substituir()` faz no backend quando o conteúdo encolhe: trunca a cadeia, grava EOF no último mantido e libera o resto.

**Cuidado com a previsão de clusters novos:** você sabe quantos, não quais. A alocação é first-fit no servidor e depende do estado da FAT naquele instante. Mostre "2 clusters serão alocados", nunca "os clusters 24 e 25 serão alocados".

### `FileViewer`

Dois modos, escolhidos por heurística:

```ts
// o backend decodifica como UTF-8 com errors='replace'
const pareceBinario = (texto: string) => texto.includes('�')
```

Texto vai para `<textarea>` monoespaçado. Binário vira hexdump a partir de `conteudo_base64`, no formato clássico: offset, 16 bytes em hexa, coluna ASCII com ponto para não imprimível.

A heurística erra para um `.txt` com byte inválido. Ofereça alternar entre os modos em vez de decidir sozinho.

### `MoveDialog`

A tela 16 deixa explícito que nenhum dado é copiado — só a entrada de diretório muda, e a cadeia permanece. Mostre a cadeia idêntica antes e depois, como a tela 13 faz.

Três validações antes de enviar: destino precisa existir e ser diretório; o nome não pode existir no destino (409); e mover pasta para dentro de si mesma é recusado com 400.

## Interações e dialogs

### Seleção

Guarde **paths**, nunca índices — índice quebra quando a lista reordena ou um item some.

```ts
const [selecao, setSelecao] = useState<Set<string>>(new Set())
```

| Gesto | Comportamento |
| --- | --- |
| clique | seleciona só aquele item |
| Ctrl+clique | alterna aquele item, mantém os demais |
| Shift+clique | faixa do âncora até o item, na ordem **atual** da lista |
| arrastar no vazio | marquee: retângulo tracejado, seleciona o que intersecta |
| Ctrl+A | tudo |
| clique no vazio | limpa |

Shift+clique precisa do índice do último item clicado **na ordenação vigente**. Guarde esse âncora separado da seleção e recalcule a faixa sobre o array já ordenado.

### Atalhos

| Tecla | Ação |
| --- | --- |
| F2 | renomear inline |
| Delete | excluir, com confirmação |
| Enter | abrir (pasta navega, arquivo abre no visualizador) |
| Backspace | subir um nível |
| Ctrl+X / Ctrl+C / Ctrl+V | recortar / copiar / colar |
| Ctrl+A | selecionar tudo |
| F5 | invalidar as queries do diretório atual |
| Alt+Enter | Propriedades |

**Recortar/colar mapeia em `POST /file/move`.** Copiar/colar exigiria duplicar conteúdo: leia com `/file/read`, crie com `/file/create` e grave com `/file/write`. Se o prazo apertar, implemente só recortar — é uma chamada.

Drag-and-drop entre pastas entrega a mesma funcionalidade de recortar/colar por várias vezes o custo. Deixe como etapa opcional, no fim.

### Renomear inline

F2 troca o nome por um `<input>` dentro da própria linha, com o texto antes do ponto pré-selecionado — detalhe do XP que vende muito:

```ts
const ponto = nome.lastIndexOf('.')
input.setSelectionRange(0, ponto > 0 ? ponto : nome.length)
```

Enter confirma, Escape cancela, blur confirma. Valide antes de enviar e mantenha o input aberto com a mensagem se falhar.

```ts
export const MAX_NAME = 31   // limite real do backend

export const validateName = (nome: string): string | null => {
  if (!nome.trim()) return 'O nome não pode ficar em branco.'
  if (nome.includes('/')) return 'Um nome não pode conter o caractere /.'
  if (nome.length > MAX_NAME) return `O nome deve ter no máximo ${MAX_NAME} caracteres.`
  return null
}
```

Validação de duplicata é **case-sensitive** neste backend: compare `e.nome === nome`, sem `toLowerCase()`.

### Context menu

Botão direito. Conteúdo varia pelo alvo:

| Alvo | Itens |
| --- | --- |
| arquivo | Abrir, Recortar, Copiar, Renomear, Excluir, Propriedades |
| pasta | Abrir, Recortar, Copiar, Renomear, Excluir, Propriedades |
| área vazia | Nova pasta, Novo arquivo, Colar, Atualizar |
| seleção múltipla | Recortar, Copiar, Excluir |

Renderize em portal, posicionado no cursor, fechando com clique fora, Escape ou scroll.

### Dialogs

Um por vez, em portal, modal com overlay. `DialogHost` controla qual está aberto.

**`ConfirmDelete`** — textos distintos por caso, como no XP:

| Caso | Título | Texto |
| --- | --- | --- |
| 1 arquivo | Confirmar Exclusão de Arquivo | Tem certeza que deseja excluir `nome`? |
| N itens | Confirmar Exclusão de Vários Itens | Tem certeza que deseja excluir estes N itens? |
| pasta vazia | Confirmar Exclusão de Pasta | Tem certeza que deseja excluir `nome`? |
| pasta com conteúdo | Confirmar Exclusão de Pasta | A pasta `nome` contém itens. Excluir tudo? |

**Excluir pasta com conteúdo precisa de recursão no cliente.** O backend devolve 409 e não aceita `?recursivo=true`:

```ts
async function removerRecursivo(path: string, onProgress?: (p: string) => void) {
  const { entradas } = await api.ls(path)
  for (const e of entradas) {
    const filho = joinPath(path, e.nome)
    if (e.tipo === 'diretorio') await removerRecursivo(filho, onProgress)
    else await api.remove(filho)
    onProgress?.(filho)
  }
  await api.remove(path)
}
```

Não é atômico: falha no meio deixa a pasta parcialmente apagada. Liste e conte **antes** de apagar, aí a barra de progresso é real em vez de fingida.

**`Properties`** — duas abas:

| Aba | Campos |
| --- | --- |
| Geral | nome, tipo legível, tamanho em bytes e KB, criado em, modificado em |
| Detalhes | primeiro cluster, cadeia, número de clusters, espaço ocupado, slack interno |

A aba Detalhes vem de `GET /file/chain` e é onde o trabalho fica interessante: mostrar que um arquivo de 1300 bytes ocupa 1536 e desperdiça 236 é fragmentação interna na tela.

```tsx
const { data } = useQuery({
  queryKey: keys.chain(path),
  queryFn: () => api.chain(path),
  enabled: aba === 'detalhes' && tipo === 'arquivo',
})
```

A API não devolve atributos (somente leitura, oculto, sistema, arquivo morto). A aba Geral não tem checkboxes — não invente campos que o backend não tem.

**`Format`** — três campos:

```tsx
type FormatForm = {
  variante: 'fat16' | 'fat32'   // default 'fat16'
  cluster_size: number          // default 512
  num_clusters: number          // default 256 (fat16) / 1024 (fat32)
}
```

- `cluster_size` num `<select>` com 64, 128, 256, 512, 1024, 2048 — assim a regra de potência de 2 fica impossível de violar
- ao trocar a variante, atualize o default de `num_clusters` se o usuário ainda não editou o campo
- mostre o tamanho total em tempo real: `cluster_size × num_clusters`
- **formatar apaga o disco inteiro**: confirmação em dois passos, com o botão destrutivo sem foco inicial

**`ErrorDialog`** — título pelo status, corpo sempre com a mensagem do backend:

| HTTP | Título |
| --- | --- |
| 400 | Erro |
| 404 | Item não encontrado |
| 409 | Conflito de nome |
| 500 | Erro inesperado |
| rede | Sem conexão com o servidor |

O caso de rede é seu, não do backend: `fetch` rejeita antes de haver corpo. Trate separado — com servidor local, esse é o erro mais frequente durante o desenvolvimento. Dê a ele botão "Tentar novamente".

**`Progress`** — barra segmentada do XP (blocos, não contínua). Use em exclusão recursiva, upload múltiplo e formatação. Nas três você tem contagem real.

**`FileViewer`** — abre `.txt` em `<textarea>`; salva com `POST /file/replace`. Para binário, mostre hexdump do `conteudo_base64` em vez de texto:

```ts
// heurística documentada pelo próprio backend
const pareceBinario = (texto: string) => texto.includes('�')
```

### Upload

Não existe multipart. Upload é sempre duas chamadas:

```ts
async function upload(dir: string, file: File) {
  const path = joinPath(dir, file.name)
  await api.createFile(path)
  try {
    return await api.write(path, await fileToBase64(file))
  } catch (e) {
    await api.remove(path).catch(() => {})   // nao deixa arquivo vazio orfao
    throw e
  }
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '')
    r.onerror = () => reject(r.error)
    r.readAsDataURL(file)
  })
}
```

O `catch` importa: se `create` passa e `write` falha por disco cheio, sem ele fica um arquivo vazio órfão no diretório.

Nome de arquivo local pode passar de 31 caracteres ou conter `/`. Valide e ofereça renomear no dialog antes de enviar.

## Disk Inspector

Segunda janela, aberta pelo menu Ferramentas. Estética do **Disk Defragmenter do XP** — que era literalmente um mapa de blocos colorido. O tema autêntico coincide com a necessidade didática.

Três painéis, todos alimentados por endpoints que já existem.

### `ClusterMap`

Construído sobre `GET /disk/fat`, que devolve a tabela inteira numa chamada.

```tsx
const { data } = useQuery({ queryKey: keys.fat, queryFn: api.diskFat })
const acesos = new Set(chainData?.cadeia ?? [])

<div className="cluster-map">
  {data?.entradas.map(c => (
    <span
      key={c.cluster}
      className={cls('cluster', clusterState(c.status), { aceso: acesos.has(c.cluster) })}
      title={`Cluster ${c.cluster}: ${c.status}`}
      onClick={() => selecionarCluster(c.cluster)}
    />
  ))}
</div>
```

O `status` vem como string. Converta:

```ts
export type ClusterState = 'livre' | 'usado' | 'fim' | 'defeituoso'

export const clusterState = (status: string): ClusterState => {
  if (status === 'livre') return 'livre'
  if (status === 'EOF') return 'fim'
  if (status === 'defeituoso') return 'defeituoso'
  return 'usado'   // '→ N'
}

/** '→ 5' -> 5 ; os demais -> null */
export const nextCluster = (status: string): number | null => {
  const m = /^→\s*(\d+)$/.exec(status)
  return m ? Number(m[1]) : null
}
```

Cinco estados visuais:

| Estado | Origem | Cor |
| --- | --- | --- |
| livre | `'livre'` | branco, borda cinza |
| usado | `'→ N'` | azul `#3A6EA5` |
| fim de cadeia | `'EOF'` | azul escuro `#1E3C5A` |
| defeituoso | `'defeituoso'` | vermelho `#C0392B` |
| aceso | pertence à seleção | amarelo `#FFD700`, sobrepõe |

Distinguir `usado` de `EOF` não é cosmético: ver onde cada cadeia termina é metade do valor didático do mapa.

Com 256 ou 1024 clusters, um `<span>` por cluster é tranquilo. `display: grid` com `grid-template-columns: repeat(auto-fill, 14px)`.

### `ChainView`

Alimentado por `GET /file/chain` do arquivo selecionado.

```tsx
<div className="chain">
  {data.cadeia.map((c, i) => (
    <Fragment key={c}>
      <span className="cluster-chip">{c}</span>
      {i < data.cadeia.length - 1 && <span className="seta">→</span>}
    </Fragment>
  ))}
  <span className="seta">→</span>
  <span className="eof">EOF</span>
</div>
```

Abaixo, os números que a API já entrega prontos:

| Rótulo | Campo |
| --- | --- |
| Clusters | `num_clusters` |
| Tamanho real | `tamanho_arquivo` |
| Espaço ocupado | `tamanho_total_clusters` |
| Desperdício interno | `slack_interno` |

Marque quando a cadeia não for contigua — é a demonstração mais direta de fragmentação:

```ts
export const fragmentado = (c: number[]): boolean =>
  c.some((v, i) => i > 0 && v !== c[i - 1] + 1)
```

### `CheckReport`

`POST /disk/check` responde **200 mesmo quando encontra inconsistências**. O envelope vem `ok: true` com `consistente: false` e a lista em `erros`. Não é erro de API — é resultado da verificação.

```tsx
{data.consistente
  ? <p className="ok">Nenhum problema encontrado.</p>
  : <ul>{data.erros.map(e => <li key={e}>{e}</li>)}</ul>}
```

Exiba como relatório com ícone de aviso, nunca como dialog de erro. Como é caro, rode sob demanda:

```ts
useQuery({ queryKey: keys.check, queryFn: api.diskCheck, enabled: false, staleTime: Infinity })
```

O backend detecta cross-linked clusters, clusters órfãos e cadeia inconsistente com `file_size`. São os defeitos clássicos de FAT, e ter uma tela que os mostra rende bem na apresentação.

### Não existe leitura de setor bruto

A API não expõe dump de bytes do disco. Um hexdump por **arquivo** é possível a partir de `conteudo_base64` de `/file/read`, e já entrega valor. Não invente um endpoint que não existe.

## Fidelidade visual

O que separa "inspirado no XP" de "parece o XP" são poucos detalhes concretos.

| Elemento | Valor |
| --- | --- |
| Fonte da interface | Tahoma 11px, fallback Verdana (o XP não usava Segoe) |
| Seleção | fundo `#316AC5`, texto branco |
| Title bar ativa | gradiente `#0058EE` → `#3A93FF`, texto branco negrito |
| Title bar inativa | gradiente `#7A96DF` → `#A6C3F0` |
| Fundo de janela | `#ECE9D8` (bege do Luna) |
| Borda afundada | `#7F9DB9` 1px |
| Desktop | papel de parede próprio em CSS/SVG: céu em degradê `#1C5ACB` → `#D9E9FA`, nuvens, morro verde (sem a foto Bliss); `#5A7EDC` só no fundo do `body` |
| Botão Iniciar | verde `#3C8A2E`, cantos arredondados à direita |
| Barra de tarefas | gradiente azul `#245EDC` → `#3F8CF3`, 30px |
| Linhas de grade da lista | `#C4C4C4` |
| Cabeçalho de coluna | fundo `#F1F1F1`, texto normal (não negrito) |

Detalhes de comportamento que vendem mais que pixel:

- A linha selecionada **continua azul** quando a lista perde foco, só que em cinza `#D4D4D4` com texto preto
- Duplo clique numa pasta navega; num arquivo, abre
- O cabeçalho de coluna mostra um triângulo pequeno indicando o sentido da ordenação
- A barra de progresso é **segmentada** em blocos verdes, não contínua
- Botões de dialog têm 75×23px e o padrão vem com borda mais grossa

### Ícones e sons

Ícones e sons são próprios: SVGs desenhados no projeto e sons sintetizados com Web Audio (`lib/sound.ts`), com opção de silenciar. Nenhum arquivo da Microsoft.

### O que cortar

Estas coisas consomem tempo e não acrescentam nada à demonstração do sistema de arquivos:

- Modos de view Tiles e Thumbnails
- Clippy

(A área de trabalho do XP foi feita depois, em escopo próprio: ver a spec em `docs/superpowers/specs/`.)

## Ordem de execução

Cada fase termina em algo verificável por comando ou por observação direta. Rode `npm run check` ao fim de cada uma.

### Fase 0 — Camada de API

O scaffold entregue antes foi escrito contra o contrato em PDF, não contra o backend. **Três arquivos precisam de correção antes de qualquer componente:**

| Arquivo | Correção |
| --- | --- |
| `client.ts` | ler `detail`, decidir sucesso por `res.ok` |
| `types.ts` | `DiskInfoRaw` com os campos string; `DiskInfo` normalizado |
| `normalize.ts` | arquivo novo: `normalizarInfo`, `numerico` |
| `mock.ts` | erro no formato `{detail}`; comparação case-sensitive; sem disco = 400 |

**Aceite:** o smoke do mock passa; `GET /disk/info` pelo client real devolve `clusterSize: 512` como número; derrubar o backend produz `NetworkError`, não erro de parse.

### Fase 1 — Shell estático

`xp.css`, janela, title bar, menu bar, toolbar, address bar, split pane, status bar. Dados fixos.

**Aceite:** a janela parece o Explorer do XP numa captura, sem nenhuma chamada de rede.

### Fase 2 — Navegação (telas 01, 03, 04)

`/ls` e `/disk/info` ligados. `FolderTree` com lazy load, `FileList` em Details com ordenação, histórico de Voltar/Avançar.

**Aceite:**

- navegar até o terceiro nível e voltar, com árvore e lista sincronizadas
- criar `/Docs` e `/docs` pelo Swagger — as duas aparecem como pastas distintas
- pasta vazia mostra o estado da tela 03, não uma lista em branco

O segundo item é o teste de case-sensitive. Se as duas colapsarem numa só, há `toLowerCase()` no caminho.

### Fase 3 — Metadados (telas 09, 10, 15a, 15b, 16)

`mkdir`, `create`, `rename`, `move`, `delete`. Renomear inline, mover, exclusão com confirmação e exclusão recursiva com progresso.

**Aceite:**

- criar pasta, criar arquivo dentro, renomear os dois, mover, apagar — sem recarregar
- apagar na lista atualiza árvore, status bar e mapa na mesma ação
- nome duplicado abre o estado 15b com a mensagem do backend
- nome de 32 caracteres é barrado no input, antes do request
- apagar pasta com três níveis mostra progresso com contagem **real**
- o 64º arquivo na raiz falha com "Diretório pai cheio"

### Fase 4 — Conteúdo (telas 11a, 11b, 12, 13, 14)

As quatro operações sobre bytes, com previsão de efeito na FAT.

**Aceite:**

- subir texto, abrir, acrescentar, reabrir e ver o conteúdo concatenado
- **sobrescrever no meio não muda nenhuma célula do mapa de clusters** — compare antes e depois
- substituir por conteúdo menor libera clusters, e o mapa mostra os buracos
- offset 1250 num arquivo de 1300 B com 80 B novos é barrado no cliente
- arquivo binário abre em hexdump, não em texto com caracteres estranhos

O segundo é o mais importante do projeto inteiro: é a prova visual de escrita in-place.

### Fase 5 — Inspeção (telas 06, 07, 18a, 18b)

Propriedades com as duas abas, `ClusterMap`, `ChainView`, relatório de verificação.

**Aceite:**

- selecionar arquivo acende exatamente os clusters de `/file/chain`
- a contagem de livres no mapa bate com `clusters_livres` de `/disk/info`
- a tabela `FAT[n]` da aba Detalhes bate com `/disk/fat` nos mesmos clusters
- `slack_interno` aparece e confere: `num_clusters × cluster_size − tamanho_arquivo`
- fim de cadeia tem cor distinta de cluster em uso

### Fase 6 — Disco (telas 05, 08, 17, 19)

Formatar, disco não formatado, FAT32, erro de espaço.

**Aceite:**

- apagar o `.img` e recarregar abre o dialog de formatar, não um erro
- formatar como FAT32 com 1024 clusters e o mapa se redimensiona sozinho
- encher o disco produz a tela 05 com os números certos de necessário e livre
- reiniciar o backend **não** perde os dados

### Roteiro de demonstração

Monte e ensaie — é o que vai ao ar:

1. Formatar FAT16, 512 B por cluster, 256 clusters — mapa todo livre
2. Criar `/DOCS`, subir dois arquivos — clusters acendem em sequência
3. Apagar o do meio — buraco visível no mapa
4. Subir um arquivo maior que o buraco — **fragmentação acontece na tela**
5. Propriedades, aba Detalhes FAT — a tabela mostra o encadeamento e o slack
6. Sobrescrever no meio desse arquivo — o conteúdo muda, **o mapa não**
7. Substituir por conteúdo menor — a cadeia encolhe, clusters voltam a ficar livres
8. Verificar disco — consistente
9. Reformatar como FAT32 — 1024 clusters, raiz como cadeia

Os passos 3 e 4 produzem a fragmentação ao vivo; o 6 prova que nem toda escrita realoca. Teste antes que os tamanhos escolhidos realmente produzem fragmentação com esses parâmetros — se o buraco ficar no fim da área usada, o first-fit aloca contiguo e a demonstração perde o efeito.
