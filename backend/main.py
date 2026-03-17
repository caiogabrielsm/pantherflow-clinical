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

@app.post("/api/upload")
async def start_analysis(
    background_tasks: BackgroundTasks, 
    file: UploadFile = File(...), 
    patientId: str = Form(...),
    doctor: str = Form(...),
    protocol: str = Form(...),
    db: Session = Depends(get_db)
):
    """Gera UUID, salva no banco e ejeta o FASTQ anonimizado no WSL2"""
    id_anonimo = str(uuid.uuid4())
    logger.info(f"Anonimizando Paciente {patientId} -> UUID: {id_anonimo}")
    
    try:
        # Usa o nosso modelo importado do models.py
        new_entry = models.Analysis(
            patient_id=patientId, 
            patient_uuid=id_anonimo, 
            doctor=doctor, 
            protocol=protocol
        )
        db.add(new_entry)
        db.commit()
        db.refresh(new_entry)
        
        # Sanitização da extensão
        extensoes = Path(file.filename).suffixes
        extensao_bruta = "".join(extensoes).lower()
        extensao_segura = re.sub(r'[^a-z0-9.]', '', extensao_bruta)
        
        if not extensao_segura.endswith(('.fastq', '.fastq.gz', '.fq', '.fq.gz')):
            raise HTTPException(status_code=400, detail="Formato de arquivo inválido. Use .fastq ou .fastq.gz")

        novo_nome = f"{id_anonimo}_R1{extensao_segura}"
        caminho_wsl = WSL_PROCESSAMENTO / novo_nome
        
        with open(caminho_wsl, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
            
        logger.info(f"Arquivo {novo_nome} salvo no WSL com sucesso.")

        # Aciona a função que importamos do pipeline.py
        background_tasks.add_task(processar_paciente_wsl, id_anonimo, novo_nome)

        return {"status": "processing", "db_id": new_entry.id, "patientId": patientId, "uuid": id_anonimo}
        
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

if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8000)