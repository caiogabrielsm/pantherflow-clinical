# PantherFlow Clinical — Documento de Contexto Mestre

**Versão:** Sprint 4 | **Data:** Maio 2026 | **Tipo:** TCC / Projeto Clínico
**Modalidade:** Tumor-Only, AmpliSeq | **Referência Genômica:** GRCh38 / hg38

---

## 1. O Que É Este Projeto

PantherFlow Clinical é uma aplicação desktop de bioinformática clínica para **chamada e anotação de variantes somáticas** a partir de dados de sequenciamento de próxima geração (NGS). Processa arquivos FASTQ de painéis de amplicons (AmpliSeq) e gera laudos clínicos com variantes anotadas funcionalmente (SnpEff), clinicamente (ClinVar) e oncologicamente (COSMIC).

**Contexto de uso:** laboratório de análise genômica clínica, fluxo tumor-only (sem amostra normal pareada).

---

## 2. Arquitetura Geral

```
┌─────────────────────────────────────────────────────────────┐
│  WINDOWS 11 HOST                                            │
│                                                             │
│  ┌──────────────────────┐   HTTP/REST   ┌────────────────┐ │
│  │   FRONTEND           │ ◄────────────► │   BACKEND      │ │
│  │   React + Vite       │  localhost:    │   FastAPI      │ │
│  │   porta 5173         │  8000          │   porta 8000   │ │
│  └──────────────────────┘               └───────┬────────┘ │
│                                                 │          │
│                                          subprocess        │
│                                          wsl -d Ubuntu     │
│                                                 │          │
│  ┌──────────────────────────────────────────────▼────────┐ │
│  │  WSL2 (Ubuntu)                                        │ │
│  │                                                       │ │
│  │  docker run pantherflow-bioinfo                       │ │
│  │  ┌─────────────────────────────────────────────────┐  │ │
│  │  │  CONTAINER (Miniconda + Bioconda)               │  │ │
│  │  │  FastQC · Trimmomatic · BWA · Samtools          │  │ │
│  │  │  Qualimap · VarScan2 · GATK4/Mutect2            │  │ │
│  │  │  bcftools · SnpEff · SnpSift                    │  │ │
│  │  └─────────────────────────────────────────────────┘  │ │
│  └───────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

**Princípio de isolamento:** toda ferramenta bioinformática roda dentro do container Docker — o host Windows nunca executa nenhum binário de bioinformática diretamente.

---

## 3. Stack Tecnológica Completa

### 3.1 Frontend

| Tecnologia | Versão | Função |
|---|---|---|
| **React** | 19.2.0 | Framework de UI, componentes, estado |
| **Vite** | 7.2.4 | Build tool e dev server (HMR) |
| **React Router DOM** | 7.12.0 | Roteamento SPA com `HashRouter` |
| **Tailwind CSS** | 3.4.17 | Estilização utility-first |
| **Axios** | 1.13.6 | Cliente HTTP para comunicação com a API |
| **Recharts** | 3.6.0 | Gráficos (ScatterChart VAF×DP, Heatmap) |
| **Lucide React** | 0.562.0 | Biblioteca de ícones SVG |
| **react-icons** | 5.6.0 | Ícones adicionais (Game Icons) |
| **Electron** | 40.6.0 | Empacotamento como app desktop |
| **electron-builder** | 26.8.1 | Build do instalador desktop |
| **concurrently** | 9.2.1 | Executa Vite + Electron em paralelo no dev |
| **PostCSS** | 8.5.6 | Processamento do Tailwind |
| **autoprefixer** | 10.4.23 | Prefixos CSS cross-browser |
| **ESLint** | 9.39.1 | Linting do código JS/JSX |

### 3.2 Backend

| Tecnologia | Versão | Função |
|---|---|---|
| **Python** | 3.10 | Runtime do backend |
| **FastAPI** | 0.129.0 | Framework REST API assíncrono |
| **Uvicorn** | 0.41.0 | Servidor ASGI para FastAPI |
| **SQLAlchemy** | 2.0.46 | ORM para acesso ao banco de dados |
| **SQLite** | — (embutido) | Banco de dados local (`pantherflow.db`) |
| **psutil** | 7.2.2 | Telemetria de hardware (CPU, RAM, Disco) |
| **python-dotenv** | — | Carregamento de variáveis de ambiente |
| **python-multipart** | 0.0.22 | Parse de `multipart/form-data` (upload) |
| **anyio** | 4.12.1 | Runtime assíncrono (dependência FastAPI) |
| **h11** | 0.16.0 | Protocolo HTTP/1.1 (dependência Uvicorn) |

### 3.3 Container Docker (Bioinformática)

**Imagem base:** `anaconda/miniconda:latest`
**Canais Conda:** `defaults`, `bioconda`, `conda-forge` (strict priority)

| Ferramenta | Versão | Função no Pipeline |
|---|---|---|
| **Python** | 3.10 | Runtime interno do container |
| **OpenJDK** | 21 | Runtime Java para GATK4, SnpEff, SnpSift |
| **FastQC** | ~0.12.x | QC de reads brutos (pré-alinhamento) |
| **Trimmomatic** | ~0.39.x | Remoção de adaptadores e bases de baixa qualidade |
| **BWA** | 0.7.17 | Alinhamento de reads ao genoma de referência (BWA-MEM) |
| **Samtools** | 1.13 | Conversão SAM→BAM, sort, index, flagstat |
| **Qualimap** | ~2.3.x | QC do BAM alinhado (cobertura, profundidade) |
| **GATK4** | ~4.6.x | Mutect2, FilterMutectCalls, LearnReadOrientationModel, GetPileupSummaries, CalculateContamination |
| **VarScan2** | ~2.4.x | Chamada de variantes tumor-only via mpileup2cns |
| **SnpEff** | 5.4.0c | Anotação funcional (impacto biológico) — banco GRCh38.99 |
| **SnpSift** | 5.4.0c | Anotação com bancos externos (ClinVar, COSMIC, gnomAD) |
| **bcftools** | ≥1.18 | Normalização de VCFs (norm, reheader) |
| **htslib** | ≥1.18 | Biblioteca base para manipulação de BAM/VCF |

### 3.4 Infraestrutura de Execução

| Componente | Versão/Detalhe | Função |
|---|---|---|
| **Windows 11** | 10.0.26200 | Host principal |
| **WSL2** | Ubuntu | Camada de execução Linux sobre Windows |
| **Docker Desktop** | — (via WSL2) | Gerenciamento dos containers |
| **UNC Path** | `\\wsl.localhost\Ubuntu\...` | Acesso do Python Windows aos arquivos WSL2 |

---

## 4. Estrutura de Arquivos

```
pantherflow-clinical/
│
├── backend/                          # Servidor Python (FastAPI)
│   ├── main.py                       # Rotas REST, upload, endpoints de laudo
│   ├── pipeline.py                   # Lógica completa do pipeline bioinformático
│   ├── database.py                   # Configuração SQLAlchemy + SQLite
│   ├── models.py                     # Schema da tabela `analyses`
│   ├── pantherflow.db                # Banco SQLite (gerado em runtime)
│   └── venv/                         # Ambiente virtual Python
│
├── src/                              # Frontend React
│   ├── main.jsx                      # Entry point React + ReactDOM
│   ├── App.jsx                       # HashRouter + definição de rotas
│   │
│   ├── layout/
│   │   └── MainLayout.jsx            # Sidebar colapsável + header + <Outlet>
│   │
│   ├── pages/                        # Páginas (conectam rotas a features)
│   │   ├── Dashboard.jsx             # Página inicial — tabela de histórico
│   │   ├── NewAnalysis.jsx           # Página de nova análise
│   │   ├── Monitor.jsx               # Página de monitoramento em tempo real
│   │   ├── Results.jsx               # Laudo clínico completo (página principal do produto)
│   │   └── Settings.jsx              # Configurações (em construção)
│   │
│   ├── features/                     # Módulos de feature (lógica + UI acopladas)
│   │   ├── analysis/
│   │   │   └── ui/
│   │   │       └── UploadForm.jsx    # Formulário de upload FASTQ com progresso
│   │   ├── dashboard/
│   │   │   ├── DashboardFeature.jsx  # Feature com fetch de histórico
│   │   │   └── ui/
│   │   │       └── RunsTable.jsx     # Tabela de corridas com ações (delete, resultado)
│   │   ├── history/
│   │   │   └── HistoryFeature.jsx    # (legado — consolidado no Dashboard)
│   │   └── monitor/
│   │       ├── MonitorFeature.jsx    # Polling de status + console em tempo real
│   │       └── ui/
│   │           └── HardwareMonitor.jsx # Barras de CPU/RAM/Disco
│   │
│   └── common/                       # Utilitários compartilhados
│       ├── data/
│       │   └── api.js                # Cliente Axios — todas as chamadas à API
│       └── ui/
│           ├── PantherIcon.jsx       # Ícone SVG da pantera (identidade visual)
│           └── StatusBadge.jsx       # Badge colorido de status (processing/completed/failed)
│
├── Dockerfile                        # Imagem Docker com todas as ferramentas bioinformáticas
├── package.json                      # Dependências e scripts npm
├── vite.config.js                    # Configuração Vite + plugin React
├── tailwind.config.js                # Configuração Tailwind CSS
├── postcss.config.js                 # Configuração PostCSS
├── electron.cjs                      # Entry point Electron (modo desktop)
├── BIOINFORMATICA_CRITERIOS_PIPELINE.md  # Critérios bioinformáticos detalhados
└── ARCHITECTURE_MASTER.md            # Este documento
```

---

## 5. Banco de Dados — Schema `analyses`

Arquivo: `backend/pantherflow.db` (SQLite, path absoluto relativo ao `database.py`)

| Coluna | Tipo | Descrição |
|---|---|---|
| `id` | INTEGER PK | Auto-incremento |
| `patient_id` | STRING | ID do paciente (nome/código clínico) |
| `patient_uuid` | STRING UNIQUE | UUID v4 gerado no upload — identifica todos os arquivos intermediários |
| `doctor` | STRING | Médico solicitante |
| `protocol` | STRING | Protocolo do painel (ex: "AmpliSeq Cancer Hotspot v2") |
| `biological_sex` | STRING | "M" \| "F" — necessário para análises sexo-dependentes |
| `status` | STRING | "processing" \| "completed" \| "failed" |
| `date` | DATETIME | Timestamp de criação (server_default=now()) |
| `md5_checksum` | STRING | Hash MD5 do FASTQ R1 — integridade de dados |
| `total_reads` | STRING | Ex: "12.4M" — reads totais do flagstat |
| `mapping_rate` | STRING | Ex: "98.7%" — taxa de alinhamento |
| `mean_coverage` | STRING | Ex: "847.3x" — cobertura média do Qualimap |
| `bwa_version` | STRING | Versão do BWA usada (rastreabilidade clínica) |
| `samtools_version` | STRING | Versão do Samtools usada |
| `reference_version` | STRING | Genoma de referência usado |
| `variants_varscan` | INTEGER | Contagem de variantes PASS do VarScan2 |
| `variants_mutect` | INTEGER | Contagem de variantes PASS do Mutect2 |
| `variants_consensus` | INTEGER | Tamanho da interseção VarScan2 ∩ Mutect2 |
| `varscan_details` | TEXT (JSON) | Top 20 variantes VarScan2 com anotação SnpEff |
| `mutect_details` | TEXT (JSON) | Top 20 variantes Mutect2 com anotação SnpEff |
| `annotation_summary` | TEXT (JSON) | Resumo completo SnpEff do consenso + top_variants |
| `time_steps` | TEXT (JSON) | Tempo de cada etapa: `{"fastqc":"12s","bwa_mem":"240s",...}` |
| `time_total` | STRING | Tempo total do pipeline (ex: "845.2s") |

---

## 6. API REST — Endpoints

Base URL: `http://localhost:8000/api`

| Método | Rota | Descrição |
|---|---|---|
| `GET` | `/health` | Telemetria de hardware (CPU %, RAM, Disco) via psutil |
| `GET` | `/health/docker` | Verifica se o Docker engine está respondendo |
| `POST` | `/upload` | Upload FASTQ (R1 + R2 opcional) + inicia pipeline em background |
| `GET` | `/history` | Lista todas as análises ordenadas por data desc |
| `GET` | `/analysis/{uuid}` | Dados completos de uma análise + plot_data do JSON |
| `DELETE` | `/analysis/{id}` | Remove registro do banco e arquivos WSL associados |
| `GET` | `/analysis/{uuid}/console` | Logs em tempo real do pipeline (polling a cada 2s) |
| `GET` | `/analysis/{uuid}/annotated-vcf` | Download do VCF de consenso anotado |
| `GET` | `/analysis/{uuid}/qc-report` | Relatório FastQC HTML |
| `GET` | `/analysis/{uuid}/qualimap/{path}` | Serve o relatório Qualimap (mini static server) |

---

## 7. Fluxo de Dados Completo

```
USUÁRIO (Browser)
    │
    │  POST /api/upload (multipart: FASTQ + metadados)
    ▼
FastAPI (main.py)
    │  1. Gera UUID v4
    │  2. Valida extensão (.fastq, .fastq.gz, .fq, .fq.gz)
    │  3. Salva arquivo em WSL_PROCESSAMENTO via UNC path
    │  4. Calcula MD5 durante o streaming do upload
    │  5. Cria registro no SQLite (status="processing")
    │  6. Dispara background_task (não bloqueia a resposta HTTP)
    │
    ▼ (resposta imediata: {"status":"processing","uuid":"..."})
    │
pipeline.py (background thread)
    │
    ├── Etapa 0:    Valida índices BWA (.bwt, .pac, .ann, .amb, .sa)
    ├── Etapa 0.5:  FastQC → relatório HTML salvo em /processamento/
    ├── Etapa 0.75: Trimmomatic → FASTQ limpos (_paired/_unpaired)
    ├── Etapas 1+2: BWA-MEM | samtools view | samtools sort → .bam + .bai
    ├── Etapa 2.5:  Qualimap → pasta _qualimap/qualimapReport.html
    ├── Etapa 3:    samtools flagstat → total_reads, mapping_rate
    │               qualimap genome_results.txt → mean_coverage
    ├── Etapa 4:    VarScan2 mpileup2cns → _varscan.vcf
    ├── Etapa 4.5:  Mutect2 tumor-only → _mutect_raw.vcf
    ├── Etapa 4.5.5:LearnReadOrientationModel → _read_orientation_model.tar.gz
    ├── Etapa 4.55: GetPileupSummaries + CalculateContamination → _contamination.table
    ├── Etapa 4.6:  FilterMutectCalls → _mutect.vcf (só PASS)
    ├── Etapa 4.7:  bcftools norm → _varscan_norm.vcf + _mutect_norm.vcf
    ├── Etapa 5:    parse_vcf() × 2 → set_varscan ∩ set_mutect → set_consenso
    │               escrever_consensus_vcf() → _consensus.vcf
    │               extrair_metricas_vcf() × 3 → _plot_data.json
    ├── Etapa 5.5:  SnpEff GRCh38.99 → _varscan_annotated.vcf
    │                                 → _mutect_annotated.vcf
    │                                 → _consensus_snpeff.vcf
    ├── Etapa 5.6:  SnpSift ClinVar → _consensus_clinvar.vcf (CLNSIG, CLNDN)
    ├── Etapa 5.7:  SnpSift COSMIC  → _consensus_annotated.vcf (CNT)
    ├── Etapa 5.8:  SnpSift gnomAD  → _consensus_gnomad.vcf (AF)
    └── Etapa 6:    parsear_anotacoes_snpeff() → annotation_summary
                    Persiste tudo no SQLite (status="completed")

FRONTEND (polling a cada 3s)
    │
    GET /api/history → atualiza tabela do Dashboard
    GET /api/analysis/{uuid}/console → atualiza terminal de logs
    GET /api/analysis/{uuid} → carrega laudo quando status=completed
```

---

## 8. Roteamento Frontend

| Rota | Componente | Descrição |
|---|---|---|
| `/` | `Dashboard` | Tabela de histórico de análises com status e ações |
| `/new-analysis` | `NewAnalysis` | Formulário de upload FASTQ com configuração de VAF e DP |
| `/monitor` | `Monitor` | Console em tempo real + monitor de hardware |
| `/results/:uuid` | `Results` | Laudo clínico completo com todas as abas |
| `/settings` | `Settings` | Configurações (em construção) |

**Nota:** Usa `HashRouter` (em vez de `BrowserRouter`) para compatibilidade com Electron — o Electron serve arquivos estáticos e não processa server-side routing.

---

## 9. Datasets Bioinformáticos Necessários

Todos os datasets ficam em `~/pantherflow-clinical/datasets/` no WSL2:

| Arquivo | Tamanho Aprox. | Fonte | Função |
|---|---|---|---|
| `Homo_sapiens_assembly38.fasta` + índices BWA | ~3 GB | GATK Resource Bundle (Broad) | Genoma de referência hg38 |
| `af-only-gnomad.hg38.vcf.gz` + `.tbi` | ~4 GB | Broad Institute | germline-resource Mutect2 + anotação populacional |
| `alvo_qualimap_6col.bed` | ~KB | Painel AmpliSeq | Painel alvo — restringe chamada às regiões do painel |
| `snpeff_data/GRCh38.99/` | ~15 GB | SnpEff (auto-download) | Banco de transcritos para anotação funcional |
| `clinvar.vcf.gz` + `.tbi` | ~500 MB | NCBI ClinVar | Patogenicidade clínica (CLNSIG, CLNDN) |
| `Cosmic_GenomeScreensMutant_v103_GRCh38.vcf.gz` | ~2 GB | COSMIC (requer licença) | Frequência oncológica (CNT) |

---

## 10. Componentes React Principais

### Results.jsx (laudo clínico — componente mais complexo)

**Estados:**
- `runData` — dados completos da análise do banco
- `activePageTab` — `'laudo'` | `'qc'`
- `activeCallerTab` — `'varscan'` | `'mutect'` | `'consensus'`
- `filtroCromossomo` — filtro dinâmico por cromossomo na tabela

**Sub-componentes internos:**
- `ImpactBadge` — badge colorido por classificação SnpEff (HIGH/MODERATE/LOW/MODIFIER)
- `ClinvarBadge` — badge por patogenicidade ClinVar com casos (Pathogenic, VUS, Benign, Conflicting)
- `VariantTable` — tabela completa com 11 colunas, sempre exibe ClinVar e COSMIC

**Visualizações:**
- ScatterChart (Recharts) — VAF × Profundidade por caller
- Heatmap de densidade alélica — 3 callers × 4 faixas de VAF
- Scorecards — contagem de variantes por caller
- Telemetria de tempo por etapa

### MonitorFeature.jsx

**Dois pollings independentes:**
- A cada 3s: `GET /api/history` (status geral) + `GET /api/health` (hardware)
- A cada 2s: `GET /api/analysis/{uuid}/console` (logs — só quando status=processing)

**Comportamento:** recebe o UUID via `useLocation().state.activeUuid` da navegação do Dashboard.

### UploadForm.jsx

Suporte a **Paired-End** (R1 + R2) e **Single-End** (apenas R1). Detecção automática de R2 por regex no nome do arquivo (`_R2_`, `.R2.`, `_2.`). Configuração de VAF (5–30%) e Min DP (50–500×) via sliders.

---

## 11. Variáveis de Ambiente

Arquivo: `backend/.env`

| Variável | Padrão | Descrição |
|---|---|---|
| `WSL_USER` | `ubuntu` | Usuário Linux no WSL2 — define o path base `/home/{WSL_USER}/pantherflow-clinical` |

---

## 12. Padrões de Desenvolvimento Estabelecidos

- **Sem SAM em disco:** BWA-MEM → samtools via pipe interno no container — elimina ~50 GB de I/O por amostra
- **UUID como namespace:** todos os arquivos intermediários usam o UUID como prefixo — sem colisão entre análises simultâneas
- **Fallback em cascata:** falha de anotação (SnpEff, ClinVar, COSMIC, gnomAD) nunca bloqueia o laudo — o VCF anterior na cadeia é usado
- **Log em arquivo:** `escrever_log_ui()` grava em `{uuid}.log` no WSL — o frontend faz polling via `/api/analysis/{uuid}/console`
- **Thread dedicada para pipe:** `_executar_docker()` usa uma thread separada para leitura do PIPE do subprocess, evitando o hang do Docker Desktop no Windows (bug de teardown WSL2)
- **Normalização obrigatória antes do consenso:** VarScan2 emite cromossomos sem `chr` e sem `##contig` no header — dois passos de correção antes do bcftools norm

---

## 13. Bugs Conhecidos / Pendentes

| ID | Componente | Descrição |
|---|---|---|
| BUG-N7 | UploadForm | `isFormValid` exige R2 — modo Single-End inacessível via UI |
| BUG-N8 | MonitorFeature | Perde UUID no refresh (F5) — `useLocation().state` some |
| BUG-N9 | main.py | `pantherflow.log` criado no CWD em vez de junto ao `main.py` |
| BUG-N10 | main.py | `delete_analysis` usa `os.remove()` — falha em pastas Qualimap (diretório, não arquivo) |
| BUG-N12 | UploadForm | Campo `protocol` resetado para string vazia após submit |
| BUG-N14 | Results.jsx | Classes Tailwind do `onError` do FastQC geradas dinamicamente — não entram no bundle CSS em produção |
