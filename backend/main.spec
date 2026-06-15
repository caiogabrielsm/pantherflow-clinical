# -*- mode: python ; coding: utf-8 -*-
#
# PyInstaller spec para o backend FastAPI do PantherFlow Clinical.
#
# Como gerar o executável (rodar dentro da pasta backend/ com o venv ativo):
#
#   pyinstaller main.spec \
#     --distpath dist-pyinstaller \
#     --workpath build-pyinstaller \
#     --clean
#
# O resultado será:  backend/dist-pyinstaller/main/main.exe
# O electron-builder copia esse diretório para resources/backend/ no instalador.
#
# IMPORTANTE: antes de empacotar, copie/renomeie seu .env para .env.example
# e então crie um .env real na mesma pasta do main.exe no computador do usuário.

block_cipher = None

a = Analysis(
    ['main.py'],
    pathex=['.'],
    binaries=[],
    datas=[
        # Diretório de configuração do benchmarking
        ('config', 'config'),
    ],
    hiddenimports=[
        # Uvicorn — módulos lazy-loaded não detectados pelo PyInstaller
        'uvicorn',
        'uvicorn.logging',
        'uvicorn.loops',
        'uvicorn.loops.auto',
        'uvicorn.protocols',
        'uvicorn.protocols.http',
        'uvicorn.protocols.http.auto',
        'uvicorn.protocols.websockets',
        'uvicorn.protocols.websockets.auto',
        'uvicorn.lifespan',
        'uvicorn.lifespan.on',
        # FastAPI e Starlette
        'starlette.routing',
        'starlette.middleware',
        'starlette.middleware.cors',
        'starlette.responses',
        'multipart',
        'python_multipart',
        # SQLAlchemy — dialeto SQLite é importado dinamicamente
        'sqlalchemy.dialects.sqlite',
        'sqlalchemy.sql.default_comparator',
        'sqlalchemy.ext.declarative',
        # Módulos do próprio projeto
        'database',
        'models',
        'pipeline',
        # Utilitários
        'psutil',
        'dotenv',
        'aiofiles',
        'anyio',
        'anyio.from_thread',
        'click',
        'h11',
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        # Exclui o que não é necessário para reduzir tamanho do executável
        'tkinter',
        'matplotlib',
        'numpy',
        'pandas',
        'PIL',
        'IPython',
        'jupyter',
        'notebook',
    ],
    noarchive=False,
    optimize=0,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,   # one-directory mode: mais rápido para iniciar
    name='main',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=True,            # console=True para ver logs de inicialização do uvicorn
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

# One-directory mode: gera uma pasta com main.exe + todas as DLLs/bibliotecas.
# O electron-builder copia essa pasta inteira para resources/backend/.
coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name='main',
)
