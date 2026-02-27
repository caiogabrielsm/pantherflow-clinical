import os

datasets_dir = r"C:\Users\LAIT-02\Documents\Caio\Projetos\catalisa\datasets"
target_bed = os.path.join(datasets_dir, "Target_bases_covered_by_probes_Interprise_Pronon_TE-99723145_hg38_230502180121.bed")
fai_file = os.path.join(datasets_dir, "Homo_sapiens_assembly38.fasta.fai")

# 1. Gerar o alvo_qualimap_6col.bed
print("Gerando alvo_qualimap_6col.bed...")
with open(target_bed, 'r') as infile, open(os.path.join(datasets_dir, "alvo_qualimap_6col.bed"), 'w') as outfile:
    for line in infile:
        fields = line.strip().split('\t')
        if len(fields) >= 4:
            # Formato Qualimap: chrom, start, end, name, score, strand
            new_line = f"{fields[0]}\t{fields[1]}\t{fields[2]}\t{fields[3]}\t0\t.\n"
            outfile.write(new_line)

# 2. Gerar o chr_name_map.txt
print("Gerando chr_name_map.txt...")
with open(fai_file, 'r') as infile, open(os.path.join(datasets_dir, "chr_name_map.txt"), 'w') as outfile:
    for line in infile:
        chrom = line.split('\t')[0]
        # Mapeia 'chr1' para '1'
        short_name = chrom.replace('chr', '')
        outfile.write(f"{chrom}\t{short_name}\n")

print("Sucesso! Arquivos gerados na pasta datasets.")