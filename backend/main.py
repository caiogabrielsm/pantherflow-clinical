from dotenv import load_dotenv
load_dotenv()  # Carrega backend/.env antes de qualquer import que use os.getenv()

from fastapi.responses import FileResponse
import hashlib
import json
import sys
from typing import Optional
from fastapi import FastAPI, UploadFile, File, Form, HTTPException, BackgroundTasks, Depends
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
import psutil
import os
import shutil
import uvicorn
import logging
import uuid
import re
import subprocess
import time
import math
import functools
from pathlib import Path

# --- IMPORTANDO NOSSOS MÓDULOS REFATORADOS ---
from database import engine, get_db
import models
from pipeline import processar_paciente_wsl, WSL_PROCESSAMENTO, WSL_BASE, AUDITORIA_DIR

# --- CONFIGURAÇÃO DE LOGS ---
# Em modo empacotado, o cwd é C:\Program Files\ (somente-leitura) — usa %APPDATA%.
def _log_path() -> str:
    if getattr(sys, 'frozen', False):
        log_dir = os.path.join(os.environ.get('APPDATA', os.path.expanduser('~')), 'pantherflow-clinical')
        os.makedirs(log_dir, exist_ok=True)
        return os.path.join(log_dir, 'pantherflow.log')
    return 'pantherflow.log'

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s',
                    handlers=[logging.FileHandler(_log_path(), encoding="utf-8"),
                              logging.StreamHandler(stream=open(sys.stdout.fileno(), mode="w", encoding="utf-8", closefd=False))])
logger = logging.getLogger(__name__)

# Cria as tabelas no banco de dados (se não existirem)
models.Base.metadata.create_all(bind=engine)

# Migração defensiva — adiciona colunas novas em instâncias existentes do banco sem Alembic.
# ALTER TABLE ignora o erro "duplicate column" via try/except para ser idempotente.
def _migrar_colunas():
    with engine.connect() as conn:
        for col_def in [
            "ALTER TABLE analyses ADD COLUMN lofreq_details TEXT",
        ]:
            try:
                conn.execute(__import__("sqlalchemy").text(col_def))
                conn.commit()
            except Exception:
                pass  # coluna já existe

_migrar_colunas()

app = FastAPI(title="PantherFlow Clinical Engine")

# --- SEGURANÇA: CORS ---
ORIGENS_PERMITIDAS = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:3000",
    "http://127.0.0.1:3000"
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ORIGENS_PERMITIDAS, 
    allow_credentials=True,
    allow_methods=["GET", "POST", "DELETE"],
    allow_headers=["*"],
)

# --- ROTAS DA API ---

@app.get("/api/health")
def get_system_health():
    """Rota de telemetria detalhada (Hardware)"""
    try:
        cpu_percent = psutil.cpu_percent(interval=None)
        ram = psutil.virtual_memory()
        root_drive = os.path.abspath(os.sep)
        disk = psutil.disk_usage(root_drive)
        
        try:
            freq_val = f"{psutil.cpu_freq().current / 1000:.1f} GHz"
        except Exception:
            freq_val = "N/A GHz"

        return {
            "cpu": {"percent": cpu_percent, "freq": freq_val, "threads": f"{psutil.cpu_count()} Threads"},
            "ram": {"percent": ram.percent, "label": f"{ram.used / (1024**3):.1f} / {ram.total / (1024**3):.1f} GB"},
            "disk": {"percent": disk.percent, "label": f"{disk.free / (1024**3):.1f} GB Livres", "total": f"{disk.total / (1024**3):.1f} GB"}
        }
    except Exception as e:
        logger.error(f"Erro na coleta de telemetria: {e}")
        raise HTTPException(status_code=500, detail="Falha na leitura do hardware")

@app.get("/api/health/docker")
def check_docker_health():
    """Verifica se o motor do Docker/WSL2 está respondendo"""
    try:
        result = subprocess.run(
            "docker info",
            capture_output=True,
            text=True,
            timeout=15,
            shell=True  # shell=True usa cmd.exe que resolve o PATH completo do sistema
        )
        # Docker Desktop às vezes retorna exit code != 0 mesmo funcionando.
        # Considera online se o stdout contém informação do servidor.
        if "Server Version" in result.stdout or result.returncode == 0:
            return {"status": "online", "message": "Docker engine ativo."}
        return {"status": "offline", "message": "Docker indisponível."}
    except (FileNotFoundError, subprocess.TimeoutExpired, OSError):
        return {"status": "offline", "message": "Docker indisponível."}


# --- INGESTÃO POR CAMINHO (path-mode) ---

def _caminho_para_windows(caminho: str) -> Path:
    """Converte caminho Linux WSL2 (/home/...) ou Windows (C:\\...) para Path acessível pelo Python no host."""
    if caminho.startswith("/"):
        unc = r"\\wsl.localhost\Ubuntu" + caminho.replace("/", "\\")
        return Path(unc)
    return Path(caminho)


def _vincular_ou_copiar_fastq(src: str, dest: Path) -> None:
    """Vincula (hardlink via wsl ln) ou copia um FASTQ para dest.

    Caminhos WSL2 (/home/...): tenta hardlink instantâneo (zero I/O).
    Se o hardlink falhar (cross-device) ou src for Windows (C:\\...): copia via shutil.
    Symlinks NÃO são usados — seriam quebrados dentro do container Docker.
    """
    dest_linux = f"{WSL_BASE}/processamento/{dest.name}"
    _tcc_t0 = time.perf_counter()

    if src.startswith("/"):
        r = subprocess.run(
            ["wsl", "-d", "Ubuntu", "-u", "root", "ln", src, dest_linux],
            capture_output=True, text=True, timeout=30
        )
        if r.returncode == 0:
            _tcc_elapsed = time.perf_counter() - _tcc_t0
            logger.info("[path-mode] Hardlink: %s → %s", src, dest_linux)
            logger.info("[MÉTRICA TCC] I/O Ingestão FASTQ (hardlink): %.4f s — %s", _tcc_elapsed, dest.name)
            return
        logger.warning("[path-mode] Hardlink falhou (%s) — copiando via UNC...", r.stderr.strip())
        src_path = _caminho_para_windows(src)
    else:
        src_path = Path(src)

    logger.info("[path-mode] Copiando %s → %s (pode demorar para arquivos grandes)...", src_path.name, dest.name)
    shutil.copy2(src_path, dest)
    _tcc_elapsed = time.perf_counter() - _tcc_t0
    _tamanho_mb = dest.stat().st_size / (1024 * 1024) if dest.exists() else 0
    logger.info("[MÉTRICA TCC] I/O Ingestão FASTQ (cópia): %.2f s — %.0f MB — %.1f MB/s — %s",
                _tcc_elapsed, _tamanho_mb,
                _tamanho_mb / _tcc_elapsed if _tcc_elapsed > 0 else 0,
                dest.name)


def _preparar_e_processar(
    id_anonimo: str,
    r1_src: str, r2_src: Optional[str],
    nome_r1: str, nome_r2: Optional[str],
    vaf: float, min_dp: int,
    ref_genome: Optional[str], target_bed: Optional[str], pon_file: Optional[str],
) -> None:
    """Background task do path-mode: vincula/copia FASTQs e então executa a pipeline."""
    logger.info("[%s] [path-mode] Preparando FASTQs...", id_anonimo)
    try:
        _vincular_ou_copiar_fastq(r1_src, WSL_PROCESSAMENTO / nome_r1)
        if r2_src and nome_r2:
            _vincular_ou_copiar_fastq(r2_src, WSL_PROCESSAMENTO / nome_r2)
    except Exception as e:
        logger.error("[%s] [path-mode] Falha ao preparar FASTQs: %s", id_anonimo, e)
        return
    processar_paciente_wsl(id_anonimo, nome_r1, nome_r2, vaf, min_dp, ref_genome, target_bed, pon_file)


@app.post("/api/upload")
async def start_analysis(
    background_tasks: BackgroundTasks,
    patientId: str = Form(...),
    doctor: str = Form(...),
    protocol: str = Form(...),
    sex: str = Form(...),
    config: str = Form(default='{"vaf": 0.05, "minDp": 100}'),
    ref_genome: Optional[str] = Form(None),
    target_bed: Optional[str] = Form(None),
    pon_file:   Optional[str] = Form(None),
    files: Optional[list[UploadFile]] = File(default=None),
    bam_file: Optional[UploadFile] = File(default=None),
    fastq_r1_path: Optional[str] = Form(default=None),
    fastq_r2_path: Optional[str] = Form(default=None),
    db: Session = Depends(get_db)
):
    """Registra análise e inicia pipeline.

    Modos de ingestão (mutuamente exclusivos):
      upload — arquivos .fastq.gz enviados via browser (files=[R1, R2])
      bam    — arquivo .bam pré-alinhado enviado via browser (bam_file)
      path   — caminhos absolutos já no filesystem (fastq_r1_path / fastq_r2_path).
    """
    modo_upload = bool(files)
    modo_bam    = bool(bam_file)
    modo_path   = bool(fastq_r1_path)

    modos_ativos = sum([modo_upload, modo_bam, modo_path])
    if modos_ativos == 0:
        raise HTTPException(status_code=400, detail="Envie arquivos (files / bam_file) ou informe caminhos (fastq_r1_path).")
    if modos_ativos > 1:
        raise HTTPException(status_code=400, detail="Use somente um modo: upload FASTQ, upload BAM, ou caminho.")

    EXTENSOES_VALIDAS = ('.fastq', '.fastq.gz', '.fq', '.fq.gz')
    id_anonimo = str(uuid.uuid4())
    _modo_str = "upload-fastq" if modo_upload else ("upload-bam" if modo_bam else "path")
    logger.info("[%s] Nova análise — modo %s.", id_anonimo, _modo_str)

    try:
        new_entry = models.Analysis(
            patient_id=patientId,
            patient_uuid=id_anonimo,
            doctor=doctor,
            protocol=protocol,
            biological_sex=sex
        )
        db.add(new_entry)
        db.commit()
        db.refresh(new_entry)

        try:
            cfg    = json.loads(config)
            vaf    = float(cfg.get("vaf",   0.05))
            min_dp = int(cfg.get("minDp", 100))
        except (ValueError, KeyError):
            vaf, min_dp = 0.05, 100

        # ── MODO UPLOAD ──────────────────────────────────────────────────────
        if modo_upload:
            if len(files) > 2:
                raise HTTPException(status_code=400, detail="Envie no máximo 2 arquivos (R1 e R2).")

            if not WSL_PROCESSAMENTO.exists():
                raise HTTPException(
                    status_code=503,
                    detail=(
                        f"Diretório WSL2 inacessível: {WSL_PROCESSAMENTO}. "
                        "Certifique-se de que o WSL2 está ativo (abra o Ubuntu no menu Iniciar) e tente novamente."
                    )
                )

            nomes_salvos: dict[str, str] = {}
            md5_hashes:   dict[str, str] = {}

            for upload in files:
                nome_original = upload.filename or ""
                tag = "R2" if re.search(r'[_\-\.]R2[_\-\.]|[_\-\.]R2$|_2\.', nome_original, re.IGNORECASE) else "R1"

                extensoes       = Path(nome_original).suffixes
                extensao_bruta  = "".join(extensoes).lower()
                extensao_segura = re.sub(r'[^a-z0-9.]', '', extensao_bruta)

                if not extensao_segura.endswith(EXTENSOES_VALIDAS):
                    raise HTTPException(
                        status_code=400,
                        detail=f"Formato inválido ({nome_original}). Use .fastq ou .fastq.gz"
                    )

                novo_nome   = f"{id_anonimo}_{tag}{extensao_segura}"
                caminho_wsl = WSL_PROCESSAMENTO / novo_nome

                logger.info("[%s] Salvando %s (%s)...", id_anonimo, tag, novo_nome)
                md5_hash = hashlib.md5()
                try:
                    with open(caminho_wsl, "wb") as buffer:
                        while chunk := await upload.read(8192 * 1024):
                            buffer.write(chunk)
                            md5_hash.update(chunk)
                except OSError as e:
                    raise HTTPException(
                        status_code=503,
                        detail=f"Falha ao salvar {tag} no WSL2 ({caminho_wsl}): {e}"
                    ) from e

                nomes_salvos[tag] = novo_nome
                md5_hashes[tag]   = md5_hash.hexdigest()
                logger.info("[%s] %s salvo. MD5: %s", id_anonimo, tag, md5_hashes[tag])

            if "R1" not in nomes_salvos:
                raise HTTPException(status_code=400, detail="R1 não identificado. Verifique o nome dos arquivos.")

            new_entry.md5_checksum = md5_hashes.get("R1")
            db.commit()

            nome_r1 = nomes_salvos["R1"]
            nome_r2 = nomes_salvos.get("R2")

            background_tasks.add_task(
                processar_paciente_wsl, id_anonimo, nome_r1, nome_r2,
                vaf, min_dp, ref_genome, target_bed, pon_file
            )

        # ── MODO BAM ─────────────────────────────────────────────────────────
        elif modo_bam:
            nome_original_bam = bam_file.filename or "upload.bam"
            if not nome_original_bam.lower().endswith('.bam'):
                raise HTTPException(status_code=400, detail=f"Formato inválido ({nome_original_bam}). Use .bam")

            nome_bam = f"{id_anonimo}_input.bam"
            caminho_wsl_bam = WSL_PROCESSAMENTO / nome_bam

            if not WSL_PROCESSAMENTO.exists():
                raise HTTPException(
                    status_code=503,
                    detail=(
                        f"Diretório WSL2 inacessível: {WSL_PROCESSAMENTO}. "
                        "Certifique-se de que o WSL2 está ativo (abra o Ubuntu no menu Iniciar) e tente novamente."
                    )
                )

            logger.info("[%s] Salvando BAM (%s)...", id_anonimo, nome_bam)
            md5_hash = hashlib.md5()
            try:
                with open(caminho_wsl_bam, "wb") as buffer:
                    while chunk := await bam_file.read(8192 * 1024):
                        buffer.write(chunk)
                        md5_hash.update(chunk)
            except OSError as e:
                raise HTTPException(
                    status_code=503,
                    detail=f"Falha ao salvar BAM no WSL2 ({caminho_wsl_bam}): {e}"
                ) from e

            new_entry.md5_checksum = md5_hash.hexdigest()
            db.commit()
            logger.info("[%s] BAM salvo. MD5: %s", id_anonimo, new_entry.md5_checksum)

            background_tasks.add_task(
                processar_paciente_wsl, id_anonimo, None, None,
                vaf, min_dp, ref_genome, target_bed, pon_file, nome_bam
            )

        # ── MODO PATH ────────────────────────────────────────────────────────
        else:
            def _ext_segura(caminho: str) -> str:
                ext = re.sub(r'[^a-z0-9.]', '', "".join(Path(caminho).suffixes).lower())
                if not ext.endswith(EXTENSOES_VALIDAS):
                    raise HTTPException(
                        status_code=400,
                        detail=f"Formato inválido ({Path(caminho).name}). Use .fastq ou .fastq.gz"
                    )
                return ext

            def _checar_existencia(caminho: str, tag: str) -> None:
                if not _caminho_para_windows(caminho).exists():
                    raise HTTPException(status_code=404, detail=f"Arquivo {tag} não encontrado: {caminho}")

            _checar_existencia(fastq_r1_path, "R1")
            if fastq_r2_path:
                _checar_existencia(fastq_r2_path, "R2")

            nome_r1 = f"{id_anonimo}_R1{_ext_segura(fastq_r1_path)}"
            nome_r2 = f"{id_anonimo}_R2{_ext_segura(fastq_r2_path)}" if fastq_r2_path else None

            db.commit()

            background_tasks.add_task(
                _preparar_e_processar,
                id_anonimo, fastq_r1_path, fastq_r2_path,
                nome_r1, nome_r2, vaf, min_dp, ref_genome, target_bed, pon_file
            )

        return {"status": "processing", "db_id": new_entry.id, "uuid": id_anonimo}

    except HTTPException:
        raise
    except Exception as e:
        logger.error("[%s] Erro no registro/ingestão: %s", id_anonimo, e)
        db.rollback()
        raise HTTPException(status_code=500, detail="Erro interno ao iniciar análise")
    
@app.get("/api/history")
def get_history(db: Session = Depends(get_db)):
    """Recupera o histórico completo de análises do banco de dados"""
    history = db.query(models.Analysis).order_by(models.Analysis.date.desc()).all()
    return history

@app.get("/api/analysis/{uuid}")
def get_analysis(uuid: str, db: Session = Depends(get_db)):
    """Busca uma análise pelo patient_uuid — suporta refresh da página Results"""
    analysis = db.query(models.Analysis).filter(models.Analysis.patient_uuid == uuid).first()
    if not analysis:
        raise HTTPException(status_code=404, detail="Análise não encontrada")

    data = {k: v for k, v in vars(analysis).items() if not k.startswith("_")}

    plot_data = []
    try:
        plot_path = WSL_PROCESSAMENTO / f"{uuid}_plot_data.json"
        with open(plot_path, "r", encoding="utf-8") as f:
            plot_data = json.load(f)
    except (FileNotFoundError, OSError, json.JSONDecodeError):
        pass

    data["plot_data"] = plot_data
    return data

@app.delete("/api/analysis/{analysis_id}")
def delete_analysis(analysis_id: int, db: Session = Depends(get_db)):
    """Remove o registro do banco e apaga os arquivos associados no WSL"""
    analysis = db.query(models.Analysis).filter(models.Analysis.id == analysis_id).first()
    if not analysis:
        raise HTTPException(status_code=404, detail="Registro não encontrado")
        
    uuid_alvo = analysis.patient_uuid
    try:
        db.delete(analysis)
        db.commit()
        
        if uuid_alvo and re.match(r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$', uuid_alvo):
            for arquivo in WSL_PROCESSAMENTO.glob(f"{uuid_alvo}*"):
                try:
                    os.remove(arquivo)
                except Exception as e:
                    logger.error(f"Falha ao apagar arquivo WSL {arquivo.name}: {e}")

        return {"message": "Sucesso"}
    except Exception as e:
        db.rollback()
        logger.error(f"Erro ao deletar análise {analysis_id}: {e}")
        raise HTTPException(status_code=500, detail="Erro ao remover análise do banco de dados")

@app.get("/api/analysis/{uuid}/annotated-vcf")
async def get_annotated_vcf(uuid: str):
    """Serve o VCF anotado pelo SnpEff para download pelo frontend"""
    if not re.match(r'^[0-9a-f-]{36}$', uuid):
        raise HTTPException(status_code=400, detail="UUID inválido.")

    vcf_path = WSL_PROCESSAMENTO / f"{uuid}_consensus_annotated.vcf"
    if not vcf_path.exists():
        raise HTTPException(status_code=404, detail="VCF anotado ainda não disponível ou não gerado.")

    return FileResponse(
        vcf_path,
        media_type="text/plain",
        filename=f"pantherflow_{uuid[:8]}_annotated.vcf"
    )


@app.get("/api/analysis/{uuid}/qc-report")
async def get_qc_report(uuid: str):
    """Busca e retorna o relatório HTML do FastQC gerado no WSL"""
    # Procura na pasta do WSL por qualquer arquivo HTML que comece com o UUID da análise
    arquivos_html = list(WSL_PROCESSAMENTO.glob(f"{uuid}*_fastqc.html"))
    
    if not arquivos_html:
        raise HTTPException(status_code=404, detail="Relatório de qualidade ainda não disponível ou não gerado.")
        
    # Retorna o arquivo HTML estático para o React renderizar
    return FileResponse(arquivos_html[0])

@app.get("/api/analysis/{uuid}/console")
async def get_console_logs(uuid: str):
    """Lê o arquivo de log em tempo real do WSL e envia para o Frontend"""
    caminho_log = WSL_PROCESSAMENTO / f"{uuid}.log"
    
    if not caminho_log.exists():
        return {"logs": "> Aguardando inicialização do pipeline...\n"}
        
    with open(caminho_log, "r", encoding="utf-8") as f:
        conteudo = f.read()
        
    return {"logs": conteudo}

@app.get("/api/analysis/{uuid}/qualimap/{file_path:path}")
async def get_qualimap_report(uuid: str, file_path: str):
    """
    Serve o relatório do Qualimap como um mini-servidor estático.
    Entrega o HTML principal, o CSS e os gráficos gerados sob demanda.
    """
    pasta_qualimap = WSL_PROCESSAMENTO / f"{uuid}_qualimap"
    
    if not pasta_qualimap.exists():
        raise HTTPException(status_code=404, detail="Relatório Qualimap não disponível ou ainda não gerado.")
        
    arquivo_alvo = (pasta_qualimap / file_path).resolve()

    # Prevenção de path traversal: resolve() canonicaliza ../.. antes da verificação
    if not arquivo_alvo.is_relative_to(pasta_qualimap.resolve()) or not arquivo_alvo.exists():
        raise HTTPException(status_code=404, detail="Arquivo não encontrado.")

    return FileResponse(arquivo_alvo)

_VCF_CALLERS = {
    "varscan":   "_varscan_annotated.vcf",
    "mutect":    "_mutect_annotated.vcf",
    "lofreq":    "_lofreq_annotated.vcf",
    "consensus": "_consensus_gnomad.vcf",
}

_ANN_RE = re.compile(r'ANN=([^;]+)')

def _parse_vcf_para_viewer(vcf_path: Path, limite: int = 2000) -> list[dict]:
    """Lê um VCF (plain ou .gz) e devolve lista de dicts prontos para o frontend.

    Extrai: CHROM, POS, ID, REF, ALT, QUAL, FILTER e, do campo ANN= (SnpEff),
    o gene e o efeito funcional da primeira anotação de cada variante.
    Limitado a `limite` variantes para não sobrecarregar a resposta JSON.
    """
    import gzip as _gzip

    variantes: list[dict] = []
    opener = _gzip.open if str(vcf_path).endswith(".gz") else open

    try:
        with opener(vcf_path, "rt", encoding="utf-8", errors="replace") as fh:
            for linha in fh:
                if linha.startswith("#"):
                    continue
                cols = linha.rstrip("\n").split("\t")
                if len(cols) < 8:
                    continue

                chrom, pos, vid, ref, alt, qual, filt, info = cols[:8]

                gene = effect = hgvs_c = hgvs_p = "—"
                m = _ANN_RE.search(info)
                if m:
                    # ANN= pode ter múltiplas anotações separadas por vírgula; usa a primeira
                    primeira = m.group(1).split(",")[0].split("|")
                    # ANN fields: Allele|Effect|Impact|Gene|GeneID|Feature|...
                    if len(primeira) > 3:
                        effect = primeira[1] or "—"
                        gene   = primeira[3] or "—"
                    if len(primeira) > 9:
                        hgvs_c = primeira[9]  or "—"
                    if len(primeira) > 10:
                        hgvs_p = primeira[10] or "—"

                variantes.append({
                    "chrom":  chrom,
                    "pos":    int(pos) if pos.isdigit() else pos,
                    "id":     vid if vid != "." else None,
                    "ref":    ref,
                    "alt":    alt,
                    "qual":   qual if qual != "." else None,
                    "filter": filt,
                    "gene":   gene,
                    "effect": effect,
                    "hgvs_c": hgvs_c,
                    "hgvs_p": hgvs_p,
                })

                if len(variantes) >= limite:
                    break
    except (OSError, EOFError) as e:
        logger.warning("VCF viewer: erro ao ler %s — %s", vcf_path.name, e)

    return variantes


@app.get("/api/analysis/{uuid}/vcf-viewer")
def vcf_viewer(uuid: str, caller: str = "consensus", limite: int = 2000):
    """Retorna as variantes de um VCF anotado como JSON para o visualizador.

    Query params:
      caller  — um de: varscan | mutect | lofreq | consensus  (default: consensus)
      limite  — máximo de variantes retornadas (default: 2000, max: 5000)
    """
    if not re.match(r'^[0-9a-f-]{36}$', uuid):
        raise HTTPException(status_code=400, detail="UUID inválido.")

    if caller not in _VCF_CALLERS:
        raise HTTPException(
            status_code=400,
            detail=f"Caller inválido. Use um de: {', '.join(_VCF_CALLERS)}"
        )

    limite = min(max(1, limite), 5000)

    sufixo   = _VCF_CALLERS[caller]
    vcf_path = WSL_PROCESSAMENTO / f"{uuid}{sufixo}"

    # Tenta também a versão .gz (ex: se comprimido por pós-processamento externo)
    if not vcf_path.exists():
        vcf_gz = Path(str(vcf_path) + ".gz")
        if vcf_gz.exists():
            vcf_path = vcf_gz
        else:
            raise HTTPException(
                status_code=404,
                detail=f"VCF '{caller}' não encontrado para esta análise. "
                       "A pipeline pode não ter concluído esta etapa."
            )

    variantes = _parse_vcf_para_viewer(vcf_path, limite=limite)
    return {
        "uuid":       uuid,
        "caller":     caller,
        "vcf_file":   vcf_path.name,
        "total":      len(variantes),
        "truncated":  len(variantes) == limite,
        "variants":   variantes,
    }


@app.post("/api/vcf/viewer")
async def vcf_viewer_standalone(
    limite: int = Form(default=5000),
    file: Optional[UploadFile] = File(default=None),
    filepath: Optional[str] = Form(default=None),
):
    """Visualizador standalone de VCF — aceita upload de arquivo ou caminho absoluto no servidor.

    Parâmetros (multipart/form-data):
      file      — arquivo .vcf ou .vcf.gz enviado pelo browser (opcional)
      filepath  — caminho absoluto no sistema de arquivos do servidor (opcional)
      limite    — máximo de variantes retornadas (default 5000, máx 10000)

    Exatamente um de `file` ou `filepath` deve ser informado.
    """
    import tempfile

    limite = min(max(1, limite), 10000)

    if file is not None:
        nome_original = file.filename or "upload.vcf"
        suffix = ".vcf.gz" if nome_original.endswith(".gz") else ".vcf"
        conteudo = await file.read()
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
            tmp_path = Path(tmp.name)
            tmp.write(conteudo)
        try:
            variantes = _parse_vcf_para_viewer(tmp_path, limite=limite)
        finally:
            tmp_path.unlink(missing_ok=True)
        filename = nome_original

    elif filepath:
        vcf_path = Path(filepath).resolve()
        nome = vcf_path.name
        if not (nome.endswith(".vcf") or nome.endswith(".vcf.gz")):
            raise HTTPException(
                status_code=400,
                detail="O caminho deve apontar para um arquivo .vcf ou .vcf.gz"
            )
        if not vcf_path.exists():
            raise HTTPException(
                status_code=404,
                detail=f"Arquivo não encontrado: {filepath}"
            )
        variantes = _parse_vcf_para_viewer(vcf_path, limite=limite)
        filename = nome

    else:
        raise HTTPException(
            status_code=400,
            detail="Envie um arquivo (file) ou informe um caminho no servidor (filepath)."
        )

    return {
        "vcf_file":  filename,
        "total":     len(variantes),
        "truncated": len(variantes) == limite,
        "variants":  variantes,
    }


# ═══════════════════════════════════════════════════════════════════════════════
# MÓDULO DE AUDITORIA E CONCORDÂNCIA
# Compara variantes Ion Reporter (hg19, .tsv) com VCF local PantherFlow (hg38).
# Dependências extras: pandas, pyliftover  (pip install pandas pyliftover)
# ═══════════════════════════════════════════════════════════════════════════════

# Cache do conversor liftover — inicializado na primeira chamada ao endpoint.
# pyliftover faz download automático do chainfile UCSC (~300 KB) se não houver
# cópia local em ~/.pyliftover/. Instâncias subsequentes reutilizam o cache.
_liftover_cache: object = None   # tipo real: pyliftover.LiftOver
_liftover_lock = __import__("threading").Lock()


def _get_lifter():
    """Retorna instância cacheada do conversor hg19→hg38."""
    global _liftover_cache
    with _liftover_lock:
        if _liftover_cache is None:
            try:
                from pyliftover import LiftOver
            except ImportError:
                raise HTTPException(
                    status_code=503,
                    detail="pyliftover não instalado. Execute: pip install pyliftover"
                )
            logger.info("[auditoria] Inicializando LiftOver hg19->hg38 (download chainfile se necessário)...")
            _liftover_cache = LiftOver('hg19', 'hg38')
            logger.info("[auditoria] LiftOver pronto.")
    return _liftover_cache


# --- Mapeamento de nomes de coluna do Ion Reporter (varia por versão/idioma) ---
# Nota: chrom e pos são extraídos da coluna 'locus' (formato 'chr:pos'), não de
# colunas separadas. _ION_REF/ALT/VAF/GENE são opcionais — enriquecem os discordantes.
_ION_REF_COLS   = ["Ref", "REF", "Reference", "ref"]
_ION_ALT_COLS   = ["normalizedAlt", "Observed Allele", "Variant", "ALT", "Alt", "Allele", "allele", "variant", "Alternative"]
_ION_VAF_COLS   = ["allele_frequency_%", "allele_ratio",
                   "Allele Frequency", "Allele Frequency %", "Allele Ratio",
                   "Allele_Ratio", "AF", "Frequency", "frequency",
                   "VAF", "vaf", "Allele_Frequency", "allele_frequency"]
_ION_GENE_COLS  = ["Genes", "Gene Symbol", "Gene", "gene", "gene_symbol", "GENE", "Gene_Symbol"]


def _safe_vaf(raw) -> float | None:
    """Converte valor bruto do pandas para float ou None.
    Trata NaN, None, strings vazias e valores não numéricos como None,
    evitando ValueError: Out of range float values are not JSON compliant: nan.
    """
    if raw is None:
        return None
    try:
        v = float(raw)
        return None if math.isnan(v) or math.isinf(v) else v
    except (TypeError, ValueError):
        return None


def _fmt_vaf(v: float | None) -> str | None:
    """Formata VAF (0.0–1.0) como string de porcentagem (ex: 0.155 → '15.5%').
    Recebe apenas valores já sanitizados por _safe_vaf — nunca NaN.
    """
    return f"{v * 100:.1f}%" if v is not None else "-"


def _resolver_coluna(colunas: list[str], candidatos: list[str]) -> str | None:
    """Retorna o primeiro candidato encontrado nas colunas do DataFrame."""
    for c in candidatos:
        if c in colunas:
            return c
    return None


def _normalizar_chrom(chrom: str) -> str:
    """Garante prefixo 'chr' — padrão exigido pelo pyliftover e produzido pelo GATK."""
    chrom = str(chrom).strip()
    if not chrom.startswith("chr"):
        chrom = "chr" + chrom
    return chrom


def _parse_ion_reporter_tsv(conteudo: bytes):
    """
    Parser dinâmico para TSV do Ion Reporter.

    Suporta dois formatos de exportação:
      Formato A (laudo completo):
        ## metadado 1            ← ignorada
        ## metadado 2            ← ignorada
        # locus  Ref  ...        ← cabeçalho com '#' inicial

      Formato B (laudo filtrado de variantes reais):
        <texto livre>            ← ignorada
        <mais metadados>         ← ignorada
        Locus    Ref   Observed Allele  ...  ← cabeçalho SEM '#'
        chr2:163393432  G  A    ...

    Estratégia de detecção:
      1. Varre as linhas procurando aquela cujo primeiro campo (split por tab)
         seja exatamente "Locus" ou "locus" (case-insensitive, sem '#').
      2. Se não encontrar, tenta o formato antigo procurando '#' simples.
      3. Carrega o bloco a partir dessa linha com pandas.
    """
    try:
        import pandas as pd
    except ImportError:
        raise HTTPException(
            status_code=503,
            detail="pandas não instalado. Execute: pip install pandas"
        )
    import io

    texto  = conteudo.decode("utf-8", errors="replace")
    linhas = texto.splitlines()

    idx_header = None

    # Passo 1 — procura linha cujo primeiro campo (tab-delimitado) seja "Locus"
    for i, linha in enumerate(linhas):
        primeiro_campo = linha.split("\t")[0].strip()
        if primeiro_campo.lower() == "locus":
            idx_header = i
            break

    # Passo 2 — fallback: formato com '#' inicial no cabeçalho
    if idx_header is None:
        for i, linha in enumerate(linhas):
            stripped = linha.strip()
            if stripped.startswith("##"):
                continue
            if stripped.startswith("#"):
                linhas[i] = stripped.lstrip("#").strip()
                idx_header = i
                break

    if idx_header is None:
        raise ValueError(
            "Cabeçalho não encontrado no TSV do Ion Reporter. "
            "Esperado: linha começando com 'Locus' (formato filtrado) "
            "ou '# locus' (formato completo)."
        )

    corpo = "\n".join(linhas[idx_header:])
    df = pd.read_csv(io.StringIO(corpo), sep="\t", dtype=str, keep_default_na=False)
    df.columns = [c.strip() for c in df.columns]
    return df


def _parse_vcf_concordancia(vcf_path: Path):
    """
    Lê um VCF Mutect2/hard-filtered e retorna DataFrame com:
    chrom, pos (int, 1-based), ref, alt, vaf (float|None), gene, chave (str).
    """
    try:
        import pandas as pd
    except ImportError:
        raise HTTPException(status_code=503, detail="pandas não instalado.")

    _ANN_RE_LOCAL = re.compile(r'ANN=([^;]+)')
    registros: list[dict] = []

    # ── Diagnóstico de caminho ───────────────────────────────────────────────
    print(f"[DEBUG VCF] Caminho absoluto: {vcf_path}")
    print(f"[DEBUG VCF] Arquivo existe:   {vcf_path.exists()}")
    if vcf_path.exists():
        print(f"[DEBUG VCF] Tamanho (bytes):  {vcf_path.stat().st_size}")

    n_header  = 0
    n_curtas  = 0
    n_erro    = 0
    n_dados   = 0

    # Nenhum try/except genérico — qualquer erro propaga para o log do Uvicorn
    with open(vcf_path, "r", encoding="utf-8", errors="replace") as fh:
        for linha in fh:
            linha = linha.rstrip("\r\n")   # remove \r\n E \n (UNC paths WSL2)

            if linha.startswith("#"):
                n_header += 1
                continue

            cols = linha.split("\t")
            if len(cols) < 8:
                n_curtas += 1
                if n_curtas <= 3:
                    print(f"[DEBUG VCF] Linha curta ({len(cols)} cols): {linha[:80]!r}")
                continue

            chrom, pos_str, _, ref, alt = cols[0], cols[1], cols[2], cols[3], cols[4]

            # VAF — FORMAT/AF (Mutect2); fallback FREQ% (VarScan2)
            vaf: float | None = None
            if len(cols) >= 10:
                fmt_keys = cols[8].split(":")
                fmt_vals = cols[9].split(":")
                fmt      = dict(zip(fmt_keys, fmt_vals))
                af_raw   = fmt.get("AF", "").split(",")[0]
                freq_raw = fmt.get("FREQ", "").replace("%", "")
                for raw, divisor in [(af_raw, 1.0), (freq_raw, 100.0)]:
                    if raw:
                        try:
                            vaf = float(raw) / divisor
                            break
                        except ValueError:
                            pass

            # Gene — campo ANN= do SnpEff (ausente em VCFs pré-anotação)
            gene = "—"
            m = _ANN_RE_LOCAL.search(cols[7])
            if m:
                ann = m.group(1).split(",")[0].split("|")
                if len(ann) > 3 and ann[3]:
                    gene = ann[3]

            try:
                pos = int(pos_str)
            except ValueError:
                n_erro += 1
                print(f"[DEBUG VCF] POS inválido: {pos_str!r} na linha: {linha[:80]!r}")
                continue

            n_dados += 1
            chrom_norm = _normalizar_chrom(chrom)
            chave = f"{chrom_norm}:{pos}"
            registros.append({
                "chrom": chrom_norm,
                "pos":   pos,
                "ref":   ref.upper(),
                "alt":   alt.upper(),
                "vaf":   vaf,
                "gene":  gene,
                "chave": chave,
            })

    print(f"[DEBUG VCF] Linhas header={n_header} | dados={n_dados} | curtas={n_curtas} | pos_inválido={n_erro}")
    print(f"[DEBUG VCF] Variantes VCF lidas: {len(registros)}")

    return pd.DataFrame(registros)


@app.post("/api/auditoria/concordancia")
async def auditoria_concordancia(
    file: UploadFile = File(...),
    sample_uuid: str = Form(...),
):
    """Compara variantes Ion Reporter (hg19, TSV) com VCF local PantherFlow (hg38).

    Fluxo:
      1. Valida UUID e localiza _mutect_hf.vcf (fallback: _mutect.vcf)
      2. Lê e normaliza o TSV do Ion Reporter via pandas
      3. Aplica liftover hg19→hg38 em cada variante (descarta falhas com aviso)
      4. Lê o VCF local e extrai (chrom, pos, ref, alt, vaf, gene)
      5. Cria chaves CHR:POS:REF:ALT e computa: concordância, exclusivos IR, exclusivos PF
      6. Retorna JSON com métricas e lista completa de discordantes
    """
    try:
        import pandas as pd
    except ImportError:
        raise HTTPException(
            status_code=503,
            detail="pandas não instalado. Execute: pip install pandas pyliftover"
        )

    # ── Validação e localização do VCF ──────────────────────────────────────
    if not re.match(r'^[0-9a-f-]{36}$', sample_uuid):
        raise HTTPException(status_code=400, detail="sample_uuid inválido.")

    # Ordem de preferência para localizar o VCF:
    # 1. AUDITORIA_DIR — cópia segura criada pela pipeline, imune ao DELETE /api/analysis/{id}
    # 2. WSL_PROCESSAMENTO — arquivo original (pode ter sido apagado pelo DELETE ou limpeza)
    # 3. _mutect.vcf em WSL_PROCESSAMENTO — fallback soft-filtered sem hard filters clínicos
    _candidatos = [
        (AUDITORIA_DIR      / f"{sample_uuid}_mutect_hf.vcf", "mutect_hf · auditoria/  (cópia segura)"),
        (WSL_PROCESSAMENTO  / f"{sample_uuid}_mutect_hf.vcf", "mutect_hf · processamento/ (original)"),
        (WSL_PROCESSAMENTO  / f"{sample_uuid}_mutect.vcf",    "mutect · processamento/ (soft-filtered)"),
    ]

    vcf_path = vcf_label = None
    for _caminho, _label in _candidatos:
        if _caminho.exists():
            vcf_path, vcf_label = _caminho, _label
            break

    if vcf_path is None:
        raise HTTPException(
            status_code=404,
            detail=f"Nenhum VCF encontrado para {sample_uuid}. "
                   "Verifique se a pipeline concluiu a etapa de Mutect2 e se o arquivo "
                   f"existe em {AUDITORIA_DIR} ou {WSL_PROCESSAMENTO}."
        )

    logger.info("[auditoria] VCF localizado: %s → %s", vcf_label, vcf_path)

    # ── Leitura do TSV ───────────────────────────────────────────────────────
    conteudo_tsv = await file.read()
    try:
        df_ion_raw = _parse_ion_reporter_tsv(conteudo_tsv)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))

    cols = list(df_ion_raw.columns)

    # Coluna obrigatória: 'locus' contém 'chr:pos' concatenados (ex: chr7:55191822)
    col_locus = _resolver_coluna(cols, ["locus", "Locus", "LOCUS", "# locus"])
    if col_locus is None:
        raise HTTPException(
            status_code=422,
            detail=f"Coluna 'locus' não encontrada no TSV. "
                   f"Colunas detectadas: {cols[:20]}"
        )

    # Colunas opcionais — enriquecem os discordantes, mas não bloqueiam a análise
    col_ref  = _resolver_coluna(cols, _ION_REF_COLS)
    col_alt  = _resolver_coluna(cols, _ION_ALT_COLS)
    col_vaf  = _resolver_coluna(cols, _ION_VAF_COLS)
    col_gene = _resolver_coluna(cols, _ION_GENE_COLS)

    # ── Liftover hg19 → hg38 ────────────────────────────────────────────────
    # Chave primária de interseção: CHR:POS (hg38)
    # Reduz a chave a coordenada genômica para ser robusta às diferenças de
    # representação de REF/ALT entre Ion Reporter e GATK (normalização de INDELs,
    # left-alignment, trimming de bases compartilhadas).
    lo = _get_lifter()
    registros_ion: list[dict] = []
    falhas_liftover = 0

    for _, row in df_ion_raw.iterrows():
        locus_str = str(row[col_locus]).strip()

        # Separa 'chr7:55191822' → chrom='chr7', pos='55191822'
        partes = locus_str.split(":", 1)
        if len(partes) != 2:
            logger.warning("[auditoria] Locus malformado '%s' — ignorado.", locus_str)
            falhas_liftover += 1
            continue

        chrom_raw = _normalizar_chrom(partes[0])
        pos_raw   = partes[1].strip().replace(",", "")

        try:
            pos_hg19 = int(pos_raw)
        except ValueError:
            logger.warning("[auditoria] Posição inválida '%s' no locus '%s' — ignorado.", pos_raw, locus_str)
            falhas_liftover += 1
            continue

        # pyliftover recebe posição 0-based; VCF usa 1-based
        resultado = lo.convert_coordinate(chrom_raw, pos_hg19 - 1)
        if not resultado:
            logger.warning(
                "[auditoria] Liftover sem resultado para %s:%d — variante descartada.",
                chrom_raw, pos_hg19
            )
            falhas_liftover += 1
            continue

        chrom_hg38 = _normalizar_chrom(resultado[0][0])
        pos_hg38   = resultado[0][1] + 1   # de volta para 1-based

        # Campos opcionais de enriquecimento
        ref_raw  = str(row[col_ref]).strip().upper()  if col_ref  else "—"
        alt_raw  = str(row[col_alt]).strip().upper()  if col_alt  else "—"
        gene_raw = str(row[col_gene]).strip()         if col_gene else "—"
        vaf_raw  = str(row[col_vaf]).strip().replace("%", "") if col_vaf else ""

        vaf: float | None = None
        if vaf_raw:
            try:
                vaf = float(vaf_raw)
                if vaf > 1.0:   # Ion Reporter exporta em %, converte para fração
                    vaf /= 100.0
            except ValueError:
                pass

        # Chave simplificada: CHR:POS (hg38)
        chave = f"{chrom_hg38}:{pos_hg38}"
        registros_ion.append({
            "chrom": chrom_hg38, "pos": pos_hg38,
            "ref": ref_raw, "alt": alt_raw,
            "vaf": vaf, "gene": gene_raw,
            "chave": chave,
        })

    if not registros_ion:
        raise HTTPException(
            status_code=422,
            detail=f"Todas as {falhas_liftover} variantes do TSV falharam no liftover. "
                   "Verifique se o arquivo contém coordenadas hg19 válidas."
        )

    # Deduplica por chave (mantém última ocorrência em caso de duplicatas no TSV)
    df_ion = pd.DataFrame(registros_ion).drop_duplicates(subset="chave", keep="last")

    # ── Leitura do VCF local ─────────────────────────────────────────────────
    try:
        df_vcf = _parse_vcf_concordancia(vcf_path)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))

    if not df_vcf.empty:
        df_vcf = df_vcf.drop_duplicates(subset="chave", keep="last")

    # ── Interseção por chave CHR:POS:REF:ALT ────────────────────────────────
    set_ion = set(df_ion["chave"])
    set_vcf = set(df_vcf["chave"]) if not df_vcf.empty else set()

    concordantes           = set_ion & set_vcf
    exclusivos_ion         = set_ion - set_vcf
    exclusivos_pantherflow = set_vcf - set_ion

    n_ion      = len(set_ion)
    n_vcf      = len(set_vcf)
    n_concord  = len(concordantes)
    n_uniao    = len(set_ion | set_vcf)

    # Taxa de Jaccard: interseção / união — métrica padrão de benchmarking genômico
    taxa_concordancia = round(n_concord / n_uniao * 100, 2) if n_uniao > 0 else 0.0

    # ── Montar concordantes_detalhe (scatter plot + aba de TPs) ────────────
    concordantes_detalhe: list[dict] = []
    ion_idx = df_ion.set_index("chave", drop=False)
    vcf_idx = df_vcf.set_index("chave", drop=False) if not df_vcf.empty else None

    for chave in sorted(concordantes):
        r_ion = ion_idx.loc[chave]
        vaf_ir = _safe_vaf(r_ion["vaf"])

        vaf_pf, gene_pf = None, "—"
        if vcf_idx is not None and chave in vcf_idx.index:
            r_vcf  = vcf_idx.loc[chave]
            vaf_pf = _safe_vaf(r_vcf["vaf"])
            gene_pf = str(r_vcf["gene"])

        # Prioridade de gene: VCF anotado (SnpEff) > Ion Reporter
        gene = gene_pf if gene_pf not in ("—", "", None) else str(r_ion["gene"])

        concordantes_detalhe.append({
            "chave":      chave,
            "gene":       gene,
            "chrom":      r_ion["chrom"],
            "pos":        int(r_ion["pos"]),
            "ref":        r_ion["ref"],
            "alt":        r_ion["alt"],
            "vaf_ir":     round(vaf_ir, 4) if vaf_ir is not None else None,
            "vaf_pf":     round(vaf_pf, 4) if vaf_pf is not None else None,
            "vaf_ir_pct": _fmt_vaf(vaf_ir),
            "vaf_pf_pct": _fmt_vaf(vaf_pf),
        })

    # ── Montar discordantes ─────────────────────────────────────────────────
    discordantes: list[dict] = []

    ion_idx = df_ion.set_index("chave", drop=False)
    for chave in sorted(exclusivos_ion):
        r = ion_idx.loc[chave]
        vaf_val = _safe_vaf(r["vaf"])
        discordantes.append({
            "origem":  "ion_reporter",
            "gene":    r["gene"],
            "chrom":   r["chrom"],
            "pos":     int(r["pos"]),
            "ref":     r["ref"],
            "alt":     r["alt"],
            "vaf":     round(vaf_val, 4) if vaf_val is not None else None,
            "vaf_pct": _fmt_vaf(vaf_val),
        })

    if not df_vcf.empty:
        vcf_idx = df_vcf.set_index("chave", drop=False)
        for chave in sorted(exclusivos_pantherflow):
            r = vcf_idx.loc[chave]
            vaf_val = _safe_vaf(r["vaf"])
            discordantes.append({
                "origem":  "pantherflow",
                "gene":    r["gene"],
                "chrom":   r["chrom"],
                "pos":     int(r["pos"]),
                "ref":     r["ref"],
                "alt":     r["alt"],
                "vaf":     round(vaf_val, 4) if vaf_val is not None else None,
                "vaf_pct": _fmt_vaf(vaf_val),
            })

    logger.info(
        "[auditoria] uuid=%s vcf=%s IR=%d PF=%d concord=%d excl_IR=%d excl_PF=%d liftover_fail=%d",
        sample_uuid, vcf_label,
        n_ion, n_vcf, n_concord,
        len(exclusivos_ion), len(exclusivos_pantherflow), falhas_liftover,
    )

    return {
        "sample_uuid":   sample_uuid,
        "vcf_utilizado": vcf_label,
        "metricas": {
            "total_ion_reporter":        n_ion,
            "total_pantherflow":         n_vcf,
            "concordantes":              n_concord,
            "exclusivos_ion_reporter":   len(exclusivos_ion),
            "exclusivos_pantherflow":    len(exclusivos_pantherflow),
            "taxa_concordancia_pct":     taxa_concordancia,
            "variantes_liftover_falhou": falhas_liftover,
        },
        "concordantes_detalhe": concordantes_detalhe,
        "discordantes":         discordantes,
    }


# ═══════════════════════════════════════════════════════════════════════════════
# MÓDULO DE BENCHMARKING ANALÍTICO
# Fonte de verdade: backend/config/manifesto_benchmarking.json
# Compara variantes PantherFlow vs Ion Reporter usando dados reais por amostra.
# ═══════════════════════════════════════════════════════════════════════════════

from pydantic import BaseModel, Field

_MANIFESTO_PATH = Path(__file__).parent / "config" / "manifesto_benchmarking.json"

# Cache em memória — o JSON é lido uma única vez no primeiro pedido
_manifesto_cache: dict | None = None


def _carregar_manifesto() -> dict:
    global _manifesto_cache
    if _manifesto_cache is None:
        if not _MANIFESTO_PATH.exists():
            raise HTTPException(
                status_code=503,
                detail=f"Manifesto não encontrado: {_MANIFESTO_PATH}",
            )
        with open(_MANIFESTO_PATH, encoding="utf-8") as fh:
            _manifesto_cache = json.load(fh)
        logger.info(
            "[benchmarking] Manifesto carregado: %d amostras.",
            len(_manifesto_cache.get("amostras", {})),
        )
    return _manifesto_cache


@app.get("/api/v1/benchmarking/amostras")
def benchmarking_listar_amostras():
    """Retorna amostras disponíveis com metadados de validação física dos arquivos.

    Fonte: backend/config/manifesto_benchmarking.json
    Verifica existência e tamanho do TSV em disco para cada amostra.
    """
    manifesto = _carregar_manifesto()
    amostras_out = []
    for nome, dados in manifesto.get("amostras", {}).items():
        tsv_path = Path(__file__).parent.parent / dados["tsv_ion"]
        tsv_existe = tsv_path.exists()
        amostras_out.append({
            "nome":           nome,
            "status":         "valido" if tsv_existe else "arquivo_nao_encontrado",
            "tamanho_bytes":  tsv_path.stat().st_size if tsv_existe else None,
            "tsv_disponivel": tsv_existe,
            "runs": [
                {
                    "rotulo":         r["rotulo"],
                    "vcf_uuid":       r["vcf_uuid"],
                    "min_dp":         r["min_dp"],
                    "min_vaf":        r["min_vaf"],
                    "vcf_disponivel": (
                        AUDITORIA_DIR / f"{r['vcf_uuid']}_mutect_hf.vcf"
                    ).exists(),
                }
                for r in dados.get("runs", [])
            ],
        })
    return {
        "total":    len(amostras_out),
        "amostras": amostras_out,
    }


# Diretório onde os TSVs Ion Torrent são armazenados
_ION_TORRENT_DIR = Path(__file__).parent / "data" / "real_data" / "ion_torrent"

# Raiz do projeto (um nível acima de backend/) — usado para gerar paths relativos
_PROJECT_ROOT = Path(__file__).resolve().parent.parent

# BED do painel Twist — restringe a comparação Ion vs PantherFlow às regiões cobertas
_TWIST_BED_PATH = Path(__file__).parent / "data" / "bed" / "twist_panel_hg38.bed"


@functools.lru_cache(maxsize=1)
def _carregar_intervalos_bed() -> dict[str, list[tuple[int, int]]]:
    """Carrega o BED do painel Twist e retorna intervalos por cromossomo.

    Cada intervalo é (start_0based, end_exclusive) conforme especificação BED.
    Um SNV hg38 na posição P (1-based) está no painel se existir intervalo
    tal que start <= P-1 < end  →  start+1 <= P <= end.
    """
    if not _TWIST_BED_PATH.exists():
        logger.warning("[BED] %s não encontrado — filtro de painel desativado.", _TWIST_BED_PATH)
        return {}
    intervalos: dict[str, list[tuple[int, int]]] = {}
    with open(_TWIST_BED_PATH, encoding="utf-8", errors="replace") as fh:
        for ln in fh:
            ln = ln.strip()
            if not ln or ln.startswith("#") or ln.startswith("track") or ln.startswith("browser"):
                continue
            cols = ln.split("\t")
            if len(cols) < 3:
                continue
            chrom = _normalizar_chrom(cols[0])
            try:
                start = int(cols[1])
                end   = int(cols[2])
            except ValueError:
                continue
            intervalos.setdefault(chrom, []).append((start, end))
    # Ordena para busca binária
    for chrom in intervalos:
        intervalos[chrom].sort()
    return intervalos


def _em_painel(chrom: str, pos_1based: int) -> bool:
    """Retorna True se a posição (1-based, hg38) cair dentro do painel Twist."""
    intervalos = _carregar_intervalos_bed()
    if not intervalos:
        return True  # sem BED → não filtra (modo permissivo)
    lista = intervalos.get(chrom)
    if not lista:
        return False
    import bisect
    # Busca o último intervalo cujo start <= pos_1based - 1
    pos0 = pos_1based - 1
    idx = bisect.bisect_right(lista, (pos0, float("inf"))) - 1
    if idx < 0:
        return False
    start, end = lista[idx]
    return start <= pos0 < end


@app.post("/api/v1/benchmarking/upload")
async def benchmarking_upload_amostra(
    file:         UploadFile = File(...),
    nome_amostra: str        = Form(...),
):
    """Recebe um TSV Ion Reporter e registra a nova amostra no manifesto.

    Fluxo:
      1. Valida nome da amostra e extensão do arquivo
      2. Salva o TSV em backend/data/real_data/ion_torrent/{nome_amostra}_ion.tsv
      3. Injeta a nova chave no manifesto_benchmarking.json e persiste no disco
      4. Invalida o cache em memória do manifesto

    Nenhum arquivo intermediário tabular é gerado.
    """
    # ── Validação do nome ─────────────────────────────────────────────────
    nome_amostra = nome_amostra.strip()
    if not re.match(r'^[A-Za-z0-9_-]{1,32}$', nome_amostra):
        raise HTTPException(
            status_code=400,
            detail="nome_amostra deve conter apenas letras, números, hífens e underscores (máx. 32 chars).",
        )

    # ── Validação da extensão ─────────────────────────────────────────────
    ext = Path(file.filename or "").suffix.lower()
    if ext not in (".tsv", ".csv", ".txt"):
        raise HTTPException(
            status_code=400,
            detail=f"Extensão '{ext}' não suportada. Envie um arquivo .tsv exportado pelo Ion Reporter.",
        )

    # ── Salvar TSV em disco ───────────────────────────────────────────────
    _ION_TORRENT_DIR.mkdir(parents=True, exist_ok=True)
    destino = _ION_TORRENT_DIR / f"{nome_amostra}_ion.tsv"

    conteudo = await file.read()
    if not conteudo:
        raise HTTPException(status_code=400, detail="Arquivo enviado está vazio.")

    destino.write_bytes(conteudo)
    logger.info("[upload] TSV salvo: %s (%d bytes)", destino, len(conteudo))

    # ── Atualizar manifesto em disco ──────────────────────────────────────
    # Relativo à raiz do projeto (dois níveis acima do backend/)
    tsv_relativo = f"backend/data/real_data/ion_torrent/{nome_amostra}_ion.tsv"

    with open(_MANIFESTO_PATH, encoding="utf-8") as fh:
        manifesto_atual = json.load(fh)

    ja_existia = nome_amostra in manifesto_atual.get("amostras", {})
    if not ja_existia:
        manifesto_atual.setdefault("amostras", {})[nome_amostra] = {
            "tsv_ion": tsv_relativo,
            "runs":    [],
        }
        with open(_MANIFESTO_PATH, "w", encoding="utf-8") as fh:
            json.dump(manifesto_atual, fh, indent=2, ensure_ascii=False)
        logger.info("[upload] Manifesto atualizado: nova amostra '%s'.", nome_amostra)
    else:
        logger.info("[upload] Amostra '%s' já existia no manifesto — TSV atualizado.", nome_amostra)

    # ── Invalidar cache em memória ────────────────────────────────────────
    global _manifesto_cache
    _manifesto_cache = None

    return {
        "nome_amostra":  nome_amostra,
        "arquivo_salvo": str(destino),
        "tamanho_bytes": len(conteudo),
        "ja_existia":    ja_existia,
        "runs_disponiveis": len(
            manifesto_atual.get("amostras", {})
            .get(nome_amostra, {})
            .get("runs", [])
        ),
        "mensagem": (
            f"TSV atualizado para '{nome_amostra}'." if ja_existia
            else f"Amostra '{nome_amostra}' registrada no manifesto. Associe VCFs após o processamento pipeline."
        ),
    }


def _decode_run_from_patient_id(patient_id: str) -> dict:
    """Infere rotulo/min_dp/min_vaf a partir do patient_id gravado no banco.

    Convenção de nomenclatura: {nome}_{min_dp}_{min_vaf_pct}
    Exemplos: 'Pul008_20_05' → DP20_VAF5 / 'Pul063_30_02' → DP30_VAF2
    Entradas sem sufixo (legado) recebem defaults conservadores.
    """
    partes = patient_id.rsplit("_", 2)
    try:
        if len(partes) == 3:
            dp      = int(partes[1])
            vaf_int = int(partes[2])          # ex: 05 → 5
            return {
                "rotulo": f"DP{dp}_VAF{vaf_int}",
                "min_dp":  dp,
                "min_vaf": vaf_int / 100.0,
            }
    except (ValueError, IndexError):
        pass
    return {"rotulo": "DP20_VAF1", "min_dp": 20, "min_vaf": 0.01}


@app.get("/api/v1/benchmarking/vcfs_disponiveis")
def benchmarking_vcfs_disponiveis():
    """Lista VCFs disponíveis em AUDITORIA_DIR, enriquecidos com metadados do banco.

    Retorna: uuid, label legível (patient_id + rotulo), tamanho_bytes,
             rotulo_sugerido, min_dp, min_vaf.
    Usado pelo frontend para popular o dropdown de associação de VCF.
    """
    import sqlite3

    # Indexa uuid → {patient_id, date} a partir do banco
    uuid_map: dict[str, dict] = {}
    try:
        db_path = Path(__file__).parent / "pantherflow.db"
        conn    = sqlite3.connect(str(db_path))
        cur     = conn.cursor()
        cur.execute("SELECT patient_uuid, patient_id, date FROM analyses")
        for row_uuid, pid, date in cur.fetchall():
            uuid_map[row_uuid.strip()] = {"patient_id": pid.strip(), "date": date}
        conn.close()
    except Exception as exc:
        logger.warning("[vcfs_disponiveis] Falha ao consultar DB: %s", exc)

    vcfs = []
    for vcf_file in sorted(AUDITORIA_DIR.glob("*_mutect_hf.vcf")):
        uuid     = vcf_file.stem.replace("_mutect_hf", "").strip()
        db_info  = uuid_map.get(uuid, {})
        pid      = db_info.get("patient_id") or uuid[:8] + "…"
        run_info = _decode_run_from_patient_id(pid)
        vcfs.append({
            "uuid":            uuid,
            "patient_id":      pid,
            "date":            db_info.get("date"),
            "tamanho_bytes":   vcf_file.stat().st_size,
            "rotulo_sugerido": run_info["rotulo"],
            "min_dp":          run_info["min_dp"],
            "min_vaf":         run_info["min_vaf"],
            "label":           f"{pid}  ·  {run_info['rotulo']}",
        })

    return {"total": len(vcfs), "vcfs": vcfs}


@app.get("/api/v1/benchmarking/arquivos_disponiveis")
def benchmarking_arquivos_disponiveis():
    """Varredura física multidimensional de arquivos de benchmarking.

    Não lê nenhum manifesto JSON. Escaneia AUDITORIA_DIR e _ION_TORRENT_DIR
    usando regex extensível e retorna duas listas independentes:

      vcfs — todos os VCFs gerados pela pipeline, classificados por caller
             (Mutect2 / VarScan2 / LoFreq / Consensus) e enriquecidos com
             nome_amostra + parametro via DB.

      tsvs — todos os TSVs Ion Torrent, classificados por tipo:
             "Bruto"   (*_ion.tsv legado, *_raw.tsv)
             "Filtrado" (*_filtered.tsv)
    """
    import sqlite3

    # ── 1. Índice DB: uuid → {patient_id, date} ──────────────────────────────
    uuid_map: dict[str, dict] = {}
    try:
        db_path = Path(__file__).parent / "pantherflow.db"
        conn    = sqlite3.connect(str(db_path))
        cur     = conn.cursor()
        cur.execute("SELECT patient_uuid, patient_id, date FROM analyses")
        for row_uuid, pid, date in cur.fetchall():
            uuid_map[row_uuid.strip()] = {"patient_id": pid.strip(), "date": date}
        conn.close()
    except Exception as exc:
        logger.warning("[arquivos_disponiveis] Falha ao consultar DB: %s", exc)

    # Índice manifesto: uuid → {rotulo, min_dp, min_vaf, nome_amostra}
    manifesto_uuid_map: dict[str, dict] = {}
    try:
        if _MANIFESTO_PATH.exists():
            with open(_MANIFESTO_PATH, encoding="utf-8") as _fh:
                _m = json.load(_fh)
            for _nome, _dados in _m.get("amostras", {}).items():
                for _run in _dados.get("runs", []):
                    _uuid = _run.get("vcf_uuid", "")
                    if _uuid:
                        manifesto_uuid_map[_uuid] = {
                            "rotulo":       _run.get("rotulo", ""),
                            "min_dp":       _run.get("min_dp", 20),
                            "min_vaf":      _run.get("min_vaf", 0.05),
                            "nome_amostra": _nome,
                        }
    except Exception as exc:
        logger.warning("[arquivos_disponiveis] Falha ao ler manifesto: %s", exc)

    # ── 2. Varredura de VCFs ──────────────────────────────────────────────────
    vcfs: list[dict] = []
    for vcf_file in sorted(AUDITORIA_DIR.glob("*.vcf")):
        m = _UUID_RE.match(vcf_file.stem)
        if not m:
            logger.debug("[arquivos_disponiveis] VCF ignorado (sem UUID): %s", vcf_file.name)
            continue

        uuid   = m.group(1)
        sufixo = m.group(2)   # ex: "mutect_hf", "varscan", "consensus"

        # Só exibe VCFs cujo UUID ainda existe no banco (análise não deletada)
        if uuid not in uuid_map:
            continue

        # Classifica o caller pelo sufixo
        caller = "Desconhecido"
        for padrao, nome_caller in _CALLER_SUFIXOS:
            if padrao.search(sufixo):
                caller = nome_caller
                break

        db_info      = uuid_map.get(uuid, {})
        pid          = db_info.get("patient_id") or uuid[:8] + "…"

        # Manifesto tem prioridade — contém rotulo exato (ex: BAM_DP30_VAF3)
        manifest_info = manifesto_uuid_map.get(uuid)
        if manifest_info:
            nome_amostra = manifest_info["nome_amostra"]
            rotulo       = manifest_info["rotulo"]
            min_dp       = manifest_info["min_dp"]
            min_vaf      = manifest_info["min_vaf"]
        else:
            nome_amostra = pid.split("_")[0]
            run_info     = _decode_run_from_patient_id(pid)
            rotulo       = run_info["rotulo"]
            min_dp       = run_info["min_dp"]
            min_vaf      = run_info["min_vaf"]

        vcfs.append({
            "uuid":          uuid,
            "nome_arquivo":  vcf_file.name,
            "path":          vcf_file.relative_to(_PROJECT_ROOT).as_posix(),
            "nome_amostra":  nome_amostra,
            "patient_id":    pid,
            "caller":        caller,
            "parametro":     rotulo,
            "min_dp":        min_dp,
            "min_vaf":       min_vaf,
            "date":          db_info.get("date"),
            "tamanho_bytes": vcf_file.stat().st_size,
            "label":         f"{nome_amostra}  ·  {rotulo}  ·  {caller}",
        })

    # ── 3. Varredura de TSVs ──────────────────────────────────────────────────
    tsvs: list[dict] = []
    if _ION_TORRENT_DIR.exists():
        for tsv_file in sorted(_ION_TORRENT_DIR.glob("*.tsv")):
            stem = tsv_file.stem        # ex: "Pul008_ion", "Pul008_filtered"
            tipo         = None
            nome_amostra = stem

            for padrao, tipo_tsv, sufixo_remover in _TSV_PADROES:
                if padrao.search(stem):
                    tipo         = tipo_tsv
                    # Remove o sufixo classificador para obter o nome puro da amostra
                    nome_amostra = re.sub(
                        re.escape(sufixo_remover) + r'$', '', stem, flags=re.I
                    )
                    break

            if tipo is None:
                # TSV com nome não reconhecido: registra como Bruto com aviso
                logger.warning("[arquivos_disponiveis] TSV sem padrão reconhecido: %s", tsv_file.name)
                tipo = "Bruto"

            tsvs.append({
                "nome_arquivo":  tsv_file.name,
                "path":          tsv_file.relative_to(_PROJECT_ROOT).as_posix(),
                "nome_amostra":  nome_amostra,
                "tipo":          tipo,
                "tamanho_bytes": tsv_file.stat().st_size,
            })

    logger.info(
        "[arquivos_disponiveis] %d VCFs (%s callers) · %d TSVs",
        len(vcfs),
        len({v["caller"] for v in vcfs}),
        len(tsvs),
    )

    return {
        "vcfs":       vcfs,
        "tsvs":       tsvs,
        "total_vcfs": len(vcfs),
        "total_tsvs": len(tsvs),
    }


class AssociarVcfParams(BaseModel):
    nome_amostra: str
    vcf_uuid:     str
    rotulo:       str
    min_dp:       int   = 20
    min_vaf:      float = 0.05


@app.post("/api/v1/benchmarking/associar_vcf")
def benchmarking_associar_vcf(params: AssociarVcfParams):
    """Vincula um VCF a uma amostra no manifesto_benchmarking.json.

    Se o rótulo já existir para a amostra, atualiza o UUID do VCF.
    Caso contrário, adiciona um novo run. Invalida o cache do manifesto.
    """
    global _manifesto_cache

    # Valida UUID
    if not re.match(r'^[0-9a-f-]{36}$', params.vcf_uuid):
        raise HTTPException(status_code=400, detail="vcf_uuid inválido.")

    vcf_path = AUDITORIA_DIR / f"{params.vcf_uuid}_mutect_hf.vcf"
    if not vcf_path.exists():
        raise HTTPException(
            status_code=404,
            detail=f"VCF '{params.vcf_uuid}' não encontrado em {AUDITORIA_DIR}.",
        )

    with open(_MANIFESTO_PATH, encoding="utf-8") as fh:
        manifesto = json.load(fh)

    if params.nome_amostra not in manifesto.get("amostras", {}):
        raise HTTPException(
            status_code=404,
            detail=f"Amostra '{params.nome_amostra}' não encontrada no manifesto.",
        )

    runs = manifesto["amostras"][params.nome_amostra].setdefault("runs", [])
    run_existente = next((r for r in runs if r["rotulo"] == params.rotulo), None)
    if run_existente:
        run_existente["vcf_uuid"] = params.vcf_uuid
        run_existente["min_dp"]   = params.min_dp
        run_existente["min_vaf"]  = params.min_vaf
        acao = "atualizado"
    else:
        runs.append({
            "rotulo":   params.rotulo,
            "vcf_uuid": params.vcf_uuid,
            "min_dp":   params.min_dp,
            "min_vaf":  params.min_vaf,
        })
        acao = "adicionado"

    with open(_MANIFESTO_PATH, "w", encoding="utf-8") as fh:
        json.dump(manifesto, fh, indent=2, ensure_ascii=False)

    _manifesto_cache = None

    logger.info(
        "[associar_vcf] amostra=%s uuid=%s rotulo=%s acao=%s",
        params.nome_amostra, params.vcf_uuid, params.rotulo, acao,
    )

    return {
        "nome_amostra": params.nome_amostra,
        "vcf_uuid":     params.vcf_uuid,
        "rotulo":       params.rotulo,
        "acao":         acao,
        "mensagem":     f"Run '{params.rotulo}' {acao} para {params.nome_amostra}.",
    }


# ─── Estatística: Spearman ρ + p-value (t-Student, Python puro) ─────────────

def _betacf(a: float, b: float, x: float) -> float:
    """Fração contínua de Lentz para a função beta incompleta (Numerical Recipes)."""
    MAXIT, EPS, FPMIN = 200, 3.0e-7, 1.0e-30
    qab, qap, qam = a + b, a + 1.0, a - 1.0
    c = 1.0
    d = 1.0 - qab * x / qap
    if abs(d) < FPMIN:
        d = FPMIN
    d = 1.0 / d
    h = d
    for m in range(1, MAXIT + 1):
        m2 = 2 * m
        aa = m * (b - m) * x / ((qam + m2) * (a + m2))
        d = 1.0 + aa * d
        if abs(d) < FPMIN: d = FPMIN
        c = 1.0 + aa / c
        if abs(c) < FPMIN: c = FPMIN
        d = 1.0 / d
        h *= d * c
        aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2))
        d = 1.0 + aa * d
        if abs(d) < FPMIN: d = FPMIN
        c = 1.0 + aa / c
        if abs(c) < FPMIN: c = FPMIN
        d = 1.0 / d
        delta = d * c
        h *= delta
        if abs(delta - 1.0) < EPS:
            break
    return h


def _betai(a: float, b: float, x: float) -> float:
    """Função beta incompleta regularizada I_x(a, b)."""
    if x <= 0.0:
        return 0.0
    if x >= 1.0:
        return 1.0
    lbeta = math.lgamma(a) + math.lgamma(b) - math.lgamma(a + b)
    bt = math.exp(a * math.log(x) + b * math.log(1.0 - x) - lbeta)
    if x < (a + 1.0) / (a + b + 2.0):
        return bt * _betacf(a, b, x) / a
    else:
        return 1.0 - bt * _betacf(b, a, 1.0 - x) / b


def _t_pvalue(t_stat: float, df: float) -> float:
    """P-value bicaudal para estatística t com df graus de liberdade."""
    x = df / (df + t_stat * t_stat)
    return _betai(df / 2.0, 0.5, x)


def _spearman_com_pvalue(
    xs: list[float], ys: list[float]
) -> tuple[float | None, float | None]:
    """Retorna (rho, p_value) de Spearman; p-value bicaudal via t-Student (n-2 gl)."""
    n = len(xs)
    if n < 4:
        return None, None

    def _rank(arr: list[float]) -> list[float]:
        indexed = sorted(enumerate(arr), key=lambda t: t[1])
        r = [0.0] * n
        for k, (i, _) in enumerate(indexed):
            r[i] = float(k + 1)
        return r

    rx, ry = _rank(xs), _rank(ys)
    d2  = sum((rx[i] - ry[i]) ** 2 for i in range(n))
    rho = 1.0 - (6.0 * d2) / (n * (n * n - 1))
    rho = max(-1.0, min(1.0, rho))   # garante intervalo [-1, 1]

    if abs(rho) >= 1.0:
        return round(rho, 4), 0.0

    t_stat = rho * math.sqrt(n - 2) / math.sqrt(1.0 - rho * rho)
    pval   = _t_pvalue(abs(t_stat), float(n - 2))
    return round(rho, 4), round(pval, 6)


def _pearson_com_pvalue(
    xs: list[float], ys: list[float]
) -> tuple[float | None, float | None]:
    """Retorna (r, p_value) de Pearson; p-value bicaudal via t-Student (n-2 gl)."""
    n = len(xs)
    if n < 4:
        return None, None
    mx, my = sum(xs) / n, sum(ys) / n
    num   = sum((xs[i] - mx) * (ys[i] - my) for i in range(n))
    den_x = math.sqrt(sum((v - mx) ** 2 for v in xs))
    den_y = math.sqrt(sum((v - my) ** 2 for v in ys))
    if den_x == 0 or den_y == 0:
        return None, None
    r = max(-1.0, min(1.0, num / (den_x * den_y)))
    if abs(r) >= 1.0:
        return round(r, 4), 0.0
    t_stat = r * math.sqrt(n - 2) / math.sqrt(1.0 - r * r)
    pval   = _t_pvalue(abs(t_stat), float(n - 2))
    return round(r, 4), round(pval, 6)


def _rmse_vaf(tps: list[dict]) -> float | None:
    """RMSE entre vaf_panther e vaf_ion nos TPs; retorna None se < 2 pontos."""
    pares = [(v["vaf_panther"], v["vaf_ion"]) for v in tps
             if v.get("vaf_panther") is not None and v.get("vaf_ion") is not None]
    if len(pares) < 2:
        return None
    mse = sum((pf - ir) ** 2 for pf, ir in pares) / len(pares)
    return round(math.sqrt(mse), 4)


# ─── Helpers de tipo de variante ─────────────────────────────────────────────

# ─── Tabelas de classificação para varredura de arquivos ─────────────────────

# UUID v4 no início do nome do arquivo VCF gerado pela pipeline
_UUID_RE = re.compile(
    r'^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})_(.+)$',
    re.IGNORECASE,
)

# Mapeamento sufixo → nome canônico do caller
# Ordem importa: mais específico primeiro (consensus antes de qualquer outro)
_CALLER_SUFIXOS: list[tuple[re.Pattern, str]] = [
    (re.compile(r'consensus',  re.I), 'Consensus'),
    (re.compile(r'mutect',     re.I), 'Mutect2'),
    (re.compile(r'varscan',    re.I), 'VarScan2'),
    (re.compile(r'lofreq',     re.I), 'LoFreq'),
]

# Mapeamento sufixo do stem TSV → (tipo legível, string a remover do stem)
# Ordem importa: _filtered antes de _ion/_raw para não fazer match parcial
_TSV_PADROES: list[tuple[re.Pattern, str, str]] = [
    (re.compile(r'_filtered$', re.I), 'Filtrado', '_filtered'),
    (re.compile(r'_raw$',      re.I), 'Bruto',    '_raw'),
    (re.compile(r'_ion$',      re.I), 'Bruto',    '_ion'),
]

_ION_TIPO_MAP: dict[str, str] = {
    "SNP": "SNV", "SNV": "SNV", "MNP": "SNV",
    "INS": "INDEL", "DEL": "INDEL", "COMPLEX": "INDEL", "INDEL": "INDEL",
}


def _tipo_variante_ion(tipo_raw: str) -> str:
    return _ION_TIPO_MAP.get(tipo_raw.strip().upper(), tipo_raw.strip() or "—")


def _tipo_variante_vcf(ref: str, alt: str) -> str:
    return "SNV" if len(ref) == 1 and len(alt) == 1 else "INDEL"


def _normalizar_variante(pos: int, ref: str, alt: str) -> tuple[int, str, str]:
    """Normalização canônica de variantes (trim sem FASTA, equivalente ao bcftools norm).

    1. Corta sufixo comum (direita → esquerda)
    2. Corta prefixo comum (esquerda → direita), avançando POS

    Garante representação mínima idêntica independente de como cada caller
    escreveu a mesma deleção/inserção, sem exigir o FASTA de referência.
    """
    ref, alt = ref.upper(), alt.upper()
    while len(ref) > 1 and len(alt) > 1 and ref[-1] == alt[-1]:
        ref, alt = ref[:-1], alt[:-1]
    while len(ref) > 1 and len(alt) > 1 and ref[0] == alt[0]:
        ref, alt, pos = ref[1:], alt[1:], pos + 1
    return pos, ref, alt


# ─── Parser VCF estendido com efeito e impacto do SnpEff ─────────────────────

def _parse_vcf_benchmarking(vcf_path: Path):
    """Idêntico a _parse_vcf_concordancia, mas extrai efeito e impacto do ANN."""
    import pandas as pd

    _ANN_RE = re.compile(r'ANN=([^;]+)')
    registros: list[dict] = []

    with open(vcf_path, "r", encoding="utf-8", errors="replace") as fh:
        for linha in fh:
            linha = linha.rstrip("\r\n")
            if linha.startswith("#") or not linha:
                continue
            cols = linha.split("\t")
            if len(cols) < 8:
                continue
            chrom, pos_str, ref, alt = cols[0], cols[1], cols[3], cols[4]
            try:
                pos = int(pos_str)
            except ValueError:
                continue

            vaf: float | None = None
            if len(cols) >= 10:
                fmt = dict(zip(cols[8].split(":"), cols[9].split(":")))
                for raw_key, divisor in [("AF", 1.0), ("FREQ", 100.0)]:
                    raw = fmt.get(raw_key, "").replace("%", "").split(",")[0]
                    if raw:
                        try:
                            vaf = float(raw) / divisor
                            break
                        except ValueError:
                            pass

            gene, efeito, impacto, hgvs_p = "—", "—", "—", "—"
            m = _ANN_RE.search(cols[7])
            if m:
                ann = m.group(1).split(",")[0].split("|")
                efeito  = ann[1]  if len(ann) > 1  and ann[1]  else "—"
                impacto = ann[2]  if len(ann) > 2  and ann[2]  else "—"
                gene    = ann[3]  if len(ann) > 3  and ann[3]  else "—"
                hgvs_p  = ann[10] if len(ann) > 10 and ann[10] else "—"

            chrom_n = _normalizar_chrom(chrom)
            pos_n, ref_n, alt_n = _normalizar_variante(pos, ref, alt)
            registros.append({
                "chrom": chrom_n, "pos": pos_n,
                "ref": ref_n, "alt": alt_n,
                "vaf": vaf, "gene": gene,
                "efeito": efeito, "impacto": impacto,
                "hgvs_p": hgvs_p,
                "tipo_vcf": _tipo_variante_vcf(ref_n, alt_n),
                "chave": f"{chrom_n}:{pos_n}:{ref_n}:{alt_n}",
            })

    return (
        pd.DataFrame(registros) if registros
        else pd.DataFrame(columns=[
            "chrom", "pos", "ref", "alt", "vaf", "gene",
            "efeito", "impacto", "hgvs_p", "tipo_vcf", "chave",
        ])
    )


# ─── Função pura de comparação por amostra ───────────────────────────────────

def _comparar_amostra(
    nome: str,
    tsv_path: Path,
    vcf_uuid: str,
    run_rotulo: str,
    min_dp: int,
    min_vaf: float,
) -> dict:
    """Compara Ion TSV vs PantherFlow VCF para uma única amostra.

    Retorna dict com métricas + listas _tps/_fps/_fns enriquecidas com
    tipo_variante e efeito_funcional. Zero arquivos intermediários —
    todos os dados trafegam exclusivamente em memória.
    """
    import pandas as pd

    vcf_path = AUDITORIA_DIR / f"{vcf_uuid}_mutect_hf.vcf"
    if not vcf_path.exists():
        raise FileNotFoundError(f"VCF não encontrado: {vcf_path}")

    # ── Ler e parsear TSV Ion ─────────────────────────────────────────────
    with open(tsv_path, "rb") as fh:
        df_ion_raw = _parse_ion_reporter_tsv(fh.read())

    cols = list(df_ion_raw.columns)
    col_locus     = _resolver_coluna(cols, ["locus", "Locus", "LOCUS", "# locus"])
    if col_locus is None:
        raise ValueError(f"[{nome}] Coluna 'Locus' não encontrada no TSV.")

    col_ref        = _resolver_coluna(cols, _ION_REF_COLS)
    col_alt        = _resolver_coluna(cols, _ION_ALT_COLS)
    col_vaf        = _resolver_coluna(cols, _ION_VAF_COLS)
    col_gene       = _resolver_coluna(cols, _ION_GENE_COLS)
    col_tipo       = _resolver_coluna(cols, ["Type", "type", "TYPE", "Variant Type"])
    col_efeito_ion = _resolver_coluna(cols, ["Variant Effect", "variant_effect", "Effect"])

    # ── Liftover hg19 → hg38 ─────────────────────────────────────────────
    lo = _get_lifter()
    registros_ion: list[dict] = []
    falhas_liftover = 0

    for _, row in df_ion_raw.iterrows():
        locus_str = str(row[col_locus]).strip()
        partes = locus_str.split(":", 1)
        if len(partes) != 2:
            falhas_liftover += 1
            continue
        chrom_raw = _normalizar_chrom(partes[0])
        try:
            pos_hg19 = int(partes[1].strip().replace(",", ""))
        except ValueError:
            falhas_liftover += 1
            continue

        resultado = lo.convert_coordinate(chrom_raw, pos_hg19 - 1)
        if not resultado:
            falhas_liftover += 1
            continue

        chrom_hg38 = _normalizar_chrom(resultado[0][0])
        pos_hg38   = resultado[0][1] + 1

        ref_raw        = str(row[col_ref]).strip().upper()       if col_ref        else "—"
        alt_raw        = str(row[col_alt]).strip().upper()       if col_alt        else "—"
        gene_raw       = str(row[col_gene]).strip()              if col_gene       else "—"
        tipo_raw       = str(row[col_tipo]).strip()              if col_tipo       else ""
        efeito_ion_raw = str(row[col_efeito_ion]).strip()        if col_efeito_ion else "—"

        vaf: float | None = None
        if col_vaf:
            vaf_raw = str(row[col_vaf]).strip().replace("%", "")
            if vaf_raw:
                try:
                    vaf = float(vaf_raw)
                    if vaf > 1.0:
                        vaf /= 100.0
                except ValueError:
                    pass

        if not ref_raw or ref_raw == "—" or not alt_raw or alt_raw == "—":
            falhas_liftover += 1
            continue

        if not _em_painel(chrom_hg38, pos_hg38):
            falhas_liftover += 1
            continue

        pos_n, ref_n, alt_n = _normalizar_variante(pos_hg38, ref_raw, alt_raw)
        registros_ion.append({
            "chrom": chrom_hg38, "pos": pos_n,
            "ref": ref_n, "alt": alt_n,
            "vaf": vaf, "gene": gene_raw,
            "tipo_variante":  _tipo_variante_ion(tipo_raw) if tipo_raw else "—",
            "efeito_ion":     efeito_ion_raw,
            "chave": f"{chrom_hg38}:{pos_n}:{ref_n}:{alt_n}",
        })

    if not registros_ion:
        raise ValueError(f"[{nome}] Todas as variantes Ion fora do painel Twist — nenhuma variante comparável.")

    df_ion = (
        pd.DataFrame(registros_ion)
        .drop_duplicates(subset="chave", keep="last")
    )

    # ── Ler VCF PantherFlow (parser estendido) ────────────────────────────
    df_vcf = _parse_vcf_benchmarking(vcf_path).drop_duplicates(subset="chave", keep="last")

    # ── Interseção por CHR:POS ─────────────────────────────────────────────
    set_ion = set(df_ion["chave"])
    set_vcf = set(df_vcf["chave"]) if not df_vcf.empty else set()

    chaves_tp = set_ion & set_vcf
    chaves_fp = set_vcf - set_ion   # exclusivos PantherFlow
    chaves_fn = set_ion - set_vcf   # exclusivos Ion

    ion_idx = df_ion.set_index("chave", drop=False)
    vcf_idx = df_vcf.set_index("chave", drop=False) if not df_vcf.empty else None

    # ── Montar listas de variantes ─────────────────────────────────────────
    tps_list: list[dict] = []
    for chave in sorted(chaves_tp):
        r_ion = ion_idx.loc[chave]
        r_vcf = vcf_idx.loc[chave] if vcf_idx is not None else None
        vaf_ir = _safe_vaf(r_ion["vaf"])
        vaf_pf = _safe_vaf(r_vcf["vaf"]) if r_vcf is not None else None
        gene = (
            str(r_vcf["gene"])
            if r_vcf is not None and str(r_vcf["gene"]) not in ("—", "", "nan")
            else str(r_ion["gene"])
        )
        tps_list.append({
            "chave": chave, "gene": gene,
            "amostra": nome, "run": run_rotulo, "locus": chave,
            "tipo_variante":   str(r_ion.get("tipo_variante", "—")),
            "efeito_funcional": str(r_vcf["efeito"])  if r_vcf is not None else "—",
            "impacto":          str(r_vcf["impacto"]) if r_vcf is not None else "—",
            "vaf_ion":     round(vaf_ir, 4) if vaf_ir is not None else None,
            "vaf_panther": round(vaf_pf, 4) if vaf_pf is not None else None,
        })

    fps_list: list[dict] = []
    if vcf_idx is not None:
        for chave in sorted(chaves_fp):
            r = vcf_idx.loc[chave]
            vaf_val = _safe_vaf(r["vaf"])
            fps_list.append({
                "chave": chave, "gene": str(r["gene"]),
                "amostra": nome, "run": run_rotulo, "locus": chave,
                "origem": "pantherflow",
                "tipo_variante":    str(r.get("tipo_vcf", "—")),
                "efeito_funcional": str(r["efeito"]),
                "impacto":          str(r["impacto"]),
                "vaf_panther": round(vaf_val, 4) if vaf_val is not None else None,
                "vaf_ion": None,
            })

    fns_list: list[dict] = []
    for chave in sorted(chaves_fn):
        r = ion_idx.loc[chave]
        vaf_val = _safe_vaf(r["vaf"])
        fns_list.append({
            "chave": chave, "gene": str(r["gene"]),
            "amostra": nome, "run": run_rotulo, "locus": chave,
            "origem": "ion_reporter",
            "tipo_variante":    str(r.get("tipo_variante", "—")),
            "efeito_funcional": str(r.get("efeito_ion", "—")),
            "impacto": "—",
            "vaf_ion":     round(vaf_val, 4) if vaf_val is not None else None,
            "vaf_panther": None,
        })

    # ── Métricas por amostra ──────────────────────────────────────────────
    n_tp, n_fp, n_fn = len(chaves_tp), len(chaves_fp), len(chaves_fn)
    sens    = n_tp / (n_tp + n_fn) if (n_tp + n_fn) > 0 else 0.0
    prec    = n_tp / (n_tp + n_fp) if (n_tp + n_fp) > 0 else 0.0
    f1      = 2 * sens * prec / (sens + prec) if (sens + prec) > 0 else 0.0
    jaccard = n_tp / (n_tp + n_fp + n_fn) if (n_tp + n_fp + n_fn) > 0 else 0.0

    vafs_tp = [v["vaf_ion"] for v in tps_list if v["vaf_ion"] is not None]
    vaf_medio_tp = round(sum(vafs_tp) / len(vafs_tp), 4) if vafs_tp else None

    return {
        "nome": nome, "run": run_rotulo, "vcf_uuid": vcf_uuid,
        "tp": n_tp, "fp": n_fp, "fn": n_fn,
        "sensibilidade":  round(sens,    4),
        "precisao":       round(prec,    4),
        "f1_score":       round(f1,      4),
        "jaccard":        round(jaccard, 4),
        "vaf_medio_tp":   vaf_medio_tp,
        "falhas_liftover": falhas_liftover,
        "min_dp":          min_dp,
        "min_vaf":         min_vaf,
        "_tps": tps_list,
        "_fps": fps_list,
        "_fns": fns_list,
    }


# ─── Agregação de resultados de benchmarking (helper partilhado) ─────────────

def _agregar_resultados(resultados: list[dict], run_rotulo: str) -> dict:
    """Agrega uma lista de resultados de _comparar_amostra em métricas globais.

    Retorna o dict completo pronto para ser devolvido como resposta JSON,
    incluindo métricas agregadas, scatter, Venn, distribuição de VAF e
    detalhamento das discordâncias.
    """
    todos_tps = [v for r in resultados for v in r["_tps"]]
    todos_fps = [v for r in resultados for v in r["_fps"]]
    todos_fns = [v for r in resultados for v in r["_fns"]]

    n_tp_ag = sum(r["tp"] for r in resultados)
    n_fp_ag = sum(r["fp"] for r in resultados)
    n_fn_ag = sum(r["fn"] for r in resultados)

    sens_ag = n_tp_ag / (n_tp_ag + n_fn_ag) if (n_tp_ag + n_fn_ag) > 0 else 0.0
    prec_ag = n_tp_ag / (n_tp_ag + n_fp_ag) if (n_tp_ag + n_fp_ag) > 0 else 0.0
    f1_ag   = 2 * sens_ag * prec_ag / (sens_ag + prec_ag) if (sens_ag + prec_ag) > 0 else 0.0
    jacc_ag = n_tp_ag / (n_tp_ag + n_fp_ag + n_fn_ag) if (n_tp_ag + n_fp_ag + n_fn_ag) > 0 else 0.0

    xs_scat = [v["vaf_ion"]     for v in todos_tps if v["vaf_ion"] is not None and v["vaf_panther"] is not None]
    ys_scat = [v["vaf_panther"] for v in todos_tps if v["vaf_ion"] is not None and v["vaf_panther"] is not None]
    rho, pval = _spearman_com_pvalue(xs_scat, ys_scat)

    scatter_pontos = [
        {
            "vaf_ion":     v["vaf_ion"],
            "vaf_panther": v["vaf_panther"],
            "gene":        v["gene"],
            "locus":       v["locus"],
            "amostra":     v["amostra"],
        }
        for v in todos_tps
        if v["vaf_ion"] is not None and v["vaf_panther"] is not None
    ]

    FAIXAS = ["< 5%", "5 – 15%", "15 – 30%", "> 30%"]
    contagens: dict[str, dict[str, int]] = {f: {"fp": 0, "fn": 0} for f in FAIXAS}
    for v in todos_fps:
        vaf = v.get("vaf_panther")
        if vaf is not None:
            contagens[_faixa_vaf(vaf)]["fp"] += 1
    for v in todos_fns:
        vaf = v.get("vaf_ion")
        if vaf is not None:
            contagens[_faixa_vaf(vaf)]["fn"] += 1

    detalhamento: list[dict] = []
    for v in todos_fps:
        detalhamento.append({
            "amostra":          v["amostra"],
            "run":              v["run"],
            "locus":            v["locus"],
            "gene":             v["gene"],
            "tipo_variante":    v["tipo_variante"],
            "efeito_funcional": v["efeito_funcional"],
            "impacto":          v["impacto"],
            "status":           "FP",
            "vaf_panther":      v["vaf_panther"],
            "vaf_ion":          None,
        })
    for v in todos_fns:
        detalhamento.append({
            "amostra":          v["amostra"],
            "run":              v["run"],
            "locus":            v["locus"],
            "gene":             v["gene"],
            "tipo_variante":    v["tipo_variante"],
            "efeito_funcional": v["efeito_funcional"],
            "impacto":          v["impacto"],
            "status":           "FN",
            "vaf_panther":      None,
            "vaf_ion":          v["vaf_ion"],
        })
    detalhamento.sort(key=lambda d: (
        0 if d["status"] == "FP" else 1,
        -(d["vaf_panther"] or d["vaf_ion"] or 0),
    ))

    por_amostra_clean = [
        {k: v for k, v in r.items() if not k.startswith("_")}
        for r in resultados
    ]

    logger.info(
        "[benchmarking] run=%s amostras=%d TP=%d FP=%d FN=%d "
        "F1=%.3f Jaccard=%.3f Spearman_rho=%s p=%s",
        run_rotulo, len(resultados),
        n_tp_ag, n_fp_ag, n_fn_ag,
        f1_ag, jacc_ag, rho, pval,
    )

    return {
        "run_rotulo":           run_rotulo,
        "amostras_processadas": [r["nome"] for r in resultados],
        "por_amostra":          por_amostra_clean,
        "agregado": {
            "tp":              n_tp_ag,
            "fp":              n_fp_ag,
            "fn":              n_fn_ag,
            "sensibilidade":   round(sens_ag, 4),
            "precisao":        round(prec_ag, 4),
            "f1_score":        round(f1_ag,   4),
            "jaccard":         round(jacc_ag, 4),
            "spearman_rho":    rho,
            "spearman_pvalue": pval,
            "spearman_n":      len(xs_scat),
        },
        "venn_data":   {"tp": n_tp_ag, "fp": n_fp_ag, "fn": n_fn_ag},
        "scatter_data": {
            "pontos":          scatter_pontos,
            "spearman_rho":    rho,
            "spearman_pvalue": pval,
            "n":               len(scatter_pontos),
        },
        "discordantes_vaf": [
            {"faixa": f, "fp": contagens[f]["fp"], "fn": contagens[f]["fn"]}
            for f in FAIXAS
        ],
        "detalhamento_discordantes": detalhamento,
    }


# ─── Endpoint: benchmarking por amostra ──────────────────────────────────────

class BenchmarkingPorAmostraParams(BaseModel):
    amostras: list[str] = Field(
        ...,
        description="Nomes das amostras do manifesto (ex: ['Pul008', 'Pul087'])",
    )
    run_rotulo: str = Field(
        default="DP20_VAF5",
        description="Rótulo do run a usar para cada amostra (ex: 'DP20_VAF5')",
    )


@app.post("/api/v1/benchmarking/por_amostra")
def benchmarking_por_amostra(params: BenchmarkingPorAmostraParams):
    """Compara PantherFlow vs Ion Reporter para um conjunto de amostras reais.

    Fluxo por amostra:
      1. Localiza TSV Ion e VCF PantherFlow via manifesto_benchmarking.json
      2. Aplica liftover hg19→hg38 (pyliftover)
      3. Cruza variantes por CHR:POS; classifica TP / FP / FN
      4. Extrai tipo_variante (SNV/INDEL) e efeito_funcional (SnpEff ANN)

    Retorna métricas por amostra + dados agregados para todos os gráficos do TCC.
    Nenhum arquivo intermediário é gerado — tráfego exclusivo em memória/JSON.
    """
    if not params.amostras:
        raise HTTPException(status_code=400, detail="Lista 'amostras' não pode ser vazia.")

    manifesto  = _carregar_manifesto()
    amostras_map = manifesto.get("amostras", {})
    BASE_DIR   = Path(__file__).parent.parent

    resultados: list[dict] = []
    erros: list[str]       = []

    for nome in params.amostras:
        if nome not in amostras_map:
            erros.append(f"{nome}: não encontrada no manifesto.")
            continue

        dados    = amostras_map[nome]
        tsv_path = BASE_DIR / dados["tsv_ion"]

        # Localiza o run solicitado; fallback para o primeiro disponível
        run_entry = next(
            (r for r in dados.get("runs", []) if r["rotulo"] == params.run_rotulo),
            None,
        )
        if run_entry is None:
            run_entry = next(
                (r for r in dados.get("runs", [])
                 if (AUDITORIA_DIR / f"{r['vcf_uuid']}_mutect_hf.vcf").exists()),
                None,
            )
            if run_entry is None:
                erros.append(f"{nome}: nenhum VCF disponível para o run '{params.run_rotulo}'.")
                continue
            logger.warning(
                "[benchmarking] %s: run '%s' não encontrado, usando fallback '%s'.",
                nome, params.run_rotulo, run_entry["rotulo"],
            )

        try:
            res = _comparar_amostra(
                nome=nome,
                tsv_path=tsv_path,
                vcf_uuid=run_entry["vcf_uuid"],
                run_rotulo=run_entry["rotulo"],
                min_dp=run_entry["min_dp"],
                min_vaf=run_entry["min_vaf"],
            )
            resultados.append(res)
        except Exception as exc:
            logger.error("[benchmarking] Erro ao processar %s: %s", nome, exc)
            erros.append(f"{nome}: {exc}")

    if not resultados:
        raise HTTPException(status_code=422, detail={"erros": erros})

    payload = _agregar_resultados(resultados, params.run_rotulo)
    payload["erros"] = erros
    return payload


# ─── Tabela combinatória de estratégias de variant calling ───────────────────

def _calcular_combinatoria_amostra(
    amostra: str,
    set_ion: set,
    vcfs_dict: dict,   # caller_label -> set[chave]
) -> list[dict]:
    """Calcula performance de todas as estratégias (single, interseção, união)
    para uma amostra, contra o padrão-ouro Ion TSV.

    Retorna lista de dicts com: amostra, estrategia, calls, valid, ppv, sensitivity.
    """
    n_ion = len(set_ion)

    def _metricas(s: set, label: str) -> dict:
        calls = len(s)
        valid = len(s & set_ion)
        ppv   = round(valid / calls, 4) if calls > 0 else None
        sens  = round(valid / n_ion, 4) if n_ion > 0 else None
        return {
            "amostra":     amostra,
            "estrategia":  label,
            "calls":       calls,
            "valid":       valid,
            "ppv":         ppv,
            "sensitivity": sens,
        }

    callers = list(vcfs_dict.keys())
    rows: list[dict] = []

    # Singles
    for c in callers:
        rows.append(_metricas(vcfs_dict[c], c))

    # Interseções duplas
    for i in range(len(callers)):
        for j in range(i + 1, len(callers)):
            ca, cb = callers[i], callers[j]
            label = f"{ca} ∩ {cb}"
            rows.append(_metricas(vcfs_dict[ca] & vcfs_dict[cb], label))

    # Interseção tripla (se ≥ 3 callers)
    if len(callers) >= 3:
        for i in range(len(callers)):
            for j in range(i + 1, len(callers)):
                for k in range(j + 1, len(callers)):
                    ca, cb, cc = callers[i], callers[j], callers[k]
                    label = f"{ca} ∩ {cb} ∩ {cc}"
                    rows.append(_metricas(vcfs_dict[ca] & vcfs_dict[cb] & vcfs_dict[cc], label))

    # Uniões duplas
    for i in range(len(callers)):
        for j in range(i + 1, len(callers)):
            ca, cb = callers[i], callers[j]
            label = f"{ca} ∪ {cb}"
            rows.append(_metricas(vcfs_dict[ca] | vcfs_dict[cb], label))

    # União total
    if len(callers) >= 3:
        union_total = set()
        for s in vcfs_dict.values():
            union_total |= s
        rows.append(_metricas(union_total, "União Total"))

    return rows


# ─── Heatmap de performance por estratégia ───────────────────────────────────

def _gerar_heatmap_estrategia(tabela_consenso: list[dict]) -> str | None:
    """Gera heatmap Estratégia × Métrica com seaborn e retorna PNG base64."""
    try:
        import io, base64
        import numpy as np
        import pandas as pd
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
        import seaborn as sns

        if not tabela_consenso:
            return None

        df = pd.DataFrame(tabela_consenso)

        # Agrega por estratégia (média entre amostras)
        agg = (
            df.groupby("estrategia", sort=False)[["ppv", "sensitivity"]]
            .mean()
            .reset_index()
        )

        # ── 1. Nomenclatura acadêmica ─────────────────────────────────────────
        # Mapeia nomes extensos → siglas com símbolos matemáticos de conjuntos
        _SIGLAS = {"Mutect2": "MT", "VarScan2": "VS", "LoFreq": "LF"}

        def _abreviar(s: str) -> str:
            if s in ("União Total", "Uniao Total"):
                return "MT ∪ VS ∪ LF"
            result = s
            for nome, sigla in _SIGLAS.items():
                result = result.replace(nome, sigla)
            return result.strip()

        agg["label"] = agg["estrategia"].apply(_abreviar)

        # ── 2. Ordenação lógica em 5 blocos ──────────────────────────────────
        _ORDER = [
            "MT", "VS", "LF",                                      # Singles
            "MT ∩ VS", "MT ∩ LF", "VS ∩ LF",       # Interseções pares
            "MT ∩ VS ∩ LF",                              # Interseção tripla
            "MT ∪ VS", "MT ∪ LF", "VS ∪ LF",       # Uniões pares
            "MT ∪ VS ∪ LF",                              # União tripla
        ]
        agg["_pos"] = agg["label"].apply(lambda x: _ORDER.index(x) if x in _ORDER else 999)
        agg = agg.sort_values("_pos").drop(columns="_pos").reset_index(drop=True)

        estrategia_labels = agg["label"].tolist()

        # ── 3. Normalização Min-Max por linha (row-wise) ──────────────────────
        # Cada métrica usa sua própria amplitude de cor para evitar que o 100%
        # da Precisão ofusque os valores mais baixos de Sensibilidade.
        # Os valores reais (%) ficam como anotação; a cor reflete variação relativa.
        matrix_raw = agg[["ppv", "sensitivity"]].values.T * 100  # shape (2, N)

        matrix_norm = np.zeros_like(matrix_raw, dtype=float)
        for i in range(matrix_raw.shape[0]):
            row = matrix_raw[i]
            rmin, rmax = row.min(), row.max()
            if rmax - rmin > 1e-6:
                matrix_norm[i] = (row - rmin) / (rmax - rmin)
            else:
                matrix_norm[i] = 0.5  # linha uniforme → cor neutra

        # ── 4. Tipografia: rótulos com acentuação correta ─────────────────────
        metric_labels = ["Precisão (PPV)", "Sensibilidade"]

        n_cols = len(agg)
        fig_w = max(6.0, n_cols * 0.85 + 2.0)
        fig, ax = plt.subplots(figsize=(fig_w, 3.8))

        sns.heatmap(
            matrix_norm,               # dados normalizados por linha → escala de cor
            ax=ax,
            xticklabels=estrategia_labels,
            yticklabels=metric_labels,
            annot=matrix_raw,          # valores reais (%) como anotação
            fmt=".1f",
            cmap="Blues",
            linewidths=0.5,
            linecolor="#e2e8f0",
            cbar_kws={"label": "intensidade relativa por métrica", "shrink": 0.5},
            annot_kws={"size": 9, "weight": "bold"},
            vmin=0, vmax=1,
        )

        ax.set_title("Performance por Estratégia de Variant Calling", fontsize=10, pad=46)
        ax.set_xlabel("")
        ax.set_ylabel("")
        ax.tick_params(axis="y", labelsize=9, rotation=0)
        ax.xaxis.tick_top()
        ax.xaxis.set_label_position("top")

        for tick in ax.get_xticklabels():
            tick.set_rotation(45)
            tick.set_ha("left")
            tick.set_fontsize(8)

        # Separadores verticais entre os 5 blocos lógicos
        def _bloco(s: str) -> int:
            if "∩" in s and s.count("∩") == 2: return 2  # interseção tripla
            if "∩" in s:                             return 1  # interseção par
            if "∪" in s and s.count("∪") == 2: return 4  # união tripla
            if "∪" in s:                             return 3  # união par
            return 0                                                # single

        blocos = [_bloco(s) for s in estrategia_labels]
        for i in range(1, len(blocos)):
            if blocos[i] != blocos[i - 1]:
                ax.axvline(x=i, color="#334155", linewidth=1.2, linestyle="--")

        plt.tight_layout()

        buf = io.BytesIO()
        fig.savefig(buf, format="png", dpi=220, bbox_inches="tight")
        plt.close(fig)
        buf.seek(0)
        return base64.b64encode(buf.read()).decode("utf-8")

    except Exception as exc:
        logger.warning("[heatmap] falha ao gerar: %s", exc)
        return ""


# ─── Barras FP/FN por faixa de VAF (Figura 5) ───────────────────────────────

def _gerar_grafico_discordancias_vaf(discordantes_vaf: list) -> str:
    """Barras agrupadas FP/FN por faixa de VAF. Retorna PNG base64."""
    try:
        import io, base64
        import numpy as np
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt

        if not discordantes_vaf:
            return ""

        COLOR_FP = "#1f77b4"
        COLOR_FN = "#ff7f0e"

        faixas   = [d["faixa"]        for d in discordantes_vaf]
        fps      = [d.get("fp", 0)    for d in discordantes_vaf]
        fns      = [d.get("fn", 0)    for d in discordantes_vaf]
        total_fp = sum(fps)
        total_fn = sum(fns)
        y_max    = max(fns + fps, default=1)

        x     = np.arange(len(faixas))
        bar_w = 0.32

        fig, ax = plt.subplots(figsize=(7, 4.5))
        fig.patch.set_facecolor("white")

        bars_fp = ax.bar(x - bar_w / 2, fps, bar_w, color=COLOR_FP,
                         label=f"FP — Exclusivos PantherFlow (n={total_fp:,})")
        bars_fn = ax.bar(x + bar_w / 2, fns, bar_w, color=COLOR_FN,
                         label=f"FN — Exclusivos Ion Reporter (n={total_fn:,})")

        # ylim com espaço generoso para anotações acima das barras
        ylim_top = y_max * 1.22
        ax.set_ylim(0, ylim_top)

        offset      = y_max * 0.012
        inside_thr  = ylim_top * 0.88   # barras acima desse valor recebem rótulo interno

        for bar, color_out, color_in in [
            (bars_fp, "#1a5a8a", "white"),
            (bars_fn, "#8a4010", "white"),
        ]:
            for b in bar:
                h = b.get_height()
                if h == 0:
                    continue
                if h > inside_thr:
                    # Rótulo dentro da barra (evita clipping no topo)
                    ax.text(b.get_x() + b.get_width() / 2,
                            h - y_max * 0.045,
                            f"{int(h):,}", ha="center", va="top",
                            fontsize=8.5, color=color_in, fontweight="bold")
                else:
                    ax.text(b.get_x() + b.get_width() / 2, h + offset,
                            f"{int(h):,}", ha="center", va="bottom",
                            fontsize=8.5, color=color_out, fontweight="bold")

        ax.set_xticks(x)
        ax.set_xticklabels(faixas, fontsize=10.5)
        ax.set_xlabel("Faixa de VAF", fontsize=10, color="#334155", labelpad=8)
        ax.set_ylabel("Nº de variantes", fontsize=10, color="#334155", labelpad=8)
        ax.tick_params(labelsize=8.5, colors="#64748b", left=False, bottom=False)
        ax.spines["top"].set_visible(False)
        ax.spines["right"].set_visible(False)
        ax.spines["left"].set_color("#e2e8f0")
        ax.spines["bottom"].set_color("#e2e8f0")
        ax.grid(axis="y", linestyle="--", alpha=0.4, color="#cbd5e1")
        ax.set_axisbelow(True)
        ax.yaxis.set_major_formatter(plt.FuncFormatter(lambda v, _: f"{int(v):,}"))

        ax.legend(fontsize=8.5, loc="upper left", framealpha=0.95,
                  edgecolor="#e2e8f0", borderpad=0.8,
                  handlelength=1.2, handletextpad=0.5)

        fig.text(
            0.5, -0.03,
            "Nota: Falsos Negativos em VAF >30% representam majoritariamente\n"
            "variantes germinativas descartadas com sucesso pelo filtro do algoritmo.",
            ha="center", va="top", fontsize=8, color="#64748b", style="italic",
        )

        plt.tight_layout()
        buf = io.BytesIO()
        fig.savefig(buf, format="png", dpi=220, bbox_inches="tight")
        plt.close(fig)
        buf.seek(0)
        return base64.b64encode(buf.read()).decode("utf-8")

    except Exception as exc:
        logger.warning("[discordancias_vaf] falha ao gerar: %s", exc)
        return ""


# ─── Scatter VAF TPs (Figura 4) ──────────────────────────────────────────────

def _gerar_grafico_vaf_scatter(scatter_data: dict) -> str:
    """Scatter VAF Ion Reporter × VAF PantherFlow com estatísticas. PNG base64."""
    try:
        import io, base64, math
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt

        pontos = scatter_data.get("pontos", [])
        if not pontos:
            return ""

        rho  = scatter_data.get("spearman_rho")
        pval = scatter_data.get("spearman_pvalue")
        n    = len(pontos)

        xs = [p["vaf_ion"]     for p in pontos if p.get("vaf_ion")     is not None
                                               and p.get("vaf_panther") is not None]
        ys = [p["vaf_panther"] for p in pontos if p.get("vaf_ion")     is not None
                                               and p.get("vaf_panther") is not None]

        # Pearson r e RMSE calculados localmente
        pearson_r, rmse = None, None
        if len(xs) >= 2:
            xm, ym = sum(xs) / len(xs), sum(ys) / len(ys)
            num    = sum((a - xm) * (b - ym) for a, b in zip(xs, ys))
            den    = math.sqrt(sum((a - xm) ** 2 for a in xs) *
                               sum((b - ym) ** 2 for b in ys))
            if den > 0:
                pearson_r = num / den
            rmse = math.sqrt(sum((a - b) ** 2 for a, b in zip(xs, ys)) / len(xs))

        fig, ax = plt.subplots(figsize=(5.5, 5.5))
        fig.patch.set_facecolor("white")

        # Pontos
        ax.scatter(xs, ys, color="#1f77b4", alpha=0.65, s=22,
                   edgecolors="white", linewidths=0.4, zorder=3)

        # Linha y = x
        ax.plot([0, 1], [0, 1], linestyle="--", color="#94a3b8",
                linewidth=1.2, zorder=2, label="y = x (concordância perfeita)")

        # Estilo
        ax.set_xlim(-0.02, 1.05)
        ax.set_ylim(-0.02, 1.05)
        ax.set_xlabel("VAF Ion Reporter (%)", fontsize=10, color="#334155", labelpad=8)
        ax.set_ylabel("VAF PantherFlow (%)", fontsize=10, color="#334155", labelpad=8)
        ax.xaxis.set_major_formatter(plt.FuncFormatter(lambda v, _: f"{int(v*100)}%"))
        ax.yaxis.set_major_formatter(plt.FuncFormatter(lambda v, _: f"{int(v*100)}%"))
        ax.tick_params(labelsize=8.5, colors="#64748b", left=False, bottom=False)
        ax.spines["top"].set_visible(False)
        ax.spines["right"].set_visible(False)
        ax.spines["left"].set_color("#e2e8f0")
        ax.spines["bottom"].set_color("#e2e8f0")
        ax.grid(color="#e2e8f0", linewidth=0.8, zorder=1)
        ax.set_axisbelow(True)

        # Caixa de estatísticas
        p_str  = "p < 0.001" if (pval is not None and pval < 0.001) else (f"p = {pval:.3f}" if pval is not None else "—")
        rho_s  = f"{rho:.3f}"   if rho       is not None else "—"
        pr_s   = f"{pearson_r:.3f}" if pearson_r is not None else "—"
        rmse_s = f"{rmse:.4f}"  if rmse      is not None else "—"
        stats_txt = (
            f"ρ Spearman = {rho_s}\n"
            f"{p_str}\n"
            f"Pearson r  = {pr_s}\n"
            f"RMSE VAF   = {rmse_s}\n"
            f"n (TPs)    = {n}"
        )
        ax.text(0.04, 0.96, stats_txt, transform=ax.transAxes,
                verticalalignment="top", horizontalalignment="left",
                fontsize=8, fontfamily="monospace", color="#1e293b",
                bbox=dict(boxstyle="square,pad=0.6", facecolor="white",
                          edgecolor="#cbd5e1", alpha=0.95))

        plt.tight_layout()
        buf = io.BytesIO()
        fig.savefig(buf, format="png", dpi=220, bbox_inches="tight")
        plt.close(fig)
        buf.seek(0)
        return base64.b64encode(buf.read()).decode("utf-8")

    except Exception as exc:
        logger.warning("[vaf_scatter] falha ao gerar: %s", exc)
        return ""


# ─── Gráfico de sensibilidade paramétrica (Figura 6) ─────────────────────────

def _gerar_grafico_sensibilidade_parametrica(db) -> str:
    """Perfil paramétrico (line plot) VS | MT: eixo X = parâmetro, linhas = amostras."""
    try:
        import io, base64, re
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt

        AMOSTRAS = ["Pul008", "Pul063", "Pul087", "Pul143", "Pul172"]
        PARAMS   = ["20_02", "20_05", "30_02", "30_05"]
        P_LABELS = ["DP20·VAF2%", "DP20·VAF5%", "DP30·VAF2%", "DP30·VAF5%"]
        COLORS   = ["#2563eb", "#dc2626", "#16a34a", "#d97706", "#7c3aed"]

        analyses = db.query(models.Analysis).filter(
            models.Analysis.status == "completed"
        ).all()

        data: dict = {}
        for a in analyses:
            m = re.match(r"^(Pul\d+)_(\d+)_(\d+)$", a.patient_id or "")
            if not m:
                continue
            amostra, dp, vaf = m.group(1), m.group(2), m.group(3)
            if amostra not in AMOSTRAS:
                continue
            pk = f"{dp}_{vaf}"
            if pk not in PARAMS:
                continue
            if amostra not in data:
                data[amostra] = {}
            data[amostra][pk] = {
                "vs": a.variants_varscan or 0,
                "mt": a.variants_mutect or 0,
            }

        if not data:
            return ""

        x = list(range(len(PARAMS)))

        def _style(ax):
            ax.spines["top"].set_visible(False)
            ax.spines["right"].set_visible(False)
            ax.spines["left"].set_color("#e2e8f0")
            ax.spines["bottom"].set_color("#e2e8f0")
            ax.grid(axis="y", linestyle="--", alpha=0.4, color="#cbd5e1")
            ax.set_axisbelow(True)
            ax.tick_params(left=False, bottom=False)
            ax.tick_params(axis="y", labelsize=8, colors="#94a3b8")
            ax.tick_params(axis="x", labelsize=8.5, colors="#475569")
            ax.set_xticks(x)
            ax.set_xticklabels(P_LABELS)

        fig, (ax_vs, ax_mt) = plt.subplots(1, 2, figsize=(13, 5))
        fig.patch.set_facecolor("white")

        handles = []
        for j, amostra in enumerate(AMOSTRAS):
            color = COLORS[j]

            # ── VarScan2 ────────────────────────────────────────────────────
            vs_pts = [(x[i], data[amostra][pk]["vs"])
                      for i, pk in enumerate(PARAMS)
                      if amostra in data and pk in data[amostra]]
            if vs_pts:
                xi, yi = zip(*vs_pts)
                line, = ax_vs.plot(xi, yi, "o-", color=color, linewidth=2.2,
                                   markersize=7, markeredgecolor="white",
                                   markeredgewidth=1.0, label=amostra)
                handles.append(line)
                for xi_, yi_ in zip(xi, yi):
                    ax_vs.text(xi_, yi_ + max(yi_ * 0.03, 0.6), str(int(yi_)),
                               ha="center", va="bottom",
                               fontsize=7.5, color=color, fontweight="bold")

            # ── Mutect2 ──────────────────────────────────────────────────────
            mt_pts = [(x[i], data[amostra][pk]["mt"])
                      for i, pk in enumerate(PARAMS)
                      if amostra in data and pk in data[amostra]]
            if mt_pts:
                xi, yi = zip(*mt_pts)
                ax_mt.plot(xi, yi, "o-", color=color, linewidth=2.2,
                           markersize=7, markeredgecolor="white",
                           markeredgewidth=1.0, label=amostra)
                for xi_, yi_ in zip(xi, yi):
                    ax_mt.text(xi_, yi_ + max(yi_ * 0.03, 0.4), str(int(yi_)),
                               ha="center", va="bottom",
                               fontsize=7.5, color=color, fontweight="bold")

        _style(ax_vs)
        ax_vs.set_title("VarScan2", fontsize=11, pad=10,
                        color="#1e40af", fontweight="bold")
        ax_vs.set_ylabel("Variantes identificadas", fontsize=9, color="#475569")

        _style(ax_mt)
        ax_mt.set_title("Mutect2", fontsize=11, pad=10,
                        color="#15803d", fontweight="bold")

        fig.legend(
            handles=handles, ncol=len(AMOSTRAS), fontsize=9,
            loc="lower center", bbox_to_anchor=(0.5, -0.06),
            framealpha=0.97, edgecolor="#e2e8f0", borderpad=0.9,
            handlelength=1.8, handletextpad=0.5, columnspacing=1.2,
        )

        plt.tight_layout()
        buf = io.BytesIO()
        fig.savefig(buf, format="png", dpi=220, bbox_inches="tight")
        plt.close(fig)
        buf.seek(0)
        return base64.b64encode(buf.read()).decode("utf-8")

    except Exception as exc:
        logger.warning("[sensibilidade_parametrica] falha ao gerar: %s", exc)
        return ""


@app.get("/api/v1/benchmarking/sensibilidade-parametrica")
def benchmarking_sensibilidade_parametrica(db: Session = Depends(get_db)):
    """Gráfico matplotlib de barras agrupadas VS/MT × amostra × parâmetro."""
    return {"imagem": _gerar_grafico_sensibilidade_parametrica(db)}


# ─── Núcleo de comparação por caminhos diretos (stateless) ───────────────────

def _comparar_par(
    nome:     str,
    tsv_path: Path,
    vcf_path: Path,
    rotulo:   str,
    caller:   str = "Mutect2",
) -> dict:
    """Compara Ion TSV vs VCF PantherFlow usando caminhos de arquivo explícitos.

    Variante stateless de _comparar_amostra: recebe vcf_path diretamente,
    sem depender de UUID nem de resolução via AUDITORIA_DIR.
    Aceita qualquer caller (Mutect2, VarScan2, LoFreq, Consensus).
    Retorna o mesmo schema de _comparar_amostra, acrescido de 'caller',
    'spearman_rho' e 'spearman_pvalue' pré-calculados por par.
    """
    import pandas as pd

    if not vcf_path.exists():
        raise FileNotFoundError(f"VCF não encontrado: {vcf_path}")
    if not tsv_path.exists():
        raise FileNotFoundError(f"TSV não encontrado: {tsv_path}")

    # ── Ler e parsear TSV Ion ─────────────────────────────────────────────
    with open(tsv_path, "rb") as fh:
        df_ion_raw = _parse_ion_reporter_tsv(fh.read())

    cols = list(df_ion_raw.columns)
    col_locus     = _resolver_coluna(cols, ["locus", "Locus", "LOCUS", "# locus"])
    if col_locus is None:
        raise ValueError(f"[{nome}] Coluna 'Locus' não encontrada no TSV.")

    col_ref        = _resolver_coluna(cols, _ION_REF_COLS)
    col_alt        = _resolver_coluna(cols, _ION_ALT_COLS)
    col_vaf        = _resolver_coluna(cols, _ION_VAF_COLS)
    col_gene       = _resolver_coluna(cols, _ION_GENE_COLS)
    col_tipo       = _resolver_coluna(cols, ["Type", "type", "TYPE", "Variant Type"])
    col_efeito_ion = _resolver_coluna(cols, ["Variant Effect", "variant_effect", "Effect"])

    # ── Liftover hg19 → hg38 ─────────────────────────────────────────────
    lo = _get_lifter()
    registros_ion: list[dict] = []
    falhas_liftover = 0

    for _, row in df_ion_raw.iterrows():
        locus_str = str(row[col_locus]).strip()
        partes = locus_str.split(":", 1)
        if len(partes) != 2:
            falhas_liftover += 1
            continue
        chrom_raw = _normalizar_chrom(partes[0])
        try:
            pos_hg19 = int(partes[1].strip().replace(",", ""))
        except ValueError:
            falhas_liftover += 1
            continue

        resultado_lo = lo.convert_coordinate(chrom_raw, pos_hg19 - 1)
        if not resultado_lo:
            falhas_liftover += 1
            continue

        chrom_hg38 = _normalizar_chrom(resultado_lo[0][0])
        pos_hg38   = resultado_lo[0][1] + 1

        ref_raw        = str(row[col_ref]).strip().upper()       if col_ref        else "—"
        alt_raw        = str(row[col_alt]).strip().upper()       if col_alt        else "—"
        gene_raw       = str(row[col_gene]).strip()              if col_gene       else "—"
        tipo_raw       = str(row[col_tipo]).strip()              if col_tipo       else ""
        efeito_ion_raw = str(row[col_efeito_ion]).strip()        if col_efeito_ion else "—"

        vaf: float | None = None
        if col_vaf:
            vaf_raw = str(row[col_vaf]).strip().replace("%", "")
            if vaf_raw:
                try:
                    vaf = float(vaf_raw)
                    if vaf > 1.0:
                        vaf /= 100.0
                except ValueError:
                    pass

        if not ref_raw or ref_raw == "—" or not alt_raw or alt_raw == "—":
            falhas_liftover += 1
            continue

        # Filtra variantes fora do painel Twist — comparação só é válida dentro das
        # regiões-alvo para garantir que ausências no VCF sejam de verdade FN e não
        # simplesmente falta de cobertura off-panel.
        if not _em_painel(chrom_hg38, pos_hg38):
            falhas_liftover += 1
            continue

        pos_n, ref_n, alt_n = _normalizar_variante(pos_hg38, ref_raw, alt_raw)
        registros_ion.append({
            "chrom": chrom_hg38, "pos": pos_n,
            "ref": ref_n, "alt": alt_n,
            "vaf": vaf, "gene": gene_raw,
            "tipo_variante": _tipo_variante_ion(tipo_raw) if tipo_raw else "—",
            "efeito_ion":    efeito_ion_raw,
            "chave": f"{chrom_hg38}:{pos_n}:{ref_n}:{alt_n}",
        })

    if not registros_ion:
        raise ValueError(f"[{nome}] Todas as variantes Ion fora do painel Twist — nenhuma variante comparável.")

    df_ion = pd.DataFrame(registros_ion).drop_duplicates(subset="chave", keep="last")

    # ── Ler VCF PantherFlow ───────────────────────────────────────────────
    df_vcf = _parse_vcf_benchmarking(vcf_path).drop_duplicates(subset="chave", keep="last")

    # ── Interseção por CHR:POS ────────────────────────────────────────────
    set_ion = set(df_ion["chave"])
    set_vcf = set(df_vcf["chave"]) if not df_vcf.empty else set()

    chaves_tp = set_ion & set_vcf
    chaves_fp = set_vcf - set_ion
    chaves_fn = set_ion - set_vcf

    ion_idx = df_ion.set_index("chave", drop=False)
    vcf_idx = df_vcf.set_index("chave", drop=False) if not df_vcf.empty else None

    # ── Montar listas de variantes ────────────────────────────────────────
    tps_list: list[dict] = []
    for chave in sorted(chaves_tp):
        r_ion = ion_idx.loc[chave]
        r_vcf = vcf_idx.loc[chave] if vcf_idx is not None else None
        vaf_ir = _safe_vaf(r_ion["vaf"])
        vaf_pf = _safe_vaf(r_vcf["vaf"]) if r_vcf is not None else None
        gene = (
            str(r_vcf["gene"])
            if r_vcf is not None and str(r_vcf["gene"]) not in ("—", "", "nan")
            else str(r_ion["gene"])
        )
        tps_list.append({
            "chave": chave, "gene": gene,
            "amostra": nome, "run": rotulo, "locus": chave,
            "tipo_variante":    str(r_ion.get("tipo_variante", "—")),
            "efeito_funcional": str(r_vcf["efeito"])  if r_vcf is not None else "—",
            "impacto":          str(r_vcf["impacto"]) if r_vcf is not None else "—",
            "hgvs_p":           str(r_vcf["hgvs_p"]) if r_vcf is not None else "—",
            "vaf_ion":     round(vaf_ir, 4) if vaf_ir is not None else None,
            "vaf_panther": round(vaf_pf, 4) if vaf_pf is not None else None,
        })

    fps_list: list[dict] = []
    if vcf_idx is not None:
        for chave in sorted(chaves_fp):
            r = vcf_idx.loc[chave]
            vaf_val = _safe_vaf(r["vaf"])
            fps_list.append({
                "chave": chave, "gene": str(r["gene"]),
                "amostra": nome, "run": rotulo, "locus": chave,
                "origem": "pantherflow",
                "tipo_variante":    str(r.get("tipo_vcf", "—")),
                "efeito_funcional": str(r["efeito"]),
                "impacto":          str(r["impacto"]),
                "vaf_panther": round(vaf_val, 4) if vaf_val is not None else None,
                "vaf_ion": None,
            })

    fns_list: list[dict] = []
    for chave in sorted(chaves_fn):
        r = ion_idx.loc[chave]
        vaf_val = _safe_vaf(r["vaf"])
        fns_list.append({
            "chave": chave, "gene": str(r["gene"]),
            "amostra": nome, "run": rotulo, "locus": chave,
            "origem": "ion_reporter",
            "tipo_variante":    str(r.get("tipo_variante", "—")),
            "efeito_funcional": str(r.get("efeito_ion", "—")),
            "impacto": "—",
            "vaf_ion":     round(vaf_val, 4) if vaf_val is not None else None,
            "vaf_panther": None,
        })

    # ── Métricas por par ──────────────────────────────────────────────────
    n_tp, n_fp, n_fn = len(chaves_tp), len(chaves_fp), len(chaves_fn)
    sens    = n_tp / (n_tp + n_fn) if (n_tp + n_fn) > 0 else 0.0
    prec    = n_tp / (n_tp + n_fp) if (n_tp + n_fp) > 0 else 0.0
    f1      = 2 * sens * prec / (sens + prec) if (sens + prec) > 0 else 0.0
    jaccard = n_tp / (n_tp + n_fp + n_fn) if (n_tp + n_fp + n_fn) > 0 else 0.0

    vafs_tp = [v["vaf_ion"] for v in tps_list if v["vaf_ion"] is not None]
    vaf_medio_tp = round(sum(vafs_tp) / len(vafs_tp), 4) if vafs_tp else None

    xs = [v["vaf_ion"]     for v in tps_list if v["vaf_ion"] is not None and v["vaf_panther"] is not None]
    ys = [v["vaf_panther"] for v in tps_list if v["vaf_ion"] is not None and v["vaf_panther"] is not None]
    rho_par,  pval_spe = _spearman_com_pvalue(xs, ys)
    r_par,    pval_pea = _pearson_com_pvalue(xs, ys)
    rmse_par            = _rmse_vaf(tps_list)

    return {
        "nome":             nome,
        "caller":           caller,
        "run":              rotulo,
        "n_ion":            len(set_ion),
        "n_vcf":            len(set_vcf),
        "tp": n_tp, "fp": n_fp, "fn": n_fn,
        "sensibilidade":    round(sens,    4),
        "precisao":         round(prec,    4),
        "f1_score":         round(f1,      4),
        "jaccard":          round(jaccard, 4),
        "vaf_medio_tp":     vaf_medio_tp,
        "rmse_vaf":         rmse_par,
        "falhas_liftover":  falhas_liftover,
        "spearman_rho":     rho_par,
        "spearman_pvalue":  pval_spe,
        "pearson_r":        r_par,
        "pearson_pvalue":   pval_pea,
        "spearman_n":       len(xs),
        "_tps": tps_list,
        "_fps": fps_list,
        "_fns": fns_list,
    }


# ─── Endpoint: analisar lote dinâmico stateless ───────────────────────────────

class ParLote(BaseModel):
    amostra:   str
    vcf_path:  str   = Field(..., description="Caminho relativo ao raiz do projeto.")
    tsv_path:  str   = Field(..., description="Caminho relativo ao raiz do projeto.")
    caller:    str   = "Mutect2"
    tsv_tipo:  str   = "Bruto"
    parametro: str   = ""


class AnalisarLoteParams(BaseModel):
    pares: list[ParLote] = Field(
        ...,
        description="Array de pares VCF × TSV montado dinamicamente pelo frontend.",
    )


@app.post("/api/v1/benchmarking/analisar_lote")
def benchmarking_analisar_lote(params: AnalisarLoteParams):
    """Motor de processamento de lote stateless.

    Não lê manifesto, não resolve UUIDs, não consulta DB.
    Itera exclusivamente sobre os pares recebidos no payload, resolve
    os caminhos de arquivo fisicamente (relativos ao projeto) e delega
    cada comparação a _comparar_par.

    Payload esperado:
        {
          "pares": [
            {
              "amostra":   "Pul143",
              "vcf_path":  "backend/data/auditoria/uuid_mutect_hf.vcf",
              "tsv_path":  "backend/data/real_data/ion_torrent/Pul143_ion.tsv",
              "caller":    "Mutect2",
              "tsv_tipo":  "Bruto",
              "parametro": "DP20_VAF5"
            }
          ]
        }

    Retorna:
        metricas_por_par  — métricas detalhadas por combinação, incluindo
                            Spearman ρ e p-value por par.
        dados_graficos    — Venn e scatter por par + agregação global +
                            distribuição de discordâncias + detalhamento
                            molecular (Tabela 2 do TCC).
        (+ chaves backward-compat para o frontend atual)
    """
    if not params.pares:
        raise HTTPException(status_code=400, detail="Lista 'pares' não pode ser vazia.")

    # Raiz do projeto = um nível acima de backend/
    PROJECT_ROOT = Path(__file__).parent.parent

    resultados:  list[dict] = []
    erros:       list[str]  = []
    meta_pares:  list[dict] = []   # metadados de cada par para dados_graficos

    for par in params.pares:
        vcf_path = (PROJECT_ROOT / par.vcf_path).resolve()
        tsv_path = (PROJECT_ROOT / par.tsv_path).resolve()

        if not vcf_path.exists():
            erros.append(f"{par.amostra}/{par.caller}: VCF não encontrado — {par.vcf_path}")
            continue
        if not tsv_path.exists():
            erros.append(f"{par.amostra}: TSV não encontrado — {par.tsv_path}")
            continue

        # Rótulo: usa o fornecido ou infere do nome do arquivo VCF
        rotulo = par.parametro.strip()
        if not rotulo:
            m_uuid = _UUID_RE.match(vcf_path.stem)
            if m_uuid:
                rotulo = _decode_run_from_patient_id(m_uuid.group(1))["rotulo"]
            else:
                rotulo = "DP?"

        try:
            res = _comparar_par(
                nome=par.amostra,
                tsv_path=tsv_path,
                vcf_path=vcf_path,
                rotulo=rotulo,
                caller=par.caller,
            )
            for tp in res["_tps"]:
                tp["tsv_tipo"] = par.tsv_tipo
            resultados.append(res)
            meta_pares.append({
                "amostra":  par.amostra,
                "caller":   par.caller,
                "tsv_tipo": par.tsv_tipo,
                "parametro": rotulo,
            })
            logger.info(
                "[analisar_lote] %s/%s/%s → TP=%d FP=%d FN=%d F1=%.3f",
                par.amostra, par.caller, rotulo,
                res["tp"], res["fp"], res["fn"], res["f1_score"],
            )
        except Exception as exc:
            logger.error("[analisar_lote] Erro %s/%s: %s", par.amostra, par.caller, exc)
            erros.append(f"{par.amostra}/{par.caller}: {exc}")

    if not resultados:
        raise HTTPException(status_code=422, detail={"erros": erros})

    # ── Métricas por par (resposta nova) ─────────────────────────────────
    def _metricas_tipo(tps, fps, fns, tipo):
        tp = sum(1 for v in tps if v.get("tipo_vcf") == tipo)
        fp = sum(1 for v in fps if v.get("tipo_vcf") == tipo)
        fn = sum(1 for v in fns if v.get("tipo_vcf") == tipo)
        n_ion = tp + fn
        prec = round(tp / (tp + fp), 4) if (tp + fp) > 0 else None
        sens = round(tp / n_ion,      4) if n_ion       > 0 else None
        f1   = round(2 * tp / (2 * tp + fp + fn), 4) if (2 * tp + fp + fn) > 0 else None
        return {"tp": tp, "fp": fp, "fn": fn, "n_ion": n_ion,
                "precisao": prec, "sensibilidade": sens, "f1_score": f1}

    metricas_por_par = []
    for res, meta in zip(resultados, meta_pares):
        snv   = _metricas_tipo(res["_tps"], res["_fps"], res["_fns"], "SNV")
        indel = _metricas_tipo(res["_tps"], res["_fps"], res["_fns"], "INDEL")
        metricas_por_par.append({
            "amostra":         res["nome"],
            "caller":          res["caller"],
            "tsv_tipo":        meta["tsv_tipo"],
            "parametro":       res["run"],
            "tp":              res["tp"],
            "fp":              res["fp"],
            "fn":              res["fn"],
            "sensibilidade":   res["sensibilidade"],
            "precisao":        res["precisao"],
            "f1_score":        res["f1_score"],
            "jaccard":         res["jaccard"],
            "n_ion":           res["n_ion"],
            "n_vcf":           res["n_vcf"],
            "vaf_medio_tp":    res["vaf_medio_tp"],
            "rmse_vaf":        res["rmse_vaf"],
            "falhas_liftover": res["falhas_liftover"],
            "spearman_rho":    res["spearman_rho"],
            "spearman_pvalue": res["spearman_pvalue"],
            "pearson_r":       res["pearson_r"],
            "pearson_pvalue":  res["pearson_pvalue"],
            "spearman_n":      res["spearman_n"],
            # ── Split SNV / INDEL ─────────────────────────────────────────
            "snv_tp":          snv["tp"],   "snv_fp": snv["fp"],   "snv_fn": snv["fn"],
            "snv_n_ion":       snv["n_ion"],
            "snv_precisao":    snv["precisao"],
            "snv_sensibilidade": snv["sensibilidade"],
            "snv_f1":          snv["f1_score"],
            "indel_tp":        indel["tp"], "indel_fp": indel["fp"], "indel_fn": indel["fn"],
            "indel_n_ion":     indel["n_ion"],
            "indel_precisao":  indel["precisao"],
            "indel_sensibilidade": indel["sensibilidade"],
            "indel_f1":        indel["f1_score"],
        })

    # ── Dados gráficos por par ────────────────────────────────────────────
    venn_por_par = [
        {
            "amostra":   res["nome"],
            "caller":    res["caller"],
            "parametro": res["run"],
            "tp": res["tp"], "fp": res["fp"], "fn": res["fn"],
        }
        for res in resultados
    ]

    scatter_por_par = []
    for res in resultados:
        pontos_par = [
            {
                "vaf_ion":     v["vaf_ion"],
                "vaf_panther": v["vaf_panther"],
                "gene":        v["gene"],
                "locus":       v["locus"],
            }
            for v in res["_tps"]
            if v["vaf_ion"] is not None and v["vaf_panther"] is not None
        ]
        scatter_por_par.append({
            "amostra":         res["nome"],
            "caller":          res["caller"],
            "parametro":       res["run"],
            "pontos":          pontos_par,
            "spearman_rho":    res["spearman_rho"],
            "spearman_pvalue": res["spearman_pvalue"],
            "n":               len(pontos_par),
        })

    # ── Agregação global (backward-compat + scatter global) ───────────────
    compat = _agregar_resultados(resultados, resultados[0]["run"] if len(resultados) == 1 else "Lote Dinâmico")

    # ── Distribuição global de discordâncias por faixa de VAF ─────────────
    todos_tps = [v for r in resultados for v in r["_tps"]]
    todos_fps = [v for r in resultados for v in r["_fps"]]
    todos_fns = [v for r in resultados for v in r["_fns"]]
    FAIXAS    = ["< 5%", "5 – 15%", "15 – 30%", "> 30%"]
    contagens: dict[str, dict[str, int]] = {f: {"fp": 0, "fn": 0} for f in FAIXAS}
    for v in todos_fps:
        vaf = v.get("vaf_panther")
        if vaf is not None:
            contagens[_faixa_vaf(vaf)]["fp"] += 1
    for v in todos_fns:
        vaf = v.get("vaf_ion")
        if vaf is not None:
            contagens[_faixa_vaf(vaf)]["fn"] += 1

    # ── Tabela combinatória por amostra ──────────────────────────────────
    # Agrupa resultados por amostra; para cada amostra reconstrói set_ion
    # (TP∪FN, igual em todos os callers da mesma amostra) e set_vcf por caller.
    _grupos: dict[str, dict] = {}   # amostra -> {"set_ion": set, "vcfs": {caller: set}}
    for res in resultados:
        nome    = res["nome"]
        caller  = res["caller"]
        set_ion_r = (
            {v["chave"] for v in res["_tps"]} |
            {v["chave"] for v in res["_fns"]}
        )
        set_vcf_r = (
            {v["chave"] for v in res["_tps"]} |
            {v["chave"] for v in res["_fps"]}
        )
        if nome not in _grupos:
            _grupos[nome] = {"set_ion": set_ion_r, "vcfs": {}}
        else:
            _grupos[nome]["set_ion"] |= set_ion_r   # união defensiva (mesmo TSV)
        _grupos[nome]["vcfs"][caller] = set_vcf_r

    tabela_consenso: list[dict] = []
    for amostra, grupo in _grupos.items():
        if grupo["vcfs"]:
            tabela_consenso.extend(
                _calcular_combinatoria_amostra(amostra, grupo["set_ion"], grupo["vcfs"])
            )

    return {
        # ── Estrutura nova ────────────────────────────────────────────────
        "pares_processados": len(resultados),
        "erros":             erros,
        "metricas_por_par":  metricas_por_par,
        "tabela_consenso":   tabela_consenso,
        "heatmap_estrategia": _gerar_heatmap_estrategia(tabela_consenso),
        "dados_graficos": {
            "venn_por_par":    venn_por_par,
            "venn_global":     compat["venn_data"],
            "scatter_por_par": scatter_por_par,
            "scatter_global":  compat["scatter_data"],
            "imagem_scatter":  _gerar_grafico_vaf_scatter(compat["scatter_data"]),
            "discordantes_vaf": [
                {"faixa": f, "fp": contagens[f]["fp"], "fn": contagens[f]["fn"]}
                for f in FAIXAS
            ],
            "imagem_discordancias": _gerar_grafico_discordancias_vaf([
                {"faixa": f, "fp": contagens[f]["fp"], "fn": contagens[f]["fn"]}
                for f in FAIXAS
            ]),
            "detalhamento_discordantes":  compat["detalhamento_discordantes"],
            "detalhamento_concordantes": sorted(
                todos_tps,
                key=lambda v: (v.get("amostra",""), v.get("locus","")),
            ),
        },
        # ── Backward-compat para o frontend atual (removido na Fase 3) ────
        "run_rotulo":               compat["run_rotulo"],
        "amostras_processadas":     compat["amostras_processadas"],
        "por_amostra":              compat["por_amostra"],
        "agregado":                 compat["agregado"],
        "venn_data":                compat["venn_data"],
        "scatter_data":             compat["scatter_data"],
        "discordantes_vaf":         compat["discordantes_vaf"],
        "detalhamento_discordantes": compat["detalhamento_discordantes"],
    }


_BENCHMARKING_CSV = Path(__file__).parent / "data" / "mock_benchmarking_data.csv"

# Cache em memória — o CSV é lido uma única vez no primeiro pedido
_benchmarking_df: object = None   # tipo real: pd.DataFrame


def _carregar_benchmarking_df():
    """Carrega o CSV consolidado na primeira chamada e guarda em memória."""
    global _benchmarking_df
    if _benchmarking_df is None:
        try:
            import pandas as pd
            _benchmarking_df = pd.read_csv(_BENCHMARKING_CSV, dtype={"Status": str})
            logger.info("[benchmarking] CSV carregado: %d linhas.", len(_benchmarking_df))
        except FileNotFoundError:
            raise HTTPException(
                status_code=503,
                detail=f"Ficheiro de dados não encontrado: {_BENCHMARKING_CSV}. "
                       "Execute: python generate_mock_data.py"
            )
    return _benchmarking_df


class BenchmarkingParams(BaseModel):
    min_vaf: float = Field(default=0.05, ge=0.0, le=1.0,
                           description="Limiar mínimo de Frequência Alélica (0–1)")
    min_dp:  int   = Field(default=20,   ge=0,
                           description="Profundidade mínima de leitura")


def _faixa_vaf(vaf: float) -> str:
    """Agrupa um VAF numa das 4 faixas clínicas standard."""
    if vaf < 0.05:  return "< 5%"
    if vaf < 0.15:  return "5 – 15%"
    if vaf < 0.30:  return "15 – 30%"
    return "> 30%"


def _spearman(xs: list[float], ys: list[float]) -> float | None:
    """Coeficiente de Spearman implementado em Python puro (sem scipy)."""
    n = len(xs)
    if n < 3:
        return None
    def rank(arr):
        indexed = sorted(enumerate(arr), key=lambda t: t[1])
        r = [0.0] * n
        for k, (i, _) in enumerate(indexed):
            r[i] = k + 1
        return r
    rx, ry = rank(xs), rank(ys)
    d2 = sum((rx[i] - ry[i]) ** 2 for i in range(n))
    return 1.0 - (6.0 * d2) / (n * (n * n - 1))


@app.post("/api/v1/benchmarking/analyze")
def benchmarking_analyze(params: BenchmarkingParams):
    """Filtra o dataset consolidado e devolve métricas + dados para os gráficos.

    Filtros aplicados por Status:
      TP → VAF_Panther >= min_vaf  AND  DP_Panther >= min_dp
      FP → VAF_Panther >= min_vaf  AND  DP_Panther >= min_dp
      FN → VAF_Ion     >= min_vaf  AND  DP_Ion     >= min_dp

    Resposta:
      metricas          — TP/FP/FN, Sensibilidade, Precisão, F1, Jaccard
      venn_data         — mesmos números para o diagrama de Venn
      scatter_data      — pontos VAF_Panther × VAF_Ion dos TPs (com Spearman ρ)
      discordantes_vaf  — FPs e FNs agrupados por faixa de VAF (gráfico de barras)
    """
    import pandas as pd

    df = _carregar_benchmarking_df().copy()

    min_vaf = params.min_vaf
    min_dp  = params.min_dp

    # ── Aplicar filtros por Status ────────────────────────────────────────
    mask_tp = (
        (df["Status"] == "TP") &
        (df["VAF_Panther"].fillna(0) >= min_vaf) &
        (df["DP_Panther"].fillna(0)  >= min_dp)
    )
    mask_fp = (
        (df["Status"] == "FP") &
        (df["VAF_Panther"].fillna(0) >= min_vaf) &
        (df["DP_Panther"].fillna(0)  >= min_dp)
    )
    mask_fn = (
        (df["Status"] == "FN") &
        (df["VAF_Ion"].fillna(0) >= min_vaf) &
        (df["DP_Ion"].fillna(0)  >= min_dp)
    )

    df_tp = df[mask_tp]
    df_fp = df[mask_fp]
    df_fn = df[mask_fn]

    n_tp = len(df_tp)
    n_fp = len(df_fp)
    n_fn = len(df_fn)

    # ── Métricas de validação ────────────────────────────────────────────
    sensibilidade = n_tp / (n_tp + n_fn) if (n_tp + n_fn) > 0 else 0.0
    precisao      = n_tp / (n_tp + n_fp) if (n_tp + n_fp) > 0 else 0.0
    f1            = (2 * sensibilidade * precisao / (sensibilidade + precisao)
                     if (sensibilidade + precisao) > 0 else 0.0)
    jaccard       = n_tp / (n_tp + n_fp + n_fn) if (n_tp + n_fp + n_fn) > 0 else 0.0

    # ── Scatter plot — correlação de VAF nos TPs ─────────────────────────
    tp_validos = df_tp.dropna(subset=["VAF_Panther", "VAF_Ion"])
    scatter_data = [
        {
            "vaf_panther": round(float(row["VAF_Panther"]), 4),
            "vaf_ion":     round(float(row["VAF_Ion"]),     4),
            "gene":        str(row["Gene"]),
            "locus":       str(row["Locus"]),
            "amostra":     str(row["Amostra"]),
        }
        for _, row in tp_validos.iterrows()
    ]
    spearman_rho = _spearman(
        [p["vaf_panther"] for p in scatter_data],
        [p["vaf_ion"]     for p in scatter_data],
    )

    # ── Discordantes por faixa de VAF (gráfico de barras) ───────────────
    FAIXAS = ["< 5%", "5 – 15%", "15 – 30%", "> 30%"]
    contagens: dict[str, dict[str, int]] = {f: {"fp": 0, "fn": 0} for f in FAIXAS}

    for _, row in df_fp.iterrows():
        vaf = row.get("VAF_Panther")
        if pd.notna(vaf):
            contagens[_faixa_vaf(float(vaf))]["fp"] += 1

    for _, row in df_fn.iterrows():
        vaf = row.get("VAF_Ion")
        if pd.notna(vaf):
            contagens[_faixa_vaf(float(vaf))]["fn"] += 1

    discordantes_vaf = [
        {"faixa": faixa, "fp": contagens[faixa]["fp"], "fn": contagens[faixa]["fn"]}
        for faixa in FAIXAS
    ]

    # ── Detalhamento das variantes discordantes (tabela de auditoria) ────
    def _safe(val):
        """Converte NaN/None para None e float para arredondado."""
        if val is None:
            return None
        try:
            f = float(val)
            return None if (f != f) else round(f, 4)   # NaN check: NaN != NaN
        except (TypeError, ValueError):
            return None

    def _safe_int(val):
        if val is None:
            return None
        try:
            f = float(val)
            return None if (f != f) else int(f)
        except (TypeError, ValueError):
            return None

    detalhamento_discordantes = []
    for _, row in pd.concat([df_fp, df_fn]).iterrows():
        detalhamento_discordantes.append({
            "amostra":     str(row.get("Amostra",   "—")),
            "parametro":   str(row.get("Parametro", "—")),
            "locus":       str(row.get("Locus",     "—")),
            "gene":        str(row.get("Gene",      "—")),
            "tipo":        str(row.get("Status",    "—")),
            "vaf_panther": _safe(row.get("VAF_Panther")),
            "vaf_ion":     _safe(row.get("VAF_Ion")),
            "dp_panther":  _safe_int(row.get("DP_Panther")),
            "dp_ion":      _safe_int(row.get("DP_Ion")),
        })

    # Ordenação: FPs primeiro, depois FNs; dentro de cada grupo, por VAF descendente
    detalhamento_discordantes.sort(
        key=lambda d: (
            0 if d["tipo"] == "FP" else 1,
            -(d["vaf_panther"] or d["vaf_ion"] or 0),
        )
    )

    logger.info(
        "[benchmarking] min_vaf=%.2f min_dp=%d → TP=%d FP=%d FN=%d "
        "Sens=%.3f Prec=%.3f F1=%.3f",
        min_vaf, min_dp, n_tp, n_fp, n_fn, sensibilidade, precisao, f1
    )

    return {
        "parametros": {"min_vaf": min_vaf, "min_dp": min_dp},
        "metricas": {
            "tp":            n_tp,
            "fp":            n_fp,
            "fn":            n_fn,
            "sensibilidade": round(sensibilidade, 4),
            "precisao":      round(precisao,      4),
            "f1_score":      round(f1,            4),
            "jaccard":       round(jaccard,        4),
        },
        "venn_data": {"tp": n_tp, "fp": n_fp, "fn": n_fn},
        "scatter_data": {
            "pontos":       scatter_data,
            "spearman_rho": round(spearman_rho, 4) if spearman_rho is not None else None,
            "n":            len(scatter_data),
        },
        "discordantes_vaf":        discordantes_vaf,
        "detalhamento_discordantes": detalhamento_discordantes,
    }


if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8000)