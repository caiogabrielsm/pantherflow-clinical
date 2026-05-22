"""
Gera o relatório técnico do pipeline.py em PDF.
Uso: python gerar_relatorio_pdf.py
"""
from fpdf import FPDF, FontFace
from fpdf.enums import XPos, YPos
from datetime import date

OUTPUT = "Relatorio_Pipeline_PantherFlow.pdf"
FONT_DIR = r"C:\Windows\Fonts"

# Largura útil: A4(210) - margem_esq(18) - margem_dir(18) = 174mm
PAGE_W = 174


class PDF(FPDF):
    def _setup_fonts(self):
        self.add_font("Arial",  "",  rf"{FONT_DIR}\arial.ttf")
        self.add_font("Arial",  "B", rf"{FONT_DIR}\arialbd.ttf")
        self.add_font("Arial",  "I", rf"{FONT_DIR}\ariali.ttf")

    def header(self):
        self.set_font("Arial", "B", 8)
        self.set_text_color(120, 120, 120)
        self.cell(0, 7, "PantherFlow Clinical — Relatório Técnico do Pipeline", align="L",
                  new_x=XPos.LMARGIN, new_y=YPos.NEXT)
        self.set_draw_color(200, 200, 200)
        self.line(self.l_margin, self.get_y(), self.w - self.r_margin, self.get_y())
        self.ln(3)

    def footer(self):
        self.set_y(-13)
        self.set_font("Arial", "", 8)
        self.set_text_color(150, 150, 150)
        self.cell(0, 6, f"Gerado em {date.today().isoformat()}  —  Página {self.page_no()}", align="C")

    # ── helpers de conteúdo ────────────────────────────────────────────────

    def titulo_secao(self, texto):
        self.ln(3)
        self.set_fill_color(30, 58, 95)
        self.set_text_color(255, 255, 255)
        self.set_font("Arial", "B", 10)
        self.cell(0, 7, f"  {texto}", fill=True, new_x=XPos.LMARGIN, new_y=YPos.NEXT)
        self.set_text_color(0, 0, 0)
        self.ln(2)

    def subtitulo(self, texto):
        self.set_font("Arial", "B", 9)
        self.set_text_color(30, 58, 95)
        self.multi_cell(0, 5, texto, new_x=XPos.LMARGIN, new_y=YPos.NEXT)
        self.set_text_color(0, 0, 0)
        self.ln(1)

    def corpo(self, texto):
        self.set_font("Arial", "", 9)
        self.multi_cell(0, 5, texto, new_x=XPos.LMARGIN, new_y=YPos.NEXT)
        self.ln(1)

    def bullet(self, texto, nivel=0):
        """Bullet com recuo correto ao quebrar linha."""
        self.set_font("Arial", "", 9)
        indent = 6 + nivel * 6          # distância da margem ao símbolo
        sym_w  = 5                       # largura reservada para o símbolo
        text_x = self.l_margin + indent + sym_w

        # símbolo
        self.set_x(self.l_margin + indent)
        self.cell(sym_w, 5, "•", new_x=XPos.RIGHT, new_y=YPos.TOP)

        # texto com margem esquerda temporária para manter recuo no wrap
        old_lm = self.l_margin
        self.set_left_margin(text_x)
        self.set_x(text_x)
        self.multi_cell(0, 5, texto, new_x=XPos.LMARGIN, new_y=YPos.NEXT)
        self.set_left_margin(old_lm)

    def tabela(self, cabecalhos: list, linhas: list, larguras: list):
        """Tabela com quebra automática de texto por célula."""
        # Estilo aplicado célula a célula — headings_style a nível de table()
        # não propaga a cor do texto corretamente no fpdf2 2.8.x.
        hdr_style = FontFace(
            color=(255, 255, 255),
            fill_color=(30, 58, 95),
            emphasis="BOLD",
            size_pt=8,
        )
        row_style     = FontFace(size_pt=8, color=(0, 0, 0))
        row_alt_style = FontFace(size_pt=8, color=(0, 0, 0), fill_color=(235, 241, 248))

        with self.table(
            col_widths=tuple(larguras),
            line_height=5,
            borders_layout="ALL",
            align="LEFT",
        ) as table:
            hdr = table.row()
            for cab in cabecalhos:
                hdr.cell(cab, style=hdr_style)
            for i, linha in enumerate(linhas):
                style = row_alt_style if i % 2 == 0 else row_style
                row = table.row()
                for cel in linha:
                    row.cell(cel, style=style)

        self.ln(2)


# ── conteúdo ────────────────────────────────────────────────────────────────

def build():
    pdf = PDF(orientation="P", unit="mm", format="A4")
    pdf.set_margins(18, 20, 18)
    pdf.set_auto_page_break(auto=True, margin=18)
    pdf._setup_fonts()
    pdf.add_page()

    # ── CAPA ──────────────────────────────────────────────────────────────
    pdf.ln(8)
    pdf.set_font("Arial", "B", 22)
    pdf.set_text_color(30, 58, 95)
    pdf.cell(0, 12, "PantherFlow Clinical", align="C", new_x=XPos.LMARGIN, new_y=YPos.NEXT)

    pdf.set_font("Arial", "", 13)
    pdf.set_text_color(80, 80, 80)
    pdf.cell(0, 7, "Relatório Técnico — pipeline.py", align="C", new_x=XPos.LMARGIN, new_y=YPos.NEXT)

    pdf.set_font("Arial", "", 9)
    pdf.set_text_color(150, 150, 150)
    pdf.cell(0, 6, f"Gerado em {date.today().isoformat()}", align="C", new_x=XPos.LMARGIN, new_y=YPos.NEXT)
    pdf.ln(5)

    pdf.set_draw_color(30, 58, 95)
    pdf.set_line_width(0.6)
    pdf.line(pdf.l_margin, pdf.get_y(), pdf.w - pdf.r_margin, pdf.get_y())
    pdf.set_line_width(0.2)
    pdf.set_draw_color(0, 0, 0)
    pdf.ln(8)
    pdf.set_text_color(0, 0, 0)

    # ── VISÃO GERAL ───────────────────────────────────────────────────────
    pdf.titulo_secao("Visão Geral")
    pdf.corpo(
        "A pipeline executa em background via processar_paciente_wsl(), orquestrando containers "
        "Docker dentro do WSL2. Suporta Single-End e Paired-End. Todos os outputs pesados são "
        "escritos diretamente em disco via redirecionamento de shell — nunca passam pela memória Python."
    )

    # ── ETAPA 0 ───────────────────────────────────────────────────────────
    pdf.titulo_secao("Etapa 0 — Validação de Índices BWA (Barreira de Segurança)")
    pdf.subtitulo("Ferramenta: Sistema de arquivos (Python)")
    pdf.corpo("Critérios:")
    pdf.bullet("Verifica a existência dos 5 arquivos de índice BWA: .bwt, .pac, .ann, .amb, .sa")
    pdf.bullet("Se qualquer índice estiver ausente: FileNotFoundError fatal — pipeline abortada antes de qualquer I/O")

    # ── ETAPA 0.5 ─────────────────────────────────────────────────────────
    pdf.titulo_secao("Etapa 0.5 — Controle de Qualidade Bruto (FastQC)")
    pdf.subtitulo("Ferramenta: fastqc")
    pdf.corpo("Critérios:")
    pdf.bullet("Processa R1 (Single-End) ou R1 + R2 (Paired-End)")
    pdf.bullet("Output HTML/ZIP gerado em /processamento/")
    pdf.bullet("Falha com código não-zero: exceção fatal — pipeline abortada")

    # ── ETAPA 0.75 ────────────────────────────────────────────────────────
    pdf.titulo_secao("Etapa 0.75 — Trimagem de Adaptadores e Qualidade (Trimmomatic)")
    pdf.subtitulo("Ferramenta: trimmomatic PE / SE")
    pdf.tabela(
        ["Parâmetro", "Valor", "Razão"],
        [
            ["ILLUMINACLIP", "TruSeq3-PE/SE.fa:2:30:10", "Remove adaptadores Illumina TruSeq3"],
            ["seedMismatches", "2", "Tolerância a mismatches na semente"],
            ["palindromeClipThreshold", "30", "Score mínimo para clip palindrômico (PE)"],
            ["simpleClipThreshold", "10", "Score mínimo para clip simples"],
            ["minAdapterLength", "8 (PE)", "Comprimento mínimo de adaptador detectado"],
            ["keepBothReads", "true (PE)", "Mantém as duas reads mesmo se uma for descartada"],
            ["LEADING", "3", "Remove bases no início com qualidade < 3"],
            ["TRAILING", "3", "Remove bases no fim com qualidade < 3"],
            ["SLIDINGWINDOW", "4:15", "Janela de 4 bp, qualidade média mínima 15"],
            ["MINLEN", "36", "Descarta reads com menos de 36 bp após trimagem"],
            ["-threads", "4", "Paralelismo"],
        ],
        [46, 48, 80],
    )
    pdf.corpo(
        "Outputs — PE: 4 arquivos (_paired e _unpaired para cada read)  |  SE: 1 arquivo (_trimmed)"
    )

    # ── ETAPAS 1+2 ────────────────────────────────────────────────────────
    pdf.titulo_secao("Etapas 1 + 2 — Alinhamento + Conversão BAM (Pipeline Unificado)")
    pdf.subtitulo("Ferramentas: bwa mem -> samtools view -> samtools sort -> samtools index")
    pdf.corpo("Critérios:")
    pdf.bullet(
        "SAM intermediário flui via pipe dentro do container: nunca é gravado em disco "
        "(evita ~50 GB de I/O por amostra WES e reduz o tempo em ~30%)"
    )
    pdf.bullet("set -o pipefail: propaga falha de qualquer etapa do pipe")
    pdf.bullet("-t 4 e -@ 4: 4 threads em todas as etapas")
    pdf.bullet(
        "-R: Read Group injetado (ID, SM, PL:ILLUMINA, LB:lib1) — "
        "obrigatório para o Mutect2 identificar a amostra pelo campo SM:"
    )
    pdf.bullet("PE: alinha R1_paired + R2_paired  |  SE: alinha R1_trimmed")
    pdf.bullet("Referência: Homo_sapiens_assembly38.fasta (hg38)")

    # ── ETAPA 2.5 ─────────────────────────────────────────────────────────
    pdf.titulo_secao("Etapa 2.5 — Qualidade do Alinhamento (Qualimap)")
    pdf.subtitulo("Ferramenta: qualimap bamqc")
    pdf.corpo("Critérios:")
    pdf.bullet("-bam: usa o BAM produzido na etapa anterior")
    pdf.bullet("-gff: restringe a análise ao painel BED (alvo_qualimap_6col.bed)")
    pdf.bullet("-nt 4 e --java-mem-size=4G")
    pdf.bullet("Métrica extraída: mean coverageData via regex no arquivo genome_results.txt")

    # ── ETAPA 3 ───────────────────────────────────────────────────────────
    pdf.titulo_secao("Etapa 3 — Extração de Métricas (Flagstat)")
    pdf.subtitulo("Ferramenta: samtools flagstat")
    pdf.corpo("Critérios:")
    pdf.bullet(
        "capture_output=True é usado aqui de forma legítima: saída são ~10 linhas "
        "(sem risco de buffer overflow) e precisa ser parseada por regex imediatamente"
    )
    pdf.bullet("Regex '(\\d+) \\+ \\d+ in total'  ->  total_reads (formato X.XM)")
    pdf.bullet("Regex 'mapped \\(([0-9.]+)%'  ->  mapping_rate")

    # ── ETAPA 4 ───────────────────────────────────────────────────────────
    pdf.titulo_secao("Etapa 4 — Chamada de Variantes: VarScan2")
    pdf.subtitulo("Ferramentas: samtools mpileup | varscan mpileup2cns")
    pdf.tabela(
        ["Parâmetro", "Valor", "Razão"],
        [
            ["--variants", "—", "Emite apenas posições variantes"],
            ["--output-vcf 1", "—", "Formato de saída VCF"],
            ["--min-var-freq", "configurável (padrão 5%)", "Detecta variantes subclonais"],
            ["--min-coverage", "configurável (padrão 100x)", "Profundidade mínima (padrão GDC)"],
            ["--min-reads2", "5", "Mínimo de reads suporte mesmo a VAF baixo"],
            ["--strand-filter 0", "desativado", "VarScan2 é 'rede larga'; strand bias filtrado pelo FilterMutectCalls"],
            ["-B (mpileup)", "—", "Desativa BAQ — evita falsos negativos em INDELs"],
            ["-l (mpileup)", "BED file", "Restringe ao painel alvo"],
        ],
        [46, 50, 78],
    )
    pdf.corpo("Nota: o VCF é gerado via '>' no shell Docker — stdout nunca passa pelo Python.")

    # ── ETAPA 4.5 ─────────────────────────────────────────────────────────
    pdf.titulo_secao("Etapa 4.5 — Chamada de Variantes: Mutect2 (GATK, tumor-only)")
    pdf.subtitulo("Ferramenta: gatk Mutect2")
    pdf.tabela(
        ["Parâmetro", "Valor", "Razão"],
        [
            ["-R", "hg38", "Genoma de referência"],
            ["--tumor-sample", "UUID", "Identifica a amostra tumoral pelo Read Group"],
            ["-min-AF", "configurável", "Alinha limiar de emissão com o VAF do VarScan2"],
            ["-L", "BED file", "Restringe ao painel alvo"],
            ["--germline-resource", "af-only-gnomad.hg38.vcf.gz", "Penaliza variantes com alta freq. pop. (GATK Best Practices)"],
            ["-pon", "1000g_pon.hg38.vcf.gz", "Panel of Normals — filtra artefatos sistemáticos (opcional, com fallback)"],
            ["--f1r2-tar-gz", "_f1r2.tar.gz", "Coleta estatísticas de orientação para o modelo F1R2"],
        ],
        [46, 58, 70],
    )

    # ── ETAPA 4.5.5 ───────────────────────────────────────────────────────
    pdf.titulo_secao("Etapa 4.5.5 — Modelo de Artefatos F1R2 (LearnReadOrientationModel)")
    pdf.subtitulo("Ferramenta: gatk LearnReadOrientationModel")
    pdf.corpo("Critérios:")
    pdf.bullet(
        "Aprende modelo probabilístico de artefatos OxoG (dano oxidativo) e FFPE "
        "a partir das estatísticas F1R2 coletadas pelo Mutect2"
    )
    pdf.bullet("Substitui o FilterByOrientationBias (descontinuado no GATK >= 4.2)")
    pdf.bullet("Fallback: se falhar, FilterMutectCalls roda sem --ob-priors — pipeline não bloqueada")

    # ── ETAPA 4.55 ────────────────────────────────────────────────────────
    pdf.titulo_secao("Etapa 4.55 — Estimativa de Contaminação (GetPileupSummaries + CalculateContamination)")
    pdf.subtitulo("Ferramentas: gatk GetPileupSummaries -> gatk CalculateContamination")
    pdf.corpo("Critérios:")
    pdf.bullet("Padrão GDC NIH para análise Tumor-Only")
    pdf.bullet(
        "Usa variantes populacionais do gnomAD como âncoras para estimar a fração "
        "de contaminação cruzada entre amostras"
    )
    pdf.bullet(
        "Resultado (_contamination.table) passado ao FilterMutectCalls para "
        "ajustar limiares estatísticos ao nível real de contaminação"
    )
    pdf.bullet(
        "Fallback em 2 níveis: falha do pileup OU falha do cálculo -> "
        "FilterMutectCalls roda no modo padrão sem tabela de contaminação"
    )

    # ── ETAPA 4.6 ─────────────────────────────────────────────────────────
    pdf.titulo_secao("Etapa 4.6 — Filtro Estatístico GATK (FilterMutectCalls)")
    pdf.subtitulo("Ferramenta: gatk FilterMutectCalls")
    pdf.corpo("Filtros aplicados:")
    pdf.bullet("Strand bias")
    pdf.bullet("TLOD (Tumor Log Odds)")
    pdf.bullet("Artefatos de orientação de fragmento via --ob-priors (se disponível)")
    pdf.bullet("Fração de contaminação via --contamination-table (se disponível)")
    pdf.bullet(
        "--min-allele-fraction: alinha o limiar interno do GATK com o VAF configurado — "
        "sem este parâmetro, o filtro 'low_allele_frac' descartaria variantes de baixo AF "
        "que o VarScan2 chamaria, quebrando o consenso"
    )
    pdf.bullet("Somente variantes com FILTER=PASS entram no consenso")

    # ── ETAPA 4.7 ─────────────────────────────────────────────────────────
    pdf.titulo_secao("Etapa 4.7 — Normalização Canônica (bcftools norm)")
    pdf.subtitulo("Ferramentas: bcftools reheader + bcftools norm")
    pdf.corpo(
        "Problema resolvido: INDELs representados diferentemente por VarScan2 e Mutect2 "
        "(left-aligned vs right-aligned, multi-alélico vs bi-alélico) causariam falhas na "
        "interseção sem normalização prévia."
    )
    pdf.corpo("Pipeline de normalização do VarScan2 (2 passos independentes):")
    pdf.bullet(
        "Passo A — Renomeação de cromossomos (sed): VarScan2 emite '1','2'...; "
        "hg38 usa 'chr1','chr2'... O guard /^chr/! torna o sed idempotente. "
        "bcftools annotate --rename-chrs não é usado pois falha (erro 255) "
        "em VCFs sem ##contig no cabeçalho."
    )
    pdf.bullet(
        "Passo B — Reheader + Normalização: bcftools reheader --fai injeta ##contig "
        "a partir do índice FASTA (bcftools >= 1.9); -m-any divide multi-alélicos em "
        "bi-alélicos; -f executa left-alignment dos INDELs."
    )
    pdf.corpo("Normalização Mutect2: direto via bcftools norm -m-any -f ref (sem passo A).")

    # ── ETAPA 5 ───────────────────────────────────────────────────────────
    pdf.titulo_secao("Etapa 5 — Consenso Multi-Caller (VarScan2 intersecao Mutect2)")
    pdf.subtitulo("Ferramenta: Python puro (parse_vcf() + escrever_consensus_vcf())")
    pdf.corpo("Critérios:")
    pdf.bullet(
        "Lê os VCFs normalizados com fallback para o VCF original "
        "caso a normalização tenha falhado"
    )
    pdf.bullet(
        "_vcf_valido(): verifica existência + tamanho > 0 + "
        "presença de ao menos 1 linha não-header"
    )
    pdf.bullet(
        "Filtros aceitos em parse_vcf(): PASS e '.' "
        "(ponto = sem filtro aplicado, comportamento padrão do VarScan2)"
    )
    pdf.bullet(
        "Variantes com qualquer outro FILTER (germline, weak_evidence, "
        "strand_bias, etc.) são rejeitadas antes da interseção"
    )
    pdf.bullet("Interseção por tupla (CHROM, POS, REF, ALT) — identidade exata de representação")
    pdf.bullet(
        "Template do VCF de consenso: Mutect2 (headers mais completos, "
        "compatíveis com SnpEff e GATK)"
    )
    pdf.bullet(
        "Se a interseção for vazia: _consensus.vcf não é criado — "
        "a ausência é detectada por _vcf_valido() nas etapas seguintes"
    )

    # ── ETAPA 5.5 ─────────────────────────────────────────────────────────
    pdf.titulo_secao("Etapa 5.5 — Anotação Funcional (SnpEff)")
    pdf.subtitulo("Ferramenta: snpEff ann  |  Banco: GRCh38.99")
    pdf.corpo("Critérios:")
    pdf.bullet(
        "Banco GRCh38.99 verificado antes de qualquer chamada — "
        "FileNotFoundError fatal se ausente (com instrução de download no log)"
    )
    pdf.bullet("-nodownload: garante modo offline  |  -Xmx4g: limite de memória JVM")
    pdf.bullet(
        "Anotação aplicada a 3 VCFs separados: VarScan2, Mutect2 e Consenso"
    )
    pdf.bullet(
        "Falha nos VCFs individuais (VarScan2/Mutect2) -> aviso não fatal; "
        "falha no Consenso -> exceção fatal"
    )
    pdf.corpo("Campos extraídos do campo ANN= (pipe-delimitado):")
    pdf.bullet("effect — tipo de efeito (ex: missense_variant)", nivel=1)
    pdf.bullet("impact — HIGH, MODERATE, LOW, MODIFIER", nivel=1)
    pdf.bullet("gene — símbolo do gene afetado (ex: TP53)", nivel=1)
    pdf.bullet("hgvs_p — notação proteica (ex: p.Arg248Trp)", nivel=1)

    # ── ETAPA 5.6 ─────────────────────────────────────────────────────────
    pdf.titulo_secao("Etapa 5.6 — Anotação Clínica (ClinVar via SnpSift)")
    pdf.subtitulo("Ferramenta: SnpSift annotate  |  Banco: clinvar.vcf.gz")
    pdf.corpo("Campos injetados no campo INFO:")
    pdf.bullet("CLNSIG — significância clínica (ex: Pathogenic, Likely_pathogenic)")
    pdf.bullet("CLNDN — nome da doença associada")
    pdf.corpo("Critérios:")
    pdf.bullet(
        "Escreve resultado em /tmp/ primeiro; mv para /processamento/ "
        "só ocorre se o comando teve sucesso — evita arquivo vazio em caso de falha"
    )
    pdf.bullet("chmod -R 777 libera arquivos root-owned para o processo Python do host")
    pdf.bullet("Falha -> aviso no log; campos ficam ausentes no laudo, pipeline continua")

    # ── ETAPA 5.7 ─────────────────────────────────────────────────────────
    pdf.titulo_secao("Etapa 5.7 — Anotação Oncológica (COSMIC via SnpSift)")
    pdf.subtitulo("Ferramenta: SnpSift annotate  |  Banco: Cosmic_GenomeScreensMutant_v103_GRCh38.vcf.gz")
    pdf.corpo("Campo injetado: CNT — contagem de ocorrências da variante em tumores no COSMIC")
    pdf.corpo("Critérios:")
    pdf.bullet(
        "Entrada preferencial: _consensus_clinvar.vcf; "
        "fallback: _consensus_snpeff.vcf (se ClinVar falhou)"
    )
    pdf.bullet(
        "Falha -> shutil.copy2 promove o VCF anterior na cadeia "
        "como _consensus_annotated.vcf para não bloquear etapas seguintes"
    )

    # ── ETAPA 5.8 ─────────────────────────────────────────────────────────
    pdf.titulo_secao("Etapa 5.8 — Anotação Populacional (gnomAD via SnpSift)")
    pdf.subtitulo("Ferramenta: SnpSift annotate  |  Banco: af-only-gnomad.hg38.vcf.gz")
    pdf.corpo("Campo injetado: AF — frequência alélica na população geral (gnomAD)")
    pdf.corpo("Critérios:")
    pdf.bullet(
        "Entrada preferencial: _consensus_annotated.vcf; "
        "fallback: VCF anterior na cadeia de anotação"
    )
    pdf.bullet(
        "Multi-alélico tratado: AF=0.003,0.001 -> pega o primeiro valor; "
        "valores não-numéricos são descartados silenciosamente"
    )
    pdf.bullet("Falha -> mesmo mecanismo de fallback de cópia do COSMIC")

    # ── ETAPA 6 ───────────────────────────────────────────────────────────
    pdf.titulo_secao("Etapa 6 — Salvamento Final e Telemetria")
    pdf.subtitulo("Ferramenta: SQLAlchemy (banco SQLite local)")
    pdf.tabela(
        ["Campo no banco", "Fonte"],
        [
            ["total_reads", "samtools flagstat — regex 'in total'"],
            ["mapping_rate", "samtools flagstat — regex 'mapped (%)'"],
            ["mean_coverage", "qualimap genome_results.txt — regex 'mean coverageData'"],
            ["variants_varscan / mutect / consensus", "len() dos sets Python de cada caller"],
            ["varscan_details / mutect_details", "Top 20 variantes por impacto (JSON, SnpEff)"],
            ["annotation_summary", "parsear_anotacoes_snpeff() no VCF final anotado"],
            ["time_total", "Cronômetro global (time.time)"],
            ["time_steps", "Dict de tempos por etapa (JSON)"],
            ["bwa_version, samtools_version, reference_version", "Valores fixos para rastreabilidade clínica"],
        ],
        [80, 94],
    )

    # ── MECANISMOS TRANSVERSAIS ───────────────────────────────────────────
    pdf.titulo_secao("Mecanismos Transversais")
    pdf.tabela(
        ["Mecanismo", "Onde se aplica", "Comportamento"],
        [
            [
                "_executar_docker()",
                "Todas as etapas Docker",
                "Thread dedicada para leitura do PIPE — evita hang do Docker Desktop no WSL2 "
                "(bug de teardown onde o pipe stdout não fecha após o container encerrar)",
            ],
            [
                "set -o pipefail",
                "BWA, VarScan2, normalização",
                "Propaga returncode de falha de qualquer etapa dentro do pipe",
            ],
            [
                "_vcf_valido()",
                "Etapas 5 a 5.8",
                "Verifica existência, tamanho > 0 e presença de ao menos 1 linha de dados",
            ],
            [
                "Fallback chain",
                "Etapas 4.5.5, 4.55, 5.6, 5.7, 5.8",
                "Pipeline nunca bloqueada por ferramenta opcional; cada etapa tem fallback explícito",
            ],
            [
                "atualizar_fase('failed')",
                "Bloco except global",
                "Banco de dados nunca fica preso no status 'processing' mesmo em crash",
            ],
            [
                "Limpeza prévia de arquivos",
                "Início da função principal",
                "Remove arquivos intermediários de execuções anteriores com o mesmo UUID",
            ],
        ],
        [40, 42, 92],
    )

    pdf.output(OUTPUT)
    print(f"PDF gerado: {OUTPUT}")


if __name__ == "__main__":
    build()
