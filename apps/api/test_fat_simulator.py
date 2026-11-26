"""
Testes extensivos para o simulador proprietário fat_simulator.py.

Dependências:
    python -m pip install pytest pytest-timeout pytest-cov hypothesis

Execução:
    python -m pytest test_fat_simulator.py -v --timeout=15

Cobertura:
    python -m pytest test_fat_simulator.py --timeout=15 \
        --cov=fat_simulator --cov-branch --cov-report=term-missing

IMPORTANTE:
- Não modifica nem corrige o módulo sob teste.
- Não importa api.py.
- Não certifica interoperabilidade com imagens FAT16/FAT32 reais.
- Os testes de robustez especificam comportamentos que a versão enviada
  ainda não implementa.
- Execute com pytest-timeout: alguns testes injetam estruturas cíclicas.
"""

import ast
import importlib
import struct
import tempfile
from pathlib import Path

import pytest
from hypothesis import given, settings, strategies as st


# Valores independentes: não usar as constantes do simulador como oráculo.
HEADER_FORMAT = "<8sHIIIIII"
ENTRY_FORMAT = "<BB2s32sIIII12s"
HEADER_BYTES = 512
ENTRY_BYTES = 64

FAT_SPEC = {
    16: {
        "width": 2,
        "mask": 0xFFFF,
        "eof": 0xFFFF,
        "eof_min": 0xFFF8,
        "bad": 0xFFF7,
        "reserved_min": 0xFFF0,
        "rsv0": 0xFFF8,
        "rsv1": 0xFFFF,
    },
    32: {
        "width": 4,
        "mask": 0x0FFFFFFF,
        "eof": 0x0FFFFFFF,
        "eof_min": 0x0FFFFFF8,
        "bad": 0x0FFFFFF7,
        "reserved_min": 0x0FFFFFF0,
        "rsv0": 0x0FFFFFF8,
        "rsv1": 0x0FFFFFFF,
    },
}


@pytest.fixture(scope="session")
def sim():
    # Importação tardia: um erro sintático no simulador não impede a
    # coleta do teste específico de sintaxe.
    try:
        return importlib.import_module("fat_simulator")
    except Exception as exc:
        pytest.fail(
            f"Não foi possível importar fat_simulator: "
            f"{type(exc).__name__}: {exc}",
            pytrace=True,
        )


@pytest.fixture
def factory(tmp_path, sim):
    opened = []

    def make(variant=16, cluster_size=128, num_clusters=128):
        path = tmp_path / f"disk_{len(opened)}.img"
        disk = sim.FATDisk(str(path))
        # Registrar antes da formatação para fechar mesmo em caso de erro.
        opened.append(disk)
        disk.format(
            variant=variant,
            cluster_size=cluster_size,
            num_clusters=num_clusters,
        )
        return disk, sim.FileSystem(disk), path

    yield make

    for disk in reversed(opened):
        disk.close()


@pytest.fixture(params=[16, 32], ids=["FAT16", "FAT32"])
def volume(factory, request):
    return factory(variant=request.param)


def image_bytes(disk):
    disk.fp.flush()
    return Path(disk.path).read_bytes()


def raw_fat_write(disk, cluster, value):
    """Injeção deliberada de corrupção, sem usar fat_write()."""
    width = FAT_SPEC[disk.variant]["width"]
    disk.fp.seek(disk.fat_offset + cluster * width)
    disk.fp.write(value.to_bytes(width, "little"))
    disk.fp.flush()


def entry_location(fs, path):
    parent, name = fs._resolve_parent(path)
    result = fs.dir.find(parent, name, max_e=fs._parent_max(path))
    assert result is not None, f"Entrada não encontrada: {path}"
    return result


def metadata(fs, path):
    return dict(entry_location(fs, path)[2])


def patch_entry(fs, path, **changes):
    cluster, index, entry = entry_location(fs, path)
    entry.update(changes)
    fs.dir.update(cluster, index, entry)


def assert_rejected_unchanged(sim, disk, operation):
    before = image_bytes(disk)
    with pytest.raises(sim.FATError):
        operation()
    assert image_bytes(disk) == before, (
        "Operação rejeitada alterou a imagem do disco."
    )


def audit(disk, fs=None):
    """
    Auditor independente do formato proprietário.

    Verifica:
    - cabeçalho, offsets e tamanho físico;
    - FAT reservada e cadeias limitadas pelo volume;
    - referências livres, ruins, reservadas e fora do intervalo;
    - ciclos, cross-links e clusters órfãos;
    - tamanho dos arquivos e quantidade exata de clusters;
    - nomes UTF-8 sem truncamento inválido;
    - árvore de diretórios sem ciclos nem nomes repetidos.

    Retorna {caminho: metadados_e_conteudo}.
    """
    raw = image_bytes(disk)
    header_size = struct.calcsize(HEADER_FORMAT)
    assert len(raw) >= HEADER_BYTES

    (
        magic, variant, cs, count, fat_offset, data_offset,
        root_cluster, root_max,
    ) = struct.unpack(HEADER_FORMAT, raw[:header_size])

    assert magic == b"FATSIMU\x00"
    assert variant in (16, 32)
    assert cs >= 64 and cs & (cs - 1) == 0
    assert count >= 1
    assert root_cluster == 2
    assert root_max == (64 if variant == 16 else 0)

    spec = FAT_SPEC[variant]
    width = spec["width"]
    expected_fat_bytes = (count + 2) * width
    expected_region = (
        (expected_fat_bytes + cs - 1) // cs
    ) * cs

    assert fat_offset == HEADER_BYTES
    assert data_offset == HEADER_BYTES + expected_region
    assert len(raw) == data_offset + count * cs

    fat = []
    for c in range(count + 2):
        off = fat_offset + c * width
        value = int.from_bytes(raw[off:off + width], "little")
        fat.append(value & spec["mask"])

    assert fat[0] == spec["rsv0"]
    assert fat[1] == spec["rsv1"]

    owners = {}

    def chain(start, owner):
        if start == 0:
            return []

        result = []
        visited = set()
        current = start

        while True:
            assert 2 <= current < count + 2, (
                f"{owner}: cluster inválido {current}"
            )
            assert current not in visited, (
                f"{owner}: ciclo na FAT em {current}"
            )
            assert current not in owners, (
                f"{owner}: cluster {current} compartilhado com "
                f"{owners.get(current)}"
            )

            visited.add(current)
            owners[current] = owner
            result.append(current)

            value = fat[current]

            if value >= spec["eof_min"]:
                return result

            assert value not in (0, 1, spec["bad"]), (
                f"{owner}: ligação inválida {current} -> {value}"
            )
            assert not (
                spec["reserved_min"] <= value < spec["eof_min"]
            ), f"{owner}: marcador reservado na cadeia"

            current = value

    def cluster_data(c):
        off = data_offset + (c - 2) * cs
        data = raw[off:off + cs]
        assert len(data) == cs
        return data

    result = {}
    directories = set()
    pending = [(root_cluster, "/", root_max or None)]

    while pending:
        start, path, limit = pending.pop()

        assert start not in directories, (
            f"Ciclo ou diretório compartilhado em {path}"
        )
        directories.add(start)

        directory_chain = chain(start, path)
        assert directory_chain

        result[path] = {
            "is_dir": True,
            "chain": directory_chain,
            "file_size": 0,
        }

        names = set()
        slot_count = 0
        finished = False

        for c in directory_chain:
            data = cluster_data(c)

            for off in range(0, cs, ENTRY_BYTES):
                if limit is not None and slot_count >= limit:
                    finished = True
                    break

                slot_count += 1
                entry_raw = data[off:off + ENTRY_BYTES]
                assert len(entry_raw) == ENTRY_BYTES

                (
                    status, attr, reserved, name_raw, size,
                    first, ctime, mtime, padding,
                ) = struct.unpack(ENTRY_FORMAT, entry_raw)

                if status == 0:
                    finished = True
                    break
                if status == 0xE5:
                    continue

                assert status == 1, (
                    f"{path}: status desconhecido {status:#x}"
                )
                assert attr in (0x10, 0x20)
                assert reserved == b"\x00" * 2
                assert padding == b"\x00" * 12
                assert b"\x00" in name_raw

                name_part, _, trailing = name_raw.partition(b"\x00")
                assert trailing == b"\x00" * len(trailing)
                name = name_part.decode("utf-8", errors="strict")

                assert name and "/" not in name
                assert name not in names, (
                    f"{path}: nome duplicado {name!r}"
                )
                names.add(name)

                child_path = path.rstrip("/") + "/" + name

                if attr == 0x10:
                    assert size == 0
                    assert first >= 2
                    pending.append((first, child_path, None))
                    continue

                file_chain = chain(first, child_path)
                expected_count = (size + cs - 1) // cs
                assert len(file_chain) == expected_count
                assert (first == 0) == (size == 0)

                payload = b"".join(
                    cluster_data(cl) for cl in file_chain
                )[:size]

                assert len(payload) == size
                result[child_path] = {
                    "is_dir": False,
                    "chain": file_chain,
                    "file_size": size,
                    "data": payload,
                    "ctime": ctime,
                    "mtime": mtime,
                }

            if finished:
                break

    for c in range(2, count + 2):
        # Um cluster marcado defeituoso pode legitimamente não ter dono.
        if fat[c] not in (0, spec["bad"]):
            assert c in owners, f"Cluster órfão: {c}"

    if fs is not None:
        for path, entry in result.items():
            if not entry["is_dir"]:
                assert fs.ler(path) == entry["data"]

        errors = fs.check()
        assert errors == [], f"check() encontrou erros: {errors}"

    return result


# ---------------------------------------------------------------------
# Sintaxe, formatos e constantes
# ---------------------------------------------------------------------

def test_source_has_valid_python_syntax():
    source_path = Path(__file__).with_name("fat_simulator.py")
    source = source_path.read_text(encoding="utf-8")
    ast.parse(source, filename=str(source_path))


def test_binary_formats(sim):
    assert struct.calcsize(sim._ENTRY_FMT) == 64
    assert struct.calcsize(sim._HEADER_FMT) == 34
    assert sim._HEADER_SZ == 34
    assert sim.HEADER_SIZE == 512
    assert sim.DIR_ENTRY_SIZE == 64


@pytest.mark.parametrize(
    "name, expected",
    [
        ("F16_FREE", 0x0000),
        ("F16_BAD", 0xFFF7),
        ("F16_EOF", 0xFFFF),
        ("F16_EOFMIN", 0xFFF8),
        ("F16_RSV0", 0xFFF8),
        ("F16_RSV1", 0xFFFF),
        ("F32_FREE", 0x00000000),
        ("F32_BAD", 0x0FFFFFF7),
        ("F32_EOF", 0x0FFFFFFF),
        ("F32_EOFMIN", 0x0FFFFFF8),
        ("F32_MASK", 0x0FFFFFFF),
        ("F32_RSV0", 0x0FFFFFF8),
        ("F32_RSV1", 0x0FFFFFFF),
    ],
)
def test_constants_against_independent_values(sim, name, expected):
    assert getattr(sim, name) == expected


# ---------------------------------------------------------------------
# Formatação, abertura e geometria
# ---------------------------------------------------------------------

@pytest.mark.parametrize("variant", [16, 32])
@pytest.mark.parametrize("cs", [64, 128, 512, 4096])
@pytest.mark.parametrize("count", [1, 9, 65])
def test_format_geometry(factory, variant, cs, count):
    disk, fs, path = factory(variant, cs, count)

    assert path.exists()
    assert disk.variant == variant
    assert disk.cluster_size == cs
    assert disk.num_clusters == count
    assert disk.root_cluster == 2
    assert disk.fat_count_free() == count - 1
    assert fs.ls("/") == []

    info = disk.info()
    assert info["clusters_usados"] == 1
    assert info["clusters_livres"] == count - 1
    assert info["espaco_total"] == f"{count * cs} bytes"
    assert info["espaco_livre"] == f"{(count - 1) * cs} bytes"

    audit(disk, fs)


@pytest.mark.parametrize(
    "variant, expected_count",
    [(16, 256), (32, 1024)],
)
def test_default_cluster_counts(factory, variant, expected_count):
    disk, fs, _ = factory(
        variant=variant,
        cluster_size=512,
        num_clusters=None,
    )
    assert disk.num_clusters == expected_count
    audit(disk, fs)


@pytest.mark.parametrize(
    "kwargs",
    [
        {"variant": 0},
        {"variant": 12},
        {"variant": 64},
        {"cluster_size": 0},
        {"cluster_size": -64},
        {"cluster_size": 32},
        {"cluster_size": 65},
        {"cluster_size": 192},
        {"num_clusters": 0},
        {"num_clusters": -1},
        {"variant": 16, "num_clusters": 65525},
        {"variant": 32, "num_clusters": 268435445},
    ],
)
def test_invalid_format_preserves_existing_file(tmp_path, sim, kwargs):
    path = tmp_path / "sentinel.img"
    sentinel = b"NAO DEVE SER SOBRESCRITO"
    path.write_bytes(sentinel)
    disk = sim.FATDisk(str(path))

    options = {
        "variant": 16,
        "cluster_size": 128,
        "num_clusters": 32,
    }
    options.update(kwargs)

    try:
        with pytest.raises(sim.FATError):
            disk.format(**options)
        assert path.read_bytes() == sentinel
    finally:
        disk.close()


def test_open_missing_file(tmp_path, sim):
    disk = sim.FATDisk(str(tmp_path / "missing.img"))
    try:
        with pytest.raises(sim.FATError):
            disk.open()
    finally:
        disk.close()


@pytest.mark.parametrize("content", [b"", b"x", b"\x00" * 20,
                                      b"\x00" * 512])
def test_open_invalid_or_truncated_header(tmp_path, sim, content):
    path = tmp_path / "invalid.img"
    path.write_bytes(content)
    disk = sim.FATDisk(str(path))

    try:
        with pytest.raises(sim.FATError):
            disk.open()
    finally:
        disk.close()


@pytest.mark.parametrize(
    "field, value",
    [
        (1, 12),       # Variante.
        (2, 0),        # Cluster size.
        (2, 65),
        (3, 0),        # Quantidade de clusters.
        (4, 0),        # FAT sobre o cabeçalho.
        (5, 0),        # Dados sobre o cabeçalho.
        (6, 1),        # Raiz reservada.
        (6, 9999),     # Raiz fora do volume.
    ],
)
def test_open_rejects_corrupt_geometry(factory, sim, field, value):
    disk, _, path = factory()
    raw = bytearray(image_bytes(disk))
    disk.close()

    size = struct.calcsize(HEADER_FORMAT)
    fields = list(struct.unpack(HEADER_FORMAT, raw[:size]))
    fields[field] = value
    raw[:size] = struct.pack(HEADER_FORMAT, *fields)
    path.write_bytes(raw)

    candidate = sim.FATDisk(str(path))
    try:
        with pytest.raises(sim.FATError):
            candidate.open()
    finally:
        candidate.close()


def test_open_rejects_truncated_data_region(factory, sim):
    disk, _, path = factory()
    raw = image_bytes(disk)
    disk.close()
    path.write_bytes(raw[:-1])

    candidate = sim.FATDisk(str(path))
    try:
        with pytest.raises(sim.FATError):
            candidate.open()
    finally:
        candidate.close()


def test_reopen_preserves_tree_contents_and_metadata(volume, sim):
    disk, fs, path = volume
    fs.mkdir("/docs")
    fs.create("/docs/a")
    fs.escrever("/docs/a", bytes(range(256)) * 3)
    fs.create("/empty")

    before = audit(disk, fs)
    disk.close()

    reopened = sim.FATDisk(str(path))
    try:
        reopened.open()
        new_fs = sim.FileSystem(reopened)
        assert audit(reopened, new_fs) == before
    finally:
        reopened.close()


def test_close_is_idempotent(volume):
    disk, _, _ = volume
    disk.close()
    disk.close()
    assert disk.fp is None


# ---------------------------------------------------------------------
# FAT, clusters e alocação
# ---------------------------------------------------------------------

def test_eof_and_bad_classification(volume):
    disk, _, _ = volume
    spec = FAT_SPEC[disk.variant]

    for value in range(spec["eof_min"], spec["eof"] + 1):
        assert disk.is_eof(value)

    for value in [0, 1, 2, spec["bad"], spec["reserved_min"]]:
        assert not disk.is_eof(value)

    assert disk.is_bad(spec["bad"])
    assert not disk.is_bad(spec["eof"])
    assert disk.is_free(0)
    assert not disk.is_free(2)
    assert disk.eof_value() == spec["eof"]


def test_first_fit_allocation_free_and_reuse(volume, sim):
    disk, _, _ = volume
    count = disk.num_clusters
    allocated = [disk.fat_alloc() for _ in range(count - 1)]

    assert allocated == list(range(3, count + 2))
    assert disk.fat_count_free() == 0

    with pytest.raises(sim.FATError):
        disk.fat_alloc()

    disk.fat_free_chain(allocated[2])
    assert disk.fat_count_free() == 1
    assert disk.fat_alloc() == allocated[2]


def test_extend_traverse_and_free_chain(volume):
    disk, _, _ = volume
    first = disk.fat_alloc()
    second = disk.fat_extend_chain(first)
    third = disk.fat_extend_chain(second)

    assert disk.fat_traverse(first) == [first, second, third]
    assert disk.fat_read(first) == second
    assert disk.fat_read(second) == third
    assert disk.is_eof(disk.fat_read(third))

    before = disk.fat_count_free()
    disk.fat_free_chain(first)

    assert disk.fat_count_free() == before + 3
    assert all(disk.fat_read(c) == 0 for c in [first, second, third])


def test_empty_chain_markers(volume):
    disk, _, _ = volume
    assert disk.fat_traverse(0) == []
    assert disk.fat_traverse(1) == []


def test_cluster_io_padding_and_isolation(volume, sim):
    disk, _, _ = volume
    a = disk.fat_alloc()
    b = disk.fat_alloc()
    cs = disk.cluster_size

    disk.cluster_write(a, b"A" * cs)
    disk.cluster_write(b, b"B" * cs)
    disk.cluster_write(a, b"xyz")

    assert disk.cluster_read(a) == b"xyz" + b"\x00" * (cs - 3)
    assert disk.cluster_read(b) == b"B" * cs

    assert_rejected_unchanged(
        sim, disk,
        lambda: disk.cluster_write(a, b"X" * (cs + 1)),
    )


@pytest.mark.parametrize("operation", ["fat_read", "fat_write",
                                       "cluster_read", "cluster_write"])
def test_out_of_range_access_is_rejected(volume, sim, operation):
    disk, _, _ = volume

    invalid = [-1, disk.num_clusters + 2, disk.num_clusters + 100]
    if operation.startswith("cluster"):
        invalid.extend([0, 1])

    for cluster in invalid:
        if operation == "fat_write":
            call = lambda c=cluster: disk.fat_write(c, 0)
        elif operation == "cluster_write":
            call = lambda c=cluster: disk.cluster_write(c, b"x")
        else:
            call = lambda c=cluster: getattr(disk, operation)(c)

        assert_rejected_unchanged(sim, disk, call)


@pytest.mark.parametrize("size", [0, 1, 63, 64, 65, 127, 128,
                                  129, 511, 512, 513, 10000])
def test_clusters_needed(volume, size):
    disk, _, _ = volume
    expected = (size + disk.cluster_size - 1) // disk.cluster_size
    assert disk.clusters_needed(size) == expected


def test_fat_dump_exact_contents(volume):
    disk, _, _ = volume
    entries = dict(disk.fat_dump())

    assert len(entries) == disk.num_clusters
    assert entries[2] == "EOF"
    assert all(entries[c] == "livre"
               for c in range(3, disk.num_clusters + 2))

    a = disk.fat_alloc()
    b = disk.fat_extend_chain(a)
    entries = dict(disk.fat_dump())

    assert entries[a] == f"→ {b}"
    assert entries[b] == "EOF"


def test_fat32_supports_links_above_16_bits(factory):
    disk, _, _ = factory(32, 64, 65540)

    disk.fat_write(3, 65536)
    disk.fat_write(65536, 0x0FFFFFFF)

    assert disk.fat_read(3) == 65536
    assert disk.fat_traverse(3) == [3, 65536]


def test_fat32_read_ignores_high_nibble(factory):
    disk, _, _ = factory(32)
    raw_fat_write(disk, 3, 0xA0000004)
    assert disk.fat_read(3) == 4


def test_fat32_write_preserves_high_nibble(factory):
    disk, _, _ = factory(32)
    raw_fat_write(disk, 3, 0xA0000004)

    disk.fat_write(3, 5)

    disk.fp.seek(disk.fat_offset + 3 * 4)
    raw_value = struct.unpack("<I", disk.fp.read(4))[0]

    assert raw_value == 0xA0000005
    assert disk.fat_read(3) == 5


# ---------------------------------------------------------------------
# Diretórios e serialização
# ---------------------------------------------------------------------

@pytest.mark.parametrize("attr", [0x10, 0x20])
@pytest.mark.parametrize("name", ["a", "x" * 31, "ação", "文档"])
def test_directory_entry_binary_roundtrip(sim, attr, name):
    entry = {
        "status": 1,
        "attr": attr,
        "name": name,
        "file_size": 0x12345678,
        "first_cluster": 0x00123456,
        "ctime": 1700000000,
        "mtime": 1700000123,
    }

    raw = sim.Directory.pack_entry(entry)
    assert len(raw) == 64
    assert raw[0] == 1
    assert raw[1] == attr
    assert raw[36:40] == b"\x78\x56\x34\x12"

    restored = sim.Directory.unpack_entry(raw)

    for key, value in entry.items():
        assert restored[key] == value
    assert restored["is_dir"] == (attr == 0x10)


def test_deleted_slot_is_reused_without_hiding_later_entries(volume):
    disk, fs, _ = volume
    for name in ["a", "b", "c", "d"]:
        fs.create("/" + name)

    old_cluster, old_index, _ = entry_location(fs, "/b")
    fs.apagar("/b")

    assert {e["name"] for e in fs.ls("/")} == {"a", "c", "d"}

    fs.create("/new")
    new_cluster, new_index, _ = entry_location(fs, "/new")

    assert (new_cluster, new_index) == (old_cluster, old_index)
    assert {e["name"] for e in fs.ls("/")} == {"a", "new", "c", "d"}
    audit(disk, fs)


def test_free_directory_entry_terminates_scan(factory, sim):
    disk, fs, _ = factory()
    root = disk.root_cluster

    second = sim.Directory.pack_entry({
        "name": "invisivel",
        "ctime": 1700000000,
        "mtime": 1700000000,
    })
    disk.cluster_write(root, b"\x00" * 64 + second)

    assert fs.dir.read_all(root) == []
    assert fs.dir.find(root, "invisivel") is None


def test_fat16_root_limit_and_rollback(factory, sim):
    disk, fs, _ = factory(16, 128, 256)

    for i in range(64):
        fs.create(f"/f{i}")

    assert len(fs.ls("/")) == 64

    assert_rejected_unchanged(
        sim, disk, lambda: fs.create("/overflow")
    )
    assert_rejected_unchanged(
        sim, disk, lambda: fs.mkdir("/overflow")
    )

    fs.apagar("/f20")
    fs.create("/reused")
    assert len(fs.ls("/")) == 64
    audit(disk, fs)


def test_fat32_root_can_exceed_fat16_limit(factory):
    disk, fs, _ = factory(32, 128, 256)

    for i in range(90):
        fs.create(f"/f{i}")

    assert len(fs.ls("/")) == 90
    assert len(disk.fat_traverse(2)) == 45
    audit(disk, fs)


def test_subdirectories_can_exceed_64_entries(volume):
    disk, fs, _ = volume
    fs.mkdir("/d")

    for i in range(80):
        fs.create(f"/d/f{i}")

    assert len(fs.ls("/d")) == 80
    audit(disk, fs)


@pytest.mark.parametrize("name", ["a", "x" * 31, "ação", "文档"])
def test_valid_names_remain_accessible(volume, name):
    disk, fs, _ = volume
    fs.create("/" + name)
    fs.escrever("/" + name, b"ok")

    assert fs.ler("/" + name) == b"ok"
    assert fs.ls("/")[0]["name"] == name
    audit(disk, fs)


@pytest.mark.parametrize(
    "name",
    [
        "",
        "x" * 32,
        "é" * 16,        # 32 bytes UTF-8: não cabe no campo.
        "a" * 30 + "é",  # Evita corte no meio de um caractere.
        "abc\x00def",
        "a/b",
    ],
)
def test_invalid_rename_names_are_rejected(volume, sim, name):
    disk, fs, _ = volume
    fs.create("/original")

    assert_rejected_unchanged(
        sim, disk,
        lambda: fs.renomear("/original", name),
    )


@pytest.mark.parametrize("operation", ["create", "mkdir"])
@pytest.mark.parametrize("name", ["x" * 32, "é" * 16, "a\x00b"])
def test_invalid_creation_names(volume, sim, operation, name):
    disk, fs, _ = volume
    assert_rejected_unchanged(
        sim, disk,
        lambda: getattr(fs, operation)("/" + name),
    )


@pytest.mark.parametrize("operation", ["create", "mkdir"])
def test_relative_paths_are_rejected(volume, sim, operation):
    disk, fs, _ = volume
    assert_rejected_unchanged(
        sim, disk,
        lambda: getattr(fs, operation)("relative"),
    )


# ---------------------------------------------------------------------
# Arquivos: conteúdo, fronteiras, metadados e exclusão
# ---------------------------------------------------------------------

@pytest.mark.parametrize(
    "size", [0, 1, 127, 128, 129, 255, 256, 257, 1000]
)
def test_create_write_read_exact_size(volume, size):
    disk, fs, _ = volume
    data = bytes(i % 256 for i in range(size))
    free_before = disk.fat_count_free()

    fs.create("/f")
    assert fs.ler("/f") == b""
    assert fs.chain("/f") == []

    fs.escrever("/f", data)

    expected = (size + disk.cluster_size - 1) // disk.cluster_size
    assert fs.ler("/f") == data
    assert len(fs.chain("/f")) == expected
    assert disk.fat_count_free() == free_before - expected
    assert metadata(fs, "/f")["file_size"] == size
    audit(disk, fs)


def test_append_in_many_chunks(volume):
    disk, fs, _ = volume
    fs.create("/f")
    expected = b""

    for piece in [
        b"", b"A", b"\x00" * 127, bytes(range(256)),
        b"fim", b"\xff" * 300, b"",
    ]:
        fs.escrever("/f", piece)
        expected += piece
        assert fs.ler("/f") == expected
        audit(disk, fs)


@pytest.mark.parametrize(
    "offset, length",
    [(0, 1), (0, 300), (127, 1), (127, 2),
     (120, 40), (255, 2), (299, 1), (300, 0)],
)
def test_overwrite_preserves_other_bytes(volume, offset, length):
    disk, fs, _ = volume
    original = bytes(i % 251 for i in range(300))
    patch = b"\xFE" * length

    fs.create("/f")
    fs.escrever("/f", original)
    old_chain = fs.chain("/f")
    free_before = disk.fat_count_free()

    fs.sobrescrever("/f", offset, patch)

    expected = (
        original[:offset] + patch + original[offset + length:]
    )
    assert fs.ler("/f") == expected
    assert fs.chain("/f") == old_chain
    assert disk.fat_count_free() == free_before
    assert metadata(fs, "/f")["file_size"] == len(original)
    audit(disk, fs)


@pytest.mark.parametrize(
    "offset, data",
    [(-1, b"x"), (-128, b"x"), (3, b"x"),
     (4, b""), (2, b"xx")],
)
def test_invalid_overwrite_is_atomic(volume, sim, offset, data):
    disk, fs, _ = volume
    fs.create("/f")
    fs.escrever("/f", b"abc")

    assert_rejected_unchanged(
        sim, disk,
        lambda: fs.sobrescrever("/f", offset, data),
    )
    assert fs.ler("/f") == b"abc"


@pytest.mark.parametrize("old_size", [0, 1, 128, 129, 400])
@pytest.mark.parametrize("new_size", [0, 1, 127, 128, 129, 500])
def test_replace_grow_shrink_and_clear(volume, old_size, new_size):
    disk, fs, _ = volume
    fs.create("/f")
    fs.escrever("/f", b"A" * old_size)
    old_chain = fs.chain("/f")

    new_data = bytes(i % 256 for i in range(new_size))
    fs.substituir("/f", new_data)

    new_chain = fs.chain("/f")
    expected_count = (
        new_size + disk.cluster_size - 1
    ) // disk.cluster_size

    assert fs.ler("/f") == new_data
    assert len(new_chain) == expected_count

    keep = min(len(old_chain), len(new_chain))
    assert new_chain[:keep] == old_chain[:keep]

    for released in old_chain[expected_count:]:
        assert disk.fat_read(released) == 0

    if new_size == 0:
        assert metadata(fs, "/f")["first_cluster"] == 0

    audit(disk, fs)


def test_delete_marks_entry_and_preserves_raw_data(volume):
    disk, fs, _ = volume
    fs.create("/f")
    fs.escrever("/f", b"segredo" * 50)

    chain = fs.chain("/f")
    original_clusters = [disk.cluster_read(c) for c in chain]
    entry_cluster, entry_index, _ = entry_location(fs, "/f")
    free_before = disk.fat_count_free()

    fs.apagar("/f")

    assert fs.ls("/") == []
    assert disk.fat_count_free() == free_before + len(chain)
    assert all(disk.fat_read(c) == 0 for c in chain)
    assert [disk.cluster_read(c) for c in chain] == original_clusters

    raw_directory = disk.cluster_read(entry_cluster)
    assert raw_directory[entry_index * 64] == 0xE5
    audit(disk, fs)


def test_deleted_clusters_are_reused_first_fit(volume):
    disk, fs, _ = volume
    for name in ["a", "b", "c"]:
        fs.create("/" + name)
        fs.escrever("/" + name, name.encode() * 128)

    old_b = fs.chain("/b")
    old_c = fs.chain("/c")
    fs.apagar("/b")
    fs.escrever("/c", b"X" * 128)

    assert fs.chain("/c") == old_c + old_b
    assert fs.ler("/c") == b"c" * 128 + b"X" * 128
    audit(disk, fs)


def test_ctime_preserved_and_mtime_updated(volume, monkeypatch):
    disk, fs, _ = volume

    with monkeypatch.context() as patch:
        patch.setattr("fat_simulator.time.time", lambda: 1700000000)
        fs.create("/f")

        patch.setattr("fat_simulator.time.time", lambda: 1700000100)
        fs.escrever("/f", b"abc")

        entry = metadata(fs, "/f")
        assert entry["ctime"] == 1700000000
        assert entry["mtime"] == 1700000100

        patch.setattr("fat_simulator.time.time", lambda: 1700000200)
        fs.renomear("/f", "g")

        entry = metadata(fs, "/g")
        assert entry["ctime"] == 1700000000
        assert entry["mtime"] == 1700000200

    audit(disk, fs)


# ---------------------------------------------------------------------
# Erros de alto nível, renomeação, movimentação e árvore
# ---------------------------------------------------------------------

def test_missing_entries_and_invalid_parent_types(volume, sim):
    disk, fs, _ = volume
    fs.create("/file")

    operations = [
        lambda: fs.ler("/missing"),
        lambda: fs.escrever("/missing", b"x"),
        lambda: fs.sobrescrever("/missing", 0, b""),
        lambda: fs.substituir("/missing", b"x"),
        lambda: fs.apagar("/missing"),
        lambda: fs.renomear("/missing", "new"),
        lambda: fs.chain("/missing"),
        lambda: fs.ls("/missing"),
        lambda: fs.create("/missing/child"),
        lambda: fs.mkdir("/missing/child"),
        lambda: fs.create("/file/child"),
        lambda: fs.mkdir("/file/child"),
        lambda: fs.ls("/file"),
    ]

    for operation in operations:
        assert_rejected_unchanged(sim, disk, operation)


def test_file_operations_reject_directories(volume, sim):
    disk, fs, _ = volume
    fs.mkdir("/d")

    for operation in [
        lambda: fs.ler("/d"),
        lambda: fs.escrever("/d", b"x"),
        lambda: fs.sobrescrever("/d", 0, b""),
        lambda: fs.substituir("/d", b"x"),
    ]:
        assert_rejected_unchanged(sim, disk, operation)


def test_duplicate_names_across_entry_types(volume, sim):
    disk, fs, _ = volume
    fs.create("/f")
    fs.mkdir("/d")

    for operation in [
        lambda: fs.create("/f"),
        lambda: fs.mkdir("/f"),
        lambda: fs.create("/d"),
        lambda: fs.mkdir("/d"),
        lambda: fs.renomear("/f", "d"),
    ]:
        assert_rejected_unchanged(sim, disk, operation)


def test_rename_preserves_clusters_content_and_ctime(volume, sim):
    disk, fs, _ = volume
    fs.create("/a")
    fs.escrever("/a", bytes(range(256)) * 3)
    old = metadata(fs, "/a")
    old_chain = fs.chain("/a")
    data = fs.ler("/a")
    fat_before = [disk.fat_read(c)
                  for c in range(disk.num_clusters + 2)]

    fs.renomear("/a", "b")

    assert fs.ler("/b") == data
    assert fs.chain("/b") == old_chain
    assert metadata(fs, "/b")["ctime"] == old["ctime"]
    assert [disk.fat_read(c)
            for c in range(disk.num_clusters + 2)] == fat_before

    with pytest.raises(sim.FATError):
        fs.ler("/a")

    audit(disk, fs)


def test_move_and_rename_directory_preserve_descendants(volume, sim):
    disk, fs, _ = volume
    fs.mkdir("/a")
    fs.mkdir("/a/sub")
    fs.mkdir("/dst")
    fs.create("/a/sub/f")
    fs.escrever("/a/sub/f", b"conteudo" * 40)

    old_chain = fs.chain("/a/sub/f")
    old_data = fs.ler("/a/sub/f")

    fs.renomear("/a", "renamed")
    fs.mover("/renamed", "/dst")

    assert fs.ler("/dst/renamed/sub/f") == old_data
    assert fs.chain("/dst/renamed/sub/f") == old_chain

    with pytest.raises(sim.FATError):
        fs.ls("/a")
    with pytest.raises(sim.FATError):
        fs.ls("/renamed")

    audit(disk, fs)


def test_move_conflicts_missing_destinations_and_cycles(volume, sim):
    disk, fs, _ = volume
    fs.mkdir("/a")
    fs.mkdir("/a/b")
    fs.mkdir("/dst")
    fs.create("/f")
    fs.create("/dst/f")
    fs.create("/not_a_dir")

    for operation in [
        lambda: fs.mover("/f", "/dst"),
        lambda: fs.mover("/f", "/missing"),
        lambda: fs.mover("/missing", "/dst"),
        lambda: fs.mover("/f", "/not_a_dir"),
        lambda: fs.mover("/a", "/a"),
        lambda: fs.mover("/a", "/a/b"),
    ]:
        assert_rejected_unchanged(sim, disk, operation)

    audit(disk, fs)


def test_nonempty_directory_cannot_be_deleted(volume, sim):
    disk, fs, _ = volume
    fs.mkdir("/d")
    fs.create("/d/f")

    assert_rejected_unchanged(
        sim, disk, lambda: fs.apagar("/d")
    )

    fs.apagar("/d/f")
    chain = fs.chain("/d")
    free_before = disk.fat_count_free()
    fs.apagar("/d")

    assert disk.fat_count_free() == free_before + len(chain)
    audit(disk, fs)


# ---------------------------------------------------------------------
# Disco cheio e rollback
# ---------------------------------------------------------------------

@pytest.mark.parametrize("operation", ["append", "replace"])
def test_insufficient_space_preserves_whole_image(
    factory, sim, operation
):
    disk, fs, _ = factory(16, 128, 8)
    fs.create("/f")
    fs.escrever("/f", b"A" * 128)
    fs.create("/filler")
    fs.escrever(
        "/filler",
        b"B" * (disk.fat_count_free() * disk.cluster_size),
    )

    assert disk.fat_count_free() == 0

    if operation == "append":
        call = lambda: fs.escrever("/f", b"X")
    else:
        call = lambda: fs.substituir("/f", b"X" * 129)

    assert_rejected_unchanged(sim, disk, call)
    assert fs.ler("/f") == b"A" * 128
    audit(disk, fs)


def test_replace_can_shrink_on_full_disk(factory):
    disk, fs, _ = factory(16, 128, 8)
    fs.create("/f")
    fs.escrever(
        "/f",
        b"A" * (disk.fat_count_free() * disk.cluster_size),
    )
    assert disk.fat_count_free() == 0

    fs.substituir("/f", b"x")

    assert fs.ler("/f") == b"x"
    assert len(fs.chain("/f")) == 1
    assert disk.fat_count_free() == 6
    audit(disk, fs)


@pytest.mark.parametrize("variant", [16, 32])
def test_mkdir_rolls_back_if_parent_expansion_fails(
    factory, sim, variant
):
    # Cluster de 64 bytes comporta exatamente uma entrada.
    #
    # Cluster 2: raiz contendo /x.
    # Cluster 3: conteúdo de /x.
    # Cluster 4: único cluster livre.
    #
    # mkdir aloca 4 para o novo diretório, mas não sobra cluster
    # para expandir a raiz. A alocação precisa ser desfeita.
    disk, fs, _ = factory(variant, 64, 3)
    fs.create("/x")
    fs.escrever("/x", b"X" * 64)

    assert disk.fat_count_free() == 1

    assert_rejected_unchanged(
        sim, disk, lambda: fs.mkdir("/new")
    )

    assert disk.fat_count_free() == 1
    assert fs.ler("/x") == b"X" * 64
    audit(disk, fs)


def test_move_to_full_fat16_root_preserves_source(factory, sim):
    disk, fs, _ = factory(16, 128, 256)
    fs.mkdir("/src")
    fs.create("/src/file")
    fs.escrever("/src/file", b"original")

    # /src ocupa uma das 64 entradas da raiz.
    for i in range(63):
        fs.create(f"/r{i}")

    assert_rejected_unchanged(
        sim, disk, lambda: fs.mover("/src/file", "/")
    )

    assert fs.ler("/src/file") == b"original"
    audit(disk, fs)


def test_move_to_directory_without_expansion_space(factory, sim):
    disk, fs, _ = factory(16, 64, 32)
    fs.mkdir("/src")
    fs.mkdir("/dst")
    fs.create("/src/f")
    fs.escrever("/src/f", b"dados")
    fs.create("/dst/filler")

    fs.escrever(
        "/dst/filler",
        b"Z" * (disk.fat_count_free() * disk.cluster_size),
    )
    assert disk.fat_count_free() == 0

    assert_rejected_unchanged(
        sim, disk, lambda: fs.mover("/src/f", "/dst")
    )

    assert fs.ler("/src/f") == b"dados"
    audit(disk, fs)


# ---------------------------------------------------------------------
# Corrupção deliberada
# ---------------------------------------------------------------------

@pytest.mark.parametrize(
    "kind",
    ["free", "reserved_one", "bad", "reserved_marker",
     "out_of_range", "self_cycle", "two_cycle"],
)
def test_traverse_rejects_corrupted_chains(volume, sim, kind):
    disk, fs, _ = volume
    fs.create("/f")
    fs.escrever("/f", b"A" * (disk.cluster_size * 2))
    first, second = fs.chain("/f")
    spec = FAT_SPEC[disk.variant]

    if kind == "free":
        raw_fat_write(disk, first, 0)
    elif kind == "reserved_one":
        raw_fat_write(disk, first, 1)
    elif kind == "bad":
        raw_fat_write(disk, first, spec["bad"])
    elif kind == "reserved_marker":
        raw_fat_write(disk, first, spec["reserved_min"])
    elif kind == "out_of_range":
        raw_fat_write(disk, first, disk.num_clusters + 5)
    elif kind == "self_cycle":
        raw_fat_write(disk, first, first)
    else:
        raw_fat_write(disk, second, first)

    before = image_bytes(disk)

    with pytest.raises(sim.FATError):
        disk.fat_traverse(first)

    assert image_bytes(disk) == before


def test_free_corrupt_chain_does_not_partially_modify_fat(volume, sim):
    disk, fs, _ = volume
    fs.create("/f")
    fs.escrever("/f", b"A" * (disk.cluster_size * 2))
    first, second = fs.chain("/f")

    raw_fat_write(disk, second, disk.num_clusters + 7)

    assert_rejected_unchanged(
        sim, disk,
        lambda: disk.fat_free_chain(first),
    )


@pytest.mark.parametrize(
    "changes",
    [
        {"first_cluster": 0, "file_size": 1},
        {"file_size": 10000},
    ],
)
def test_read_rejects_inconsistent_metadata(volume, sim, changes):
    disk, fs, _ = volume
    fs.create("/f")
    fs.escrever("/f", b"abc")
    patch_entry(fs, "/f", **changes)

    assert_rejected_unchanged(
        sim, disk, lambda: fs.ler("/f")
    )


def test_check_detects_orphan_and_is_read_only(volume):
    disk, fs, _ = volume
    disk.fat_alloc()  # Cluster ocupado sem entrada que o referencie.
    before = image_bytes(disk)

    errors = fs.check()

    assert isinstance(errors, list)
    assert errors
    assert any("referenci" in message.lower() for message in errors)
    assert image_bytes(disk) == before


def test_check_detects_cross_link(volume):
    disk, fs, _ = volume
    fs.create("/a")
    fs.escrever("/a", b"A")
    fs.create("/b")
    fs.escrever("/b", b"B")

    old_b = fs.chain("/b")[0]
    disk.fat_free_chain(old_b)
    patch_entry(
        fs, "/b",
        first_cluster=metadata(fs, "/a")["first_cluster"],
    )

    before = image_bytes(disk)
    errors = fs.check()

    assert errors
    assert any(
        "cross" in message.lower()
        or "compartilh" in message.lower()
        or "cruzad" in message.lower()
        for message in errors
    )
    assert image_bytes(disk) == before


def test_check_detects_size_chain_mismatch(volume):
    disk, fs, _ = volume
    fs.create("/f")
    fs.escrever("/f", b"x")
    patch_entry(fs, "/f", file_size=disk.cluster_size + 1)

    before = image_bytes(disk)
    errors = fs.check()

    assert errors
    assert any("/f" in message for message in errors)
    assert image_bytes(disk) == before


def test_check_detects_nonzero_size_without_first_cluster(volume):
    disk, fs, _ = volume
    fs.create("/f")
    patch_entry(fs, "/f", file_size=1)

    before = image_bytes(disk)
    errors = fs.check()

    assert errors
    assert any("/f" in message for message in errors)
    assert image_bytes(disk) == before


def test_check_reports_fat_cycle_without_crashing(volume):
    disk, fs, _ = volume
    fs.create("/f")
    fs.escrever("/f", b"x")
    first = fs.chain("/f")[0]
    raw_fat_write(disk, first, first)

    before = image_bytes(disk)
    errors = fs.check()

    assert errors
    assert any("ciclo" in message.lower() for message in errors)
    assert image_bytes(disk) == before


def test_check_reports_out_of_range_reference_without_crashing(volume):
    disk, fs, _ = volume
    fs.create("/f")
    fs.escrever("/f", b"x")
    first = fs.chain("/f")[0]
    raw_fat_write(disk, first, disk.num_clusters + 10)

    before = image_bytes(disk)
    errors = fs.check()

    assert isinstance(errors, list)
    assert errors
    assert image_bytes(disk) == before


@pytest.mark.timeout(5)
def test_check_detects_directory_graph_cycle(volume):
    disk, fs, _ = volume
    fs.mkdir("/a")
    fs.mkdir("/a/b")

    # A entrada de b passa a referenciar o próprio diretório a.
    a_cluster = metadata(fs, "/a")["first_cluster"]
    patch_entry(fs, "/a/b", first_cluster=a_cluster)

    before = image_bytes(disk)
    errors = fs.check()

    assert isinstance(errors, list)
    assert errors
    assert image_bytes(disk) == before


# ---------------------------------------------------------------------
# Interface de linha de comando
# ---------------------------------------------------------------------

def test_cli_requires_open_disk(tmp_path, sim):
    cli = sim.CLI(str(tmp_path / "cli.img"))

    for command in ["info", "fat", "check", "ls"]:
        with pytest.raises(sim.FATError):
            cli._dispatch(command, [])


@pytest.mark.parametrize("command", ["exit", "quit"])
def test_cli_exit_commands(tmp_path, sim, command):
    cli = sim.CLI(str(tmp_path / "cli.img"))
    with pytest.raises(SystemExit):
        cli._dispatch(command, [])


def test_cli_command_sequence(volume, sim, capsys):
    disk, fs, _ = volume
    cli = sim.CLI(disk.path)
    cli.disk = disk
    cli.fs = fs

    cli._dispatch("create", ["/f"])
    cli._dispatch("write", ["/f", "abc"])
    cli._dispatch("overwrite", ["/f", "1", "Z"])
    cli._dispatch("cat", ["/f"])

    assert "aZc" in capsys.readouterr().out

    cli._dispatch("mkdir", ["/dst"])
    cli._dispatch("mv", ["/f", "/dst"])
    cli._dispatch("rename", ["/dst/f", "g"])

    assert fs.ler("/dst/g") == b"aZc"

    cli._dispatch("rm", ["/dst/g"])
    assert fs.ls("/dst") == []
    audit(disk, fs)


@pytest.mark.parametrize(
    "command, args",
    [
        ("create", []),
        ("mkdir", []),
        ("write", ["/f"]),
        ("overwrite", ["/f", "abc", "x"]),
        ("replace", ["/f"]),
        ("rename", ["/f"]),
        ("move", ["/f"]),
        ("read", []),
        ("delete", []),
        ("chain", []),
    ],
)
def test_cli_invalid_arguments(volume, sim, command, args):
    disk, fs, _ = volume
    cli = sim.CLI(disk.path)
    cli.disk = disk
    cli.fs = fs

    with pytest.raises(sim.FATError):
        cli._dispatch(command, args)


# ---------------------------------------------------------------------
# Testes baseados em propriedades com modelo de referência em memória
# ---------------------------------------------------------------------

ACTION = st.tuples(
    st.sampled_from([
        "create", "append", "replace", "overwrite",
        "delete", "rename", "move",
    ]),
    st.integers(min_value=0, max_value=15),
    st.integers(min_value=0, max_value=15),
    st.binary(min_size=0, max_size=128),
    st.integers(min_value=0, max_value=1000),
)


@pytest.mark.timeout(180)
@settings(max_examples=40, deadline=None)
@given(
    variant=st.sampled_from([16, 32]),
    cs=st.sampled_from([64, 128, 512]),
    actions=st.lists(ACTION, min_size=1, max_size=60),
)
def test_generated_operations_match_memory_model(
    sim, variant, cs, actions
):
    """
    Cada exemplo ganha seu próprio diretório temporário.

    O modelo Python guarda os bytes esperados, independentemente
    dos métodos de leitura e escrita do simulador.
    """
    with tempfile.TemporaryDirectory() as temp:
        path = Path(temp) / "property.img"
        disk = sim.FATDisk(str(path))

        try:
            disk.format(
                variant=variant,
                cluster_size=cs,
                num_clusters=512,
            )
            fs = sim.FileSystem(disk)
            fs.mkdir("/a")
            fs.mkdir("/b")
            model = {}

            def file_path(index):
                parent = "/a" if index < 8 else "/b"
                return f"{parent}/f{index % 8}"

            def reject(call):
                assert_rejected_unchanged(sim, disk, call)

            for kind, source_index, target_index, data, number in actions:
                source = file_path(source_index)
                target = file_path(target_index)

                if kind == "create":
                    if source in model:
                        reject(lambda: fs.create(source))
                    else:
                        fs.create(source)
                        model[source] = b""

                elif kind == "append":
                    if source not in model:
                        reject(lambda: fs.escrever(source, data))
                    else:
                        fs.escrever(source, data)
                        model[source] += data

                elif kind == "replace":
                    if source not in model:
                        reject(lambda: fs.substituir(source, data))
                    else:
                        fs.substituir(source, data)
                        model[source] = data

                elif kind == "overwrite":
                    if source not in model:
                        reject(
                            lambda: fs.sobrescrever(source, 0, data)
                        )
                    else:
                        old = model[source]
                        offset = number % (len(old) + 1)

                        if offset + len(data) > len(old):
                            reject(
                                lambda: fs.sobrescrever(
                                    source, offset, data
                                )
                            )
                        else:
                            fs.sobrescrever(source, offset, data)
                            model[source] = (
                                old[:offset]
                                + data
                                + old[offset + len(data):]
                            )

                elif kind == "delete":
                    if source not in model:
                        reject(lambda: fs.apagar(source))
                    else:
                        fs.apagar(source)
                        del model[source]

                elif kind == "rename":
                    parent = source.rsplit("/", 1)[0]
                    new_name = target.rsplit("/", 1)[1]
                    renamed = parent + "/" + new_name

                    # O código atual trata renomear para o próprio
                    # nome como conflito; esse contrato é preservado.
                    if source not in model or renamed in model:
                        reject(
                            lambda: fs.renomear(source, new_name)
                        )
                    else:
                        fs.renomear(source, new_name)
                        model[renamed] = model.pop(source)

                else:  # move
                    destination = target.rsplit("/", 1)[0]
                    name = source.rsplit("/", 1)[1]
                    moved = destination + "/" + name

                    if source not in model or moved in model:
                        reject(
                            lambda: fs.mover(source, destination)
                        )
                    else:
                        fs.mover(source, destination)
                        model[moved] = model.pop(source)

                observed = audit(disk, fs)
                observed_files = {
                    p: entry["data"]
                    for p, entry in observed.items()
                    if not entry["is_dir"]
                }

                assert observed_files == model

                for parent in ["/a", "/b"]:
                    expected_names = {
                        p.rsplit("/", 1)[1]
                        for p in model
                        if p.rsplit("/", 1)[0] == parent
                    }
                    actual_names = {
                        entry["name"] for entry in fs.ls(parent)
                    }
                    assert actual_names == expected_names

        finally:
            disk.close()