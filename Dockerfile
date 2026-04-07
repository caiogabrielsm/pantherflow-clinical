# 1. Base: Puxa um Linux (Debian) bem leve que já vem com o Conda instalado de fábrica.
FROM continuumio/miniconda3:latest

# 2. Pasta de Trabalho: Diz para o Linux que tudo vai acontecer dentro da pasta /app
WORKDIR /app

# 3. Canais do Conda: Configura as fontes de download exatamente como no seu POP 1
RUN conda config --add channels defaults && \
    conda config --add channels bioconda && \
    conda config --add channels conda-forge && \
    conda config --set channel_priority strict

# 4. Instalação: Baixa o Python 3.10, o Java 21 e todas as suas ferramentas de Bioinfo!
# Nota: Como o container já é um ambiente isolado, instalamos tudo direto nele, sem precisar do "conda create".
RUN conda install -y python=3.10 \
    fastqc trimmomatic bwa samtools qualimap gatk4 varscan snpeff \
    "bcftools>=1.18" "htslib>=1.18" \
    openjdk=21 && \
    conda clean -a -y

# 5. Comando padrão: Quando o container ligar, ele vai abrir a tela preta do Linux (bash)
CMD ["/bin/bash"]