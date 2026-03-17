import subprocess
import os
import shlex
import logging
from pathlib import Path

# Importamos as configurações do banco e o modelo da tabela
from database import SessionLocal
from models import Analysis

logger = logging.getLogger(__name__)

# --- CONFIGURAÇÃO DE CAMINHOS (Ponte Windows -> WSL2) ---
WSL_PROCESSAMENTO = Path(r"\\wsl.localhost\Ubuntu\home\lait-02\pantherflow-clinical\processamento")

def processar_paciente_wsl(paciente_uuid: str, nome_arquivo_r1: str):
    """Executa os comandos pesados no Docker/WSL2 em background"""
    
    # Abrimos uma sessão com o banco exclusiva para essa tarefa em background
    db = SessionLocal()
    
    def atualizar_fase(fase: str):
        """Função auxiliar para atualizar o status do paciente no banco"""
        registro = db.query(Analysis).filter(Analysis.patient_uuid == paciente_uuid).first()
        if registro:
            registro.status = fase
            db.commit()

    try:
        # --- ETAPA 1: ALINHAMENTO BWA ---
        atualizar_fase("Mapeando DNA (BWA)...")
        
        # Escapando nomes de arquivos para evitar Command Injection
        safe_r1 = shlex.quote(nome_arquivo_r1)
        safe_uuid = shlex.quote(paciente_uuid)
        
        comando_bwa_interno = f"bwa mem /datasets/Homo_sapiens_assembly38.fasta /processamento/{safe_r1} > /processamento/{safe_uuid}.sam"
        
        comando_bwa = [
            "wsl", "-d", "Ubuntu", "-u", "root", "docker", "run", "--rm",
            "-v", "/home/lait-02/pantherflow-clinical/datasets:/datasets",
            "-v", "/home/lait-02/pantherflow-clinical/processamento:/processamento",
            "pantherflow-bioinfo", "sh", "-c", comando_bwa_interno
        ]
        
        res_bwa = subprocess.run(comando_bwa, capture_output=True, text=True)
        if res_bwa.returncode != 0: 
            raise Exception(f"Erro BWA: {res_bwa.stderr}")

        # --- ETAPA 2: CONVERSÃO PARA BAM (SAMTOOLS) ---
        atualizar_fase("Comprimindo (SAM -> BAM)...")
        
        comando_bam_interno = f"samtools view -Sb /processamento/{safe_uuid}.sam | samtools sort -o /processamento/{safe_uuid}.bam"
        
        comando_bam = [
            "wsl", "-d", "Ubuntu", "-u", "root", "docker", "run", "--rm",
            "-v", "/home/lait-02/pantherflow-clinical/processamento:/processamento",
            "pantherflow-bioinfo", "sh", "-c", comando_bam_interno
        ]
        
        res_bam = subprocess.run(comando_bam, capture_output=True, text=True)
        
        # --- ETAPA 3: LIMPEZA ---
        if res_bam.returncode == 0:
            arquivo_sam = WSL_PROCESSAMENTO / f"{paciente_uuid}.sam"
            if arquivo_sam.exists(): 
                os.remove(arquivo_sam)
            atualizar_fase("completed")
            logger.info(f"Pipeline finalizada com sucesso: {paciente_uuid}")
        else:
            raise Exception(f"Erro Samtools: {res_bam.stderr}")

    except Exception as e:
        logger.error(f"Falha na pipeline {paciente_uuid}: {str(e)}")
        atualizar_fase("failed")
    finally:
        db.close()