// Smoke test do mock: roda com `npx tsx smoke.ts`.
// Nao faz parte do projeto final — e so para provar que o mock obedece o contrato.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { ApiError } from './src/api/client'
import { corromper, mockApi, resetar, semear } from './src/api/mock'
import { base64ToBytes, bytesToBase64, fragmentado } from './src/api/paths'
import { chainFromFat } from './src/lib/chain'
import { describeShortage } from './src/lib/errors'
import { describeCapacity, parseClusterCount, planFormat, shortSize } from './src/lib/format'
import {
  countStates,
  describeJump,
  describeMany,
  describeOccupants,
  describeOne,
  fatTableRows,
  fatValue,
  mapOwners,
  slackShare,
  usedInLast,
} from './src/lib/inspect'

import { checkBalloon, formattedBalloon } from './src/lib/balloons'
import { clampMenu, formatZoom, parseZoom, stepZoom } from './src/lib/zoom'
import { mutePref, zoomPref } from './src/lib/prefs'
import { startPhase } from './src/lib/session'
import { EMPTY_DESK, clampPos, deskReducer, fits, initialPos, takesKeys, topVisible } from './src/lib/windows'

let falhas = 0
const ok = (cond: boolean, msg: string) => {
  if (!cond) {
    falhas++
    console.error('  FALHOU:', msg)
  } else {
    console.log('  ok:', msg)
  }
}

const esperaErro = async (status: number, fn: () => Promise<unknown>, msg: string) => {
  try {
    await fn()
    falhas++
    console.error('  FALHOU (nao lancou):', msg)
  } catch (e) {
    const certo = e instanceof ApiError && e.status === status
    if (!certo) {
      falhas++
      console.error('  FALHOU (status errado):', msg, e)
    } else {
      console.log(`  ok: ${msg} -> ${status} "${e.message}"`)
    }
  }
}

const txt = (s: string) => bytesToBase64(new TextEncoder().encode(s))

async function main() {
  console.log('\n1. Sem disco')
  resetar()
  await esperaErro(400, () => mockApi.diskInfo(), 'diskInfo sem disco (igual ao backend: 400)')

  console.log('\n2. Formatar')
  const info = await mockApi.formatDisk({ variante: 'fat16', cluster_size: 512, num_clusters: 256 })
  ok(info.variante === 'FAT16', 'variante volta MAIUSCULA')
  ok(info.numClusters === 256, 'numClusters = 256')
  ok(info.espacoTotal === 131072, `espacoTotal normalizado para numero: ${info.espacoTotal}`)
  ok(info.clusterSize === 512, `clusterSize normalizado para numero: ${info.clusterSize}`)
  ok(info.rootMaxEntradas === 64, `rootMaxEntradas FAT16 = 64 (veio ${info.rootMaxEntradas})`)
  ok(info.clustersUsados === 1, 'root ocupa 1 cluster')
  await esperaErro(400, () => mockApi.formatDisk({ cluster_size: 100 }), 'cluster_size nao potencia de 2')
  await esperaErro(400, () => mockApi.formatDisk({ cluster_size: 32 }), 'cluster_size < 64')

  console.log('\n3. Formatar default FAT32')
  const f32 = await mockApi.formatDisk({ variante: 'fat32' })
  ok(f32.numClusters === 1024, 'default FAT32 = 1024 clusters')
  ok(f32.rootMaxEntradas === null, 'rootMaxEntradas FAT32 = null (API manda string)')

  console.log('\n4. Diretorios')
  await mockApi.formatDisk({ variante: 'fat16' })
  await mockApi.mkdir('/docs')
  const raiz = await mockApi.ls('/')
  ok(raiz.entradas.length === 1 && raiz.entradas[0].nome === 'docs', 'ls / mostra docs')
  ok(raiz.entradas[0].tipo === 'diretorio', 'tipo diretorio')
  await esperaErro(409, () => mockApi.mkdir('/docs'), 'mkdir duplicado')
  await esperaErro(404, () => mockApi.mkdir('/nao/existe'), 'mkdir com pai inexistente')
  await esperaErro(404, () => mockApi.ls('/fantasma'), 'ls de path inexistente')

  console.log('\n5. Arquivos')
  await mockApi.createFile('/docs/a.txt')
  const criado = await mockApi.ls('/docs')
  ok(criado.entradas[0].primeiro_cluster === 0, 'arquivo vazio tem primeiro_cluster 0')
  await esperaErro(409, () => mockApi.createFile('/docs/a.txt'), 'createFile duplicado')
  await esperaErro(400, () => mockApi.readFile('/docs'), 'readFile de diretorio')

  const w = await mockApi.write('/docs/a.txt', txt('Hello, World!'))
  ok(w.bytes_escritos === 13 && w.tamanho_novo === 13, 'write de 13 bytes')
  const w2 = await mockApi.write('/docs/a.txt', txt(' De novo.'))
  ok(w2.tamanho_novo === 22, 'write faz append, nao substitui')

  const r = await mockApi.readFile('/docs/a.txt')
  ok(r.conteudo_texto === 'Hello, World! De novo.', 'read devolve o texto certo')
  ok(base64ToBytes(r.conteudo_base64).length === 22, 'base64 bate com o tamanho')

  console.log('\n6. overwrite respeita os limites')
  const ov = await mockApi.overwrite('/docs/a.txt', 7, txt('Mundo'))
  ok(ov.bytes_escritos === 5, 'overwrite de 5 bytes')
  const r2 = await mockApi.readFile('/docs/a.txt')
  ok(r2.conteudo_texto === 'Hello, Mundo! De novo.', 'overwrite trocou no offset certo')
  ok(r2.tamanho === 22, 'overwrite nao mudou o tamanho')
  await esperaErro(400, () => mockApi.overwrite('/docs/a.txt', 20, txt('xxxxx')), 'overwrite alem do fim')

  console.log('\n7. replace')
  const rep = await mockApi.replace('/docs/a.txt', txt('curto'))
  ok(rep.tamanho_novo === 5, 'replace encolhe o arquivo')

  console.log('\n8. chain e slack')
  await mockApi.createFile('/docs/grande.bin')
  await mockApi.write('/docs/grande.bin', txt('x'.repeat(1300)))
  const ch = await mockApi.chain('/docs/grande.bin')
  ok(ch.num_clusters === 3, `1300 bytes em clusters de 512 = 3 clusters (veio ${ch.num_clusters})`)
  ok(ch.tamanho_total_clusters === 1536, 'ocupa 1536 bytes')
  ok(ch.slack_interno === 236, `slack = 236 (veio ${ch.slack_interno})`)

  console.log('\n9. Fragmentacao')
  await mockApi.formatDisk({ variante: 'fat16', cluster_size: 512, num_clusters: 64 })
  await mockApi.createFile('/a.bin')
  await mockApi.write('/a.bin', txt('a'.repeat(512)))
  await mockApi.createFile('/b.bin')
  await mockApi.write('/b.bin', txt('b'.repeat(512)))
  await mockApi.createFile('/c.bin')
  await mockApi.write('/c.bin', txt('c'.repeat(512)))
  await mockApi.remove('/b.bin')
  await mockApi.createFile('/d.bin')
  await mockApi.write('/d.bin', txt('d'.repeat(1024)))
  const chD = await mockApi.chain('/d.bin')
  ok(fragmentado(chD.cadeia), `cadeia de d.bin fragmentada: [${chD.cadeia}]`)

  console.log('\n10. Disco cheio')
  await esperaErro(400, async () => {
    await mockApi.createFile('/enorme.bin')
    await mockApi.write('/enorme.bin', txt('z'.repeat(512 * 200)))
  }, 'write maior que o disco')

  console.log('\n11. remove e rename')
  await mockApi.formatDisk({ variante: 'fat16' })
  await mockApi.mkdir('/pasta')
  await mockApi.createFile('/pasta/f.txt')
  await esperaErro(409, () => mockApi.remove('/pasta'), 'remove de pasta nao vazia')
  const del = await mockApi.remove('/pasta/f.txt')
  ok(del.clusters_liberados === 0, 'arquivo vazio libera 0 clusters')
  const delP = await mockApi.remove('/pasta')
  ok(delP.clusters_liberados === 1, 'pasta libera 1 cluster')

  await mockApi.createFile('/x.txt')
  const rn = await mockApi.rename('/x.txt', 'y.txt')
  ok(rn.path_novo === '/y.txt', 'rename monta o path novo')
  await mockApi.createFile('/z.txt')
  await esperaErro(409, () => mockApi.rename('/z.txt', 'y.txt'), 'rename para nome existente')

  console.log('\n12. move')
  await mockApi.mkdir('/destino')
  const mv = await mockApi.move('/y.txt', '/destino')
  ok(mv.path_novo === '/destino/y.txt', 'move monta o path novo')
  const dest = await mockApi.ls('/destino')
  ok(dest.entradas.length === 1, 'arquivo chegou no destino')
  const raizDepois = await mockApi.ls('/')
  ok(!raizDepois.entradas.some((e) => e.nome === 'y.txt'), 'arquivo saiu da origem')

  await mockApi.mkdir('/p1')
  await mockApi.mkdir('/p1/p2')
  await esperaErro(400, () => mockApi.move('/p1', '/p1/p2'), 'mover pasta para dentro de si')

  console.log('\n13. Case-SENSITIVE (o backend compara e[name] == name)')
  await mockApi.formatDisk({ variante: 'fat16' })
  await mockApi.mkdir('/Docs')
  await esperaErro(404, () => mockApi.ls('/docs'), 'ls /docs NAO resolve /Docs')
  const dup = await mockApi.mkdir('/docs')
  ok(dup.path === '/docs', '/docs e /Docs coexistem')
  const raizCi = await mockApi.ls('/')
  ok(raizCi.entradas.length === 2, `raiz tem as duas pastas: ${raizCi.entradas.map(e => e.nome)}`)
  await esperaErro(400, () => mockApi.createFile('/' + 'a'.repeat(40)), 'nome com 40 chars')

  console.log('\n14. Limite de 64 entradas no root')
  await mockApi.formatDisk({ variante: 'fat16' })
  for (let i = 0; i < 64; i++) await mockApi.createFile(`/f${i}.txt`)
  await esperaErro(400, () => mockApi.createFile('/f64.txt'), 'root cheio aos 64')
  const raiz64 = await mockApi.diskInfo()
  ok(raiz64.clustersUsados === 8, `raiz cresceu ate 8 clusters de 8 slots (veio ${raiz64.clustersUsados})`)

  console.log('\n15. diskFat e diskCheck')
  await mockApi.formatDisk({ variante: 'fat16', cluster_size: 512, num_clusters: 16 })
  const fat = await mockApi.diskFat()
  ok(fat.entradas.length === 16, `16 entradas (veio ${fat.entradas.length})`)
  ok(fat.entradas[0].cluster === 2, 'primeiro cluster e 2')
  ok(fat.entradas[0].status === 'EOF', 'root e EOF')
  ok(fat.entradas[1].status === 'livre', 'cluster 3 livre')

  await mockApi.createFile('/multi.bin')
  await mockApi.write('/multi.bin', txt('m'.repeat(1024)))
  const fat2 = await mockApi.diskFat()
  const encadeado = fat2.entradas.find((e) => e.status.startsWith('→'))
  ok(!!encadeado, `existe entrada encadeada: ${encadeado?.status}`)

  const chk = await mockApi.diskCheck()
  ok(chk.consistente && chk.erros.length === 0, 'disco limpo passa no check')

  corromper()
  const chk2 = await mockApi.diskCheck()
  ok(!chk2.consistente && chk2.erros.length > 0, `check detecta corrupcao: "${chk2.erros[0]}"`)

  console.log('\n16. semear()')
  await semear()
  const sem = await mockApi.ls('/docs')
  ok(sem.entradas.length >= 2, 'semear criou conteudo em /docs')
  const chSeed = await mockApi.chain('/docs/dados.bin')
  ok(fragmentado(chSeed.cadeia), `seed ja nasce fragmentado: [${chSeed.cadeia}]`)
  const binSeed = await mockApi.readFile('/docs/dados.bin')
  ok(binSeed.conteudo_texto.includes('�'), 'dados.bin do seed e binario (U+FFFD no texto)')
  const chkSeed = await mockApi.diskCheck()
  ok(chkSeed.consistente, 'seed passa no check (sem cluster defeituoso, que a API nao cria)')

  console.log('\n17. Igual ao backend: alocacao')
  await mockApi.formatDisk({ variante: 'fat16', cluster_size: 512, num_clusters: 64 })
  await mockApi.createFile('/a')
  await mockApi.write('/a', txt('a'.repeat(512)))
  await mockApi.createFile('/b')
  await mockApi.write('/b', txt('b'.repeat(512)))
  await mockApi.remove('/a')
  await mockApi.write('/b', txt('b'.repeat(512)))
  const ext = await mockApi.chain('/b')
  ok(ext.cadeia.join() === '4,3', `append estende a partir do ultimo cluster: [${ext.cadeia}]`)
  await mockApi.write('/b', txt('b'.repeat(512)))
  await mockApi.replace('/b', txt('c'.repeat(600)))
  const enc = await mockApi.chain('/b')
  ok(enc.cadeia.join() === '4,3', `replace menor mantem o comeco da cadeia: [${enc.cadeia}]`)

  console.log('\n18. Igual ao backend: diretorios')
  await mockApi.mkdir('/g')
  await mockApi.createFile('/g/z')
  await mockApi.createFile('/g/a')
  const ordem = await mockApi.ls('/g')
  ok(ordem.entradas.map((e) => e.nome).join() === 'z,a', 'ls na ordem dos slots, sem ordenar')
  for (let i = 0; i < 6; i++) await mockApi.createFile(`/g/f${i}`)
  ok((await mockApi.chain('/g')).num_clusters === 1, '8 entradas cabem no primeiro cluster da pasta')
  const livresAntes = (await mockApi.diskInfo()).clustersLivres
  await mockApi.createFile('/g/f6')
  ok((await mockApi.chain('/g')).num_clusters === 2, 'a 9a entrada faz a pasta crescer um cluster')
  ok((await mockApi.diskInfo()).clustersLivres === livresAntes - 1, 'criar arquivo vazio gastou um cluster (da pasta)')

  const mtimeG = (await mockApi.ls('/')).entradas.find((e) => e.nome === 'g')!.mtime
  const realNow = Date.now
  Date.now = () => realNow() + 10_000
  try {
    await mockApi.createFile('/g/novo')
    await mockApi.remove('/g/z')
  } finally {
    Date.now = realNow
  }
  const mtimeG2 = (await mockApi.ls('/')).entradas.find((e) => e.nome === 'g')!.mtime
  ok(mtimeG2 === mtimeG, 'mtime da pasta pai nao muda ao criar ou apagar dentro dela')

  console.log('\n19. Igual ao backend: validacao e mensagens')
  await esperaErro(422, () => mockApi.overwrite('/b', -1, txt('x')), 'offset negativo e 422 (Pydantic)')
  await esperaErro(422, () => mockApi.overwrite('/b', 1.5, txt('x')), 'offset fracionario e 422 (Pydantic)')
  await esperaErro(400, () => mockApi.write('/b', 'não é base64!!'), 'Base64 invalido')
  await esperaErro(404, () => mockApi.readFile('/nada'), 'read de arquivo inexistente')
  await esperaErro(409, () => mockApi.rename('/b', 'b'), 'rename para o proprio nome (o backend acusa 409)')
  await esperaErro(400, () => mockApi.move('/', '/g'), 'mover a raiz')
  const longo = 'relatório-avaliação-final.txt' // 29 caracteres, 32 bytes em UTF-8
  await mockApi.createFile('/' + longo)
  const nomes = (await mockApi.ls('/')).entradas.map((e) => e.nome)
  ok(!nomes.includes(longo), 'nome acima de 31 bytes e cortado, como no backend')
  await esperaErro(404, () => mockApi.readFile('/' + longo), 'o caminho original deixa de existir')

  console.log('\n20. Inspecao (fase 5): mapa, FAT[n], slack e resumos')
  await semear()
  const tabela = (await mockApi.diskFat()).entradas
  const disco = await mockApi.diskInfo()
  const estados = countStates(tabela)
  ok(estados.livre === disco.clustersLivres, `livres na legenda = clusters_livres (${estados.livre})`)
  ok(
    estados.livre + estados.usado + estados.fim + estados.defeituoso === disco.numClusters,
    'a legenda soma num_clusters',
  )
  const dados = await mockApi.chain('/docs/dados.bin')
  ok(dados.cadeia.join() === '10,11,15,16,17,18', `dados.bin fragmentado: [${dados.cadeia}]`)
  const primeiro = (await mockApi.ls('/docs')).entradas.find((e) => e.nome === 'dados.bin')!.primeiro_cluster
  ok(chainFromFat(tabela, primeiro).join() === dados.cadeia.join(), 'cadeia lida da FAT = /file/chain')
  const linhas = fatTableRows(dados.cadeia, tabela, 'FAT16')
  ok(
    linhas.map((l) => l.value).join() === '11,15,16,17,18,EOF (0xFFFF)',
    `FAT[n] da tela 07: ${linhas.map((l) => l.value).join(' ')}`,
  )
  ok(linhas[1].jump?.gap.join() === '12,13,14', 'o salto 11 -> 15 pula 12, 13 e 14')
  ok(linhas.filter((l) => l.fragment).map((l) => l.fragment).join() === '1,2', 'dois fragmentos, comecando em 10 e 15')
  ok(linhas[5].last && !linhas[4].last, 'so a ultima linha e o fim da cadeia')
  ok(describeJump(11, 15, tabela) === '12–14 em uso', `faixa do salto: ${describeJump(11, 15, tabela)}`)
  ok(describeJump(18, 5, tabela) === 'volta ao 5', 'salto para tras')
  ok(fatValue('EOF', 'FAT32') === 'EOF (0x0FFFFFFF)', 'EOF de FAT32 com o valor do backend')
  ok(fatValue('livre', 'FAT16') === '0 (livre)', 'cluster livre vale 0')
  ok(
    dados.slack_interno === dados.num_clusters * disco.clusterSize - dados.tamanho_arquivo,
    `slack_interno = num_clusters x cluster_size - tamanho (${dados.slack_interno})`,
  )
  ok(usedInLast(2600, 6, 512) === 40, 'ultimo cluster usa 40 B de 512')
  ok(slackShare(dados.slack_interno, dados.tamanho_total_clusters) === '15,4%', 'slack e 15,4% do espaco em disco')
  ok(
    describeOne({ name: 'dados.bin', dir: false, size: 2600, chain: dados.cadeia }) ===
      'dados.bin: 2.600 B em 6 clusters, 2 fragmentos',
    'barra de status da tela 01',
  )
  ok(describeOne({ name: 'x', dir: false, size: 0, chain: [] }) === 'x: 0 B, nenhum cluster alocado', 'arquivo vazio')
  const rel = await mockApi.chain('/docs/relatorio.txt')
  ok(
    describeMany([
      { name: 'dados.bin', dir: false, size: 2600, chain: dados.cadeia },
      { name: 'relatorio.txt', dir: false, size: 1300, chain: rel.cadeia },
    ]) === '2 objetos selecionados: 3.900 B em 9 clusters, 1 fragmentado',
    'barra de status da tela 02',
  )
  const donos = await mapOwners(
    (p) => mockApi.ls(p),
    (c) => chainFromFat(tabela, c),
    disco.rootCluster,
  )
  ok(donos.get(disco.rootCluster!) === '/', 'o cluster da raiz pertence a raiz')
  ok(describeOccupants([12, 13, 14], tabela, donos) === 'backup\\copia.txt', 'quem ocupa o salto de dados.bin')
  const livre = tabela.find((c) => c.status === 'livre')!.cluster
  ok(describeOccupants([livre], tabela, donos) === 'livre', 'cluster livre no salto')
  corromper()
  const fatCorrompida = (await mockApi.diskFat()).entradas
  ok(describeOccupants([livre], fatCorrompida, donos) === 'sem dono', 'cluster ocupado que ninguem alcanca')

  console.log('\n21. Disco (fase 6): formatar e espaco insuficiente')
  const p16 = planFormat('fat16', 512, 256)
  ok(
    p16.capacity === 131072 && p16.first === 2 && p16.last === 257 && p16.rootMax === 64,
    'tela 08: 131.072 B, clusters 2-257, raiz fixa de 64',
  )
  ok(p16.fatEntries === 258 && p16.fatBytes === 516, 'FAT16: (256 + 2) entradas de 2 B = 516 B')
  ok(p16.fatRegion === 1024 && p16.dataOffset === 1536, 'regiao da FAT arredondada para 2 clusters')
  const p32 = planFormat('fat32', 512, 1024)
  ok(p32.fatBytes === 4104 && p32.rootMax === null, 'FAT32: 1026 entradas de 4 B, raiz como cadeia')
  // 5120 is what the real backend answered for FAT32 / 512 / 1024
  ok(p32.dataOffset === 5120, 'data_offset do FAT32 1024 igual ao do backend (5120)')
  for (const [variante, cs, n] of [
    ['fat16', 512, 256],
    ['fat32', 512, 1024],
    ['fat16', 64, 1],
    ['fat32', 2048, 300],
  ] as const) {
    const real = await mockApi.formatDisk({ variante, cluster_size: cs, num_clusters: n })
    const plano = planFormat(variante, cs, n)
    ok(
      real.dataOffset === plano.dataOffset && real.espacoTotal === plano.capacity && real.numClusters === n,
      `planFormat bate com o mock em ${variante} / ${cs} B / ${n}`,
    )
  }
  ok('value' in parseClusterCount(' 256 ') && (parseClusterCount(' 256 ') as { value: number }).value === 256, 'contagem valida')
  for (const t of ['0', '1025', '12a', '', '-3', '2.5']) ok('error' in parseClusterCount(t), `contagem recusada: ${JSON.stringify(t)}`)
  ok(describeCapacity(131072) === '131.072 bytes (128 KB)', 'capacidade da tela 08')
  ok(describeCapacity(131072, 'B') === '131.072 B (128 KB)', 'capacidade da tela 17')
  ok(describeCapacity(64) === '64 bytes' && shortSize(1536) === '1,5 KB' && shortSize(2097152) === '2 MB', 'KB e MB')

  // tela 05 with the mockup's numbers: 220 free, a file of 300 clusters
  await mockApi.formatDisk({ variante: 'fat16', cluster_size: 512, num_clusters: 256 })
  await mockApi.createFile('/base.bin')
  await mockApi.write('/base.bin', bytesToBase64(new Uint8Array(35 * 512)))
  ok((await mockApi.diskInfo()).clustersLivres === 220, '220 clusters livres antes do video.avi')
  await mockApi.createFile('/video.avi')
  let recusa: unknown = null
  try {
    await mockApi.write('/video.avi', bytesToBase64(new Uint8Array(300 * 512)))
  } catch (e) {
    recusa = e
  }
  ok(
    recusa instanceof ApiError &&
      recusa.status === 400 &&
      recusa.message === 'Espaço insuficiente: precisamos de 300 cluster(s) a mais.',
    'escrita recusada com 400 e a mensagem do backend',
  )
  ok((await mockApi.diskInfo()).clustersLivres === 220, 'alocacao atomica: nenhum cluster foi alocado')
  const tela05 = describeShortage({
    name: 'video.avi',
    dir: '/',
    needed: 300,
    free: 220,
    clusterSize: 512,
    untouched: true,
  })
  ok(tela05.lead === 'Não foi possível criar "video.avi" em A:\\.', 'tela 05: frase de abertura')
  ok(
    tela05.facts[0][1] === '300 clusters (153.600 B)' && tela05.facts[1][1] === '220 clusters (112.640 B)',
    'tela 05: necessario e livre',
  )
  ok(tela05.note === 'Nenhum cluster foi alocado.', 'tela 05: nota da alocacao atomica')

  // the demo script with the very files it uses: if a change stops the
  // fragmentation from happening on stage, this fails first
  console.log('\n22. Roteiro de demonstracao (docs/demo/roteiro.md)')
  const demo = (name: string) =>
    bytesToBase64(
      new Uint8Array(readFileSync(fileURLToPath(new URL(`../../docs/demo/${name}`, import.meta.url)))),
    )
  const upload = async (path: string, name: string) => {
    await mockApi.createFile(path)
    await mockApi.write(path, demo(name))
    return (await mockApi.chain(path)).cadeia
  }
  await mockApi.formatDisk({ variante: 'fat16', cluster_size: 512, num_clusters: 256 })
  ok((await mockApi.mkdir('/DOCS')).primeiro_cluster === 3, 'passo 2: /DOCS no cluster 3')
  ok((await upload('/DOCS/ata.txt', 'ata.txt')).join() === '4,5,6', 'passo 2: ata.txt em 4-6')
  ok((await upload('/DOCS/notas.txt', 'notas.txt')).join() === '7,8', 'passo 2: notas.txt em 7-8')
  await mockApi.remove('/DOCS/ata.txt')
  ok((await mockApi.diskInfo()).clustersLivres === 252, 'passo 3: buraco de 3 clusters (252 livres)')
  const relDemo = await upload('/DOCS/relatorio.txt', 'relatorio.txt')
  ok(relDemo.join() === '4,5,6,9,10' && fragmentado(relDemo), `passo 4: relatorio.txt fragmentado: [${relDemo}]`)
  ok((await mockApi.chain('/DOCS/relatorio.txt')).slack_interno === 260, 'passo 5: slack 5 x 512 - 2300 = 260')
  const fatAntes = JSON.stringify(await mockApi.diskFat())
  await mockApi.overwrite('/DOCS/relatorio.txt', 1530, txt('## TRECHO NOVO ##'))
  ok(JSON.stringify(await mockApi.diskFat()) === fatAntes, 'passo 6: sobrescrever atravessando o salto 6 -> 9 nao muda a FAT')
  const lido = await mockApi.readFile('/DOCS/relatorio.txt')
  ok(
    lido.tamanho === 2300 && lido.conteudo_texto.slice(1530, 1547) === '## TRECHO NOVO ##',
    'passo 6: o conteudo mudou no lugar',
  )
  await mockApi.replace('/DOCS/relatorio.txt', txt('Versao curta do relatorio.'))
  ok((await mockApi.chain('/DOCS/relatorio.txt')).cadeia.join() === '4', 'passo 7: a cadeia encolhe para [4]')
  ok((await mockApi.diskInfo()).clustersLivres === 251, 'passo 7: 5, 6, 9 e 10 voltam a ficar livres')
  ok((await mockApi.diskCheck()).consistente, 'passo 8: disco consistente')
  const fat32 = await mockApi.formatDisk({ variante: 'fat32', cluster_size: 512, num_clusters: 1024 })
  ok(
    fat32.clustersLivres === 1023 && fat32.rootMaxEntradas === null && fat32.dataOffset === 5120,
    'passo 9: FAT32 com 1024 clusters, raiz como cadeia',
  )

  console.log('\n23. Janelas (area de trabalho XP)')
  const vp = { width: 1280, height: 690 }
  let d = deskReducer(EMPTY_DESK, { type: 'open', kind: 'explorer', pos: initialPos('explorer', vp, 0) })
  const ex = d.windows[0]
  ok(d.windows.length === 1 && d.activeId === ex.id && ex.title === 'Simulador FAT', 'abrir o Explorer: uma janela, ativa')
  ok(ex.pos.x === 210 && ex.pos.y === 35, 'Explorer centralizado acima da barra de tarefas')
  d = deskReducer(d, { type: 'open', kind: 'explorer', pos: { x: 0, y: 0 } })
  ok(d.windows.length === 1 && d.windows[0].pos.x === 210, 'instancia unica: reabrir nao cria outra')
  d = deskReducer(d, { type: 'open', kind: 'recycle', pos: initialPos('recycle', vp, 1) })
  const rc = d.windows[1]
  ok(d.activeId === rc.id && rc.z > ex.z, 'Lixeira abre ativa e no topo')
  ok(takesKeys(d, rc.id) && !takesKeys(d, ex.id), 'so a janela ativa recebe teclas')
  d = deskReducer(d, { type: 'taskbar', id: rc.id })
  ok(d.windows[1].minimized && d.activeId === ex.id, 'botao da ativa minimiza e ativa a proxima')
  ok(!takesKeys(d, rc.id), 'minimizada nao recebe teclas')
  d = deskReducer(d, { type: 'taskbar', id: rc.id })
  ok(!d.windows[1].minimized && d.activeId === rc.id, 'botao da minimizada restaura e ativa')
  d = deskReducer(d, { type: 'activate', id: ex.id })
  ok(d.windows[0].z > d.windows[1].z, 'ativar traz para o topo')
  d = deskReducer(d, { type: 'toggleMaximize', id: ex.id })
  d = deskReducer(d, { type: 'move', id: ex.id, pos: { x: 5, y: 5 } })
  ok(d.windows[0].maximized && d.windows[0].pos.x === 210, 'maximizada nao arrasta')
  d = deskReducer(d, { type: 'minimize', id: ex.id })
  d = deskReducer(d, { type: 'taskbar', id: ex.id })
  ok(d.windows[0].maximized && !d.windows[0].minimized, 'restaurar volta maximizada')
  d = deskReducer(d, { type: 'retitle', id: ex.id, title: 'A:\\DOCS (Simulador FAT)' })
  ok(d.windows[0].title === 'A:\\DOCS (Simulador FAT)', 'titulo acompanha a pasta')
  d = deskReducer(d, { type: 'deactivate' })
  ok(d.activeId === null && !takesKeys(d, ex.id), 'clique na area de trabalho desativa todas')
  d = deskReducer(d, { type: 'activate', id: ex.id })
  d = deskReducer(d, { type: 'close', id: ex.id })
  ok(d.windows.length === 1 && d.activeId === rc.id, 'fechar a ativa ativa a proxima visivel')
  d = deskReducer(d, { type: 'minimize', id: rc.id })
  ok(d.activeId === null && topVisible(d) === null, 'tudo minimizado: nenhuma ativa')
  const lim = clampPos({ x: -5000, y: 5000 }, { width: 860, height: 620 }, vp)
  ok(lim.x === 120 - 860 && lim.y === 690 - 28, 'barra de titulo sempre alcancavel acima da barra de tarefas')
  d = deskReducer({ ...d, windows: d.windows.map((w) => ({ ...w, pos: { x: 3000, y: 3000 } })) }, { type: 'clampAll', viewport: vp })
  ok(d.windows[0].pos.x === 1280 - 120 && d.windows[0].pos.y === 690 - 28, 'janela fora da tela volta ao redimensionar')
  ok(fits('explorer', { width: 1366, height: 738 }), 'Explorer cabe em 1366x768 em tela cheia')
  ok(!fits('explorer', { width: 1366, height: 600 }), 'Explorer nao cabe em altura menor que 620')
  ok(!fits('explorer', { width: 800, height: 700 }), 'Explorer nao cabe em largura menor que 860')
  const pequena = { width: 1366, height: 600 }
  const pos = initialPos('explorer', pequena, 0)
  const cheia = deskReducer(EMPTY_DESK, { type: 'open', kind: 'explorer', pos, maximized: !fits('explorer', pequena) })
  ok(cheia.windows[0].maximized && cheia.windows[0].pos.y === 0, 'sem espaco o Explorer abre maximizado')
  const normal = deskReducer(EMPTY_DESK, { type: 'open', kind: 'explorer', pos })
  ok(!normal.windows[0].maximized, 'sem o sinal abre restaurado')
  const reaberta = deskReducer(normal, { type: 'open', kind: 'explorer', pos, maximized: true })
  ok(reaberta.windows.length === 1 && !reaberta.windows[0].maximized, 'reabrir a instancia unica nao muda o estado')
  const restaurada = deskReducer(cheia, { type: 'toggleMaximize', id: cheia.windows[0].id })
  ok(!restaurada.windows[0].maximized && restaurada.windows[0].pos === pos, 'restaurar volta a posicao de abertura')

  console.log('\n24. Zoom e preferencias')
  ok(stepZoom(1, 1) === 1.1 && stepZoom(1, -1) === 0.9, 'um passo para cada lado')
  ok(stepZoom(2, 1) === 2 && stepZoom(0.75, -1) === 0.75, 'para nos extremos 75% e 200%')
  ok(stepZoom(1.3, 1) === 1.5 && stepZoom(1.3, -1) === 1.25, 'valor fora da lista vai ao passo vizinho')
  ok(parseZoom('1.5') === 1.5 && parseZoom('abc') === 1 && parseZoom('3') === 1 && parseZoom(null) === 1, 'zoom guardado invalido volta a 100%')
  ok(formatZoom(1.5) === '150%' && formatZoom(0.9) === '90%', 'porcentagem')
  zoomPref.set(1.25)
  ok(zoomPref.get() === 1.25, 'preferencia funciona sem localStorage')
  zoomPref.set(1)
  ok(mutePref.get() === false, 'som comeca ligado')
  {
    // own block: section 16 already has a `sem`
    const tela = { width: 1280, height: 720 }
    const sem = clampMenu({ x: 100, y: 100 }, { width: 200, height: 300 }, tela, 1)
    ok(sem.x === 100 && sem.y === 100, 'menu cabe: abre no ponteiro')
    const z2 = clampMenu({ x: 1100, y: 600 }, { width: 200, height: 300 }, tela, 2)
    ok(z2.x === 450 && z2.y === 150, 'zoom 200%: vira para a esquerda e para cima, em px CSS')
    const z2ok = clampMenu({ x: 300, y: 200 }, { width: 200, height: 300 }, tela, 2)
    ok(z2ok.x === 150 && z2ok.y === 100, 'zoom 200%: ponteiro dividido pelo zoom')
  }
  ok(startPhase('', false) === 'boot' && startPhase('?sem-boot', false) === 'desktop', 'inicializacao: ?sem-boot pula')
  ok(startPhase('', true) === 'desktop', 'ja logado nesta aba vai direto')
  ok(startPhase('?sem-disco&sem-boot', false) === 'desktop' && startPhase('?sem-disco', false) === 'boot', 'sem-boot convive com sem-disco')

  console.log('\n25. Baloes da bandeja')
  const info32 = await mockApi.formatDisk({ variante: 'fat32', cluster_size: 512, num_clusters: 1024 })
  ok(formattedBalloon(info32).text === 'FAT32 · 1.023 clusters livres', 'balao de formatacao com os numeros do disco')
  ok(checkBalloon({ consistente: true, erros: [] }).text === 'Nenhum problema encontrado.', 'verificacao limpa')
  ok(checkBalloon({ consistente: false, erros: ['a'] }).text === '1 problema encontrado.' &&
     checkBalloon({ consistente: false, erros: ['a', 'b'] }).text === '2 problemas encontrados.', 'singular e plural')
  ok(checkBalloon({ consistente: false, erros: ['a'] }).icon === 'warning', 'problema usa icone de aviso')

  console.log(falhas === 0 ? '\nTUDO OK\n' : `\n${falhas} FALHA(S)\n`)
  process.exit(falhas === 0 ? 0 : 1)
}

main()
