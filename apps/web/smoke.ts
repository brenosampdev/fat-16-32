// Smoke test do mock: roda com `npx tsx smoke.ts`.
// Nao faz parte do projeto final — e so para provar que o mock obedece o contrato.

import { ApiError } from './src/api/client'
import { corromper, mockApi, resetar, semear } from './src/api/mock'
import { base64ToBytes, bytesToBase64, fragmentado } from './src/api/paths'

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

  console.log(falhas === 0 ? '\nTUDO OK\n' : `\n${falhas} FALHA(S)\n`)
  process.exit(falhas === 0 ? 0 : 1)
}

main()
