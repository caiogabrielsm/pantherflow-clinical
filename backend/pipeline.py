from pathlib import Path
import logging
import subprocess
import os
import shlex
import re
import shutil
import time
import json
import queue
import threading

from database import SessionLocal
from models import Analysis

logger = logging.getLogger(__name__)

# --- CONFIGURAÇÃO DE CAMINHOS (Ponte Windows -> WSL2) ---
# WSL_USER é lido do .env para 1ário padrão de distros WSL2 recém-instaladas.
WSL_USER = os.getenv("WSL_USER", "ubuntu")
WSL_BASE = f"/home/{WSL_USER}/pantherflow-clinical"

WSL_PROCESSAMENTO = Path(rf"\\wsl.localhost\Ubuntu{WSL_BASE}\processamento")
WSL_DATASETS      = Path(rf"\\wsl.localhost\Ubuntu{WSL_BASE}\datasets")

# Diretório seguro para VCFs de auditoria — fora do WSL_PROCESSAMENTO para não ser
# varrido pelo DELETE /api/analysis/{id} (que apaga glob(uuid*)  em WSL_PROCESSAMENTO).
# Os arquivos aqui persistem para a rota /api/auditoria/concordancia.
AUDITORIA_DIR = Path(__file__).resolve().parent / "data" / "auditoria"
AUDITORIA_DIR.mkdir(parents=True, exist_ok=True)
_MANIFESTO_PATH = Path(__file__).resolve().parent / "config" / "manifesto_benchmarking.json"
_BED_TWIST = (
    "painel_twist/output_InterpriseUSA_UFCSPA_pulmao_TE-97054821_hg38/"
    "Target_bases_covered_by_probes_InterpriseUSA_UFCSPA_pulmao_TE-97054821_hg38_250708161615.bed"
)
NOME_ARQUIVO_BED          = _BED_TWIST   # painel físico Twist — usado por VarScan2, Mutect2
NOME_ARQUIVO_BED_COVERAGE = _BED_TWIST   # mesmo painel — usado por samtools coverage

# Raiz do projeto: backend/pipeline.py → parent → backend/ → parent → project root
HOST_REFERENCES_DIR = Path(__file__).resolve().parent.parent / "references"

def _windows_to_wsl_path(p: Path | str) -> str:
    """Converte path Windows para o equivalente WSL2 (/mnt/<drive>/...).
    Necessário para montar volumes Docker via 'wsl docker run -v', que espera
    paths Linux. Ex: C:\\foo\\bar -> /mnt/c/foo/bar
    """
    s = str(p).replace("\\", "/")
    s = re.sub(r'^([a-zA-Z]):/', lambda m: f"/mnt/{m.group(1).lower()}/", s)
    return s

WSL_REFERENCES_DIR = _windows_to_wsl_path(HOST_REFERENCES_DIR)

# Panel of Normals (PoN) — resolvido por genoma em processar_paciente_wsl.
# Mantemos as constantes hg38 como fallback para retrocompatibilidade.
LOCAL_PON_PATH  = HOST_REFERENCES_DIR / "hg38/gatk_resources/1000g_pon.hg38.vcf.gz"
DOCKER_PON_PATH = "/references/hg38/gatk_resources/1000g_pon.hg38.vcf.gz"

# Mapa de recursos por versão de genoma
_GNOMAD_BY_GENOME = {
    "hg38": "af-only-gnomad.hg38.vcf.gz",
    "hg19": "af-only-gnomad.hg19.vcf.gz",
}
# small_exac_common: usado no GetPileupSummaries (menor e mais rápido que gnomAD completo)
_PILEUP_VCF_BY_GENOME = {
    "hg38": "af-only-gnomad.hg38.vcf.gz",
    "hg19": "small_exac_common_3.hg19.vcf.gz",
}
# PoN hg38 fica em /references (volume separado); hg19 fica em /datasets junto com os demais recursos
_PON_LOCAL_BY_GENOME = {
    "hg38": HOST_REFERENCES_DIR / "hg38/gatk_resources/1000g_pon.hg38.vcf.gz",
    "hg19": WSL_DATASETS / "1000g_pon.hg19.vcf.gz",
}
_PON_DOCKER_BY_GENOME = {
    "hg38": "/references/hg38/gatk_resources/1000g_pon.hg38.vcf.gz",
    "hg19": "/datasets/1000g_pon.hg19.vcf.gz",
}

# --- IMAGENS DOCKER ---
BIOINFO_IMAGE = "pantherflow-bioinfo"   # imagem monolítica: BWA, GATK, VarScan2, samtools, FastQC, SnpEff
FASTP_IMAGE   = "staphb/fastp:latest"   # pré-processamento de FASTQs (substitui Trimmomatic)

# Timeouts do watchdog por categoria de ferramenta (em segundos).
# O watchdog distingue "silêncio legítimo de processamento intenso" do bug de teardown WSL2
# (onde o pipe permanece aberto após o container encerrar).
# Calibrar por ferramenta evita falsos positivos em amostras WES/WGS grandes.
_WATCHDOG_CURTO_S      =   600   # Ferramentas rápidas com output frequente: FastQC, FilterMutect, bcftools
_WATCHDOG_MEDIO_S      =  3600   # Silenciosas por até 1 h: VarScan2, samtools coverage, GATK pileup/ROM
_WATCHDOG_LONGO_S      =  7200   # Silenciosas por até 2 h: fastp (WES), LoFreq, SnpSift (grandes DBs)
_WATCHDOG_MUITO_LONGO_S = 21600  # Silenciosas por até 6 h: BWA-MEM / Mutect2 em WGS ou SEQC2 (~70 GB)

LOFREQ_IMAGE  = "quay.io/biocontainers/lofreq:2.1.5--py310h8360dc1_7"  # Biocontainers — versão pinada para reprodutibilidade
_VCF_FILTROS_ACEITOS = {"PASS", "."}  # Valores de FILTER aceitos por parse_vcf

# --- ALOCAÇÃO DINÂMICA DE THREADS ---
# Reserva 2 núcleos para o SO e para o orquestrador FastAPI.
# os.cpu_count() dentro do WSL2 reflete o valor "processors=" do .wslconfig.
# Se o .wslconfig não estiver configurado, o WSL2 expõe max(metade dos físicos, 8).
# Garante mínimo de 1 para evitar flag inválida em máquinas de 1 core (ex: CI).
_CPU_RESERVA  = int(os.getenv("PANTHERFLOW_CPU_RESERVA", "2"))
_N_THREADS    = max(1, (os.cpu_count() or 4) - _CPU_RESERVA)

# --- PARÂMETROS VARSCAN2 ---
# min-coverage baixo para máxima sensibilidade; filtragem por DP fica no frontend/parsear.
# min_dp do usuário NÃO deve ser usado aqui — serve apenas para report, não para chamada.
_VARSCAN_MIN_COV = 20

def _executar_docker(comando: list, caminho_log: Path, watchdog_s: int = _WATCHDOG_CURTO_S) -> int:
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

        ultimo_output = time.time()

        try:
            while True:
                try:
                    linha = fila.get(timeout=1)
                    if linha is None:       # Sentinela: pipe fechou com EOF real
                        break
                    log_f.write(linha)
                    log_f.flush()
                    ultimo_output = time.time()
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
                    # Watchdog: pipe aberto mas sem output por tempo excessivo.
                    # Causa conhecida: bug de teardown WSL2 — wsl.exe mantém o pipe vivo
                    # após o container encerrar, impedindo o EOF e travando a thread _ler_pipe.
                    ocioso = time.time() - ultimo_output
                    if ocioso > watchdog_s:
                        logger.warning(
                            "Watchdog: sem output há %.0f s (limite=%ds) — possível bug de teardown WSL2. "
                            "Forçando encerramento do processo.", ocioso, watchdog_s
                        )
                        log_f.write(
                            f"[WATCHDOG] Sem output há {ocioso:.0f}s (limite={watchdog_s}s) — processo encerrado forçadamente "
                            f"(bug de teardown WSL2).\n"
                        )
                        log_f.flush()
                        processo.kill()
                        break
                    # Processo ainda vivo e sem output → continua aguardando
        except KeyboardInterrupt:
            logger.warning("Processamento interrompido pelo usuário (KeyboardInterrupt).")
            log_f.write("[AVISO] Processamento interrompido pelo usuário.\n")
            log_f.flush()
            processo.kill()
            raise

        try:
            processo.wait(timeout=30)
        except subprocess.TimeoutExpired:
            logger.warning("Timeout ao aguardar encerramento do container Docker — forçando kill.")
            processo.kill()
    return processo.returncode


def parse_vcf(filepath: Path) -> set:
    """Lê um arquivo VCF e retorna um set de tuplas (CHROM, POS, REF, ALT).

    Ignora linhas de cabeçalho ('#') e variantes cujo campo FILTER não seja
    'PASS' ou '.' (ponto = nenhum filtro aplicado, padrão do VarScan2).
    Isso garante que artefatos marcados pelo FilterMutectCalls (germline,
    weak_evidence, strand_bias, etc.) nunca entrem no set de consenso,
    resolvendo BUG-09 e BUG-17.

    Retorna set vazio se o arquivo não existir ou estiver malformado,
    sem interromper o pipeline.
    """
    variantes = set()
    try:
        with open(filepath, "r", encoding="utf-8", errors="replace") as f:
            for linha in f:
                if linha.startswith("#"):
                    continue
                colunas = linha.strip().split("\t")
                if len(colunas) < 7:
                    continue
                filtro = colunas[6]
                if filtro not in _VCF_FILTROS_ACEITOS:
                    logger.info(
                        f"[parse_vcf] {filepath.name} pos={colunas[1]} "
                        f"rejeitada pelo filtro: '{filtro}'"
                    )
                    continue
                chrom, pos, ref, alt = colunas[0], colunas[1], colunas[3], colunas[4]
                variantes.add((chrom, pos, ref, alt))
    except (FileNotFoundError, OSError):
        pass
    return variantes


def parsear_anotacoes_snpeff(vcf_anotado_path: Path) -> dict:
    """Lê o VCF anotado pelo SnpEff e extrai um resumo estruturado do campo ANN=.

    Formato do campo ANN= (pipe-delimitado, por alelo):
      ANN=ALT|effect|impact|gene|gene_id|feature_type|feature_id|
          transcript_biotype|rank|hgvs_c|hgvs_p|...

    Retorna um dict com contagens por impacto e todas as variantes ordenadas
    por impacto (HIGH primeiro, depois MODERATE, LOW, MODIFIER).
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

                if colunas[6] not in {"PASS", "."}:
                    continue

                chrom, pos, ref, alt = colunas[0], colunas[1], colunas[3], colunas[4]
                info = colunas[7]

                # Parseia FORMAT/SAMPLE uma única vez — reutilizado por stat_conf, vaf e dp.
                fmt_dict: dict = {}
                if len(colunas) >= 10:
                    fmt_dict = dict(zip(colunas[8].split(":"), colunas[9].split(":")))

                # --- Confiança Estatística (auto-detecção de caller) ---
                # Mutect2: TLOD no campo INFO  →  "TLOD: X.XX"
                # VarScan2: PVAL no campo FORMAT/SAMPLE  →  "p-val: X.XXXX"
                stat_conf = "N/A"
                tlod_match = re.search(r'TLOD=([^;,]+)', info)
                if tlod_match:
                    try:
                        stat_conf = f"TLOD: {float(tlod_match.group(1)):.2f}"
                    except ValueError:
                        pass
                elif fmt_dict:
                    pval_raw = fmt_dict.get("PVAL")
                    if pval_raw:
                        try:
                            stat_conf = f"p-val: {float(pval_raw):.4f}"
                        except ValueError:
                            pass

                # --- VAF ---
                # VarScan2: FREQ="15.50%" → 0.155  |  Mutect2: AF="0.155" (multi-alélico: pega [0])
                vaf: float | None = None
                freq_str = fmt_dict.get("FREQ", "")
                af_str   = fmt_dict.get("AF", "").split(",")[0]
                if freq_str:
                    try:
                        vaf = round(float(freq_str.replace("%", "")) / 100.0, 6)
                    except ValueError:
                        pass
                elif af_str:
                    try:
                        vaf = round(float(af_str), 6)
                    except ValueError:
                        pass

                # --- DP ---
                dp: int | None = None
                try:
                    dp = int(fmt_dict.get("DP", ""))
                except (ValueError, TypeError):
                    pass

                # Extrai o campo ANN= do INFO.
                # Variantes sem ANN= (SnpEff não rodou ou falhou) ainda são incluídas
                # com valores neutros para que a tabela do frontend não fique vazia.
                ann_match = re.search(r'ANN=([^;]+)', info)
                if ann_match:
                    primeira_ann = ann_match.group(1).split(",")[0]
                    campos_ann = primeira_ann.split("|")
                    if len(campos_ann) >= 11:
                        effect = campos_ann[1]   # ex: missense_variant
                        impact = campos_ann[2]   # HIGH | MODERATE | LOW | MODIFIER
                        gene   = campos_ann[3]   # ex: TP53
                        hgvs_p = campos_ann[10]  # ex: p.Arg248Trp
                    else:
                        effect, impact, gene, hgvs_p = "—", "MODIFIER", "—", "—"
                else:
                    effect, impact, gene, hgvs_p = "—", "MODIFIER", "—", "—"

                if impact in contagens:
                    contagens[impact] += 1

                # Campos ClinVar (injetados pelo SnpSift)
                clnsig_match = re.search(r'CLNSIG=([^;]+)', info)
                clndn_match  = re.search(r'CLNDN=([^;]+)', info)
                cnt_match    = re.search(r'CNT=(\d+)', info)
                # Frequência populacional gnomAD (injetada pelo SnpSift na Etapa 5.8)
                # AF pode aparecer como AF=0.003 ou AF=0.003,0.001 (multi-alélico — pega o primeiro)
                af_match = re.search(r'(?<![A-Z])AF=([^;]+)', info)
                pop_af_raw = af_match.group(1).split(",")[0] if af_match else None
                try:
                    pop_af = round(float(pop_af_raw), 6) if pop_af_raw else None
                except ValueError:
                    pop_af = None

                variantes_brutas.append({
                    "chrom":                    chrom,
                    "pos":                      pos,
                    "ref":                      ref,
                    "alt":                      alt,
                    "gene":                     gene,
                    "effect":                   effect,
                    "impact":                   impact,
                    "hgvs_p":                   hgvs_p or "—",
                    "vaf":                      vaf,
                    "dp":                       dp,
                    "pop_af":                   pop_af,
                    "clinvar_sig":              clnsig_match.group(1).replace("_", " ") if clnsig_match else "—",
                    "clinvar_disease":          clndn_match.group(1).replace("_", " ").replace("|", " / ") if clndn_match else "—",
                    "cosmic_cnt":               cnt_match.group(1) if cnt_match else "—",
                    "statistical_confidence":   stat_conf,
                })

    except (FileNotFoundError, OSError):
        return {}

    # Ordena: HIGH primeiro, depois MODERATE, LOW, MODIFIER
    variantes_brutas.sort(key=lambda v: IMPACTOS_ORDEM.get(v["impact"], 99))

    return {
        "total_annotated": len(variantes_brutas),
        "high_impact":     contagens["HIGH"],
        "moderate_impact": contagens["MODERATE"],
        "low_impact":      contagens["LOW"],
        "modifier_impact": contagens["MODIFIER"],
        "top_variants":    variantes_brutas,
    }


def extrair_metricas_vcf(caminho_arquivo: Path, nome_caller: str) -> list[dict]:
    """Extrai VAF e DP de cada variante de um VCF, normalizando diferenças entre callers.

    VarScan2: VAF está na coluna FORMAT como FREQ=5.5% (string com %).
    Mutect2 / Consenso: VAF está no campo FORMAT como AF=0.055 (float decimal).
    DP está disponível em ambos como DP= no campo FORMAT.

    Retorna lista de {"vaf": float, "dp": int, "caller": str}.
    Linhas sem os campos esperados são silenciosamente ignoradas.
    """
    resultados: list[dict] = []

    try:
        with open(caminho_arquivo, "r", encoding="utf-8", errors="replace") as f:
            format_keys: list[str] = []
            for linha in f:
                if linha.startswith("#"):
                    continue
                colunas = linha.strip().split("\t")
                # VCF mínimo: CHROM POS ID REF ALT QUAL FILTER INFO FORMAT SAMPLE
                if len(colunas) < 10:
                    continue

                format_keys = colunas[8].split(":")
                sample_vals = colunas[9].split(":")
                fmt = dict(zip(format_keys, sample_vals))

                # --- VAF ---
                vaf: float | None = None
                if nome_caller == "VarScan2":
                    freq_str = fmt.get("FREQ", "")
                    try:
                        vaf = float(freq_str.replace("%", "")) / 100.0
                    except ValueError:
                        pass
                else:  # Mutect2 ou Consenso
                    af_str = fmt.get("AF", "").split(",")[0]  # pega o primeiro alelo
                    try:
                        vaf = float(af_str)
                    except ValueError:
                        pass

                # --- DP ---
                dp: int | None = None
                try:
                    dp = int(fmt.get("DP", ""))
                except ValueError:
                    pass

                if vaf is not None and dp is not None:
                    resultados.append({"vaf": round(vaf, 6), "dp": dp, "caller": nome_caller})

    except (FileNotFoundError, OSError):
        pass

    return resultados


def escrever_consensus_vcf(vcf_mutect_path: Path, set_consenso: set, vcf_saida: Path) -> None:
    """Filtra o VCF do Mutect2, mantendo apenas as variantes presentes no set de consenso.

    Usa o Mutect2 como template porque seus headers são mais completos e o SnpEff
    lida melhor com VCFs no formato GATK. Preserva todos os headers (#) intactos.
    Não lança exceção se o arquivo de saída já existir — sobrescreve silenciosamente.

    Se set_consenso for vazio, não cria o arquivo de saída — a ausência do arquivo
    é detectada por _vcf_valido() downstream, impedindo que etapas de anotação
    processem um VCF sem variantes.
    """
    if not set_consenso:
        logger.warning(f"Consenso vazio — nenhuma variante em comum entre VarScan2 e Mutect2. Arquivo {vcf_saida.name} não será criado.")
        return

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
    try:
        with open(caminho_log, "a", encoding="utf-8") as f:
            f.write(f"> {mensagem}\n")
    except OSError as exc:
        logger.warning("[%s] Falha ao escrever log UI: %s", uuid, exc)


def run_fastp(
    nome_r1: str,
    nome_r2: str | None,
    paciente_uuid: str,
    caminho_log: Path,
) -> tuple[Path, Path | None]:
    """Limpeza de adaptadores e filtro de qualidade via fastp.

    Monta WSL_BASE/processamento em /workdir dentro do container staphb/fastp.
    PE: autodetecção de adaptadores via --detect_adapter_for_pe.
    SE: detecção automática (sem flag extra — fastp infere do input único).
    Retorna os paths locais (WSL_PROCESSAMENTO) dos FASTQs limpos gerados.
    """
    def _clean_name(nome: str) -> str:
        for ext in (".fastq.gz", ".fq.gz", ".fastq", ".fq"):
            if nome.endswith(ext):
                return nome[: -len(ext)] + "_clean" + ext
        return nome + "_clean"

    out_r1      = _clean_name(nome_r1)
    safe_r1     = shlex.quote(nome_r1)
    safe_out_r1 = shlex.quote(out_r1)
    safe_uuid   = shlex.quote(paciente_uuid)

    if nome_r2:
        out_r2      = _clean_name(nome_r2)
        safe_r2     = shlex.quote(nome_r2)
        safe_out_r2 = shlex.quote(out_r2)
        cmd_interno = (
            f"fastp"
            f" -i /workdir/{safe_r1} -I /workdir/{safe_r2}"
            f" -o /workdir/{safe_out_r1} -O /workdir/{safe_out_r2}"
            f" -j /workdir/{safe_uuid}_fastp.json"
            f" -h /workdir/{safe_uuid}_fastp.html"
            f" --detect_adapter_for_pe --thread {_N_THREADS}"
        )
    else:
        out_r2      = None
        cmd_interno = (
            f"fastp"
            f" -i /workdir/{safe_r1}"
            f" -o /workdir/{safe_out_r1}"
            f" -j /workdir/{safe_uuid}_fastp.json"
            f" -h /workdir/{safe_uuid}_fastp.html"
            f" --thread {_N_THREADS}"
        )

    comando = [
        "wsl", "-d", "Ubuntu", "-u", "root", "docker", "run", "--rm",
        "-v", f"{WSL_BASE}/processamento:/workdir",
        FASTP_IMAGE, "sh", "-c", cmd_interno,
    ]
    returncode = _executar_docker(comando, caminho_log, _WATCHDOG_LONGO_S)
    if returncode != 0:
        raise Exception(f"Erro fastp (código {returncode}). Ver log do paciente para detalhes.")

    return (
        WSL_PROCESSAMENTO / out_r1,
        WSL_PROCESSAMENTO / out_r2 if out_r2 else None,
    )


def run_lofreq(
    bam_name: str,
    docker_ref_genome: str,
    docker_target_bed: str | None,
    paciente_uuid: str,
    caminho_log: Path,
) -> Path:
    """Chama variantes somáticas de baixa frequência via LoFreq (tumor-only).

    Monta WSL_BASE/datasets em /datasets e WSL_BASE/processamento em /processamento.
    Usa call-parallel com 4 threads; --call-indels habilita chamada de pequenos indels.
    A flag -l é omitida quando docker_target_bed é None (WGS/exoma sem painel).
    Retorna o path local (WSL_PROCESSAMENTO) do VCF bruto gerado.
    """
    safe_bam  = shlex.quote(bam_name)
    vcf_out   = f"{paciente_uuid}_lofreq.vcf"
    safe_vcf  = shlex.quote(vcf_out)

    bed_flag = f"-l {shlex.quote(docker_target_bed)} " if docker_target_bed else ""

    cmd_interno = (
        f"lofreq call-parallel --pp-threads {_N_THREADS} --call-indels"
        f" -f {docker_ref_genome}"
        f" {bed_flag}"
        f"-o /processamento/{safe_vcf}"
        f" /processamento/{safe_bam}"
    )

    comando = [
        "wsl", "-d", "Ubuntu", "-u", "root", "docker", "run", "--rm",
        "-v", f"{WSL_BASE}/datasets:/datasets",
        "-v", f"{WSL_BASE}/processamento:/processamento",
        LOFREQ_IMAGE, "sh", "-c", cmd_interno,
    ]
    returncode = _executar_docker(comando, caminho_log, _WATCHDOG_LONGO_S)
    if returncode != 0:
        raise Exception(f"Erro LoFreq (código {returncode}). Ver log do paciente para detalhes.")

    return WSL_PROCESSAMENTO / vcf_out


def _registrar_run_no_manifesto(patient_id: str, paciente_uuid: str, min_dp: int, vaf: float, modo_bam: bool) -> None:
    """Adiciona automaticamente o run ao manifesto de benchmarking após pipeline bem-sucedida."""
    try:
        if not _MANIFESTO_PATH.exists():
            return
        with open(_MANIFESTO_PATH, encoding="utf-8") as fh:
            manifesto = json.load(fh)

        amostras = manifesto.setdefault("amostras", {})

        # Normaliza o nome da amostra: "Pul045_20_05" → "Pul045"
        # O patient_id pode conter sufixo de parâmetros (convenção antiga) ou ser o nome direto.
        partes = patient_id.rsplit("_", 2)
        try:
            if len(partes) == 3 and int(partes[1]) and int(partes[2]):
                nome_amostra = partes[0]
            else:
                nome_amostra = patient_id
        except ValueError:
            nome_amostra = patient_id

        # Cria entrada da amostra se não existir
        if nome_amostra not in amostras:
            amostras[nome_amostra] = {
                "tsv_ion": f"backend/data/real_data/ion_torrent/{nome_amostra}_ion.tsv",
                "runs": [],
            }

        runs = amostras[nome_amostra].setdefault("runs", [])

        # Evita duplicatas
        if any(r.get("vcf_uuid") == paciente_uuid for r in runs):
            return

        # Rótulo: BAM_DP{min_dp}_VAF{vaf_pct} ou DP{min_dp}_VAF{vaf_pct}
        vaf_pct = int(round(vaf * 100))
        prefixo = "BAM_" if modo_bam else ""
        rotulo  = f"{prefixo}DP{min_dp}_VAF{vaf_pct}"

        # Garante unicidade do rótulo adicionando sufixo se necessário
        rotulos_existentes = {r.get("rotulo", "") for r in runs}
        rotulo_final = rotulo
        sufixo = 2
        while rotulo_final in rotulos_existentes:
            rotulo_final = f"{rotulo}_{sufixo}"
            sufixo += 1

        runs.append({
            "rotulo":   rotulo_final,
            "vcf_uuid": paciente_uuid,
            "min_dp":   min_dp,
            "min_vaf":  vaf,
        })

        with open(_MANIFESTO_PATH, "w", encoding="utf-8") as fh:
            json.dump(manifesto, fh, ensure_ascii=False, indent=2)

        logger.info("[%s] Run registrado no manifesto: %s → %s", paciente_uuid, nome_amostra, rotulo_final)
    except Exception as e:
        logger.warning("[%s] Falha ao registrar no manifesto (não crítico): %s", paciente_uuid, e)


def _vcf_valido(path: Path) -> bool:
    if not path.exists() or path.stat().st_size == 0:
        return False
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as _f:
            return any(not l.startswith("#") for l in _f)
    except OSError:
        return False


def anotar_vcf_completo(
    input_vcf: str,
    output_vcf: str,
    paciente_uuid: str,
    caminho_log: Path,
    genome_key: str = "hg38",
) -> None:
    """Aplica a cadeia completa de anotação (SnpEff → ClinVar → COSMIC → gnomAD) a um VCF.

    input_vcf / output_vcf são nomes de arquivo (sem path) dentro de WSL_PROCESSAMENTO.
    Cada etapa SnpSift tem fallback: se falhar, copia o resultado anterior para não quebrar a cadeia.
    """
    stem = input_vcf.rsplit(".", 1)[0]  # nome base sem extensão

    def _snpeff(nome_entrada: str, nome_saida: str) -> int:
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
        ], caminho_log, _WATCHDOG_LONGO_S)

    def _snpsift(vcf_entrada: str, vcf_saida: str, vcf_db: str, campos: str) -> int:
        # _JAVA_OPTIONS: força heap de 8 GB e desativa acesso à rede no JVM.
        # -noLog: suprime tentativas do SnpSift de reportar usage via HTTP (causa timeout).
        cmd = (
            f"export _JAVA_OPTIONS='-Xms2g -Xmx8g -Djava.net.useSystemProxies=false "
            f"-Dhttp.proxyHost= -Dhttps.proxyHost='; "
            f"SnpSift annotate -noLog -info {campos} "
            f"/datasets/{vcf_db} "
            f"/processamento/{shlex.quote(vcf_entrada)} "
            f"> /tmp/{shlex.quote(vcf_saida)} "
            f"&& mv /tmp/{shlex.quote(vcf_saida)} /processamento/{shlex.quote(vcf_saida)}; "
            f"_rc=$?; chmod -R 777 /processamento; exit $_rc"
        )
        return _executar_docker([
            "wsl", "-d", "Ubuntu", "-u", "root", "docker", "run", "--rm",
            "-v", f"{WSL_BASE}/datasets:/datasets",
            "-v", f"{WSL_BASE}/processamento:/processamento",
            "pantherflow-bioinfo", "sh", "-c", cmd,
        ], caminho_log, _WATCHDOG_LONGO_S)

    def _fallback_copy(src_name: str, dst_name: str) -> None:
        src = WSL_PROCESSAMENTO / src_name
        dst = WSL_PROCESSAMENTO / dst_name
        if src.exists():
            try:
                shutil.copy2(src, dst)
            except Exception as e:
                escrever_log_ui(paciente_uuid, f"[ERRO] Fallback copy {src_name} → {dst_name} falhou: {e}")
                logger.error(f"[{paciente_uuid}] Fallback shutil.copy2 falhou: {e}")

    # Nomes intermediários derivados do stem do input
    snpeff_vcf  = f"{stem}_snpeff.vcf"
    clinvar_vcf = f"{stem}_clinvar.vcf"
    cosmic_vcf  = f"{stem}_cosmic.vcf"

    # 1. SnpEff — anotação funcional
    escrever_log_ui(paciente_uuid, f"  [SnpEff] {input_vcf} → {snpeff_vcf}")
    rc = _snpeff(input_vcf, snpeff_vcf)
    if rc != 0:
        escrever_log_ui(paciente_uuid, f"[AVISO] SnpEff retornou código {rc} em {input_vcf}.")

    # 2. ClinVar — patogenicidade
    escrever_log_ui(paciente_uuid, f"  [ClinVar] {snpeff_vcf} → {clinvar_vcf}")
    rc_clinvar = _snpsift(snpeff_vcf, clinvar_vcf, "clinvar.vcf.gz", "CLNSIG,CLNDN")
    if rc_clinvar != 0:
        escrever_log_ui(paciente_uuid, f"[AVISO] SnpSift ClinVar retornou código {rc_clinvar} — campos clínicos ausentes.")
        _fallback_copy(snpeff_vcf, clinvar_vcf)

    # 3. COSMIC — frequência oncológica
    _clinvar_ok = rc_clinvar == 0 and _vcf_valido(WSL_PROCESSAMENTO / clinvar_vcf)
    cosmic_entrada = clinvar_vcf if _clinvar_ok else snpeff_vcf
    escrever_log_ui(paciente_uuid, f"  [COSMIC] {cosmic_entrada} → {cosmic_vcf}")
    rc_cosmic = _snpsift(cosmic_entrada, cosmic_vcf, "Cosmic_GenomeScreensMutant_v103_GRCh38.vcf.gz", "CNT")
    if rc_cosmic != 0:
        escrever_log_ui(paciente_uuid, f"[AVISO] SnpSift COSMIC retornou código {rc_cosmic} — campo CNT ausente.")
        _fallback_copy(cosmic_entrada, cosmic_vcf)

    # 4. gnomAD — frequência populacional
    _cosmic_ok = _vcf_valido(WSL_PROCESSAMENTO / cosmic_vcf)
    gnomad_entrada = cosmic_vcf if _cosmic_ok else cosmic_entrada
    escrever_log_ui(paciente_uuid, f"  [gnomAD] {gnomad_entrada} → {output_vcf}")
    rc_gnomad = _snpsift(gnomad_entrada, output_vcf, _GNOMAD_BY_GENOME.get(genome_key, "af-only-gnomad.hg38.vcf.gz"), "AF")
    if rc_gnomad != 0:
        escrever_log_ui(paciente_uuid, f"[AVISO] SnpSift gnomAD retornou código {rc_gnomad} — campo AF ausente.")
        _fallback_copy(gnomad_entrada, output_vcf)


def processar_paciente_wsl(paciente_uuid: str, nome_arquivo_r1: str | None = None, nome_arquivo_r2: str | None = None, vaf: float = 0.05, min_dp: int = 100, ref_genome: str | None = None, target_bed: str | None = None, pon_file: str | None = None, nome_arquivo_bam: str | None = None):
    """Executa os comandos pesados no Docker/WSL2 em background.
    Suporta Single-End (nome_arquivo_r2=None) e Paired-End (nome_arquivo_r2 fornecido).
    """

    db = SessionLocal()
    modo_bam  = nome_arquivo_bam is not None
    is_paired = (not modo_bam) and (nome_arquivo_r2 is not None)

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

        # --- LIMPEZA DE ARQUIVOS INTERMEDIÁRIOS DE RUNS ANTERIORES ---
        # Cada análise recebe um UUID único — esta limpeza é uma garantia defensiva para
        # o caso de reprocessamento explícito do mesmo UUID (ex: retentativa após crash).
        _sufixos_intermediarios = [
            # VarScan2 — intermediários de renomeação e normalização
            "_varscan.vcf", "_varscan_renamed.vcf", "_varscan_norm.vcf",
            # Mutect2 — mantidos: _mutect_hf.vcf e _mutect_annotated.vcf
            #   _mutect_hf.vcf       → lido pela rota /api/auditoria/concordancia
            #   _mutect_annotated.vcf → genes SnpEff; útil para debug e reprocessamento
            "_mutect_raw.vcf", "_mutect.vcf", "_mutect_norm.vcf",
            # Consenso — todos os intermediários de anotação
            "_consensus.vcf", "_consensus_snpeff.vcf",
            "_consensus_clinvar.vcf", "_consensus_gnomad.vcf",
            # Alinhamento e modelos estatísticos
            ".bam", ".bam.bai",
            "_f1r2.tar.gz", "_read_orientation_model.tar.gz",
            "_pileup.table", "_contamination.table",
        ]
        for sufixo in _sufixos_intermediarios:
            _arquivo = WSL_PROCESSAMENTO / f"{paciente_uuid}{sufixo}"
            if _arquivo.exists():
                try:
                    _arquivo.unlink()
                except OSError:
                    pass  # não bloquear a pipeline por falha de limpeza

        # --- LOG INICIAL ---
        if modo_bam:
            modo = "BAM"
        elif is_paired:
            modo = "Paired-End"
        else:
            modo = "Single-End"
        escrever_log_ui(paciente_uuid, f"Iniciando ambiente isolado ({modo}) e validando entrada...")
        escrever_log_ui(paciente_uuid, f"Parâmetros ativos: VAF mínimo = {vaf:.0%} | Profundidade mínima = {min_dp}×")

        # --- PREPARAÇÃO DE VARIÁVEIS SEGURAS ---
        safe_r1   = shlex.quote(nome_arquivo_r1) if nome_arquivo_r1 else None
        safe_r2   = shlex.quote(nome_arquivo_r2) if is_paired else None
        safe_bam_input = shlex.quote(nome_arquivo_bam) if modo_bam else None
        safe_uuid = shlex.quote(paciente_uuid)

        # Caminho do log deste paciente — compartilhado por todas as etapas abaixo
        caminho_log = WSL_PROCESSAMENTO / f"{paciente_uuid}.log"

        # --- TELEMETRIA: cronômetro global e dicionário de tempos por etapa ---
        pipeline_start = time.time()
        tempos_etapas = {}

        # --- RESOLUÇÃO DE CAMINHOS ---
        # ref_genome é garantido pelo frontend (campo obrigatório).
        # target_bed e pon_file são opcionais: quando ausentes, as flags correspondentes
        # são omitidas dos comandos das ferramentas — sem fallback para arquivos padrão.
        _DEFAULT_GENOME = "/datasets/Homo_sapiens_assembly38.fasta"

        ref_vol: list = []
        bed_vol: list = []

        # Mapeador estático: o frontend envia um identificador homologado ('hg38', 'hg19'…)
        # que é resolvido para o arquivo pré-indexado dentro do container.
        # ref_vol permanece [] — nenhum volume extra é montado para o genoma.
        _GENOME_MAP = {
            "hg38": "/datasets/Homo_sapiens_assembly38.fasta",
            "hg19": "/datasets/Homo_sapiens_assembly19.hg19chr.fasta",
        }
        docker_ref_genome = _GENOME_MAP.get(ref_genome, _DEFAULT_GENOME)
        _genome_key = ref_genome if ref_genome in _GENOME_MAP else "hg38"
        docker_ref_fai    = f"{docker_ref_genome}.fai"
        escrever_log_ui(paciente_uuid, f"Genoma de referência: {ref_genome or 'hg38'} → {docker_ref_genome}")

        # BED: arquivo pré-indexado em /datasets/ dentro do container — bed_vol sempre []
        _BED_MAP = {
            "twist":     f"/datasets/{NOME_ARQUIVO_BED}",
            "oncomine":  "/datasets/target_region_Oncomine_Comprehensive_Plus_DNA_Regions_v1.5.bed",
        }
        if target_bed in _BED_MAP:
            docker_target_bed = _BED_MAP[target_bed]
            escrever_log_ui(paciente_uuid, f"Painel BED: {target_bed} → {docker_target_bed}")
        else:
            docker_target_bed = None   # sem restrição de intervalos alvo

        # PoN: a decisão de usar o PoN é feita diretamente no bloco Mutect2
        # com base na existência do arquivo em disco (LOCAL_PON_PATH.exists()),
        # independente da seleção do formulário. Nenhuma variável de estado aqui.

        if not modo_bam:
            # --- ETAPA 0: BARREIRA DE SEGURANÇA (Validação BWA) ---
            escrever_log_ui(paciente_uuid, "Verificando integridade dos índices genômicos (BWA)...")
            required_indices = [".bwt", ".pac", ".ann", ".amb", ".sa"]
            _ref_host_base = WSL_DATASETS / Path(docker_ref_genome).name
            for ext in required_indices:
                index_file = Path(f"{_ref_host_base}{ext}")
                if not index_file.exists():
                    raise FileNotFoundError(
                        f"Falha Crítica: Índice BWA ausente ({index_file.name}). O alinhamento foi abortado."
                    )
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

            # --- ETAPA 0.75: LIMPEZA DE ADAPTADORES E QUALIDADE (FASTP) ---
            escrever_log_ui(paciente_uuid, "Executando fastp: Removendo adaptadores e bases de baixa qualidade...")
            t0 = time.time()
            fastq_r1_clean, fastq_r2_clean = run_fastp(
                nome_r1      = nome_arquivo_r1,
                nome_r2      = nome_arquivo_r2 if is_paired else None,
                paciente_uuid= paciente_uuid,
                caminho_log  = caminho_log,
            )
            tempos_etapas["fastp"] = f"{time.time() - t0:.1f}s"
            escrever_log_ui(paciente_uuid, f"fastp concluído → {fastq_r1_clean.name}")

        if not modo_bam:
            # --- ETAPAS 1+2: ALINHAMENTO BWA-MEM → BAM (pipeline unificado, sem .sam em disco) ---
            escrever_log_ui(paciente_uuid, "Executando BWA-MEM + Samtools: Alinhando e convertendo para BAM (pipeline unificado)...")
            rg_tag = f"@RG\\tID:{paciente_uuid}\\tSM:{paciente_uuid}\\tPL:ILLUMINA\\tLB:lib1"
            inputs_bwa = f"/processamento/{shlex.quote(fastq_r1_clean.name)}"
            if is_paired and fastq_r2_clean:
                inputs_bwa += f" /processamento/{shlex.quote(fastq_r2_clean.name)}"
            comando_bwa_bam_interno = (
                f"set -o pipefail; "
                f"bwa mem -t {_N_THREADS} -R '{rg_tag}' "
                f"{docker_ref_genome} {inputs_bwa} "
                f"| samtools view -@ {_N_THREADS} -Sb - "
                f"| samtools sort -@ {_N_THREADS} -o /processamento/{safe_uuid}.bam - "
                f"&& samtools index -@ {_N_THREADS} /processamento/{safe_uuid}.bam"
            )
            comando_bwa_bam = [
                "wsl", "-d", "Ubuntu", "-u", "root", "docker", "run", "--rm",
                "-v", f"{WSL_BASE}/datasets:/datasets",
                "-v", f"{WSL_BASE}/processamento:/processamento",
                *ref_vol,
                "pantherflow-bioinfo", "sh", "-c", comando_bwa_bam_interno
            ]
            _tcc_t0_bwa = time.perf_counter()
            t0 = time.time()
            returncode = _executar_docker(comando_bwa_bam, caminho_log, _WATCHDOG_MUITO_LONGO_S)
            elapsed = time.time() - t0
            _tcc_elapsed_bwa = time.perf_counter() - _tcc_t0_bwa
            tempos_etapas["bwa_mem"] = f"{elapsed:.1f}s"
            tempos_etapas["samtools"] = "— (unificado com BWA)"
            logger.info(
                "[MÉTRICA TCC] Alinhamento BWA-MEM + Samtools sort/index: %.2f s (%.2f min) — threads=%d — uuid=%s",
                _tcc_elapsed_bwa, _tcc_elapsed_bwa / 60, _N_THREADS, paciente_uuid
            )
            if returncode != 0:
                raise Exception(f"Erro BWA+Samtools (código {returncode}). Ver log do paciente para detalhes.")
        else:
            # --- MODO BAM: sort + index do arquivo de entrada ---
            escrever_log_ui(paciente_uuid, f"Modo BAM: ordenando e indexando {safe_bam_input}...")
            rg_tag = f"@RG\\tID:{paciente_uuid}\\tSM:{paciente_uuid}\\tPL:ILLUMINA\\tLB:lib1"
            comando_bam_prep_interno = (
                f"set -o pipefail; "
                f"samtools addreplacerg -r '{rg_tag}' /processamento/{safe_bam_input} "
                f"| samtools sort -@ {_N_THREADS} -o /processamento/{safe_uuid}.bam - "
                f"&& samtools index -@ {_N_THREADS} /processamento/{safe_uuid}.bam"
            )
            comando_bam_prep = [
                "wsl", "-d", "Ubuntu", "-u", "root", "docker", "run", "--rm",
                "-v", f"{WSL_BASE}/processamento:/processamento",
                "pantherflow-bioinfo", "sh", "-c", comando_bam_prep_interno
            ]
            t0 = time.time()
            returncode = _executar_docker(comando_bam_prep, caminho_log, _WATCHDOG_MUITO_LONGO_S)
            tempos_etapas["bam_prep"] = f"{time.time() - t0:.1f}s"
            if returncode != 0:
                raise Exception(f"Erro na preparação do BAM (código {returncode}). Ver log do paciente para detalhes.")
            escrever_log_ui(paciente_uuid, "BAM ordenado e indexado com sucesso.")

        # --- ETAPA 2.5: CONTROLE DE QUALIDADE DO ALINHAMENTO (SAMTOOLS BEDCOV) ---
        # samtools bedcov: lê cada intervalo do BED e soma as profundidades de cada base.
        # Saída: BED + coluna extra (soma das profundidades do intervalo) — sem cabeçalho.
        # mean_coverage = sum(depth_sum) / sum(end - start) calculado em Python abaixo.
        if docker_target_bed:
            escrever_log_ui(paciente_uuid, "Executando samtools bedcov: Calculando profundidade acumulada do painel alvo (BAM)...")
            coverage_output = f"/processamento/{safe_uuid}_coverage.txt"
            comando_coverage_interno = (
                f"samtools bedcov {docker_target_bed} "
                f"/processamento/{safe_uuid}.bam "
                f"> {coverage_output}"
            )
            comando_coverage = [
                "wsl", "-d", "Ubuntu", "-u", "root", "docker", "run", "--rm",
                "-v", f"{WSL_BASE}/processamento:/processamento",
                "-v", f"{WSL_BASE}/datasets:/datasets",
                *bed_vol,
                "pantherflow-bioinfo", "sh", "-c", comando_coverage_interno
            ]
            t0 = time.time()
            returncode = _executar_docker(comando_coverage, caminho_log, _WATCHDOG_MEDIO_S)
            tempos_etapas["samtools_coverage"] = f"{time.time() - t0:.1f}s"
            if returncode != 0:
                raise Exception(f"Erro samtools coverage (código {returncode}). Ver log do paciente para detalhes.")
        else:
            escrever_log_ui(paciente_uuid, "[INFO] Painel BED não fornecido — samtools bedcov ignorado (cobertura por intervalo indisponível).")

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
        try:
            res_flagstat = subprocess.run(
                comando_flagstat, capture_output=True, text=True, timeout=_WATCHDOG_CURTO_S
            )
            flagstat_output = res_flagstat.stdout
        except subprocess.TimeoutExpired:
            logger.warning("[%s] samtools flagstat excedeu %ds — bug de teardown WSL2. Metricas serao N/A.", paciente_uuid, _WATCHDOG_CURTO_S)
            flagstat_output = ""
        tempos_etapas["flagstat"] = f"{time.time() - t0:.1f}s"

        # Garimpando os dados do texto bruto gerado pelo Docker
        total_reads = "N/A"
        mapping_rate = "N/A"
        mean_coverage = "N/A"
        pct_alvos_zerados  = "N/A"
        pct_alvos_criticos = "N/A"
        # bedcov: cada linha é "chrom\tstart\tend\t[...campos BED extras...]\tdepth_sum"
        # mean_coverage global = sum(depth_sum) / sum(end - start) em todas as linhas válidas
        # profundidade_alvo   = depth_sum / (end - start) por linha — base para os limiares clínicos
        coverage_path = WSL_PROCESSAMENTO / f"{paciente_uuid}_coverage.txt"
        try:
            total_depth    = 0.0
            total_bases    = 0
            total_alvos    = 0
            alvos_zerados  = 0
            alvos_criticos = 0
            with open(coverage_path, "r", encoding="utf-8") as f:
                for line in f:
                    parts = line.strip().split("\t")
                    if len(parts) >= 4:
                        start     = int(parts[1])
                        end       = int(parts[2])
                        depth_sum = float(parts[-1])
                        tamanho   = end - start
                        if tamanho <= 0:
                            continue
                        total_alvos += 1
                        total_bases += tamanho
                        total_depth += depth_sum
                        profundidade_alvo = depth_sum / tamanho
                        if profundidade_alvo == 0.0:
                            alvos_zerados += 1
                        if profundidade_alvo < 30.0:
                            alvos_criticos += 1
            if total_bases > 0:
                mean_coverage = f"{total_depth / total_bases:.2f}x"
            if total_alvos > 0:
                pct_z = alvos_zerados  / total_alvos * 100
                pct_c = alvos_criticos / total_alvos * 100
                pct_alvos_zerados  = f"{alvos_zerados} / {total_alvos} ({pct_z:.1f}%)"
                pct_alvos_criticos = f"{alvos_criticos} / {total_alvos} ({pct_c:.1f}%)"
        except Exception as e:
            logger.warning(f"[{paciente_uuid}] Erro ao calcular cobertura bedcov: {e}")

        # Derivadas numéricas — usadas por regras de negócio de qualidade downstream.
        # Calculadas fora do try/except do bedcov para que falhas na leitura do arquivo
        # resultem em 0.0 (valores seguros) em vez de propagar exceção.
        taxa_dropouts    = (alvos_zerados / total_alvos * 100) if total_alvos > 0 else 0.0
        mean_cov_numeric = 0.0
        if mean_coverage != "N/A":
            try:
                mean_cov_numeric = float(mean_coverage.rstrip("x"))
            except ValueError:
                pass
        # --- QUALITY GATE DE COBERTURA (SOFT) ---
        # Só faz sentido quando um painel BED foi fornecido — sem painel não há alvos
        # para medir dropouts nem limiar de 30x aplicável clinicamente.
        qc_warning_flag    = False
        qc_warning_message = ""
        if docker_target_bed:
            escrever_log_ui(
                paciente_uuid,
                f"QC Cobertura: profundidade média = {mean_cov_numeric:.2f}x | "
                f"dropouts = {taxa_dropouts:.1f}% | "
                f"alvos < 30x = {pct_alvos_criticos}"
            )
            if mean_cov_numeric < 30.0 or taxa_dropouts > 15.0:
                motivo = []
                if mean_cov_numeric < 30.0:
                    motivo.append(f"profundidade média {mean_cov_numeric:.2f}x < 30x")
                if taxa_dropouts > 15.0:
                    motivo.append(f"dropouts {taxa_dropouts:.1f}% > 15%")
                qc_warning_flag    = True
                qc_warning_message = "; ".join(motivo)
                logger.warning(
                    f"[{paciente_uuid}] [AVISO QC] Amostra abaixo dos critérios mínimos de "
                    f"cobertura clínica: {qc_warning_message}"
                )
                escrever_log_ui(
                    paciente_uuid,
                    f"[AVISO QC] Amostra fora dos limites clínicos: {qc_warning_message}. "
                    "O laudo será gerado com flag de alerta."
                )

        match_total = re.search(r'(\d+) \+ \d+ in total', flagstat_output)
        if match_total:
            total_reads = f"{int(match_total.group(1)) / 1000000:.1f}M"

        match_rate = re.search(r'\d+ \+ \d+ mapped \(([0-9.]+)%', flagstat_output)
        if match_rate:
            mapping_rate = f"{match_rate.group(1)}%"

        # --- ETAPA 4: CHAMADA DE VARIANTES — VarScan2 ---
        # O VCF é gerado pelo shell do Docker via '>'. O stdout nunca passa pelo Python.
        # _executar_docker captura apenas o stderr (progresso/warnings do VarScan2).
        escrever_log_ui(paciente_uuid, f"Executando VarScan2: Chamada de variantes somáticas (SNPs + INDELs, VAF >= {vaf:.0%}, Min DP={min_dp})...")
        # mpileup2cns chama SNPs e INDELs simultaneamente em VCF (--output-vcf 1).
        # Parâmetros calibrados para sensibilidade máxima em Tumor-Only a 5% VAF:
        # --min-coverage 20  : limiar baixo para não perder alvos de baixa cobertura local.
        # --min-reads2 2     : mínimo de reads suporte — ajustado para capturar variantes raras.
        # --min-var-freq 0.05: alinhado ao limiar clínico de 5% VAF para oncologia somática.
        # --p-value 0.05     : filtro estatístico de Fischer para rejeitar ruído de sequenciamento.
        # --strand-filter 0  : desativado — artefatos de strand bias são filtrados pelo FilterMutectCalls
        #                      na etapa de consenso, preservando o recall do VarScan2 como "rede larga".
        _bed_flag_mpileup = f"-l {docker_target_bed} " if docker_target_bed else ""
        comando_varscan_interno = (
            f"set -o pipefail; "
            f"samtools mpileup -B -d 0 {_bed_flag_mpileup}-f {docker_ref_genome} /processamento/{safe_uuid}.bam "
            f"| varscan mpileup2cns --variants --output-vcf 1 --min-coverage {_VARSCAN_MIN_COV} --min-reads2 2 --min-var-freq {vaf} --p-value 0.05 --strand-filter 0 "
            f"> /processamento/{safe_uuid}_varscan.vcf"
        )
        comando_varscan = [
            "wsl", "-d", "Ubuntu", "-u", "root", "docker", "run", "--rm",
            "-v", f"{WSL_BASE}/datasets:/datasets",
            "-v", f"{WSL_BASE}/processamento:/processamento",
            *ref_vol,
            *bed_vol,
            "pantherflow-bioinfo", "sh", "-c", comando_varscan_interno
        ]
        t0 = time.time()
        returncode = _executar_docker(comando_varscan, caminho_log, _WATCHDOG_MEDIO_S)
        tempos_etapas["varscan2"] = f"{time.time() - t0:.1f}s"
        if returncode != 0:
            raise Exception(f"Erro VarScan2 (código {returncode}). Ver log do paciente para detalhes.")

        # --- ETAPA 4.5: CHAMADA DE VARIANTES — Mutect2 (GATK4, tumor-only) ---
        #
        # Configuração obrigatória tumor-only (sem amostra Normal pareada):
        #
        #  -I / --tumor-sample : identifica o BAM tumoral pelo SM tag do Read Group.
        #                        Ausência de segundo -I e de --normal-sample é INTENCIONAL —
        #                        indica ao Mutect2 que deve operar no modo tumor-only.
        #
        #  --germline-resource : gnomAD AF-only (obrigatório) — modelo de frequência alélica
        #                        populacional. Penaliza variantes germinativas comuns e calibra
        #                        o prior do modelo somático. Sem este arquivo o TLOD fica
        #                        descalibrado e a taxa de falsos positivos dispara.
        #                        Ref: GATK Best Practices — Somatic SNVs + Indels (Broad, 2024).
        #
        #  -pon               : Panel of Normals 1000G (obrigatório) — filtra artefatos
        #                        sistemáticos de sequenciamento presentes em amostras normais
        #                        do banco público. Sem PoN, variantes de artefato recorrentes
        #                        passam pelo filtro TLOD e contaminam o VCF final.
        #
        #  --f1r2-tar-gz      : coleta estatísticas de orientação F1R2 → LearnReadOrientationModel
        #                        (substitui FilterByOrientationBias, descontinuado GATK >= 4.2).
        #
        # NOTA: -min-AF é omitido intencionalmente. O Mutect2 deve emitir todos os candidatos
        # acima do seu limiar interno; o corte por VAF é responsabilidade exclusiva do
        # FilterMutectCalls, que aplica o modelo probabilístico completo antes de descartar.

        # Decisão de PoN: respeita a escolha do usuário na UI E verifica existência em disco.
        # pon_file == 'none'      → usuário optou explicitamente por não usar PoN.
        # pon_file == 'gatk_1000g' (ou None) + arquivo existe → usa PoN.
        # pon_file == 'gatk_1000g' + arquivo ausente → aviso crítico, roda sem PoN.
        _local_pon_path  = _PON_LOCAL_BY_GENOME.get(_genome_key, LOCAL_PON_PATH)
        _docker_pon_path = _PON_DOCKER_BY_GENOME.get(_genome_key, DOCKER_PON_PATH)

        _usuario_quer_pon = pon_file != 'none'
        _pon_disponivel   = _usuario_quer_pon and _local_pon_path.exists()

        if not _usuario_quer_pon:
            escrever_log_ui(paciente_uuid, "PoN: desativado pelo usuário — Mutect2 sem -pon (modo sem filtro de artefatos).")
            logger.info("[%s] PoN desativado via UI (pon_file='none').", paciente_uuid)
        elif not _local_pon_path.exists():
            escrever_log_ui(
                paciente_uuid,
                f"[AVISO CRÍTICO] Panel of Normals não encontrado em disco ({_local_pon_path}). "
                f"Mutect2 executará sem -pon — aumento severo de falsos positivos esperado."
            )
            logger.warning("[%s] PoN solicitado mas ausente em disco: %s", paciente_uuid, _local_pon_path)
        else:
            escrever_log_ui(paciente_uuid, f"PoN: gatk_1000g ativado → {_docker_pon_path}")

        # gnomAD: verifica existência em disco antes de passar a flag
        _gnomad_filename    = _GNOMAD_BY_GENOME[_genome_key]
        _gnomad_local_path  = WSL_DATASETS / _gnomad_filename
        _gnomad_disponivel  = _gnomad_local_path.exists()
        if not _gnomad_disponivel:
            escrever_log_ui(
                paciente_uuid,
                f"[AVISO] gnomAD não encontrado em disco ({_gnomad_filename}). "
                f"Mutect2 executará sem --germline-resource — sensibilidade reduzida em tumor-only."
            )
            logger.warning("[%s] gnomAD ausente: %s", paciente_uuid, _gnomad_local_path)

        escrever_log_ui(paciente_uuid, "Executando Mutect2: Chamada de variantes somáticas (tumor-only + PoN + F1R2)...")

        _mutect_pon_flag    = f"-pon {_docker_pon_path} " if _pon_disponivel else ""
        _mutect_gnomad_flag = f"--germline-resource /datasets/{_gnomad_filename} " if _gnomad_disponivel else ""
        _mutect_bed_flag    = f"-L {docker_target_bed} " if docker_target_bed else ""

        comando_mutect2_interno = (
            # ── Inputs ──────────────────────────────────────────────────────────────────
            f"gatk Mutect2"
            f" -R {docker_ref_genome}"
            f" -I /processamento/{safe_uuid}.bam"
            f" --tumor-sample {safe_uuid}"
            # ── Recursos genômicos (opcionais quando arquivo ausente) ────────────────
            f" {_mutect_gnomad_flag}"
            f" {_mutect_pon_flag}"
            # ── Restrição de intervalos (opcional — apenas quando BED fornecido) ─────
            f" {_mutect_bed_flag}"
            # ── Coleta de estatísticas para modelos downstream ───────────────────────
            f" --f1r2-tar-gz /processamento/{safe_uuid}_f1r2.tar.gz"
            # ── Output ──────────────────────────────────────────────────────────────
            f" -O /processamento/{safe_uuid}_mutect_raw.vcf"
        )

        # Volume /references montado com base na existência real do arquivo em disco,
        # ignorando a seleção do formulário — garante consistência entre flag e volume.
        # hg38: PoN em /references (volume separado); hg19: PoN em /datasets (já montado)
        if _pon_disponivel and _genome_key == "hg38":
            _mutect_ref_vol = ["-v", f"{WSL_REFERENCES_DIR}/hg38/gatk_resources:/references/hg38/gatk_resources:ro"]
        else:
            _mutect_ref_vol = []

        comando_mutect2 = [
            "wsl", "-d", "Ubuntu", "-u", "root", "docker", "run", "--rm",
            "-v", f"{WSL_BASE}/datasets:/datasets",
            "-v", f"{WSL_BASE}/processamento:/processamento",
            *_mutect_ref_vol,
            "pantherflow-bioinfo", "sh", "-c", comando_mutect2_interno,
        ]
        _tcc_t0_vc      = time.perf_counter()  # cobre o bloco completo de variant calling
        _tcc_t0_mutect2 = time.perf_counter()  # cobre apenas o Mutect2 bruto
        t0_mutect2 = time.time()
        returncode = _executar_docker(comando_mutect2, caminho_log, _WATCHDOG_MUITO_LONGO_S)
        _tcc_elapsed_mutect2 = time.perf_counter() - _tcc_t0_mutect2
        tempos_etapas["mutect2_bruto"] = f"{time.time() - t0_mutect2:.1f}s"
        logger.info(
            "[MÉTRICA TCC] GATK4 Mutect2 (chamada bruta): %.2f s (%.2f min) | threads=%d | uuid=%s",
            _tcc_elapsed_mutect2, _tcc_elapsed_mutect2 / 60, _N_THREADS, paciente_uuid
        )
        if returncode != 0:
            raise Exception(f"Erro Mutect2 (código {returncode}). Ver log do paciente para detalhes.")

        # --- ETAPA 4.5.5: MODELO DE ORIENTAÇÃO F1R2 (LearnReadOrientationModel) ---
        # Aprende o modelo probabilístico de artefatos de orientação a partir das estatísticas F1R2
        # coletadas pelo Mutect2. O modelo .tar.gz gerado é passado ao FilterMutectCalls via
        # --ob-priors, substituindo o FilterByOrientationBias (descontinuado GATK >= 4.2).
        # Fallback: se falhar, o FilterMutectCalls roda sem o modelo — laudo não é bloqueado.
        escrever_log_ui(paciente_uuid, "Executando LearnReadOrientationModel: Treinando modelo F1R2 (artefatos OxoG/FFPE)...")

        rom_path        = f"/processamento/{safe_uuid}_read_orientation_model.tar.gz"
        use_orientation = False
        t0_rom          = time.time()

        cmd_rom = (
            f"gatk LearnReadOrientationModel "
            f"-I /processamento/{safe_uuid}_f1r2.tar.gz "
            f"-O {rom_path}"
        )
        rc_rom = _executar_docker([
            "wsl", "-d", "Ubuntu", "-u", "root", "docker", "run", "--rm",
            "-v", f"{WSL_BASE}/processamento:/processamento",
            "pantherflow-bioinfo", "sh", "-c", cmd_rom,
        ], caminho_log, _WATCHDOG_MEDIO_S)

        tempos_etapas["artifact_filter"] = f"{time.time() - t0_rom:.1f}s"
        if rc_rom != 0:
            escrever_log_ui(paciente_uuid, f"[AVISO] LearnReadOrientationModel retornou código {rc_rom} — FilterMutectCalls rodará sem modelo F1R2.")
        else:
            use_orientation = True
            escrever_log_ui(paciente_uuid, "Modelo de orientação F1R2 treinado com sucesso.")

        # --- ETAPA 4.55: MODELO DE CONTAMINAÇÃO GDC (GetPileupSummaries + CalculateContamination) ---
        # Padrão GDC NIH para análise Tumor-Only: estima fração de contaminação cruzada entre amostras
        # usando variantes populacionais do gnomAD como âncoras. A tabela resultante é passada ao
        # FilterMutectCalls para ajustar os limiares de filtro estatístico ao nível de contaminação real.
        # Se qualquer etapa falhar, o pipeline continua SEM a tabela — FilterMutectCalls roda no modo
        # padrão (sem --contamination-table), garantindo que o laudo não seja bloqueado.
        contaminacao_table = f"/processamento/{safe_uuid}_contamination.table"
        use_contamination  = False  # flag de fallback
        t0_contamination   = time.time()

        if not _gnomad_disponivel:
            escrever_log_ui(paciente_uuid, "[AVISO] gnomAD ausente — GetPileupSummaries ignorado. FilterMutectCalls rodará sem modelo de contaminação.")
        else:
            escrever_log_ui(paciente_uuid, "Executando GetPileupSummaries: Estimando contaminação cruzada (GDC)...")

        _pileup_vcf      = f"/datasets/{_PILEUP_VCF_BY_GENOME[_genome_key]}"
        _pileup_interval = docker_target_bed if docker_target_bed else _pileup_vcf

        if _gnomad_disponivel:
            cmd_pileup = (
                f"gatk GetPileupSummaries "
                f"-I /processamento/{safe_uuid}.bam "
                f"-V {_pileup_vcf} "
                f"-L {_pileup_interval} "
                f"-O /processamento/{safe_uuid}_pileup.table"
            )
            rc_pileup = _executar_docker([
                "wsl", "-d", "Ubuntu", "-u", "root", "docker", "run", "--rm",
                "-v", f"{WSL_BASE}/datasets:/datasets",
                "-v", f"{WSL_BASE}/processamento:/processamento",
                "pantherflow-bioinfo", "sh", "-c", cmd_pileup,
            ], caminho_log, _WATCHDOG_MEDIO_S)

            if rc_pileup != 0:
                escrever_log_ui(paciente_uuid, f"[AVISO] GetPileupSummaries retornou código {rc_pileup} — FilterMutectCalls rodará sem modelo de contaminação.")
            else:
                escrever_log_ui(paciente_uuid, "Executando CalculateContamination: Calculando fração de contaminação...")
                cmd_contamination = (
                    f"gatk CalculateContamination "
                    f"-I /processamento/{safe_uuid}_pileup.table "
                    f"-O {contaminacao_table}"
                )
                rc_contamination = _executar_docker([
                    "wsl", "-d", "Ubuntu", "-u", "root", "docker", "run", "--rm",
                    "-v", f"{WSL_BASE}/processamento:/processamento",
                    "pantherflow-bioinfo", "sh", "-c", cmd_contamination,
                ], caminho_log, _WATCHDOG_CURTO_S)

                if rc_contamination != 0:
                    escrever_log_ui(paciente_uuid, f"[AVISO] CalculateContamination retornou código {rc_contamination} — FilterMutectCalls rodará sem modelo de contaminação.")
                else:
                    use_contamination = True
                    escrever_log_ui(paciente_uuid, "Modelo de contaminação calculado com sucesso.")

        tempos_etapas["contamination_calc"] = f"{time.time() - t0_contamination:.1f}s"

        # --- ETAPA 4.6: FILTRO ESTATÍSTICO — FilterMutectCalls ---
        # Aplica os filtros do GATK ao VCF bruto: strand bias, TLOD, orientação de fragmento, etc.
        # Somente variantes com FILTER=PASS entram no consenso — elimina artefatos sistemáticos.
        # --contamination-table: modelo de contaminação GDC (Etapa 4.55), se disponível.
        # --ob-priors: modelo F1R2 de artefatos de orientação (Etapa 4.5.5), se disponível.
        escrever_log_ui(paciente_uuid, "Executando FilterMutectCalls: Aplicando filtros estatísticos GATK...")
        # --min-allele-fraction: alinha o limiar de emissão do FilterMutectCalls com o VAF
        # configurado pelo usuário. Sem este parâmetro, o filtro interno "low_allele_frac"
        # do GATK descarta variantes de baixo AF mesmo que o VarScan2 as tenha chamado —
        # o consenso nunca refletiria a configuração customizada.
        comando_filter_interno = (
            f"gatk FilterMutectCalls "
            f"-R {docker_ref_genome} "
            f"-V /processamento/{safe_uuid}_mutect_raw.vcf "
            f"--min-allele-fraction {vaf} "
            + (f"--contamination-table {contaminacao_table} " if use_contamination else "")
            + (f"--ob-priors {rom_path} " if use_orientation else "")
            + f"-O /processamento/{safe_uuid}_mutect.vcf"
        )
        comando_filter = [
            "wsl", "-d", "Ubuntu", "-u", "root", "docker", "run", "--rm",
            "-v", f"{WSL_BASE}/datasets:/datasets",
            "-v", f"{WSL_BASE}/processamento:/processamento",
            *ref_vol,
            "pantherflow-bioinfo", "sh", "-c", comando_filter_interno
        ]
        t0_filter = time.time()
        returncode = _executar_docker(comando_filter, caminho_log, _WATCHDOG_MEDIO_S)
        tempos_etapas["filter_mutect"] = f"{time.time() - t0_filter:.1f}s"
        if returncode != 0:
            raise Exception(f"Erro FilterMutectCalls (código {returncode}). Ver log do paciente para detalhes.")

        # --- ETAPA 4.65: HARD FILTERS CLÍNICOS (NSCLC / Tumor-Only) ---
        # FilterMutectCalls apenas ANOTA variantes no campo FILTER (soft filter).
        # Este passo usa bcftools view para REMOVER fisicamente variantes que:
        #   (a) não passaram nos filtros estatísticos do GATK (FILTER ≠ PASS)
        #   (b) têm profundidade < 20× — instabilidade estatística do VAF em tumor-only
        #   (c) têm VAF < {vaf} — abaixo do limiar clínico configurado pelo usuário
        # Ref: GDC Somatic Variant Calling Pipeline (NCI, 2024); ESMO Guidelines NSCLC.
        #
        # Por que bcftools e não VariantFiltration?
        #   VariantFiltration também é soft filter (anota, não remove).
        #   bcftools view -i/-f produz hard filter real — o VCF resultante contém
        #   APENAS as variantes que satisfazem todos os critérios.
        _dp_min_clinical = 20   # limiar mínimo absoluto: abaixo de 20x o VAF não é confiável

        escrever_log_ui(
            paciente_uuid,
            f"Aplicando hard filters clínicos (NSCLC): FILTER=PASS + DP≥{_dp_min_clinical}× + VAF≥{vaf:.0%}..."
        )

        # Flags curtas (-f, -i, -O, -o) são universais em todas as versões do bcftools.
        # FMT/DP e FMT/AF sem subscript [0] evitam falhas em bcftools < 1.16.
        # A expressão && é protegida pelas aspas simples do sh -c.
        cmd_hard_filter = (
            f"bcftools view"
            f" -f 'PASS,.'"
            f" -i 'FMT/DP>={_dp_min_clinical} && FMT/AF>={vaf}'"
            f" -O v"
            f" -o /processamento/{safe_uuid}_mutect_hf.vcf"
            f" /processamento/{safe_uuid}_mutect.vcf"
        )
        rc_hf = _executar_docker([
            "wsl", "-d", "Ubuntu", "-u", "root", "docker", "run", "--rm",
            "-v", f"{WSL_BASE}/processamento:/processamento",
            "pantherflow-bioinfo", "sh", "-c", cmd_hard_filter,
        ], caminho_log, _WATCHDOG_CURTO_S)

        if rc_hf != 0:
            escrever_log_ui(
                paciente_uuid,
                f"[AVISO] Hard filters clínicos retornaram código {rc_hf} — "
                f"normalizando VCF sem filtros adicionais de DP/VAF."
            )
            logger.warning("[%s] bcftools hard filter falhou (rc=%d) — _mutect_hf.vcf não gerado.", paciente_uuid, rc_hf)
        else:
            _hf_path = WSL_PROCESSAMENTO / f"{paciente_uuid}_mutect_hf.vcf"
            try:
                _n_retidas = sum(1 for _l in open(_hf_path, encoding="utf-8") if not _l.startswith("#"))
            except OSError:
                _n_retidas = "?"
            escrever_log_ui(
                paciente_uuid,
                f"Hard filters aplicados — {_n_retidas} variante(s) retidas "
                f"(DP≥{_dp_min_clinical}×, VAF≥{vaf:.0%}, FILTER=PASS)."
            )

        _tcc_elapsed_vc = time.perf_counter() - _tcc_t0_vc
        logger.info(
            "[MÉTRICA TCC] Variant Calling completo"
            " (Mutect2 + ROM + Contaminação + FilterMutectCalls + HardFilter NSCLC):"
            " %.2f s (%.2f min) | pon=%s | threads=%d | uuid=%s",
            _tcc_elapsed_vc, _tcc_elapsed_vc / 60,
            "sim" if _pon_disponivel else "não",
            _N_THREADS, paciente_uuid,
        )
        tempos_etapas["mutect2"] = tempos_etapas.pop("mutect2_bruto", "N/A")

        # --- ETAPA 4.6: CHAMADA DE VARIANTES — LoFreq (baixa frequência alélica) ---
        escrever_log_ui(paciente_uuid, f"Executando LoFreq: Chamada de variantes somáticas de baixa frequência (VAF >= {vaf:.0%})...")
        t0 = time.time()
        vcf_lofreq_path = run_lofreq(
            bam_name=f"{paciente_uuid}.bam",
            docker_ref_genome=docker_ref_genome,
            docker_target_bed=docker_target_bed,
            paciente_uuid=paciente_uuid,
            caminho_log=caminho_log,
        )
        tempos_etapas["lofreq"] = f"{time.time() - t0:.1f}s"
        escrever_log_ui(paciente_uuid, f"LoFreq concluído → {vcf_lofreq_path.name}")

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
                f"bcftools norm -m-any -f {docker_ref_genome} "
                f"/processamento/{shlex.quote(nome_entrada)} "
                f"> /processamento/{shlex.quote(nome_saida)}"
            )
            return _executar_docker([
                "wsl", "-d", "Ubuntu", "-u", "root", "docker", "run", "--rm",
                "-v", f"{WSL_BASE}/datasets:/datasets",
                "-v", f"{WSL_BASE}/processamento:/processamento",
                *ref_vol,
                "pantherflow-bioinfo", "sh", "-c", cmd,
            ], caminho_log)

        # VarScan2 (mpileup2cns) produz cromossomos sem prefixo "chr" (ex: "1", "2").
        # A referência hg38 usa "chr1", "chr2" — bcftools norm abortaria com mismatch.
        # Solução em 2 etapas independentes (sem pipe): evita falha silenciosa dentro
        # do subprocess, onde o returncode refletiria apenas o último comando do pipe.

        # Passo A — Renomeação: "1" → "chr1", "2" → "chr2", etc.
        # bcftools annotate --rename-chrs falha (erro 255) quando o VCF não contém cabeçalhos
        # ##contig — caso padrão do VarScan2 mpileup2cns.
        # Solução: sed injeta o prefixo "chr" SOMENTE em linhas não-header que ainda não
        # o possuem. O guard /^chr/! torna o comando idempotente: se o VarScan2 já emitiu
        # "chr1" (porque o BAM foi alinhado contra hg38), o sed não adiciona um segundo "chr".
        cmd_rename_varscan = (
            f"sed -e '/^[^#]/{{/^chr/!{{s/^/chr/}}}}' "
            f"/processamento/{shlex.quote(paciente_uuid + '_varscan.vcf')} "
            f"> /processamento/{shlex.quote(paciente_uuid + '_varscan_renamed.vcf')}"
        )
        rc_rename_varscan = _executar_docker([
            "wsl", "-d", "Ubuntu", "-u", "root", "docker", "run", "--rm",
            "-v", f"{WSL_BASE}/processamento:/processamento",
            "pantherflow-bioinfo", "sh", "-c", cmd_rename_varscan,
        ], caminho_log)
        if rc_rename_varscan != 0:
            escrever_log_ui(paciente_uuid, f"[AVISO] sed rename-chrs retornou código {rc_rename_varscan} — VarScan2 pode ter mismatch de cromossomos.")

        # Passo B — Reheader + Normalização: injeta ##contig do .fai, depois left-aligns.
        # bcftools norm falha com "CONTIG id=0 not present in the header" porque o VarScan2
        # não gera declarações ##contig no cabeçalho do VCF.
        # Solução: bcftools reheader --fai lê o índice FASTA e injeta todos os ##contig
        # corretos via pipe — sem criar arquivo intermediário — antes do bcftools norm.
        # Requer bcftools >= 1.9 (disponível: >= 1.18).
        _varscan_renamed = WSL_PROCESSAMENTO / f"{paciente_uuid}_varscan_renamed.vcf"
        nome_entrada_norm = (
            f"{paciente_uuid}_varscan_renamed.vcf"
            if rc_rename_varscan == 0 and _varscan_renamed.exists()
            else f"{paciente_uuid}_varscan.vcf"
        )
        cmd_reheader_norm_varscan = (
            f"set -o pipefail; "
            f"bcftools reheader --fai {docker_ref_fai} "
            f"/processamento/{shlex.quote(nome_entrada_norm)} "
            f"| bcftools norm -m-any -f {docker_ref_genome} - "
            f"> /processamento/{shlex.quote(paciente_uuid + '_varscan_norm.vcf')}"
        )
        rc_norm_varscan = _executar_docker([
            "wsl", "-d", "Ubuntu", "-u", "root", "docker", "run", "--rm",
            "-v", f"{WSL_BASE}/datasets:/datasets",
            "-v", f"{WSL_BASE}/processamento:/processamento",
            *ref_vol,
            "pantherflow-bioinfo", "sh", "-c", cmd_reheader_norm_varscan,
        ], caminho_log)
        if rc_norm_varscan != 0:
            escrever_log_ui(paciente_uuid, f"[AVISO] bcftools reheader+norm VarScan2 retornou código {rc_norm_varscan} — usando VCF original.")

        # Entrada da normalização: prefere o VCF com hard filters (ETAPA 4.65) se gerado com sucesso.
        _mutect_hf_vcf = WSL_PROCESSAMENTO / f"{paciente_uuid}_mutect_hf.vcf"
        _mutect_norm_input = (
            f"{paciente_uuid}_mutect_hf.vcf" if _vcf_valido(_mutect_hf_vcf)
            else f"{paciente_uuid}_mutect.vcf"
        )
        rc_norm_mutect = _normalizar_vcf(_mutect_norm_input, f"{paciente_uuid}_mutect_norm.vcf")
        if rc_norm_mutect != 0:
            escrever_log_ui(paciente_uuid, f"[AVISO] bcftools norm Mutect2 retornou código {rc_norm_mutect} — usando VCF original.")

        # --- ETAPA 5: CONSENSO MULTI-CALLER (UNIÃO — OR) ---
        # Estratégia alterada de interseção para UNIÃO para maximizar recall em amostras
        # Tumor-Only de baixa cobertura, onde a concordância entre callers é restrita.
        # Prioridade de linha: Mutect2 > VarScan2 (headers GATK compatíveis com SnpEff).
        escrever_log_ui(paciente_uuid, "Calculando consenso Multi-Caller (VarScan2 ∪ Mutect2 — União OR)...")

        def _parse_vcf_dict(filepath: Path) -> dict:
            """Lê um VCF e retorna {(CHROM, POS, REF, ALT): linha_completa} — apenas PASS/'.'.
            Substitui parse_vcf() (que retorna set) para preservar a linha original necessária
            na escrita do consenso por união."""
            _FILTROS_ACEITOS = {"PASS", "."}
            resultado: dict = {}
            try:
                with open(filepath, "r", encoding="utf-8", errors="replace") as f:
                    for linha in f:
                        if linha.startswith("#"):
                            continue
                        colunas = linha.strip().split("\t")
                        if len(colunas) < 7 or colunas[6] not in _FILTROS_ACEITOS:
                            continue
                        chave = (colunas[0], colunas[1], colunas[3], colunas[4])
                        resultado[chave] = linha
            except (FileNotFoundError, OSError):
                pass
            return resultado

        _varscan_norm = WSL_PROCESSAMENTO / f"{paciente_uuid}_varscan_norm.vcf"
        _mutect_norm  = WSL_PROCESSAMENTO / f"{paciente_uuid}_mutect_norm.vcf"
        _mutect_hf    = WSL_PROCESSAMENTO / f"{paciente_uuid}_mutect_hf.vcf"

        vcf_varscan_path = _varscan_norm if _vcf_valido(_varscan_norm) else WSL_PROCESSAMENTO / f"{paciente_uuid}_varscan.vcf"
        # Cadeia de preferência Mutect2: normalizado > hard-filtered > filtrado pelo GATK (bruto)
        vcf_mutect_path  = (
            _mutect_norm if _vcf_valido(_mutect_norm) else
            _mutect_hf   if _vcf_valido(_mutect_hf)   else
            WSL_PROCESSAMENTO / f"{paciente_uuid}_mutect.vcf"
        )
        vcf_consenso_path = WSL_PROCESSAMENTO / f"{paciente_uuid}_consensus.vcf"

        dict_varscan = _parse_vcf_dict(vcf_varscan_path)
        dict_mutect  = _parse_vcf_dict(vcf_mutect_path)

        # Mantém set_varscan e set_mutect para compatibilidade com o banco (variants_*)
        set_varscan  = set(dict_varscan.keys())
        set_mutect   = set(dict_mutect.keys())
        set_consenso = set_varscan.union(set_mutect)   # OR — era intersection()

        # Ordena genomicamente antes de gravar — sets são desordenados e o SnpSift exige
        # VCF ordenado por (CHROM, POS). Cromossomos são strings ("chr1".."chrX"), por isso
        # a chave separa o prefixo "chr" do número para ordenação numérica correta.
        def _chr_sort_key(chave: tuple) -> tuple:
            chrom_raw = chave[0]
            sufixo = chrom_raw.lstrip("chr")
            try:
                return (0, int(sufixo), int(chave[1]))
            except ValueError:
                return (1, sufixo, int(chave[1]) if chave[1].isdigit() else 0)

        variantes_ordenadas = sorted(set_consenso, key=_chr_sort_key)

        escrever_log_ui(
            paciente_uuid,
            f"Consenso (união): VarScan2={len(set_varscan)} | Mutect2={len(set_mutect)} | União={len(set_consenso)}"
        )

        # Escreve _consensus.vcf usando headers do Mutect2 (template GATK/SnpEff).
        # Para cada variante na união ordenada: linha do Mutect2 tem prioridade; linha do
        # VarScan2 é usada apenas para variantes exclusivas que o Mutect2 não chamou.
        if variantes_ordenadas:
            try:
                with open(vcf_mutect_path, "r", encoding="utf-8", errors="replace") as f_hdr, \
                     open(vcf_consenso_path, "w", encoding="utf-8") as f_out:
                    for linha in f_hdr:
                        if linha.startswith("#"):
                            f_out.write(linha)
                        else:
                            break  # para após os headers — dados vêm dos dicts
                    for chave in variantes_ordenadas:
                        f_out.write(
                            dict_mutect[chave] if chave in dict_mutect else dict_varscan[chave]
                        )
            except (FileNotFoundError, OSError) as e:
                raise RuntimeError(f"Falha ao escrever VCF de consenso (união): {e}") from e
        else:
            logger.warning(f"[{paciente_uuid}] União vazia — nenhum caller identificou variantes PASS no painel (set_consenso={len(set_consenso)}).")

        escrever_log_ui(paciente_uuid, f"Arquivo de consenso gerado: {vcf_consenso_path.name}")

        # --- GERAÇÃO DO PLOT DATA (VAF + DP por caller) ---
        # Consolida métricas de VAF e profundidade dos três VCFs para o gráfico do front-end.
        dados_grafico = (
            extrair_metricas_vcf(vcf_varscan_path,  "VarScan2")
            + extrair_metricas_vcf(vcf_mutect_path,  "Mutect2")
            + extrair_metricas_vcf(vcf_consenso_path, "Consenso")
        )
        _plot_path = WSL_PROCESSAMENTO / f"{paciente_uuid}_plot_data.json"
        try:
            with open(_plot_path, "w", encoding="utf-8") as _f:
                json.dump(dados_grafico, _f)
        except OSError as _e:
            logger.warning(f"[{paciente_uuid}] Falha ao salvar plot_data.json: {_e}")

        # --- ETAPA 5.5: ANOTAÇÃO FUNCIONAL (SnpEff) — VarScan2 + Mutect2 + Consenso ---
        # Barreira de segurança: verifica o banco GRCh38.99 antes de qualquer chamada SnpEff.
        snpeff_db_path = WSL_DATASETS / "snpeff_data" / "GRCh38.99"
        if not snpeff_db_path.exists():
            raise FileNotFoundError(
                "Banco de dados SnpEff ausente. Execute o download manual:\n"
                "  docker run --rm -v ~/pantherflow-clinical/datasets:/datasets "
                "pantherflow-bioinfo snpEff download GRCh38.99 -dataDir /datasets/snpeff_data"
            )

        t0 = time.time()

        # --- ETAPA 5.5: ANOTAÇÃO COMPLETA (SnpEff + ClinVar + COSMIC + gnomAD) ---
        escrever_log_ui(paciente_uuid, f"Anotando VarScan2 ({vcf_varscan_path.name})...")
        anotar_vcf_completo(
            input_vcf=vcf_varscan_path.name,
            output_vcf=f"{paciente_uuid}_varscan_annotated.vcf",
            paciente_uuid=paciente_uuid,
            caminho_log=caminho_log,
            genome_key=_genome_key,
        )

        escrever_log_ui(paciente_uuid, f"Anotando Mutect2 ({vcf_mutect_path.name})...")
        anotar_vcf_completo(
            input_vcf=vcf_mutect_path.name,
            output_vcf=f"{paciente_uuid}_mutect_annotated.vcf",
            paciente_uuid=paciente_uuid,
            caminho_log=caminho_log,
            genome_key=_genome_key,
        )

        escrever_log_ui(paciente_uuid, f"Anotando LoFreq ({vcf_lofreq_path.name})...")
        anotar_vcf_completo(
            input_vcf=vcf_lofreq_path.name,
            output_vcf=f"{paciente_uuid}_lofreq_annotated.vcf",
            paciente_uuid=paciente_uuid,
            caminho_log=caminho_log,
            genome_key=_genome_key,
        )

        if not set_consenso:
            escrever_log_ui(paciente_uuid, "[AVISO] Consenso vazio — anotação de consenso ignorada.")
        else:
            escrever_log_ui(paciente_uuid, "Anotando Consenso...")
            anotar_vcf_completo(
                input_vcf=f"{paciente_uuid}_consensus.vcf",
                output_vcf=f"{paciente_uuid}_consensus_gnomad.vcf",
                paciente_uuid=paciente_uuid,
                caminho_log=caminho_log,
                genome_key=_genome_key,
            )

        # --- ETAPA 6: LIMPEZA E ATUALIZAÇÃO FINAL ---
        # Nota: o .sam não existe mais — o pipeline unificado BWA+Samtools (Etapas 1+2)
        # nunca grava o SAM em disco. A remoção explícita foi removida junto com o arquivo.

        # Parseia o VCF anotado e gera o resumo para o banco.
        # parsear_anotacoes_snpeff() nunca lança exceção — retorna {} em caso de falha.
        # Prefere o VCF com anotação gnomAD (AF); fallback para o VCF sem ela.
        _gnomad_vcf      = WSL_PROCESSAMENTO / f"{paciente_uuid}_consensus_gnomad.vcf"
        vcf_anotado_path = _gnomad_vcf if _vcf_valido(_gnomad_vcf) else WSL_PROCESSAMENTO / f"{paciente_uuid}_consensus_annotated.vcf"
        annotation_summary = parsear_anotacoes_snpeff(vcf_anotado_path)

        # --- DEBUG TEMPORÁRIO: estrutura do primeiro dict de variante ---
        _debug_variants = annotation_summary.get("top_variants", [])
        if _debug_variants:
            logger.info(
                "[DEBUG parsear_anotacoes_snpeff — CONSENSO] primeira variante:\n%s",
                json.dumps(_debug_variants[0], indent=2, ensure_ascii=False)
            )
        else:
            logger.info("[DEBUG parsear_anotacoes_snpeff — CONSENSO] top_variants vazio ou ausente.")
        # --- FIM DEBUG ---

        escrever_log_ui(
            paciente_uuid,
            f"Anotação SnpEff: {annotation_summary.get('total_annotated', 0)} variantes "
            f"({annotation_summary.get('high_impact', 0)} HIGH, "
            f"{annotation_summary.get('moderate_impact', 0)} MODERATE)"
        )

        # --- ARQUIVAMENTO DE SEGURANÇA (AUDITORIA_DIR) ---
        # Copia os VCFs finais de todos os callers para AUDITORIA_DIR, protegendo-os do
        # DELETE /api/analysis/{id} que apaga glob(uuid*) em WSL_PROCESSAMENTO.
        # Nomes canônicos (sem sufixo de etapa intermediária) para descoberta pela regex
        # da rota de Benchmarking. Cada caller tem try/except independente — falha de um
        # não bloqueia os demais nem a persistência no banco.
        _varscan_annotated_src = WSL_PROCESSAMENTO / f"{paciente_uuid}_varscan_annotated.vcf"
        _lofreq_annotated_src  = WSL_PROCESSAMENTO / f"{paciente_uuid}_lofreq_annotated.vcf"
        _mutect_annotated_src  = WSL_PROCESSAMENTO / f"{paciente_uuid}_mutect_annotated.vcf"

        _arquivos_auditoria: list[tuple[Path, str]] = [
            (
                _varscan_annotated_src if _vcf_valido(_varscan_annotated_src)
                else _varscan_norm,
                f"{paciente_uuid}_varscan.vcf",
            ),
            (
                _lofreq_annotated_src if _vcf_valido(_lofreq_annotated_src)
                else vcf_lofreq_path,
                f"{paciente_uuid}_lofreq.vcf",
            ),
            (
                _mutect_annotated_src if _vcf_valido(_mutect_annotated_src)
                else WSL_PROCESSAMENTO / f"{paciente_uuid}_mutect_hf.vcf",
                f"{paciente_uuid}_mutect_hf.vcf",
            ),
            (
                _gnomad_vcf if _vcf_valido(_gnomad_vcf)
                else vcf_consenso_path,
                f"{paciente_uuid}_consensus.vcf",
            ),
        ]
        for _origem, _nome_destino in _arquivos_auditoria:
            _destino_audit = AUDITORIA_DIR / _nome_destino
            try:
                if _vcf_valido(_origem):
                    shutil.copy2(_origem, _destino_audit)
                    logger.info("[%s] Arquivado em AUDITORIA_DIR: %s", paciente_uuid, _nome_destino)
                else:
                    logger.warning(
                        "[%s] Arquivo ausente ou vazio — não arquivado: %s",
                        paciente_uuid, _origem.name,
                    )
            except OSError as _e:
                logger.warning(
                    "[%s] Falha ao arquivar %s em AUDITORIA_DIR: %s",
                    paciente_uuid, _nome_destino, _e,
                )

        # Puxa o registro do banco para salvar as métricas e a rastreabilidade
        registro_final = db.query(Analysis).filter(Analysis.patient_uuid == paciente_uuid).first()
        if not registro_final:
            raise RuntimeError(
                f"Registro do paciente não encontrado no banco (UUID: {paciente_uuid}). "
                "Laudo não pode ser salvo. Verifique a integridade do banco de dados."
            )

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

        # Detalhe por caller — usa VCF anotado pelo SnpEff quando disponível;
        # fallback para o VCF normalizado bruto quando SnpEff falhou.
        # parsear_anotacoes_snpeff lida com VCFs sem ANN= (retorna "—" nos campos funcionais).
        _varscan_ann_path = WSL_PROCESSAMENTO / f"{paciente_uuid}_varscan_annotated.vcf"
        if not _vcf_valido(_varscan_ann_path):
            _varscan_ann_path = vcf_varscan_path
        _mutect_ann_path = WSL_PROCESSAMENTO / f"{paciente_uuid}_mutect_annotated.vcf"
        if not _vcf_valido(_mutect_ann_path):
            _mutect_ann_path = vcf_mutect_path
        _lofreq_ann_path = WSL_PROCESSAMENTO / f"{paciente_uuid}_lofreq_annotated.vcf"
        if not _vcf_valido(_lofreq_ann_path):
            _lofreq_ann_path = vcf_lofreq_path

        varscan_ann = parsear_anotacoes_snpeff(_varscan_ann_path)
        mutect_ann  = parsear_anotacoes_snpeff(_mutect_ann_path)
        lofreq_ann  = parsear_anotacoes_snpeff(_lofreq_ann_path)
        registro_final.varscan_details = json.dumps(varscan_ann.get("top_variants", []))
        registro_final.mutect_details  = json.dumps(mutect_ann.get("top_variants",  []))
        registro_final.lofreq_details  = json.dumps(lofreq_ann.get("top_variants",  []))

        # Anotação Funcional (SnpEff)
        if annotation_summary:
            registro_final.annotation_summary = json.dumps(annotation_summary)

        # Telemetria — inclui métricas de QC de cobertura do painel (bedcov) e flag do Soft Gate
        tempos_etapas["qc_alvos_zerados"]   = pct_alvos_zerados
        tempos_etapas["qc_alvos_criticos"]  = pct_alvos_criticos
        tempos_etapas["qc_warning_flag"]    = qc_warning_flag
        tempos_etapas["qc_warning_message"] = qc_warning_message
        registro_final.time_total = f"{time.time() - pipeline_start:.1f}s"
        registro_final.time_steps = json.dumps(tempos_etapas)

        db.commit()

        _registrar_run_no_manifesto(
            patient_id=registro_final.patient_id,
            paciente_uuid=paciente_uuid,
            min_dp=min_dp,
            vaf=vaf,
            modo_bam=modo_bam,
        )

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