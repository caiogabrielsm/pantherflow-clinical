from dotenv import load_dotenv
load_dotenv()  # Carrega backend/.env antes de qualquer import que use os.getenv()

from fastapi.responses import FileResponse
import glob
import hashlib
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
from pathlib import Path

# --- IMPORTANDO NOSSOS MÓDULOS REFATORADOS ---
from database import engine, get_db
import models
from pipeline import processar_paciente_wsl, WSL_PROCESSAMENTO

# --- CONFIGURAÇÃO DE LOGS ---
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s',
                    handlers=[logging.FileHandler("pantherflow.log"), logging.StreamHandler()])
logger = logging.getLogger(__name__)

# Cria as tabelas no banco de dados (se não existirem)
models.Base.metadata.create_all(bind=engine)

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
        # Tenta executar um comando básico silenciosamente
        subprocess.run(
            ["docker", "info"], 
            capture_output=True, 
            text=True, 
            check=True
        )
        return {"status": "online", "message": "Docker engine ativo."}
    except (subprocess.CalledProcessError, FileNotFoundError):
        return {"status": "offline", "message": "Docker indisponível."}


@app.post("/api/upload")
async def start_analysis(
    background_tasks: BackgroundTasks,
    files: list[UploadFile] = File(...),
    patientId: str = Form(...),
    doctor: str = Form(...),
    protocol: str = Form(...),
    sex: str = Form(...),
    db: Session = Depends(get_db)
):
    """Gera UUID, salva R1 e R2 no disco e inicia o pipeline Paired-End"""
    if not files or len(files) == 0:
        raise HTTPException(status_code=400, detail="Nenhum arquivo enviado.")
    if len(files) > 2:
        raise HTTPException(status_code=400, detail="Envie no máximo 2 arquivos (R1 e R2).")

    id_anonimo = str(uuid.uuid4())
    logger.info(f"[{id_anonimo}] Nova análise iniciada ({len(files)} arquivo(s)).")

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

        EXTENSOES_VALIDAS = ('.fastq', '.fastq.gz', '.fq', '.fq.gz')
        nomes_salvos = {}   # {"R1": "uuid_R1.fastq.gz", "R2": "uuid_R2.fastq.gz"}
        md5_hashes   = {}   # {"R1": "abc123", "R2": "def456"}

        for upload in files:
            # Identifica se é R1 ou R2 pelo nome original do arquivo
            nome_original = upload.filename or ""
            if re.search(r'[_\-\.]R2[_\-\.]|[_\-\.]R2$|_2\.', nome_original, re.IGNORECASE):
                tag = "R2"
            else:
                tag = "R1"  # fallback: arquivo único ou R1 explícito

            extensoes = Path(nome_original).suffixes
            extensao_bruta = "".join(extensoes).lower()
            extensao_segura = re.sub(r'[^a-z0-9.]', '', extensao_bruta)

            if not extensao_segura.endswith(EXTENSOES_VALIDAS):
                raise HTTPException(
                    status_code=400,
                    detail=f"Formato inválido ({nome_original}). Use .fastq ou .fastq.gz"
                )

            novo_nome = f"{id_anonimo}_{tag}{extensao_segura}"
            caminho_wsl = WSL_PROCESSAMENTO / novo_nome

            logger.info(f"[{id_anonimo}] Salvando {tag} ({novo_nome})...")
            md5_hash = hashlib.md5()
            with open(caminho_wsl, "wb") as buffer:
                while chunk := await upload.read(8192 * 1024):
                    buffer.write(chunk)
                    md5_hash.update(chunk)

            nomes_salvos[tag] = novo_nome
            md5_hashes[tag]   = md5_hash.hexdigest()
            logger.info(f"[{id_anonimo}] {tag} salvo. MD5: {md5_hashes[tag]}")

        if "R1" not in nomes_salvos:
            raise HTTPException(status_code=400, detail="R1 não identificado. Verifique o nome dos arquivos.")

        # Persiste o MD5 do R1 (campo existente); R2 fica no log
        new_entry.md5_checksum = md5_hashes.get("R1")
        db.commit()

        nome_r1 = nomes_salvos["R1"]
        nome_r2 = nomes_salvos.get("R2")   # None se modo Single-End

        background_tasks.add_task(processar_paciente_wsl, id_anonimo, nome_r1, nome_r2)

        return {"status": "processing", "db_id": new_entry.id, "uuid": id_anonimo}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Erro no upload/registro para o WSL: {e}")
        db.rollback()
        raise HTTPException(status_code=500, detail="Erro interno ao ejetar arquivo")
    
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
    return analysis

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
        
    arquivo_alvo = pasta_qualimap / file_path
    
    # Prevenção de segurança (Directory Traversal)
    if not str(arquivo_alvo).startswith(str(pasta_qualimap)) or not arquivo_alvo.exists():
        raise HTTPException(status_code=404, detail="Arquivo não encontrado.")
        
    return FileResponse(arquivo_alvo)

if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8000)