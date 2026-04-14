from pathlib import Path
import logging
import subprocess
import os
import shlex
import re
import time
import json
import queue
import threading

# Importamos as configurações do banco e o modelo da tabela
from database import SessionLocal
from models import Analysis

logger = logging.getLogger(__name__)

# --- CONFIGURAÇÃO DE CAMINHOS (Ponte Windows -> WSL2) ---
# WSL_USER é lido do .env para garantir portabilidade entre máquinas.
# Fallback "ubuntu" cobre o usuário padrão de distros WSL2 recém-instaladas.
WSL_USER = os.getenv("WSL_USER", "ubuntu")
WSL_BASE = f"/home/{WSL_USER}/pantherflow-clinical"

WSL_PROCESSAMENTO = Path(rf"\\wsl.localhost\Ubuntu{WSL_BASE}\processamento")
WSL_DATASETS      = Path(rf"\\wsl.localhost\Ubuntu{WSL_BASE}\datasets")
NOME_ARQUIVO_BED  = "alvo_qualimap_6col.bed"


def _executar_docker(comando: list, caminho_log: Path) -> int:
    """Executa um container Docker redirecionando output para log em disco.

    Usa uma thread dedicada para leitura do PIPE. O loop principal desbloqueia
    via poll() quando o processo wsl/docker termina — evita o hang do Docker
    Desktop no Windows, onde o pipe stdout não fecha imediatamente após o
    container encerrar (bug conhecido de teardown no WSL2).
    """
    def _ler_pipe(stdout, fila: queue.Queue):
        """Thread: lê linhas do PIPE e enfileira. Envia None como sentinela de EOF."""
        try:
            for linha in stdout:
                fila.put(linha)
        finally:
            fila.put(None)

    with open(caminho_log, "a", encoding="utf-8") as log_f:
        processo = subprocess.Popen(
            comando,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            encoding="utf-8",
            errors="replace"
        )

        fila: queue.Queue = queue.Queue()
        thread = threading.Thread(target=_ler_pipe, args=(processo.stdout, fila), daemon=True)
        thread.start()

        while True:
            try:
                linha = fila.get(timeout=1)
                if linha is None:       # Sentinela: pipe fechou com EOF real
                    break
                log_f.write(linha)
                log_f.flush()
            except queue.Empty:
                # Nenhuma saída no último segundo — verifica se o processo já encerrou
                if processo.poll() is not None:
                    # Processo morreu: drena o que restar na fila antes de sair
                    while True:
                        try:
                            linha = fila.get_nowait()
                            if linha is None:
                                break
                            log_f.write(linha)
                            log_f.flush()
                        except queue.Empty:
                            break
                    break
                # Processo ainda vivo e sem output → continua aguardando

        processo.wait(timeout=30)
    return processo.returncode


def parse_vcf(filepath: Path) -> set:
    """Lê um arquivo VCF e retorna um set de tuplas (CHROM, POS, REF, ALT).

    Ignora todas as linhas de cabeçalho (iniciadas em '#'). Retorna set vazio
    se o arquivo não existir ou estiver malformado, sem interromper o pipeline.
    """
    variantes = set()
    try:
        with open(filepath, "r", encoding="utf-8", errors="replace") as f:
            for linha in f:
                if linha.startswith("#"):
                    continue
                colunas = linha.strip().split("\t")
                if len(colunas) < 5:
                    continue
                chrom, pos, _, ref, alt = colunas[0], colunas[1], colunas[2], colunas[3], colunas[4]
                variantes.add((chrom, pos, ref, alt))
    except (FileNotFoundError, OSError):
        pass
    return variantes


def parsear_anotacoes_snpeff(vcf_anotado_path: Path) -> dict:
    """Lê o VCF anotado pelo SnpEff e extrai um resumo estruturado do campo ANN=.

    Formato do campo ANN= (pipe-delimitado, por alelo):
      ANN=ALT|effect|impact|gene|gene_id|feature_type|feature_id|
          transcript_biotype|rank|hgvs_c|hgvs_p|...

    Retorna um dict com contagens por impacto e as top_variants (HIGH primeiro,
    depois MODERATE), limitado a 20 entradas para não inflar o banco.
    Retorna estrutura vazia em caso de falha — nunca interrompe o pipeline.
    """
    IMPACTOS_ORDEM = {"HIGH": 0, "MODERATE": 1, "LOW": 2, "MODIFIER": 3}
    contagens = {"HIGH": 0, "MODERATE": 0, "LOW": 0, "MODIFIER": 0}
    variantes_brutas: list[dict] = []

    try:
        with open(vcf_anotado_path, "r", encoding="utf-8", errors="replace") as f:
            for linha in f:
                if linha.startswith("#"):
                    continue
                colunas = linha.strip().split("\t")
                if len(colunas) < 8:
                    continue

                chrom, pos, ref, alt = colunas[0], colunas[1], colunas[3], colunas[4]
                info = colunas[7]

                # Extrai o campo ANN= do INFO
                ann_match = re.search(r'ANN=([^;]+)', info)
                if not ann_match:
                    continue

                # Cada alelo pode ter múltiplas anotações separadas por vírgula.
                # Usamos apenas a primeira anotação (maior impacto, conforme ordenação do SnpEff).
                primeira_ann = ann_match.group(1).split(",")[0]
                campos = primeira_ann.split("|")
                if len(campos) < 11:
                    continue

                effect = campos[1]   # ex: missense_variant
                impact = campos[2]   # HIGH | MODERATE | LOW | MODIFIER
                gene   = campos[3]   # ex: TP53
                hgvs_p = campos[10]  # ex: p.Arg248Trp (vazio para variantes sinônimas)

                if impact in contagens:
                    contagens[impact] += 1

                # Campos ClinVar (injetados pelo SnpSift)
                clnsig_match = re.search(r'CLNSIG=([^;]+)', info)
                clndn_match  = re.search(r'CLNDN=([^;]+)', info)
                cnt_match    = re.search(r'CNT=(\d+)', info)

                variantes_brutas.append({
                    "chrom":            chrom,
                    "pos":              pos,
                    "ref":              ref,
                    "alt":              alt,
                    "gene":             gene,
                    "effect":           effect,
                    "impact":           impact,
                    "hgvs_p":           hgvs_p or "—",
                    "clinvar_sig":      clnsig_match.group(1).replace("_", " ") if clnsig_match else "—",
                    "clinvar_disease":  clndn_match.group(1).replace("_", " ").replace("|", " / ") if clndn_match else "—",
                    "cosmic_cnt":       cnt_match.group(1) if cnt_match else "—",
                })

    except (FileNotFoundError, OSError):
        return {}

    # Ordena: HIGH primeiro, depois MODERATE, LOW, MODIFIER — top 20
    variantes_brutas.sort(key=lambda v: IMPACTOS_ORDEM.get(v["impact"], 99))
    top_variants = variantes_brutas[:20]

    return {
        "total_annotated": len(variantes_brutas),
        "high_impact":     contagens["HIGH"],
        "moderate_impact": contagens["MODERATE"],
        "low_impact":      contagens["LOW"],
        "modifier_impact": contagens["MODIFIER"],
        "top_variants":    top_variants,
    }


def escrever_consensus_vcf(vcf_mutect_path: Path, set_consenso: set, vcf_saida: Path) -> None:
    """Filtra o VCF do Mutect2, mantendo apenas as variantes presentes no set de consenso.

    Usa o Mutect2 como template porque seus headers são mais completos e o SnpEff
    lida melhor com VCFs no formato GATK. Preserva todos os headers (#) intactos.
    Não lança exceção se o arquivo de saída já existir — sobrescreve silenciosamente.
    """
    try:
        with open(vcf_mutect_path, "r", encoding="utf-8", errors="replace") as f_in, \
             open(vcf_saida, "w", encoding="utf-8") as f_out:
            for linha in f_in:
                if linha.startswith("#"):
                    f_out.write(linha)
                    continue
                colunas = linha.strip().split("\t")
                if len(colunas) < 5:
                    continue
                chrom, pos, ref, alt = colunas[0], colunas[1], colunas[3], colunas[4]
                if (chrom, pos, ref, alt) in set_consenso:
                    f_out.write(linha)
    except (FileNotFoundError, OSError) as e:
        raise RuntimeError(f"Falha ao escrever VCF de consenso: {e}") from e


def escrever_log_ui(uuid: str, mensagem: str):
    """Escreve o log no terminal e em um arquivo .log para o React ler"""
    logger.info(f"[{uuid}] {mensagem}")
    caminho_log = WSL_PROCESSAMENTO / f"{uuid}.log"
    with open(caminho_log, "a", encoding="utf-8") as f:
        f.write(f"> {mensagem}\n")


def processar_paciente_wsl(paciente_uuid: str, nome_arquivo_r1: str, nome_arquivo_r2: str | None = None):
    """Executa os comandos pesados no Docker/WSL2 em background.
    Suporta Single-End (nome_arquivo_r2=None) e Paired-End (nome_arquivo_r2 fornecido).
    """

    db = SessionLocal()
    is_paired = nome_arquivo_r2 is not None

    def atualizar_fase(fase: str):
        """Função auxiliar para atualizar o status do paciente no banco"""
        registro = db.query(Analysis).filter(Analysis.patient_uuid == paciente_uuid).first()
        if registro:
            registro.status = fase
            db.commit()

    try:
        # Garante que a pasta de processamento existe antes de qualquer escrita
        WSL_PROCESSAMENTO.mkdir(parents=True, exist_ok=True)

        # Mantemos o status como "processing" para o React entender e manter a cor amarela
        atualizar_fase("processing")

        # --- LOG INICIAL ---
        modo = "Paired-End" if is_paired else "Single-End"
        escrever_log_ui(paciente_uuid, f"Iniciando ambiente isolado ({modo}) e validando arquivo FASTQ...")

        # --- PREPARAÇÃO DE VARIÁVEIS SEGURAS ---
        safe_r1   = shlex.quote(nome_arquivo_r1)
        safe_r2   = shlex.quote(nome_arquivo_r2) if is_paired else None
        safe_uuid = shlex.quote(paciente_uuid)

        # Nomes dos arquivos trimados — PE gera 4 outputs; SE gera 1
        def _trimmed_name(nome: str, sufixo: str) -> str:
            """Insere sufixo antes da extensão .fastq/.fq."""
            for ext in (".fastq.gz", ".fq.gz", ".fastq", ".fq"):
                if nome.endswith(ext):
                    return nome[: -len(ext)] + sufixo + ext
            return nome + sufixo

        if is_paired:
            nome_r1_paired    = _trimmed_name(nome_arquivo_r1, "_paired")
            nome_r1_unpaired  = _trimmed_name(nome_arquivo_r1, "_unpaired")
            nome_r2_paired    = _trimmed_name(nome_arquivo_r2, "_paired")
            nome_r2_unpaired  = _trimmed_name(nome_arquivo_r2, "_unpaired")
            safe_r1_paired    = shlex.quote(nome_r1_paired)
            safe_r1_unpaired  = shlex.quote(nome_r1_unpaired)
            safe_r2_paired    = shlex.quote(nome_r2_paired)
            safe_r2_unpaired  = shlex.quote(nome_r2_unpaired)
        else:
            # Single-End — mantém o nome legado para compatibilidade
            nome_r1_paired   = _trimmed_name(nome_arquivo_r1, "_trimmed")
            safe_r1_paired   = shlex.quote(nome_r1_paired)

        # Caminho do log deste paciente — compartilhado por todas as etapas abaixo
        caminho_log = WSL_PROCESSAMENTO / f"{paciente_uuid}.log"

        # --- TELEMETRIA: cronômetro global e dicionário de tempos por etapa ---
        pipeline_start = time.time()
        tempos_etapas = {}

        # --- ETAPA 0: BARREIRA DE SEGURANÇA (Validação BWA) ---
        escrever_log_ui(paciente_uuid, "Verificando integridade dos índices genômicos (BWA)...")
        required_indices = [".bwt", ".pac", ".ann", ".amb", ".sa"]
        for ext in required_indices:
            index_file = WSL_DATASETS / f"Homo_sapiens_assembly38.fasta{ext}"
            if not index_file.exists():
                error_msg = f"Falha Crítica: Índice BWA ausente ({index_file.name}). O alinhamento foi abortado."
                raise FileNotFoundError(error_msg)
        escrever_log_ui(paciente_uuid, "Índices validados com sucesso.")

        # --- ETAPA 0.5: CONTROLE DE QUALIDADE BRUTO (FASTQC) ---
        escrever_log_ui(paciente_uuid, "Executando FastQC: Avaliação de qualidade bruta...")
        arquivos_fastqc = f"/processamento/{safe_r1}"
        if is_paired:
            arquivos_fastqc += f" /processamento/{safe_r2}"
        comando_fastqc_interno = f"fastqc {arquivos_fastqc} -o /processamento/"
        comando_fastqc = [
            "wsl", "-d", "Ubuntu", "-u", "root", "docker", "run", "--rm",
            "-v", f"{WSL_BASE}/processamento:/processamento",
            "pantherflow-bioinfo", "sh", "-c", comando_fastqc_interno
        ]
        t0 = time.time()
        returncode = _executar_docker(comando_fastqc, caminho_log)
        tempos_etapas["fastqc"] = f"{time.time() - t0:.1f}s"
        if returncode != 0:
            raise Exception(f"Erro FastQC (código {returncode}). Ver log do paciente para detalhes.")

        # --- ETAPA 0.75: LIMPEZA DE ADAPTADORES E QUALIDADE (TRIMMOMATIC) ---
        escrever_log_ui(paciente_uuid, "Executando Trimmomatic: Removendo adaptadores e bases de baixa qualidade...")

        # ILLUMINACLIP remove adaptadores TruSeq3 antes dos filtros de qualidade.
        # PE usa TruSeq3-PE.fa; SE usa TruSeq3-SE.fa — arquivos incluídos na imagem Conda.
        # Parâmetros: seedMismatches:2 palindromeClipThreshold:30 simpleClipThreshold:10 minAdapterLength:8 keepBothReads:true
        if is_paired:
            # PE: 2 inputs + 4 outputs (paired/unpaired para cada read)
            comando_trim_interno = (
                f"trimmomatic PE -threads 4 "
                f"/processamento/{safe_r1} /processamento/{safe_r2} "
                f"/processamento/{safe_r1_paired} /processamento/{safe_r1_unpaired} "
                f"/processamento/{safe_r2_paired} /processamento/{safe_r2_unpaired} "
                f"ILLUMINACLIP:/opt/conda/share/trimmomatic/adapters/TruSeq3-PE.fa:2:30:10:8:true "
                f"LEADING:3 TRAILING:3 SLIDINGWINDOW:4:15 MINLEN:36"
            )
        else:
            # SE: 1 input + 1 output
            comando_trim_interno = (
                f"trimmomatic SE -threads 4 "
                f"/processamento/{safe_r1} /processamento/{safe_r1_paired} "
                f"ILLUMINACLIP:/opt/conda/share/trimmomatic/adapters/TruSeq3-SE.fa:2:30:10 "
                f"LEADING:3 TRAILING:3 SLIDINGWINDOW:4:15 MINLEN:36"
            )

        comando_trim = [
            "wsl", "-d", "Ubuntu", "-u", "root", "docker", "run", "--rm",
            "-v", f"{WSL_BASE}/processamento:/processamento",
            "pantherflow-bioinfo", "sh", "-c", comando_trim_interno
        ]
        t0 = time.time()
        returncode = _executar_docker(comando_trim, caminho_log)
        tempos_etapas["trimmomatic"] = f"{time.time() - t0:.1f}s"
        if returncode != 0:
            raise Exception(f"Erro Trimmomatic (código {returncode}). Ver log do paciente para detalhes.")

        # --- ETAPA 1: ALINHAMENTO BWA ---
        escrever_log_ui(paciente_uuid, "Executando BWA-MEM: Mapeando leituras contra o genoma de referência...")

        # O redirecionamento > .sam ocorre dentro do shell do Docker — stdout nunca passa pelo Python
        # -R adiciona o Read Group ao SAM — obrigatório para o Mutect2 identificar a amostra (SM:)
        rg_tag = f"@RG\\tID:{paciente_uuid}\\tSM:{paciente_uuid}\\tPL:ILLUMINA\\tLB:lib1"
        inputs_bwa = f"/processamento/{safe_r1_paired}"
        if is_paired:
            inputs_bwa += f" /processamento/{safe_r2_paired}"
        comando_bwa_interno = (
            f"bwa mem -t 4 -R '{rg_tag}' "
            f"/datasets/Homo_sapiens_assembly38.fasta {inputs_bwa} "
            f"> /processamento/{safe_uuid}.sam"
        )

        comando_bwa = [
            "wsl", "-d", "Ubuntu", "-u", "root", "docker", "run", "--rm",
            "-v", f"{WSL_BASE}/datasets:/datasets",
            "-v", f"{WSL_BASE}/processamento:/processamento",
            "pantherflow-bioinfo", "sh", "-c", comando_bwa_interno
        ]
        t0 = time.time()
        returncode = _executar_docker(comando_bwa, caminho_log)
        tempos_etapas["bwa_mem"] = f"{time.time() - t0:.1f}s"
        if returncode != 0:
            raise Exception(f"Erro BWA (código {returncode}). Ver log do paciente para detalhes.")

        # --- ETAPA 2: CONVERSÃO PARA BAM (SAMTOOLS) ---
        escrever_log_ui(paciente_uuid, "Executando Samtools: Convertendo, ordenando e indexando arquivo BAM...")

        # set -o pipefail garante que erros no samtools view propagam o código de retorno
        # && samtools index gera o .bam.bai — obrigatório para o Mutect2 (GATK)
        comando_bam_interno = f"set -o pipefail; samtools view -@ 4 -Sb /processamento/{safe_uuid}.sam | samtools sort -@ 4 -o /processamento/{safe_uuid}.bam && samtools index -@ 4 /processamento/{safe_uuid}.bam"

        comando_bam = [
            "wsl", "-d", "Ubuntu", "-u", "root", "docker", "run", "--rm",
            "-v", f"{WSL_BASE}/processamento:/processamento",
            "pantherflow-bioinfo", "sh", "-c", comando_bam_interno
        ]
        t0 = time.time()
        returncode = _executar_docker(comando_bam, caminho_log)
        tempos_etapas["samtools"] = f"{time.time() - t0:.1f}s"
        if returncode != 0:
            raise Exception(f"Erro Samtools (código {returncode}). Ver log do paciente para detalhes.")

        # --- ETAPA 2.5: CONTROLE DE QUALIDADE DO ALINHAMENTO (QUALIMAP) ---
        escrever_log_ui(paciente_uuid, "Executando Qualimap: Avaliando profundidade e cobertura do mapeamento (BAM)...")

        pasta_qualimap = f"/processamento/{safe_uuid}_qualimap"
        comando_qualimap_interno = f"qualimap bamqc -bam /processamento/{safe_uuid}.bam -gff /datasets/{NOME_ARQUIVO_BED} -outdir {pasta_qualimap} -outformat HTML -nt 4 --java-mem-size=4G"

        comando_qualimap = [
            "wsl", "-d", "Ubuntu", "-u", "root", "docker", "run", "--rm",
            "-v", f"{WSL_BASE}/processamento:/processamento",
            "-v", f"{WSL_BASE}/datasets:/datasets",
            "pantherflow-bioinfo", "sh", "-c", comando_qualimap_interno
        ]
        t0 = time.time()
        returncode = _executar_docker(comando_qualimap, caminho_log)
        tempos_etapas["qualimap"] = f"{time.time() - t0:.1f}s"
        if returncode != 0:
            raise Exception(f"Erro Qualimap (código {returncode}). Ver log do paciente para detalhes.")

        # --- ETAPA 3: EXTRAÇÃO (FLAGSTAT) ---
        # NOTA: capture_output=True é mantido intencionalmente aqui. O flagstat emite
        # apenas ~10 linhas de texto (sem risco de buffer overflow) e sua saída precisa
        # ser parseada por regex logo abaixo para extrair total_reads e mapping_rate.
        escrever_log_ui(paciente_uuid, "Extraindo métricas biológicas (Flagstat)...")
        comando_flagstat_interno = f"samtools flagstat /processamento/{safe_uuid}.bam"

        comando_flagstat = [
            "wsl", "-d", "Ubuntu", "-u", "root", "docker", "run", "--rm",
            "-v", f"{WSL_BASE}/processamento:/processamento",
            "pantherflow-bioinfo", "sh", "-c", comando_flagstat_interno
        ]
        t0 = time.time()
        res_flagstat = subprocess.run(comando_flagstat, capture_output=True, text=True)
        tempos_etapas["flagstat"] = f"{time.time() - t0:.1f}s"
        flagstat_output = res_flagstat.stdout

        # Garimpando os dados do texto bruto gerado pelo Docker
        total_reads = "N/A"
        mapping_rate = "N/A"
        mean_coverage = "N/A"
        genome_results_path = WSL_PROCESSAMENTO / f"{paciente_uuid}_qualimap" / "genome_results.txt"
        try:
            with open(genome_results_path, "r", encoding="utf-8") as f:
                genome_results_content = f.read()
            match_coverage = re.search(r'mean coverageData\s*=\s*([\d\.]+)X', genome_results_content)
            if match_coverage:
                mean_coverage = f"{float(match_coverage.group(1)):.1f}x"
        except (FileNotFoundError, OSError):
            pass

        match_total = re.search(r'(\d+) \+ \d+ in total', flagstat_output)
        if match_total:
            total_reads = f"{int(match_total.group(1)) / 1000000:.1f}M"

        match_rate = re.search(r'\(([\d\.]+)%', flagstat_output)
        if match_rate:
            mapping_rate = f"{match_rate.group(1)}%"

        # --- ETAPA 4: CHAMADA DE VARIANTES — VarScan2 ---
        # O VCF é gerado pelo shell do Docker via '>'. O stdout nunca passa pelo Python.
        # _executar_docker captura apenas o stderr (progresso/warnings do VarScan2).
        escrever_log_ui(paciente_uuid, "Executando VarScan2: Chamada de variantes somáticas (SNPs + INDELs, VAF >= 5%)...")
        # mpileup2cns chama SNPs e INDELs simultaneamente.
        # --min-var-freq 0.05: detecta variantes subclonais a partir de 5% VAF (padrão clínico oncológico).
        # --min-coverage 20 + --min-reads2 5: mantém precisão mesmo a VAF baixo.
        comando_varscan_interno = (
            f"set -o pipefail; "
            f"samtools mpileup -B -l /datasets/{NOME_ARQUIVO_BED} -f /datasets/Homo_sapiens_assembly38.fasta /processamento/{safe_uuid}.bam "
            f"| varscan mpileup2cns --variants --output-vcf 1 --min-var-freq 0.05 --min-coverage 20 --min-reads2 5 "
            f"> /processamento/{safe_uuid}_varscan.vcf"
        )
        comando_varscan = [
            "wsl", "-d", "Ubuntu", "-u", "root", "docker", "run", "--rm",
            "-v", f"{WSL_BASE}/datasets:/datasets",
            "-v", f"{WSL_BASE}/processamento:/processamento",
            "pantherflow-bioinfo", "sh", "-c", comando_varscan_interno
        ]
        t0 = time.time()
        returncode = _executar_docker(comando_varscan, caminho_log)
        tempos_etapas["varscan2"] = f"{time.time() - t0:.1f}s"
        if returncode != 0:
            raise Exception(f"Erro VarScan2 (código {returncode}). Ver log do paciente para detalhes.")

        # --- ETAPA 4.5: CHAMADA DE VARIANTES — Mutect2 (GATK, tumor-only) ---
        # Mutect2 escreve o VCF bruto diretamente via flag -O.
        # -germline-resource: gnomAD AF-only — penaliza variantes com alta frequência populacional,
        # separando variantes germinativas comuns de variantes somáticas raras (GATK Best Practices).
        escrever_log_ui(paciente_uuid, "Executando Mutect2: Chamada de variantes somáticas (tumor-only + gnomAD)...")
        comando_mutect2_interno = (
            f"gatk Mutect2 "
            f"-R /datasets/Homo_sapiens_assembly38.fasta "
            f"-I /processamento/{safe_uuid}.bam "
            f"--tumor-sample {safe_uuid} "
            f"-L /datasets/{NOME_ARQUIVO_BED} "
            f"--germline-resource /datasets/af-only-gnomad.hg38.vcf.gz "
            f"-O /processamento/{safe_uuid}_mutect_raw.vcf"
        )
        comando_mutect2 = [
            "wsl", "-d", "Ubuntu", "-u", "root", "docker", "run", "--rm",
            "-v", f"{WSL_BASE}/datasets:/datasets",
            "-v", f"{WSL_BASE}/processamento:/processamento",
            "pantherflow-bioinfo", "sh", "-c", comando_mutect2_interno
        ]
        t0 = time.time()
        returncode = _executar_docker(comando_mutect2, caminho_log)
        if returncode != 0:
            raise Exception(f"Erro Mutect2 (código {returncode}). Ver log do paciente para detalhes.")

        # --- ETAPA 4.6: FILTRO ESTATÍSTICO — FilterMutectCalls ---
        # Aplica os filtros do GATK ao VCF bruto: strand bias, TLOD, orientação de fragmento, etc.
        # Somente variantes com FILTER=PASS entram no consenso — elimina artefatos sistemáticos.
        escrever_log_ui(paciente_uuid, "Executando FilterMutectCalls: Aplicando filtros estatísticos GATK...")
        comando_filter_interno = (
            f"gatk FilterMutectCalls "
            f"-R /datasets/Homo_sapiens_assembly38.fasta "
            f"-V /processamento/{safe_uuid}_mutect_raw.vcf "
            f"-O /processamento/{safe_uuid}_mutect.vcf"
        )
        comando_filter = [
            "wsl", "-d", "Ubuntu", "-u", "root", "docker", "run", "--rm",
            "-v", f"{WSL_BASE}/datasets:/datasets",
            "-v", f"{WSL_BASE}/processamento:/processamento",
            "pantherflow-bioinfo", "sh", "-c", comando_filter_interno
        ]
        returncode = _executar_docker(comando_filter, caminho_log)
        tempos_etapas["mutect2"] = f"{time.time() - t0:.1f}s"
        if returncode != 0:
            raise Exception(f"Erro FilterMutectCalls (código {returncode}). Ver log do paciente para detalhes.")

        # --- ETAPA 4.7: NORMALIZAÇÃO CANÔNICA (bcftools norm) ---
        # INDELs podem ser representados de formas diferentes por VarScan2 e Mutect2
        # (left-aligned vs right-aligned, multi-alélico vs bi-alélico).
        # Sem normalização, a interseção perde variantes concordantes representadas diferentemente.
        # -m-any: divide registros multi-alélicos em linhas bi-alélicas separadas.
        # -f referência: executa left-alignment dos INDELs.
        escrever_log_ui(paciente_uuid, "Normalizando VCFs (bcftools norm): padronizando representação de INDELs...")

        def _normalizar_vcf(nome_entrada: str, nome_saida: str) -> int:
            """Roda bcftools norm para canonicalizar a representação de variantes."""
            cmd = (
                f"bcftools norm -m-any -f /datasets/Homo_sapiens_assembly38.fasta "
                f"/processamento/{shlex.quote(nome_entrada)} "
                f"> /processamento/{shlex.quote(nome_saida)}"
            )
            return _executar_docker([
                "wsl", "-d", "Ubuntu", "-u", "root", "docker", "run", "--rm",
                "-v", f"{WSL_BASE}/datasets:/datasets",
                "-v", f"{WSL_BASE}/processamento:/processamento",
                "pantherflow-bioinfo", "sh", "-c", cmd,
            ], caminho_log)

        # VarScan2 (mpileup2cns) produz cromossomos sem prefixo "chr" (ex: "1", "2").
        # A referência hg38 usa "chr1", "chr2" — bcftools norm abortaria com mismatch.
        # Solução: renomear com chr_name_map.txt antes de normalizar (pipe interno no shell).
        cmd_norm_varscan = (
            f"bcftools annotate --rename-chrs /datasets/chr_name_map.txt "
            f"/processamento/{shlex.quote(paciente_uuid + '_varscan.vcf')} "
            f"| bcftools norm -m-any -f /datasets/Homo_sapiens_assembly38.fasta "
            f"> /processamento/{shlex.quote(paciente_uuid + '_varscan_norm.vcf')}"
        )
        rc_norm_varscan = _executar_docker([
            "wsl", "-d", "Ubuntu", "-u", "root", "docker", "run", "--rm",
            "-v", f"{WSL_BASE}/datasets:/datasets",
            "-v", f"{WSL_BASE}/processamento:/processamento",
            "pantherflow-bioinfo", "sh", "-c", cmd_norm_varscan,
        ], caminho_log)
        if rc_norm_varscan != 0:
            escrever_log_ui(paciente_uuid, f"[AVISO] bcftools norm VarScan2 retornou código {rc_norm_varscan} — usando VCF original.")

        rc_norm_mutect = _normalizar_vcf(f"{paciente_uuid}_mutect.vcf", f"{paciente_uuid}_mutect_norm.vcf")
        if rc_norm_mutect != 0:
            escrever_log_ui(paciente_uuid, f"[AVISO] bcftools norm Mutect2 retornou código {rc_norm_mutect} — usando VCF original.")

        # --- ETAPA 5: CONSENSO MULTI-CALLER ---
        # Lê os VCFs NORMALIZADOS com fallback seguro:
        # verifica tamanho > 2KB para garantir que o arquivo não é só headers vazios
        # (bcftools cria o arquivo via redirect mesmo quando falha, mas sem variantes).
        escrever_log_ui(paciente_uuid, "Calculando consenso Multi-Caller (VarScan2 ∩ Mutect2 filtrado + normalizado)...")

        def _vcf_valido(path: Path) -> bool:
            return path.exists() and path.stat().st_size > 2048

        _varscan_norm = WSL_PROCESSAMENTO / f"{paciente_uuid}_varscan_norm.vcf"
        _mutect_norm  = WSL_PROCESSAMENTO / f"{paciente_uuid}_mutect_norm.vcf"
        vcf_varscan_path  = _varscan_norm if _vcf_valido(_varscan_norm) else WSL_PROCESSAMENTO / f"{paciente_uuid}_varscan.vcf"
        vcf_mutect_path   = _mutect_norm  if _vcf_valido(_mutect_norm)  else WSL_PROCESSAMENTO / f"{paciente_uuid}_mutect.vcf"
        vcf_consenso_path = WSL_PROCESSAMENTO / f"{paciente_uuid}_consensus.vcf"

        set_varscan  = parse_vcf(vcf_varscan_path)
        set_mutect   = parse_vcf(vcf_mutect_path)
        set_consenso = set_varscan.intersection(set_mutect)

        escrever_log_ui(
            paciente_uuid,
            f"Consenso calculado: VarScan2={len(set_varscan)} | Mutect2={len(set_mutect)} | Consenso={len(set_consenso)}"
        )

        # Gera o arquivo físico _consensus.vcf filtrando o Mutect2 pelo set de consenso.
        # O Mutect2 é o template porque seus headers são compatíveis com o SnpEff (formato GATK).
        escrever_consensus_vcf(vcf_mutect_path, set_consenso, vcf_consenso_path)
        escrever_log_ui(paciente_uuid, f"Arquivo de consenso gerado: {vcf_consenso_path.name}")

        # --- ETAPA 5.5: ANOTAÇÃO FUNCIONAL (SnpEff) — VarScan2 + Mutect2 + Consenso ---
        # Barreira de segurança: verifica o banco GRCh38.99 antes de qualquer chamada SnpEff.
        snpeff_db_path = WSL_DATASETS / "snpeff_data" / "GRCh38.99"
        if not snpeff_db_path.exists():
            raise FileNotFoundError(
                "Banco de dados SnpEff ausente. Execute o download manual:\n"
                "  docker run --rm -v ~/pantherflow-clinical/datasets:/datasets "
                "pantherflow-bioinfo snpEff download GRCh38.99 -dataDir /datasets/snpeff_data"
            )

        def _anotar_vcf(nome_entrada: str, nome_saida: str) -> int:
            """Roda SnpEff num VCF e escreve o resultado anotado via redirect de shell."""
            cmd = (
                f"snpEff ann -dataDir /datasets/snpeff_data -nodownload -Xmx4g GRCh38.99 "
                f"/processamento/{shlex.quote(nome_entrada)} "
                f"> /processamento/{shlex.quote(nome_saida)}"
            )
            return _executar_docker([
                "wsl", "-d", "Ubuntu", "-u", "root", "docker", "run", "--rm",
                "-v", f"{WSL_BASE}/datasets:/datasets",
                "-v", f"{WSL_BASE}/processamento:/processamento",
                "pantherflow-bioinfo", "sh", "-c", cmd,
            ], caminho_log)

        def _anotar_snpsift(vcf_entrada: str, vcf_saida: str, vcf_db: str, campos: str) -> int:
            """Roda SnpSift annotate para injetar campos de um banco externo (ClinVar, COSMIC)."""
            cmd = (
                f"SnpSift annotate -info {campos} "
                f"/datasets/{vcf_db} "
                f"/processamento/{shlex.quote(vcf_entrada)} "
                f"> /processamento/{shlex.quote(vcf_saida)}"
            )
            return _executar_docker([
                "wsl", "-d", "Ubuntu", "-u", "root", "docker", "run", "--rm",
                "-v", f"{WSL_BASE}/datasets:/datasets",
                "-v", f"{WSL_BASE}/processamento:/processamento",
                "pantherflow-bioinfo", "sh", "-c", cmd,
            ], caminho_log)

        t0 = time.time()
        escrever_log_ui(paciente_uuid, "Executando SnpEff: Anotando variantes VarScan2...")
        rc_varscan = _anotar_vcf(f"{paciente_uuid}_varscan.vcf", f"{paciente_uuid}_varscan_annotated.vcf")
        if rc_varscan != 0:
            escrever_log_ui(paciente_uuid, f"[AVISO] SnpEff VarScan2 retornou código {rc_varscan} — tabela de anotação pode ficar vazia.")

        escrever_log_ui(paciente_uuid, "Executando SnpEff: Anotando variantes Mutect2...")
        rc_mutect = _anotar_vcf(f"{paciente_uuid}_mutect.vcf", f"{paciente_uuid}_mutect_annotated.vcf")
        if rc_mutect != 0:
            escrever_log_ui(paciente_uuid, f"[AVISO] SnpEff Mutect2 retornou código {rc_mutect} — tabela de anotação pode ficar vazia.")

        escrever_log_ui(paciente_uuid, "Executando SnpEff: Anotando variantes de Consenso...")
        rc_consenso = _anotar_vcf(f"{paciente_uuid}_consensus.vcf", f"{paciente_uuid}_consensus_snpeff.vcf")
        if rc_consenso != 0:
            raise Exception(f"Erro SnpEff Consenso (código {rc_consenso}). Ver log do paciente para detalhes.")

        # --- ETAPA 5.6: ANOTAÇÃO CLÍNICA — ClinVar (patogenicidade) ---
        # Injeta CLNSIG (Pathogenic/Benign/VUS) e CLNDN (nome da doença associada).
        # Transforma a lista de variantes em interpretação clínica direta.
        escrever_log_ui(paciente_uuid, "Executando SnpSift: Anotando com ClinVar (patogenicidade)...")
        rc_clinvar = _anotar_snpsift(
            f"{paciente_uuid}_consensus_snpeff.vcf",
            f"{paciente_uuid}_consensus_clinvar.vcf",
            "clinvar.vcf.gz",
            "CLNSIG,CLNDN"
        )
        if rc_clinvar != 0:
            escrever_log_ui(paciente_uuid, f"[AVISO] SnpSift ClinVar retornou código {rc_clinvar} — campos clínicos ausentes no laudo.")

        # --- ETAPA 5.7: ANOTAÇÃO ONCOLÓGICA — COSMIC (frequência em tumores) ---
        # Injeta CNT (contagem de amostras com esta mutação no banco COSMIC v103).
        # Variantes com alto CNT são recorrentes em tumores — forte evidência de driver somático.
        escrever_log_ui(paciente_uuid, "Executando SnpSift: Anotando com COSMIC (frequência oncológica)...")
        vcf_entrada_cosmic = (
            f"{paciente_uuid}_consensus_clinvar.vcf"
            if (WSL_PROCESSAMENTO / f"{paciente_uuid}_consensus_clinvar.vcf").exists()
            else f"{paciente_uuid}_consensus_snpeff.vcf"
        )
        rc_cosmic = _anotar_snpsift(
            vcf_entrada_cosmic,
            f"{paciente_uuid}_consensus_annotated.vcf",
            "Cosmic_GenomeScreensMutant_v103_GRCh38.vcf.gz",
            "CNT"
        )
        tempos_etapas["snpeff"] = f"{time.time() - t0:.1f}s"
        if rc_cosmic != 0:
            escrever_log_ui(paciente_uuid, f"[AVISO] SnpSift COSMIC retornou código {rc_cosmic} — campo CNT ausente no laudo.")
            # Fallback: usa o VCF ClinVar (sem COSMIC) como anotado final
            import shutil as _shutil
            _src = WSL_PROCESSAMENTO / vcf_entrada_cosmic
            _dst = WSL_PROCESSAMENTO / f"{paciente_uuid}_consensus_annotated.vcf"
            if _src.exists() and not _dst.exists():
                _shutil.copy2(_src, _dst)

        # --- ETAPA 6: LIMPEZA E ATUALIZAÇÃO FINAL ---
        arquivo_sam      = WSL_PROCESSAMENTO / f"{paciente_uuid}.sam"
        if arquivo_sam.exists():
            os.remove(arquivo_sam)

        # Parseia o VCF anotado e gera o resumo para o banco.
        # parsear_anotacoes_snpeff() nunca lança exceção — retorna {} em caso de falha.
        vcf_anotado_path = WSL_PROCESSAMENTO / f"{paciente_uuid}_consensus_annotated.vcf"
        annotation_summary = parsear_anotacoes_snpeff(vcf_anotado_path)
        escrever_log_ui(
            paciente_uuid,
            f"Anotação SnpEff: {annotation_summary.get('total_annotated', 0)} variantes "
            f"({annotation_summary.get('high_impact', 0)} HIGH, "
            f"{annotation_summary.get('moderate_impact', 0)} MODERATE)"
        )

        # Puxa o registro do banco para salvar as métricas e a rastreabilidade
        registro_final = db.query(Analysis).filter(Analysis.patient_uuid == paciente_uuid).first()
        if not registro_final:
            raise RuntimeError(
                f"Registro do paciente não encontrado no banco (UUID: {paciente_uuid}). "
                "Laudo não pode ser salvo. Verifique a integridade do banco de dados."
            )
        if registro_final:
            registro_final.status = "completed"

            # Métricas Biológicas
            registro_final.total_reads = total_reads
            registro_final.mapping_rate = mapping_rate
            registro_final.mean_coverage = mean_coverage

            # Rastreabilidade Clínica
            registro_final.bwa_version = "0.7.17-r1188"
            registro_final.samtools_version = "1.13"
            registro_final.reference_version = "Homo_sapiens_assembly38"

            # Multi-Caller Consensus
            registro_final.variants_varscan   = len(set_varscan)
            registro_final.variants_mutect    = len(set_mutect)
            registro_final.variants_consensus = len(set_consenso)

            # Detalhe por caller — variantes anotadas pelo SnpEff (gene, effect, impact, hgvs_p)
            varscan_ann = parsear_anotacoes_snpeff(WSL_PROCESSAMENTO / f"{paciente_uuid}_varscan_annotated.vcf")
            mutect_ann  = parsear_anotacoes_snpeff(WSL_PROCESSAMENTO / f"{paciente_uuid}_mutect_annotated.vcf")
            registro_final.varscan_details = json.dumps(varscan_ann.get("top_variants", []))
            registro_final.mutect_details  = json.dumps(mutect_ann.get("top_variants",  []))

            # Anotação Funcional (SnpEff)
            if annotation_summary:
                registro_final.annotation_summary = json.dumps(annotation_summary)

            # Telemetria
            registro_final.time_total = f"{time.time() - pipeline_start:.1f}s"
            registro_final.time_steps = json.dumps(tempos_etapas)

            db.commit()

        escrever_log_ui(paciente_uuid, "PIPELINE FINALIZADO COM SUCESSO. Laudo disponível.")

    except Exception as e:
        # Se algo quebrar, avisa o React imediatamente.
        # escrever_log_ui pode falhar (WSL2 offline) — isolamos para garantir que
        # atualizar_fase("failed") sempre execute e o banco nunca fique em "processing".
        try:
            escrever_log_ui(paciente_uuid, f"ERRO FATAL: Falha na execução da pipeline. Detalhe: {str(e)}")
        except Exception as log_err:
            logger.error(f"[{paciente_uuid}] Falha ao escrever log de erro: {log_err}. Erro original: {e}")
        atualizar_fase("failed")
    finally:
        db.close()