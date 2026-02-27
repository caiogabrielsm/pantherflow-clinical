import urllib.request
import os

# O seu cofre de referências no PC do Lab
DIRETORIO_ALVO = r"C:\Users\LAIT-02\Documents\Caio\Projetos\catalisa\datasets"

# Cria a pasta caso ela ainda não exista
os.makedirs(DIRETORIO_ALVO, exist_ok=True)

# Dicionário com os links oficiais corrigidos (GATK Resource Bundle)
ARQUIVOS = {
    # Genoma e Índices (Direto do novo repositório público)
    "Homo_sapiens_assembly38.fasta": "https://storage.googleapis.com/gcp-public-data--broad-references/hg38/v0/Homo_sapiens_assembly38.fasta",
    "Homo_sapiens_assembly38.fasta.fai": "https://storage.googleapis.com/gcp-public-data--broad-references/hg38/v0/Homo_sapiens_assembly38.fasta.fai",
    "Homo_sapiens_assembly38.dict": "https://storage.googleapis.com/gcp-public-data--broad-references/hg38/v0/Homo_sapiens_assembly38.dict",
    
    # dbSNP
    "Homo_sapiens_assembly38.dbsnp138.vcf": "https://storage.googleapis.com/gcp-public-data--broad-references/hg38/v0/Homo_sapiens_assembly38.dbsnp138.vcf",
    "Homo_sapiens_assembly38.dbsnp138.vcf.idx": "https://storage.googleapis.com/gcp-public-data--broad-references/hg38/v0/Homo_sapiens_assembly38.dbsnp138.vcf.idx",
    
    # gnomAD Somático (af-only)
    "af-only-gnomad.hg38.vcf.gz": "https://storage.googleapis.com/gcp-public-data--broad-references/hg38/v0/somatic-hg38/af-only-gnomad.hg38.vcf.gz",
    "af-only-gnomad.hg38.vcf.gz.tbi": "https://storage.googleapis.com/gcp-public-data--broad-references/hg38/v0/somatic-hg38/af-only-gnomad.hg38.vcf.gz.tbi"
}

def barra_de_progresso(blocos_lidos, tamanho_bloco, tamanho_total):
    if tamanho_total > 0:
        percentual = min((blocos_lidos * tamanho_bloco * 100) / tamanho_total, 100)
        tamanho_mb = tamanho_total / (1024 * 1024)
        baixado_mb = (blocos_lidos * tamanho_bloco) / (1024 * 1024)
        print(f"\rProgresso: {percentual:.1f}% ({baixado_mb:.1f} MB de {tamanho_mb:.1f} MB)", end="")

print(f"Iniciando download para o cofre: {DIRETORIO_ALVO}\n")

for nome_arquivo, url in ARQUIVOS.items():
    caminho_completo = os.path.join(DIRETORIO_ALVO, nome_arquivo)
    
    if not os.path.exists(caminho_completo):
        print(f"\nBaixando: {nome_arquivo}")
        try:
            urllib.request.urlretrieve(url, caminho_completo, barra_de_progresso)
            print(" - Concluído!")
        except Exception as e:
            print(f"\nErro ao baixar {nome_arquivo}: {e}")
    else:
        print(f"\nArquivo já existe, pulando: {nome_arquivo}")

print("\n\nProcesso finalizado!")