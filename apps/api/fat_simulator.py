#!/usr/bin/env python3
"""
fat_simulator.py — Simulador didático de FAT16/FAT32
Trabalho de Sistemas de Arquivos — Turma 26

Implementa os mecanismos centrais do FAT:
  • Tabela de alocação (FAT16: entradas de 2 bytes, FAT32: 4 bytes / 28 bits usados)
  • Clusters encadeados via FAT
  • Entradas de diretório armazenadas em clusters
  • Operações: ler, escrever, sobrescrever, apagar, substituir, renomear, mover

Formato do arquivo de disco virtual:
  ┌──────────────────────────────────────┐
  │  Cabeçalho (512 bytes)               │  ← magic, variante, parâmetros
  ├──────────────────────────────────────┤
  │  Tabela FAT                          │  ← N×2 (FAT16) ou N×4 (FAT32) bytes
  ├──────────────────────────────────────┤
  │  Clusters de dados (a partir do 2)   │  ← cluster 2 = raiz; clusters contíguos
  └──────────────────────────────────────┘

Entrada de diretório (64 bytes, formato proprietário):
  Offset  Tam  Campo
  0       1    status         (0x00=fim, 0xE5=deletado, 0x01=válido)
  1       1    attr           (0x10=diretório, 0x20=arquivo)
  2       2    _reservado
  4       32   name           (até 31 bytes UTF-8 + '\0')
  36      4    file_size      (uint32, little-endian)
  40      4    first_cluster  (uint32)
  44      4    ctime          (unix timestamp uint32)
  48      4    mtime          (unix timestamp uint32)
  52      12   _padding
"""

import os
import sys
import struct
import time
import shlex
from typing import List, Optional, Tuple

# ═══════════════════════════════════════════════════════════════════
#  Constantes
# ═══════════════════════════════════════════════════════════════════

MAGIC           = b'FATSIMU\x00'
HEADER_SIZE     = 512
DIR_ENTRY_SIZE  = 64
MAX_NAME_LEN    = 31

# Status de entrada de diretório
ST_FREE    = 0x00   # Fim das entradas; slot pode ser reutilizado
ST_DELETED = 0xE5   # Deletada (dados nos clusters ainda intactos — como no FAT real)
ST_VALID   = 0x01   # Entrada ativa

# Atributos
ATTR_FILE  = 0x20
ATTR_DIR   = 0x10

# FAT16 — entradas de 2 bytes
F16_FREE   = 0x0000
F16_BAD    = 0xFFF7
F16_EOF    = 0xFFFF
F16_EOFMIN = 0xFFF8   # 0xFFF8–0xFFFF → todos são EOF
F16_RSV0   = 0xFFF8   # FAT[0]
F16_RSV1   = 0xFFFF   # FAT[1]
F16_MAX_CL = 65524    # Máximo de clusters de dados em FAT16

# FAT32 — entradas de 4 bytes, 28 bits usados
F32_FREE   = 0x00000000
F32_BAD    = 0x0FFFFFF7
F32_EOF    = 0x0FFFFFFF
F32_EOFMIN = 0x0FFFFFF8
F32_MASK   = 0x0FFFFFFF   # Apenas bits 0–27 carregam o valor
F32_RSV0   = 0x0FFFFFF8
F32_RSV1   = 0x0FFFFFFF
F32_MAX_CL = 268435444

# Início da faixa de valores reservados (nunca são ligações válidas).
# FAT16: 0xFFF0–0xFFF6 | FAT32: 0x0FFFFFF0–0x0FFFFFF6  (0x?FF7 = defeituoso)
F16_RSVMIN = 0xFFF0
F32_RSVMIN = 0x0FFFFFF0
F32_HIGH   = 0xF0000000   # 4 bits altos da entrada FAT32: devem ser preservados

# Padrões de formatação
DEFAULT_CLUSTER_SIZE  = 512
DEFAULT_CLUSTERS_FAT16 = 256    # 128 KB de dados
DEFAULT_CLUSTERS_FAT32 = 1024   # 512 KB de dados
FAT16_ROOT_MAX         = 64     # Limite de entradas do diretório raiz em FAT16

# Formato da entrada de diretório (64 bytes)
_ENTRY_FMT = '<BB2s32sIIII12s'
assert struct.calcsize(_ENTRY_FMT) == 64, "BUG: tamanho inesperado da entrada"

# Formato do cabeçalho (34 bytes; preenchido a 512)
_HEADER_FMT = '<8sHIIIIII'
_HEADER_SZ  = struct.calcsize(_HEADER_FMT)   # 34 bytes


# ═══════════════════════════════════════════════════════════════════
#  Exceção
# ═══════════════════════════════════════════════════════════════════

class FATError(Exception):
    """Erros previsíveis do sistema de arquivos simulado."""


def _is_int(value) -> bool:
    """True para inteiros de verdade (bool é subclasse de int e é recusado)."""
    return isinstance(value, int) and not isinstance(value, bool)


def _geometry(variant, cluster_size, num_clusters) -> int:
    """
    Valida a geometria do volume e devolve o data_offset correspondente.
    Usada tanto por format() quanto por open(), garantindo que um disco só
    é aceito se tiver exatamente o layout que format() produziria.
    """
    if not _is_int(variant) or variant not in (16, 32):
        raise FATError("Variante inválida. Use 16 ou 32.")
    if (not _is_int(cluster_size) or cluster_size < 64
            or (cluster_size & (cluster_size - 1)) != 0):
        raise FATError("cluster_size deve ser potência de 2 e ≥ 64.")
    if not _is_int(num_clusters) or num_clusters < 1:
        raise FATError("num_clusters deve ser um inteiro ≥ 1.")
    if variant == 16 and num_clusters > F16_MAX_CL:
        raise FATError(f"FAT16 suporta no máximo {F16_MAX_CL} clusters.")
    if variant == 32 and num_clusters > F32_MAX_CL:
        raise FATError(f"FAT32 suporta no máximo {F32_MAX_CL} clusters.")

    entry_size = 2 if variant == 16 else 4
    fat_bytes  = (num_clusters + 2) * entry_size          # clusters 0 e 1 reservados
    fat_region = ((fat_bytes + cluster_size - 1) // cluster_size) * cluster_size
    return HEADER_SIZE + fat_region


# ═══════════════════════════════════════════════════════════════════
#  FATDisk — disco virtual e tabela FAT
# ═══════════════════════════════════════════════════════════════════

class FATDisk:
    """
    Gerencia o arquivo de disco e a tabela FAT.

    Responsabilidades:
      - Formatar e abrir/fechar o arquivo de disco
      - Ler/escrever entradas individuais da FAT
      - Alocar, encadear e liberar cadeias de clusters
      - Ler/escrever o conteúdo bruto de clusters
    """

    def __init__(self, path: str):
        self.path             = path
        self.fp               = None
        self.variant: int     = 0
        self.cluster_size: int = 0
        self.num_clusters: int = 0
        self.fat_offset: int  = HEADER_SIZE
        self.data_offset: int = 0
        self.root_cluster: int = 2
        self.root_max_entries: int = 0

    # ─── Formatação e abertura ──────────────────────────────────────

    def format(self, variant: int = 16,
               cluster_size: int = DEFAULT_CLUSTER_SIZE,
               num_clusters: int = None):
        """
        Cria e inicializa um novo disco virtual.
        TODA a validação acontece antes de abrir o arquivo: parâmetros
        inválidos nunca truncam um arquivo existente.
        """
        if num_clusters is None and _is_int(variant) and variant in (16, 32):
            num_clusters = DEFAULT_CLUSTERS_FAT16 if variant == 16 else DEFAULT_CLUSTERS_FAT32
        data_offset = _geometry(variant, cluster_size, num_clusters)

        self.close()   # Se este objeto já tinha um disco aberto, liberá-lo

        self.variant          = variant
        self.cluster_size     = cluster_size
        self.num_clusters     = num_clusters
        self.fat_offset       = HEADER_SIZE
        self.root_cluster     = 2
        self.root_max_entries = FAT16_ROOT_MAX if variant == 16 else 0
        self.data_offset      = data_offset

        # Criar arquivo com tamanho total zerado
        total = self.data_offset + num_clusters * cluster_size
        self.fp = open(self.path, 'w+b')
        self.fp.seek(total - 1)
        self.fp.write(b'\x00')
        self.fp.flush()

        # Gravar cabeçalho e inicializar FAT
        self._write_header()

        # FAT[0] e FAT[1] reservados (como na especificação)
        self._fat_raw_write(0, F16_RSV0 if variant == 16 else F32_RSV0)
        self._fat_raw_write(1, F16_RSV1 if variant == 16 else F32_RSV1)

        # Cluster 2 = diretório raiz (cadeia de um único cluster → EOF)
        self._fat_raw_write(2, F16_EOF if variant == 16 else F32_EOF)
        # Clusters 3..num_clusters+1 → livres (já zerados)

    def open(self):
        """Abre um disco virtual existente, validando cabeçalho e tamanho."""
        if not os.path.exists(self.path):
            raise FATError(f"Arquivo não encontrado: '{self.path}'")
        self.close()
        self.fp = open(self.path, 'r+b')
        try:
            self._read_header()
        except Exception:
            self.close()     # Não deixar descritor aberto para um disco inválido
            raise

    def close(self):
        if self.fp:
            self.fp.close()
            self.fp = None

    # ─── Cabeçalho ─────────────────────────────────────────────────

    def _write_header(self):
        self.fp.seek(0)
        raw = struct.pack(_HEADER_FMT, MAGIC, self.variant, self.cluster_size,
                          self.num_clusters, self.fat_offset, self.data_offset,
                          self.root_cluster, self.root_max_entries)
        self.fp.write(raw.ljust(HEADER_SIZE, b'\x00'))

    def _read_header(self):
        self.fp.seek(0)
        raw = self.fp.read(_HEADER_SZ)
        if len(raw) < _HEADER_SZ:
            raise FATError("Cabeçalho truncado: arquivo pequeno demais para ser um disco.")
        (magic, variant, cluster_size, num_clusters, fat_offset,
         data_offset, root_cluster, root_max_entries) = struct.unpack(_HEADER_FMT, raw)
        if magic != MAGIC:
            raise FATError("Arquivo não reconhecido como disco FAT simulado.")

        # Validar a geometria antes de confiar em qualquer campo
        try:
            expected_data = _geometry(variant, cluster_size, num_clusters)
        except FATError as ex:
            raise FATError(f"Cabeçalho corrompido: {ex}") from None
        if fat_offset != HEADER_SIZE:
            raise FATError(f"Cabeçalho corrompido: fat_offset={fat_offset} (esperado {HEADER_SIZE}).")
        if data_offset != expected_data:
            raise FATError(f"Cabeçalho corrompido: data_offset={data_offset} "
                           f"(esperado {expected_data}).")
        if root_cluster != 2:
            raise FATError(f"Cabeçalho corrompido: root_cluster={root_cluster} (esperado 2).")
        expected_root_max = FAT16_ROOT_MAX if variant == 16 else 0
        if root_max_entries != expected_root_max:
            raise FATError(f"Cabeçalho corrompido: root_max_entries={root_max_entries} "
                           f"(esperado {expected_root_max}).")

        expected_size = data_offset + num_clusters * cluster_size
        actual_size   = os.fstat(self.fp.fileno()).st_size
        if actual_size < expected_size:
            raise FATError(f"Disco truncado: {actual_size} bytes, "
                           f"esperado pelo menos {expected_size}.")

        self.variant          = variant
        self.cluster_size     = cluster_size
        self.num_clusters     = num_clusters
        self.fat_offset       = fat_offset
        self.data_offset      = data_offset
        self.root_cluster     = root_cluster
        self.root_max_entries = root_max_entries

    # ─── Operações na FAT ──────────────────────────────────────────

    def _require_open(self):
        if self.fp is None:
            raise FATError("Disco não está aberto.")

    def _check_fat_index(self, cluster: int):
        """Entradas válidas da FAT: 0 .. num_clusters+1 (0 e 1 são reservadas)."""
        self._require_open()
        if not _is_int(cluster) or not (0 <= cluster < self.num_clusters + 2):
            raise FATError(f"Entrada FAT fora do intervalo: {cluster}.")

    def _check_data_cluster(self, cluster: int):
        """Clusters de dados válidos: 2 .. num_clusters+1."""
        self._require_open()
        if not _is_int(cluster) or not (2 <= cluster < self.num_clusters + 2):
            raise FATError(f"Cluster de dados fora do intervalo: {cluster}.")

    def _fat_entry_offset(self, cluster: int) -> int:
        """Offset em bytes da entrada FAT para o cluster N."""
        entry_sz = 2 if self.variant == 16 else 4
        return self.fat_offset + cluster * entry_sz

    def _fat_raw_write(self, cluster: int, value: int):
        self.fp.seek(self._fat_entry_offset(cluster))
        if self.variant == 16:
            self.fp.write(struct.pack('<H', value & 0xFFFF))
        else:
            # FAT32 usa só 28 bits; os 4 bits altos pertencem ao "dono" do
            # volume e DEVEM ser preservados (especificação da Microsoft).
            old = struct.unpack('<I', self.fp.read(4))[0]
            self.fp.seek(self._fat_entry_offset(cluster))
            self.fp.write(struct.pack('<I', (old & F32_HIGH) | (value & F32_MASK)))

    def fat_read(self, cluster: int) -> int:
        """Lê o valor da entrada FAT para o cluster N."""
        self._check_fat_index(cluster)
        self.fp.seek(self._fat_entry_offset(cluster))
        if self.variant == 16:
            return struct.unpack('<H', self.fp.read(2))[0]
        return struct.unpack('<I', self.fp.read(4))[0] & F32_MASK

    def fat_write(self, cluster: int, value: int):
        """Escreve um valor na entrada FAT e faz flush."""
        self._check_fat_index(cluster)
        self._fat_raw_write(cluster, value)
        self.fp.flush()

    # ─── Consultas sobre valores FAT ───────────────────────────────

    def is_free(self, val: int) -> bool:
        return val == (F16_FREE if self.variant == 16 else F32_FREE)

    def is_eof(self, val: int) -> bool:
        """True se o valor representa fim de cadeia."""
        if self.variant == 16:
            return val >= F16_EOFMIN
        return (val & F32_MASK) >= F32_EOFMIN

    def is_bad(self, val: int) -> bool:
        return val == (F16_BAD if self.variant == 16 else (F32_BAD & F32_MASK))

    def eof_value(self) -> int:
        return F16_EOF if self.variant == 16 else F32_EOF

    def _rsv_min(self) -> int:
        return F16_RSVMIN if self.variant == 16 else F32_RSVMIN

    def _alloc_limit(self) -> int:
        """
        Primeiro número de cluster que NÃO pode ser alocado.
        Num volume FAT16/FAT32 no tamanho máximo, os últimos números de
        cluster coincidem com valores reservados (0x?FFF0–0x?FFF6); esses
        clusters nunca são usados, senão a ligação seria ambígua.
        """
        return min(self.num_clusters + 2, self._rsv_min())

    def is_valid_link(self, val: int) -> bool:
        """True se 'val' é um número de cluster utilizável como ligação."""
        return 2 <= val < self._alloc_limit()

    # ─── Alocação e liberação ──────────────────────────────────────

    def fat_alloc(self) -> int:
        """
        Encontra o primeiro cluster livre (busca linear / first-fit),
        marca-o como EOF e retorna seu número.
        Lança FATError se o disco estiver cheio.
        """
        for c in range(2, self._alloc_limit()):
            if self.is_free(self.fat_read(c)):
                self.fat_write(c, self.eof_value())
                return c
        raise FATError("Disco cheio: não há clusters livres.")

    def fat_extend_chain(self, last_cluster: int) -> int:
        """
        Aloca um novo cluster, atualiza FAT[last_cluster] para apontar para ele,
        marca o novo cluster como EOF e retorna seu número.
        """
        self._check_data_cluster(last_cluster)   # validar ANTES de alocar
        new_cl = self.fat_alloc()
        self.fat_write(last_cluster, new_cl)
        return new_cl

    def fat_free_chain(self, start: int):
        """
        Libera todos os clusters de uma cadeia a partir de 'start'.
        A cadeia inteira é validada primeiro (fat_traverse): se estiver
        corrompida, nada é modificado.
        """
        if start < 2:
            return
        free_val = F16_FREE if self.variant == 16 else F32_FREE
        for c in self.fat_traverse(start):
            self.fat_write(c, free_val)

    def fat_traverse(self, start: int) -> List[int]:
        """
        Percorre a cadeia a partir de 'start' e retorna a lista de clusters.
        Lança FATError se encontrar: ciclo, cluster fora do volume, ligação
        para entrada livre (0), reservada (1 ou 0x?FFF0–0x?FFF6) ou
        defeituosa (0x?FFF7). Nunca modifica o disco.
        """
        if start < 2:
            return []            # 0 = "sem clusters" (arquivo vazio)
        if not self.is_valid_link(start):
            raise FATError(f"Cadeia inválida: cluster inicial {start} fora do volume.")

        clusters, visited, current = [], set(), start
        while True:
            visited.add(current)
            clusters.append(current)
            nxt = self.fat_read(current)
            if self.is_eof(nxt):
                return clusters
            if self.is_free(nxt):
                raise FATError(f"Cadeia corrompida: cluster {current} aponta para "
                               f"entrada livre (cadeia iniciada em {start}).")
            if self.is_bad(nxt):
                raise FATError(f"Cadeia corrompida: cluster {current} aponta para "
                               f"cluster defeituoso (cadeia iniciada em {start}).")
            if not self.is_valid_link(nxt):
                raise FATError(f"Cadeia corrompida: cluster {current} aponta para "
                               f"valor inválido {nxt} (cadeia iniciada em {start}).")
            if nxt in visited:
                raise FATError(f"Ciclo detectado na FAT a partir do cluster {start}.")
            current = nxt

    def fat_count_free(self) -> int:
        """Conta clusters livres disponíveis (percurso linear da FAT)."""
        return sum(1 for c in range(2, self._alloc_limit())
                   if self.is_free(self.fat_read(c)))

    # ─── I/O de clusters ───────────────────────────────────────────

    def cluster_offset(self, cluster: int) -> int:
        """Offset em bytes do cluster N no arquivo."""
        return self.data_offset + (cluster - 2) * self.cluster_size

    def cluster_read(self, cluster: int) -> bytes:
        """Lê o conteúdo bruto de um cluster."""
        self._check_data_cluster(cluster)
        self.fp.seek(self.cluster_offset(cluster))
        return self.fp.read(self.cluster_size)

    def cluster_write(self, cluster: int, data: bytes):
        """Escreve dados no cluster (zero-padding até cluster_size)."""
        self._check_data_cluster(cluster)
        if len(data) > self.cluster_size:
            raise FATError("Dados maiores que cluster_size.")
        self.fp.seek(self.cluster_offset(cluster))
        self.fp.write(data.ljust(self.cluster_size, b'\x00'))
        self.fp.flush()

    def clusters_needed(self, size: int) -> int:
        """Número de clusters necessários para armazenar 'size' bytes."""
        if size == 0:
            return 0
        return (size + self.cluster_size - 1) // self.cluster_size

    # ─── Informações gerais ────────────────────────────────────────

    def info(self) -> dict:
        free = self.fat_count_free()
        return {
            'variante':           f'FAT{self.variant}',
            'cluster_size':       f'{self.cluster_size} bytes',
            'num_clusters':       self.num_clusters,
            'clusters_livres':    free,
            'clusters_usados':    self.num_clusters - free,
            'espaco_total':       f'{self.num_clusters * self.cluster_size} bytes',
            'espaco_livre':       f'{free * self.cluster_size} bytes',
            'fat_offset':         f'{self.fat_offset} bytes',
            'data_offset':        f'{self.data_offset} bytes',
            'root_cluster':       self.root_cluster,
            'root_max_entradas':  self.root_max_entries or '(ilimitado — FAT32)',
        }

    def fat_dump(self) -> List[Tuple[int, str]]:
        """Retorna a lista de (cluster, descrição) de toda a FAT."""
        result = []
        for c in range(2, self.num_clusters + 2):
            val = self.fat_read(c)
            if self.is_free(val):
                desc = 'livre'
            elif self.is_eof(val):
                desc = 'EOF'
            elif self.is_bad(val):
                desc = 'defeituoso'
            else:
                desc = f'→ {val}'
            result.append((c, desc))
        return result


# ═══════════════════════════════════════════════════════════════════
#  Directory — entradas de diretório
# ═══════════════════════════════════════════════════════════════════

class Directory:
    """
    Gerencia as entradas de diretório armazenadas em cadeias de clusters.

    Cada cluster comporta (cluster_size / 64) entradas.
    Uma entrada com status ST_FREE indica o fim da sequência.
    Entradas com status ST_DELETED podem ser reutilizadas.
    """

    def __init__(self, disk: FATDisk):
        self.disk = disk

    def _epc(self) -> int:
        """Entradas por cluster."""
        return self.disk.cluster_size // DIR_ENTRY_SIZE

    # ─── Serialização ──────────────────────────────────────────────

    @staticmethod
    def pack_entry(e: dict) -> bytes:
        name_b = e['name'].encode('utf-8')[:31].ljust(32, b'\x00')
        return struct.pack(_ENTRY_FMT,
                           e.get('status', ST_VALID),
                           e.get('attr', ATTR_FILE),
                           b'\x00\x00',
                           name_b,
                           e.get('file_size', 0),
                           e.get('first_cluster', 0),
                           e.get('ctime', int(time.time())),
                           e.get('mtime', int(time.time())),
                           b'\x00' * 12)

    @staticmethod
    def unpack_entry(raw: bytes) -> dict:
        (status, attr, _res, name_b, file_size,
         first_cluster, ctime, mtime, _pad) = struct.unpack(_ENTRY_FMT, raw)
        name = name_b.rstrip(b'\x00').decode('utf-8', errors='replace')
        return {
            'status':        status,
            'attr':          attr,
            'name':          name,
            'file_size':     file_size,
            'first_cluster': first_cluster,
            'ctime':         ctime,
            'mtime':         mtime,
            'is_dir':        bool(attr & ATTR_DIR),
        }

    # ─── Leitura de entradas ───────────────────────────────────────

    def read_all(self, start: int, max_e: int = None) -> List[Tuple[int, int, dict]]:
        """
        Percorre todos os clusters da cadeia e retorna:
          [(cluster, índice_no_cluster, entry_dict), ...]
        para entradas com status ST_VALID.
        'max_e' limita a busca (FAT16 diretório raiz).
        """
        chain = self.disk.fat_traverse(start)
        if not chain:
            chain = [start]

        result, total, epc = [], 0, self._epc()
        for cl in chain:
            data = self.disk.cluster_read(cl)
            for i in range(epc):
                if max_e is not None and total >= max_e:
                    return result
                off = i * DIR_ENTRY_SIZE
                e = self.unpack_entry(data[off:off + DIR_ENTRY_SIZE])
                if e['status'] == ST_FREE:
                    return result   # Fim das entradas
                if e['status'] == ST_VALID:
                    result.append((cl, i, e))
                total += 1
        return result

    def find(self, start: int, name: str, max_e: int = None
             ) -> Optional[Tuple[int, int, dict]]:
        """
        Busca uma entrada pelo nome (case-sensitive).
        Retorna (cluster, índice, entry) ou None.
        """
        chain = self.disk.fat_traverse(start)
        if not chain:
            chain = [start]

        total, epc = 0, self._epc()
        for cl in chain:
            data = self.disk.cluster_read(cl)
            for i in range(epc):
                if max_e is not None and total >= max_e:
                    return None
                off = i * DIR_ENTRY_SIZE
                e = self.unpack_entry(data[off:off + DIR_ENTRY_SIZE])
                if e['status'] == ST_FREE:
                    return None
                if e['status'] == ST_VALID and e['name'] == name:
                    return (cl, i, e)
                total += 1
        return None

    def locate_slot(self, start: int, max_e: int = None) -> Tuple[str, Optional[int], Optional[int]]:
        """
        Descobre ONDE uma nova entrada seria gravada, sem modificar nada:
          ('slot',   cluster, índice) → há um slot livre/deletado reutilizável
          ('expand', último_cluster, None) → é preciso alocar mais um cluster
          ('full',   None, None)    → limite de entradas atingido (raiz FAT16)
        Permite que as operações verifiquem espaço ANTES de alterar o disco.
        """
        chain = self.disk.fat_traverse(start)
        if not chain:
            chain = [start]

        total, epc = 0, self._epc()
        for cl in chain:
            data = self.disk.cluster_read(cl)
            for i in range(epc):
                if max_e is not None and total >= max_e:
                    return ('full', None, None)
                if data[i * DIR_ENTRY_SIZE] in (ST_FREE, ST_DELETED):
                    return ('slot', cl, i)
                total += 1

        if max_e is not None and total >= max_e:
            return ('full', None, None)
        return ('expand', chain[-1], None)

    def add(self, start: int, entry: dict, max_e: int = None) -> bool:
        """
        Insere uma nova entrada no diretório.
        Reutiliza slots ST_DELETED ou ST_FREE.
        Se max_e for definido (FAT16 root) e não houver espaço, retorna False.
        Caso contrário, expande a cadeia com um novo cluster
        (se o disco estiver cheio, fat_alloc lança FATError sem alterar nada).
        """
        kind, cl, idx = self.locate_slot(start, max_e)
        if kind == 'full':
            return False

        if kind == 'slot':
            data = bytearray(self.disk.cluster_read(cl))
            off  = idx * DIR_ENTRY_SIZE
            data[off:off + DIR_ENTRY_SIZE] = self.pack_entry(entry)
            self.disk.cluster_write(cl, bytes(data))
            return True

        # Expandir cadeia com novo cluster (zerado: o slot 1 vira terminador)
        new_cl = self.disk.fat_extend_chain(cl)
        data   = bytearray(self.disk.cluster_size)
        data[0:DIR_ENTRY_SIZE] = self.pack_entry(entry)
        self.disk.cluster_write(new_cl, bytes(data))
        return True

    def update(self, cluster: int, index: int, entry: dict):
        """Atualiza uma entrada específica (cluster + índice no cluster)."""
        data = bytearray(self.disk.cluster_read(cluster))
        off  = index * DIR_ENTRY_SIZE
        data[off:off + DIR_ENTRY_SIZE] = self.pack_entry(entry)
        self.disk.cluster_write(cluster, bytes(data))

    def delete(self, cluster: int, index: int):
        """Marca uma entrada como deletada (0xE5), como no FAT real."""
        data     = bytearray(self.disk.cluster_read(cluster))
        data[index * DIR_ENTRY_SIZE] = ST_DELETED
        self.disk.cluster_write(cluster, bytes(data))


# ═══════════════════════════════════════════════════════════════════
#  FileSystem — operações de alto nível
# ═══════════════════════════════════════════════════════════════════

class FileSystem:
    """
    Implementa as 7 operações do trabalho mais operações auxiliares.
    Todas as operações usam caminhos absolutos (ex: '/docs/relatorio.txt').
    """

    def __init__(self, disk: FATDisk):
        self.disk = disk
        self.dir  = Directory(disk)

    # ─── Utilitários de caminho ────────────────────────────────────

    def _root_max(self) -> Optional[int]:
        """Limite de entradas da raiz para FAT16; None para FAT32."""
        return self.disk.root_max_entries if self.disk.variant == 16 else None

    @staticmethod
    def _parts(path: str) -> List[str]:
        """
        Divide um caminho ABSOLUTO em componentes. Barras repetidas e finais
        são ignoradas ('/a//b/' → ['a', 'b']). Caminhos relativos são recusados,
        pois o simulador não tem noção de "diretório corrente".
        """
        if not isinstance(path, str) or not path.startswith('/'):
            raise FATError(f"Caminho deve ser absoluto (começar com '/'): {path!r}.")
        return [p for p in path.split('/') if p]

    def _resolve_dir(self, path: str) -> int:
        """Resolve um caminho de diretório para o cluster de início."""
        parts   = self._parts(path)
        cluster = self.disk.root_cluster
        max_e   = self._root_max()

        for part in parts:
            result = self.dir.find(cluster, part, max_e=max_e)
            if result is None:
                raise FATError(f"Diretório não encontrado: '{part}' em '{path}'.")
            _, _, e = result
            if not e['is_dir']:
                raise FATError(f"'{part}' não é um diretório.")
            cluster = e['first_cluster']
            max_e   = None   # Apenas a raiz tem limite

        return cluster

    def _resolve_parent(self, path: str) -> Tuple[int, str]:
        """
        Resolve o caminho para (cluster_do_diretório_pai, nome_da_entrada).
        Ex: '/docs/relatorio.txt' → (cluster_de_docs, 'relatorio.txt')
        """
        parts = self._parts(path)
        if not parts:
            raise FATError("Caminho inválido.")
        name   = parts[-1]
        parent = '/' + '/'.join(parts[:-1])
        return self._resolve_dir(parent), name

    def _parent_max(self, path: str) -> Optional[int]:
        """Retorna o max_entries se o pai for o diretório raiz."""
        return self._root_max() if len(self._parts(path)) == 1 else None

    def _dir_max(self, path: str) -> Optional[int]:
        """Retorna o max_entries se o PRÓPRIO caminho for a raiz."""
        return self._root_max() if not self._parts(path) else None

    def _validate_name(self, name: str):
        """
        O campo 'name' da entrada tem 32 bytes: até 31 bytes UTF-8 + '\\0'.
        O limite é em BYTES (não em caracteres): 'é' ocupa 2 bytes.
        """
        if not isinstance(name, str) or not name:
            raise FATError(f"Nome deve ter 1–{MAX_NAME_LEN} bytes em UTF-8.")
        if '/' in name:
            raise FATError("Nome não pode conter '/'.")
        if '\x00' in name:
            raise FATError("Nome não pode conter o caractere nulo (\\0).")
        if name in ('.', '..'):
            raise FATError("Os nomes '.' e '..' são reservados.")
        try:
            size = len(name.encode('utf-8'))
        except UnicodeEncodeError:
            raise FATError("Nome contém caracteres que não podem ser codificados em UTF-8.") from None
        if size > MAX_NAME_LEN:
            raise FATError(f"Nome deve ter 1–{MAX_NAME_LEN} bytes em UTF-8 "
                           f"(recebido: {size} bytes).")

    def _find_entry(self, path: str, missing_msg: str) -> Tuple[int, int, dict, str]:
        """Localiza a entrada de 'path' → (cluster, índice, entry, nome)."""
        parent_cl, name = self._resolve_parent(path)
        result = self.dir.find(parent_cl, name, max_e=self._parent_max(path))
        if result is None:
            raise FATError(missing_msg)
        cl_e, idx_e, e = result
        return cl_e, idx_e, e, name

    def _find_file(self, path: str) -> Tuple[int, int, dict]:
        """Localiza um ARQUIVO (não diretório) → (cluster, índice, entry)."""
        cl_e, idx_e, e, name = self._find_entry(path, f"Arquivo não encontrado: '{path}'.")
        if e['is_dir']:
            raise FATError(f"'{name}' é um diretório.")
        return cl_e, idx_e, e

    def _data_chain(self, e: dict, path: str) -> List[int]:
        """
        Devolve a cadeia de clusters de um arquivo, garantindo que os
        metadados são coerentes: first_cluster == 0 ⟺ file_size == 0, e o
        número de clusters da cadeia == ceil(file_size / cluster_size).
        Operações de leitura/escrita recusam arquivos inconsistentes em vez
        de devolver lixo ou espalhar a corrupção.
        """
        first, size = e['first_cluster'], e['file_size']
        if first == 0:
            if size != 0:
                raise FATError(f"Metadados inconsistentes em '{path}': "
                               f"file_size={size} sem clusters alocados.")
            return []
        if size == 0:
            raise FATError(f"Metadados inconsistentes em '{path}': "
                           f"file_size=0 mas first_cluster={first}.")
        chain    = self.disk.fat_traverse(first)
        expected = self.disk.clusters_needed(size)
        if len(chain) != expected:
            raise FATError(f"Metadados inconsistentes em '{path}': cadeia tem "
                           f"{len(chain)} cluster(s), mas file_size={size} exige {expected}.")
        return chain

    def _reserve_entry(self, parent_cl: int, max_e: Optional[int], extra: int = 0):
        """
        Garante, ANTES de qualquer escrita, que cabe uma nova entrada no
        diretório pai e que há clusters livres para ela + 'extra' clusters.
        """
        kind, _, _ = self.dir.locate_slot(parent_cl, max_e)
        if kind == 'full':
            raise FATError("Diretório pai cheio (limite FAT16).")
        needed = extra + (1 if kind == 'expand' else 0)
        if needed > self.disk.fat_count_free():
            raise FATError("Disco cheio: não há clusters livres.")

    # ─── Listagem ──────────────────────────────────────────────────

    def ls(self, path: str = '/') -> List[dict]:
        """Lista entradas válidas de um diretório."""
        cluster = self._resolve_dir(path)
        return [e for _, _, e in self.dir.read_all(cluster, max_e=self._dir_max(path))]

    # ─── Criação ───────────────────────────────────────────────────

    def mkdir(self, path: str):
        """
        Cria um novo diretório. Precisa de 1 cluster para o diretório e,
        talvez, de mais 1 para expandir o pai. Tudo é verificado antes.
        """
        parent_cl, name = self._resolve_parent(path)
        self._validate_name(name)
        max_e = self._parent_max(path)

        if self.dir.find(parent_cl, name, max_e=max_e):
            raise FATError(f"'{name}' já existe.")
        self._reserve_entry(parent_cl, max_e, extra=1)

        # Alocar cluster para o diretório e zerá-lo (slot 0 = terminador)
        cl = self.disk.fat_alloc()
        self.disk.cluster_write(cl, b'\x00' * self.disk.cluster_size)

        now = int(time.time())
        entry = dict(status=ST_VALID, attr=ATTR_DIR, name=name,
                     file_size=0, first_cluster=cl, ctime=now, mtime=now)
        self.dir.add(parent_cl, entry, max_e=max_e)   # espaço já garantido

    def create(self, path: str):
        """Cria um arquivo vazio (sem alocar clusters)."""
        parent_cl, name = self._resolve_parent(path)
        self._validate_name(name)
        max_e = self._parent_max(path)

        if self.dir.find(parent_cl, name, max_e=max_e):
            raise FATError(f"'{name}' já existe.")
        self._reserve_entry(parent_cl, max_e)

        now = int(time.time())
        entry = dict(status=ST_VALID, attr=ATTR_FILE, name=name,
                     file_size=0, first_cluster=0,   # 0 = sem clusters alocados
                     ctime=now, mtime=now)
        self.dir.add(parent_cl, entry, max_e=max_e)

    # ─── OPERAÇÃO 1: ler ──────────────────────────────────────────

    def ler(self, path: str) -> bytes:
        """
        Lê o conteúdo de um arquivo.
        Percorre a cadeia de clusters via FAT e retorna exatamente
        file_size bytes (o último cluster pode estar parcialmente ocupado).
        """
        _, _, e = self._find_file(path)
        chain = self._data_chain(e, path)
        data  = b''.join(self.disk.cluster_read(c) for c in chain)
        return data[:e['file_size']]  # Truncar conforme file_size registrado

    # ─── OPERAÇÃO 2: escrever (acrescentar) ───────────────────────

    @staticmethod
    def _as_bytes(data) -> bytes:
        """Aceita bytes/bytearray/memoryview; recusa str e outros tipos."""
        if isinstance(data, (bytes, bytearray, memoryview)):
            return bytes(data)
        raise FATError("Dados devem ser do tipo bytes.")

    def escrever(self, path: str, data: bytes):
        """
        Acrescenta dados ao final do arquivo.
        Verifica disponibilidade de espaço ANTES de modificar qualquer cluster.
        """
        cl_e, idx_e, e = self._find_file(path)
        data  = self._as_bytes(data)
        chain = self._data_chain(e, path)
        self._write_at(e, data, cl_e, idx_e, offset=e['file_size'], chain=chain)

    # ─── OPERAÇÃO 3: sobrescrever ─────────────────────────────────

    def sobrescrever(self, path: str, offset: int, data: bytes):
        """
        Sobrescreve bytes no arquivo a partir de 'offset'.
        O arquivo NÃO é expandido; offset + len(data) deve caber no tamanho atual.
        Para expandir, use escrever() ou substituir().
        """
        cl_e, idx_e, e = self._find_file(path)
        if not _is_int(offset) or offset < 0:
            raise FATError(f"Offset inválido: {offset!r} (deve ser inteiro ≥ 0).")
        data = self._as_bytes(data)

        end = offset + len(data)
        if end > e['file_size']:
            raise FATError(
                f"sobrescrever vai além do arquivo "
                f"(tamanho={e['file_size']}, offset={offset}, len={len(data)}). "
                f"Use escrever() para expandir.")

        chain = self._data_chain(e, path)
        self._write_at(e, data, cl_e, idx_e, offset=offset, chain=chain)

    # ─── OPERAÇÃO 4: apagar ───────────────────────────────────────

    def apagar(self, path: str):
        """
        Apaga um arquivo ou diretório vazio.
        Marca a entrada como 0xE5 e libera a cadeia de clusters na FAT.
        (Conteúdo dos clusters permanece fisicamente — como no FAT real.)
        Toda validação acontece antes da primeira escrita.
        """
        cl_e, idx_e, e, name = self._find_entry(path, f"'{path}' não encontrado.")
        first = e['first_cluster']

        if e['is_dir']:
            # read_all também valida a cadeia do diretório (lança se corrompida)
            if self.dir.read_all(first):
                raise FATError(f"Diretório '{name}' não está vazio.")

        if first:
            self.disk.fat_free_chain(first)   # valida a cadeia inteira antes de liberar

        self.dir.delete(cl_e, idx_e)

    # ─── OPERAÇÃO 5: substituir ───────────────────────────────────

    def substituir(self, path: str, data: bytes):
        """
        Substitui todo o conteúdo do arquivo por 'data'.
        Reaproveita os primeiros clusters da cadeia atual, libera os
        excedentes (se encolher) ou aloca novos (se crescer).
        Verifica espaço ANTES de modificar qualquer dado.
        """
        cl_e, idx_e, e = self._find_file(path)
        data = self._as_bytes(data)
        old_chain = self._data_chain(e, path)

        cs         = self.disk.cluster_size
        old_cl_cnt = len(old_chain)
        new_cl_cnt = self.disk.clusters_needed(len(data))
        extra      = max(0, new_cl_cnt - old_cl_cnt)

        if extra > self.disk.fat_count_free():
            raise FATError(
                f"Espaço insuficiente: precisamos de {extra} cluster(s) a mais.")

        free_val = 0
        if new_cl_cnt < old_cl_cnt:
            # Encolher: o novo último cluster vira EOF; o resto é liberado
            chain = old_chain[:new_cl_cnt]
            if chain:
                self.disk.fat_write(chain[-1], self.disk.eof_value())
            for c in old_chain[new_cl_cnt:]:
                self.disk.fat_write(c, free_val)
        else:
            # Crescer (ou manter): estender a cadeia existente
            chain = list(old_chain)
            while len(chain) < new_cl_cnt:
                if chain:
                    chain.append(self.disk.fat_extend_chain(chain[-1]))
                else:
                    chain = [self.disk.fat_alloc()]

        # Gravar novo conteúdo nos clusters (o último é completado com zeros)
        for i, cl in enumerate(chain):
            self.disk.cluster_write(cl, data[i * cs:(i + 1) * cs])

        e['file_size']     = len(data)
        e['first_cluster'] = chain[0] if chain else 0
        e['mtime']         = int(time.time())
        self.dir.update(cl_e, idx_e, e)

    # ─── OPERAÇÃO 6: renomear ─────────────────────────────────────

    def renomear(self, path: str, novo_nome: str):
        """
        Renomeia um arquivo ou diretório.
        Clusters, conteúdo e ctime permanecem intocados; mtime é atualizado.
        """
        self._validate_name(novo_nome)
        cl_e, idx_e, e, _ = self._find_entry(path, f"'{path}' não encontrado.")
        parent_cl, _ = self._resolve_parent(path)

        if self.dir.find(parent_cl, novo_nome, max_e=self._parent_max(path)):
            raise FATError(f"'{novo_nome}' já existe no mesmo diretório.")

        e['name']  = novo_nome
        e['mtime'] = int(time.time())
        self.dir.update(cl_e, idx_e, e)

    # ─── OPERAÇÃO 7: mover ────────────────────────────────────────

    def mover(self, src: str, dst: str):
        """
        Move um arquivo ou diretório para 'dst' (diretório de destino).
        Apenas as entradas de diretório são modificadas; nenhum cluster é copiado.
        Conflito, ciclo e falta de espaço são verificados ANTES de gravar.
        """
        src_cl_e, src_idx_e, e, src_name = self._find_entry(src, f"'{src}' não encontrado.")

        # Destino deve ser um diretório existente
        dst_cl    = self._resolve_dir(dst)
        dst_max_e = self._dir_max(dst)

        if self.dir.find(dst_cl, src_name, max_e=dst_max_e):
            raise FATError(f"'{src_name}' já existe no destino '{dst}'.")

        # Não é possível mover um diretório para dentro de si mesmo
        if e['is_dir']:
            self._check_cycle(e['first_cluster'], dst_cl)

        # Verificar espaço no destino sem alterar nada
        kind, _, _ = self.dir.locate_slot(dst_cl, dst_max_e)
        if kind == 'full':
            raise FATError("Destino cheio (limite FAT16).")
        if kind == 'expand' and self.disk.fat_count_free() == 0:
            raise FATError("Disco cheio: não há clusters livres para expandir o destino.")

        # Adicionar no destino e depois remover da origem
        self.dir.add(dst_cl, e, max_e=dst_max_e)
        self.dir.delete(src_cl_e, src_idx_e)

    def _check_cycle(self, moving_cl: int, dst_cl: int):
        """Verifica se dst_cl é o próprio moving_cl ou um descendente dele."""
        visited, stack = {moving_cl}, [moving_cl]
        while stack:
            cur = stack.pop()
            if cur == dst_cl:
                raise FATError(
                    "Não é possível mover um diretório para dentro de si mesmo.")
            for _, _, sub in self.dir.read_all(cur):
                if sub['is_dir'] and sub['first_cluster'] not in visited:
                    visited.add(sub['first_cluster'])
                    stack.append(sub['first_cluster'])

    # ─── Cadeia de um arquivo ─────────────────────────────────────

    def chain(self, path: str) -> List[int]:
        """Retorna a lista de clusters alocados para um arquivo ou diretório."""
        _, _, e, _ = self._find_entry(path, f"'{path}' não encontrado.")
        return self.disk.fat_traverse(e['first_cluster']) if e['first_cluster'] else []

    # ─── Verificador de consistência ──────────────────────────────

    def check(self) -> List[str]:
        """
        Verifica a consistência do sistema de arquivos (somente leitura).
        Detecta: ciclos na FAT, ciclos no grafo de diretórios, referências
        inválidas, clusters compartilhados (cross-linked), clusters órfãos
        e cadeias inconsistentes com file_size.
        O percurso é iterativo (pilha explícita) e marca os diretórios já
        visitados, então nunca entra em recursão infinita.
        """
        errors: List[str] = []
        seen:   dict      = {}      # cluster → caminho que o referencia
        visited_dirs      = set()   # clusters iniciais de diretórios já percorridos

        def register(chain: List[int], path: str):
            for c in chain:
                if c in seen:
                    errors.append(
                        f"Cluster {c} compartilhado (cross-linked) por '{path}' e '{seen[c]}'.")
                else:
                    seen[c] = path

        def traverse(first: int, path: str) -> Optional[List[int]]:
            if not self.disk.is_valid_link(first):
                errors.append(f"{path}: referência a cluster inválido {first}.")
                return None
            try:
                return self.disk.fat_traverse(first)
            except FATError as ex:
                errors.append(f"{path}: {ex}")
                return None

        stack = [(self.disk.root_cluster, '/', True)]
        while stack:
            cl, path, is_root = stack.pop()
            if cl in visited_dirs:
                errors.append(f"{path}: ciclo no grafo de diretórios "
                              f"(cluster {cl} já foi visitado).")
                continue
            chain = traverse(cl, path)
            if chain is None:
                continue
            visited_dirs.add(cl)
            register(chain, path)

            try:
                entries = self.dir.read_all(cl, max_e=self._root_max() if is_root else None)
            except FATError as ex:
                errors.append(f"{path}: {ex}")
                continue

            for _, _, e in entries:
                ep = path.rstrip('/') + '/' + e['name']
                first, size = e['first_cluster'], e['file_size']
                if e['is_dir']:
                    stack.append((first, ep, False))
                elif first == 0:
                    if size != 0:
                        errors.append(f"{ep}: first_cluster=0 mas file_size={size}.")
                else:
                    fc = traverse(first, ep)
                    if fc is None:
                        continue
                    register(fc, ep)
                    exp = self.disk.clusters_needed(size)
                    if len(fc) != exp:
                        errors.append(f"{ep}: cadeia tem {len(fc)} cluster(s), "
                                      f"mas file_size={size} exige {exp}.")

        # Clusters órfãos: ocupados na FAT, mas sem referência (defeituosos são ignorados)
        for c in range(2, self.disk.num_clusters + 2):
            val = self.disk.fat_read(c)
            if self.disk.is_free(val) or self.disk.is_bad(val):
                continue
            if c not in seen:
                errors.append(
                    f"Cluster {c} está ocupado na FAT mas não referenciado por nenhum arquivo.")

        return errors

    # ─── Auxiliar interno de escrita ──────────────────────────────

    def _write_at(self, e: dict, data: bytes, cl_e: int, idx_e: int, offset: int,
                  chain: Optional[List[int]] = None):
        """
        Grava 'data' a partir de 'offset' no arquivo descrito por 'e'.
        'chain' é a cadeia atual já validada (se None, é obtida aqui).
        Expande a cadeia se necessário; verifica espaço antes de modificar.
        """
        cs      = self.disk.cluster_size
        new_end = offset + len(data)
        if chain is None:
            chain = self._data_chain(e, e.get('name', '?'))
        chain = list(chain)

        # Verificar espaço para clusters adicionais
        need_cnt = self.disk.clusters_needed(new_end)
        extra    = max(0, need_cnt - len(chain))
        if extra > self.disk.fat_count_free():
            raise FATError(
                f"Espaço insuficiente: precisamos de {extra} cluster(s) a mais.")

        # Expandir cadeia se necessário
        while len(chain) < need_cnt:
            if not chain:
                nc = self.disk.fat_alloc()
                e['first_cluster'] = nc
                chain = [nc]
            else:
                chain.append(self.disk.fat_extend_chain(chain[-1]))

        # Escrever dados nos clusters corretos (read-modify-write)
        pos, written = offset, 0
        while written < len(data):
            cl_idx  = pos // cs
            cl_off  = pos % cs
            cl      = chain[cl_idx]
            cl_data = bytearray(self.disk.cluster_read(cl))
            to_w    = min(cs - cl_off, len(data) - written)
            cl_data[cl_off:cl_off + to_w] = data[written:written + to_w]
            self.disk.cluster_write(cl, bytes(cl_data))
            pos     += to_w
            written += to_w

        # Atualizar metadados
        e['file_size'] = max(e['file_size'], new_end)
        e['mtime']     = int(time.time())
        self.dir.update(cl_e, idx_e, e)


# ═══════════════════════════════════════════════════════════════════
#  CLI — interface de linha de comando
# ═══════════════════════════════════════════════════════════════════

HELP = """
╔══════════════════════════════════════════════════════════════════╗
║               FAT16/FAT32 Simulator — Comandos                  ║
╠══════════════════════════════════════════════════════════════════╣
║ format [fat16|fat32] [cluster=N] [clusters=N]                   ║
║                     Formata um novo disco virtual               ║
║ info                Exibe parâmetros do disco                   ║
║ fat                 Exibe a tabela FAT                          ║
║ check               Verifica a consistência do sistema          ║
║                                                                 ║
║ ls [caminho]        Lista um diretório (padrão: /)              ║
║ mkdir <caminho>     Cria um diretório                           ║
║ create <caminho>    Cria um arquivo vazio                       ║
║                                                                 ║
║ write <caminho> <conteúdo>   Acrescenta ao arquivo              ║
║ read <caminho>               Lê o arquivo  (alias: cat)         ║
║ overwrite <caminho> <offset> <conteúdo>  Sobrescreve bytes      ║
║ replace <caminho> <conteúdo>             Substitui o conteúdo   ║
║ delete <caminho>             Remove arquivo/dir vazio (alias: rm)║
║ rename <caminho> <novo-nome> Renomeia                           ║
║ move <origem> <destino>      Move para outro diretório (alias: mv)║
║ chain <caminho>              Exibe a cadeia de clusters          ║
║                                                                 ║
║ help   exit/quit                                                ║
╚══════════════════════════════════════════════════════════════════╝
"""


class CLI:
    def __init__(self, disk_path: str):
        self.disk_path = disk_path
        self.disk: Optional[FATDisk]    = None
        self.fs:   Optional[FileSystem] = None

    def _ensure(self):
        if self.disk is None:
            raise FATError("Nenhum disco aberto. Use 'format' ou forneça um arquivo existente.")

    def run(self):
        print(f"\n  FAT16/FAT32 Simulator  |  disco: {self.disk_path}")
        print("  Digite 'help' para ver os comandos.\n")

        # Tentar abrir disco existente
        if os.path.exists(self.disk_path):
            try:
                self.disk = FATDisk(self.disk_path)
                self.disk.open()
                self.fs   = FileSystem(self.disk)
                i = self.disk.info()
                print(f"  Disco aberto: {i['variante']}, "
                      f"{i['num_clusters']} clusters × {i['cluster_size']}, "
                      f"{i['espaco_livre']} livres.\n")
            except FATError as ex:
                print(f"  [!] Não foi possível abrir '{self.disk_path}': {ex}\n")
                self.disk = None

        try:
            while True:
                try:
                    line = input("fat> ").strip()
                except (EOFError, KeyboardInterrupt):
                    print()
                    break
                if not line:
                    continue
                try:
                    tokens = shlex.split(line)
                except ValueError as ex:
                    print(f"  [!] Erro de sintaxe: {ex}")
                    continue
                try:
                    self._dispatch(tokens[0].lower(), tokens[1:])
                except SystemExit:
                    break
                except FATError as ex:
                    print(f"  [!] {ex}")
                except Exception as ex:
                    print(f"  [!] Erro inesperado: {ex}")
        finally:
            if self.disk:
                self.disk.close()
                print("  Disco fechado.")

    def _dispatch(self, cmd: str, args: list):
        # ── Controle ──────────────────────────────────────────────
        if cmd in ('exit', 'quit'):
            raise SystemExit
        elif cmd == 'help':
            print(HELP)

        # ── Disco ─────────────────────────────────────────────────
        elif cmd == 'format':
            variant, cs, nc = 16, DEFAULT_CLUSTER_SIZE, None
            try:
                for a in args:
                    if   a == 'fat16':          variant = 16
                    elif a == 'fat32':          variant = 32
                    elif a.startswith('cluster='):  cs = int(a.split('=', 1)[1])
                    elif a.startswith('clusters='): nc = int(a.split('=', 1)[1])
            except ValueError:
                raise FATError("Uso: format [fat16|fat32] [cluster=N] [clusters=N] (N inteiro).") from None
            # Validar a geometria ANTES de fechar o disco atual: se os
            # parâmetros forem inválidos, o disco aberto continua utilizável.
            _geometry(variant, cs, nc if nc is not None else
                      (DEFAULT_CLUSTERS_FAT16 if variant == 16 else DEFAULT_CLUSTERS_FAT32))
            if self.disk:
                self.disk.close()
            self.disk = FATDisk(self.disk_path)
            self.disk.format(variant, cs, nc)
            self.fs   = FileSystem(self.disk)
            i = self.disk.info()
            print(f"  [OK] Disco formatado: {i['variante']}, "
                  f"{i['num_clusters']} clusters × {i['cluster_size']} = {i['espaco_total']}.")

        elif cmd == 'info':
            self._ensure()
            i = self.disk.info()
            print("\n  ┌─── Informações do disco ───────────────────────")
            for k, v in i.items():
                print(f"  │  {k:<25} {v}")
            print("  └────────────────────────────────────────────────\n")

        elif cmd == 'fat':
            self._ensure()
            entries = self.disk.fat_dump()
            print("\n  ┌─── Tabela FAT ─────────────────────────────────")
            for c, desc in entries:
                print(f"  │  [{c:>5}]  {desc}")
            print("  └────────────────────────────────────────────────\n")

        elif cmd == 'check':
            self._ensure()
            errs = self.fs.check()
            if not errs:
                print("  [OK] Sistema de arquivos consistente.")
            else:
                print(f"  [!] {len(errs)} problema(s) encontrado(s):")
                for e in errs:
                    print(f"      • {e}")

        # ── Diretório e arquivos ───────────────────────────────────
        elif cmd == 'ls':
            self._ensure()
            path = args[0] if args else '/'
            entries = self.fs.ls(path)
            print(f"\n  Conteúdo de '{path}':")
            if not entries:
                print("    (vazio)")
            else:
                print(f"  {'Tipo':<6} {'Nome':<35} {'Tamanho':>10}  Modificado")
                print("  " + "─" * 65)
                for e in entries:
                    tipo  = '[DIR]' if e['is_dir'] else '[ARQ]'
                    size  = e['file_size'] if not e['is_dir'] else '-'
                    mtime = time.strftime('%Y-%m-%d %H:%M', time.localtime(e['mtime']))
                    print(f"  {tipo:<6} {e['name']:<35} {str(size):>10}  {mtime}")
            print()

        elif cmd == 'mkdir':
            self._ensure()
            if not args: raise FATError("Uso: mkdir <caminho>")
            self.fs.mkdir(args[0])
            print(f"  [OK] Diretório '{args[0]}' criado.")

        elif cmd == 'create':
            self._ensure()
            if not args: raise FATError("Uso: create <caminho>")
            self.fs.create(args[0])
            print(f"  [OK] Arquivo '{args[0]}' criado.")

        elif cmd == 'write':
            self._ensure()
            if len(args) < 2: raise FATError("Uso: write <caminho> <conteúdo>")
            d = args[1].encode('utf-8')
            self.fs.escrever(args[0], d)
            print(f"  [OK] {len(d)} byte(s) acrescentados em '{args[0]}'.")

        elif cmd in ('read', 'cat'):
            self._ensure()
            if not args: raise FATError(f"Uso: {cmd} <caminho>")
            d = self.fs.ler(args[0])
            print(f"\n  ── {args[0]} ({len(d)} bytes) ──")
            try:
                print(d.decode('utf-8'))
            except UnicodeDecodeError:
                print(f"  [dados binários: {d.hex()}]")
            print()

        elif cmd == 'overwrite':
            self._ensure()
            if len(args) < 3: raise FATError("Uso: overwrite <caminho> <offset> <conteúdo>")
            try: offset = int(args[1])
            except ValueError: raise FATError("offset deve ser inteiro.")
            d = args[2].encode('utf-8')
            self.fs.sobrescrever(args[0], offset, d)
            print(f"  [OK] {len(d)} byte(s) sobrescritos em '{args[0]}' a partir de {offset}.")

        elif cmd == 'replace':
            self._ensure()
            if len(args) < 2: raise FATError("Uso: replace <caminho> <conteúdo>")
            d = args[1].encode('utf-8')
            self.fs.substituir(args[0], d)
            print(f"  [OK] Conteúdo de '{args[0]}' substituído ({len(d)} bytes).")

        elif cmd in ('delete', 'rm'):
            self._ensure()
            if not args: raise FATError(f"Uso: {cmd} <caminho>")
            self.fs.apagar(args[0])
            print(f"  [OK] '{args[0]}' removido.")

        elif cmd == 'rename':
            self._ensure()
            if len(args) < 2: raise FATError("Uso: rename <caminho> <novo-nome>")
            self.fs.renomear(args[0], args[1])
            print(f"  [OK] Renomeado para '{args[1]}'.")

        elif cmd in ('move', 'mv'):
            self._ensure()
            if len(args) < 2: raise FATError(f"Uso: {cmd} <origem> <destino>")
            self.fs.mover(args[0], args[1])
            print(f"  [OK] '{args[0]}' movido para '{args[1]}'.")

        elif cmd == 'chain':
            self._ensure()
            if not args: raise FATError("Uso: chain <caminho>")
            c = self.fs.chain(args[0])
            if not c:
                print(f"  '{args[0]}' não possui clusters alocados (arquivo vazio).")
            else:
                print(f"  Cadeia de '{args[0]}': {' → '.join(str(x) for x in c)} → EOF")
            print()

        else:
            print(f"  [!] Comando desconhecido: '{cmd}'. Digite 'help'.")


# ═══════════════════════════════════════════════════════════════════
#  Ponto de entrada
# ═══════════════════════════════════════════════════════════════════

def main():
    disk_path = sys.argv[1] if len(sys.argv) > 1 else 'fat_disk.img'
    CLI(disk_path).run()


if __name__ == '__main__':
    main()
