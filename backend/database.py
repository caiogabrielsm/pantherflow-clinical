from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker

# --- CONFIGURAÇÃO DO BANCO DE DADOS (SQLite) ---
SQLALCHEMY_DATABASE_URL = "sqlite:///./pantherflow.db"

# O engine é o motor que realmente conversa com o arquivo .db
engine = create_engine(
    SQLALCHEMY_DATABASE_URL, 
    connect_args={"check_same_thread": False} # Necessário para o SQLite no FastAPI
)

# A Sessão é a "conversa" aberta com o banco
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# O Base é a fundação para criarmos as nossas tabelas depois
Base = declarative_base()

# --- INJEÇÃO DE DEPENDÊNCIA (Banco de Dados Seguro) ---
def get_db():
    """Garante que a conexão com o banco seja aberta e fechada corretamente a cada requisição"""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()