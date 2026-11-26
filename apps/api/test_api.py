"""
test_api.py — Testes completos da API do simulador FAT16/FAT32
Trabalho de Sistemas de Arquivos — Turma 26

Execute com:
    pip install pytest httpx fastapi
    pytest test_api.py -v

Os testes rodam em processo (sem servidor real) usando TestClient do FastAPI.
Cada grupo de testes usa um disco temporário isolado para evitar interferência.
"""

import base64
import os
import tempfile

import pytest
from fastapi.testclient import TestClient

import api
from api import app

# ═══════════════════════════════════════════════════════════════════════════════
#  Helpers
# ═══════════════════════════════════════════════════════════════════════════════

def b64(text: str) -> str:
    """Codifica uma string UTF-8 em Base64."""
    return base64.b64encode(text.encode()).decode()


def fromb64(b64str: str) -> str:
    """Decodifica Base64 para string UTF-8."""
    return base64.b64decode(b64str).decode()


# ═══════════════════════════════════════════════════════════════════════════════
#  Fixture principal — disco FAT16 fresco para cada teste
# ═══════════════════════════════════════════════════════════════════════════════

@pytest.fixture
def client(tmp_path):
    """
    Cria um disco FAT16 temporário antes de cada teste e limpa após.
    Usar tmp_path (fixture do pytest) garante isolamento entre testes.
    """
    disk_file = str(tmp_path / "test.img")
    api.reset_state(disk_file)
    c = TestClient(app, raise_server_exceptions=True)
    resp = c.post("/disk/format", json={"variante": "fat16", "cluster_size": 512, "num_clusters": 128})
    assert resp.status_code == 200, f"Falha ao formatar disco: {resp.json()}"
    yield c
    api.reset_state()   # Limpar estado global ao final


@pytest.fixture
def client32(tmp_path):
    """Mesmo que 'client', mas com FAT32."""
    disk_file = str(tmp_path / "test32.img")
    api.reset_state(disk_file)
    c = TestClient(app, raise_server_exceptions=True)
    c.post("/disk/format", json={"variante": "fat32", "cluster_size": 512, "num_clusters": 512})
    yield c
    api.reset_state()


# ═══════════════════════════════════════════════════════════════════════════════
#  1. Testes de disco
# ═══════════════════════════════════════════════════════════════════════════════

class TestDisco:

    def test_format_fat16_retorna_ok(self, client):
        """Formatar disco deve retornar ok=True e os parâmetros do volume."""
        resp = client.post("/disk/format", json={"variante": "fat16"})
        assert resp.status_code == 200
        body = resp.json()
        assert body["ok"] is True
        assert "FAT16" in body["data"]["variante"]

    def test_format_fat32_retorna_ok(self, client):
        resp = client.post("/disk/format", json={"variante": "fat32", "num_clusters": 512})
        assert resp.status_code == 200
        assert "FAT32" in resp.json()["data"]["variante"]

    def test_format_variante_invalida(self, client):
        """Variante desconhecida deve retornar HTTP 400."""
        resp = client.post("/disk/format", json={"variante": "fat99"})
        assert resp.status_code == 400

    def test_info_retorna_campos_esperados(self, client):
        """GET /disk/info deve retornar todos os campos de metadados."""
        resp = client.get("/disk/info")
        assert resp.status_code == 200
        data = resp.json()["data"]
        for campo in ("variante", "cluster_size", "num_clusters",
                      "clusters_livres", "clusters_usados",
                      "espaco_total", "espaco_livre"):
            assert campo in data, f"Campo ausente: {campo}"

    def test_fat_retorna_entradas(self, client):
        """GET /disk/fat deve retornar uma lista de entradas com cluster e status."""
        resp = client.get("/disk/fat")
        assert resp.status_code == 200
        entradas = resp.json()["data"]["entradas"]
        assert isinstance(entradas, list)
        assert len(entradas) > 0
        # Cluster 2 é a raiz — deve estar marcado como EOF
        raiz = next(e for e in entradas if e["cluster"] == 2)
        assert raiz["status"] == "EOF"

    def test_check_disco_vazio_sem_erros(self, client):
        """Disco recém-formatado deve passar na verificação de consistência."""
        resp = client.post("/disk/check")
        assert resp.status_code == 200
        data = resp.json()["data"]
        assert data["consistente"] is True
        assert data["erros"] == []

    def test_sem_disco_aberto_retorna_400(self, tmp_path):
        """Endpoints que dependem do disco devem retornar 400 se nenhum disco existir."""
        api.reset_state(str(tmp_path / "inexistente.img"))
        c = TestClient(app, raise_server_exceptions=False)
        for url in ("/disk/info", "/disk/fat", "/ls"):
            resp = c.get(url)
            assert resp.status_code == 400, f"Esperado 400 para GET {url}"


# ═══════════════════════════════════════════════════════════════════════════════
#  2. Testes de diretórios
# ═══════════════════════════════════════════════════════════════════════════════

class TestDiretorios:

    def test_ls_raiz_vazia(self, client):
        """Diretório raiz recém-formatado deve estar vazio."""
        resp = client.get("/ls?path=/")
        assert resp.status_code == 200
        assert resp.json()["data"]["entradas"] == []

    def test_mkdir_cria_diretorio(self, client):
        """POST /mkdir deve criar o diretório e aparecer no ls."""
        resp = client.post("/mkdir", json={"path": "/docs"})
        assert resp.status_code == 200
        assert resp.json()["ok"] is True

        entries = client.get("/ls?path=/").json()["data"]["entradas"]
        nomes   = [e["nome"] for e in entries]
        assert "docs" in nomes

    def test_mkdir_tipos_corretos(self, client):
        """O tipo da entrada criada por mkdir deve ser 'diretorio'."""
        client.post("/mkdir", json={"path": "/pasta"})
        entry = client.get("/ls?path=/").json()["data"]["entradas"][0]
        assert entry["tipo"] == "diretorio"

    def test_mkdir_aninhado(self, client):
        """Deve ser possível criar subdiretórios em cascata."""
        client.post("/mkdir", json={"path": "/a"})
        resp = client.post("/mkdir", json={"path": "/a/b"})
        assert resp.status_code == 200

        entries = client.get("/ls?path=/a").json()["data"]["entradas"]
        assert any(e["nome"] == "b" for e in entries)

    def test_mkdir_nome_duplicado_409(self, client):
        """Criar diretório com nome já existente deve retornar 409."""
        client.post("/mkdir", json={"path": "/dup"})
        resp = client.post("/mkdir", json={"path": "/dup"})
        assert resp.status_code == 409

    def test_mkdir_pai_inexistente_404(self, client):
        """Criar diretório em pai inexistente deve retornar 404."""
        resp = client.post("/mkdir", json={"path": "/fantasma/sub"})
        assert resp.status_code == 404

    def test_ls_diretorio_inexistente_404(self, client):
        """ls em caminho inexistente deve retornar 404."""
        resp = client.get("/ls?path=/inexistente")
        assert resp.status_code == 404


# ═══════════════════════════════════════════════════════════════════════════════
#  3. Testes de criação e leitura de arquivos
# ═══════════════════════════════════════════════════════════════════════════════

class TestArquivosCriacao:

    def test_create_arquivo_vazio(self, client):
        """POST /file/create deve criar um arquivo com tamanho 0."""
        resp = client.post("/file/create", json={"path": "/vazio.txt"})
        assert resp.status_code == 200
        assert resp.json()["data"]["tamanho"] == 0

    def test_create_aparece_no_ls(self, client):
        client.post("/file/create", json={"path": "/nota.txt"})
        entries = client.get("/ls?path=/").json()["data"]["entradas"]
        assert any(e["nome"] == "nota.txt" and e["tipo"] == "arquivo" for e in entries)

    def test_read_arquivo_vazio(self, client):
        """Ler arquivo vazio deve retornar conteúdo vazio."""
        client.post("/file/create", json={"path": "/vazio.txt"})
        resp = client.get("/file/read?path=/vazio.txt")
        assert resp.status_code == 200
        data = resp.json()["data"]
        assert data["tamanho"] == 0
        assert data["conteudo_texto"] == ""

    def test_create_nome_duplicado_409(self, client):
        client.post("/file/create", json={"path": "/arq.txt"})
        resp = client.post("/file/create", json={"path": "/arq.txt"})
        assert resp.status_code == 409

    def test_create_pai_inexistente_404(self, client):
        resp = client.post("/file/create", json={"path": "/fantasma/arq.txt"})
        assert resp.status_code == 404


# ═══════════════════════════════════════════════════════════════════════════════
#  4. Operação 1 — ler (via GET /file/read)
# ═══════════════════════════════════════════════════════════════════════════════

class TestOperacaoLer:

    def test_ler_conteudo_simples(self, client):
        """Ler deve retornar exatamente o conteúdo escrito."""
        client.post("/file/create", json={"path": "/msg.txt"})
        client.post("/file/write", json={"path": "/msg.txt", "conteudo_base64": b64("Olá, Mundo!")})

        resp = client.get("/file/read?path=/msg.txt")
        assert resp.status_code == 200
        assert fromb64(resp.json()["data"]["conteudo_base64"]) == "Olá, Mundo!"

    def test_ler_multiplos_clusters(self, client):
        """
        Arquivo com mais de 512 bytes (> 1 cluster) deve ser lido corretamente
        seguindo a cadeia FAT.
        """
        conteudo = "X" * 1300   # ocupa 3 clusters de 512 bytes
        client.post("/file/create", json={"path": "/grande.txt"})
        client.post("/file/write",  json={"path": "/grande.txt", "conteudo_base64": b64(conteudo)})

        resp = client.get("/file/read?path=/grande.txt")
        assert resp.json()["data"]["tamanho"] == 1300
        assert fromb64(resp.json()["data"]["conteudo_base64"]) == conteudo

    def test_ler_arquivo_inexistente_404(self, client):
        resp = client.get("/file/read?path=/nao_existe.txt")
        assert resp.status_code == 404

    def test_ler_diretorio_retorna_400(self, client):
        client.post("/mkdir", json={"path": "/pasta"})
        resp = client.get("/file/read?path=/pasta")
        assert resp.status_code == 400

    def test_ler_preserva_bytes_exatos(self, client):
        """Leitura deve retornar exatamente file_size bytes, sem bytes de padding do cluster."""
        # 513 bytes: 1 cluster completo + 1 byte no segundo cluster
        conteudo = "A" * 513
        client.post("/file/create", json={"path": "/exato.txt"})
        client.post("/file/write",  json={"path": "/exato.txt", "conteudo_base64": b64(conteudo)})

        resp = client.get("/file/read?path=/exato.txt")
        lido = fromb64(resp.json()["data"]["conteudo_base64"])
        assert len(lido) == 513
        assert lido == conteudo


# ═══════════════════════════════════════════════════════════════════════════════
#  5. Operação 2 — escrever / append (POST /file/write)
# ═══════════════════════════════════════════════════════════════════════════════

class TestOperacaoEscrever:

    def test_escrever_acrescenta_ao_final(self, client):
        """Duas escritas devem resultar na concatenação dos conteúdos."""
        client.post("/file/create", json={"path": "/log.txt"})
        client.post("/file/write",  json={"path": "/log.txt", "conteudo_base64": b64("Linha 1\n")})
        client.post("/file/write",  json={"path": "/log.txt", "conteudo_base64": b64("Linha 2\n")})

        conteudo = fromb64(client.get("/file/read?path=/log.txt").json()["data"]["conteudo_base64"])
        assert conteudo == "Linha 1\nLinha 2\n"

    def test_escrever_atualiza_tamanho(self, client):
        client.post("/file/create", json={"path": "/f.txt"})
        resp = client.post("/file/write", json={"path": "/f.txt", "conteudo_base64": b64("hello")})
        assert resp.json()["data"]["tamanho_novo"] == 5

    def test_escrever_arquivo_inexistente_404(self, client):
        resp = client.post("/file/write", json={"path": "/nao_existe.txt", "conteudo_base64": b64("x")})
        assert resp.status_code == 404

    def test_escrever_base64_invalido_400(self, client):
        client.post("/file/create", json={"path": "/f.txt"})
        resp = client.post("/file/write", json={"path": "/f.txt", "conteudo_base64": "!!!não_é_base64!!!"})
        assert resp.status_code == 400

    def test_escrever_expande_cadeia_fat(self, client):
        """Escrever conteúdo maior que 1 cluster deve criar cadeia com múltiplos clusters."""
        client.post("/file/create", json={"path": "/big.txt"})
        conteudo = "Z" * 1025
        client.post("/file/write", json={"path": "/big.txt", "conteudo_base64": b64(conteudo)})

        chain = client.get("/file/chain?path=/big.txt").json()["data"]
        assert chain["num_clusters"] >= 3   # 1025 bytes / 512 = 3 clusters


# ═══════════════════════════════════════════════════════════════════════════════
#  6. Operação 3 — sobrescrever (POST /file/overwrite)
# ═══════════════════════════════════════════════════════════════════════════════

class TestOperacaoSobrescrever:

    def _cria_arquivo(self, client, path: str, conteudo: str):
        client.post("/file/create", json={"path": path})
        client.post("/file/write",  json={"path": path, "conteudo_base64": b64(conteudo)})

    def test_sobrescrever_no_meio(self, client):
        # "Hello World!" = 12 chars; sobrescrever offset=6 com "FAT!!" (5 chars)
        # substitui "World" (posições 6-10), mas o "!" na posição 11 permanece.
        # sobrescrever é in-place: NÃO trunca o arquivo.
        self._cria_arquivo(client, "/txt.txt", "Hello World!")
        resp = client.post("/file/overwrite", json={
            "path": "/txt.txt", "offset": 6, "conteudo_base64": b64("FAT!!")
        })
        assert resp.status_code == 200
        lido = fromb64(client.get("/file/read?path=/txt.txt").json()["data"]["conteudo_base64"])
        # Resultado: "Hello FAT!!!" (12 chars — "!" original na posição 11 é preservado)
        assert lido == "Hello FAT!!!"

    def test_sobrescrever_no_inicio(self, client):
        self._cria_arquivo(client, "/f.txt", "AAABBB")
        client.post("/file/overwrite", json={"path": "/f.txt", "offset": 0, "conteudo_base64": b64("XXX")})
        lido = fromb64(client.get("/file/read?path=/f.txt").json()["data"]["conteudo_base64"])
        assert lido == "XXXBBB"

    def test_sobrescrever_no_fim(self, client):
        self._cria_arquivo(client, "/f.txt", "AAABBB")
        client.post("/file/overwrite", json={"path": "/f.txt", "offset": 3, "conteudo_base64": b64("ZZZ")})
        lido = fromb64(client.get("/file/read?path=/f.txt").json()["data"]["conteudo_base64"])
        assert lido == "AAAZZZ"

    def test_sobrescrever_alem_do_fim_400(self, client):
        """Offset que ultrapassa o tamanho do arquivo deve retornar 400."""
        self._cria_arquivo(client, "/f.txt", "abc")
        resp = client.post("/file/overwrite", json={"path": "/f.txt", "offset": 2, "conteudo_base64": b64("XX")})
        assert resp.status_code == 400

    def test_sobrescrever_cruzando_clusters(self, client):
        """Sobrescrita que cruza a fronteira entre dois clusters deve funcionar."""
        conteudo = "A" * 600   # ocupa 2 clusters (512 + 88 bytes)
        self._cria_arquivo(client, "/big.txt", conteudo)
        # Sobrescrever bytes 505-514 (cruza o limite do primeiro cluster em 512)
        client.post("/file/overwrite", json={"path": "/big.txt", "offset": 505, "conteudo_base64": b64("B" * 10)})
        lido = fromb64(client.get("/file/read?path=/big.txt").json()["data"]["conteudo_base64"])
        assert lido[505:515] == "B" * 10
        assert len(lido) == 600

    def test_sobrescrever_arquivo_inexistente_404(self, client):
        resp = client.post("/file/overwrite", json={"path": "/x.txt", "offset": 0, "conteudo_base64": b64("a")})
        assert resp.status_code == 404


# ═══════════════════════════════════════════════════════════════════════════════
#  7. Operação 4 — apagar (DELETE /file)
# ═══════════════════════════════════════════════════════════════════════════════

class TestOperacaoApagar:

    def test_apagar_arquivo(self, client):
        client.post("/file/create", json={"path": "/f.txt"})
        resp = client.delete("/file?path=/f.txt")
        assert resp.status_code == 200

        # Não deve aparecer mais no ls
        entries = client.get("/ls?path=/").json()["data"]["entradas"]
        assert not any(e["nome"] == "f.txt" for e in entries)

    def test_apagar_libera_clusters(self, client):
        """Clusters liberados pela exclusão devem ser reutilizáveis."""
        client.post("/file/create", json={"path": "/a.txt"})
        client.post("/file/write",  json={"path": "/a.txt", "conteudo_base64": b64("X" * 1024)})

        livres_antes = client.get("/disk/info").json()["data"]["clusters_livres"]
        client.delete("/file?path=/a.txt")
        livres_depois = client.get("/disk/info").json()["data"]["clusters_livres"]

        assert livres_depois > livres_antes

    def test_apagar_arquivo_inexistente_404(self, client):
        resp = client.delete("/file?path=/nao_existe.txt")
        assert resp.status_code == 404

    def test_apagar_diretorio_vazio(self, client):
        client.post("/mkdir", json={"path": "/vazia"})
        resp = client.delete("/file?path=/vazia")
        assert resp.status_code == 200

    def test_apagar_diretorio_nao_vazio_409(self, client):
        client.post("/mkdir",       json={"path": "/cheia"})
        client.post("/file/create", json={"path": "/cheia/arq.txt"})
        resp = client.delete("/file?path=/cheia")
        assert resp.status_code == 409

    def test_apagar_e_recriar(self, client):
        """Após apagar, deve ser possível criar um arquivo com o mesmo nome."""
        client.post("/file/create", json={"path": "/f.txt"})
        client.delete("/file?path=/f.txt")
        resp = client.post("/file/create", json={"path": "/f.txt"})
        assert resp.status_code == 200

    def test_apagar_cluster_marcado_livre_na_fat(self, client):
        """Após apagar, clusters do arquivo devem aparecer como 'livre' na FAT."""
        client.post("/file/create", json={"path": "/f.txt"})
        client.post("/file/write",  json={"path": "/f.txt", "conteudo_base64": b64("hello")})

        cadeia = client.get("/file/chain?path=/f.txt").json()["data"]["cadeia"]
        client.delete("/file?path=/f.txt")

        fat = {e["cluster"]: e["status"] for e in client.get("/disk/fat").json()["data"]["entradas"]}
        for cl in cadeia:
            assert fat[cl] == "livre", f"Cluster {cl} deveria ser livre após exclusão"


# ═══════════════════════════════════════════════════════════════════════════════
#  8. Operação 5 — substituir (POST /file/replace)
# ═══════════════════════════════════════════════════════════════════════════════

class TestOperacaoSubstituir:

    def test_substituir_por_conteudo_menor(self, client):
        """Substituir por conteúdo menor deve liberar clusters excedentes."""
        client.post("/file/create", json={"path": "/f.txt"})
        client.post("/file/write",  json={"path": "/f.txt", "conteudo_base64": b64("A" * 1024)})

        livres_antes = client.get("/disk/info").json()["data"]["clusters_livres"]
        client.post("/file/replace", json={"path": "/f.txt", "conteudo_base64": b64("curto")})
        livres_depois = client.get("/disk/info").json()["data"]["clusters_livres"]

        assert livres_depois >= livres_antes   # deve ter liberado clusters
        lido = fromb64(client.get("/file/read?path=/f.txt").json()["data"]["conteudo_base64"])
        assert lido == "curto"

    def test_substituir_por_conteudo_maior(self, client):
        client.post("/file/create", json={"path": "/f.txt"})
        client.post("/file/write",  json={"path": "/f.txt", "conteudo_base64": b64("curto")})

        novo = "X" * 2000
        resp = client.post("/file/replace", json={"path": "/f.txt", "conteudo_base64": b64(novo)})
        assert resp.status_code == 200
        lido = fromb64(client.get("/file/read?path=/f.txt").json()["data"]["conteudo_base64"])
        assert lido == novo

    def test_substituir_por_vazio(self, client):
        client.post("/file/create", json={"path": "/f.txt"})
        client.post("/file/write",  json={"path": "/f.txt", "conteudo_base64": b64("dados")})
        client.post("/file/replace", json={"path": "/f.txt", "conteudo_base64": ""})

        resp = client.get("/file/read?path=/f.txt")
        assert resp.json()["data"]["tamanho"] == 0

    def test_substituir_arquivo_inexistente_404(self, client):
        resp = client.post("/file/replace", json={"path": "/x.txt", "conteudo_base64": b64("a")})
        assert resp.status_code == 404


# ═══════════════════════════════════════════════════════════════════════════════
#  9. Operação 6 — renomear (POST /file/rename)
# ═══════════════════════════════════════════════════════════════════════════════

class TestOperacaoRenomear:

    def test_renomear_arquivo(self, client):
        client.post("/file/create", json={"path": "/antigo.txt"})
        client.post("/file/write",  json={"path": "/antigo.txt", "conteudo_base64": b64("conteudo")})

        resp = client.post("/file/rename", json={"path": "/antigo.txt", "novo_nome": "novo.txt"})
        assert resp.status_code == 200
        assert resp.json()["data"]["path_novo"] == "/novo.txt"

    def test_renomear_preserva_conteudo(self, client):
        """Renomear não deve alterar o conteúdo do arquivo."""
        client.post("/file/create", json={"path": "/a.txt"})
        client.post("/file/write",  json={"path": "/a.txt", "conteudo_base64": b64("texto salvo")})
        client.post("/file/rename", json={"path": "/a.txt", "novo_nome": "b.txt"})

        lido = fromb64(client.get("/file/read?path=/b.txt").json()["data"]["conteudo_base64"])
        assert lido == "texto salvo"

    def test_renomear_antigo_nao_existe_mais(self, client):
        client.post("/file/create", json={"path": "/old.txt"})
        client.post("/file/rename", json={"path": "/old.txt", "novo_nome": "new.txt"})
        resp = client.get("/file/read?path=/old.txt")
        assert resp.status_code == 404

    def test_renomear_diretorio(self, client):
        client.post("/mkdir",       json={"path": "/pasta_velha"})
        client.post("/file/create", json={"path": "/pasta_velha/arq.txt"})
        client.post("/file/write",  json={"path": "/pasta_velha/arq.txt", "conteudo_base64": b64("ok")})

        resp = client.post("/file/rename", json={"path": "/pasta_velha", "novo_nome": "pasta_nova"})
        assert resp.status_code == 200

        # Conteúdo deve estar acessível pelo novo nome
        lido = fromb64(client.get("/file/read?path=/pasta_nova/arq.txt").json()["data"]["conteudo_base64"])
        assert lido == "ok"

    def test_renomear_nome_duplicado_409(self, client):
        client.post("/file/create", json={"path": "/a.txt"})
        client.post("/file/create", json={"path": "/b.txt"})
        resp = client.post("/file/rename", json={"path": "/a.txt", "novo_nome": "b.txt"})
        assert resp.status_code == 409

    def test_renomear_arquivo_inexistente_404(self, client):
        resp = client.post("/file/rename", json={"path": "/x.txt", "novo_nome": "y.txt"})
        assert resp.status_code == 404

    def test_renomear_preserva_cadeia_fat(self, client):
        """Após renomear, a cadeia FAT deve ser a mesma de antes."""
        client.post("/file/create", json={"path": "/a.txt"})
        client.post("/file/write",  json={"path": "/a.txt", "conteudo_base64": b64("X" * 600)})

        cadeia_antes = client.get("/file/chain?path=/a.txt").json()["data"]["cadeia"]
        client.post("/file/rename", json={"path": "/a.txt", "novo_nome": "b.txt"})
        cadeia_depois = client.get("/file/chain?path=/b.txt").json()["data"]["cadeia"]

        assert cadeia_antes == cadeia_depois


# ═══════════════════════════════════════════════════════════════════════════════
#  10. Operação 7 — mover (POST /file/move)
# ═══════════════════════════════════════════════════════════════════════════════

class TestOperacaoMover:

    def test_mover_arquivo_para_subdiretorio(self, client):
        client.post("/file/create", json={"path": "/f.txt"})
        client.post("/file/write",  json={"path": "/f.txt", "conteudo_base64": b64("dados")})
        client.post("/mkdir",       json={"path": "/backup"})

        resp = client.post("/file/move", json={"origem": "/f.txt", "destino": "/backup"})
        assert resp.status_code == 200
        assert resp.json()["data"]["path_novo"] == "/backup/f.txt"

    def test_mover_preserva_conteudo(self, client):
        client.post("/file/create", json={"path": "/original.txt"})
        client.post("/file/write",  json={"path": "/original.txt", "conteudo_base64": b64("conteudo")})
        client.post("/mkdir",       json={"path": "/dst"})
        client.post("/file/move",   json={"origem": "/original.txt", "destino": "/dst"})

        lido = fromb64(client.get("/file/read?path=/dst/original.txt").json()["data"]["conteudo_base64"])
        assert lido == "conteudo"

    def test_mover_remove_da_origem(self, client):
        client.post("/file/create", json={"path": "/f.txt"})
        client.post("/mkdir",       json={"path": "/d"})
        client.post("/file/move",   json={"origem": "/f.txt", "destino": "/d"})

        resp = client.get("/file/read?path=/f.txt")
        assert resp.status_code == 404

    def test_mover_nao_copia_clusters(self, client):
        """Clusters devem ser os mesmos antes e depois do mover."""
        client.post("/file/create", json={"path": "/f.txt"})
        client.post("/file/write",  json={"path": "/f.txt", "conteudo_base64": b64("X" * 600)})
        client.post("/mkdir",       json={"path": "/d"})

        cadeia_antes = client.get("/file/chain?path=/f.txt").json()["data"]["cadeia"]
        client.post("/file/move", json={"origem": "/f.txt", "destino": "/d"})
        cadeia_depois = client.get("/file/chain?path=/d/f.txt").json()["data"]["cadeia"]

        assert cadeia_antes == cadeia_depois

    def test_mover_diretorio(self, client):
        client.post("/mkdir",       json={"path": "/sub"})
        client.post("/file/create", json={"path": "/sub/arq.txt"})
        client.post("/file/write",  json={"path": "/sub/arq.txt", "conteudo_base64": b64("ok")})
        client.post("/mkdir",       json={"path": "/dst"})

        resp = client.post("/file/move", json={"origem": "/sub", "destino": "/dst"})
        assert resp.status_code == 200

        lido = fromb64(client.get("/file/read?path=/dst/sub/arq.txt").json()["data"]["conteudo_base64"])
        assert lido == "ok"

    def test_mover_destino_inexistente_404(self, client):
        client.post("/file/create", json={"path": "/f.txt"})
        resp = client.post("/file/move", json={"origem": "/f.txt", "destino": "/fantasma"})
        assert resp.status_code == 404

    def test_mover_conflito_nome_409(self, client):
        client.post("/file/create", json={"path": "/f.txt"})
        client.post("/mkdir",       json={"path": "/d"})
        client.post("/file/create", json={"path": "/d/f.txt"})
        resp = client.post("/file/move", json={"origem": "/f.txt", "destino": "/d"})
        assert resp.status_code == 409

    def test_mover_diretorio_para_dentro_de_si_mesmo_400(self, client):
        client.post("/mkdir", json={"path": "/pai"})
        client.post("/mkdir", json={"path": "/pai/filho"})
        resp = client.post("/file/move", json={"origem": "/pai", "destino": "/pai/filho"})
        assert resp.status_code == 400


# ═══════════════════════════════════════════════════════════════════════════════
#  11. Testes da cadeia FAT (/file/chain)
# ═══════════════════════════════════════════════════════════════════════════════

class TestChain:

    def test_chain_arquivo_vazio_sem_clusters(self, client):
        client.post("/file/create", json={"path": "/vazio.txt"})
        resp = client.get("/file/chain?path=/vazio.txt")
        assert resp.status_code == 200
        data = resp.json()["data"]
        assert data["cadeia"] == []
        assert data["num_clusters"] == 0

    def test_chain_um_cluster(self, client):
        client.post("/file/create", json={"path": "/f.txt"})
        client.post("/file/write",  json={"path": "/f.txt", "conteudo_base64": b64("hello")})
        data = client.get("/file/chain?path=/f.txt").json()["data"]
        assert data["num_clusters"] == 1
        assert len(data["cadeia"]) == 1

    def test_chain_multiplos_clusters(self, client):
        client.post("/file/create", json={"path": "/big.txt"})
        client.post("/file/write",  json={"path": "/big.txt", "conteudo_base64": b64("X" * 1300)})
        data = client.get("/file/chain?path=/big.txt").json()["data"]
        assert data["num_clusters"] == 3

    def test_chain_slack_interno(self, client):
        """O slack interno deve ser a diferença entre o espaço alocado e o tamanho real."""
        client.post("/file/create", json={"path": "/f.txt"})
        client.post("/file/write",  json={"path": "/f.txt", "conteudo_base64": b64("A" * 100)})
        data = client.get("/file/chain?path=/f.txt").json()["data"]
        # 1 cluster = 512 bytes; arquivo = 100 bytes; slack = 412 bytes
        assert data["slack_interno"] == 412


# ═══════════════════════════════════════════════════════════════════════════════
#  12. Testes de consistência após sequência de operações
# ═══════════════════════════════════════════════════════════════════════════════

class TestConsistencia:

    def test_check_apos_operacoes_complexas(self, client):
        """
        Sequência completa de operações deve deixar o disco consistente.
        Recria o cenário clássico de fragmentação: criar 3 arquivos, apagar o do
        meio e expandir o terceiro para reutilizar o espaço liberado.
        """
        # Criar 3 arquivos
        for nome in ("a.txt", "b.txt", "c.txt"):
            client.post("/file/create", json={"path": f"/{nome}"})
            client.post("/file/write",  json={"path": f"/{nome}", "conteudo_base64": b64("X" * 512)})

        # Apagar o do meio
        client.delete("/file?path=/b.txt")

        # Expandir o terceiro para reutilizar o espaço
        client.post("/file/write", json={"path": "/c.txt", "conteudo_base64": b64("Y" * 600)})

        # Verificar consistência
        resp = client.post("/disk/check")
        assert resp.json()["data"]["consistente"] is True

    def test_check_fat16(self, client):
        client.post("/file/create", json={"path": "/f.txt"})
        client.post("/file/write",  json={"path": "/f.txt", "conteudo_base64": b64("dados")})
        client.post("/file/rename", json={"path": "/f.txt", "novo_nome": "renomeado.txt"})
        assert client.post("/disk/check").json()["data"]["consistente"] is True

    def test_check_fat32(self, client32):
        client32.post("/file/create", json={"path": "/f.txt"})
        client32.post("/file/write",  json={"path": "/f.txt", "conteudo_base64": b64("dados fat32")})
        assert client32.post("/disk/check").json()["data"]["consistente"] is True

    def test_sequencia_completa_sete_operacoes(self, client):
        """
        Testa as 7 operações do trabalho em sequência, verificando o resultado
        de cada uma.
        """
        # 1. Criar
        client.post("/mkdir",       json={"path": "/docs"})
        client.post("/file/create", json={"path": "/docs/relatorio.txt"})

        # 2. Escrever
        client.post("/file/write", json={"path": "/docs/relatorio.txt",
                                         "conteudo_base64": b64("Versao inicial")})
        assert fromb64(client.get("/file/read?path=/docs/relatorio.txt").json()["data"]["conteudo_base64"]) \
               == "Versao inicial"

        # 3. Sobrescrever (in-place, mesmo tamanho: "Versao inicial" tem 14 chars)
        client.post("/file/overwrite", json={"path": "/docs/relatorio.txt",
                                              "offset": 0,
                                              "conteudo_base64": b64("Versao v2     ")})
        assert fromb64(client.get("/file/read?path=/docs/relatorio.txt").json()["data"]["conteudo_base64"]) \
               == "Versao v2     "

        # 4. Substituir
        client.post("/file/replace", json={"path": "/docs/relatorio.txt",
                                            "conteudo_base64": b64("Conteudo Final!")})
        assert fromb64(client.get("/file/read?path=/docs/relatorio.txt").json()["data"]["conteudo_base64"]) \
               == "Conteudo Final!"

        # 5. Renomear
        client.post("/file/rename", json={"path": "/docs/relatorio.txt", "novo_nome": "relatorio_v3.txt"})
        assert client.get("/file/read?path=/docs/relatorio.txt").status_code == 404
        assert fromb64(client.get("/file/read?path=/docs/relatorio_v3.txt").json()["data"]["conteudo_base64"]) \
               == "Conteudo Final!"

        # 6. Mover
        client.post("/mkdir",     json={"path": "/arquivo"})
        client.post("/file/move", json={"origem": "/docs/relatorio_v3.txt", "destino": "/arquivo"})
        assert fromb64(client.get("/file/read?path=/arquivo/relatorio_v3.txt").json()["data"]["conteudo_base64"]) \
               == "Conteudo Final!"

        # 7. Apagar
        client.delete("/file?path=/arquivo/relatorio_v3.txt")
        assert client.get("/file/read?path=/arquivo/relatorio_v3.txt").status_code == 404

        # Verificar consistência no final
        assert client.post("/disk/check").json()["data"]["consistente"] is True
