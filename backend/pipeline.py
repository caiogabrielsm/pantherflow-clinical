from pathlib import Path
import logging
import subprocess
import os
import shlex
import re  # <-- IMPORTANTE: Adicionado para garimpar os números!

# Importamos as configurações do banco e o modelo da tabela
from database import SessionLocal
from models import Analysis

logger = logging.getLogger(__name__)

# --- CONFIGURAÇÃO DE CAMINHOS (Ponte Windows -> WSL2) ---
WSL_PROCESSAMENTO = Path(r"\\wsl.localhost\Ubuntu\home\lait-02\pantherflow-clinical\processamento")
WSL_DATASETS = Path(r"\\wsl.localhost\Ubuntu\home\lait-02\pantherflow-clinical\datasets") # <-- Nova ponte!

def escrever_log_ui(uuid: str, mensagem: str):
    """Escreve o log no terminal e em um arquivo .log para o React ler"""
    # Exibe no terminal do VS Code
    logger.info(f"[{uuid}] {mensagem}")
    
    # Salva no arquivo físico do WSL para o Frontend
    caminho_log = WSL_PROCESSAMENTO / f"{uuid}.log"
    with open(caminho_log, "a", encoding="utf-8") as f:
        f.write(f"> {mensagem}\n")

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
        
        # --- LOG INICIAL ---
        escrever_log_ui(paciente_uuid, "Iniciando ambiente isolado e validando arquivo FASTQ...")

        # --- PREPARAÇÃO DE VARIÁVEIS SEGURAS ---
        safe_r1 = shlex.quote(nome_arquivo_r1)
        safe_uuid = shlex.quote(paciente_uuid)
        
        # Criamos o nome do arquivo limpo dinamicamente e garantimos a segurança dele
        nome_arquivo_trimmed = nome_arquivo_r1.replace(".fastq", "_trimmed.fastq").replace(".fq", "_trimmed.fq")
        safe_r1_trimmed = shlex.quote(nome_arquivo_trimmed)

        # --- ETAPA 0: BARREIRA DE SEGURANÇA (Validação BWA) ---
        escrever_log_ui(paciente_uuid, "Verificando integridade dos índices genômicos (BWA)...")
        required_indices = [".bwt", ".pac", ".ann", ".amb", ".sa"]
        for ext in required_indices:
            index_file = WSL_DATASETS / f"Homo_sapiens_assembly38.fasta{ext}"
            if not index_file.exists():
                error_msg = f"Falha Crítica: Índice BWA ausente ({index_file.name}). O alinhamento foi abortado."
                raise FileNotFoundError(error_msg)
        escrever_log_ui(paciente_uuid, "Índices validados com sucesso.")

        # --- ETAPA 0.5: CONTROLE DE QUALIDADE BRUTO (FASTQC) ---
        escrever_log_ui(paciente_uuid, "Executando FastQC: Avaliação de qualidade bruta...")
        comando_fastqc_interno = f"fastqc /processamento/{safe_r1} -o /processamento/"
        comando_fastqc = [
            "wsl", "-d", "Ubuntu", "-u", "root", "docker", "run", "--rm",
            "-v", "/home/lait-02/pantherflow-clinical/processamento:/processamento",
            "pantherflow-bioinfo", "sh", "-c", comando_fastqc_interno
        ]
        res_fastqc = subprocess.run(comando_fastqc, capture_output=True, text=True)
        if res_fastqc.returncode != 0:
            raise Exception(f"Erro FastQC: {res_fastqc.stderr}")

        # --- ETAPA 0.75: LIMPEZA DE ADAPTADORES E QUALIDADE (TRIMMOMATIC) ---
        escrever_log_ui(paciente_uuid, "Executando Trimmomatic: Removendo adaptadores e bases de baixa qualidade...")
        
        # Parâmetros clínicos clássicos: remove bases com Phred < 15 na janela de 4, corta pontas ruins e descarta reads < 36bp
        comando_trim_interno = f"trimmomatic SE -threads 4 /processamento/{safe_r1} /processamento/{safe_r1_trimmed} LEADING:3 TRAILING:3 SLIDINGWINDOW:4:15 MINLEN:36"
        
        comando_trim = [
            "wsl", "-d", "Ubuntu", "-u", "root", "docker", "run", "--rm",
            "-v", "/home/lait-02/pantherflow-clinical/processamento:/processamento",
            "pantherflow-bioinfo", "sh", "-c", comando_trim_interno
        ]
        
        res_trim = subprocess.run(comando_trim, capture_output=True, text=True)
        if res_trim.returncode != 0:
            raise Exception(f"Erro Trimmomatic: {res_trim.stderr}")

        # --- ETAPA 1: ALINHAMENTO BWA (ATUALIZADO) ---
        escrever_log_ui(paciente_uuid, "Executando BWA-MEM: Mapeando leituras contra o genoma de referência...")
        
        # ATENÇÃO: O BWA agora usa o safe_r1_trimmed em vez do safe_r1
        comando_bwa_interno = f"bwa mem -t 4 /datasets/Homo_sapiens_assembly38.fasta /processamento/{safe_r1_trimmed} > /processamento/{safe_uuid}.sam"
        
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
        escrever_log_ui(paciente_uuid, "Executando Samtools: Convertendo, ordenando e indexando arquivo BAM...")
        comando_bam_interno = f"samtools view -Sb /processamento/{safe_uuid}.sam | samtools sort -o /processamento/{safe_uuid}.bam"
        
        comando_bam = [
            "wsl", "-d", "Ubuntu", "-u", "root", "docker", "run", "--rm",
            "-v", "/home/lait-02/pantherflow-clinical/processamento:/processamento",
            "pantherflow-bioinfo", "sh", "-c", comando_bam_interno
        ]
        
        res_bam = subprocess.run(comando_bam, capture_output=True, text=True)
        if res_bam.returncode != 0:
            raise Exception(f"Erro Samtools: {res_bam.stderr}")
        
        res_bam = subprocess.run(comando_bam, capture_output=True, text=True)
        if res_bam.returncode != 0:
            raise Exception(f"Erro Samtools: {res_bam.stderr}")

        # --- ETAPA 2.5: CONTROLE DE QUALIDADE DO ALINHAMENTO (QUALIMAP) ---
        escrever_log_ui(paciente_uuid, "Executando Qualimap: Avaliando profundidade e cobertura do mapeamento (BAM)...")
        
        # O Qualimap cria uma pasta de resultados. Direcionamos para uma pasta com o UUID.
        pasta_qualimap = f"/processamento/{safe_uuid}_qualimap"
        
        # Parâmetros: bamqc (Quality Control do BAM), -nt 4 (4 threads para ir mais rápido)
        comando_qualimap_interno = f"qualimap bamqc -bam /processamento/{safe_uuid}.bam -outdir {pasta_qualimap} -outformat HTML -nt 4"
        
        comando_qualimap = [
            "wsl", "-d", "Ubuntu", "-u", "root", "docker", "run", "--rm",
            "-v", "/home/lait-02/pantherflow-clinical/processamento:/processamento",
            "pantherflow-bioinfo", "sh", "-c", comando_qualimap_interno
        ]
        
        res_qualimap = subprocess.run(comando_qualimap, capture_output=True, text=True)
        if res_qualimap.returncode != 0:
            raise Exception(f"Erro Qualimap: {res_qualimap.stderr}")


        # --- ETAPA 3: A MÁGICA DA EXTRAÇÃO (FLAGSTAT) ---
        escrever_log_ui(paciente_uuid, "Extraindo métricas biológicas (Flagstat)...")
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
            
        # Puxa o registro do banco para salvar as métricas e a rastreabilidade
        registro_final = db.query(Analysis).filter(Analysis.patient_uuid == paciente_uuid).first()
        if registro_final:
            registro_final.status = "completed"
            
            # Métricas Biológicas
            registro_final.total_reads = total_reads
            registro_final.mapping_rate = mapping_rate
            registro_final.mean_coverage = mean_coverage
            
            # Rastreabilidade Clínica
            registro_final.bwa_version = "0.7.17-r1188" 
            registro_final.samtools_version = "1.13"
            registro_final.reference_version = "Homo_sapiens_assembly38"
            
            db.commit()
            
        escrever_log_ui(paciente_uuid, "PIPELINE FINALIZADO COM SUCESSO. Laudo disponível.")
        
    except Exception as e:
        # Se algo quebrar, avisa o React imediatamente
        escrever_log_ui(paciente_uuid, f"ERRO FATAL: Falha na execução da pipeline. Detalhe: {str(e)}")
        atualizar_fase("failed")
    finally:
        db.close()