from sqlalchemy import Column, Integer, String, DateTime
from sqlalchemy.sql import func
from database import Base

class Analysis(Base):
    __tablename__ = "analyses"

    id = Column(Integer, primary_key=True, index=True)
    patient_id = Column(String, index=True)
    patient_uuid = Column(String, unique=True, index=True)
    doctor = Column(String)
    protocol = Column(String)
    status = Column(String, default="processing") # processing, completed, failed
    date = Column(DateTime(timezone=True), server_default=func.now())
    
    # NOVAS COLUNAS PARA OS RESULTADOS BIOLÓGICOS
    total_reads = Column(String, nullable=True)
    mapping_rate = Column(String, nullable=True)
    mean_coverage = Column(String, nullable=True)