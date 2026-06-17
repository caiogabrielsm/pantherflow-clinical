import os
import sys
from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker

# --- CONFIGURAÇÃO DO BANCO DE DADOS (SQLite) ---
# Em modo empacotado (PyInstaller), __file__ aponta para C:\Program Files\ (somente-leitura).
# Usa %APPDATA% para garantir que o banco seja gravável sem privilégios de administrador.
def _db_path() -> str:
    if getattr(sys, 'frozen', False):
        appdata = os.environ.get('APPDATA', os.path.expanduser('~'))
        db_dir = os.path.join(appdata, 'pantherflow-clinical')
        os.makedirs(db_dir, exist_ok=True)
        return os.path.join(db_dir, 'pantherflow.db')
    return os.path.join(os.path.dirname(os.path.abspath(__file__)), 'pantherflow.db')

SQLALCHEMY_DATABASE_URL = f"sqlite:///{_db_path()}"

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