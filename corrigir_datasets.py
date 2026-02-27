import os

# Caminhos definidos conforme seu ambiente no Lab
datasets_dir = r"C:\Users\LAIT-02\Documents\Caio\Projetos\catalisa\datasets"
target_bed = os.path.join(datasets_dir, "Target_bases_covered_by_probes_Interprise_Pronon_TE-99723145_hg38_230502180121.bed")
fai_file = os.path.join(datasets_dir, "Homo_sapiens_assembly38.fasta.fai")

def gerar_arquivos():
    # 1. Gerar alvo_qualimap_6col.bed
    if os.path.exists(target_bed):
        print(f"Lendo: {target_bed}")
        with open(target_bed, 'r') as f_in, open(os.path.join(datasets_dir, "alvo_qualimap_6col.bed"), 'w') as f_out:
            for line in f_in:
                if line.strip():
                    parts = line.strip().split('\t')
                    if len(parts) >= 3:
                        # Pega os 4 primeiros campos e adiciona score e strand
                        name = parts[3] if len(parts) > 3 else "target"
                        f_out.write(f"{parts[0]}\t{parts[1]}\t{parts[2]}\t{name}\t0\t.\n")
        print("✅ alvo_qualimap_6col.bed gerado.")
    else:
        print("❌ Erro: Arquivo Target_bases...bed não encontrado!")

    # 2. Gerar chr_name_map.txt
    if os.path.exists(fai_file):
        print(f"Lendo: {fai_file}")
        with open(fai_file, 'r') as f_in, open(os.path.join(datasets_dir, "chr_name_map.txt"), 'w') as f_out:
            for line in f_in:
                if line.strip():
                    chrom = line.split('\t')[0]
                    short = chrom.replace("chr", "")
                    f_out.write(f"{chrom}\t{short}\n")
        print("✅ chr_name_map.txt gerado.")
    else:
        print("❌ Erro: Arquivo .fai não encontrado!")

if __name__ == "__main__":
    gerar_arquivos()