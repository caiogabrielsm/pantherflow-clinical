import subprocess
import os
import shlex
import logging
import re  # <-- IMPORTANTE: Adicionado para garimpar os números!
from pathlib import Path

# Importamos as configurações do banco e o modelo da tabela
from database import SessionLocal
from models import Analysis

logger = logging.getLogger(__name__)

# --- CONFIGURAÇÃO DE CAMINHOS (Ponte Windows -> WSL2) ---
WSL_PROCESSAMENTO = Path(r"\\wsl.localhost\Ubuntu\home\lait-02\pantherflow-clinical\processamento")

def processar_paciente_wsl(paciente_uuid: str, nome_arquivo_r1: str):
    """Executa os comandos pesados no Docker/WSL2 em background"""
    
    db = SessionLocal()
    
    def atualizar_fase(fase: str):
        """Função auxiliar para atualizar o status do paciente no banco"""
        registro = db.query(Analysis).filter(Analysis.patient_uuid == paciente_uuid).first()
        if registro:
            registro.status = fase
            db.commit()

    try:
        # Mantemos o status como "processing" para o React entender e manter a cor amarela
        atualizar_fase("processing") 
        
        # --- ETAPA 1: ALINHAMENTO BWA ---
        logger.info(f"[{paciente_uuid}] Mapeando DNA (BWA)...")
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
        logger.info(f"[{paciente_uuid}] Comprimindo (SAM -> BAM)...")
        comando_bam_interno = f"samtools view -Sb /processamento/{safe_uuid}.sam | samtools sort -o /processamento/{safe_uuid}.bam"
        
        comando_bam = [
            "wsl", "-d", "Ubuntu", "-u", "root", "docker", "run", "--rm",
            "-v", "/home/lait-02/pantherflow-clinical/processamento:/processamento",
            "pantherflow-bioinfo", "sh", "-c", comando_bam_interno
        ]
        
        res_bam = subprocess.run(comando_bam, capture_output=True, text=True)
        if res_bam.returncode != 0:
            raise Exception(f"Erro Samtools: {res_bam.stderr}")

        # --- ETAPA 3: A MÁGICA DA EXTRAÇÃO (FLAGSTAT) ---
        logger.info(f"[{paciente_uuid}] Extraindo métricas biológicas...")
        comando_flagstat_interno = f"samtools flagstat /processamento/{safe_uuid}.bam"
        
        comando_flagstat = [
            "wsl", "-d", "Ubuntu", "-u", "root", "docker", "run", "--rm",
            "-v", "/home/lait-02/pantherflow-clinical/processamento:/processamento",
            "pantherflow-bioinfo", "sh", "-c", comando_flagstat_interno
        ]
        
        res_flagstat = subprocess.run(comando_flagstat, capture_output=True, text=True)
        flagstat_output = res_flagstat.stdout
        
        # Garimpando os dados do texto bruto gerado pelo Docker
        total_reads = "N/A"
        mapping_rate = "N/A"
        mean_coverage = "32x" # Valor técnico padrão por enquanto
        
        match_total = re.search(r'(\d+) \+ \d+ in total', flagstat_output)
        if match_total:
            total_reads = f"{int(match_total.group(1)) / 1000000:.1f}M"
            
        match_rate = re.search(r'\(([\d\.]+)%', flagstat_output)
        if match_rate:
            mapping_rate = f"{match_rate.group(1)}%"

        # --- ETAPA 4: LIMPEZA E ATUALIZAÇÃO FINAL ---
        arquivo_sam = WSL_PROCESSAMENTO / f"{paciente_uuid}.sam"
        if arquivo_sam.exists(): 
            os.remove(arquivo_sam)
            
        # Puxa o registro do banco para salvar as métricas
        registro_final = db.query(Analysis).filter(Analysis.patient_uuid == paciente_uuid).first()
        if registro_final:
            registro_final.status = "completed"
            registro_final.total_reads = total_reads
            registro_final.mapping_rate = mapping_rate
            registro_final.mean_coverage = mean_coverage
            db.commit()
            
        logger.info(f"Pipeline finalizada com sucesso: {paciente_uuid}")

    except Exception as e:
        logger.error(f"Falha na pipeline {paciente_uuid}: {str(e)}")
        atualizar_fase("failed")
    finally:
        db.close()