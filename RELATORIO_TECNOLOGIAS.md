# PantherFlow Clinical V9 — Relatório Executivo de Tecnologias

**Trabalho de Conclusão de Curso**  
**Plataforma de Análise Genômica Clínica para Diagnóstico Oncológico Tumor-Only**

---

> Este documento descreve, de forma didática e estruturada, o conjunto de tecnologias que
> compõe o PantherFlow Clinical V9 — uma plataforma de ponta a ponta para sequenciamento
> genômico somático em contexto clínico oncológico. O objetivo é fornecer à banca avaliadora
> uma visão clara de como cada componente contribui para a segurança, a reprodutibilidade
> e a precisão diagnóstica do sistema.

---

## Sumário

1. [Infraestrutura e Orquestração](#1-infraestrutura-e-orquestração)
   - Docker
   - WSL2
   - Python / pipeline.py
2. [Interface e Experiência do Usuário (Front-end)](#2-interface-e-experiência-do-usuário-front-end)
   - React
   - TailwindCSS
3. [O Motor Genômico (Bioinformática)](#3-o-motor-genômico-bioinformática)
   - FastQC & Trimmomatic
   - BWA-MEM & Samtools
   - VarScan2
   - GATK 4.6 — Mutect2, Modelo de Contaminação e F1R2
4. [Tradução Clínica](#4-tradução-clínica)
   - SnpEff
   - SnpSift — ClinVar & COSMIC

---

## 1. Infraestrutura e Orquestração

A camada de infraestrutura é responsável por garantir que a pipeline execute de forma
**idêntica em qualquer máquina**, eliminando a clássica falha de reprodutibilidade
que assola análises bioinformáticas ("funcionou no meu computador").

---

### Docker

**O que é:**  
Docker é uma plataforma de *containerização*. Um container é um ambiente de software
completamente isolado que empacota, junto com a aplicação, todas as suas dependências —
bibliotecas, versões de ferramentas, configurações de sistema — em uma única unidade
portátil e imutável chamada **imagem**.

**Papel no PantherFlow:**  
Todas as ferramentas bioinformáticas do PantherFlow (BWA, Samtools, GATK 4.6, VarScan2,
SnpEff, SnpSift, Trimmomatic, FastQC, Qualimap) estão instaladas e versionadas dentro
da imagem Docker `pantherflow-bioinfo`. Cada etapa do processamento executa um container
efêmero que nasce, processa e morre — garantindo que o ambiente seja exatamente o mesmo
independentemente de quando ou onde a análise é executada.

**Analogia didática:**  
> Imagine que um laboratório clínico enviasse, junto com cada amostra, uma **caixa lacrada
> contendo exatamente os mesmos reagentes, pipetas e protocolos** que serão usados na
> análise — sem possibilidade de substituição ou contaminação por outros insumos do
> laboratório receptor. Docker é essa caixa lacrada para o software.

**Benefício clínico:** Reprodutibilidade total. Uma análise executada hoje produzirá
exatamente o mesmo resultado executada daqui a dois anos, desde que a imagem seja preservada.

---

### WSL2 (Windows Subsystem for Linux 2)

**O que é:**  
WSL2 é uma camada de compatibilidade desenvolvida pela Microsoft que permite executar um
kernel Linux completo dentro do Windows 11, com desempenho quase nativo graças à
virtualização leve por hipervisor (Hyper-V). Não é emulação — é um kernel Linux real.

**Papel no PantherFlow:**  
A totalidade do ecossistema bioinformático é desenvolvida para sistemas Linux/Unix.
O WSL2 atua como a **ponte entre a estação clínica Windows** (onde o médico opera a
interface) **e o ambiente Linux** onde os containers Docker executam as ferramentas
genômicas. O backend Python (FastAPI) do PantherFlow emite chamadas `wsl docker run`
que atravessam essa ponte de forma transparente, montando volumes de dados do sistema
de arquivos Windows diretamente dentro do container Linux.

**Analogia didática:**  
> É como um **consulado dentro de uma embaixada**: o médico opera em território Windows
> (seu sistema operacional cotidiano), mas quando precisa de ferramentas Linux para análise
> genômica, passa por uma "janela diplomática" (WSL2) que oferece acesso total ao ambiente
> Linux — sem precisar instalar um segundo sistema operacional ou reiniciar a máquina.

---

### Python / `pipeline.py` — O Orquestrador

**O que é:**  
Python é uma linguagem de programação de alto nível, amplamente utilizada em ciência de
dados e bioinformática. O `pipeline.py` é o módulo central do PantherFlow: um script de
aproximadamente 900 linhas que orquestra todas as etapas do processamento.

**Papel no PantherFlow:**  
O `pipeline.py` é o **maestro** da plataforma. Ele:

1. Recebe os arquivos FASTQ do paciente e os metadados clínicos (ID, médico, protocolo)
2. Lança cada ferramenta bioinformática, na ordem correta, dentro de containers Docker
3. Captura a saída de cada etapa em tempo real e a transmite para o console da interface
4. Detecta e trata falhas com lógica de *fallback* (ex: se SnpSift falhar, o laudo ainda
   é gerado com os dados disponíveis)
5. Extrai métricas biológicas (cobertura, taxa de mapeamento, contagem de variantes)
6. Persiste o laudo no banco de dados SQLite
7. Registra a telemetria de tempo de cada etapa para fins de auditoria e otimização

Utiliza `subprocess.Popen` com threads paralelas de leitura de `stdout`/`stderr` para
captura de logs sem bloqueio, e é invocado de forma assíncrona pela API FastAPI para não
bloquear o servidor durante análises longas.

**Analogia didática:**  
> O `pipeline.py` funciona como o **protocolo de uma cirurgia cardíaca**: define a ordem
> exata de cada procedimento, quem executa cada passo, o que fazer se uma etapa falhar,
> e registra o tempo de cada intervenção. Sem ele, as ferramentas genômicas seriam apenas
> instrumentos cirúrgicos dispersos numa mesa — precisos, mas sem coordenação.

---

## 2. Interface e Experiência do Usuário (Front-end)

A camada de interface foi projetada para ser operada por **médicos e geneticistas**, não
por bioinformatas. A prioridade é clareza diagnóstica, não complexidade técnica.

---

### React

**O que é:**  
React é uma biblioteca JavaScript desenvolvida pelo Meta (Facebook) para construção de
interfaces de usuário dinâmicas. Seu princípio central é o de **componentes reativos**:
partes da interface que se atualizam automaticamente quando os dados subjacentes mudam,
sem necessidade de recarregar a página.

**Papel no PantherFlow:**  
Todo o front-end clínico do PantherFlow é construído em React. A tela de Monitoramento,
por exemplo, atualiza o console de logs e os indicadores de hardware (CPU, RAM, Disco) a
cada 2–3 segundos sem qualquer interação do usuário — graças à reatividade do React.
O laudo clínico (`Results`) é uma Single Page Application (SPA) roteada por UUID anônimo,
garantindo que cada acesso exiba os dados corretos do paciente de forma isolada.

**Analogia didática:**  
> React é como um **monitor de sinais vitais em UTI**: sem nenhuma ação do médico,
> a tela se atualiza continuamente refletindo o estado real do paciente a cada segundo.
> A "paciente", neste caso, é a pipeline de análise genômica em execução.

---

### TailwindCSS

**O que é:**  
TailwindCSS é um framework de estilização CSS baseado em classes utilitárias. Em vez de
escrever folhas de estilo separadas, o desenvolvedor aplica classes diretamente nos
elementos HTML (ex: `bg-red-600`, `font-bold`, `rounded-xl`), compondo o design
diretamente na estrutura do componente.

**Papel no PantherFlow:**  
TailwindCSS é responsável por toda a identidade visual clínica da plataforma: a paleta
de cores dos *badges* de patogenicidade (vermelho para HIGH, âmbar para MODERATE, verde
para LOW), o layout responsivo das tabelas de variantes, a barra lateral recolhível e
os cards de métricas. A escolha deliberada de cores e hierarquias visuais segue princípios
de UX médica — priorizando a leitura rápida de informações críticas durante uma consulta.

**Analogia didática:**  
> TailwindCSS é como o **manual de identidade visual de um hospital**: define que laudos
> críticos usam vermelho, achados moderados usam amarelo e resultados normais usam verde
> — de forma consistente em todos os documentos e telas, sem que cada médico precise
> "inventar" sua própria paleta.

---

## 3. O Motor Genômico (Bioinformática)

Esta é a camada onde ocorre o processamento científico propriamente dito. Cada ferramenta
representa décadas de pesquisa publicada e validada pela comunidade de bioinformática e
genômica clínica mundial.

---

### FastQC & Trimmomatic

**O que são:**  
- **FastQC** é uma ferramenta de controle de qualidade que avalia as leituras brutas do
  sequenciador (arquivos FASTQ) antes de qualquer processamento.
- **Trimmomatic** é um processador de leituras que remove sequências de adaptadores
  (fragmentos sintéticos inseridos no preparo da biblioteca) e bases de baixa qualidade
  nas extremidades das leituras.

**Papel no PantherFlow:**  
São as primeiras etapas da pipeline (Etapas 1 e 2). O FastQC gera um relatório HTML
interativo com métricas de distribuição de qualidade, conteúdo GC e comprimento de
leituras — disponível na aba "Controle de Qualidade" do laudo. O Trimmomatic opera com
os adaptadores **TruSeq3-PE** (específicos para sequenciamento Paired-End Illumina),
removendo os artefatos antes que contaminem o alinhamento.

**Resultado observado na análise de teste:**  
`99,70%` dos *read pairs* sobreviveram ao Trimmomatic — indicativo de excelente qualidade
da biblioteca sequenciada.

**Analogia didática:**  
> FastQC é o **laudo de triagem do banco de sangue**: antes de usar, verifica-se se a
> amostra atende aos padrões mínimos de qualidade. Trimmomatic é a **centrifugação que
> remove impurezas** — em biologia molecular, os adaptadores — antes da análise definitiva.

---

### BWA-MEM & Samtools

**O que são:**  
- **BWA-MEM** (*Burrows-Wheeler Aligner — Maximal Exact Match*) é o algoritmo de
  alinhamento de referência mais utilizado em genômica clínica. Recebe as leituras curtas
  (70–150 pb) e as mapeia contra o genoma humano de referência hg38.
- **Samtools** é um conjunto de utilitários para manipulação de arquivos de alinhamento
  nos formatos SAM/BAM/CRAM. No PantherFlow, executa a conversão SAM→BAM, a ordenação
  por coordenada genômica e a indexação do BAM final.

**Papel no PantherFlow:**  
No PantherFlow V9, BWA-MEM e Samtools operam em um **pipeline unificado sem arquivo
intermediário no disco** (`bwa mem | samtools view | samtools sort`), evitando gargalos
de I/O. O BAM final, indexado e ordenado, é a entrada para todas as etapas downstream
(VarScan2, Mutect2, Qualimap).

**Referência genômica:** `Homo_sapiens_assembly38.fasta` (GRCh38/hg38, UCSC) — o padrão
atual de referência para análises clínicas de genoma humano.

**Resultado observado:**  
`~70,9%` de taxa de mapeamento — aceitável para painel direcionado de 364 kb de intervalos
alvo, onde reads de regiões fora do painel não são esperados mapear.

**Analogia didática:**  
> O BWA-MEM atua como o **Google Maps do genoma**: recebe milhares de fragmentos de DNA
> sem coordenadas e, consultando o "mapa completo" (hg38), determina a localização exata
> de cada fragmento no cromossomo correto, com orientação e qualidade de mapeamento.
> O Samtools, por sua vez, é o **sistema de arquivamento** que organiza esses fragmentos
> por ordem geográfica (posição cromossômica) e cria o índice para acesso rápido.

---

### VarScan2

**O que é:**  
VarScan2 é uma ferramenta de chamada de variantes somáticas desenvolvida pela Washington
University School of Medicine. Utiliza abordagem estatística baseada em **limiar de
frequência alélica (VAF)** para distinguir mutações somáticas verdadeiras de ruído de
sequenciamento.

**Papel no PantherFlow:**  
VarScan2 compõe o primeiro dos dois *callers* do sistema multi-caller do PantherFlow.
Opera sobre o arquivo de *pileup* gerado pelo Samtools, reportando SNPs e INDELs com
**VAF ≥ 5%** (alta sensibilidade, adequada para painel AmpliSeq com profundidade elevada).
O parâmetro `--strand-filter 0` foi desativado para evitar supressão de variantes de
baixa frequência em regiões de baixa cobertura, configuração otimizada para tumor-only.

**Resultado observado:**  
71 variantes chamadas (68 SNPs + 3 INDELs), com 0 filtradas pelo filtro de strand — o
que confirma a qualidade do alinhamento e a ausência de bias de fita significativo.

**Analogia didática:**  
> VarScan2 age como um **patologista treinado em distinguir células atípicas de células
> normais em uma biópsia**: examina cada posição do genoma, conta os fragmentos que mostram
> a versão mutante versus a versão normal, e só "assina" a variante se a proporção mínima
> de fragmentos mutantes superar o limiar clínico estabelecido (5%).

---

### GATK 4.6 — Mutect2, Modelo de Contaminação (GDC) e Modelo F1R2

**O que é:**  
O **Genome Analysis Toolkit (GATK)** é a suíte de ferramentas do Broad Institute
(Harvard/MIT) considerada o **padrão-ouro** em genômica clínica mundial. O PantherFlow
V9 utiliza três ferramentas específicas do GATK 4.6.2:

#### Mutect2

Chamador de variantes somáticas bayesiano que opera em modo **tumor-only** (sem amostra
normal pareada). Utiliza um modelo probabilístico que considera, simultaneamente:

- A frequência alélica germinal da variante na população geral (via banco **gnomAD hg38**
  — o maior banco de variantes populacionais existente, com > 140.000 genomas)
- O modelo de orientação de leitura F1R2 (treinado na etapa anterior)
- Filtros de qualidade de mapeamento, chimeras e duplicatas

Produz um VCF bruto com todas as variantes candidatas e suas probabilidades somáticas.

#### GetPileupSummaries + CalculateContamination (Modelo GDC/NIH)

Implementa o protocolo de controle de qualidade do **Genomic Data Commons do NIH**.
`GetPileupSummaries` varre o BAM em posições de SNPs bialélicos comuns do gnomAD,
contabilizando a mistura alélica em cada posição. `CalculateContamination` usa esses
dados para estimar matematicamente a **fração de DNA contaminante** na amostra — isto é,
a proporção de material genômico de origem não-tumoral ou de amostra cruzada.
A tabela resultante é passada ao `FilterMutectCalls` para descontar variantes explicáveis
por contaminação.

#### LearnReadOrientationModel — Filtro de Artefatos OxoG/FFPE (F1R2)

Aborda um dos principais artefatos de sequenciamento em amostras clínicas: a **oxidação
da guanina (OxoG)**. Durante o preparo da biblioteca, especialmente em amostras FFPE
(tecido fixado em formalina e embebido em parafina), a guanina pode ser quimicamente
modificada, gerando leituras falsamente mutadas C→A. O modelo F1R2 aprende, a partir dos
dados da própria amostra, a assinatura estatística desses artefatos e a aplica como *prior*
bayesiano no `FilterMutectCalls`, suprimindo falsos positivos sem remover variantes reais.

**Resultado observado:**  
O modelo convergiu em **33 contextos trinucleotídeos** com até 11 iterações de EM
(*Expectation-Maximization*), e `FilterMutectCalls` processou **840 variantes candidatas
em 0,02 minutos** com os três filtros ativos (F1R2 + contaminação + filtros padrão GATK).

**Analogia didática:**  
> O Mutect2 é o **perito forense molecular**: em vez de simplesmente listar diferenças
> entre duas amostras, ele constrói um caso probabilístico — considerando o perfil
> populacional (gnomAD), a qualidade das evidências (qualidade de mapeamento) e os
> artefatos conhecidos (OxoG/FFPE) — antes de "assinar" uma variante como somática.  
>
> O Modelo de Contaminação é o equivalente a uma **prova de cadeia de custódia**: garante
> matematicamente que o material analisado pertence ao paciente, não a contaminantes de
> outros pacientes ou de reagentes do laboratório.  
>
> O Modelo F1R2 é o **controle de qualidade químico do laudo patológico**: da mesma forma
> que um patologista sabe que certas alterações morfológicas em tecido FFPE são artefatos
> do processamento e não de doença, o GATK aprende quais assinaturas mutacionais são
> artefatos de oxidação — e as desconta automaticamente.

---

## 4. Tradução Clínica

As ferramentas de anotação transformam coordenadas genômicas brutas (`chr17:7674220 C→T`)
em linguagem clínica interpretável (`TP53 p.R175H — HIGH impact — Pathogenic — COSMIC: 11.852`).
Esta camada é o que diferencia uma análise bioinformática de um **laudo clínico utilizável**.

---

### SnpEff

**O que é:**  
SnpEff é um motor de anotação funcional de variantes desenvolvido pelo Grupo de Bioinformática
da Universidade de Maryland. Para cada variante, consulta a base de dados de transcritos
**Ensembl GRCh38.99** e prediz o efeito funcional sobre cada gene afetado.

**Papel no PantherFlow:**  
SnpEff anota os três VCFs gerados (VarScan2, Mutect2 e Consenso), classificando cada
variante em quatro categorias de impacto biológico:

| Impacto | Significado clínico | Exemplos |
|---|---|---|
| **HIGH** | Perda provável de função proteica | Nonsense, frameshift, splicing |
| **MODERATE** | Alteração estrutural não-sinônima | Missense (troca de aminoácido) |
| **LOW** | Efeito biológico mínimo esperado | Sinônimo, região 3'-UTR |
| **MODIFIER** | Localização intergênica ou intrônica | Fora de regiões codificantes |

Fornece também a notação **HGVS** (Human Genome Variation Society) para proteína
(ex: `p.Arg175His`) — o padrão universal de comunicação de variantes entre laboratórios.

**Resultado observado:**  
69 variantes de consenso anotadas: **1 HIGH** (perda de função potencial) e
**18 MODERATE** (missense) — representando o conjunto de variantes com maior relevância
clínica para revisão pelo geneticista.

**Analogia didática:**  
> SnpEff é o **dicionário de tradução do genoma para a clínica**: transforma coordenadas
> de nucleotídeos em sentenças como "esta mutação troca o aminoácido Arginina por
> Histidina na posição 175 da proteína TP53 — uma alteração de alto impacto funcional".
> Sem ele, o resultado da análise seria uma lista de números sem interpretação biológica.

---

### SnpSift — ClinVar & COSMIC

**O que é:**  
SnpSift é um conjunto de ferramentas complementares ao SnpEff para filtragem e anotação
de VCFs com campos de bancos de dados externos. O PantherFlow utiliza dois bancos:

#### ClinVar (NCBI/NIH)

Base de dados mantida pelo National Center for Biotechnology Information que cataloga
variantes genéticas e sua **patogenicidade clínica clinicamente estabelecida**, com
classificação padronizada:

| Classificação | Interpretação |
|---|---|
| Pathogenic | Causadora de doença confirmada |
| Likely Pathogenic | Forte evidência de causalidade |
| VUS | Variante de Significância Incerta |
| Likely Benign / Benign | Sem evidência de patogenicidade |

#### COSMIC (Catalogue of Somatic Mutations in Cancer)

Base de dados do Wellcome Sanger Institute que cataloga mutações somáticas identificadas
em tumores humanos em todo o mundo. O campo `CNT` (count) indica em **quantos tumores
distintos aquela exata mutação já foi observada** — um indicativo direto de relevância
oncológica (ex: `TP53 p.R175H CNT=11.852` significa que essa mutação foi registrada em
11.852 amostras tumorais no banco COSMIC).

**Papel no PantherFlow:**  
SnpSift anota as variantes de Consenso com os campos `CLNSIG` (significância ClinVar),
`CLNDN` (nome da doença associada) e `CNT` (frequência COSMIC), que são exibidos na tabela
da aba "Laudo Clínico" do resultado. Esta anotação permite ao oncologista priorizar
imediatamente as variantes com maior evidência de patogenicidade e relevância tumoral,
sem necessidade de consulta manual a bancos externos.

**Analogia didática:**  
> ClinVar é o **prontuário global da variante**: reúne todos os casos clínicos já publicados
> em que aquela mutação foi associada a uma doença específica. É como consultar a literatura
> médica mundial de forma automática para cada variante identificada.  
>
> COSMIC é o **registro de incidência oncológica**: indica quantas vezes aquela mutação
> específica já foi encontrada em tumores ao redor do mundo. Uma variante com `CNT=11.852`
> não é uma descoberta nova — é uma mutação driver conhecida, com implicações diretas
> na escolha de protocolo terapêutico.

---

## Conclusão

O PantherFlow Clinical V9 representa a integração coerente de três camadas tecnológicas
complementares:

1. **Infraestrutura robusta** (Docker + WSL2 + Python) que garante que os resultados sejam
   reprodutíveis, auditáveis e independentes do ambiente computacional.

2. **Interface clínica** (React + TailwindCSS) que traduz a complexidade técnica da
   bioinformática em um laudo navegável, estruturado e acionável por profissionais de saúde.

3. **Motor genômico de precisão** (BWA + VarScan2 + GATK 4.6 + SnpEff + SnpSift) que
   implementa os protocolos do estado da arte — Broad Institute Best Practices e GDC/NIH —
   para chamada, filtragem e anotação clínica de variantes somáticas tumor-only.

A combinação do **consenso multi-caller** (VarScan2 ∩ Mutect2), do **modelo de contaminação
GDC** e do **filtro de artefatos F1R2** posiciona o PantherFlow V9 como uma plataforma
com nível de rigor estatístico compatível com aplicações clínicas e de pesquisa translacional.

---

*Documento gerado automaticamente pelo sistema PantherFlow Clinical V9*  
*Versão do relatório: 1.0 — Abril de 2026*
