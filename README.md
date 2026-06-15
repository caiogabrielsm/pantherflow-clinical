# 🐆 PantherFlow Clinical

**Plataforma de Genômica Clínica para Variant Calling Tumor-Only**

Sistema desktop para orquestração de pipelines bioinformáticos clínicos aplicados à análise de variantes somáticas em painéis de captura/amplicons (Twist, AmpliSeq). Desenvolvido como TCC — UFCSPA 2026.

---

## Sumário

1. [Visão Geral](#1-visão-geral)
2. [Requisitos de Sistema](#2-requisitos-de-sistema)
3. [Instalação do Ambiente — Primeira Vez](#3-instalação-do-ambiente--primeira-vez)
   - 3.1 WSL2 + Ubuntu
   - 3.2 Docker Desktop
   - 3.3 Estrutura de diretórios no WSL2
   - 3.4 Imagens Docker
   - 3.5 Datasets de referência
   - 3.6 Arquivo BED do painel
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
FASTQ (R1 + R2)
  → fastp (QC + trimagem)
  → BWA-MEM + samtools (alinhamento → BAM)
  → Qualimap + samtools coverage (QC de cobertura)
  → VarScan2 + Mutect2 + LoFreq (3 callers independentes)
  → bcftools norm → Consenso (interseção dos 3)
  → snpEff + SnpSift ClinVar + COSMIC + gnomAD (anotação)
  → Laudo Clínico (HTML/PDF)
```

**Stack:**

| Camada | Tecnologia |
|---|---|
| Interface | Electron 40 + React 19 + Tailwind CSS |
| Motor | FastAPI + SQLite + SQLAlchemy |
| Pipeline | Docker (WSL2) — 3 imagens |
| OS alvo | Windows 10/11 (x64) com WSL2 |

---

## 2. Requisitos de Sistema

> ⚠️ Estes são os requisitos **reais** testados com o pipeline. Valores abaixo do mínimo causam travamentos ou falhas silenciosas no Mutect2 e LoFreq.

| Recurso | **Mínimo absoluto** | **Recomendado** |
|---|---|---|
| Windows | 10 v2004 (Build 19041) ou Win 11 | Windows 11 |
| RAM | **32 GB** | 64 GB |
| CPU | 8 núcleos físicos | 16+ núcleos |
| Disco livre | **300 GB** | 500 GB+ |
| WSL2 + Ubuntu | 22.04 | 24.04 |
| Docker Desktop | 4.x | última versão |

**Por que 32 GB?**
- BWA-MEM carrega o índice hg38 (~8 GB) em memória
- Mutect2 aloca 8–16 GB de heap Java em amostras WES
- LoFreq + VarScan2 + snpEff rodam em paralelo ou em sequência com o sistema operacional ativo

Com 16 GB, o Mutect2 pode terminar em amostras de painel pequeno, mas vai travar ou ser encerrado pelo SO em WES.

---

## 3. Instalação do Ambiente — Primeira Vez

> Esta configuração é feita **uma única vez**. Após concluída, basta abrir o software.

### 3.1 Instalar WSL2 + Ubuntu

Abra o **PowerShell como Administrador**:

```powershell
wsl --install -d Ubuntu
```

Reinicie quando solicitado. Após reiniciar, o Ubuntu abrirá pedindo usuário e senha. **Anote o nome de usuário** — será necessário na etapa 4.

Verifique:

```powershell
wsl -l -v
# Deve mostrar Ubuntu com VERSION 2
```

---

### 3.2 Instalar Docker Desktop

1. Baixe em [docker.com/products/docker-desktop](https://www.docker.com/products/docker-desktop)
2. Instale marcando **"Use WSL 2 based engine"**
3. Abra o Docker Desktop → `Settings → Resources → WSL Integration` → ative **Ubuntu** → **Apply & Restart**

Verifique (PowerShell):

```powershell
docker run hello-world
```

---

### 3.3 Criar Estrutura de Diretórios no WSL2

Abra o Ubuntu (menu Iniciar → Ubuntu) e execute:

```bash
mkdir -p ~/pantherflow-clinical/processamento
mkdir -p ~/pantherflow-clinical/datasets
mkdir -p ~/pantherflow-clinical/datasets/painel_twist/output_InterpriseUSA_UFCSPA_pulmao_TE-97054821_hg38
```

---

### 3.4 Imagens Docker

O PantherFlow usa **3 imagens Docker**. Todas precisam estar disponíveis antes de iniciar uma análise.

#### Imagem principal (pantherflow-bioinfo)

Contém BWA, samtools, GATK4 (Mutect2), VarScan2, bcftools, snpEff e SnpSift.

A partir da raiz do projeto (PowerShell no Windows):

```powershell
docker build -t pantherflow-bioinfo .
```

> O build demora **20–40 minutos** na primeira vez (~5 GB de download de ferramentas bioinformáticas).

Verifique:

```powershell
docker images | findstr pantherflow-bioinfo
```

#### Imagem fastp (pré-processamento)

```powershell
docker pull staphb/fastp:latest
```

#### Imagem LoFreq (terceiro caller)

```powershell
docker pull quay.io/biocontainers/lofreq:2.1.5--py310h8360dc1_7
```

> As imagens fastp e LoFreq são baixadas automaticamente do Docker Hub/Biocontainers. O pull manual garante que estão disponíveis antes da primeira análise.

---

### 3.5 Datasets de Referência

Os datasets são muito grandes para estar no repositório. Devem ser colocados em:

```
\\wsl.localhost\Ubuntu\home\SEU_USUARIO\pantherflow-clinical\datasets\
```

Acesse essa pasta pelo Explorador de Arquivos do Windows digitando o caminho acima.

#### Datasets obrigatórios (hg38)

| Arquivo | Tamanho aprox. | Fonte |
|---|---|---|
| `Homo_sapiens_assembly38.fasta` + 6 índices (`.amb .ann .bwt .pac .sa .fai .dict`) | ~10 GB | [GATK Resource Bundle (Google)](https://console.cloud.google.com/storage/browser/genomics-public-data/resources/broad/hg38/v0) |
| `af-only-gnomad.hg38.vcf.gz` + `.tbi` | ~4 GB | GATK Resource Bundle |
| `small_exac_common_3.hg38.vcf.gz` + `.tbi` | ~500 MB | GATK Resource Bundle |
| `clinvar.vcf.gz` + `.tbi` | ~500 MB | [NCBI ClinVar](https://ftp.ncbi.nlm.nih.gov/pub/clinvar/vcf_GRCh38/) |
| `Cosmic_GenomeScreensMutant_v103_GRCh38.vcf.gz` + `.tbi` | ~1 GB | [COSMIC](https://cancer.sanger.ac.uk/cosmic/download) (requer cadastro gratuito) |
| `snpeff_data/GRCh38.99/` | ~8 GB | Baixar via container (ver abaixo) |
| `1000g_pon.hg38.vcf.gz` + `.tbi` | ~2 GB | GATK Resource Bundle |
| `chr_name_map.txt` | < 1 KB | Criar manualmente (ver abaixo) |

**Total estimado: ~26 GB** (mais espaço de trabalho por amostra: ~50–100 GB por análise WES)

#### Download do banco snpEff

```bash
# No terminal Ubuntu
docker run --rm -v ~/pantherflow-clinical/datasets:/datasets \
  pantherflow-bioinfo \
  snpEff download GRCh38.99 -dataDir /datasets/snpeff_data
```

> Demora ~30 minutos dependendo da conexão (~8 GB).

#### Criar chr_name_map.txt

```bash
# No terminal Ubuntu
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

### 3.6 Arquivo BED do Painel

O arquivo BED delimita as regiões-alvo do seu painel de captura. **Sem ele a pipeline não encontra variantes.**

O caminho do BED está definido em [backend/pipeline.py](backend/pipeline.py) na linha:

```python
_BED_TWIST = (
    "painel_twist/output_InterpriseUSA_UFCSPA_pulmao_TE-97054821_hg38/"
    "Target_bases_covered_by_probes_InterpriseUSA_UFCSPA_pulmao_TE-97054821_hg38_250708161615.bed"
)
```

**Se você usa um painel diferente**, substitua esse valor pelo caminho relativo ao diretório `datasets/` do seu painel. Exemplo para um AmpliSeq:

```python
_BED_TWIST = "alvo_ampliseq_6col.bed"
```

Salve o arquivo BED em:

```
\\wsl.localhost\Ubuntu\home\SEU_USUARIO\pantherflow-clinical\datasets\
```

---

## 4. Configuração do Arquivo `.env`

Na pasta `backend/` do projeto, crie um arquivo chamado `.env`:

```
backend\.env
```

Conteúdo:

```env
WSL_USER=seu_usuario_ubuntu
```

Substitua `seu_usuario_ubuntu` pelo nome criado na etapa 3.1. Exemplo:

```env
WSL_USER=joao
```

> Este arquivo **nunca é enviado ao GitHub** (está no `.gitignore`).

---

## 5. Como Abrir o Software

### Pré-condição obrigatória

O **Docker Desktop** precisa estar aberto e rodando (ícone verde na bandeja do sistema) antes de iniciar o PantherFlow.

### Versão instalada (instalador .exe)

Dê **duplo clique** no ícone do PantherFlow Clinical na área de trabalho.

A tela de splash aparece enquanto o motor inicializa (~5–15 segundos).

### Versão de desenvolvimento

Ver [seção 7](#7-para-desenvolvedores--rodando-em-modo-dev).

---

## 6. Como Usar — Passo a Passo

### 6.1 Verificar Status

O **Dashboard** inicial mostra o status do Docker (deve estar verde) e as análises anteriores.

### 6.2 Nova Análise

1. **Nova Análise** na barra lateral
2. Preencha:
   - **ID do Paciente** — identificador anonimizado (ex: `PAC-2026-001`)
   - **Sexo Biológico** — M ou F
   - **Médico Solicitante**
3. Faça upload dos arquivos:
   - **R1 (Forward):** `_R1.fastq.gz`
   - **R2 (Reverse):** `_R2.fastq.gz`
4. (Opcional) Configure parâmetros:
   - **Padrão Clínico GDC** — recomendado (VAF ≥ 5%, cobertura ≥ 100×)
   - **Customizado** — para pesquisa (ajusta VAF mínimo e profundidade mínima)
5. **Iniciar Análise**

### 6.3 Monitorar

A página **Monitor** mostra logs em tempo real e consumo de hardware.

**Tempos de execução esperados** (com hardware recomendado):

| Tipo de amostra | Tempo estimado |
|---|---|
| Painel de captura (~400 genes, Twist) | 1 – 3 horas |
| WES (exoma completo) | 4 – 8 horas |
| WGS (genoma inteiro) | 12 – 24 horas |

> Com hardware mínimo (32 GB RAM, 8 cores), multiplicar por 2–3×.

### 6.4 Laudo

Após status **"Completed"** no Dashboard:

1. Clique em **Resultado**
2. **Aba Resultados:**
   - Painel de genes relevantes (ALK, BRAF, EGFR, KRAS, etc.)
   - Variantes por caller: VarScan2 / Mutect2 / LoFreq / **Consenso**
   - Filtro automático: Variantes Relevantes (HIGH/MODERATE + ClinVar patogênicas) e Todas as Variantes
   - Anotações: ClinVar, COSMIC, gnomAD (frequência populacional)
3. **Aba Controle de Qualidade:**
   - Profundidade média do painel
   - Alvos sem cobertura (dropout) e alvos críticos (< 30×)
   - Relatório FastQC
4. **Exportar PDF** para salvar o laudo

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

# Frontend
npm install

# Backend
cd backend
python -m venv venv
venv\Scripts\activate        # Windows PowerShell
pip install -r requirements.txt
```

Crie `backend\.env` conforme a [seção 4](#4-configuração-do-arquivo-env).

### Executar

```bash
# Na raiz do projeto — inicia Vite + uvicorn + Electron automaticamente
npm run electron:dev
```

> O Electron spawna o Vite dev server e o uvicorn automaticamente. Aguarde a tela de splash desaparecer.

---

## 8. Para Desenvolvedores — Build e Empacotamento

### Pré-requisito: Modo Desenvolvedor do Windows

Necessário para o electron-builder criar symlinks durante o empacotamento:

`Configurações → Sistema → Para Desenvolvedores → Modo Desenvolvedor → ON`

### Passo 1 — Empacotar backend com PyInstaller

```bash
cd backend
venv\Scripts\activate
pip install pyinstaller

pyinstaller main.spec --distpath dist-pyinstaller --workpath build-pyinstaller --clean
```

Resultado: `backend/dist-pyinstaller/main/main.exe`

### Passo 2 — Build React + instalador NSIS

```bash
# Na raiz do projeto
npm run dist
```

Instalador gerado em: `release\PantherFlow Clinical Setup 1.0.0.exe`

> O instalador **não inclui** datasets, imagens Docker ou WSL2.
> O usuário final precisa configurar o ambiente conforme a [seção 3](#3-instalação-do-ambiente--primeira-vez).

---

## 9. Arquitetura do Sistema

```
┌────────────────────────────────────────────────────────────┐
│  Windows Host                                               │
│                                                             │
│  ┌──────────────┐       ┌──────────────────────────────┐   │
│  │   Electron   │       │  FastAPI (uvicorn :8000)     │   │
│  │  spawna o   │◄──────►│  main.py · pipeline.py       │   │
│  │   backend    │       │  SQLite (pantherflow.db)     │   │
│  └──────┬───────┘       └──────────────┬───────────────┘   │
│         │                              │                    │
│  ┌──────▼──────┐                       │ subprocess         │
│  │  React SPA  │                       │ wsl docker run     │
│  │  HashRouter │                       ▼                    │
│  │  Recharts   │       ┌──────────────────────────────┐    │
│  └─────────────┘       │       WSL2 — Ubuntu          │    │
│                        │                              │    │
│                        │  🐳 pantherflow-bioinfo      │    │
│                        │     BWA · samtools · GATK4   │    │
│                        │     VarScan2 · snpEff · bcf  │    │
│                        │                              │    │
│                        │  🐳 staphb/fastp             │    │
│                        │     Pré-processamento        │    │
│                        │                              │    │
│                        │  🐳 biocontainers/lofreq     │    │
│                        │     Terceiro caller          │    │
│                        └──────────────────────────────┘    │
└────────────────────────────────────────────────────────────┘
```

---

## 10. Pipeline Bioinformática

| Etapa | Ferramenta | Imagem Docker |
|---|---|---|
| QC + trimagem | fastp | staphb/fastp |
| Alinhamento → BAM | BWA-MEM + samtools (pipe) | pantherflow-bioinfo |
| QC cobertura | samtools coverage + bedcov | pantherflow-bioinfo |
| Variant calling 1 | VarScan2 (pileup-based) | pantherflow-bioinfo |
| Variant calling 2 | Mutect2 (tumor-only, GATK4) | pantherflow-bioinfo |
| Variant calling 3 | LoFreq (baixo VAF) | biocontainers/lofreq |
| Filtragem GATK | FilterMutectCalls + LearnReadOrientationModel | pantherflow-bioinfo |
| Modelo contaminação | GetPileupSummaries + CalculateContamination (GDC) | pantherflow-bioinfo |
| Normalização | bcftools norm | pantherflow-bioinfo |
| Consenso | Interseção VarScan2 ∩ Mutect2 ∩ LoFreq | — (Python) |
| Anotação funcional | snpEff GRCh38.99 | pantherflow-bioinfo |
| Anotação clínica | SnpSift ClinVar + COSMIC + gnomAD | pantherflow-bioinfo |

**Regras biológicas respeitadas:**

- ❌ Sem remoção de duplicatas (amplicons/captura — leituras duplicadas são biológicas)
- ✅ `mpileup -B` obrigatório (desativa BAQ para painéis de amplicons)
- ✅ Consenso = interseção (nunca união) — máxima especificidade clínica
- ✅ FilterMutectCalls obrigatório antes de usar o VCF do Mutect2
- ✅ bcftools norm antes do consenso (INDELs com representação diferente = false negatives)

---

## 11. Solução de Problemas

### Docker aparece como "Offline"

- Confirme que o Docker Desktop está aberto (ícone na bandeja)
- Aguarde ~30s após abrir (Docker demora para inicializar)
- Teste: `docker ps` no PowerShell

### Pipeline para / sem progresso por horas

- Veja os logs no Monitor — Mutect2 em WES pode levar 4–8h (normal)
- Se aparecer `[WATCHDOG]` nos logs, o processo foi encerrado por timeout de inatividade — geralmente indica dataset faltando ou corrompido

### "Não encontrou variantes" / 0 variantes no consenso

1. Confirme que o arquivo BED do painel está correto e no caminho esperado em `pipeline.py`
2. Verifique se o genoma de referência é **hg38** (o pipeline não funciona com hg19 sem ajuste)
3. Veja os logs de VarScan2 e Mutect2 no Monitor para erros específicos

### Mutect2 termina com erro de memória

- A VM da JVM precisa de mais RAM do que disponível
- Solução: feche outros programas e certifique-se de ter **32 GB livres** antes de iniciar
- Alternativa: desative temporariamente o LoFreq (amostra menor)

### "WSL_PROCESSAMENTO não encontrado"

```bash
# No Ubuntu, verifique:
ls ~/pantherflow-clinical/processamento
```

Confira se `WSL_USER` no `.env` corresponde ao seu usuário Ubuntu.

### Tela em branco ao abrir o software

- Aguarde mais 15 segundos (backend ainda inicializando)
- Verifique `backend\pantherflow.log` para erros de startup
- Em modo dev, confirme que `npm run electron:dev` foi executado na raiz do projeto

### Imagem Docker não encontrada (pantherflow-bioinfo)

```powershell
docker images | findstr pantherflow-bioinfo
```

Se não aparecer, rebuilde:

```powershell
docker build -t pantherflow-bioinfo .
```

---

*PantherFlow Clinical — Caio Gabriel | UFCSPA 2026*
