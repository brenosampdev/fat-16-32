# Telas dos mockups

Extraído do export do Claude Design (v2). Este arquivo existe para ser lido
por IA sem custo de contexto: o `.html` ao lado renderiza o mesmo conteúdo
no navegador, mas pesa 1,9 MB e quase tudo é bundle JavaScript.

O cromo é neutro de propósito. Cores, bordas e fontes vêm do `xp.css` na
implementação — o que vale aqui são as proporções, a hierarquia, os estados
e as anotações de comportamento.

## Janela principal e estados

Telas geradas a partir do mesmo layout de janela, variando o estado:

### 01 — Principal: arquivo fragmentado selecionado

- Principal: arquivo fragmentado selecionado
- A árvore tem 200 px fixos. O painel direito empilha a lista, flexível, e o mapa, com 176 px fixos e sempre visível.
- A lista mostra só o que a listagem devolve, inclusive o 1º cluster. A coluna Fragmentos saiu.
- A contagem de fragmentos aparece só na status bar e na tira do mapa, para o item selecionado: exige ler a cadeia, uma chamada por seleção e não por arquivo.

### 02 — Seleção múltipla

- Com até 2 itens, cada um ganha um tom (claro no meio, escuro no fim). A partir de 3, todos usam o primário e a tira lista só os fragmentados.
- O foco (contorno pontilhado) fica no último item clicado, que é a âncora do Shift+clique.

### 03 — Pasta vazia

- Com o foco na árvore, a seleção dela fica no tom primário. A lista mostra a mensagem onde a primeira linha estaria.
- Uma pasta vazia ocupa um cluster, que é ao mesmo tempo início e fim da cadeia.

### 04 — Carregando

- O mapa é preenchido à medida que a FAT é lida.
- A toolbar fica desabilitada até o fim da leitura.
- Células ainda não lidas ficam transparentes e se confundem com o vão da grade, para não parecerem livres.

### 05 — Erro: espaço insuficiente

- Selecione um arquivo para ver sua cadeia de clusters.
- Erros abrem um dialog modal sobre a janela, sem escurecer o fundo, com números (necessário e livre).
- A alocação é atômica: se faltar espaço, nada é gravado e o mapa não muda.

### 15a — Renomear: edição na linha

- Renomeando relatorio.txt: Enter confirma, Esc cancela
- Abre com F2, com Renomear ou com um clique lento num item já selecionado. O nome antes do ponto vem selecionado, então digitar substitui só o nome e preserva a extensão.
- O contador mostra o limite de 31 caracteres. Barra (/ ou \\) é recusada na digitação, e o campo pisca sem aceitar o caractere.
- Renomear só reescreve a entrada de diretório: a cadeia 12 → 13 → 14 não muda.

### 15b — Renomear: nome duplicado

- Já existe "dados.bin" nesta pasta. Escolha outro nome.
- O erro aparece num balão preso ao campo, que continua aberto com o texto digitado para o usuário corrigir sem redigitar.
- A comparação ignora maiúsculas e minúsculas, como no FAT: "DADOS.BIN" também conflita.

### 17 — Disco não formatado

- Sem disco aberto: não há tabela de alocação para mostrar.
- É o primeiro estado quando o arquivo de disco não existe. Todo endpoint responde "Nenhum disco aberto", e o cliente trata essa resposta abrindo o Formatar direto, nunca um erro genérico.
- Só Formatar fica ativo na toolbar. Cancelar fecha o dialog e deixa a mensagem na lista; o dialog volta pelo menu Disco.

### 19 — FAT32: 1024 clusters, raiz como cadeia

- FAT32: 1024 clusters, raiz como cadeia
- Com 1024 células a grade passa para 64×16 com células de 8 px (575×143 px) e continua legível: o cinza vira textura, e a seleção azul e os defeituosos vermelhos ainda saltam.
- Abaixo de 8 px a célula deixa de ser clicável com precisão. Acima de 1024 clusters a recomendação é agrupar 4 clusters por célula, com cor pela maioria, e não reduzir mais.
- A raiz aparece selecionada para mostrar a diferença do FAT32: ela é uma cadeia como qualquer pasta (2 → 3 → 97) e pode se fragmentar. Em FAT16 ela não aparece no mapa.

## Dialogs e telas detalhadas

### 11a — Ler: texto

```
relatorio.txt (somente leitura) ×
Texto
Hexadecimal
Acrescentar… Sobrescrever… Substituir…
1.300 B em 3 clusters: 12 → 13 → 14 → EOF
Base64: 1.736 caracteres
UTF-8
Abre com duplo clique ou Enter. O conteúdo chega em Base64 e é decodificado no cliente; o tamanho em Base64 fica visível porque é o que trafega.
Os botões de escrita na barra abrem os dialogs 12, 13 e 14 sobre o mesmo arquivo.
```

### 11b — Ler: binário em hexadecimal

```
dados.bin (somente leitura) ×
Texto
Hexadecimal
O conteúdo não é texto: a API devolveu caracteres de substituição (U+FFFD). A exibição passou para hexadecimal automaticamente.
2.600 B em 6 clusters, 2 fragmentos
Base64: 3.468 caracteres
O aviso usa o ícone de atenção, não o de erro: a leitura funcionou, só a representação muda.
O hexdump marca a fronteira entre clusters a cada 512 B. A fronteira no offset 0x0400 é onde a cadeia salta de 11 para 15, e o arquivo continua sem interrupção no conteúdo.
```

### 12 — Escrever: acrescentar ao final

```
Acrescentar a relatorio.txt ×
Conteúdo atual (final):
…e a tabela de alocação é lida uma única vez na montagem.
Próximos passos: medir a fragmentação após 100 operações.
Texto a acrescentar:
Resultados preliminares: após 100 operações de escrita intercaladas, 38% dos arquivos ficaram fragmentados, com média de 2,4 fragmentos por arquivo. A seção 5 discute o impacto do tamanho do cluster nesse número.|
Efeito na FAT
Tamanho 1.300 B → 1.720 B (+420 B)
Clusters 3 → 4 (1 alocado)
```

### 24 — novo

```
EOF
Cluster FAT[n] antes FAT[n] depois
```

### 24 — 0 (livre) EOF

```
Os primeiros 236 B vão para a sobra do cluster 14; os 184 B restantes vão para o cluster 24.
Acrescentar
Cancelar
O grupo "Efeito na FAT" recalcula a cada tecla. Ele mostra antes de confirmar quantos clusters serão alocados e onde a cadeia cresce.
O cluster novo usa o verde de criação, distinto do azul da seleção. A tabela usa o mesmo vocabulário FAT[n] do 07 .
Par didático: mesma aparência, efeitos opostos sobre a FAT
Os dois dialogs têm a mesma estrutura. Só o grupo "Efeito na FAT" diverge.
```

### 13 — Sobrescrever: bytes no lugar

```
Sobrescrever em relatorio.txt ×
Offset:
600
bytes (cluster 13, posição 88)
Novo trecho (80 B):
a alocação first-fit percorre a FAT a partir do cluster 2, sem índice auxiliar.|
…cada arquivo guarda só o primeiro cluster; a alocação first-fit percorre a FAT a partir do cluster 2, sem índice auxiliar. O restante da cadeia…
600 + 80 = 680 ≤ 1.300 B
Efeito na FAT
A tabela de alocação não muda.
Antes
Depois
Tamanho 1.300 B → 1.300 B
Cadeia 12 → 13 → 14 → EOF (idêntica)
FAT[n] nenhuma entrada alterada
Só o conteúdo do cluster 13 (contorno) é reescrito.
Sobrescrever
Cancelar
Estado inválido
Offset: 1250
1.250 + 80 = 1.330 B passa do tamanho atual (1.300 B). Use Acrescentar para crescer o arquivo.
O botão Sobrescrever fica desabilitado enquanto a soma passar do limite.
É a única operação que não toca na FAT. A tela prova isso com dois mapas iguais e "nenhuma entrada alterada" escrito por extenso.
O offset é traduzido para cluster e posição (600 = 512 + 88), que é o cálculo que o backend faz.
```

### 14 — Substituir: todo o conteúdo

```
Substituir conteúdo de relatorio.txt ×
Offset:
não se aplica: o arquivo inteiro é trocado
Novo conteúdo (400 B):
Relatório parcial: versão resumida
Simulador de FAT16/FAT32 com sete operações: ler, escrever, sobrescrever, apagar, substituir, renomear e mover. A versão completa deste relatório foi movida para DOCS\tcc.doc.|
1.300 B → 400 B
Efeito na FAT
A cadeia encolhe de 3 para 1 cluster.
Antes
Depois
12
EOF
liberados:
13 14
Cluster FAT[n] antes FAT[n] depois
```

### 14 — EOF 0 (livre)

```
Substituir
Cancelar
O campo offset aparece desabilitado, na mesma posição do 13, para a comparação lado a lado ser direta: o que muda é o grupo "Efeito na FAT".
Os clusters liberados ficam com contorno tracejado vermelho no mapa "Depois" e linhas em vermelho na tabela. Se o novo conteúdo for maior, a tabela mostra os clusters alocados em verde, como no 12 .
```

### 16 — Mover

```
Mover itens ×
Mover "dados.bin" para:
− A:\ (pasta atual)
+ DOCS
+ IMAGENS
BACKUP
O que muda
Nenhum dado é copiado. Só a entrada de diretório muda de lugar.
Entrada sai de A:\ (área da raiz)
Entrada vai para A:\BACKUP (cluster 4)
Bytes copiados 0
FAT[n] nenhuma entrada alterada
Cadeia
10 11
```

### 15 — 16 17 18

```
EOF
mesma
Mover
Cancelar
Recortar (Ctrl+X) e colar (Ctrl+V) chamam o mesmo endpoint. Após o corte, o item fica esmaecido na lista até ser colado.
A própria pasta de origem fica marcada como "(pasta atual)", e mover para ela desabilita o botão Mover.
Exceção a explicar na apresentação: se o cluster da pasta de destino estiver cheio (16 entradas de 32 B), a pasta ganha um cluster novo. A cadeia do arquivo continua intacta.
Janela principal e estados
Verificação de consistência
```

### 18a — Verificação: disco limpo

```
Verificação de consistência: A: ×
Nenhum problema encontrado.
Verificado
Entradas de diretório 9
Cadeias percorridas 9
Clusters em uso 34
Clusters defeituosos 2 (marcados, sem dono)
Clusters livres 220
Testes
✓ Nenhum cluster compartilhado entre arquivos
✓ Nenhum cluster ocupado sem dono
✓ Tamanho de cada cadeia compatível com o tamanho registrado
Verificar novamente
Fechar
O relatório limpo lista os três testes que passaram. "Nenhum problema" sozinho não ensina o que foi verificado.
Fica em Disco › Verificar e na toolbar ("Verificar disco").
```

### 18b — Verificação: três problemas

```
Verificação de consistência: A: ×
3 problemas encontrados. O disco continua utilizável; os itens abaixo podem dar leituras incorretas.
Problema Clusters Detalhe
Cluster compartilhado 16 dados.bin (15 → 16) e DOCS\notas.txt (6 → 16) apontam para o mesmo cluster.
Ocupado sem dono 27 FAT[27] = EOF, mas nenhuma entrada de diretório chega a ele.
Tamanho divergente 12–14 relatorio.txt registra 2.000 B; a cadeia de 3 clusters comporta no máximo 1.536 B.
Clusters 2–33
Copiar relatório
Verificar novamente
Fechar
É um relatório, não um erro: ícone de atenção, nada bloqueado. Não há botão "Corrigir" porque o backend só detecta.
Cada problema nomeia os clusters envolvidos e os contorna no minimapa, com o mesmo vocabulário FAT[n] do 07 .
Clicar numa linha seleciona o arquivo na janela principal e destaca a cadeia no mapa grande.
Dialogs
```

### 06 — Propriedades: Geral

```
Propriedades de dados.bin ×
Geral
Detalhes FAT
dados.bin
Tipo Arquivo
Local A:\
Tamanho 2.600 bytes
Em disco 3.072 bytes (6 clusters)
1º cluster 10
Criado 12/11/2026 16:40:12
Modificado 18/11/2026 10:02:46
OK
Cancelar
A tela mostra só os campos que a API devolve: nome, tipo, tamanho, primeiro_cluster, ctime e mtime. "Em disco" é derivado do tamanho e do cluster_size.
Editar o nome aqui equivale a Renomear ( 15a ). OK confirma, Cancelar descarta.
```

### 07 — Propriedades: Detalhes FAT

```
Propriedades de dados.bin ×
Geral
Detalhes FAT
1º cluster 10 (na entrada de diretório)
Fragmentos 2
# Cluster FAT[n] Observação
Slack (último cluster: 18)
Usado 40 de 512 B
Desperdiçado 472 B (15,4% do espaço em disco)
OK
Cancelar
A tabela é literalmente FAT[n]: cada linha mostra o valor gravado no cluster. Com isso o aluno lê o encadeamento como o sistema de arquivos lê.
A quebra de fragmento é uma linha divisória, e a observação nomeia quem ocupa o vão.
O slack aparece só no último cluster, porque é o único com sobra.
```

### 08 — Formatar

```
Formatar A: ×
Sistema de arquivos: FAT16 ▼
Tamanho do cluster: 512 bytes ▼
Número de clusters: 256
Capacidade (calculada): 131.072 bytes (128 KB)
Resultado
Clusters de dados 256 (2–257)
Tabela FAT 1 × 512 B
Entradas na raiz 64 (fixa)
Espaço útil 131.072 B
Iniciar
Fechar
Os três campos editáveis são os parâmetros do endpoint (variante, cluster_size e num_clusters). A capacidade só é exibida.
FAT16: uma tabela de 256 × 2 B e raiz fixa de 64 entradas. Para a demo, a 65ª criação na raiz falha com "A raiz está cheia (64 entradas)".
FAT32: a tabela passa a 1024 × 4 B, e a linha "Entradas na raiz" vira "Raiz: cadeia a partir do cluster 2".
```

### 09 — Confirmar exclusão

```
Confirmar exclusão de arquivo ×
Excluir "dados.bin" definitivamente?
6 clusters voltarão a ficar livres:
10 11
```

### 15 — 16 17 18

```
A FAT marca os clusters como 0 e a entrada de diretório recebe 0xE5. Os dados não são apagados.
Sim
Não
O padrão é Não: a ação é irreversível e Enter não deve apagar nada por acidente.
Na seleção múltipla, o texto muda para "Excluir 2 itens?" e os fragmentos de cada arquivo aparecem em linhas próprias.
```

### 10 — Progresso: excluindo pasta com conteúdo

```
Excluindo A:\DOCS
Excluindo DOCS\tcc.doc (item 2 de 3)
Itens excluídos 1 de 3
Clusters liberados 2 de 8
Liberando agora 19 → 20 → 21 → 22 → 23
DOCS\notas.txt
DOCS\tcc.doc
DOCS (a pasta, por último)
Cancelar
A API não exclui de forma recursiva. O cliente percorre a pasta em pós-ordem, faz uma chamada por item e exclui a pasta por último. A barra avança um bloco por chamada.
Cancelar para entre dois itens: a pasta continua existindo com o que sobrou e nenhuma cadeia fica pela metade.
Parte de uma confirmação no formato do 09 : "Excluir DOCS e seus 2 itens? 8 clusters voltarão a ficar livres."
```
