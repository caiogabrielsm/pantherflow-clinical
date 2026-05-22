# PantherFlow Clinical — Arquitetura da Pipeline (V9 Stable)

**Padrão:** Tumor-Only Somatic Variant Calling (AmpliSeq / WES)
**Conformidade:** GATK Best Practices + GDC NIH Standards

---

## Fluxo de Dados Completo

```
┌─────────────────────────────────────────────────────────────────────┐
│                          INPUTS                                     │
│                                                                     │
│   FASTQ R1 (Forward)          FASTQ R2 (Reverse)                   │
│   [*_R1.fastq.gz]             [*_R2.fastq.gz]                      │
└───────────────┬───────────────────────┬─────────────────────────────┘
                │                       │
                ▼                       ▼
┌─────────────────────────────────────────────────────────────────────┐
│                  ETAPA 0.5 — FastQC (QC Bruto)                     │
│                                                                     │
│   fastqc R1 R2 -o /processamento/                                  │
│   → {uuid}_R1_fastqc.html  |  {uuid}_R2_fastqc.html               │
└───────────────────────────┬─────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────────┐
│             ETAPA 0.75 — Trimmomatic (Limpeza PE)                  │
│                                                                     │
│   trimmomatic PE -threads 4                                        │
│     ILLUMINACLIP:TruSeq3-PE.fa:2:30:10:8:true                     │
│     LEADING:3  TRAILING:3  SLIDINGWINDOW:4:15  MINLEN:36           │
│                                                                     │
│   → R1_paired.fastq.gz        R2_paired.fastq.gz                  │
│     R1_unpaired.fastq.gz      R2_unpaired.fastq.gz  (descartados) │
└───────────────────────────┬─────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────────┐
│        ETAPAS 1+2 — Alinhamento Otimizado (sem .sam em disco)      │
│                                                                     │
│   bwa mem -t 4 -R '@RG...' hg38.fasta R1_paired R2_paired         │
│        │                                                            │
│        │ (stdout pipe — nunca gravado em disco)                    │
│        ▼                                                            │
│   samtools view -@ 4 -Sb -                                         │
│        │                                                            │
│        ▼                                                            │
│   samtools sort -@ 4 -o {uuid}.bam                                 │
│        │                                                            │
│        ▼                                                            │
│   samtools index -@ 4 {uuid}.bam                                   │
│                                                                     │
│   → {uuid}.bam  +  {uuid}.bam.bai                                 │
└───────────────────────────┬─────────────────────────────────────────┘
                            │
                ┌───────────┴───────────────────────────┐
                ▼                                       ▼
┌───────────────────────────────┐   ┌───────────────────────────────────┐
│  ETAPA 2.5 — Qualimap (BAM)  │   │  ETAPA 3 — Flagstat (Métricas)   │
│                               │   │                                   │
│  qualimap bamqc               │   │  samtools flagstat {uuid}.bam     │
│   -bam {uuid}.bam             │   │  → total_reads                   │
│   -gff alvo_qualimap.bed      │   │  → mapping_rate                  │
│   -outformat HTML             │   │  → mean_coverage (genome_results) │
│                               │   │                                   │
│  → {uuid}_qualimap/           │   └───────────────────────────────────┘
│    qualimapReport.html        │
└───────────────────────────────┘
                │
                ▼
┌─────────────────────────────────────────────────────────────────────┐
│          BLOCO GDC NIH — Modelos de Qualidade (pré-chamada)        │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  ETAPA 4.55 — Modelo de Contaminação Cruzada               │   │
│  │                                                             │   │
│  │  gatk GetPileupSummaries                                    │   │
│  │    -V af-only-gnomad.hg38.vcf.gz                           │   │
│  │    → {uuid}_pileup.table                                   │   │
│  │            │                                               │   │
│  │            ▼                                               │   │
│  │  gatk CalculateContamination                               │   │
│  │    → {uuid}_contamination.table  [flag: use_contamination] │   │
│  │                                                             │   │
│  │  ⚠ Fallback: se falhar → FilterMutectCalls sem --contam.  │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  ETAPA 4.5.5 — Modelo de Orientação F1R2 (OxoG/FFPE)      │   │
│  │                                                             │   │
│  │  [coletado durante o Mutect2 via --f1r2-tar-gz]            │   │
│  │            │                                               │   │
│  │            ▼                                               │   │
│  │  gatk LearnReadOrientationModel                            │   │
│  │    → {uuid}_read_orientation_model.tar.gz                  │   │
│  │                                       [flag: use_orient.]  │   │
│  │  ⚠ Substitui FilterByOrientationBias (deprecated GATK 4.6)│   │
│  │  ⚠ Fallback: se falhar → FilterMutectCalls sem --ob-priors│   │
│  └─────────────────────────────────────────────────────────────┘   │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
              ┌────────────────┴────────────────┐
              │                                 │
              ▼                                 ▼
┌────────────────────────────┐   ┌──────────────────────────────────────┐
│  CALLER A — VarScan2       │   │  CALLER B — Mutect2 (GATK)          │
│  (Alta Sensibilidade)      │   │  (Alta Especificidade)               │
│                            │   │                                      │
│  samtools mpileup          │   │  gatk Mutect2                       │
│   -B -l alvo.bed           │   │   -R hg38.fasta                     │
│   -f hg38.fasta            │   │   --tumor-sample {uuid}             │
│   {uuid}.bam               │   │   -L alvo.bed                       │
│        │                   │   │   --germline-resource gnomad.vcf.gz  │
│        ▼                   │   │   --f1r2-tar-gz {uuid}_f1r2.tar.gz  │
│  varscan mpileup2cns       │   │   → {uuid}_mutect_raw.vcf           │
│   --variants               │   │            │                        │
│   --output-vcf 1           │   │            ▼                        │
│   --min-var-freq 0.05      │   │  gatk FilterMutectCalls             │
│   --min-coverage 20        │   │   --contamination-table [se disp.]  │
│   --min-reads2 5           │   │   --ob-priors [se disp.]            │
│   --strand-filter 0        │   │   → {uuid}_mutect.vcf               │
│   → {uuid}_varscan.vcf     │   │            │                        │
│        │                   │   │            ▼                        │
│        │                   │   │  bcftools norm                      │
│        ▼                   │   │   -m-any -f hg38.fasta              │
│  sed '/^[^#]/ s/^/chr/'   │   │   → {uuid}_mutect_norm.vcf          │
│   → {uuid}_varscan_renamed │   │                                      │
│        │                   │   └──────────────────┬───────────────────┘
│        ▼                   │                      │
│  bcftools norm             │                      │
│   -m-any -f hg38.fasta     │                      │
│   → {uuid}_varscan_norm    │                      │
└─────────────┬──────────────┘                      │
              │                                     │
              └──────────────┬──────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│                 ETAPA 5 — Consenso Multi-Caller                    │
│                                                                     │
│   set_varscan  = parse_vcf(_varscan_norm)                          │
│   set_mutect   = parse_vcf(_mutect_norm)                           │
│                                                                     │
│   set_consenso = set_varscan ∩ set_mutect                          │
│                                                                     │
│   template VCF: Mutect2 (headers GATK compatíveis com SnpEff)     │
│   → {uuid}_consensus.vcf                                           │
│                                                                     │
│   ┌──────────────┬──────────────┬────────────────┐                │
│   │ VarScan2 (N) │ Mutect2  (N) │ Consenso   (N) │                │
│   │ variants     │ variants     │ variants        │                │
│   └──────────────┴──────────────┴────────────────┘                │
└───────────────────────────┬─────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────────┐
│           BLOCO ANOTAÇÃO FUNCIONAL (SnpEff + SnpSift)              │
│                                                                     │
│  ┌────────────────────────────────────────────────────────────┐    │
│  │  ETAPA 5.5 — SnpEff (Impacto Funcional)                   │    │
│  │                                                            │    │
│  │  snpEff ann GRCh38.99                                      │    │
│  │    {uuid}_varscan.vcf   → {uuid}_varscan_annotated.vcf     │    │
│  │    {uuid}_mutect.vcf    → {uuid}_mutect_annotated.vcf      │    │
│  │    {uuid}_consensus.vcf → {uuid}_consensus_snpeff.vcf      │    │
│  │                                                            │    │
│  │  Campos: ANN= (effect | impact | gene | hgvs_p)           │    │
│  └───────────────────────────┬────────────────────────────────┘    │
│                              │                                      │
│                              ▼                                      │
│  ┌────────────────────────────────────────────────────────────┐    │
│  │  ETAPA 5.6 — SnpSift ClinVar (Patogenicidade)             │    │
│  │                                                            │    │
│  │  java -jar SnpSift.jar annotate                            │    │
│  │    -info CLNSIG,CLNDN                                      │    │
│  │    clinvar.vcf.gz                                          │    │
│  │    {uuid}_consensus_snpeff.vcf                             │    │
│  │    → {uuid}_consensus_clinvar.vcf                          │    │
│  │                                                            │    │
│  │  ⚠ Fallback: se falhar → usa snpeff.vcf na etapa seguinte │    │
│  └───────────────────────────┬────────────────────────────────┘    │
│                              │                                      │
│                              ▼                                      │
│  ┌────────────────────────────────────────────────────────────┐    │
│  │  ETAPA 5.7 — SnpSift COSMIC (Frequência Oncológica)       │    │
│  │                                                            │    │
│  │  java -jar SnpSift.jar annotate                            │    │
│  │    -info CNT                                               │    │
│  │    Cosmic_GenomeScreensMutant_v103_GRCh38.vcf.gz           │    │
│  │    {clinvar.vcf ou snpeff.vcf}                             │    │
│  │    → {uuid}_consensus_annotated.vcf                        │    │
│  │                                                            │    │
│  │  ⚠ Fallback: se falhar → shutil.copy2 do VCF anterior     │    │
│  └────────────────────────────────────────────────────────────┘    │
└───────────────────────────┬─────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────────┐
│                       OUTPUTS FINAIS                               │
│                                                                     │
│   {uuid}_consensus_annotated.vcf  ← VCF anotado completo          │
│                                                                     │
│   annotation_summary (JSON → SQLite)                               │
│   ┌──────────────────────────────────────────────────────────┐     │
│   │  total_annotated | high_impact | moderate_impact         │     │
│   │  low_impact | modifier_impact | top_variants (≤20)       │     │
│   │  clinvar_sig | clinvar_disease | cosmic_cnt              │     │
│   └──────────────────────────────────────────────────────────┘     │
│                                                                     │
│   varscan_details  (JSON → SQLite)  ← top_variants VarScan2        │
│   mutect_details   (JSON → SQLite)  ← top_variants Mutect2         │
│   time_steps       (JSON → SQLite)  ← telemetria por etapa         │
│   time_total       (String)         ← tempo total da pipeline      │
│   biological_sex   (String M/F)     ← rastreabilidade clínica      │
│                                                                     │
│   STATUS: "completed" → React Results.jsx renderiza o laudo        │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Árvore de Arquivos por Amostra (`/processamento/{uuid}/`)

```
{uuid}/
├── {uuid}_R1.fastq.gz                  ← Input original
├── {uuid}_R2.fastq.gz                  ← Input original
│
├── {uuid}_R1_paired.fastq.gz           ← Trimmomatic PE output
├── {uuid}_R2_paired.fastq.gz
│
├── {uuid}.bam                          ← BWA+Samtools (sem .sam em disco)
├── {uuid}.bam.bai                      ← Índice obrigatório para GATK
│
├── {uuid}_qualimap/                    ← Relatório HTML Qualimap
│   └── qualimapReport.html
│
├── {uuid}_pileup.table                 ← GetPileupSummaries (GDC)
├── {uuid}_contamination.table          ← CalculateContamination (GDC)
├── {uuid}_f1r2.tar.gz                  ← Estatísticas F1R2 do Mutect2
├── {uuid}_read_orientation_model.tar.gz← LearnReadOrientationModel
│
├── {uuid}_varscan.vcf                  ← VarScan2 raw (chrs sem prefixo)
├── {uuid}_varscan_renamed.vcf          ← Após sed (chr1, chr2, ...)
├── {uuid}_varscan_norm.vcf             ← Após bcftools norm
├── {uuid}_varscan_annotated.vcf        ← Após SnpEff
│
├── {uuid}_mutect_raw.vcf               ← Mutect2 raw
├── {uuid}_mutect.vcf                   ← Após FilterMutectCalls
├── {uuid}_mutect_norm.vcf              ← Após bcftools norm
├── {uuid}_mutect_annotated.vcf         ← Após SnpEff
│
├── {uuid}_consensus.vcf                ← Interseção VarScan2 ∩ Mutect2
├── {uuid}_consensus_snpeff.vcf         ← Após SnpEff
├── {uuid}_consensus_clinvar.vcf        ← Após SnpSift ClinVar
├── {uuid}_consensus_annotated.vcf      ← OUTPUT FINAL (SnpSift COSMIC)
│
└── {uuid}.log                          ← Log UI em tempo real (React /monitor)
```

---

## Tabela de Ferramentas e Versões

| Ferramenta           | Versão (Conda/bioconda) | Função                              |
|----------------------|-------------------------|-------------------------------------|
| FastQC               | latest                  | QC bruto das leituras               |
| Trimmomatic          | latest                  | Remoção de adaptadores (PE)         |
| BWA                  | 0.7.17                  | Alinhamento contra hg38             |
| Samtools             | 1.13+                   | Conversão SAM→BAM, sort, index      |
| Qualimap             | latest                  | QC do alinhamento (BAM)             |
| GATK4                | 4.x                     | Mutect2, FilterMutectCalls, GDC     |
| VarScan2             | latest                  | Chamada de variantes somáticas      |
| bcftools             | >=1.18                  | Normalização de VCFs                |
| SnpEff               | GRCh38.99               | Anotação funcional                  |
| SnpSift              | latest (bioconda)       | Anotação ClinVar + COSMIC           |
| Referência           | hg38 (assembly38)       | Homo_sapiens_assembly38.fasta       |
| gnomAD               | af-only hg38            | Germline resource (Mutect2)         |
| ClinVar              | latest                  | Patogenicidade (CLNSIG, CLNDN)      |
| COSMIC               | v103 GRCh38             | Frequência oncológica (CNT)         |

---

## Modelo de Fallback em Cascata

```
Etapa falha?
     │
     ├─ FATAL (raise Exception) ──────────────────────────────────────┐
     │   FastQC, Trimmomatic, BWA+Samtools,                           │
     │   Qualimap, VarScan2, Mutect2,                                 │
     │   FilterMutectCalls, SnpEff Consenso                           │
     │                                                              status="failed"
     │
     └─ AVISO ([AVISO] no log, pipeline continua) ────────────────────┐
         GetPileupSummaries    → FilterMutectCalls sem --contam.      │
         CalculateContamination→ FilterMutectCalls sem --contam.      │
         LearnReadOrientationModel → FilterMutectCalls sem --ob-priors│
         bcftools rename (sed) → norm usa VCF original               │
         bcftools norm         → consenso usa VCF bruto              │
         SnpEff VarScan2/Mutect2 → tabelas individuais vazias        │
         SnpSift ClinVar       → COSMIC usa _snpeff.vcf              │
         SnpSift COSMIC        → shutil.copy2 do VCF anterior        │
                                                                   laudo gerado
```

---

*Gerado automaticamente — PantherFlow Clinical V9 Stable | 2026-04-14*
