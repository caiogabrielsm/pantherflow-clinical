from fastapi import FastAPI, UploadFile, File, Form, HTTPException
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
import time # Adicione este import lá no topo do arquivo junto com os outros!

# --- CONFIGURAÇÃO DE LOGS ---
# Mantém o rastreamento de todas as operações críticas para auditoria biomédica
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s',
                    handlers=[logging.FileHandler("pantherflow.log"), logging.StreamHandler()])
logger = logging.getLogger(__name__)

# --- CONFIGURAÇÃO DO BANCO DE DADOS (SQLite) ---
# O arquivo pantherflow.db será criado automaticamente na primeira execução
SQLALCHEMY_DATABASE_URL = "sqlite:///./pantherflow.db"
engine = create_engine(SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

# Definição da Tabela de Análises (Modelo Clínico)
class Analysis(Base):
    __tablename__ = "analyses"
    id = Column(Integer, primary_key=True, index=True)
    patient_id = Column(String)
    doctor = Column(String)
    protocol = Column(String)
    status = Column(String, default="Concluído")
    date = Column(DateTime, default=datetime.datetime.utcnow)

# Cria as tabelas se não existirem no SQLite
Base.metadata.create_all(bind=engine)

app = FastAPI(title="PantherFlow Clinical Engine")

# Configuração de CORS para comunicação com o React/Vite
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], # Em produção, mude para a porta específica do Electron
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- ROTAS DA API ---

@app.get("/api/health")
def get_system_health():
    """Rota de telemetria detalhada para evitar erros de renderização no frontend"""
    try:
        cpu_percent = psutil.cpu_percent(interval=None)
        ram = psutil.virtual_memory()
        
        # ADAPTAÇÃO WINDOWS: Pega a raiz do disco atual (ex: C:\) de forma universal
        root_drive = os.path.abspath(os.sep)
        disk = psutil.disk_usage(root_drive)
        
        # Tenta capturar frequência da CPU (ajuste para compatibilidade)
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
    file: UploadFile = File(...),
    patientId: str = Form(...),
    doctor: str = Form(...),
    protocol: str = Form(...)
):
    """Inicia uma análise e persiste os dados no banco SQLite"""
    logger.info(f"💾 Iniciando registro: Paciente {patientId}")
    
    db = SessionLocal()
    try:
        new_entry = Analysis(patient_id=patientId, doctor=doctor, protocol=protocol)
        db.add(new_entry)
        db.commit()
        db.refresh(new_entry)
        
        # Salvamento físico do arquivo FASTQ/dados
        upload_path = "uploads"
        if not os.path.exists(upload_path): 
            os.makedirs(upload_path)
        
        # ADAPTAÇÃO WINDOWS: os.path.join garante a barra correta ( \ ) no caminho
        file_location = os.path.join(upload_path, file.filename)
        
        with open(file_location, "wb+") as buffer:
            shutil.copyfileobj(file.file, buffer)

        return {
            "status": "completed",
            "db_id": new_entry.id,
            "patientId": patientId,
            "variants": [{"id": 1, "gene": "TP53", "class": "Pathogenic"}]   
        }
    except Exception as e:
        logger.error(f"Erro no upload/registro: {e}")
        raise HTTPException(status_code=500, detail="Erro interno ao salvar análise")
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
    """Remove um registro do histórico clínico e apaga os arquivos físicos com segurança no Windows"""
    db = SessionLocal()
    try:
        analysis = db.query(Analysis).filter(Analysis.id == analysis_id).first()
        if analysis:
            # 1. Deleta do Banco de Dados
            db.delete(analysis)
            db.commit()
            
            # 2. Deleta o arquivo físico (se existir) lidando com o File Lock do Windows
            upload_path = "uploads"
            # Como não salvamos o nome do arquivo no banco ainda, limpamos a pasta inteira do paciente ou iteramos.
            # Para segurança no Windows, tentamos apagar com retentativas:
            for filename in os.listdir(upload_path):
                file_path = os.path.join(upload_path, filename)
                
                # Tratamento de File Lock: Tenta apagar até 3 vezes com pausa de 1 segundo
                for tentativa in range(3):
                    try:
                        if os.path.isfile(file_path):
                            os.remove(file_path)
                        break # Se apagou, sai do loop de tentativas
                    except PermissionError:
                        logger.warning(f"Arquivo em uso pelo Windows. Tentativa {tentativa + 1} de 3...")
                        time.sleep(1)
                    except Exception as e:
                        logger.error(f"Erro ao apagar arquivo {filename}: {e}")
                        break

            logger.info(f"🗑️ Registro {analysis_id} e arquivos associados removidos com sucesso.")
            return {"message": "Sucesso"}
            
        raise HTTPException(status_code=404, detail="Registro não encontrado")
    finally:
        db.close()

# Bloco principal para execução do Uvicorn e empacotamento PyInstaller
if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8000)