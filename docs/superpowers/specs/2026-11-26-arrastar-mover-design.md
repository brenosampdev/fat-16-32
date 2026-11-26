# Arrastar para mover — desenho

26/11/2026 · aprovado (pastas e arquivos)

## Intenção

Mover arquivos e pastas como no Explorer do XP: segurar o botão esquerdo sobre o item,
arrastar até uma pasta e soltar. Hoje mover só existe por Recortar/Colar (Ctrl+X/V) e
pelo diálogo Mover; o arrastar é o jeito que qualquer pessoa tenta primeiro, inclusive na
apresentação. Só front: o arrastar chama o mesmo `POST /file/move` que o Colar.

## Objetivos

- Arrastar **arquivos e pastas** da lista. Com vários selecionados, todos vão juntos.
- Soltar sobre uma **pasta da lista** ou um **nó da árvore**, incluindo `A:\`.
- Durante o arrasto: um "fantasma" translúcido com o ícone e o nome (ou "N itens") segue o
  ponteiro; a pasta sob o ponteiro fica destacada quando aceita o item; onde não aceita, o
  cursor vira "proibido".
- Esc cancela o arrasto. Soltar fora de um destino válido não faz nada.
- Erro do backend aparece no diálogo de erro com o `detail` como veio (nome repetido no
  destino, mover pasta para dentro de si, raiz FAT16 cheia). O que já foi movido antes do
  erro fica movido, como no Colar.

## Não objetivos

- Copiar ao arrastar (Ctrl) ou arrastar com o botão direito: a API não copia.
- Soltar na Lixeira, na área de trabalho ou na barra de tarefas.
- Expandir um nó da árvore ao parar sobre ele, e rolar a lista ou a árvore ao encostar na
  borda: as pastas da demonstração são pequenas.
- Arrastar pelo teclado: Ctrl+X/V continua sendo o caminho do teclado.
- Arrastar a partir da árvore: a árvore só recebe; a origem é a lista.

## Anti-objetivos

- Um clique, um duplo clique ou o clique lento que renomeia não podem virar arrasto: o
  arrasto só começa depois que o ponteiro anda alguns pixels com o botão seguro.
- Clicar num item de uma seleção múltipla não pode desfazer a seleção antes de se saber se
  é um arrasto (o XP só reduz a seleção ao soltar o botão sem arrastar).
- Nada de inferir a causa de um erro pelo texto: o `detail` é mostrado como veio.

## Regras de destino

Um destino é inválido (sem destaque, cursor proibido) quando é:

- a pasta que está sendo mostrada (os itens já estão nela);
- um dos itens arrastados, ou uma pasta dentro de um deles.

Nomes são case-sensitive: `/Docs` e `/docs` são pastas diferentes. Qualquer outra pasta é
válida; o backend tem a última palavra (nome repetido, raiz cheia).

## Abordagens

1. **Arrasto próprio com eventos de mouse** (escolhida). `mousedown` na linha (a seleção da
   lista já roda nele), `mousemove` e `mouseup` na janela, alvo por `document.elementFromPoint`. Controle total do limiar,
   do fantasma, do cursor e do destaque; funciona igual com zoom porque tudo é medido em px
   de tela, e o fantasma vive no `<body>`, fora do zoom, como a animação de minimizar.
2. **Drag and drop nativo do HTML5** (`draggable`, `dataTransfer`). Menos código, mas o
   fantasma é uma captura do navegador, o cursor não segue o estilo do XP, `dragleave`
   pisca entre elementos filhos, e o `mousedown` da seleção e do clique lento brigam com o
   início do arrasto.
3. **Biblioteca de arrastar** (dnd-kit ou similar): dependência nova, que o projeto não
   aceita sem pedir, para um caso pequeno.

## Onde fica

- `src/lib/`: a regra de destino, pura e testada no `smoke.ts` (seção 26).
- Um hook do explorer cuida do ponteiro, do limiar, do fantasma, do cursor, do destaque e
  do Esc, e entrega `(itens, destino)` ao soltar.
- `FileList` e `TreeItem` marcam as pastas que podem receber (`data-drop-path`).
- `Explorer` liga o soltar ao `moveAll` que o Colar já usa, com o mesmo bloqueio de
  "ocupado", o mesmo diálogo de erro e a mesma atualização das pastas.

## Decisões minhas (o usuário pode corrigir)

- Limiar de 4 px de tela antes de começar o arrasto.
- Depois de soltar, a seleção é limpa (os itens saíram da pasta mostrada).
- Itens recortados (Ctrl+X) que forem arrastados saem da área de transferência.
- Sem arrasto quando a edição está bloqueada (sem disco, lendo a FAT, ocupado) ou na linha
  que está sendo renomeada.
- Junto com este trabalho entra a correção do erro de renomear que some em silêncio quando
  se clica em Acima/Voltar logo depois (`Explorer.tsx`, cancelamento ao sair da pasta).

## Para quem constrói

O fantasma, as cores do destaque e o cursor ficam a seu critério dentro do visual do XP
(seleção azul `#316AC5`, como a linha selecionada). Valide no mock (5173) e contra o par
isolado (8001/5175), nunca no disco do usuário.
