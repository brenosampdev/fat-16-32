"""
api.py — API REST completa para o simulador FAT16/FAT32
Trabalho de Sistemas de Arquivos — Turma 26

Execute com:
    pip install fastapi uvicorn httpx pytest
    uvicorn api:app --reload

Documentação interativa: http://localhost:8000/docs
"""

import base64
import os
import sys
from typing import Any, List, Optional

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

# ── Importar o simulador ─────────────────────────────────────────────────────
sys.path.insert(0, os.path.dirname(__file__))
from fat_simulator import FATDisk, FileSystem, FATError

# ═══════════════════════════════════════════════════════════════════════════════
#  Estado global — disco e sistema de arquivos
# ═══════════════════════════════════════════════════════════════════════════════

# Permite que o conjunto de testes substitua o caminho sem reiniciar o processo.
_state: dict = {
    "path": os.getenv("FAT_DISK_PATH", "fat_disk.img"),
    "disk": None,
    "fs":   None,
}


def reset_state(path: str = "fat_disk.img"):
    """
    Fecha o disco atual e redefine o estado global.
    Usado pelos testes para apontar para um arquivo temporário.
    """
    if _state["disk"] is not None:
        try:
            _state["disk"].close()
        except Exception:
            pass
    _state["path"] = path
    _state["disk"] = None
    _state["fs"]   = None


def _get_fs() -> FileSystem:
    """Lança HTTP 400 se nenhum disco estiver aberto."""
    if _state["fs"] is None:
        raise HTTPException(
            status_code=400,
            detail="Nenhum disco aberto. Use POST /disk/format primeiro.",
        )
    return _state["fs"]


def _get_disk() -> FATDisk:
    if _state["disk"] is None:
        raise HTTPException(
            status_code=400,
            detail="Nenhum disco aberto. Use POST /disk/format primeiro.",
        )
    return _state["disk"]


# ── Mapeamento de FATError → código HTTP ─────────────────────────────────────

def _http_code(msg: str) -> int:
    """Mapeia a mensagem de erro do simulador para um código HTTP adequado."""
    low = msg.lower()
    if any(k in low for k in ("não encontrado", "not found")):
        return 404
    if any(k in low for k in ("já existe",)):
        return 409
    if any(k in low for k in ("não está vazio",)):
        return 409
    return 400


def _fat_err(ex: FATError) -> HTTPException:
    return HTTPException(status_code=_http_code(str(ex)), detail=str(ex))


# ═══════════════════════════════════════════════════════════════════════════════
#  Aplicação FastAPI
# ═══════════════════════════════════════════════════════════════════════════════

app = FastAPI(
    title="FAT16/FAT32 Simulator API",
    description=(
        "API REST para o simulador didático de sistema de arquivos FAT.\n\n"
        "Implementa as 7 operações do trabalho: **ler**, **escrever**, "
        "**sobrescrever**, **apagar**, **substituir**, **renomear** e **mover**.\n\n"
        "O conteúdo de arquivos é transferido em **Base64** para suportar "
        "dados binários sem problemas de encoding."
    ),
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Tentar abrir disco existente ao iniciar ───────────────────────────────────
@app.on_event("startup")
def _startup():
    path = _state["path"]
    if os.path.exists(path):
        try:
            disk = FATDisk(path)
            disk.open()
            _state["disk"] = disk
            _state["fs"]   = FileSystem(disk)
        except FATError:
            pass   # disco corrompido ou formato inválido — ignorar silenciosamente


# ═══════════════════════════════════════════════════════════════════════════════
#  Schemas Pydantic
# ═══════════════════════════════════════════════════════════════════════════════

class FormatRequest(BaseModel):
    variante:     str           = Field("fat16",  description="'fat16' ou 'fat32'")
    cluster_size: int           = Field(512,      description="Bytes por cluster (potência de 2 ≥ 64)")
    num_clusters: Optional[int] = Field(None,     description="Total de clusters de dados")


class MkdirRequest(BaseModel):
    path: str = Field(..., description="Caminho absoluto do novo diretório (ex: /docs/fotos)")


class CreateFileRequest(BaseModel):
    path: str = Field(..., description="Caminho absoluto do arquivo a criar")


class WriteRequest(BaseModel):
    path:            str = Field(..., description="Caminho absoluto do arquivo")
    conteudo_base64: str = Field(..., description="Dados a acrescentar, codificados em Base64")


class OverwriteRequest(BaseModel):
    path:            str = Field(..., description="Caminho absoluto do arquivo")
    offset:          int = Field(..., ge=0, description="Posição em bytes onde a sobrescrita começa")
    conteudo_base64: str = Field(..., description="Novos dados em Base64")


class ReplaceRequest(BaseModel):
    path:            str = Field(..., description="Caminho absoluto do arquivo")
    conteudo_base64: str = Field(..., description="Novo conteúdo completo em Base64")


class RenameRequest(BaseModel):
    path:      str = Field(..., description="Caminho absoluto atual")
    novo_nome: str = Field(..., description="Novo nome (apenas o nome, sem barra)")


class MoveRequest(BaseModel):
    origem:  str = Field(..., description="Caminho absoluto do arquivo/diretório a mover")
    destino: str = Field(..., description="Caminho absoluto do diretório de destino")


# ── Helper interno ────────────────────────────────────────────────────────────

def _decode_b64(b64: str) -> bytes:
    try:
        return base64.b64decode(b64)
    except Exception:
        raise HTTPException(status_code=400, detail="conteudo_base64 inválido: não é Base64 válido.")


def _encode_b64(data: bytes) -> str:
    return base64.b64encode(data).decode()


def _parent_path(path: str) -> str:
    """Retorna o caminho do diretório pai de 'path'."""
    parts = [p for p in path.strip("/").split("/") if p]
    return "/" + "/".join(parts[:-1]) if len(parts) > 1 else "/"


def _entry_to_dict(e: dict) -> dict:
    return {
        "nome":             e["name"],
        "tipo":             "diretorio" if e["is_dir"] else "arquivo",
        "tamanho":          e["file_size"],
        "primeiro_cluster": e["first_cluster"],
        "ctime":            e["ctime"],
        "mtime":            e["mtime"],
    }


# ═══════════════════════════════════════════════════════════════════════════════
#  Endpoints — Disco
# ═══════════════════════════════════════════════════════════════════════════════

@app.post("/disk/format", tags=["Disco"],
          summary="Formata um novo disco virtual")
def format_disk(body: FormatRequest):
    """
    Cria e inicializa um disco virtual. Sobrescreve qualquer disco existente.

    - **variante**: `"fat16"` ou `"fat32"`
    - **cluster_size**: bytes por cluster (potência de 2, ≥ 64)
    - **num_clusters**: total de clusters de dados (padrão: 128 para FAT16, 1024 para FAT32)
    """
    if body.variante.lower() not in ("fat16", "fat32"):
        raise HTTPException(status_code=400, detail="variante deve ser 'fat16' ou 'fat32'.")

    variant_int = 16 if body.variante.lower() == "fat16" else 32

    # Fechar disco anterior se existir
    if _state["disk"] is not None:
        try:
            _state["disk"].close()
        except Exception:
            pass

    path = _state["path"]
    try:
        disk = FATDisk(path)
        disk.format(variant=variant_int,
                    cluster_size=body.cluster_size,
                    num_clusters=body.num_clusters)
        _state["disk"] = disk
        _state["fs"]   = FileSystem(disk)
        return {"ok": True, "data": disk.info()}
    except FATError as ex:
        raise _fat_err(ex)


@app.get("/disk/info", tags=["Disco"],
         summary="Informações do disco aberto")
def disk_info():
    """
    Retorna parâmetros do volume: variante, tamanho do cluster,
    clusters livres/usados, espaço total e livre, offsets da FAT e dos dados.
    """
    disk = _get_disk()
    return {"ok": True, "data": disk.info()}


@app.get("/disk/fat", tags=["Disco"],
         summary="Tabela FAT completa")
def disk_fat():
    """
    Retorna todas as entradas da FAT.
    Cada entrada tem `cluster` (número) e `status`:
    `"livre"`, `"EOF"`, `"defeituoso"` ou `"→ N"` (próximo cluster).

    Útil para visualizar a fragmentação e estado de alocação.
    """
    disk = _get_disk()
    entradas = [{"cluster": c, "status": s} for c, s in disk.fat_dump()]
    return {"ok": True, "data": {"entradas": entradas}}


@app.post("/disk/check", tags=["Disco"],
          summary="Verificar consistência do sistema de arquivos")
def disk_check():
    """
    Percorre toda a árvore de diretórios e a FAT verificando:
    clusters cruzados, ciclos, clusters órfãos e tamanhos inconsistentes.
    """
    fs = _get_fs()
    try:
        erros = fs.check()
        return {"ok": True, "data": {"consistente": len(erros) == 0, "erros": erros}}
    except FATError as ex:
        raise _fat_err(ex)


# ═══════════════════════════════════════════════════════════════════════════════
#  Endpoints — Diretórios
# ═══════════════════════════════════════════════════════════════════════════════

@app.get("/ls", tags=["Diretórios"],
         summary="Listar conteúdo de um diretório")
def ls(path: str = Query("/", description="Caminho absoluto do diretório")):
    """
    Retorna a lista de arquivos e subdiretórios de um caminho.
    """
    fs = _get_fs()
    try:
        entries = fs.ls(path)
        return {
            "ok": True,
            "data": {
                "path":    path,
                "entradas": [_entry_to_dict(e) for e in entries],
            },
        }
    except FATError as ex:
        raise _fat_err(ex)


@app.post("/mkdir", tags=["Diretórios"],
          summary="Criar diretório")
def mkdir(body: MkdirRequest):
    """
    Cria um novo diretório. O diretório pai deve existir.
    """
    fs = _get_fs()
    try:
        fs.mkdir(body.path)
        # Obter o cluster recém-alocado consultando a entrada criada
        name   = body.path.rstrip("/").split("/")[-1]
        parent = _parent_path(body.path)
        entries = fs.ls(parent)
        entry   = next((e for e in entries if e["name"] == name), None)
        return {
            "ok": True,
            "data": {
                "path":             body.path,
                "primeiro_cluster": entry["first_cluster"] if entry else 0,
            },
        }
    except FATError as ex:
        raise _fat_err(ex)


# ═══════════════════════════════════════════════════════════════════════════════
#  Endpoints — Arquivos (CRUD)
# ═══════════════════════════════════════════════════════════════════════════════

@app.post("/file/create", tags=["Arquivos"],
          summary="Criar arquivo vazio")
def create_file(body: CreateFileRequest):
    """
    Cria uma entrada de diretório para o arquivo sem alocar clusters.
    O arquivo começa com tamanho zero.
    """
    fs = _get_fs()
    try:
        fs.create(body.path)
        return {"ok": True, "data": {"path": body.path, "tamanho": 0, "primeiro_cluster": 0}}
    except FATError as ex:
        raise _fat_err(ex)


@app.get("/file/read", tags=["Arquivos"],
         summary="Ler conteúdo de um arquivo")
def read_file(path: str = Query(..., description="Caminho absoluto do arquivo")):
    """
    Percorre a cadeia de clusters via FAT e retorna os bytes do arquivo.

    - **conteudo_base64**: conteúdo em Base64 (use este para operações de escrita)
    - **conteudo_texto**: conteúdo decodificado como UTF-8 (uso em exibição; pode ter caracteres de substituição para dados binários)
    """
    fs = _get_fs()
    try:
        data = fs.ler(path)
        return {
            "ok": True,
            "data": {
                "path":            path,
                "tamanho":         len(data),
                "conteudo_base64": _encode_b64(data),
                "conteudo_texto":  data.decode("utf-8", errors="replace"),
            },
        }
    except FATError as ex:
        raise _fat_err(ex)


@app.post("/file/write", tags=["Arquivos"],
          summary="Acrescentar dados ao arquivo (append)")
def write_file(body: WriteRequest):
    """
    Decodifica o Base64 e acrescenta os bytes ao **final** do arquivo.
    Aloca novos clusters se necessário. Verifica espaço antes de modificar.
    """
    fs   = _get_fs()
    data = _decode_b64(body.conteudo_base64)
    try:
        tamanho_antes = len(fs.ler(body.path))
        fs.escrever(body.path, data)
        tamanho_depois = len(fs.ler(body.path))
        return {
            "ok": True,
            "data": {
                "path":          body.path,
                "bytes_escritos": len(data),
                "tamanho_novo":  tamanho_depois,
            },
        }
    except FATError as ex:
        raise _fat_err(ex)


@app.post("/file/overwrite", tags=["Arquivos"],
          summary="Sobrescrever bytes a partir de um offset")
def overwrite_file(body: OverwriteRequest):
    """
    Substitui bytes no arquivo começando em `offset`.
    **Não** expande o arquivo: `offset + len(dados)` deve ser ≤ tamanho atual.
    Use `/file/replace` para encolher ou expandir.
    """
    fs   = _get_fs()
    data = _decode_b64(body.conteudo_base64)
    try:
        fs.sobrescrever(body.path, body.offset, data)
        return {
            "ok": True,
            "data": {
                "path":          body.path,
                "offset":        body.offset,
                "bytes_escritos": len(data),
            },
        }
    except FATError as ex:
        raise _fat_err(ex)


@app.post("/file/replace", tags=["Arquivos"],
          summary="Substituir todo o conteúdo do arquivo")
def replace_file(body: ReplaceRequest):
    """
    Substitui o conteúdo completo do arquivo.
    Libera clusters excedentes se o novo conteúdo for menor;
    aloca novos clusters se for maior.
    Verifica espaço antes de modificar.
    """
    fs   = _get_fs()
    data = _decode_b64(body.conteudo_base64)
    try:
        fs.substituir(body.path, data)
        return {
            "ok": True,
            "data": {
                "path":       body.path,
                "tamanho_novo": len(data),
            },
        }
    except FATError as ex:
        raise _fat_err(ex)


@app.delete("/file", tags=["Arquivos"],
            summary="Apagar arquivo ou diretório vazio")
def delete_file(path: str = Query(..., description="Caminho absoluto a remover")):
    """
    Marca a entrada de diretório como deletada (0xE5) e libera a cadeia
    de clusters na FAT. Apenas diretórios **vazios** podem ser apagados.
    """
    fs = _get_fs()
    try:
        # Capturar cadeia antes de apagar para informar quantos clusters foram liberados
        try:
            cadeia = fs.chain(path)
        except FATError:
            cadeia = []
        fs.apagar(path)
        return {
            "ok": True,
            "data": {
                "path":               path,
                "clusters_liberados": len(cadeia),
            },
        }
    except FATError as ex:
        raise _fat_err(ex)


# ═══════════════════════════════════════════════════════════════════════════════
#  Endpoints — Metadados
# ═══════════════════════════════════════════════════════════════════════════════

@app.post("/file/rename", tags=["Metadados"],
          summary="Renomear arquivo ou diretório")
def rename_file(body: RenameRequest):
    """
    Atualiza o nome na entrada de diretório.
    Clusters e conteúdo são preservados.
    `novo_nome` deve ser apenas o nome (sem barras).
    """
    fs = _get_fs()
    try:
        fs.renomear(body.path, body.novo_nome)
        parent  = _parent_path(body.path)
        path_novo = f"{parent.rstrip('/')}/{body.novo_nome}"
        return {
            "ok": True,
            "data": {
                "path_antigo": body.path,
                "path_novo":   path_novo,
            },
        }
    except FATError as ex:
        raise _fat_err(ex)


@app.post("/file/move", tags=["Metadados"],
          summary="Mover arquivo ou diretório para outro diretório")
def move_file(body: MoveRequest):
    """
    Move a entrada de diretório da origem para o destino.
    Nenhum cluster de dados é copiado. O destino deve ser um diretório existente.
    """
    fs = _get_fs()
    try:
        nome      = body.origem.rstrip("/").split("/")[-1]
        path_novo = f"{body.destino.rstrip('/')}/{nome}"
        fs.mover(body.origem, body.destino)
        return {
            "ok": True,
            "data": {
                "path_antigo": body.origem,
                "path_novo":   path_novo,
            },
        }
    except FATError as ex:
        raise _fat_err(ex)


# ═══════════════════════════════════════════════════════════════════════════════
#  Endpoints — Utilitários
# ═══════════════════════════════════════════════════════════════════════════════

@app.get("/file/chain", tags=["Utilitários"],
         summary="Cadeia de clusters de um arquivo")
def file_chain(path: str = Query(..., description="Caminho absoluto do arquivo")):
    """
    Retorna a lista ordenada de clusters que formam o arquivo,
    o slack interno e o tamanho total alocado.
    Útil para visualizações didáticas da fragmentação.
    """
    fs   = _get_fs()
    disk = _get_disk()
    try:
        cadeia = fs.chain(path)
        cs     = disk.cluster_size

        # Obter o tamanho registrado na entrada de diretório
        parent  = _parent_path(path)
        name    = path.rstrip("/").split("/")[-1]
        entries = fs.ls(parent)
        entry   = next((e for e in entries if e["name"] == name), None)
        tamanho = entry["file_size"] if entry else 0

        total_cl_bytes = len(cadeia) * cs
        slack          = total_cl_bytes - tamanho if cadeia else 0

        return {
            "ok": True,
            "data": {
                "path":                   path,
                "cadeia":                 cadeia,
                "num_clusters":           len(cadeia),
                "tamanho_total_clusters": total_cl_bytes,
                "tamanho_arquivo":        tamanho,
                "slack_interno":          slack,
            },
        }
    except FATError as ex:
        raise _fat_err(ex)
