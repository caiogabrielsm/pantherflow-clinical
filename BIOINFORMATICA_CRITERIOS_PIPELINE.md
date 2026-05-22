# Critérios Bioinformáticos do Pipeline PantherFlow Clinical

**Versão:** 1.0 | **Referência genômica:** GRCh38 / hg38 | **Modalidade:** Tumor-Only, AmpliSeq (SNPs + INDELs)

---

## Visão Geral

O PantherFlow Clinical implementa um pipeline de chamada de variantes somáticas baseado em **consenso multi-caller** (VarScan2 ∩ Mutect2). A interseção dos dois callers é a estratégia central de qualidade: variantes confirmadas por ambos têm especificidade muito superior a qualquer caller isolado. O padrão metodológico segue o **GDC (Genomic Data Commons) do NIH** para análise tumor-only.

---

## Etapa 0 — Validação de Índices Genômicos

**Ferramenta:** verificação de arquivo (Python)

Antes de qualquer processamento, o pipeline valida a existência de todos os 5 índices BWA obrigatórios (`.bwt`, `.pac`, `.ann`, `.amb`, `.sa`) derivados do genoma de referência `Homo_sapiens_assembly38.fasta`. A ausência de qualquer índice gera falha imediata com mensagem clara — impede que o alinhamento produza resultados silenciosamente incorretos.

---

## Etapa 0.5 — Controle de Qualidade Bruto (FastQC)

**Ferramenta:** FastQC

Avalia a qualidade das leituras cruas do sequenciador (arquivo FASTQ) antes de qualquer processamento. Gera um relatório HTML com métricas de:
- Qualidade por base (Phred score por posição)
- Conteúdo GC e distribuição de bases
- Presença de adaptadores
- Duplicações de sequência

O relatório é servido pelo backend e exibido na aba "Controle de Qualidade" do laudo. Um FastQC com muitas bases de baixa qualidade antecipa problemas de alinhamento e chamada de variantes.

---

## Etapa 0.75 — Limpeza de Leituras (Trimmomatic)

**Ferramenta:** Trimmomatic

Remove adaptadores de sequenciamento e bases de baixa qualidade antes do alinhamento.

### Parâmetros aplicados

| Parâmetro | Valor | Significado |
|---|---|---|
| `ILLUMINACLIP` | `TruSeq3-PE.fa:2:30:10:8:true` | Remove adaptadores TruSeq3 Illumina. Tolerância: 2 mismatches, threshold palindrômico 30, simples 10, tamanho mínimo 8 bp, mantém ambas as leituras |
| `LEADING` | 3 | Remove bases no início da leitura com Phred < 3 |
| `TRAILING` | 3 | Remove bases no final da leitura com Phred < 3 |
| `SLIDINGWINDOW` | 4:15 | Janela deslizante de 4 bases; corta quando a média de qualidade cai abaixo de Phred 15 |
| `MINLEN` | 36 | Descarta leituras com menos de 36 bp após trimagem — abaixo disso o alinhamento fica não específico |

### Modo Paired-End vs. Single-End

- **PE:** 2 inputs → 4 outputs (`_paired` e `_unpaired` para R1 e R2). Apenas reads paired são usados no alinhamento.
- **SE:** 1 input → 1 output (`_trimmed`).

---

## Etapas 1+2 — Alinhamento e Conversão BAM (BWA-MEM + Samtools)

**Ferramentas:** BWA-MEM 0.7.17, Samtools 1.13

O alinhamento usa pipeline unificado via UNIX pipe dentro do container — o SAM intermediário nunca é gravado em disco, eliminando até ~50 GB de I/O por amostra WES.

### Parâmetros BWA-MEM

| Parâmetro | Valor | Significado |
|---|---|---|
| `-t` | 4 | Threads paralelos |
| `-R` | `@RG\tID:{uuid}\tSM:{uuid}\tPL:ILLUMINA\tLB:lib1` | Read Group obrigatório para o Mutect2 identificar a amostra pelo campo `SM:` |

### Pipeline interno

```
bwa mem → samtools view (SAM→BAM) → samtools sort → samtools index
```

O flag `set -o pipefail` propaga o código de retorno de qualquer falha no meio do pipe — evita que o pipeline continue com um BAM corrompido silenciosamente.

---

## Etapa 2.5 — Controle de Qualidade do Alinhamento (Qualimap)

**Ferramenta:** Qualimap bamqc

Avalia a qualidade do BAM alinhado, restrito ao painel alvo (arquivo BED de 6 colunas).

### Métricas extraídas

- **Profundidade Média (Mean Coverage):** lida do arquivo `genome_results.txt`, campo `mean coverageData`. Indica quantas leituras cobrem em média cada base do painel. Padrão GDC recomenda ≥ 100×.
- **Total de Reads:** extraído do `samtools flagstat` — campo `in total`.
- **Taxa de Mapeamento:** percentual de reads alinhados com sucesso ao genoma — campo `mapped (X%)` do flagstat. Valores < 80% indicam contaminação ou problema na preparação da amostra.

---

## Etapa 4 — Chamada de Variantes Somáticas: VarScan2

**Ferramenta:** VarScan2 `mpileup2cns`

VarScan2 opera como "rede larga" no consenso — alta sensibilidade, aceita variantes que o Mutect2 pode perder em regiões de baixa cobertura ou VAF muito baixo.

### Parâmetros

| Parâmetro | Valor | Significado |
|---|---|---|
| `--min-var-freq` | configurável (padrão: 0.05 = 5%) | VAF mínimo para emissão de variante. Limiar clínico: detecta variantes subclonais |
| `--min-coverage` | configurável (padrão: 100) | Profundidade mínima de cobertura. Padrão GDC: 100× |
| `--min-reads2` | 5 | Mínimo de reads suportando o alelo alternativo — mantém precisão a VAF baixo |
| `--strand-filter` | 0 | **Desativado** intencionalmente. Rationale: variantes com strand bias que forem artefatos serão filtradas pelo FilterMutectCalls (GATK) na interseção. Ativar aqui reduziria o recall sem ganho real de especificidade no laudo final |
| `-B` (mpileup) | flag | Desativa o ajuste de qualidade de base BAQ — necessário para AmpliSeq onde o amplicon pode gerar scores BAQ artificialmente baixos |
| `-l` (mpileup) | BED do painel | Restringe o pileup ao painel alvo — reduz drasticamente o tempo e o ruído de fundo |
| `--output-vcf 1` | flag | Emite saída no formato VCF em vez do formato tabular nativo do VarScan2 |
| `--variants` | flag | Emite apenas posições variantes — omite posições com apenas referência |

### Tipos de variantes chamadas

- **SNPs** (substituições de base única)
- **INDELs** (inserções e deleções) — chamados simultaneamente pelo `mpileup2cns`

---

## Etapa 4.5 — Chamada de Variantes Somáticas: Mutect2

**Ferramenta:** GATK Mutect2 (modo tumor-only)

Mutect2 usa um modelo probabilístico bayesiano para distinguir variantes somáticas de ruído técnico e variantes germinativas — mais sofisticado que o VarScan2, mas mais conservador.

### Parâmetros

| Parâmetro | Valor | Significado |
|---|---|---|
| `-min-AF` | configurável (mesmo VAF do VarScan2) | VAF mínimo de emissão — alinhado com VarScan2 para comparabilidade |
| `--germline-resource` | `af-only-gnomad.hg38.vcf.gz` | Banco gnomAD AF-only: penaliza variantes com alta frequência populacional (≥ 0.001), separando variantes somáticas raras de polimorfismos germinais comuns. Padrão GATK Best Practices |
| `--f1r2-tar-gz` | arquivo por análise | Coleta estatísticas de orientação de leitura F1R2 durante a chamada, para alimentar o LearnReadOrientationModel |
| `-L` | BED do painel | Restringe a chamada ao painel alvo |

---

## Etapa 4.5.5 — Modelo de Artefatos de Orientação (LearnReadOrientationModel)

**Ferramenta:** GATK LearnReadOrientationModel

Aprende um modelo probabilístico de artefatos de orientação de fragmento a partir das estatísticas F1R2 coletadas pelo Mutect2. Esses artefatos surgem de:
- **OxoG (8-oxoguanina):** lesão oxidativa em DNA formalinizado (FFPE) que gera mutações C→A/G→T falsas
- **Artefatos FFPE:** deaminação de citosina em tecidos fixados em formalina

O modelo `.tar.gz` gerado é passado ao FilterMutectCalls via `--ob-priors`, substituindo o `FilterByOrientationBias` descontinuado no GATK ≥ 4.2. Se falhar, o pipeline continua sem o modelo (fallback seguro).

---

## Etapa 4.55 — Estimativa de Contaminação (GDC)

**Ferramentas:** GATK GetPileupSummaries + CalculateContamination

Padrão GDC NIH para análise tumor-only. Estima a fração de contaminação cruzada entre amostras usando variantes populacionais do gnomAD como âncoras.

### Fluxo

1. **GetPileupSummaries:** gera um sumário de pileup nas posições polimórficas do gnomAD
2. **CalculateContamination:** calcula a fração de contaminação estimada a partir do sumário

A tabela resultante é passada ao FilterMutectCalls via `--contamination-table`, ajustando os limiares de filtro ao nível real de contaminação da amostra. Se qualquer etapa falhar, o FilterMutectCalls roda no modo padrão — laudo não é bloqueado.

---

## Etapa 4.6 — Filtragem Estatística (FilterMutectCalls)

**Ferramenta:** GATK FilterMutectCalls

Aplica os filtros estatísticos do GATK ao VCF bruto do Mutect2. Somente variantes com `FILTER=PASS` entram no cálculo de consenso. Os filtros incluem:

| Filtro GATK | Significado |
|---|---|
| `strand_bias` | Viés de fita — variante encontrada majoritariamente em uma direção de leitura |
| `weak_evidence` | TLOD (Tumor Log Odds) abaixo do limiar — suporte estatístico insuficiente |
| `germline` | Variante com frequência populacional alta no gnomAD — provavelmente germinal |
| `contamination` | Compatível com contaminação cruzada (se modelo disponível) |
| `orientation_bias` | Artefato de orientação de fragmento OxoG/FFPE (se modelo F1R2 disponível) |
| `low_allele_frac` | VAF abaixo do limiar mínimo configurado |

**Parâmetro crítico:** `--min-allele-fraction` é sincronizado com o VAF configurado pelo usuário. Sem esse parâmetro, o filtro `low_allele_frac` do GATK descartaria variantes subclonais que o VarScan2 já chamou — o consenso nunca refletiria a configuração customizada.

---

## Etapa 4.7 — Normalização Canônica (bcftools norm)

**Ferramenta:** bcftools norm

INDELs podem ser representados de formas diferentes por VarScan2 e Mutect2:
- **Left-alignment vs. Right-alignment:** a mesma deleção de 2 bp pode ter posição diferente dependendo do caller
- **Multi-alélico vs. Bi-alélico:** uma posição com 2 alelos alternativos pode ser uma linha ou duas

Sem normalização, a interseção perderia variantes biologicamente concordantes mas representadas diferentemente.

### Etapas de normalização do VarScan2

1. **Renomeação de cromossomos (`sed`):** VarScan2 emite cromossomos sem prefixo `chr` (ex: `1`, `2`). A referência hg38 usa `chr1`, `chr2`. O `sed` injeta o prefixo idempotentemente (não duplica se já existir)
2. **Reheader (`bcftools reheader --fai`):** VarScan2 não gera declarações `##contig` no cabeçalho VCF. O bcftools norm falha sem elas. O `reheader` injeta os `##contig` lendo o índice FASTA (`.fai`)
3. **Normalização (`bcftools norm -m-any`):** divide registros multi-alélicos e executa left-alignment

O Mutect2 já emite cromossomos com `chr` e headers GATK completos — passa direto pelo `bcftools norm`.

---

## Etapa 5 — Consenso Multi-Caller (VarScan2 ∩ Mutect2)

**Lógica:** interseção de sets Python por tupla `(CHROM, POS, REF, ALT)`

### Critério de inclusão no consenso

Uma variante entra no consenso se e somente se:
1. **VarScan2** a chamou (FILTER = `PASS` ou `.`)
2. **Mutect2** a chamou **E** passou o FilterMutectCalls (FILTER = `PASS`)
3. As representações canônicas de `(CHROM, POS, REF, ALT)` coincidem após normalização

### Rationale biológico

| Cenário | Interpretação |
|---|---|
| Só VarScan2 | Possível artefato, baixa cobertura, ou variante com strand bias rejeitada pelo GATK |
| Só Mutect2 | Variante real mas não detectada pelo VarScan2 (abaixo do limiar de frequência ou cobertura) |
| **Ambos (Consenso)** | **Alta confiança — dois modelos matemáticos independentes concordaram** |
| Consenso = 0 | Biologicamente correto quando os callers chamaram variantes em posições distintas; comum com dados de teste de baixa cobertura |

### Template do VCF de consenso

O Mutect2 é usado como template para o arquivo `_consensus.vcf` porque seus headers são compatíveis com o SnpEff (formato GATK). O arquivo é criado filtrando as linhas do VCF do Mutect2 pelo set de consenso.

---

## Etapa 5.5 — Anotação Funcional (SnpEff)

**Ferramenta:** SnpEff GRCh38.99

Anota cada variante com seu impacto biológico previsto usando o banco de dados de transcritos GRCh38.99 (Ensembl release 99).

### Campo ANN= (pipe-delimitado)

```
ANN=ALT | effect | impact | gene | gene_id | feature_type | feature_id |
         transcript_biotype | rank | hgvs_c | hgvs_p | ...
```

### Classificação de impacto

| Classe | Exemplos | Significado clínico |
|---|---|---|
| **HIGH** | frameshift, stop_gained, splice_donor | Perda provável de função proteica — alto interesse clínico |
| **MODERATE** | missense_variant, inframe_del | Mudança de aminoácido — pode alterar função, requer interpretação |
| **LOW** | synonymous_variant, stop_retained | Sem mudança de aminoácido ou impacto mínimo |
| **MODIFIER** | intron_variant, upstream_gene_variant | Região não-codificante ou impacto regulatório incerto |

O SnpEff é executado separadamente para VarScan2, Mutect2 e Consenso — permitindo visualização de impacto funcional em todos os callers no laudo.

---

## Etapa 5.6 — Anotação Clínica (SnpSift + ClinVar)

**Ferramenta:** SnpSift annotate | **Banco:** ClinVar (NCBI)

Injeta os campos `CLNSIG` e `CLNDN` do ClinVar no VCF de consenso.

| Campo | Conteúdo |
|---|---|
| `CLNSIG` | Classificação de patogenicidade: Pathogenic, Likely_pathogenic, Benign, Likely_benign, Uncertain_significance (VUS), Conflicting_interpretations |
| `CLNDN` | Nome(s) da doença associada (MedGen/OMIM) |

O ClinVar é a referência padrão da comunidade para interpretação clínica de variantes germinativas e somáticas recorrentes. Uma variante `Pathogenic` no ClinVar tem evidência de associação causal com doença publicada na literatura revisada por pares.

---

## Etapa 5.7 — Anotação Oncológica (SnpSift + COSMIC)

**Ferramenta:** SnpSift annotate | **Banco:** COSMIC v103 Genome Screens Mutant (GRCh38)

Injeta o campo `CNT` (contagem de ocorrências no COSMIC).

| Campo | Conteúdo |
|---|---|
| `CNT` | Número de amostras tumorais no COSMIC onde esta variante foi identificada |

Um `CNT` alto indica uma variante recorrente em tumores humanos — forte evidência de relevância oncológica. Variantes com `CNT > 10` são consideradas hotspots de alta relevância clínica na maioria dos painéis oncológicos.

---

## Etapa 5.8 — Anotação Populacional (SnpSift + gnomAD)

**Ferramenta:** SnpSift annotate | **Banco:** gnomAD AF-only hg38

Injeta o campo `AF` (frequência alélica na população geral do gnomAD v3/v4, GRCh38).

### Interpretação clínica do AF

| Faixa de AF | Interpretação |
|---|---|
| `AF = 0` ou ausente | Variante não observada na população geral — potencialmente somática |
| `AF < 0.001` (< 0.1%) | Variante rara — pode ser patogênica ou somática adquirida |
| `AF 0.001 – 0.01` (0.1% – 1%) | Variante incomum — interpretação depende do fenótipo |
| `AF > 0.01` (> 1%) | **Polimorfismo comum** — provavelmente variante germinal benigna, exibida com badge cinza no laudo |

O gnomAD foi usado também como `--germline-resource` no Mutect2 (Etapa 4.5) para filtrar variantes germinativas durante a chamada — o mesmo banco serve duas funções complementares no pipeline.

---

## Parâmetros Configuráveis pelo Usuário

| Parâmetro | Padrão | Descrição |
|---|---|---|
| **VAF mínimo** | 5% (0.05) | Frequência alélica mínima para emissão de variante. Aplicado em VarScan2 (`--min-var-freq`) e Mutect2 (`-min-AF`, `--min-allele-fraction`). Reduzir aumenta sensibilidade para variantes subclonais; aumentar reduz ruído |
| **Profundidade mínima** | 100× | Cobertura mínima exigida pelo VarScan2 (`--min-coverage`). Padrão GDC NIH. Amostras abaixo deste valor podem gerar falsos negativos |

---

## Cadeia de Fallbacks de Qualidade

O pipeline nunca bloqueia o laudo por falha de uma etapa acessória:

```
LearnReadOrientationModel falhou → FilterMutectCalls sem --ob-priors
CalculateContamination falhou   → FilterMutectCalls sem --contamination-table
bcftools norm falhou            → usa VCF bruto do caller
SnpEff falhou                   → tabela mostra "—" nos campos funcionais
ClinVar falhou                  → campos CLNSIG/CLNDN ausentes no laudo
COSMIC falhou                   → copia VCF anterior na cadeia como fallback
gnomAD falhou                   → copia VCF anterior na cadeia como fallback
Consenso vazio                  → etapas 5.5–5.8 ignoradas; laudo emitido com VarScan2 e Mutect2
```

---

## Referências Metodológicas

- **GDC Somatic Mutation Calling:** https://docs.gdc.cancer.gov/Data/Bioinformatics_Pipelines/DNA_Seq_Variant_Calling_Pipeline/
- **GATK Best Practices (Tumor-Only):** Broad Institute, 2023
- **SnpEff:** Cingolani et al., *Fly*, 2012
- **VarScan2:** Koboldt et al., *Genome Research*, 2012
- **Mutect2:** Benjamin et al., *bioRxiv*, 2019
- **gnomAD:** Karczewski et al., *Nature*, 2020
- **COSMIC v103:** Tate et al., *Nucleic Acids Research*, 2019
- **Trimmomatic:** Bolger et al., *Bioinformatics*, 2014
