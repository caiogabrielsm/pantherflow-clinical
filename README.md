# 🐆 PantherFlow Clinical

**Plataforma de Genômica Clínica para Variant Calling Tumor-Only**

Sistema desktop para orquestração de pipelines bioinformáticos clínicos aplicados à análise de variantes somáticas em painéis de amplicons/captura (AmpliSeq, Twist). Desenvolvido como TCC — UFCSPA.

---

## Sumário

1. [Visão Geral](#1-visão-geral)
2. [Pré-requisitos de Sistema](#2-pré-requisitos-de-sistema)
3. [Instalação do Ambiente — Primeira Vez](#3-instalação-do-ambiente--primeira-vez)
   - 3.1 WSL2
   - 3.2 Docker Desktop
   - 3.3 Estrutura de Diretórios no WSL2
   - 3.4 Imagem Docker
   - 3.5 Datasets de Referência
4. [Configuração do Arquivo .env](#4-configuração-do-arquivo-env)
5. [Como Abrir o Software](#5-como-abrir-o-software)
6. [Como Usar — Passo a Passo](#6-como-usar--passo-a-passo)
7. [Para Desenvolvedores — Rodando em Modo Dev](#7-para-desenvolvedores--rodando-em-modo-dev)
8. [Para Desenvolvedores — Build e Empacotamento](#8-para-desenvolvedores--build-e-empacotamento)
9. [Arquitetura do Sistema](#9-arquitetura-do-sistema)
10. [Pipeline Bioinformática](#10-pipeline-bioinformática)
11. [Solução de Problemas](#11-solução-de-problemas)

---

## 1. Visão Geral

O PantherFlow Clinical executa um pipeline de variant calling completo **localmente**, sem envio de dados para servidores externos (conformidade LGPD).

**Fluxo resumido:**

```
FASTQ (R1 + R2) → fastp → BWA-MEM → samtools (BAM)
→ Qualimap → VarScan2 + Mutect2 + LoFreq
→ bcftools norm → Consenso (interseção)
→ snpEff + SnpSift → Laudo Clínico (PDF)
```

**Stack:**

| Camada | Tecnologia |
|---|---|
| Interface | Electron 40 + React 19 + Tailwind CSS |
| Motor | FastAPI + SQLite + SQLAlchemy |
| Pipeline | Docker (WSL2) — imagem `pantherflow-bioinfo` |
| OS alvo | Windows 10/11 (x64) com WSL2 |

---

## 2. Pré-requisitos de Sistema

| Requisito | Mínimo | Recomendado |
|---|---|---|
| Windows | 10 v2004 ou Win 11 | Windows 11 |
| RAM | 16 GB | 32 GB |
| Disco livre | 200 GB | 500 GB |
| CPU | 8 núcleos | 16 núcleos |
| WSL2 + Ubuntu | 22.04 | 24.04 |
| Docker Desktop | 4.x | última versão |

> **Atenção:** O software não funciona sem WSL2 e Docker Desktop instalados e em execução.

---

## 3. Instalação do Ambiente — Primeira Vez

> Esta configuração é feita **uma única vez**. Após concluída, basta abrir o software normalmente.

### 3.1 Instalar WSL2 com Ubuntu

Abra o **PowerShell como Administrador** e execute:

```powershell
wsl --install -d Ubuntu
```

Aguarde o download e reinicie quando solicitado. Após reiniciar, o Ubuntu abrirá pedindo para criar um usuário e senha. **Anote o nome de usuário criado** — será necessário na etapa 4.

Verifique:

```powershell
wsl -l -v
```

Deve aparecer `Ubuntu` com `VERSION 2`.

---

### 3.2 Instalar Docker Desktop

1. Baixe em: [https://www.docker.com/products/docker-desktop](https://www.docker.com/products/docker-desktop)
2. Instale marcando **"Use WSL 2 based engine"**
3. Após instalar, abra o Docker Desktop:
   - Vá em `Settings → Resources → WSL Integration`
   - Ative a integração com **Ubuntu**
   - Clique em **Apply & Restart**

Verifique (em PowerShell):

```powershell
docker run hello-world
```

---

### 3.3 Criar a Estrutura de Diretórios no WSL2

Abra o Ubuntu (pelo menu Iniciar ou digitando `wsl` no PowerShell) e execute:

```bash
mkdir -p ~/pantherflow-clinical/processamento
mkdir -p ~/pantherflow-clinical/datasets
```

---

### 3.4 Construir a Imagem Docker

No terminal Ubuntu:

```bash
cd ~
git clone https://github.com/caiogabrielsm/pantherflow-clinical.git
cd pantherflow-clinical
docker build -t pantherflow-bioinfo .
```

> O build demora 20–40 minutos na primeira vez (baixa ~5 GB de ferramentas bioinformáticas).

Verifique:

```bash
docker images | grep pantherflow-bioinfo
```

---

### 3.5 Datasets de Referência

Os datasets **não estão no repositório** por serem muito grandes. Devem ser colocados em:

```
\\wsl.localhost\Ubuntu\home\SEU_USUARIO\pantherflow-clinical\datasets\
```

Você pode acessar essa pasta pelo Explorador de Arquivos do Windows digitando o caminho acima na barra de endereços.

#### Datasets obrigatórios

| Arquivo | Tamanho | Fonte |
|---|---|---|
| `Homo_sapiens_assembly38.fasta` + 6 índices | ~10 GB | [GATK Resource Bundle](https://gatk.broadinstitute.org/hc/en-us/articles/360035890811) |
| `af-only-gnomad.hg38.vcf.gz` + `.tbi` | ~4 GB | GATK Resource Bundle |
| `small_exac_common_3.hg38.vcf.gz` + `.tbi` | ~500 MB | GATK Resource Bundle |
| `clinvar.vcf.gz` + `.tbi` | ~500 MB | [NCBI ClinVar](https://ftp.ncbi.nlm.nih.gov/pub/clinvar/vcf_GRCh38/) |
| `Cosmic_GenomeScreensMutant_v103_GRCh38.vcf.gz` + `.tbi` | ~1 GB | [COSMIC](https://cancer.sanger.ac.uk/cosmic) |
| `snpeff_data/GRCh38.99/` | ~8 GB | `snpEff download GRCh38.99` |
| `1000g_pon.hg38.vcf.gz` + `.tbi` | ~2 GB | GATK Resource Bundle |
| `chr_name_map.txt` | < 1 KB | Criar manualmente (ver abaixo) |
| Arquivo BED do painel | < 1 MB | Fornecido pelo fabricante |

**Criar o `chr_name_map.txt`** (copie e cole no terminal Ubuntu):

```bash
cat > ~/pantherflow-clinical/datasets/chr_name_map.txt << 'EOF'
1	chr1
2	chr2
3	chr3
4	chr4
5	chr5
6	chr6
7	chr7
8	chr8
9	chr9
10	chr10
11	chr11
12	chr12
13	chr13
14	chr14
15	chr15
16	chr16
17	chr17
18	chr18
19	chr19
20	chr20
21	chr21
22	chr22
X	chrX
Y	chrY
MT	chrM
EOF
```

---

## 4. Configuração do Arquivo `.env`

Na pasta `backend/` do projeto (Windows), crie um arquivo chamado `.env`:

```
backend\.env
```

Com o seguinte conteúdo:

```env
WSL_USER=seu_usuario_ubuntu
```

Substitua `seu_usuario_ubuntu` pelo nome de usuário que você criou na etapa 3.1.

**Exemplo:**

```env
WSL_USER=joao
```

> Este arquivo **nunca é enviado ao GitHub** (está no `.gitignore`) por questões de segurança.

---

## 5. Como Abrir o Software

### Pré-condição obrigatória

O **Docker Desktop** precisa estar aberto e em execução (ícone na bandeja do sistema) antes de iniciar o PantherFlow.

### Versão instalada (a partir do instalador .exe)

Dê um **duplo clique** no ícone do PantherFlow Clinical na área de trabalho.

Uma tela de carregamento aparecerá por ~5–15 segundos enquanto o motor bioinformático inicializa. Após isso, a interface abre automaticamente.

### Versão de desenvolvimento

Ver [seção 7](#7-para-desenvolvedores--rodando-em-modo-dev).

---

## 6. Como Usar — Passo a Passo

### 6.1 Verificar Status do Sistema

O **Dashboard** é exibido ao abrir o software. Verifique:
- Ícone de Docker: deve estar verde ("Online")
- Tabela de análises anteriores

### 6.2 Iniciar Nova Análise

1. Clique em **"Nova Análise"** na barra lateral
2. Preencha:
   - **ID do Paciente** — identificador anonimizado (ex: `PAC-2026-001`)
   - **Sexo Biológico** — M ou F
   - **Médico Solicitante**
   - **Protocolo** — selecionado automaticamente como ONCOLOGY
3. Faça upload:
   - **R1 (Forward):** arquivo `_R1.fastq.gz`
   - **R2 (Reverse):** arquivo `_R2.fastq.gz`
4. (Opcional) Configure parâmetros:
   - **Padrão Clínico GDC** — recomendado (VAF ≥ 5%, cobertura ≥ 100x)
   - **Customizado** — para pesquisa
5. Clique em **"Iniciar Análise"**

### 6.3 Monitorar a Execução

A página **Monitor** exibe:
- Logs em tempo real da pipeline
- Consumo de hardware (CPU, RAM, Disco)

**Tempo de execução esperado:**
- Painel de amplicons (~400 genes): 30 min – 2 horas
- WES (exoma completo): 2 – 6 horas
- WGS (genoma inteiro): 6 – 24 horas

### 6.4 Visualizar o Laudo

Após o status mudar para **"Completed"**:

1. Clique na análise no Dashboard
2. **Aba "Laudo Clínico":**
   - Contagens de variantes por caller (VarScan2 / Mutect2 / LoFreq / Consenso)
   - Gráfico de dispersão VAF × Profundidade
   - Heatmap de densidade alélica
   - Tabelas de variantes com anotações ClinVar, COSMIC e gnomAD
3. **Aba "Controle de Qualidade":**
   - Telemetria de tempo por etapa
   - Relatórios FastQC e Qualimap
4. Clique em **"Imprimir / Exportar PDF"** para salvar o laudo

---

## 7. Para Desenvolvedores — Rodando em Modo Dev

### Requisitos adicionais

- [Node.js 20+](https://nodejs.org/)
- [Python 3.11+](https://www.python.org/)
- Git

### Instalação

```bash
# Clone o repositório
git clone https://github.com/caiogabrielsm/pantherflow-clinical.git
cd pantherflow-clinical

# Dependências do frontend
npm install

# Dependências do backend
cd backend
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
```

Crie `backend\.env`:

```env
WSL_USER=seu_usuario_ubuntu
```

### Executar

Abra **dois terminais**:

**Terminal 1 — Backend:**

```bash
cd backend
venv\Scripts\activate
uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

**Terminal 2 — Frontend + Electron:**

```bash
npm run electron:dev
```

---

## 8. Para Desenvolvedores — Build e Empacotamento

### Passo 1 — Empacotar backend com PyInstaller

```bash
cd backend
venv\Scripts\activate
pip install pyinstaller

pyinstaller main.spec --distpath dist-pyinstaller --workpath build-pyinstaller --clean
```

Resultado: `backend/dist-pyinstaller/main/main.exe`

### Passo 2 — Build completo + instalador

```bash
# Na raiz do projeto
npm run dist
```

Instalador gerado em: `release/PantherFlow Clinical Setup 1.0.0.exe`

### Estrutura do pacote instalado

```
resources/
├── backend/
│   ├── main.exe          ← FastAPI (PyInstaller)
│   └── config/
└── app/
    ├── electron.cjs      ← Processo principal Electron
    ├── dist/             ← React compilado
    └── logo.png
```

> Os datasets de referência e a imagem Docker **não são incluídos** no instalador.
> Precisam ser configurados conforme a [seção 3](#3-instalação-do-ambiente--primeira-vez).

---

## 9. Arquitetura do Sistema

```
┌─────────────────────────────────────────────────────────┐
│  Windows Host                                            │
│                                                          │
│  ┌──────────────┐      ┌──────────────────────────────┐  │
│  │   Electron   │      │  FastAPI (uvicorn :8000)     │  │
│  │  (spawna o   │◄────►│  main.py · pipeline.py       │  │
│  │   backend)   │      │  SQLite (pantherflow.db)     │  │
│  └──────┬───────┘      └──────────────┬───────────────┘  │
│         │                             │                   │
│  ┌──────▼──────┐                      │ subprocess        │
│  │  React SPA  │                      │ wsl docker run    │
│  │  HashRouter │                      ▼                   │
│  │  Recharts   │      ┌──────────────────────────────┐   │
│  └─────────────┘      │       WSL2 — Ubuntu          │   │
│                       │  Docker: pantherflow-bioinfo  │   │
│                       │  BWA · samtools · GATK4       │   │
│                       │  VarScan2 · LoFreq · snpEff   │   │
│                       └──────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

---

## 10. Pipeline Bioinformática

| Etapa | Ferramenta | Descrição |
|---|---|---|
| 0 | Validação | Verifica índices BWA e datasets |
| 0.5 | fastp | QC e trimagem dos reads |
| 1+2 | BWA-MEM + samtools | Alinhamento → BAM (pipe, sem .sam) |
| 2.5 | Qualimap | QC do BAM (cobertura, distribuição) |
| 3 | samtools flagstat | Taxa de mapeamento |
| 4 | VarScan2 | Variant calling pileup-based |
| 4.5 | Mutect2 | Variant calling probabilístico (tumor-only) |
| 4.6 | LoFreq | Variant calling sensível (baixo VAF) |
| 4.55 | LearnReadOrientationModel | Correção artefatos OxoG/FFPE |
| 4.56 | GetPileupSummaries + CalculateContamination | Modelo GDC |
| 4.6 | FilterMutectCalls | Filtragem de artefatos GATK |
| 4.7 | bcftools norm | Normalização de INDELs |
| 5 | Consenso | Interseção dos 3 callers |
| 5.5 | snpEff | Anotação funcional (impacto, HGVS) |
| 5.6 | SnpSift ClinVar | Significância clínica |
| 5.7 | SnpSift COSMIC | Frequência em tumores |
| 5.8 | SnpSift gnomAD | Frequência poblacional |
| 6 | Laudo | Persistência no banco + laudo |

**Regras biológicas:**

- Sem remoção de duplicatas (AmpliSeq — leituras duplicadas são legítimas)
- `mpileup -B` obrigatório (desativa BAQ para amplicons)
- Consenso = interseção para máxima especificidade clínica
- FilterMutectCalls obrigatório antes de usar VCF do Mutect2

---

## 11. Solução de Problemas

### Docker aparece como "Offline" no software

- Confirme que o Docker Desktop está aberto (ícone na bandeja)
- Aguarde ~30s após abrir o Docker Desktop
- Teste: `docker ps` no PowerShell

### Pipeline para no meio / sem progresso

- Veja os logs no Monitor — Mutect2 e BWA em WES levam 2–6h (normal)
- Se aparecer `[WATCHDOG]` nos logs, o processo foi encerrado por timeout → problema com datasets

### "WSL_PROCESSAMENTO não encontrado"

```bash
# No Ubuntu, verifique se a pasta existe:
ls ~/pantherflow-clinical/processamento
```

- Confirme que `WSL_USER` no `.env` é igual ao seu usuário Ubuntu

### Tela em branco ao abrir o software

- Aguarde mais 15 segundos (backend ainda inicializando)
- Verifique `backend/pantherflow.log` para erros de startup

### 0 variantes no consenso

- Confirme que o arquivo BED do painel está correto
- Verifique se o genoma de referência é hg38 (não hg19)
- Abra os logs de VarScan2 e Mutect2 no Monitor

---

*PantherFlow Clinical — Caio Gabriel | UFCSPA 2026*
