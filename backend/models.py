from sqlalchemy import Column, Integer, String, DateTime
import datetime

# Importamos a fundação (Base) do nosso arquivo database.py
from database import Base

# Definição da Tabela de Análises
class Analysis(Base):
    __tablename__ = "analyses"
    
    id = Column(Integer, primary_key=True, index=True)
    patient_id = Column(String) 
    patient_uuid = Column(String, unique=True, index=True) 
    doctor = Column(String)
    protocol = Column(String)
    status = Column(String, default="processing")
    date = Column(DateTime, default=datetime.datetime.utcnow)