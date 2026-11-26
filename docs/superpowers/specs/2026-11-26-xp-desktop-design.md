# Área de trabalho do XP — desenho

26/11/2026 · aprovado

## Intenção

Hoje o simulador é uma única janela de Explorer sobre um fundo azul liso. O pedido é
transformar a tela num **computador XP simulado só no front**: papel de parede, barra de
tarefas, menu Iniciar, janelas que minimizam, maximizam e fecham, e os detalhes que fazem
"parecer o XP". O uso imediato é um vídeo para a equipe e a apresentação; depois vem um
deploy só do front, em modo mock.

Referência visual: a captura enviada pelo usuário (Bliss, botão Iniciar verde, barra azul,
relógio na bandeja, Lixeira no canto inferior direito).

## Objetivos

1. **Zoom de dentro da janela**: tudo o que está dentro da janela do simulador cresce ou
   diminui junto (menus, barra de ferramentas, árvore, arquivos e ícones, mapa de clusters,
   barra de status, dialogs). A moldura da janela, a área de trabalho e a barra de tarefas
   não mudam.
2. **Barra de tarefas** no estilo da referência, com menu Iniciar.
3. **Minimizar, maximizar e fechar** funcionando.
4. As ideias aprovadas:
   1. inicialização e tela "Bem-vindo"
   2. Iniciar › Desligar, com a tela ficando cinza
   3. balões na bandeja
   4. janela inativa
   5. animação de minimizar e restaurar
   6. dicas amarelas (tooltips)
   7. sons gerados no navegador, com botão de mudo
   8. Lixeira só como ícone, abrindo vazia

## Não objetivos

- **Bloco de notas** (ideia 9): fica para depois. O gerenciador de janelas precisa aceitá-lo
  como um novo tipo de janela sem refazer nada.
- Redimensionar janela pelas bordas, arrastar ícones da área de trabalho, mais de uma
  instância do Explorer, Lixeira que restaura arquivos.
- Modos de exibição Lista e Ícones na lista de arquivos (o item "Exibir › Ícones" continua
  inativo). O zoom aumenta a visão Detalhes que já existe.
- Zoom do computador inteiro: o Ctrl + roda do navegador já faz isso.
- Qualquer mudança em `apps/api/` ou endpoint novo. Nenhuma dependência nova.

## Anti-objetivos (falharia mesmo funcionando)

- Usar material da Microsoft: foto Bliss, bandeira do Windows, sons, ícones originais.
  Também não usar a fonte *Windows XP Pixel Alt* (licença proíbe uso em site e
  redistribuição; não tem acentos). A fonte continua **Tahoma 11px**.
- Atalhos de teclado chegando a uma janela minimizada ou inativa: Delete apagaria o arquivo
  selecionado sem ninguém ver.
- Quebrar o roteiro de demonstração (`docs/demo/roteiro.md`): depois do logon o Explorer
  abre em A:\ como hoje, e os nove passos dão os mesmos números.
- Inicialização lenta ou obrigatória: precisa ser curta e pulável.
- Chamar `/disk/format` sozinho (CLAUDE.md, item 10). Desligar e reiniciar são só visuais:
  nada vai para o backend.

## Restrições

- React 18 + TypeScript + xp.css, já instalados. Identificadores em inglês, interface em
  pt-BR. Nenhum componente chama `fetch`.
- Funciona igual em modo mock e com o backend real.
- Navegadores de desktop atuais (Chrome/Edge, Firefox ≥ 126), por causa da propriedade CSS
  `zoom`.

## Abordagens

| | Abordagem | Troca |
| --- | --- | --- |
| **A** | **Gerenciador de janelas pequeno**: lista de janelas com tipo, estado, posição e ordem; a barra de tarefas desenha um botão por janela | Custo médio agora; o Bloco de notas entra depois como mais um tipo |
| B | Estado único só para o Explorer; Lixeira como caixa de mensagem | Mais barato agora; o Bloco de notas obrigaria a refazer barra de tarefas e foco |
| C | Gerenciador completo, com redimensionar e encaixe | Descartada: ninguém pediu e a especificação cortou |

**Escolhida: A**, pelo usuário, porque o Bloco de notas já está combinado e porque janela
inativa, animação e botões da barra de tarefas são todos assuntos por janela.

## O desenho

### Camadas, de baixo para cima

1. Papel de parede
2. Ícones da área de trabalho
3. Janelas, na ordem de empilhamento
4. Barra de tarefas, menu Iniciar e balões
5. Dialogs modais (o overlay atual, `position: fixed`, cobre a tela inteira, inclusive a
   barra de tarefas: com um dialog aberto não se troca de janela, como hoje)
6. Telas de sessão: inicialização, Bem-vindo, desligar
7. Dicas amarelas

### Gerenciador de janelas

Estado (reducer puro em `src/lib/`, testável no smoke):

- `windows`: lista de `{ id, kind, state, pos, z, data? }`
  - `kind`: `'explorer' | 'recycle'` (depois `'notepad'`)
  - `state`: `'normal' | 'minimized' | 'maximized'`
  - `pos`: canto superior esquerdo no estado normal, em px CSS
  - `data`: opcional, o que a janela abriu (o Bloco de notas vai guardar o caminho do
    arquivo aqui)
- `activeId`: a janela ativa, ou nenhuma
- Cada tipo declara se é de **instância única**. Explorer e Lixeira são; o Bloco de notas
  poderá ter uma janela por arquivo sem mudar o reducer.

Regras:

- **Abrir** um tipo de instância única que já está aberto restaura e ativa a janela
  existente. Uma janela nova abre centralizada (Explorer) ou deslocada em cascata (as
  outras), já ativa e no topo.
- **Clicar dentro** de uma janela a ativa e traz para o topo.
- **Clicar na área de trabalho vazia** desativa todas.
- **Minimizar** esconde a janela sem desmontar (o Explorer guarda pasta, seleção e
  histórico) e ativa a próxima janela visível do topo.
- **Botão da barra de tarefas**: se a janela é a ativa e está visível, minimiza; senão
  restaura e ativa. É o comportamento do XP.
- **Maximizar** ocupa a área da tela acima da barra de tarefas; o botão vira "Restaurar"
  (xp.css já desenha `aria-label=Restore`). Duplo clique na barra de título alterna.
  Maximizada, a janela não arrasta.
- **Fechar** desmonta a janela. Reabrir o Explorer começa em A:\, como no XP.
- **Atalhos de teclado** do Explorer (`useWindowShortcuts`) só valem quando a janela está
  ativa, visível e sem modal aberto.

`ExplorerWindow` vira um componente genérico de janela (título, ícone, tamanho normal,
estado, ativa ou não). Tamanhos normais: Explorer 860×620, como hoje; Lixeira por volta de
420×300.

**Janela inativa**: barra de título no degradê `#7A96DF` → `#A6C3F0`
(build-frontend.md, "Fidelidade visual"), texto e botões desbotados. A linha selecionada da
lista fica cinza `#D4D4D4`, como já acontece quando a lista perde o foco.

### Papel de parede e ícones

- Papel de parede **desenhado em CSS/SVG próprio**: céu azul em degradê, morro verde em
  curva, nuvens suaves. Lembra a referência sem ser a foto.
- Ícones em SVG próprio, no estilo dos que já existem em `Icon.tsx`:
  - **Meu computador**, no canto superior esquerdo: abre o Explorer.
  - **Lixeira**, no canto inferior direito, acima da barra, como na referência: abre a
    janela da Lixeira.
- Clique seleciona o ícone (rótulo em azul); duplo clique ou Enter abre. Clique no vazio tira
  a seleção.

### Barra de tarefas

- 30 px de altura, degradê `#245EDC` → `#3F8CF3`.
- **Botão Iniciar** verde `#3C8A2E`, cantos arredondados à direita, texto "Iniciar" branco,
  itálico e negrito, com um ícone nosso no lugar da bandeira do Windows.
- **Um botão por janela aberta** (inclusive minimizada), com ícone e título; afundado quando
  a janela está ativa e visível. Encolhem quando falta espaço.
- **Bandeja**, à direita, em azul mais claro com borda chanfrada:
  - alto-falante: clique liga e desliga o som
  - "modo mock": aparece só com `VITE_MOCK=1` e substitui o selo que hoje fica no canto da
    área de trabalho; a dica explica que os dados ficam só neste navegador
  - relógio HH:MM; a dica mostra a data por extenso

### Menu Iniciar

- Abre pelo botão Iniciar. Não há atalho de teclado: a tecla Windows e o Ctrl+Esc do XP são
  capturados pelo próprio Windows antes de chegar à página. Fecha com Esc, clique fora ou
  depois de escolher um item.
- Leiaute de duas colunas do XP:
  - cabeçalho azul com a figura e o nome do usuário
  - coluna branca: **Simulador FAT** (abre o Explorer)
  - coluna azul-clara: **Meu computador** (abre o Explorer) e **Lixeira**
  - rodapé: **Fazer logoff** e **Desligar o computador**
- Só entram itens que fazem alguma coisa. Nada de "Todos os programas" vazio.

### Lixeira

Janela do tipo `recycle`, título "Lixeira", com uma área de lista branca e a barra de
status "0 objetos". No meio da área: "A Lixeira está vazia." e, em cinza, "No simulador,
excluir libera os clusters na hora: nada passa pela Lixeira." É verdade sobre a API, que não
tem lixeira.

### Zoom

O zoom vale para **o conteúdo das janelas**: tudo abaixo da barra de título. A janela mantém
o tamanho; com mais zoom cabe menos coisa e os painéis rolam, como ao ampliar um documento.
Maximizar dá mais espaço.

- **Como ampliar e reduzir**:
  - **Ctrl + roda do mouse** com o ponteiro sobre a janela. Fora das janelas, o navegador
    continua com o zoom dele.
  - **Ctrl + "+"** (ou "="), **Ctrl + "−"** e **Ctrl + 0** (volta para 100%), quando a
    janela está ativa.
  - **Exibir › Zoom** no menu do Explorer: Ampliar, Reduzir e Tamanho normal, com os atalhos
    ao lado.

  Os atalhos são capturados com `preventDefault`, para o navegador não aplicar o zoom dele;
  o de roda precisa de listener `passive: false`.
- **Onde aparece**: a barra de status mostra a porcentagem quando é diferente de 100%
  (ex.: "Zoom: 150%"). Fica visível no vídeo.
- Passos: 75, 90, 100, 110, 125, 150, 175 e 200%.
- **Um nível só para todas as janelas**: o Explorer, a Lixeira e, depois, o Bloco de notas
  usam o mesmo zoom. Guardado em `localStorage`; volta igual ao recarregar.
- **Dialogs acompanham**: os dialogs do Explorer (propriedades, formatar, erro…) são
  desenhados dentro da janela e crescem junto. O de desligar e as telas de sessão não.
- Aplicado com a propriedade CSS `zoom` no corpo da janela (`.explorer-body` e
  equivalentes). `transform: scale` foi descartado: prenderia os dialogs, como já diz o
  comentário em `ExplorerWindow.tsx`.
- **Coordenadas**: dentro da área com `zoom`, `clientX`/`clientY` e `getBoundingClientRect`
  ficam em px de tela, e `left`/`top` em px CSS. Toda conta que mistura os dois divide pelo
  zoom. Os pontos que existem hoje dentro da janela:
  - posição do menu de contexto (`FileList.tsx`, `ContextMenu.tsx`), inclusive o limite à
    borda da tela, que passa a usar `innerWidth / zoom`
  - `RenameField.tsx` e `lib/dom.ts`, que usam `getBoundingClientRect`
  - as dicas amarelas, quando apontam para algo dentro da janela

  Arrastar a janela, centralizar e limitar à tela ficam como estão: a barra de título não
  tem zoom. Precisa ser conferido no navegador em 200%, 150% e 75%, inclusive o overlay dos
  dialogs cobrindo a tela toda e o mapa de clusters com pouco espaço.

### Sessão: inicialização, Bem-vindo, logoff e desligar

- **Inicialização**: tela preta, logotipo nosso ("Simulador FAT", sem logo da Microsoft) e a
  barrinha de blocos azuis correndo, por uns 3 s. Qualquer tecla ou clique pula.
- **Bem-vindo**: a tela azul do XP. À esquerda, "Simulador FAT" e "Para começar, clique no
  seu nome de usuário"; à direita, um cartão de usuário. Clicar no cartão mostra "Bem-vindo"
  por um instante, toca o som de logon e abre a área de trabalho **com o Explorer já aberto
  em A:\**.
- **Quando aparece**: ao abrir a página, uma vez por aba (`sessionStorage`). `?sem-boot` na
  URL pula as duas telas, para testes e para quem quiser ir direto.
- **Fazer logoff**: fecha as janelas e volta para o Bem-vindo, com o som de logoff.
- **Desligar o computador**: a área de trabalho vai ficando cinza (filtro com transição de
  ~1 s, como no XP) e aparece o dialog "Desligar o computador":
  - **Em espera**: tela preta até um clique ou tecla; volta à área de trabalho como estava.
  - **Desligar**: "Desligando…", som de desligar e tela preta com "Clique para ligar o
    computador"; o clique volta à inicialização.
  - **Reiniciar**: vai direto para a inicialização.
  - **Cancelar**: as cores voltam.
- Nada disso fala com o backend. No modo mock, o disco em memória continua o mesmo, porque a
  página não recarrega.

### Balões na bandeja

- Balão amarelo `#FFFFE1`, cantos arredondados, ponta apontando para a bandeja, título em
  negrito com ícone, botão ×. Some sozinho depois de ~6 s. Um de cada vez: o novo substitui o
  anterior.
- Disparados pelo Explorer por uma função `notify` exposta pelo contexto da área de trabalho.
- Eventos:
  - **disco formatado**: variante e clusters livres, com os números do `DiskInfo` devolvido
  - **verificação concluída**: "Nenhum problema encontrado" ou "N problema(s) encontrado(s)"
  O relatório da verificação continua abrindo como hoje; o balão é um extra.

### Animação de minimizar e restaurar

Um retângulo fantasma na cor da barra de título vai do retângulo da janela até o botão dela
na barra de tarefas, em ~200 ms (e o caminho inverso ao restaurar). Com
`prefers-reduced-motion`, não anima.

### Dicas amarelas

Uma camada global de dicas substitui a dica nativa do navegador para todo elemento com
`title` (são 20 usos hoje, inclusive as células do mapa de clusters). Ao passar o mouse, o
`title` sai do elemento (a dica nativa não aparece) e volta ao sair. A dica XP aparece
depois de ~500 ms perto do ponteiro: fundo `#FFFFE1`, borda preta de 1 px, Tahoma 11 px,
sombra leve. Some ao sair, clicar ou rolar.

### Sons

Gerados com Web Audio (osciladores e envelopes), sem nenhum arquivo:

- **logon**: acorde subindo, ao clicar no cartão do Bem-vindo (é um clique, então o
  navegador deixa tocar)
- **logoff e desligar**: acorde descendo
- **erro**: um "ding" quando abre o dialog de erro e o de espaço insuficiente
- **balão**: um estalo curto

O som começa ligado. O alto-falante da bandeja desliga, e a escolha fica em `localStorage`.

### Persistência no navegador

- `localStorage`: zoom e mudo
- `sessionStorage`: "já passou pela inicialização nesta aba"

## Verificação

- **Smoke**, uma seção nova:
  - regras do reducer de janelas: instância única, clique na barra de tarefas alternando,
    minimizar ativando a próxima, fechar removendo
  - os passos do zoom
  - o limite da janela à tela com zoom
- **No navegador, em mock e com o backend real (par isolado)**:
  - os nove passos do roteiro depois do logon, com os mesmos números
  - Delete com o Explorer minimizado ou inativo não faz nada
  - em 200%, 150% e 75%: menu de contexto, renomear, dicas e dialogs no lugar certo; o
    roteiro continua legível
  - Ctrl + roda sobre a janela não aciona o zoom do navegador
  - logoff, desligar, em espera e reiniciar voltam ao estado certo
- `npm run check` limpo.

## Fica para quem constrói

- Traço exato do papel de parede, dos ícones e do logotipo da inicialização.
- Tempos das animações e frequências dos sons, dentro do descrito.
- Leiaute fino do menu Iniciar e da bandeja.
- Organização de pastas dos componentes novos.

## Decisões tomadas pelo assistente (para conferir)

- O zoom é do conteúdo da janela, como o usuário definiu. Decidido pelo assistente: um nível
  único para todas as janelas, os dialogs do Explorer crescem junto, a porcentagem aparece
  na barra de status, e o menu Exibir ganha Ampliar, Reduzir e Tamanho normal.
- Lixeira abre como janela vazia com a explicação, em vez de caixa de mensagem.
- O Explorer já abre depois do logon, para o roteiro não mudar.
- Inicialização uma vez por aba, com `?sem-boot` para pular.
- O selo "modo mock" sai da área de trabalho e vira um ícone na bandeja.
- Balões só para formatação e verificação.
- Menu Iniciar só pelo botão (Ctrl+Esc não chega à página no Windows).
- Instância única é política por tipo, e a janela tem um campo opcional de dados, para o
  Bloco de notas caber depois.
