from fastapi import FastAPI, UploadFile, File, Form, HTTPException, BackgroundTasks
import subprocess
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import create_engine, Column, Integer, String, DateTime
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
import datetime
import psutil
import os
import shutil
import uvicorn
import logging
import time
import uuid
from pathlib import Path

# --- CONFIGURAÇÃO DE LOGS ---
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s',
                    handlers=[logging.FileHandler("pantherflow.log"), logging.StreamHandler()])
logger = logging.getLogger(__name__)

# --- CONFIGURAÇÃO DE CAMINHOS (Ponte Windows -> WSL2) ---
# Caminho de rede nativo do Windows para acessar o SSD do Ubuntu
WSL_PROCESSAMENTO = Path(r"\\wsl.localhost\Ubuntu\home\lait-02\pantherflow-clinical\processamento")
WSL_PROCESSAMENTO.mkdir(parents=True, exist_ok=True)

# --- CONFIGURAÇÃO DO BANCO DE DADOS (SQLite) ---
SQLALCHEMY_DATABASE_URL = "sqlite:///./pantherflow.db"
engine = create_engine(SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

# Definição da Tabela de Análises Atualizada (Com Anonimização LGPD)
class Analysis(Base):
    __tablename__ = "analyses"
    id = Column(Integer, primary_key=True, index=True)
    patient_id = Column(String)          # Nome real ou ID do Hospital
    patient_uuid = Column(String, unique=True) # ID Anônimo (LGPD)
    doctor = Column(String)
    protocol = Column(String)
    status = Column(String, default="Processando...")
    date = Column(DateTime, default=datetime.datetime.utcnow)

Base.metadata.create_all(bind=engine)

app = FastAPI(title="PantherFlow Clinical Engine")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def processar_paciente_wsl(paciente_uuid: str, nome_arquivo_r1: str):
    """
    Roda em segundo plano. Aciona o WSL2 pelo Windows e roda o Docker
    com o mapeamento de volumes correto para a bioinformática.
    """
    logger.info(f"Iniciando pipeline de bioinformatica para o UUID: {paciente_uuid}")
    
    # O comando instrui o WSL a rodar o Docker como root (sem pedir senha)
    # e processar o arquivo FASTQ gerando um arquivo SAM de alinhamento.
    comando_wsl = (
        f'wsl -d Ubuntu -u root docker run --rm '
        f'-v /home/lait-02/pantherflow-clinical/datasets:/datasets '
        f'-v /home/lait-02/pantherflow-clinical/processamento:/processamento '
        f'pantherflow-bioinfo sh -c '
        f'"bwa mem /datasets/Homo_sapiens_assembly38.fasta /processamento/{nome_arquivo_r1} > /processamento/{paciente_uuid}.sam"'
    )
    
    try:
        # Executa a chamada ao sistema operacional
        processo = subprocess.run(comando_wsl, shell=True, capture_output=True, text=True)
        
        if processo.returncode == 0:
            logger.info(f"Alinhamento BWA concluido com sucesso para UUID: {paciente_uuid}")
            # Na Fase 5, atualizaremos o banco de dados aqui para "Concluído"
        else:
            logger.error(f"Erro no processamento Docker para {paciente_uuid}: {processo.stderr}")
            
    except Exception as e:
        logger.error(f"Falha de sistema ao acionar o WSL: {str(e)}")

# --- ROTAS DA API ---

@app.get("/api/health")
def get_system_health():
    """Rota de telemetria detalhada para evitar erros de renderização no frontend"""
    try:
        cpu_percent = psutil.cpu_percent(interval=None)
        ram = psutil.virtual_memory()
        root_drive = os.path.abspath(os.sep)
        disk = psutil.disk_usage(root_drive)
        
        try:
            freq_val = f"{psutil.cpu_freq().current / 1000:.1f} GHz"
        except:
            freq_val = "N/A GHz"

        return {
            "cpu": {
                "percent": cpu_percent,
                "freq": freq_val,
                "threads": f"{psutil.cpu_count()} Threads"
            },
            "ram": {
                "percent": ram.percent,
                "label": f"{ram.used / (1024**3):.1f} / {ram.total / (1024**3):.1f} GB"
            },
            "disk": {
                "percent": disk.percent,
                "label": f"{disk.free / (1024**3):.1f} GB Livres",
                "total": f"{disk.total / (1024**3):.1f} GB"
            }
        }
    except Exception as e:
        logger.error(f"Erro na coleta de telemetria: {e}")
        return {"error": "Falha na leitura do hardware"}

@app.post("/api/upload")
async def start_analysis(
    background_tasks: BackgroundTasks, # <-- AQUI: Injetamos a ferramenta de background
    file: UploadFile = File(...), 
    patientId: str = Form(...),
    doctor: str = Form(...),
    protocol: str = Form(...)
):
    """Gera UUID (LGPD), salva no banco local e ejeta o FASTQ anonimizado no WSL2"""
    
    # 1. Geração do ID Anônimo
    id_anonimo = str(uuid.uuid4())
    logger.info(f"Anonimizando Paciente {patientId} -> UUID: {id_anonimo}")
    
    db = SessionLocal()
    try:
        # 2. Persistência no Banco Local (Seguro no Windows)
        new_entry = Analysis(
            patient_id=patientId, 
            patient_uuid=id_anonimo, 
            doctor=doctor, 
            protocol=protocol
        )
        db.add(new_entry)
        db.commit()
        db.refresh(new_entry)
        
        # 3. Renomear e ejetar arquivo para a zona de alta performance do WSL
        extensao = "".join(Path(file.filename).suffixes) # Ex: .fastq.gz
        novo_nome = f"{id_anonimo}_R1{extensao}"
        caminho_wsl = WSL_PROCESSAMENTO / novo_nome
        
        with open(caminho_wsl, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
            
        logger.info(f"Arquivo {novo_nome} salvo no WSL com sucesso.")

        # <-- AQUI: Acionamos o WSL/Docker silenciosamente, passando o UUID e o nome do arquivo
        background_tasks.add_task(processar_paciente_wsl, id_anonimo, novo_nome)

        return {
            "status": "completed",
            "db_id": new_entry.id,
            "patientId": patientId,
            "uuid": id_anonimo,
            "variants": [] 
        }
    except Exception as e:
        logger.error(f"Erro no upload/registro para o WSL: {e}")
        raise HTTPException(status_code=500, detail="Erro interno ao ejetar arquivo para o Linux")
    finally:
        db.close()

@app.get("/api/history")
def get_history():
    """Recupera o histórico completo de análises do banco de dados"""
    db = SessionLocal()
    try:
        history = db.query(Analysis).order_by(Analysis.date.desc()).all()
        return history
    finally:
        db.close()

@app.delete("/api/analysis/{analysis_id}")
def delete_analysis(analysis_id: int):
    """Remove o registro do banco e apaga os arquivos associados no WSL"""
    db = SessionLocal()
    try:
        analysis = db.query(Analysis).filter(Analysis.id == analysis_id).first()
        if analysis:
            uuid_alvo = analysis.patient_uuid
            
            # 1. Deleta do Banco de Dados
            db.delete(analysis)
            db.commit()
            
            # 2. Deleta os arquivos físicos no WSL (Procura tudo que tem o UUID)
            if uuid_alvo:
                for arquivo in WSL_PROCESSAMENTO.glob(f"{uuid_alvo}*"):
                    try:
                        os.remove(arquivo)
                        logger.info(f"Arquivo de processamento apagado: {arquivo.name}")
                    except Exception as e:
                        logger.error(f"Falha ao apagar arquivo WSL {arquivo.name}: {e}")

            logger.info(f"Registro {analysis_id} removido do banco.")
            return {"message": "Sucesso"}
            
        raise HTTPException(status_code=404, detail="Registro não encontrado")
    finally:
        db.close()

if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8000)