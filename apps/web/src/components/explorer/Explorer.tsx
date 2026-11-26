// Phase 1: the full Explorer shell with fixed data and zero network calls.
// Phase 2 replaces the fixtures with /ls, /disk/info and /disk/fat.

import { FIXED_DOCS, FIXED_FAT, FIXED_INFO } from '../../fixtures'
import { formatBytes, toDosPath } from '../../lib/display'
import { ClusterMap } from '../inspector/ClusterMap'
import { AddressBar } from '../shell/AddressBar'
import { ExplorerWindow } from '../shell/ExplorerWindow'
import { MenuBar } from '../shell/MenuBar'
import type { Menu } from '../shell/MenuBar'
import { SplitPane } from '../shell/SplitPane'
import { StatusBar } from '../shell/StatusBar'
import { Toolbar } from '../shell/Toolbar'
import type { ToolbarAction } from '../shell/Toolbar'
import { FileList } from './FileList'
import { TreeItem } from './TreeItem'

const PATH = '/docs'
const SELECTED = '/docs/dados.bin'

// Menus and toolbar follow the mockups (Disco menu, text buttons).
// Items without a handler render disabled until their phase lands.
const MENUS: Menu[] = [
  {
    label: 'Arquivo',
    items: [
      { label: 'Abrir', shortcut: 'Enter' },
      { separator: true },
      { label: 'Nova pasta' },
      { label: 'Novo arquivo' },
      { separator: true },
      { label: 'Renomear', shortcut: 'F2' },
      { label: 'Mover…' },
      { label: 'Excluir', shortcut: 'Del' },
      { separator: true },
      { label: 'Propriedades', shortcut: 'Alt+Enter' },
    ],
  },
  {
    label: 'Editar',
    items: [
      { label: 'Recortar', shortcut: 'Ctrl+X' },
      { label: 'Copiar', shortcut: 'Ctrl+C' },
      { label: 'Colar', shortcut: 'Ctrl+V' },
      { separator: true },
      { label: 'Selecionar tudo', shortcut: 'Ctrl+A' },
    ],
  },
  {
    label: 'Exibir',
    items: [
      { label: 'Ícones', checked: false },
      { label: 'Detalhes', checked: true },
      { separator: true },
      { label: 'Atualizar', shortcut: 'F5' },
    ],
  },
  {
    label: 'Disco',
    items: [
      { label: 'Formatar…' },
      { label: 'Verificar disco' },
      { separator: true },
      { label: 'Inspetor de disco' },
    ],
  },
  { label: 'Ajuda', items: [{ label: 'Sobre o Simulador FAT' }] },
]

const TOOLBAR: ToolbarAction[][] = [
  [
    { label: 'Voltar', icon: 'back' },
    { label: 'Avançar', icon: 'forward', iconOnly: true },
    { label: 'Acima', icon: 'up', iconOnly: true },
  ],
  [{ label: 'Abrir' }, { label: 'Nova pasta' }, { label: 'Novo arquivo' }],
  [{ label: 'Renomear' }, { label: 'Mover…' }, { label: 'Excluir' }, { label: 'Propriedades' }],
  [{ label: 'Formatar…' }, { label: 'Verificar disco' }],
]

export function Explorer() {
  const info = FIXED_INFO
  const free = FIXED_FAT.filter((c) => c.status === 'livre').length
  const used = FIXED_FAT.filter((c) => c.status !== 'livre' && c.status !== 'defeituoso').length
  const bad = FIXED_FAT.filter((c) => c.status === 'defeituoso').length

  const tree = (
    <div className="tree" tabIndex={0}>
      <ul role="tree" aria-label="Pastas">
        <TreeItem label="A:\" icon="drive" toggle="expanded" selected={false}>
          <TreeItem label="backup" icon="folder" toggle="leaf" selected={false} />
          <TreeItem label="docs" icon="folderOpen" toggle="expanded" selected>
            <TreeItem label="fotos" icon="folder" toggle="collapsed" selected={false} />
          </TreeItem>
        </TreeItem>
      </ul>
    </div>
  )

  const right = (
    <>
      <FileList
        dir={PATH}
        entries={FIXED_DOCS}
        sort={{ column: 'name', asc: true }}
        selected={SELECTED}
      />
      <ClusterMap
        entries={FIXED_FAT}
        footer={`${free} livres · ${used} em uso · ${bad} defeituoso`}
      />
    </>
  )

  return (
    <ExplorerWindow title={`${toDosPath(PATH)} (Simulador FAT)`}>
      <MenuBar menus={MENUS} />
      <Toolbar groups={TOOLBAR} />
      <AddressBar value={toDosPath(PATH)} history={[]} onGo={() => true} />
      <SplitPane left={tree} right={right} />
      <StatusBar
        main="dados.bin: 2.600 B"
        space={`${info.clustersLivres} clusters livres · ${formatBytes(info.espacoLivre)}`}
        disk={`${info.variante} · ${formatBytes(info.clusterSize)}/cluster`}
      />
    </ExplorerWindow>
  )
}
