from sqlalchemy import Column, Integer, String, DateTime, Text
from sqlalchemy.sql import func
from database import Base

class Analysis(Base):
    __tablename__ = "analyses"

    id = Column(Integer, primary_key=True, index=True)
    patient_id = Column(String, index=True)
    patient_uuid = Column(String, unique=True, index=True)
    doctor = Column(String)
    protocol = Column(String)
    status = Column(String, default="processing") 
    date = Column(DateTime(timezone=True), server_default=func.now())
    
    # RESULTADOS BIOLÓGICOS (Já existentes)
    total_reads = Column(String, nullable=True)
    mapping_rate = Column(String, nullable=True)
    mean_coverage = Column(String, nullable=True)

    # --- SPRINT 1: INTEGRIDADE E RASTREABILIDADE CLÍNICA ---
    md5_checksum = Column(String, nullable=True)        # Hash de integridade do FASTQ
    bwa_version = Column(String, nullable=True)         # Versão do BWA utilizada
    samtools_version = Column(String, nullable=True)    # Versão do Samtools utilizada
    reference_version = Column(String, nullable=True)   # Genoma de Referência

    # --- SPRINT 2: MULTI-CALLER CONSENSUS E TELEMETRIA ---
    variants_varscan   = Column(Integer, nullable=True)  # Contagem bruta VarScan2
    variants_mutect    = Column(Integer, nullable=True)  # Contagem bruta Mutect2
    variants_consensus = Column(Integer, nullable=True)  # Interseção VarScan2 ∩ Mutect2
    time_steps         = Column(Text, nullable=True)     # JSON: {"fastqc": "12.0s", ...}
    time_total         = Column(String, nullable=True)   # Ex: "845.2s"

    # --- SPRINT 3: ANOTAÇÃO FUNCIONAL (SnpEff) ---
    annotation_summary = Column(Text, nullable=True)     # JSON: resumo das variantes anotadas